import type { Express, Request, Response } from 'express';
import { withTenantContext } from '@alice/database';
import { requireAuth, requireSameTenant, type AuthContext, type AliceMetrics } from '@alice/shared-utils';
import type { Logger } from 'pino';
import { z } from 'zod';
import {
  createLearningTask,
  dequeueNextLearningTask,
  updateLearningTaskStatus,
} from './learning-orchestrator.js';

type AuthUser = Partial<Pick<AuthContext, 'userId' | 'role' | 'tenantId' | 'customRoleId'>>;

function getAuthUser(req: Request): AuthUser {
  const typed = req as Request & { user?: AuthContext };
  const user = typed.user;
  if (!user) return {};
  return {
    userId: user.userId,
    role: user.role,
    tenantId: user.tenantId,
    customRoleId: user.customRoleId ?? undefined,
  };
}

const getTenantIdFromRequest = (req: Request): string | undefined => req.tenantId;

const learningTaskCreateSchema = z.object({
  tipo: z.string().min(1),
  prioridade: z.number().int().min(1).max(10).optional(),
  agentId: z.string().uuid().optional().nullable(),
  namespaceId: z.string().uuid().optional().nullable(),
  parametros: z.record(z.string(), z.unknown()).optional(),
  maxTentativas: z.number().int().min(1).max(10).optional(),
  agendadoPara: z.string().datetime().optional(),
});

const learningTaskStatusSchema = z.object({
  status: z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled']),
  progresso: z.number().int().min(0).max(100).optional(),
  erro: z.string().optional().nullable(),
  resultado: z.record(z.string(), z.unknown()).optional().nullable(),
});

const learningTaskParamsSchema = z.object({
  id: z.string().uuid(),
});

interface RegisterRagLearningRoutesParams {
  app: Express;
  logger: Logger;
  metrics: AliceMetrics;
}

export function registerRagLearningRoutes(params: RegisterRagLearningRoutesParams): void {
  const { app, logger, metrics } = params;

  app.post('/api/learning/tasks', requireAuth(), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Autenticação necessária' });

    const user = getAuthUser(req);
    const isSuperAdmin = user.role === 'super_admin';

    try {
      const body = learningTaskCreateSchema.parse(req.body);

      const task = await withTenantContext(tenantId, isSuperAdmin, (tenantDb) =>
        createLearningTask(tenantDb, logger, {
          tenantId,
          tipo: body.tipo,
          prioridade: body.prioridade,
          agentId: body.agentId ?? null,
          namespaceId: body.namespaceId ?? null,
          parametros: body.parametros,
          maxTentativas: body.maxTentativas,
          agendadoPara: body.agendadoPara ? new Date(body.agendadoPara) : null,
          criadoPor: user.userId ?? null,
        })
      );

      res.status(201).json({ task });
    } catch (error) {
      logger.error({ error }, 'Falha ao criar learning task');
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/learning/tasks/dequeue', requireAuth(), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Autenticação necessária' });

    const user = getAuthUser(req);
    const isSuperAdmin = user.role === 'super_admin';

    try {
      const task = await withTenantContext(tenantId, isSuperAdmin, (tenantDb) =>
        dequeueNextLearningTask(tenantDb, logger, tenantId)
      );

      res.json({ task });
    } catch (error) {
      logger.error({ error }, 'Falha ao dequeuer learning task');
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.post('/api/learning/tasks/:id/status', requireAuth(), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Autenticação necessária' });

    const user = getAuthUser(req);
    const isSuperAdmin = user.role === 'super_admin';

    try {
      const body = learningTaskStatusSchema.parse(req.body);
      const { id: taskId } = learningTaskParamsSchema.parse(req.params);

      await withTenantContext(tenantId, isSuperAdmin, (tenantDb) =>
        updateLearningTaskStatus(tenantDb, logger, {
          taskId,
          tenantId,
          status: body.status,
          progresso: body.progresso,
          erro: body.erro ?? null,
          resultado: body.resultado ?? null,
        })
      );

      if (body.status === 'completed') {
        metrics.training.completedJobsTotal.inc();
      } else if (body.status === 'failed') {
        metrics.training.failedJobsTotal.inc();
      }

      res.json({ ok: true });
    } catch (error) {
      logger.error({ error }, 'Falha ao atualizar status de learning task');
      res.status(400).json({ error: (error as Error).message });
    }
  });
}
