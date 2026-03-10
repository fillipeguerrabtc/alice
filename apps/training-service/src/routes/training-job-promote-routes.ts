import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, desc, eq, getDatabase, schema, type Database } from '@alice/database';
import { getRedisClient, requirePermission } from '@alice/shared-utils';
import { z } from 'zod';
import { activateLoraAdapter } from '../lora-job-manager.js';
import { canPromoteFineTuningJob, loadTrainingGovernanceRuntimeConfig } from '../training-governance.js';
import {
  assertValidModelRegistryScope,
  buildFineTuningScopeCondition,
  buildModelVersionScopeCondition,
} from '../model-registry-scope.js';
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

interface RegisterTrainingJobPromoteRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  resolveAuthorizedTenantId: ResolveAuthorizedTenantIdFn;
  getPromotionApprovalSummary: (params: {
    tenantId: string;
    fineTuningJobId: string;
    requesterUserId: string;
  }) => Promise<{
    approvedDistinctUsersCount: number;
    requesterHasApproved: boolean;
    approvals: Array<{
      approverUserId: string;
      decision: 'approved' | 'rejected';
      reason: string | null;
      updatedAt: Date;
    }>;
  }>;
  persistTrainingGovernanceAudit: (params: {
    tenantId: string;
    userId: string | null;
    action: 'training_model_promoted';
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

export function registerTrainingJobPromoteRoutes(
  app: Express,
  deps: RegisterTrainingJobPromoteRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('training-service');

  app.post('/api/training/jobs/:id/promote', requirePermission('training:fine_tuning_jobs:start'), async (req: Request, res: Response) => {
    const paramsResult = uuidParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return res.status(400).json({ error: 'ID invalido', details: paramsResult.error.format() });
    }

    const redis = getRedisClient();
    let lockHandle: Awaited<ReturnType<typeof acquireTrainingOperationLock>> = null;
    const db = getDatabase();

    try {
      const tenantResolution = deps.resolveAuthorizedTenantId(req);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }
      if (!tenantResolution.authContext.userId) {
        return res.status(403).json({ error: 'Usuario nao identificado para promocao' });
      }

      const fineTuningJob = await db.query.fineTuningJobs.findFirst({
        where: and(
          eq(schema.fineTuningJobs.id, paramsResult.data.id),
          eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId),
        ),
      });
      if (!fineTuningJob) {
        return res.status(404).json({ error: 'Job de fine-tuning nao encontrado' });
      }
      if (fineTuningJob.status !== 'completed') {
        return res.status(409).json({ error: 'Somente jobs concluidos podem ser promovidos' });
      }
      if (!fineTuningJob.loraJobId) {
        return res.status(409).json({ error: 'Job sem loraJobId vinculado' });
      }
      if (fineTuningJob.promotionStatus === 'active' && fineTuningJob.modelVersionId) {
        const activeVersion = await db.query.modelVersions.findFirst({
          where: and(
            eq(schema.modelVersions.id, fineTuningJob.modelVersionId),
            eq(schema.modelVersions.tenantId, tenantResolution.tenantId),
            eq(schema.modelVersions.isActive, true),
          ),
        });
        if (activeVersion) {
          return res.json({
            success: true,
            alreadyActive: true,
            fineTuningJobId: fineTuningJob.id,
            modelVersion: activeVersion,
          });
        }
      }
      if (fineTuningJob.promotionStatus === 'active') {
        return res.status(409).json({ error: 'Job ja esta com promocao ativa neste escopo' });
      }

      let scopedModelRegistry: ReturnType<typeof assertValidModelRegistryScope>;
      try {
        scopedModelRegistry = assertValidModelRegistryScope({
          namespaceId: fineTuningJob.scopeNamespaceId,
          agentId: fineTuningJob.scopeAgentId,
        });
      } catch (scopeError) {
        return res.status(409).json({
          error: scopeError instanceof Error ? scopeError.message : 'Escopo de promocao invalido',
        });
      }

      const governanceConfig = await loadTrainingGovernanceRuntimeConfig();
      const evaluationStatus = fineTuningJob.evaluationStatus ?? 'pending';
      const approvalSummary = await deps.getPromotionApprovalSummary({
        tenantId: tenantResolution.tenantId,
        fineTuningJobId: fineTuningJob.id,
        requesterUserId: tenantResolution.authContext.userId,
      });
      const promotionCheck = canPromoteFineTuningJob({
        evaluationStatus,
        requireEvalPassedForPromotion: governanceConfig.requireEvalPassedForPromotion,
        requireApprovalGatesForPromotion: governanceConfig.requireApprovalGatesForPromotion,
        requireDualApprovalForPromotion: governanceConfig.requireDualApprovalForPromotion,
        promotionMinApprovals: governanceConfig.promotionMinApprovals,
        approvedDistinctUsersCount: approvalSummary.approvedDistinctUsersCount,
        requesterHasApproved: approvalSummary.requesterHasApproved,
      });
      if (!promotionCheck.allowed) {
        return res.status(409).json({
          error: promotionCheck.reason,
          approvals: {
            approvedDistinctUsersCount: approvalSummary.approvedDistinctUsersCount,
            requesterHasApproved: approvalSummary.requesterHasApproved,
            minApprovals: governanceConfig.promotionMinApprovals,
            requireDualApprovalForPromotion: governanceConfig.requireDualApprovalForPromotion,
          },
        });
      }

      const configSnapshot = (typeof fineTuningJob.configSnapshot === 'object' && fineTuningJob.configSnapshot !== null)
        ? fineTuningJob.configSnapshot as Record<string, unknown>
        : {};
      const datasetManifest = (typeof configSnapshot.datasetManifest === 'object' && configSnapshot.datasetManifest !== null)
        ? configSnapshot.datasetManifest as Record<string, unknown>
        : {};
      const stableHoldoutCount = typeof datasetManifest.holdout === 'number' ? datasetManifest.holdout : 0;
      const stableManifestHash = typeof datasetManifest.manifestHash === 'string'
        ? datasetManifest.manifestHash
        : null;
      if (stableHoldoutCount < 1 || !stableManifestHash) {
        return res.status(409).json({
          error: 'Promocao bloqueada: avaliacao estavel ausente (holdout/manifest hash nao encontrado)',
          evaluation: {
            holdoutCount: stableHoldoutCount,
            datasetManifestHash: stableManifestHash,
          },
        });
      }

      if (!redis) {
        deps.incrementGovernanceLockAttemptsMetric('redis_unavailable');
        return res.status(503).json({ error: 'Redis indisponivel para controle de concorrencia de promocao' });
      }
      const lockKey = buildTrainingScopeOperationLockKey({
        scope: {
          tenantId: tenantResolution.tenantId,
          namespaceId: scopedModelRegistry.namespaceId,
          agentId: scopedModelRegistry.agentId,
        },
        operation: 'promote',
      });
      lockHandle = await acquireTrainingOperationLock({
        redis,
        key: lockKey,
        ttlSeconds: deps.trainingOperationLockTtlSeconds,
      });
      if (!lockHandle) {
        deps.incrementGovernanceLockAttemptsMetric('lock_conflict');
        return res.status(409).json({ error: 'Promocao em andamento neste escopo; tente novamente' });
      }
      deps.incrementGovernanceLockAttemptsMetric('acquired');

      await db.update(schema.fineTuningJobs)
        .set({ promotionStatus: 'activating' })
        .where(eq(schema.fineTuningJobs.id, fineTuningJob.id));

      let activationResult: Awaited<ReturnType<typeof activateLoraAdapter>>;
      let modelVersion: typeof schema.modelVersions.$inferSelect;
      try {
        activationResult = await activateLoraAdapter(
          fineTuningJob.loraJobId,
          tenantResolution.authContext.userId,
        );

        const modelVersionScopeCondition = buildModelVersionScopeCondition(scopedModelRegistry);
        const fineJobScopeCondition = buildFineTuningScopeCondition(scopedModelRegistry);

        const [createdModelVersion] = await db.transaction(async (tx) => {
          const latestScopedVersion = await tx.query.modelVersions.findFirst({
            where: and(
              eq(schema.modelVersions.tenantId, tenantResolution.tenantId),
              modelVersionScopeCondition,
            ),
            orderBy: [desc(schema.modelVersions.version)],
            columns: { version: true },
          });
          const activeScopedVersion = await tx.query.modelVersions.findFirst({
            where: and(
              eq(schema.modelVersions.tenantId, tenantResolution.tenantId),
              modelVersionScopeCondition,
              eq(schema.modelVersions.isActive, true),
            ),
            orderBy: [desc(schema.modelVersions.version)],
            columns: { id: true, metrics: true },
          });

          await tx.update(schema.modelVersions)
            .set({
              isActive: false,
              status: 'deprecated',
              deprecadoEm: new Date(),
            })
            .where(and(
              eq(schema.modelVersions.tenantId, tenantResolution.tenantId),
              modelVersionScopeCondition,
              eq(schema.modelVersions.isActive, true),
            ));

          await tx.update(schema.fineTuningJobs)
            .set({ promotionStatus: 'archived' })
            .where(and(
              eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId),
              fineJobScopeCondition,
              eq(schema.fineTuningJobs.promotionStatus, 'active'),
            ));

          const nextVersion = (latestScopedVersion?.version ?? 0) + 1;
          const jobMetrics = (fineTuningJob.metrics ?? {}) as Record<string, unknown>;
          const datasetMetrics = typeof jobMetrics.dataset === 'object' && jobMetrics.dataset !== null
            ? (jobMetrics.dataset as Record<string, unknown>)
            : {};
          const imagesUsedRaw = datasetMetrics.imagesUsed;
          const imageDataCount = typeof imagesUsedRaw === 'number' && Number.isFinite(imagesUsedRaw)
            ? imagesUsedRaw
            : 0;
          const baselineMetrics = (activeScopedVersion?.metrics ?? {}) as Record<string, unknown>;

          const [createdVersion] = await tx.insert(schema.modelVersions).values({
            tenantId: tenantResolution.tenantId,
            namespaceId: scopedModelRegistry.namespaceId,
            agentId: scopedModelRegistry.agentId,
            name: `${fineTuningJob.name}-v${nextVersion}`,
            version: nextVersion,
            baseModel: fineTuningJob.baseModel,
            loraPath: activationResult.adapterPath,
            status: 'active',
            fineTuningJobId: fineTuningJob.id,
            trainingDataCount: fineTuningJob.trainingDataCount ?? 0,
            imageDataCount,
            metrics: jobMetrics,
            baselineMetrics,
            isActive: true,
            ativadoEm: new Date(),
          }).returning();

          await tx.update(schema.fineTuningJobs)
            .set({
              modelVersionId: createdVersion.id,
              promotionStatus: 'active',
            })
            .where(eq(schema.fineTuningJobs.id, fineTuningJob.id));

          await deps.persistTrainingGovernanceAudit({
            tenantId: tenantResolution.tenantId,
            userId: tenantResolution.authContext.userId,
            action: 'training_model_promoted',
            resourceId: fineTuningJob.id,
            request: req,
            details: {
              after: {
                modelVersionId: createdVersion.id,
                promotionStatus: 'active',
              },
              metadata: {
                operation: 'promote',
                scope: scopedModelRegistry,
                loraJobId: fineTuningJob.loraJobId,
                approvedDistinctUsersCount: approvalSummary.approvedDistinctUsersCount,
                requesterHasApproved: approvalSummary.requesterHasApproved,
                previousActiveModelVersionId: activeScopedVersion?.id ?? null,
              },
            },
            executor: tx,
          });

          return [createdVersion];
        });
        modelVersion = createdModelVersion;
      } catch (promotionError) {
        await db.update(schema.fineTuningJobs)
          .set({
            promotionStatus: 'failed_activation',
            errorMessage: promotionError instanceof Error ? promotionError.message : String(promotionError),
          })
          .where(eq(schema.fineTuningJobs.id, fineTuningJob.id));
        throw promotionError;
      }

      deps.incrementGovernanceAuditWritesMetric('success');

      logger.info(
        {
          fineTuningJobId: fineTuningJob.id,
          loraJobId: fineTuningJob.loraJobId,
          modelVersionId: modelVersion.id,
        },
        'Promocao de modelo concluida',
      );

      return res.json({
        success: true,
        fineTuningJobId: fineTuningJob.id,
        modelVersion,
        activation: activationResult,
        approvals: {
          approvedDistinctUsersCount: approvalSummary.approvedDistinctUsersCount,
          requesterHasApproved: approvalSummary.requesterHasApproved,
          minApprovals: governanceConfig.promotionMinApprovals,
          requireDualApprovalForPromotion: governanceConfig.requireDualApprovalForPromotion,
        },
      });
    } catch (error) {
      deps.incrementGovernanceAuditWritesMetric('error');
      logger.error({ error, jobId: req.params.id }, 'Falha ao promover modelo');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    } finally {
      if (redis && lockHandle) {
        await releaseTrainingOperationLock({ redis, handle: lockHandle }).catch((lockError) => {
          logger.warn(
            { lockKey: lockHandle?.key, error: lockError instanceof Error ? lockError.message : String(lockError) },
            'Falha ao liberar lock de promocao',
          );
        });
      }
    }
  });

  logger.info('Training job promote routes registered');
}
