import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, eq, getDatabase, schema } from '@alice/database';
import { requirePermission } from '@alice/shared-utils';
import { z } from 'zod';

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

interface RegisterTrainingDataReviewRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  resolveAuthorizedTenantId: ResolveAuthorizedTenantIdFn;
  incrementReviewMetric: (status: 'approved' | 'rejected', count: number) => void;
}

const batchApproveSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  action: z.enum(['approve', 'reject']),
  reviewNotes: z.string().max(2000).optional(),
});

export function registerTrainingDataReviewRoutes(
  app: Express,
  deps: RegisterTrainingDataReviewRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('training-service');

  app.post('/api/training/data/approve-batch', requirePermission('training:training_data:manage'), async (req: Request, res: Response) => {
    const parseResult = batchApproveSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Input invalido' });
    }

    const { ids, action, reviewNotes } = parseResult.data;
    const tenantResolution = deps.resolveAuthorizedTenantId(req);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    const reviewedBy = tenantResolution.authContext.userId;
    const db = getDatabase();

    try {
      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      let updatedCount = 0;
      let skippedByQuarantine = 0;
      let skippedByMissingNamespace = 0;
      let skippedByTenantMismatch = 0;

      for (const id of ids) {
        const current = await db.query.trainingData.findFirst({
          where: eq(schema.trainingData.id, id),
          columns: { tenantId: true, needsHumanReview: true, namespaceId: true },
        });
        if (!current) {
          continue;
        }
        if (current.tenantId !== tenantResolution.tenantId) {
          skippedByTenantMismatch += 1;
          continue;
        }

        if (newStatus === 'approved' && current.needsHumanReview) {
          skippedByQuarantine += 1;
          continue;
        }
        if (newStatus === 'approved' && !current.namespaceId) {
          skippedByMissingNamespace += 1;
          continue;
        }

        const reviewedAt = new Date();
        const [updated] = await db.update(schema.trainingData)
          .set({
            status: newStatus,
            processadoEm: reviewedAt,
            processedAt: reviewedAt,
            reviewedBy,
            reviewedAt,
            reviewNotes: reviewNotes ?? null,
            needsHumanReview: false,
            quarantineReason: null,
            quarantinedAt: null,
          })
          .where(and(
            eq(schema.trainingData.id, id),
            eq(schema.trainingData.tenantId, tenantResolution.tenantId),
          ))
          .returning();

        if (updated) updatedCount++;
      }

      if (updatedCount > 0) {
        deps.incrementReviewMetric(newStatus, updatedCount);
      }

      logger.info(
        { action, count: updatedCount, skippedByQuarantine, skippedByMissingNamespace, skippedByTenantMismatch },
        'Aprovacao em lote concluida',
      );
      return res.json({ success: true, updated: updatedCount, skippedByQuarantine, skippedByMissingNamespace, skippedByTenantMismatch });
    } catch (error) {
      logger.error({ error }, 'Falha na aprovacao em lote');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  logger.info('Training data review routes registered');
}
