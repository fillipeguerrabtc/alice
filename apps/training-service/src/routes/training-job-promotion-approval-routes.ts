import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, eq, getDatabase, schema, type Database } from '@alice/database';
import { getRedisClient, requirePermission } from '@alice/shared-utils';
import { z } from 'zod';
import {
  acquireTrainingOperationLock,
  buildTrainingJobOperationLockKey,
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

interface RegisterTrainingJobPromotionApprovalRoutesDeps {
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
    action: 'training_promotion_approval_recorded';
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

const promotionApprovalBodySchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().max(2000).optional(),
});

export function registerTrainingJobPromotionApprovalRoutes(
  app: Express,
  deps: RegisterTrainingJobPromotionApprovalRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('training-service');

  app.post('/api/training/jobs/:id/promotion-approval', requirePermission('training:fine_tuning_jobs:start'), async (req: Request, res: Response) => {
    const paramsResult = uuidParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return res.status(400).json({ error: 'ID invalido', details: paramsResult.error.format() });
    }
    const bodyResult = promotionApprovalBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({ error: 'Payload invalido', details: bodyResult.error.format() });
    }

    const redis = getRedisClient();
    let lockHandle: Awaited<ReturnType<typeof acquireTrainingOperationLock>> = null;
    const db = getDatabase();

    try {
      const tenantResolution = deps.resolveAuthorizedTenantId(req);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }
      const approverUserId = tenantResolution.authContext.userId;
      if (!approverUserId) {
        return res.status(403).json({ error: 'Usuario nao identificado para aprovar promocao' });
      }

      const fineTuningJob = await db.query.fineTuningJobs.findFirst({
        where: and(
          eq(schema.fineTuningJobs.id, paramsResult.data.id),
          eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId),
        ),
        columns: { id: true, status: true },
      });
      if (!fineTuningJob) {
        return res.status(404).json({ error: 'Job de fine-tuning nao encontrado' });
      }
      if (fineTuningJob.status !== 'completed') {
        return res.status(409).json({ error: 'Somente jobs concluidos podem receber aprovacao de promocao' });
      }

      if (!redis) {
        deps.incrementGovernanceLockAttemptsMetric('redis_unavailable');
        return res.status(503).json({ error: 'Redis indisponivel para controle de concorrencia de aprovacao' });
      }

      const lockKey = buildTrainingJobOperationLockKey({
        tenantId: tenantResolution.tenantId,
        fineTuningJobId: fineTuningJob.id,
        operation: 'promotion_approval',
      });
      lockHandle = await acquireTrainingOperationLock({
        redis,
        key: lockKey,
        ttlSeconds: deps.trainingOperationLockTtlSeconds,
      });
      if (!lockHandle) {
        deps.incrementGovernanceLockAttemptsMetric('lock_conflict');
        return res.status(409).json({ error: 'Aprovacao de promocao em andamento para este job; tente novamente' });
      }
      deps.incrementGovernanceLockAttemptsMetric('acquired');

      const now = new Date();
      await db.transaction(async (tx) => {
        const existingApproval = await tx.query.fineTuningPromotionApprovals.findFirst({
          where: and(
            eq(schema.fineTuningPromotionApprovals.tenantId, tenantResolution.tenantId),
            eq(schema.fineTuningPromotionApprovals.fineTuningJobId, fineTuningJob.id),
            eq(schema.fineTuningPromotionApprovals.approverUserId, approverUserId),
          ),
          columns: {
            decision: true,
            reason: true,
            updatedAt: true,
          },
        });

        await tx.insert(schema.fineTuningPromotionApprovals).values({
          tenantId: tenantResolution.tenantId,
          fineTuningJobId: fineTuningJob.id,
          approverUserId,
          decision: bodyResult.data.decision,
          reason: bodyResult.data.reason ?? null,
          createdAt: now,
          updatedAt: now,
        }).onConflictDoUpdate({
          target: [
            schema.fineTuningPromotionApprovals.fineTuningJobId,
            schema.fineTuningPromotionApprovals.approverUserId,
          ],
          set: {
            decision: bodyResult.data.decision,
            reason: bodyResult.data.reason ?? null,
            updatedAt: now,
          },
        });

        await deps.persistTrainingGovernanceAudit({
          tenantId: tenantResolution.tenantId,
          userId: approverUserId,
          action: 'training_promotion_approval_recorded',
          resourceId: fineTuningJob.id,
          request: req,
          details: {
            before: existingApproval ? {
              decision: existingApproval.decision,
              reason: existingApproval.reason,
              updatedAt: existingApproval.updatedAt.toISOString(),
            } : undefined,
            after: {
              decision: bodyResult.data.decision,
              reason: bodyResult.data.reason ?? null,
            },
            reason: bodyResult.data.reason ?? undefined,
            metadata: {
              operation: 'promotion_approval',
            },
          },
          executor: tx,
        });
      });
      deps.incrementGovernanceAuditWritesMetric('success');

      const summary = await deps.getPromotionApprovalSummary({
        tenantId: tenantResolution.tenantId,
        fineTuningJobId: fineTuningJob.id,
        requesterUserId: approverUserId,
      });

      return res.json({
        success: true,
        ...summary,
      });
    } catch (error) {
      deps.incrementGovernanceAuditWritesMetric('error');
      logger.error({ error, jobId: req.params.id }, 'Falha ao registrar aprovacao de promocao');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    } finally {
      if (redis && lockHandle) {
        await releaseTrainingOperationLock({ redis, handle: lockHandle }).catch((lockError) => {
          logger.warn(
            { lockKey: lockHandle?.key, error: lockError instanceof Error ? lockError.message : String(lockError) },
            'Falha ao liberar lock de aprovacao de promocao',
          );
        });
      }
    }
  });

  logger.info('Training job promotion approval routes registered');
}
