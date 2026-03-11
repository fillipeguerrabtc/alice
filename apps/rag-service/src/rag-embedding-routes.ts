import type { Express, Request, Response } from 'express';
import { requireAuth, type AuthContext } from '@alice/shared-utils';
import type { Logger } from 'pino';
import {
  enqueueEmbeddingJob,
  getEmbeddingJobStatus,
  getEmbeddingQueueStats,
  isQueueAvailable,
  type EmbeddingJobType,
} from './embedding-queue.js';
import { getEmbeddingWorkerStatus } from './workers/embedding-worker.js';
import { getWebSocketStats } from './embedding-websocket.js';
import { getVisionCircuitBreakerStatus } from './image-processor.js';

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

interface RegisterRagEmbeddingRoutesParams {
  app: Express;
  logger: Logger;
}

export function registerRagEmbeddingRoutes(params: RegisterRagEmbeddingRoutesParams): void {
  const { app, logger } = params;

  app.get('/api/rag/circuit-breaker/embeddings', (_req: Request, res: Response) => {
    const visionStatus = getVisionCircuitBreakerStatus();

    res.json({
      service: 'openai',
      timestamp: new Date().toISOString(),
      circuitBreakers: {
        vision: visionStatus,
      },
    });
  });

  app.post('/api/rag/embeddings/queue',
    requireAuth(),
    async (req: Request, res: Response) => {
      try {
        const { tenantId } = getAuthUser(req);

        if (!tenantId) {
          return res.status(401).json({ error: 'Tenant não identificado' });
        }

        if (!isQueueAvailable()) {
          return res.status(503).json({
            error: 'Fila de embeddings não disponível',
            detail: 'Redis não está conectado',
          });
        }

        const body = req.body as {
          type: EmbeddingJobType;
          text?: string;
          texts?: string[];
          priority?: number;
          metadata?: {
            source?: string;
            correlationId?: string;
            originalFilename?: string;
          };
        };

        if (!body.type) {
          return res.status(400).json({ error: 'Campo "type" é obrigatório' });
        }

        if (body.type === 'text' && !body.text) {
          return res.status(400).json({ error: 'Campo "text" é obrigatório para este tipo' });
        }

        if (body.type === 'batch-text' && (!body.texts || body.texts.length === 0)) {
          return res.status(400).json({ error: 'Campo "texts" é obrigatório para batch de texto' });
        }

        const jobId = await enqueueEmbeddingJob({
          type: body.type,
          tenantId,
          userId: getAuthUser(req).userId,
          priority: body.priority ?? 5,
          input: {
            text: body.text,
            texts: body.texts,
          },
          metadata: body.metadata,
        });

        logger.info({
          jobId,
          type: body.type,
          tenantId,
          gpuAvailable: true,
        }, 'Job de embedding enfileirado');

        res.status(202).json({
          jobId,
          status: 'pending',
          message: 'Job enfileirado para processamento',
          gpuStatus: {
            available: true,
            dedicatedServer: true,
            estimatedWaitMs: 1000,
          },
          statusUrl: `/api/rag/embeddings/queue/${jobId}`,
        });
      } catch (error) {
        logger.error({ error }, 'Erro ao enfileirar job de embedding');
        res.status(500).json({ error: 'Erro interno do servidor' });
      }
    }
  );

  app.get('/api/rag/embeddings/queue/stats',
    requireAuth(),
    async (_req: Request, res: Response) => {
      try {
        const queueStats = await getEmbeddingQueueStats();
        const workerStatus = await getEmbeddingWorkerStatus();
        const wsStats = getWebSocketStats();

        res.json({
          queue: queueStats,
          worker: workerStatus,
          websocket: wsStats,
          gpuDedicated: true,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ error }, 'Erro ao obter estatísticas da fila');
        res.status(500).json({ error: 'Erro interno do servidor' });
      }
    }
  );

  app.get('/api/rag/embeddings/queue/:jobId',
    requireAuth(),
    async (req: Request, res: Response) => {
      try {
        const { tenantId } = getAuthUser(req);
        const { jobId } = req.params;

        if (!tenantId) {
          return res.status(401).json({ error: 'Tenant não identificado' });
        }

        const job = await getEmbeddingJobStatus(jobId);

        if (!job) {
          return res.status(404).json({ error: 'Job não encontrado' });
        }

        if (job.tenantId !== tenantId) {
          return res.status(403).json({ error: 'Acesso negado a este job' });
        }

        res.json({
          jobId: job.id,
          type: job.type,
          status: job.status,
          createdAt: job.createdAt,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          error: job.error,
          result: job.status === 'completed' ? job.result : undefined,
          metadata: job.metadata,
        });
      } catch (error) {
        logger.error({ error }, 'Erro ao consultar job de embedding');
        res.status(500).json({ error: 'Erro interno do servidor' });
      }
    }
  );
}
