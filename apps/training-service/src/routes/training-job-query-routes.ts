import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, asc, desc, eq, getDatabase, inArray, schema } from '@alice/database';
import { requirePermission, verifyImmutableAuditChain } from '@alice/shared-utils';
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

type FineTuningJobRow = typeof schema.fineTuningJobs.$inferSelect;

interface RegisterTrainingJobQueryRoutesDeps {
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
  buildFineTuningJobStreamFingerprint: (job: FineTuningJobRow) => string;
  isActiveFineTuningJobStatus: (status: FineTuningJobRow['status']) => boolean;
  trainingJobStreamPollIntervalMs: number;
  trainingJobStreamHeartbeatMs: number;
  trainingGovernanceAuditActions: readonly string[];
}

const uuidParamSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID valido'),
});

const jobsQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

export function registerTrainingJobQueryRoutes(
  app: Express,
  deps: RegisterTrainingJobQueryRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('training-service');

  app.get('/api/training/jobs', requirePermission('training:fine_tuning_jobs:read'), async (req: Request, res: Response) => {
    const queryResult = jobsQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({ error: 'Parametros invalidos', details: queryResult.error.format() });
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
        limit: 50,
      });

      return res.json({ jobs });
    } catch (error) {
      logger.error({ error }, 'Falha ao buscar jobs');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.get('/api/training/jobs/:id', requirePermission('training:fine_tuning_jobs:read'), async (req: Request, res: Response) => {
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

      return res.json({ job });
    } catch (error) {
      logger.error({ error }, 'Falha ao buscar job');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.get('/api/training/jobs/:id/stream', requirePermission('training:fine_tuning_jobs:read'), async (req: Request, res: Response) => {
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

      const loadJob = async (): Promise<FineTuningJobRow | null> => {
        const job = await db.query.fineTuningJobs.findFirst({
          where: and(
            eq(schema.fineTuningJobs.id, paramsResult.data.id),
            eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId),
          ),
        });
        return job ?? null;
      };

      const initialJob = await loadJob();
      if (!initialJob) {
        return res.status(404).json({ error: 'Job de fine-tuning nao encontrado' });
      }

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const flushSseChunk = () => {
        const flusher = (res as unknown as { flush?: () => void }).flush;
        if (typeof flusher === 'function') flusher();
      };

      const writeSseEvent = (event: string, payload: unknown): boolean => {
        if (res.writableEnded) return false;
        try {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
          flushSseChunk();
          return true;
        } catch (writeError) {
          logger.warn(
            {
              jobId: paramsResult.data.id,
              error: writeError instanceof Error ? writeError.message : String(writeError),
            },
            'Falha ao escrever evento SSE de fine-tuning',
          );
          return false;
        }
      };

      let pollingInFlight = false;
      let closed = false;
      let lastFingerprint = deps.buildFineTuningJobStreamFingerprint(initialJob);
      let pollInterval: ReturnType<typeof setInterval> | null = null;
      let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

      const closeStream = (reason: string): void => {
        if (closed) return;
        closed = true;
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        if (!res.writableEnded) {
          res.end();
        }
        logger.debug({ jobId: paramsResult.data.id, reason }, 'Stream SSE de fine-tuning encerrado');
      };

      if (!writeSseEvent('job', { job: initialJob, sentAt: new Date().toISOString() })) {
        closeStream('initial_write_failed');
        return;
      }

      heartbeatInterval = setInterval(() => {
        if (closed || res.writableEnded) {
          closeStream('heartbeat_stream_not_writable');
          return;
        }
        try {
          res.write(':\n\n');
          flushSseChunk();
        } catch {
          closeStream('heartbeat_write_failed');
        }
      }, deps.trainingJobStreamHeartbeatMs);

      req.on('close', () => closeStream('request_closed'));
      res.on('close', () => closeStream('response_closed'));
      res.on('finish', () => closeStream('response_finished'));

      if (!deps.isActiveFineTuningJobStatus(initialJob.status)) {
        writeSseEvent('end', { reason: 'terminal_snapshot', status: initialJob.status });
        closeStream('initial_terminal_status');
        return;
      }

      pollInterval = setInterval(() => {
        void (async () => {
          if (closed || pollingInFlight) return;
          pollingInFlight = true;
          try {
            const nextJob = await loadJob();
            if (!nextJob) {
              writeSseEvent('error', { error: 'Job de fine-tuning nao encontrado durante streaming' });
              closeStream('job_missing_during_poll');
              return;
            }

            const nextFingerprint = deps.buildFineTuningJobStreamFingerprint(nextJob);
            if (nextFingerprint !== lastFingerprint) {
              lastFingerprint = nextFingerprint;
              if (!writeSseEvent('job', { job: nextJob, sentAt: new Date().toISOString() })) {
                closeStream('delta_write_failed');
                return;
              }
            }

            if (!deps.isActiveFineTuningJobStatus(nextJob.status)) {
              writeSseEvent('end', { reason: 'terminal_status', status: nextJob.status });
              closeStream('terminal_status_reached');
            }
          } catch (error) {
            logger.error(
              {
                jobId: paramsResult.data.id,
                error: error instanceof Error ? error.message : String(error),
              },
              'Falha ao consultar job no stream SSE de fine-tuning',
            );
            writeSseEvent('error', { error: 'Falha interna no stream de fine-tuning' });
            closeStream('poll_failed');
          } finally {
            pollingInFlight = false;
          }
        })();
      }, deps.trainingJobStreamPollIntervalMs);
    } catch (error) {
      logger.error(
        {
          jobId: paramsResult.data.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'Falha ao inicializar stream SSE do job de fine-tuning',
      );
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Erro interno do servidor' });
      }
      return res.end();
    }
  });

  app.get('/api/training/jobs/:id/promotion-approvals', requirePermission('training:fine_tuning_jobs:read'), async (req: Request, res: Response) => {
    const paramsResult = uuidParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return res.status(400).json({ error: 'ID invalido', details: paramsResult.error.format() });
    }

    try {
      const tenantResolution = deps.resolveAuthorizedTenantId(req);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }
      if (!tenantResolution.authContext.userId) {
        return res.status(403).json({ error: 'Usuario nao identificado para leitura de aprovacoes' });
      }
      const db = getDatabase();

      const fineTuningJob = await db.query.fineTuningJobs.findFirst({
        where: and(
          eq(schema.fineTuningJobs.id, paramsResult.data.id),
          eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId),
        ),
        columns: { id: true },
      });
      if (!fineTuningJob) {
        return res.status(404).json({ error: 'Job de fine-tuning nao encontrado' });
      }

      const summary = await deps.getPromotionApprovalSummary({
        tenantId: tenantResolution.tenantId,
        fineTuningJobId: fineTuningJob.id,
        requesterUserId: tenantResolution.authContext.userId,
      });
      return res.json(summary);
    } catch (error) {
      logger.error({ error, jobId: req.params.id }, 'Falha ao consultar aprovacoes de promocao');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.get('/api/training/jobs/:id/audit-trail', requirePermission('training:fine_tuning_jobs:read'), async (req: Request, res: Response) => {
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

      const fineTuningJob = await db.query.fineTuningJobs.findFirst({
        where: and(
          eq(schema.fineTuningJobs.id, paramsResult.data.id),
          eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId),
        ),
        columns: { id: true },
      });
      if (!fineTuningJob) {
        return res.status(404).json({ error: 'Job de fine-tuning nao encontrado' });
      }

      const events = await db.query.auditLogs.findMany({
        where: and(
          eq(schema.auditLogs.tenantId, tenantResolution.tenantId),
          eq(schema.auditLogs.recurso, 'fine_tuning_job'),
          eq(schema.auditLogs.recursoId, fineTuningJob.id),
          inArray(schema.auditLogs.acao, [...deps.trainingGovernanceAuditActions]),
        ),
        orderBy: [desc(schema.auditLogs.criadoEm)],
        limit: 100,
      });

      const userIds = Array.from(new Set(
        events
          .map((event) => event.userId)
          .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0),
      ));
      const users = userIds.length > 0
        ? await db.query.users.findMany({
          where: inArray(schema.users.id, userIds),
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        })
        : [];
      const usersById = new Map(users.map((user) => [user.id, user]));
      const immutableStreamKey = `fine_tuning_job:${fineTuningJob.id}`;

      const immutableEvents = await db.query.immutableAuditEvents.findMany({
        where: and(
          eq(schema.immutableAuditEvents.tenantId, tenantResolution.tenantId),
          eq(schema.immutableAuditEvents.stream, 'training_governance'),
          eq(schema.immutableAuditEvents.streamKey, immutableStreamKey),
        ),
        orderBy: [asc(schema.immutableAuditEvents.chainPosition)],
        limit: 500,
      });

      const immutableIntegrity = verifyImmutableAuditChain(
        immutableEvents.map((event) => ({
          chainPosition: event.chainPosition,
          prevEventHash: event.prevEventHash,
          eventHash: event.eventHash,
        })),
      );

      return res.json({
        events: events.map((event) => {
          const user = event.userId ? usersById.get(event.userId) : undefined;
          return {
            id: event.id,
            action: event.acao,
            resourceId: event.recursoId,
            details: event.detalhes,
            ip: event.ip,
            userAgent: event.userAgent,
            createdAt: event.criadoEm,
            user: user ? {
              id: user.id,
              name: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email || user.id,
              email: user.email,
            } : null,
          };
        }),
        immutableAudit: {
          stream: 'training_governance',
          streamKey: immutableStreamKey,
          integrity: immutableIntegrity,
          events: immutableEvents.map((event) => ({
            id: event.id,
            chainPosition: event.chainPosition,
            eventType: event.eventType,
            resourceType: event.resourceType,
            resourceId: event.resourceId,
            payload: event.payload,
            prevEventHash: event.prevEventHash,
            eventHash: event.eventHash,
            occurredAt: event.occurredAt,
            createdAt: event.createdAt,
          })),
        },
      });
    } catch (error) {
      logger.error({ error, jobId: req.params.id }, 'Falha ao consultar trilha de auditoria de training');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  logger.info('Training job query routes registered');
}
