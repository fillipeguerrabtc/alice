import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, desc, eq, getDatabase, lte, schema, type Database } from '@alice/database';
import { getRedisClient, requirePermission } from '@alice/shared-utils';
import { z } from 'zod';
import {
  acquireTrainingOperationLock,
  buildTrainingScopeOperationLockKey,
  releaseTrainingOperationLock,
} from '../training-enterprise-controls.js';
import { activateLoraAdapter } from '../lora-job-manager.js';
import { assertValidModelRegistryScope, buildModelVersionScopeCondition } from '../model-registry-scope.js';

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

interface RegisterTrainingJobRollbackRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  resolveAuthorizedTenantId: ResolveAuthorizedTenantIdFn;
  persistTrainingGovernanceAudit: (params: {
    tenantId: string;
    userId: string | null;
    action: 'training_model_rollback_executed';
    resourceId: string;
    request: Request;
    details: Record<string, unknown>;
    executor?: TrainingAuditExecutor;
  }) => Promise<void>;
  trainingOperationLockTtlSeconds: number;
  incrementGovernanceLockAttemptsMetric: (result: 'redis_unavailable' | 'lock_conflict' | 'acquired') => void;
  incrementGovernanceAuditWritesMetric: (result: 'success' | 'error') => void;
}

const uuidParamSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID valido'),
});

const rollbackBodySchema = z.object({
  reason: z.string().trim().min(10).max(500),
});

export function registerTrainingJobRollbackRoutes(
  app: Express,
  deps: RegisterTrainingJobRollbackRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('training-service');

  app.post('/api/training/jobs/:id/rollback', requirePermission('training:fine_tuning_jobs:start'), async (req: Request, res: Response) => {
    const paramsResult = uuidParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return res.status(400).json({ error: 'ID invalido', details: paramsResult.error.format() });
    }
    const bodyResult = rollbackBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({ error: 'Payload invalido', details: bodyResult.error.format() });
    }
    const rollbackReason = bodyResult.data.reason.trim();

    const redis = getRedisClient();
    let lockHandle: Awaited<ReturnType<typeof acquireTrainingOperationLock>> = null;
    const db = getDatabase();

    try {
      const tenantResolution = deps.resolveAuthorizedTenantId(req);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }
      if (!tenantResolution.authContext.userId) {
        return res.status(403).json({ error: 'Usuario nao identificado para rollback' });
      }

      const currentJob = await db.query.fineTuningJobs.findFirst({
        where: and(
          eq(schema.fineTuningJobs.id, paramsResult.data.id),
          eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId),
        ),
      });
      if (!currentJob) {
        return res.status(404).json({ error: 'Job de fine-tuning nao encontrado' });
      }
      if (!currentJob.modelVersionId) {
        return res.status(409).json({ error: 'Job sem modelVersionId para rollback' });
      }

      const currentVersion = await db.query.modelVersions.findFirst({
        where: and(
          eq(schema.modelVersions.id, currentJob.modelVersionId),
          eq(schema.modelVersions.tenantId, tenantResolution.tenantId),
        ),
      });
      if (!currentVersion) {
        return res.status(404).json({ error: 'Model version atual nao encontrada' });
      }
      if (!currentVersion.isActive) {
        return res.status(409).json({ error: 'Somente model version ativa pode sofrer rollback' });
      }
      if (currentJob.promotionStatus !== 'active') {
        return res.status(409).json({ error: 'Somente job com promocao ativa pode sofrer rollback' });
      }

      let scopedModelRegistry: ReturnType<typeof assertValidModelRegistryScope>;
      try {
        scopedModelRegistry = assertValidModelRegistryScope({
          namespaceId: currentVersion.namespaceId,
          agentId: currentVersion.agentId,
        });
      } catch (scopeError) {
        return res.status(409).json({
          error: scopeError instanceof Error ? scopeError.message : 'Escopo do model version invalido para rollback',
        });
      }

      if (!redis) {
        deps.incrementGovernanceLockAttemptsMetric('redis_unavailable');
        return res.status(503).json({ error: 'Redis indisponivel para controle de concorrencia de rollback' });
      }
      const lockKey = buildTrainingScopeOperationLockKey({
        scope: {
          tenantId: tenantResolution.tenantId,
          namespaceId: scopedModelRegistry.namespaceId,
          agentId: scopedModelRegistry.agentId,
        },
        operation: 'rollback',
      });
      lockHandle = await acquireTrainingOperationLock({
        redis,
        key: lockKey,
        ttlSeconds: deps.trainingOperationLockTtlSeconds,
      });
      if (!lockHandle) {
        deps.incrementGovernanceLockAttemptsMetric('lock_conflict');
        return res.status(409).json({ error: 'Rollback em andamento neste escopo; tente novamente' });
      }
      deps.incrementGovernanceLockAttemptsMetric('acquired');

      const scopedCondition = buildModelVersionScopeCondition(scopedModelRegistry);
      const previousVersion = await db.query.modelVersions.findFirst({
        where: and(
          eq(schema.modelVersions.tenantId, tenantResolution.tenantId),
          scopedCondition,
          lte(schema.modelVersions.version, currentVersion.version - 1),
        ),
        orderBy: [desc(schema.modelVersions.version)],
      });
      if (!previousVersion || !previousVersion.fineTuningJobId) {
        return res.status(404).json({ error: 'Nao existe versao anterior para rollback neste escopo' });
      }

      const previousJob = await db.query.fineTuningJobs.findFirst({
        where: and(
          eq(schema.fineTuningJobs.id, previousVersion.fineTuningJobId),
          eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId),
        ),
      });
      if (!previousJob?.loraJobId) {
        return res.status(409).json({ error: 'Versao anterior nao possui loraJobId valido' });
      }

      const activationResult = await activateLoraAdapter(
        previousJob.loraJobId,
        tenantResolution.authContext.userId,
      );

      await db.transaction(async (tx) => {
        await tx.update(schema.modelVersions)
          .set({
            isActive: false,
            status: 'rolled_back',
            deprecadoEm: new Date(),
            rolledBackFrom: previousVersion.id,
            rolledBackReason: rollbackReason,
          })
          .where(eq(schema.modelVersions.id, currentVersion.id));

        await tx.update(schema.modelVersions)
          .set({
            isActive: true,
            status: 'active',
            ativadoEm: new Date(),
          })
          .where(eq(schema.modelVersions.id, previousVersion.id));

        await tx.update(schema.fineTuningJobs)
          .set({ promotionStatus: 'rolled_back' })
          .where(eq(schema.fineTuningJobs.id, currentJob.id));

        await tx.update(schema.fineTuningJobs)
          .set({ promotionStatus: 'active' })
          .where(eq(schema.fineTuningJobs.id, previousJob.id));

        await deps.persistTrainingGovernanceAudit({
          tenantId: tenantResolution.tenantId,
          userId: tenantResolution.authContext.userId,
          action: 'training_model_rollback_executed',
          resourceId: currentJob.id,
          request: req,
          details: {
            before: {
              modelVersionId: currentVersion.id,
              promotionStatus: currentJob.promotionStatus,
            },
            after: {
              modelVersionId: previousVersion.id,
              promotionStatus: 'active',
            },
            reason: rollbackReason,
            metadata: {
              operation: 'rollback',
              scope: scopedModelRegistry,
              previousJobId: previousJob.id,
              previousVersion: previousVersion.version,
            },
          },
          executor: tx,
        });
      });
      deps.incrementGovernanceAuditWritesMetric('success');

      logger.info(
        {
          currentJobId: currentJob.id,
          previousJobId: previousJob.id,
          previousModelVersionId: previousVersion.id,
        },
        'Rollback de modelo concluido',
      );

      return res.json({
        success: true,
        rolledBackJobId: currentJob.id,
        activeJobId: previousJob.id,
        activeModelVersionId: previousVersion.id,
        activation: activationResult,
      });
    } catch (error) {
      deps.incrementGovernanceAuditWritesMetric('error');
      logger.error({ error, jobId: req.params.id }, 'Falha ao executar rollback');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    } finally {
      if (redis && lockHandle) {
        await releaseTrainingOperationLock({ redis, handle: lockHandle }).catch((lockError) => {
          logger.warn(
            { lockKey: lockHandle?.key, error: lockError instanceof Error ? lockError.message : String(lockError) },
            'Falha ao liberar lock de rollback',
          );
        });
      }
    }
  });

  logger.info('Training job rollback routes registered');
}
