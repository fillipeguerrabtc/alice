import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, eq, getDatabase, schema } from '@alice/database';
import { requirePermission } from '@alice/shared-utils';
import { z } from 'zod';

interface TenantResolutionSuccess {
  ok: true;
  tenantId: string;
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

type TrainingHttpErrorResponse = {
  status: number;
  payload: unknown;
};

interface RegisterTrainingJobCancelRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  resolveAuthorizedTenantId: ResolveAuthorizedTenantIdFn;
  cancelFineTuningJobAndLora: (params: {
    fineTuningJob: typeof schema.fineTuningJobs.$inferSelect;
    tenantId: string;
    reason: string;
  }) => Promise<unknown>;
  toTrainingHttpErrorResponse: (error: unknown) => TrainingHttpErrorResponse | null;
}

const uuidParamSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID valido'),
});

export function registerTrainingJobCancelRoutes(
  app: Express,
  deps: RegisterTrainingJobCancelRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('training-service');

  app.delete('/api/training/jobs/:id', requirePermission('training:fine_tuning_jobs:cancel'), async (req: Request, res: Response) => {
    const paramsResult = uuidParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return res.status(400).json({ error: 'ID invalido', details: paramsResult.error.format() });
    }

    try {
      const tenantResolution = deps.resolveAuthorizedTenantId(req);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }
      const db = getDatabase();

      const job = await db.query.fineTuningJobs.findFirst({
        where: and(
          eq(schema.fineTuningJobs.id, paramsResult.data.id),
          eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId),
        ),
      });

      if (!job) {
        return res.status(404).json({ error: 'Job nao encontrado' });
      }

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        return res.status(400).json({ error: 'Job ja finalizado ou cancelado' });
      }

      const updated = await deps.cancelFineTuningJobAndLora({
        fineTuningJob: job,
        tenantId: tenantResolution.tenantId,
        reason: 'Cancelado via endpoint /api/training/jobs/:id',
      });

      logger.info({ jobId: paramsResult.data.id }, 'Job de fine-tuning cancelado');
      return res.json({ job: updated });
    } catch (error) {
      const trainingHttpError = deps.toTrainingHttpErrorResponse(error);
      if (trainingHttpError) {
        return res.status(trainingHttpError.status).json(trainingHttpError.payload);
      }
      logger.error({ error }, 'Falha ao cancelar job');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  logger.info('Training job cancel routes registered');
}
