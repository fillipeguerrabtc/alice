import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, eq, getDatabase, isNull, schema } from '@alice/database';
import { getRedisClient, GPU_MANAGER_CONFIG, requirePermission } from '@alice/shared-utils';
import { z } from 'zod';
import { TrainingHyperparamsOverrideSchema, loadTrainingSystemRuntimeConfig } from '../training-runner.js';
import { loadTrainingEnterpriseConfig } from '../training-config.js';
import { getTenantInflightFineTuningJobsCount, loadTrainingGovernanceRuntimeConfig } from '../training-governance.js';
import { selectExamplesByProfile } from '../dataset-selection-engine.js';
import { persistCanonicalDatasetSnapshot, reserveDatasetRowsForJob } from '../datasets/dataset-selection.js';
import { TradingLoraHyperparamsSchema } from '@alice/shared';
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

interface RegisterTrainingJobCreateRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  resolveAuthorizedTenantId: ResolveAuthorizedTenantIdFn;
  readOptionalTrainingIdempotencyKey: (req: Request) => { key: string | null; error: string | null };
  buildRunStartRequestFingerprint: (params: {
    operation: 'custom_job';
    tenantId: string;
    payload: Record<string, unknown>;
  }) => string;
  hashIdempotencyKeyForAudit: (key: string) => string;
  lookupRunStartIdempotencyReplay: (params: {
    redis: NonNullable<ReturnType<typeof getRedisClient>>;
    operation: 'custom_job';
    tenantId: string;
    idempotencyKey: string;
    fingerprint: string;
  }) => Promise<
    | { status: 'miss' }
    | { status: 'payload_mismatch' }
    | { status: 'hit'; job: typeof schema.fineTuningJobs.$inferSelect }
  >;
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
  storeRunStartIdempotencyRecord: (params: {
    redis: NonNullable<ReturnType<typeof getRedisClient>>;
    operation: 'custom_job';
    tenantId: string;
    idempotencyKey: string;
    fingerprint: string;
    jobId: string;
  }) => Promise<void>;
  findNamespaceByIdInTenant: (tenantId: string, namespaceId: string) => Promise<{ id: string; tenantId: string | null } | null | undefined>;
  findAgentByIdInTenant: (tenantId: string, agentId: string) => Promise<{ id: string; namespaceId: string | null } | null | undefined>;
  enqueueTrainingFineTuningRun: (params: {
    fineTuningJobId: string;
    tenantId: string;
    priority: 'low' | 'normal' | 'high';
    requestedBy?: string | null;
  }) => Promise<{ enqueued: boolean; runId: string | null }>;
  persistTrainingGovernanceAudit: (params: {
    tenantId: string;
    userId: string | null;
    action: 'training_run_start_requested';
    resourceId: string;
    request: Request;
    details: Record<string, unknown>;
  }) => Promise<void>;
  trainingRunStartRequireIdempotencyKey: boolean;
  trainingRunStartContentionRetryAfterSeconds: number;
  trainingRunStartCapacityRetryAfterSeconds: number;
  incrementRunStartIdempotencyMetric: (result: string) => void;
  incrementGovernanceLockAttemptsMetric: (result: 'redis_unavailable' | 'contention' | 'acquired') => void;
  incrementGovernanceAuditWritesMetric: (result: 'success' | 'failure') => void;
}

const createJobSchema = z.object({
  tenantId: z.string().uuid().optional(),
  namespaceId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  domain: z.string().min(1).max(120).optional(),
  name: z.string().min(1),
  baseModel: z.string().default(GPU_MANAGER_CONFIG.models.llm),
  hyperparameters: TrainingHyperparamsOverrideSchema.optional(),
  hyperparametersPreset: z.enum(['safe', 'standard', 'large']).optional(),
  forceMinSize: z.boolean().optional(),
});

export function registerTrainingJobCreateRoutes(
  app: Express,
  deps: RegisterTrainingJobCreateRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('training-service');

  app.post('/api/training/jobs', requirePermission('training:fine_tuning_jobs:start'), async (req: Request, res: Response) => {
    try {
      const body = createJobSchema.parse(req.body);
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

      const tenantResolution = deps.resolveAuthorizedTenantId(req, body.tenantId ?? null);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }
      const authorizedTenantId = tenantResolution.tenantId;
      const db = getDatabase();

      const namespace = await deps.findNamespaceByIdInTenant(authorizedTenantId, body.namespaceId);
      if (!namespace) {
        return res.status(404).json({ error: 'Namespace nao encontrado' });
      }
      if (body.tenantId && namespace.tenantId !== body.tenantId) {
        return res.status(403).json({ error: 'Namespace nao pertence ao tenant informado' });
      }
      const tenantId = authorizedTenantId;
      if (namespace.tenantId !== tenantId) {
        return res.status(403).json({ error: 'Namespace nao pertence ao tenant autenticado' });
      }
      if (!tenantId) {
        return res.status(400).json({ error: 'Tenant invalido para criacao de job de treinamento' });
      }

      const requestFingerprint = deps.buildRunStartRequestFingerprint({
        operation: 'custom_job',
        tenantId,
        payload: {
          namespaceId: body.namespaceId,
          agentId: body.agentId ?? null,
          domain: body.domain ?? null,
          name: body.name,
          baseModel: body.baseModel,
          hyperparametersPreset: body.hyperparametersPreset ?? null,
          hyperparameters: body.hyperparameters ?? null,
          forceMinSize: body.forceMinSize ?? false,
        },
      });
      const idempotencyKeyHash = idempotencyHeader.key ? deps.hashIdempotencyKeyForAudit(idempotencyHeader.key) : null;

      const redis = getRedisClient();
      let lockHandle: Awaited<ReturnType<typeof acquireTrainingOperationLock>> = null;
      if (!redis) {
        deps.incrementGovernanceLockAttemptsMetric('redis_unavailable');
        return res.status(503).json({ error: 'Redis indisponivel para controle de concorrencia de inicio de treino' });
      }
      if (idempotencyHeader.key) {
        const replay = await deps.lookupRunStartIdempotencyReplay({
          redis,
          operation: 'custom_job',
          tenantId,
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
            job: replay.job,
            loraJobId: replay.job.loraJobId,
            enqueued: false,
            idempotencyHit: true,
          });
        }
      }

      const startLockKey = buildTrainingScopeOperationLockKey({
        scope: {
          tenantId,
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
        const governanceConfig = await loadTrainingGovernanceRuntimeConfig();
        const inflightCount = await getTenantInflightFineTuningJobsCount(db, tenantId);
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

        if (body.agentId) {
          const agent = await deps.findAgentByIdInTenant(tenantId, body.agentId);
          if (!agent) {
            return res.status(403).json({ error: 'Agente invalido para o tenant autenticado' });
          }
          if (agent.namespaceId && agent.namespaceId !== namespace.id) {
            return res.status(403).json({ error: 'Agente nao pertence ao namespace informado' });
          }
        }

        const approvedConditions = [
          eq(schema.trainingData.status, 'approved'),
          eq(schema.trainingData.purpose, 'behavior_sft'),
          eq(schema.trainingData.isDuplicate, false),
          isNull(schema.trainingData.usedInJobId),
          eq(schema.trainingData.namespaceId, body.namespaceId),
        ];
        approvedConditions.push(eq(schema.trainingData.tenantId, tenantId));
        if (body.agentId) approvedConditions.push(eq(schema.trainingData.agentId, body.agentId));

        const approvedDataRaw = await db.query.trainingData.findMany({
          where: and(...approvedConditions),
        });

        const profileSelection = await selectExamplesByProfile(
          {
            tenantId,
            namespaceId: body.namespaceId,
            agentId: body.agentId ?? null,
            domain: body.domain ?? null,
          },
          'training_job',
          approvedDataRaw.map((item) => ({
            id: item.id,
            sourceType: item.sourceType,
            sourceMetadata: item.sourceMetadata as Record<string, unknown>,
            qualityScore: item.qualityScore,
            messages: item.messages as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
          })),
        );

        const approvedIds = new Set(profileSelection.selected.map((item) => item.id));
        const approvedData = approvedDataRaw.filter((item) => approvedIds.has(item.id));

        const [trainingRuntimeConfig, trainingEnterpriseConfig] = await Promise.all([
          loadTrainingSystemRuntimeConfig(),
          loadTrainingEnterpriseConfig(),
        ]);
        const minRequired = body.forceMinSize ? 1 : trainingEnterpriseConfig.minOndemandDatasetSize;
        if (approvedData.length < minRequired) {
          return res.status(400).json({
            error: 'Dados de treinamento insuficientes',
            required: minRequired,
            available: approvedData.length,
            hint: body.forceMinSize ? 'Poucos exemplos podem prejudicar o modelo. Use por sua conta e risco.' : undefined,
          });
        }

        const selectedPreset = body.hyperparametersPreset ?? 'standard';
        const presetHyperparameters = trainingRuntimeConfig.presets[selectedPreset];
        const jobHyperparameters = TradingLoraHyperparamsSchema.parse({
          ...trainingRuntimeConfig.defaultHyperparams,
          ...presetHyperparameters,
          ...(body.hyperparameters ?? {}),
        });

        const datasetSnapshot = await persistCanonicalDatasetSnapshot({
          scope: {
            tenantId,
            namespaceId: body.namespaceId,
            agentId: body.agentId ?? null,
            domain: body.domain ?? null,
          },
          options: {
            includeTradingDataset: true,
            datasetMaxRows: trainingRuntimeConfig.datasetMaxRows,
            trainEvalSplitRatio: trainingRuntimeConfig.trainEvalSplitRatio,
            minDatasetSize: minRequired,
            seed: `${tenantId}:${body.namespaceId}:${body.agentId ?? 'all'}:${Date.now().toString(36)}`,
            profileId: null,
            profileVersion: 1,
            inputRows: approvedData.map((item) => ({
              id: item.id,
              sourceType: item.sourceType,
              semhash: item.semhash,
              criadoEm: item.criadoEm,
              messages: item.messages,
              sourceMetadata: item.sourceMetadata,
              purpose: item.purpose,
            })),
          },
        });

        const [loraJob] = await db.insert(schema.loraJobs).values({
          tenantId,
          scopeType: body.agentId ? 'agent' : 'namespace',
          scopeNamespaceId: body.namespaceId,
          scopeAgentId: body.agentId ?? null,
          source: 'explicit_job',
          datasetVersionId: datasetSnapshot.datasetVersionId,
          name: `${body.name} (linked LoRA)`,
          description: 'Job LoRA vinculado ao fine_tuning_jobs',
          baseModel: body.baseModel,
          status: 'queued',
          datasetCount: datasetSnapshot.manifest.totals.train,
          validationCount: datasetSnapshot.manifest.totals.validation,
          includeTradingDataset: datasetSnapshot.splitPolicy !== 'chat_deterministic_hash',
          hyperparameters: jobHyperparameters,
          metrics: {
            holdoutCount: datasetSnapshot.manifest.totals.holdout,
            splitPolicy: datasetSnapshot.splitPolicy,
            datasetManifestHash: datasetSnapshot.manifest.hashes.manifest,
          },
        }).returning({ id: schema.loraJobs.id });

        const datasetRowIds = [
          ...datasetSnapshot.trainRows.map((row) => row.id),
          ...datasetSnapshot.validationRows.map((row) => row.id),
          ...datasetSnapshot.holdoutRows.map((row) => row.id),
        ];
        await reserveDatasetRowsForJob({
          jobId: loraJob.id,
          rowIds: datasetRowIds,
        });
        await db.insert(schema.trainingLineageEvents).values([
          {
            tenantId,
            namespaceId: body.namespaceId,
            eventType: 'dataset_version_created',
            sourceTable: 'training_data',
            sourceId: datasetSnapshot.datasetHash,
            producedTable: 'training_dataset_versions',
            producedId: datasetSnapshot.datasetVersionId,
            metadata: {
              datasetCount: datasetSnapshot.manifest.totals.eligible,
              splitPolicy: datasetSnapshot.splitPolicy,
            },
          },
          {
            tenantId,
            namespaceId: body.namespaceId,
            eventType: 'lora_job_created',
            sourceTable: 'training_dataset_versions',
            sourceId: datasetSnapshot.datasetVersionId,
            producedTable: 'lora_jobs',
            producedId: loraJob.id,
            metadata: {
              datasetVersionId: datasetSnapshot.datasetVersionId,
              datasetManifestHash: datasetSnapshot.manifest.hashes.manifest,
            },
          },
        ]);

        const [job] = await db.insert(schema.fineTuningJobs).values({
          tenantId,
          name: body.name,
          baseModel: body.baseModel,
          status: 'pending',
          runSource: 'custom_job',
          trainingDataCount: datasetSnapshot.manifest.totals.train,
          validationDataCount: datasetSnapshot.manifest.totals.validation,
          datasetVersionId: datasetSnapshot.datasetVersionId,
          loraJobId: loraJob.id,
          scopeNamespaceId: body.namespaceId,
          scopeAgentId: body.agentId ?? null,
          configSnapshot: {
            runSource: 'custom_job',
            execution: {
              trigger: 'manual',
              profile: 'advanced_job',
            },
            priority: 'normal',
            scope: {
              namespaceId: body.namespaceId,
              agentId: body.agentId ?? null,
              domain: body.domain ?? null,
            },
            hyperparametersPreset: selectedPreset,
            hyperparameters: jobHyperparameters,
            minDatasetSizeUsed: minRequired,
            datasetManifest: {
              generatedAt: new Date().toISOString(),
              splitPolicy: datasetSnapshot.splitPolicy,
              manifestHash: datasetSnapshot.manifest.hashes.manifest,
              trainingRowIds: datasetSnapshot.trainRows.map((row) => row.id),
              validationRowIds: datasetSnapshot.validationRows.map((row) => row.id),
              holdoutRowIds: datasetSnapshot.holdoutRows.map((row) => row.id),
              datasetRowIds,
              total: datasetSnapshot.manifest.totals.eligible,
              training: datasetSnapshot.manifest.totals.train,
              validation: datasetSnapshot.manifest.totals.validation,
              holdout: datasetSnapshot.manifest.totals.holdout,
            },
          },
          hyperparameters: jobHyperparameters,
          metrics: {
            scope: {
              namespaceId: body.namespaceId,
              agentId: body.agentId ?? null,
              domain: body.domain ?? null,
            },
            dataset: {
              total: datasetSnapshot.manifest.totals.eligible,
              training: datasetSnapshot.manifest.totals.train,
              validation: datasetSnapshot.manifest.totals.validation,
              holdout: datasetSnapshot.manifest.totals.holdout,
              splitPolicy: datasetSnapshot.splitPolicy,
              datasetManifestHash: datasetSnapshot.manifest.hashes.manifest,
            },
          },
          evaluationStatus: 'pending',
          promotionStatus: 'candidate',
        }).returning();

        const enqueueResult = await deps.enqueueTrainingFineTuningRun({
          fineTuningJobId: job.id,
          tenantId,
          priority: 'normal',
          requestedBy: tenantResolution.authContext.userId ?? null,
        });
        if (idempotencyHeader.key) {
          await deps.storeRunStartIdempotencyRecord({
            redis,
            operation: 'custom_job',
            tenantId,
            idempotencyKey: idempotencyHeader.key,
            fingerprint: requestFingerprint,
            jobId: job.id,
          });
        }

        try {
          await deps.persistTrainingGovernanceAudit({
            tenantId,
            userId: tenantResolution.authContext.userId ?? null,
            action: 'training_run_start_requested',
            resourceId: job.id,
            request: req,
            details: {
              source: 'custom_job',
              after: {
                status: job.status,
                promotionStatus: job.promotionStatus,
                trainingDataCount: job.trainingDataCount,
                scopeNamespaceId: job.scopeNamespaceId,
                scopeAgentId: job.scopeAgentId,
              },
              metadata: {
                operation: 'run_start',
                queuePriority: 'normal',
                runSource: 'custom_job',
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
              tenantId,
              jobId: job.id,
            },
            'Falha ao registrar auditoria de inicio de treino (job customizado)',
          );
        }

        logger.info({
          jobId: job.id,
          loraJobId: loraJob.id,
          dataCount: approvedData.length,
          scope: { tenantId, namespaceId: body.namespaceId, agentId: body.agentId ?? null },
          profileVersion: profileSelection.profileVersion,
          enqueued: enqueueResult.enqueued,
          queueRunId: enqueueResult.runId,
          idempotencyKeyHash,
        }, 'Job de fine-tuning criado e enfileirado');

        if (idempotencyHeader.key) {
          deps.applyIdempotencyResponseHeaders(res, idempotencyHeader.key, 'created');
        }

        return res.status(202).json({
          job,
          loraJobId: loraJob.id,
          enqueued: enqueueResult.enqueued,
          profileSelection: profileSelection.diagnostics,
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
                tenantId,
              },
              'Falha ao liberar lock de inicializacao de treino (job customizado)',
            );
          }
        }
      }
    } catch (error) {
      logger.error({ error }, 'Falha ao criar job');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  logger.info('Training job create routes registered');
}
