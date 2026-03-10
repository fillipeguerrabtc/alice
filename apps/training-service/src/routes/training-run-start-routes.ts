import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, eq, getDatabase, or, schema, type Database } from '@alice/database';
import { getRedisClient, requirePermission } from '@alice/shared-utils';
import { z } from 'zod';
import {
  acquireTrainingOperationLock,
  buildTrainingScopeOperationLockKey,
  releaseTrainingOperationLock,
} from '../training-enterprise-controls.js';

interface TenantResolutionSuccess {
  ok: true;
  tenantId: string;
  authContext: {
    userId: string | null;
  };
}

interface TenantResolutionError {
  ok: false;
  status: number;
  error: string;
}

type ResolveAuthorizedTenantIdFn = (
  req: Request,
  requestedTenantId?: string | null,
) => TenantResolutionSuccess | TenantResolutionError;

type TrainingAuditExecutor = Pick<Database, 'execute' | 'select' | 'insert'>;

type OnDemandReplayLookup =
  | { status: 'miss' }
  | { status: 'payload_mismatch' }
  | { status: 'hit'; job: typeof schema.fineTuningJobs.$inferSelect };

interface RegisterTrainingRunStartRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  resolveAuthorizedTenantId: ResolveAuthorizedTenantIdFn;
  readOptionalTrainingIdempotencyKey: (req: Request) => { key: string | null; error: string | null };
  buildRunStartRequestFingerprint: (params: {
    operation: 'on_demand';
    tenantId: string;
    payload: Record<string, unknown>;
  }) => string;
  hashIdempotencyKeyForAudit: (key: string) => string;
  lookupRunStartIdempotencyReplay: (params: {
    redis: NonNullable<ReturnType<typeof getRedisClient>>;
    operation: 'on_demand';
    tenantId: string;
    idempotencyKey: string;
    fingerprint: string;
  }) => Promise<OnDemandReplayLookup>;
  sendTrainingRunStartError: (params: {
    res: Response;
    status: 409 | 429;
    error: string;
    code:
      | 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH'
      | 'RUN_START_LOCK_CONTENTION'
      | 'RUN_START_ALREADY_ACTIVE'
      | 'RUN_START_CAPACITY_EXHAUSTED';
    retryAfterSeconds?: number;
    idempotencyKey?: string | null;
  }) => Response;
  applyIdempotencyResponseHeaders: (
    res: Response,
    idempotencyKey: string,
    status: 'created' | 'replayed' | 'conflict',
  ) => void;
  loadTrainingGovernanceRuntimeConfig: () => Promise<{ maxInflightRunsPerTenant: number }>;
  loadTrainingEnterpriseConfig: () => Promise<{ minOndemandDatasetSize: number }>;
  getTenantInflightFineTuningJobsCount: (tenantId: string) => Promise<number>;
  findNamespaceByIdInTenant: (tenantId: string, namespaceId: string) => Promise<{ id: string } | null | undefined>;
  evaluateDataQuality: (
    scheduleType: 'complete_fine_tuning' | 'incremental_fine_tuning',
    tenantId: string,
    minDataRequired: number,
    namespaceId?: string,
    includeImages?: boolean,
  ) => Promise<{
    isReady: boolean;
    recommendation?: string;
    reason?: string;
    dataCount?: number;
    imageCount?: number;
  }>;
  startProgressiveLoRA: (
    tenantId: string,
    options: { includeImages: boolean; namespaceId?: string },
  ) => Promise<{
    loraJobId: string;
    trainingDataUsed: number;
    datasetVersionId: string | null;
    modelVersionId: string | null;
    version: number | null;
    imagesUsed: number | null;
  }>;
  enqueueTrainingFineTuningRun: (params: {
    fineTuningJobId: string;
    tenantId: string;
    priority: 'low' | 'normal' | 'high';
    requestedBy?: string | null;
  }) => Promise<{ enqueued: boolean; runId: string | null }>;
  storeRunStartIdempotencyRecord: (params: {
    redis: NonNullable<ReturnType<typeof getRedisClient>>;
    operation: 'on_demand';
    tenantId: string;
    idempotencyKey: string;
    fingerprint: string;
    jobId: string;
  }) => Promise<void>;
  persistTrainingGovernanceAudit: (params: {
    tenantId: string;
    userId: string | null;
    action: 'training_run_start_requested';
    resourceId: string;
    request: Request;
    details: Record<string, unknown>;
    executor?: TrainingAuditExecutor;
  }) => Promise<void>;
  baseModel: string;
  trainingRunStartRequireIdempotencyKey: boolean;
  trainingRunStartContentionRetryAfterSeconds: number;
  trainingRunStartCapacityRetryAfterSeconds: number;
  incrementRunStartIdempotencyMetric: (result: string) => void;
  incrementGovernanceLockAttemptsMetric: (result: 'redis_unavailable' | 'contention' | 'acquired') => void;
  incrementGovernanceAuditWritesMetric: (result: 'success' | 'failure') => void;
}

const startTrainingSchema = z.object({
  tenantId: z.string().uuid(),
  trainingType: z.enum(['incremental', 'full']).default('incremental'),
  includeImages: z.boolean().default(false),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  description: z.string().max(500).optional(),
  namespaceId: z.string().uuid().optional(),
});

export function registerTrainingRunStartRoutes(
  app: Express,
  deps: RegisterTrainingRunStartRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('training-service');

  app.post('/api/training/run/start', requirePermission('training:training_data:manage'), async (req: Request, res: Response) => {
    const parseResult = startTrainingSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Input invalido', details: parseResult.error.format() });
    }

    const idempotencyHeader = deps.readOptionalTrainingIdempotencyKey(req);
    if (idempotencyHeader.error) {
      deps.incrementRunStartIdempotencyMetric('invalid_header');
      return res.status(400).json({ error: idempotencyHeader.error });
    }
    if (deps.trainingRunStartRequireIdempotencyKey && !idempotencyHeader.key) {
      deps.incrementRunStartIdempotencyMetric('missing_required');
      return res.status(400).json({
        error: 'Header X-Idempotency-Key obrigatorio para iniciar treino',
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      });
    }

    const { tenantId, trainingType, includeImages, priority, description, namespaceId } = parseResult.data;
    const db = getDatabase();

    try {
      const tenantResolution = deps.resolveAuthorizedTenantId(req, tenantId);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }
      const scopedTenantId = tenantResolution.tenantId;
      const [governanceConfig, trainingEnterpriseConfig] = await Promise.all([
        deps.loadTrainingGovernanceRuntimeConfig(),
        deps.loadTrainingEnterpriseConfig(),
      ]);

      const redis = getRedisClient();
      let lockHandle: Awaited<ReturnType<typeof acquireTrainingOperationLock>> = null;
      if (!redis) {
        deps.incrementGovernanceLockAttemptsMetric('redis_unavailable');
        return res.status(503).json({ error: 'Redis indisponivel para controle de concorrencia de inicio de treino' });
      }

      const requestFingerprint = deps.buildRunStartRequestFingerprint({
        operation: 'on_demand',
        tenantId: scopedTenantId,
        payload: {
          trainingType,
          includeImages,
          priority,
          description: description ?? null,
          namespaceId: namespaceId ?? null,
        },
      });
      const idempotencyKeyHash = idempotencyHeader.key ? deps.hashIdempotencyKeyForAudit(idempotencyHeader.key) : null;

      if (idempotencyHeader.key) {
        const replay = await deps.lookupRunStartIdempotencyReplay({
          redis,
          operation: 'on_demand',
          tenantId: scopedTenantId,
          idempotencyKey: idempotencyHeader.key,
          fingerprint: requestFingerprint,
        });
        if (replay.status === 'payload_mismatch') {
          return deps.sendTrainingRunStartError({
            res,
            status: 409,
            error: 'Idempotency-Key reutilizada com payload diferente',
            code: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
            idempotencyKey: idempotencyHeader.key,
          });
        }
        if (replay.status === 'hit') {
          deps.applyIdempotencyResponseHeaders(res, idempotencyHeader.key, 'replayed');
          return res.status(200).json({
            success: true,
            jobId: replay.job.id,
            loraJobId: replay.job.loraJobId,
            modelVersionId: replay.job.modelVersionId,
            version: null,
            trainingDataUsed: replay.job.trainingDataCount,
            imagesUsed: null,
            status: replay.job.status,
            enqueued: false,
            idempotencyHit: true,
          });
        }
      }

      const startLockKey = buildTrainingScopeOperationLockKey({
        scope: {
          tenantId: scopedTenantId,
          namespaceId: null,
          agentId: null,
        },
        operation: 'run_start',
      });
      lockHandle = await acquireTrainingOperationLock({
        redis,
        key: startLockKey,
        ttlSeconds: 300,
      });
      if (!lockHandle) {
        deps.incrementGovernanceLockAttemptsMetric('contention');
        return deps.sendTrainingRunStartError({
          res,
          status: 409,
          error: 'Ja existe inicializacao de treino em andamento para este tenant',
          code: 'RUN_START_LOCK_CONTENTION',
          retryAfterSeconds: deps.trainingRunStartContentionRetryAfterSeconds,
          idempotencyKey: idempotencyHeader.key,
        });
      }
      deps.incrementGovernanceLockAttemptsMetric('acquired');

      try {
        const runningJobs = await db.query.fineTuningJobs.findMany({
          where: and(
            eq(schema.fineTuningJobs.tenantId, scopedTenantId),
            or(
              eq(schema.fineTuningJobs.status, 'pending'),
              eq(schema.fineTuningJobs.status, 'training'),
              eq(schema.fineTuningJobs.status, 'preparing'),
              eq(schema.fineTuningJobs.status, 'validating'),
            ),
          ),
        });

        if (runningJobs.length > 0) {
          return deps.sendTrainingRunStartError({
            res,
            status: 409,
            error: `Ja existe treinamento em andamento ou enfileirado (jobId=${runningJobs[0].id})`,
            code: 'RUN_START_ALREADY_ACTIVE',
            retryAfterSeconds: deps.trainingRunStartContentionRetryAfterSeconds,
            idempotencyKey: idempotencyHeader.key,
          });
        }

        const inflightCount = await deps.getTenantInflightFineTuningJobsCount(scopedTenantId);
        if (inflightCount >= governanceConfig.maxInflightRunsPerTenant) {
          return deps.sendTrainingRunStartError({
            res,
            status: 429,
            error: `Capacidade de treinamento esgotada para este tenant (inflight=${inflightCount}, max=${governanceConfig.maxInflightRunsPerTenant})`,
            code: 'RUN_START_CAPACITY_EXHAUSTED',
            retryAfterSeconds: deps.trainingRunStartCapacityRetryAfterSeconds,
            idempotencyKey: idempotencyHeader.key,
          });
        }

        if (namespaceId) {
          const namespace = await deps.findNamespaceByIdInTenant(scopedTenantId, namespaceId);
          if (!namespace) {
            return res.status(403).json({ error: 'Namespace nao pertence ao tenant autenticado' });
          }
        }

        const scheduleType = trainingType === 'full' ? 'complete_fine_tuning' : 'incremental_fine_tuning';
        const evaluation = await deps.evaluateDataQuality(
          scheduleType,
          scopedTenantId,
          trainingEnterpriseConfig.minOndemandDatasetSize,
          namespaceId,
          false,
        );
        if (!evaluation.isReady) {
          return res.status(400).json({
            error: 'Dados insuficientes ou qualidade baixa',
            evaluation,
            recommendation: evaluation.recommendation,
            reason: evaluation.reason,
          });
        }

        const loraResult = await deps.startProgressiveLoRA(scopedTenantId, {
          includeImages,
          namespaceId,
        });
        await db.update(schema.loraJobs)
          .set({
            description: `on_demand:${scheduleType}:priority:${priority}`,
          })
          .where(eq(schema.loraJobs.id, loraResult.loraJobId));

        const [job] = await db.insert(schema.fineTuningJobs).values({
          tenantId: scopedTenantId,
          name: description || `Treinamento ${trainingType} on-demand`,
          baseModel: deps.baseModel,
          status: 'pending',
          runSource: 'on_demand',
          trainingDataCount: loraResult.trainingDataUsed,
          datasetVersionId: loraResult.datasetVersionId,
          loraJobId: loraResult.loraJobId,
          scopeNamespaceId: namespaceId ?? null,
          configSnapshot: {
            runSource: 'on_demand',
            execution: {
              trigger: 'manual',
              profile: 'quick_run',
            },
            scheduleType,
            priority,
            includeImages,
            namespaceId: namespaceId ?? null,
            evaluation,
          },
          evaluationStatus: 'pending',
          promotionStatus: 'candidate',
        }).returning();

        const enqueueResult = await deps.enqueueTrainingFineTuningRun({
          fineTuningJobId: job.id,
          tenantId: scopedTenantId,
          priority,
          requestedBy: tenantResolution.authContext.userId ?? null,
        });
        if (idempotencyHeader.key) {
          await deps.storeRunStartIdempotencyRecord({
            redis,
            operation: 'on_demand',
            tenantId: scopedTenantId,
            idempotencyKey: idempotencyHeader.key,
            fingerprint: requestFingerprint,
            jobId: job.id,
          });
        }

        try {
          await deps.persistTrainingGovernanceAudit({
            tenantId: scopedTenantId,
            userId: tenantResolution.authContext.userId ?? null,
            action: 'training_run_start_requested',
            resourceId: job.id,
            request: req,
            details: {
              source: 'on_demand',
              after: {
                status: job.status,
                promotionStatus: job.promotionStatus,
                trainingDataCount: job.trainingDataCount,
                scopeNamespaceId: job.scopeNamespaceId,
                scopeAgentId: job.scopeAgentId,
              },
              metadata: {
                operation: 'run_start',
                queuePriority: priority,
                runSource: 'on_demand',
                includeImages,
                trainingType,
                idempotencyKeyHash,
              },
            },
          });
          deps.incrementGovernanceAuditWritesMetric('success');
        } catch (auditError) {
          deps.incrementGovernanceAuditWritesMetric('failure');
          logger.error(
            {
              error: auditError instanceof Error ? auditError.message : String(auditError),
              tenantId: scopedTenantId,
              jobId: job.id,
            },
            'Falha ao registrar auditoria de inicio de treino (on-demand)',
          );
        }

        logger.info({
          jobId: job.id,
          loraJobId: loraResult.loraJobId,
          tenantId: scopedTenantId,
          trainingType,
          priority,
          dataCount: evaluation.dataCount,
          imageCount: evaluation.imageCount,
          enqueued: enqueueResult.enqueued,
          queueRunId: enqueueResult.runId,
          idempotencyKeyHash,
        }, 'Treinamento on-demand enfileirado');

        if (idempotencyHeader.key) {
          deps.applyIdempotencyResponseHeaders(res, idempotencyHeader.key, 'created');
        }

        return res.status(202).json({
          success: true,
          jobId: job.id,
          loraJobId: loraResult.loraJobId,
          modelVersionId: loraResult.modelVersionId,
          version: loraResult.version,
          trainingDataUsed: loraResult.trainingDataUsed,
          imagesUsed: loraResult.imagesUsed,
          status: 'queued',
          enqueued: enqueueResult.enqueued,
        });
      } finally {
        if (lockHandle) {
          try {
            await releaseTrainingOperationLock({
              redis,
              handle: lockHandle,
            });
          } catch (releaseError) {
            logger.error(
              {
                error: releaseError instanceof Error ? releaseError.message : String(releaseError),
                tenantId: scopedTenantId,
              },
              'Falha ao liberar lock de inicializacao de treino (on-demand)',
            );
          }
        }
      }
    } catch (error) {
      logger.error({ error }, 'Falha ao iniciar treinamento on-demand');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  logger.info('Training run start routes registered');
}
