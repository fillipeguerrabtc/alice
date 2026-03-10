import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, desc, eq, getDatabase, or, schema } from '@alice/database';
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

interface RegisterTrainingRunManagementRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  resolveAuthorizedTenantId: ResolveAuthorizedTenantIdFn;
  cancelFineTuningJobAndLora: (params: {
    fineTuningJob: typeof schema.fineTuningJobs.$inferSelect;
    tenantId: string;
    reason: string;
  }) => Promise<unknown>;
  toTrainingHttpErrorResponse: (error: unknown) => TrainingHttpErrorResponse | null;
}

const runStatusQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

const runHistoryQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const cancelTrainingSchema = z.object({
  trainingRunId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export function registerTrainingRunManagementRoutes(
  app: Express,
  deps: RegisterTrainingRunManagementRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('training-service');

  app.get('/api/training/run/status', requirePermission('training:training_data:read'), async (req: Request, res: Response) => {
    const queryResult = runStatusQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({ error: 'Parametros invalidos' });
    }

    try {
      const tenantResolution = deps.resolveAuthorizedTenantId(req, queryResult.data.tenantId);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }
      const db = getDatabase();

      const runningJobs = await db.query.fineTuningJobs.findMany({
        where: and(
          eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId),
          or(
            eq(schema.fineTuningJobs.status, 'training'),
            eq(schema.fineTuningJobs.status, 'preparing'),
          ),
        ),
        orderBy: [desc(schema.fineTuningJobs.iniciadoEm)],
        limit: 5,
      });

      if (runningJobs.length === 0) {
        return res.json({
          hasRunningTraining: false,
          status: 'idle',
          message: 'Nenhum treinamento em andamento',
        });
      }

      const currentJob = runningJobs[0];
      const elapsedMs = currentJob.iniciadoEm
        ? Date.now() - new Date(currentJob.iniciadoEm).getTime()
        : 0;

      return res.json({
        hasRunningTraining: true,
        status: 'training',
        currentJob: {
          id: currentJob.id,
          name: currentJob.name,
          baseModel: currentJob.baseModel,
          trainingDataCount: currentJob.trainingDataCount,
          progress: currentJob.progress || 0,
          elapsedSeconds: Math.round(elapsedMs / 1000),
          startedAt: currentJob.iniciadoEm,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter status do treinamento');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.get('/api/training/run/history', requirePermission('training:training_data:read'), async (req: Request, res: Response) => {
    const queryResult = runHistoryQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({ error: 'Parametros invalidos' });
    }

    try {
      const tenantResolution = deps.resolveAuthorizedTenantId(req, queryResult.data.tenantId);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }
      const db = getDatabase();

      const jobs = await db.query.fineTuningJobs.findMany({
        where: eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId),
        orderBy: [desc(schema.fineTuningJobs.criadoEm)],
        limit: queryResult.data.limit,
      });

      const history = jobs.map((job) => ({
        id: job.id,
        jobType: job.name,
        status: job.status,
        totalRecords: job.trainingDataCount,
        processedRecords: job.progress ? Math.round((job.progress / 100) * (job.trainingDataCount ?? 0)) : 0,
        description: job.name,
        startedAt: job.iniciadoEm,
        completedAt: job.completadoEm,
        durationSeconds: job.iniciadoEm && job.completadoEm
          ? Math.round((new Date(job.completadoEm).getTime() - new Date(job.iniciadoEm).getTime()) / 1000)
          : null,
        errorMessage: job.errorMessage,
      }));

      return res.json({
        total: history.length,
        history,
      });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter historico de treinamentos');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.delete('/api/training/run/cancel', requirePermission('training:training_data:manage'), async (req: Request, res: Response) => {
    const parseResult = cancelTrainingSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Input invalido', details: parseResult.error.format() });
    }

    const { trainingRunId, reason } = parseResult.data;

    try {
      const tenantResolution = deps.resolveAuthorizedTenantId(req);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }
      const db = getDatabase();

      const job = await db.query.fineTuningJobs.findFirst({
        where: and(
          eq(schema.fineTuningJobs.id, trainingRunId),
          eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId),
        ),
      });

      if (!job) {
        return res.status(404).json({ error: 'Treinamento nao encontrado' });
      }

      if (job.status !== 'training' && job.status !== 'pending' && job.status !== 'preparing') {
        return res.status(400).json({
          error: 'Treinamento nao pode ser cancelado',
          currentStatus: job.status,
        });
      }

      await deps.cancelFineTuningJobAndLora({
        fineTuningJob: job,
        tenantId: tenantResolution.tenantId,
        reason: reason || 'Cancelado pelo usuario',
      });

      logger.info({ trainingRunId, reason }, 'Treinamento cancelado');

      return res.json({
        success: true,
        trainingRunId,
        previousStatus: job.status,
        newStatus: 'cancelled',
      });
    } catch (error) {
      const trainingHttpError = deps.toTrainingHttpErrorResponse(error);
      if (trainingHttpError) {
        return res.status(trainingHttpError.status).json(trainingHttpError.payload);
      }
      logger.error({ error }, 'Falha ao cancelar treinamento');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  logger.info('Training run management routes registered');
}
