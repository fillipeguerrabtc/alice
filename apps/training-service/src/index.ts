/**
 * Training Service - Alice Enterprise Platform
 * 
 * Serviço de treinamento e fine-tuning com deduplicação semântica (SemHash).
 * Implementa Circuit Breaker pattern (Regra 16 - Best Practices 2025).
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import CircuitBreaker from 'opossum';
import { createLogger, runWithLogContext } from '@alice/logger';
import { getDatabase, schema, setupGracefulShutdown, createDrizzleFeatureFlagStorage } from '@alice/database';
import { 
  createCorrelationMiddleware, 
  getContextHeaders,
  createSecurityMiddleware,
  createRateLimiter,
  createErrorHandler,
  createNotFoundHandler,
  asyncHandler,
  initFeatureFlags,
  featureFlagsMiddleware,
  FEATURE_FLAGS,
  isFeatureEnabled,
  createAlicePrometheus,
  instrumentCircuitBreaker,
  createCircuitBreaker,
  CIRCUIT_BREAKER_PRESETS,
} from '@alice/shared-utils';
import { eq, and, desc, sql, isNull, not } from 'drizzle-orm';
import { z } from 'zod';
import { 
  requirePermission, 
  requireAuth,
  requireSameTenant,
  extractAuthContext,
} from '@alice/shared-utils';
import { 
  createFineTuningJob as createSaladJob,
  getJobStatus as getSaladJobStatus,
  cancelJob as cancelSaladJob,
  mapContainerStatusToJobStatus,
  generateTrainingJSONL,
  getSaladBreakerStats,
  verificarDisponibilidadeSalad,
} from './salad-client.js';

// Logger centralizado: JSON em produção, pino-pretty em desenvolvimento
const logger = createLogger('training-service');

// Configurar graceful shutdown do pool centralizado (Regra 16 - Best Practices 2025)
setupGracefulShutdown(logger);

const PORT = parseInt(process.env.PORT || '3004', 10);
const DATABASE_URL = process.env.DATABASE_URL;
const SALAD_API_KEY = process.env.SALAD_API_KEY;
const SALAD_ORGANIZATION_ID = process.env.SALAD_ORGANIZATION_ID;
const SALAD_API_URL = process.env.SALAD_API_URL || 'https://api.salad.com/api/public';
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',') || [];

if (!DATABASE_URL) {
  logger.error('DATABASE_URL não configurada');
  process.exit(1);
}

if (!SALAD_API_KEY) {
  logger.error('SALAD_API_KEY não configurada - serviço requer API key para funcionar');
  process.exit(1);
}

if (!SALAD_ORGANIZATION_ID) {
  logger.error('SALAD_ORGANIZATION_ID não configurada');
  process.exit(1);
}

const SALAD_KEY: string = SALAD_API_KEY;
const SALAD_ORG: string = SALAD_ORGANIZATION_ID;

// Usar package @alice/database centralizado (node-postgres para produção Hetzner)
const db = getDatabase();

// Inicializar sistema de feature flags com storage PostgreSQL (Regra 16 - Enterprise)
const featureFlagStorage = createDrizzleFeatureFlagStorage();
initFeatureFlags(featureFlagStorage);
logger.info('Sistema de feature flags inicializado');

const app = express();

// ============================================================================
// PROMETHEUS: Instrumentação de métricas (Regra 16 - Observability Enterprise)
// ============================================================================
const { metrics, metricsRouter, httpMetricsMiddleware } = createAlicePrometheus({
  serviceName: 'training-service',
  collectDefaultMetrics: true,
});

// Endpoint /metrics para Prometheus scraper (antes de outros middlewares)
app.use(metricsRouter);

// Middleware para coletar métricas HTTP automaticamente
app.use(httpMetricsMiddleware);

// SEGURANÇA: Desabilitar X-Powered-By header (Express.js 2025 + OWASP API8)
app.disable('x-powered-by');

// SEGURANÇA: Trust proxy = 1 para confiar apenas no primeiro proxy (Traefik)
// Evita bypass de rate limiting (express-rate-limit 2025 best practice)
app.set('trust proxy', 1);

// ============================================================================
// CIRCUIT BREAKER - Salad Cloud Embeddings API (Regra 16 - Best Practices 2025)
// ============================================================================

// Usa CIRCUIT_BREAKER_PRESETS centralizado (Regra 2 - Não Duplicar)

interface EmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

// RESILIÊNCIA: Timeout para chamadas externas (Best Practices 2025)
const EXTERNAL_API_TIMEOUT_MS = 25000;

async function generateEmbeddingInternal(text: string): Promise<number[]> {
  // RESILIÊNCIA: AbortController com timeout para evitar chamadas penduradas
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);
  
  try {
    const response = await fetch(`${SALAD_API_URL}/organizations/${SALAD_ORG}/inference-endpoints/text-embedding/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Salad-Api-Key': SALAD_KEY,
      },
      body: JSON.stringify({
        input: text.slice(0, 2000),
        model: 'text-embedding-3-small',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Falha ao gerar embedding: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as EmbeddingResponse;
    const resultEmbedding = data.data[0]?.embedding;
    
    if (!resultEmbedding || resultEmbedding.length === 0) {
      throw new Error('API de embeddings retornou resultado vazio');
    }
    
    return resultEmbedding;
  } finally {
    clearTimeout(timeoutId);
  }
}

const embeddingsBreaker = createCircuitBreaker(generateEmbeddingInternal, {
  name: 'training-embeddings',
  ...CIRCUIT_BREAKER_PRESETS.saladEmbeddings,
});

// Instrumentar circuit breaker com métricas Prometheus
// Type assertion necessária: Opossum CircuitBreaker tem tipos de eventos mais específicos
instrumentCircuitBreaker(metrics, 'salad-embeddings', embeddingsBreaker as unknown as Parameters<typeof instrumentCircuitBreaker>[2]);

async function generateEmbedding(text: string): Promise<number[]> {
  try {
    return await embeddingsBreaker.fire(text) as number[];
  } catch (error) {
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      logger.warn('Circuit breaker aberto - Embeddings temporariamente indisponível');
      throw new Error('Serviço de embeddings temporariamente indisponível. Tente novamente em alguns segundos.');
    }
    throw error;
  }
}

// SEGURANÇA: Helmet com CSP/HSTS enterprise (Express.js 2025 + OWASP 2023)
app.use(createSecurityMiddleware({
  contentSecurityPolicy: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV !== 'production',
}));

// OBSERVABILITY: Correlation ID middleware para rastreamento distribuído (Node.js 20 LTS 2025)
// Propaga correlation IDs entre microsserviços e injeta nos logs automaticamente
app.use(createCorrelationMiddleware({ serviceName: 'training-service' }));

// PERFORMANCE: Compression para reduzir tamanho de respostas (Express.js 2025)
app.use(compression());

app.use(cors({
  origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : false,
  credentials: CORS_ORIGINS.length > 0,
}));

// SEGURANÇA: Rate limiting multi-tenant (express-rate-limit 2025)
app.use(createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  skipRoutes: ['/api/training/health', '/api/training/stats'],
  serviceName: 'training-service',
}));

// SEGURANÇA: Limites de payload para prevenir DoS (OWASP API4)
app.use(express.json({ limit: '10mb' }));

const SIMILARITY_THRESHOLD = 0.85;
const EMBEDDING_DIMENSIONS = 1536;
const JOB_POLLING_INTERVAL_MS = 30000;

function computeSemHash(text: string): string {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 64);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  
  return dotProduct / denominator;
}

app.get('/api/training/health', async (_req: Request, res: Response) => {
  const embeddingsCircuitState = embeddingsBreaker.opened ? 'open' : (embeddingsBreaker.halfOpen ? 'half-open' : 'closed');
  const saladStats = getSaladBreakerStats();
  const saladAvailable = await verificarDisponibilidadeSalad();
  
  const overallStatus = embeddingsCircuitState === 'open' ? 'degraded' : 'ok';
  
  res.json({ 
    status: overallStatus, 
    service: 'training-service', 
    timestamp: new Date().toISOString(),
    embeddingsProvider: 'salad-cloud',
    model: 'text-embedding-3-small',
    saladCloudAvailable: saladAvailable,
    circuitBreakers: {
      embeddings: {
        state: embeddingsCircuitState,
        stats: {
          failures: embeddingsBreaker.stats.failures,
          successes: embeddingsBreaker.stats.successes,
          timeouts: embeddingsBreaker.stats.timeouts,
        },
      },
      saladContainerGroups: saladStats,
    },
  });
});

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1, 'Conteúdo da mensagem é obrigatório'),
});

const collectTrainingDataSchema = z.object({
  tenantId: z.string().uuid('Tenant ID deve ser UUID válido'),
  namespaceId: z.string().uuid('Namespace ID deve ser UUID válido'),
  conversationId: z.string().uuid('Conversation ID deve ser UUID válido').optional(),
  source: z.string().min(1, 'Fonte é obrigatória'),
  messages: z.array(messageSchema).min(1, 'Pelo menos uma mensagem é obrigatória'),
  rating: z.number().min(1).max(5).optional(),
});

app.post('/api/training/data', requirePermission('training:training_data:write'), async (req: Request, res: Response) => {
  try {
    const body = collectTrainingDataSchema.parse(req.body);

    const messagesText = body.messages.map(m => m.content).join('\n');
    const semhash = computeSemHash(messagesText);
    const embedding = await generateEmbedding(messagesText);

    const existingData = await db.query.trainingData.findMany({
      where: and(
        eq(schema.trainingData.status, 'pending'),
        not(isNull(schema.trainingData.embedding))
      ),
    });

    let isDuplicate = false;
    let duplicateOfId: string | undefined;
    let highestSimilarity = 0;

    for (const existing of existingData) {
      if (existing.semhash === semhash) {
        isDuplicate = true;
        duplicateOfId = existing.id;
        highestSimilarity = 1.0;
        break;
      }

      if (existing.embedding) {
        const similarity = cosineSimilarity(embedding, existing.embedding);
        if (similarity > SIMILARITY_THRESHOLD && similarity > highestSimilarity) {
          isDuplicate = true;
          duplicateOfId = existing.id;
          highestSimilarity = similarity;
        }
      }
    }

    const [trainingData] = await db.insert(schema.trainingData).values({
      tenantId: body.tenantId,
      namespaceId: body.namespaceId,
      conversationId: body.conversationId,
      source: body.source,
      messages: body.messages,
      rating: body.rating,
      semhash,
      embedding,
      isDuplicate,
      duplicateOfId,
      similarityScore: highestSimilarity > 0 ? highestSimilarity : null,
      status: isDuplicate ? 'rejected' : 'pending',
    }).returning();

    logger.info({ 
      trainingDataId: trainingData.id, 
      isDuplicate, 
      similarity: highestSimilarity 
    }, 'Dados de treinamento coletados');

    res.json({ 
      trainingData, 
      isDuplicate,
      duplicateOfId,
      similarityScore: highestSimilarity,
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao coletar dados de treinamento');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/training/data', requirePermission('training:training_data:read'), async (req: Request, res: Response) => {
  // OWASP API3: Validação de query params
  const queryResult = trainingDataQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }
  const { status, namespaceId } = queryResult.data;

  try {
    const conditions = [];
    if (status) conditions.push(eq(schema.trainingData.status, status as 'pending' | 'approved' | 'rejected' | 'used'));
    if (namespaceId) conditions.push(eq(schema.trainingData.namespaceId, namespaceId));

    const trainingData = await db.query.trainingData.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [desc(schema.trainingData.criadoEm)],
      limit: 100,
    });

    res.json({ trainingData });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar dados de treinamento');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// OWASP API3 - Schema para validação de parâmetros de rota (UUID)
const uuidParamSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
});

// OWASP API3 - Schema para validação de status
const statusUpdateSchema = z.object({
  status: z.enum(['approved', 'rejected']),
});

app.patch('/api/training/data/:id/status', requirePermission('training:training_data:manage'), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  
  // OWASP API3: Validação de body
  const bodyResult = statusUpdateSchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({ error: 'Status inválido', details: bodyResult.error.format() });
  }
  const { status } = bodyResult.data;

  try {
    const [updated] = await db.update(schema.trainingData)
      .set({ 
        status: status as 'approved' | 'rejected',
        processadoEm: new Date(),
      })
      .where(eq(schema.trainingData.id, id))
      .returning();

    logger.info({ trainingDataId: id, status }, 'Status de treinamento atualizado');
    res.json({ trainingData: updated });
  } catch (error) {
    logger.error({ error }, 'Falha ao atualizar status de treinamento');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/training/jobs', requirePermission('training:fine_tuning_jobs:read'), async (req: Request, res: Response) => {
  // OWASP API3: Validação de query params
  const queryResult = jobsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }
  const { tenantId } = queryResult.data;

  try {
    const jobs = await db.query.fineTuningJobs.findMany({
      where: tenantId ? eq(schema.fineTuningJobs.tenantId, tenantId) : undefined,
      orderBy: [desc(schema.fineTuningJobs.criadoEm)],
      limit: 50,
    });

    res.json({ jobs });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar jobs');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

const createJobSchema = z.object({
  tenantId: z.string().uuid().optional(),
  name: z.string().min(1),
  baseModel: z.string().default('llama4-maverick'),
  hyperparameters: z.object({
    epochs: z.number().default(3),
    learningRate: z.number().default(0.0001),
    batchSize: z.number().default(4),
  }).optional(),
});

app.post('/api/training/jobs', requirePermission('training:fine_tuning_jobs:start'), async (req: Request, res: Response) => {
  try {
    const body = createJobSchema.parse(req.body);

    const approvedData = await db.query.trainingData.findMany({
      where: and(
        eq(schema.trainingData.status, 'approved'),
        body.tenantId ? eq(schema.trainingData.tenantId, body.tenantId) : undefined,
      ),
    });

    if (approvedData.length < 10) {
      return res.status(400).json({ 
        error: 'Dados de treinamento insuficientes',
        required: 10,
        available: approvedData.length,
      });
    }

    const [job] = await db.insert(schema.fineTuningJobs).values({
      tenantId: body.tenantId,
      name: body.name,
      baseModel: body.baseModel,
      status: 'pending',
      trainingDataCount: approvedData.length,
      hyperparameters: body.hyperparameters || {
        epochs: 3,
        learningRate: 0.0001,
        batchSize: 4,
      },
    }).returning();

    for (const data of approvedData) {
      await db.update(schema.trainingData)
        .set({ 
          status: 'used',
          usedInJobId: job.id,
        })
        .where(eq(schema.trainingData.id, data.id));
    }

    const jobHyperparameters = body.hyperparameters || {
      epochs: 3,
      learningRate: 0.0001,
      batchSize: 4,
    };
    
    startFineTuningJob(job.id, jobHyperparameters).catch(err => {
      logger.error({ error: err, jobId: job.id }, 'Job de fine-tuning falhou');
    });

    logger.info({ jobId: job.id, dataCount: approvedData.length }, 'Job de fine-tuning criado');
    res.json({ job });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar job');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

const activePollingJobs = new Map<string, NodeJS.Timeout>();

async function startFineTuningJob(jobId: string, hyperparameters: { epochs: number; learningRate: number; batchSize: number }): Promise<void> {
  logger.info({ jobId }, 'Iniciando job de fine-tuning na Salad Cloud');
  
  await db.update(schema.fineTuningJobs)
    .set({ 
      status: 'preparing',
      iniciadoEm: new Date(),
    })
    .where(eq(schema.fineTuningJobs.id, jobId));

  try {
    const job = await db.query.fineTuningJobs.findFirst({
      where: eq(schema.fineTuningJobs.id, jobId),
    });
    
    if (!job) {
      throw new Error('Job não encontrado');
    }

    const trainingData = await db.query.trainingData.findMany({
      where: eq(schema.trainingData.usedInJobId, jobId),
    });

    if (trainingData.length === 0) {
      throw new Error('Nenhum dado de treinamento associado ao job');
    }

    const jsonlData = generateTrainingJSONL(
      trainingData.map(d => ({
        messages: d.messages as Array<{ role: string; content: string }>,
      }))
    );

    const dataUrl = `s3://alice-training-data/${jobId}/training.jsonl`;
    const outputUrl = `s3://alice-training-output/${jobId}/`;

    logger.info({ jobId, dataCount: trainingData.length }, 'Criando Container Group na Salad Cloud');
    
    const saladResponse = await createSaladJob(jobId, {
      baseModel: job.baseModel,
      dataUrl,
      outputUrl,
      hyperparameters,
    });

    await db.update(schema.fineTuningJobs)
      .set({ 
        status: 'training',
        progress: 0,
        containerGroupId: saladResponse.name,
      })
      .where(eq(schema.fineTuningJobs.id, jobId));

    logger.info({ 
      jobId, 
      containerGroupName: saladResponse.name,
      containerGroupId: saladResponse.id,
    }, 'Container Group criado - iniciando polling de status');

    startStatusPolling(jobId, saladResponse.name);

  } catch (error) {
    logger.error({ error, jobId }, 'Erro ao iniciar fine-tuning na Salad Cloud');
    
    await db.update(schema.fineTuningJobs)
      .set({ 
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Erro desconhecido',
      })
      .where(eq(schema.fineTuningJobs.id, jobId));
  }
}

function startStatusPolling(jobId: string, containerGroupName: string): void {
  const pollStatus = async () => {
    try {
      const status = await getSaladJobStatus(containerGroupName);
      const mappedStatus = mapContainerStatusToJobStatus(status.currentState.status);
      
      logger.debug({ 
        jobId, 
        containerStatus: status.currentState.status,
        mappedStatus,
      }, 'Status do job atualizado');

      const updateData: Record<string, unknown> = { status: mappedStatus };
      
      if (status.currentState.instanceStatusCounts) {
        const running = status.currentState.instanceStatusCounts.running || 0;
        const total = Object.values(status.currentState.instanceStatusCounts).reduce((a, b) => a + b, 0);
        if (total > 0) {
          updateData.progress = Math.round((running / total) * 100);
        }
      }

      if (mappedStatus === 'completed') {
        updateData.completadoEm = new Date();
        updateData.resultModel = `llama4-maverick-ft-${jobId.slice(0, 8)}`;
        updateData.metrics = {
          mode: 'production',
          containerGroupName,
          finishTime: status.currentState.finishTime,
        };
        stopStatusPolling(jobId);
        logger.info({ jobId, containerGroupName }, 'Job de fine-tuning concluído com sucesso');
      } else if (mappedStatus === 'failed') {
        updateData.errorMessage = status.currentState.description || 'Falha no Container Group';
        stopStatusPolling(jobId);
        logger.error({ jobId, containerGroupName, description: status.currentState.description }, 'Job de fine-tuning falhou');
      } else if (mappedStatus === 'cancelled') {
        stopStatusPolling(jobId);
        logger.warn({ jobId, containerGroupName }, 'Job de fine-tuning cancelado');
      }

      await db.update(schema.fineTuningJobs)
        .set(updateData)
        .where(eq(schema.fineTuningJobs.id, jobId));

    } catch (error) {
      logger.warn({ error, jobId }, 'Erro ao verificar status do job - tentará novamente');
    }
  };

  pollStatus();
  
  const intervalId = setInterval(pollStatus, JOB_POLLING_INTERVAL_MS);
  activePollingJobs.set(jobId, intervalId);
}

function stopStatusPolling(jobId: string): void {
  const intervalId = activePollingJobs.get(jobId);
  if (intervalId) {
    clearInterval(intervalId);
    activePollingJobs.delete(jobId);
    logger.info({ jobId }, 'Polling de status interrompido');
  }
}

app.get('/api/training/jobs/:id', requirePermission('training:fine_tuning_jobs:read'), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;

  try {
    const job = await db.query.fineTuningJobs.findFirst({
      where: eq(schema.fineTuningJobs.id, id),
    });

    if (!job) {
      return res.status(404).json({ error: 'Job não encontrado' });
    }

    res.json({ job });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar job');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.delete('/api/training/jobs/:id', requirePermission('training:fine_tuning_jobs:cancel'), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;

  try {
    const job = await db.query.fineTuningJobs.findFirst({
      where: eq(schema.fineTuningJobs.id, id),
    });

    if (!job) {
      return res.status(404).json({ error: 'Job não encontrado' });
    }

    if (job.status === 'completed' || job.status === 'cancelled') {
      return res.status(400).json({ error: 'Job já finalizado ou cancelado' });
    }

    stopStatusPolling(id);

    if (job.containerGroupId) {
      try {
        await cancelSaladJob(job.containerGroupId);
        logger.info({ jobId: id, containerGroupId: job.containerGroupId }, 'Container Group cancelado na Salad Cloud');
      } catch (saladError) {
        logger.warn({ saladError, jobId: id }, 'Erro ao cancelar na Salad Cloud - continuando com cancelamento local');
      }
    }

    const [updated] = await db.update(schema.fineTuningJobs)
      .set({ 
        status: 'cancelled',
        completadoEm: new Date(),
      })
      .where(eq(schema.fineTuningJobs.id, id))
      .returning();

    logger.info({ jobId: id }, 'Job de fine-tuning cancelado');
    res.json({ job: updated });
  } catch (error) {
    logger.error({ error }, 'Falha ao cancelar job');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// BULK IMPORT - Importação em Lote de Dados de Treinamento
// ============================================================================

const bulkImportSchema = z.object({
  source: z.string().min(1).max(50),
  data: z.array(z.object({
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string().min(1),
    })).min(2),
    rating: z.number().min(1).max(5).optional(),
  })).min(1).max(1000),
  autoApprove: z.boolean().optional().default(false),
});

app.post('/api/training/bulk-import', requirePermission('training:training_data:create'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    
    if (!authContext || !authContext.tenantId) {
      logger.warn({ path: req.path }, 'Tentativa de bulk-import sem tenant válido');
      return res.status(403).json({ error: 'Tenant não identificado. Autenticação obrigatória.' });
    }

    const tenantId = authContext.tenantId;
    const validation = bulkImportSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Dados inválidos',
        details: validation.error.issues,
      });
    }

    const { source, data, autoApprove } = validation.data;
    const importedIds: string[] = [];
    const duplicatesSkipped: number[] = [];

    for (let i = 0; i < data.length; i++) {
      const entry = data[i];
      
      const text = entry.messages.map(m => m.content).join(' ');
      let embedding: number[] | null = null;
      let semhash: string | null = null;

      try {
        embedding = await embeddingsBreaker.fire(text) as number[];
        semhash = crypto.createHash('sha256').update(text.toLowerCase().trim()).digest('hex');

        const existingDuplicate = await db.query.trainingData.findFirst({
          where: eq(schema.trainingData.semhash, semhash),
        });

        if (existingDuplicate) {
          duplicatesSkipped.push(i);
          continue;
        }
      } catch (embError) {
        logger.warn({ error: embError, index: i }, 'Erro ao gerar embedding - continuando sem deduplicação');
      }

      const [inserted] = await db.insert(schema.trainingData).values({
        tenantId,
        source: `bulk_import:${source}`,
        messages: entry.messages,
        rating: entry.rating,
        status: autoApprove && (entry.rating || 0) >= 4 ? 'approved' : 'pending',
        semhash,
        embedding,
        isDuplicate: false,
      }).returning();

      importedIds.push(inserted.id);
    }

    logger.info({
      source,
      totalReceived: data.length,
      imported: importedIds.length,
      duplicatesSkipped: duplicatesSkipped.length,
      autoApprove,
    }, 'Bulk import concluído');

    res.status(201).json({
      success: true,
      imported: importedIds.length,
      duplicatesSkipped: duplicatesSkipped.length,
      ids: importedIds,
    });
  } catch (error) {
    logger.error({ error }, 'Falha no bulk import');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// WEBHOOK - Receber Dados de Sistemas Externos
// ============================================================================

const webhookSchema = z.object({
  event: z.enum(['training_data', 'feedback', 'document']),
  payload: z.object({
    messages: z.array(z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
      timestamp: z.string().datetime().optional(),
    })).optional(),
    rating: z.number().min(1).max(5).optional(),
    conversationId: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  timestamp: z.string().optional(),
});

// OWASP API3 - Schema para aprovação em lote
const batchApproveSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  action: z.enum(['approve', 'reject']),
});

// ============================================================================
// OWASP API3 - Schemas Zod para validação de query params
// Previne type coercion issues e input tampering
// ============================================================================

// Schema para query params de training data
const trainingDataQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'processed']).optional(),
  namespaceId: z.string().uuid().optional(),
});

// Schema para query params de jobs
const jobsQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

// Schema para query params de auto-learning status
const autoLearningStatusQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

// Schema para query params de stats
const trainingStatsQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

app.post('/api/training/webhook', async (req: Request, res: Response) => {
  const webhookSecret = req.headers['x-webhook-secret'] as string | undefined;
  const expectedSecret = process.env.TRAINING_WEBHOOK_SECRET;

  if (!expectedSecret) {
    logger.error('TRAINING_WEBHOOK_SECRET não configurado - webhook desabilitado por segurança');
    return res.status(503).json({ error: 'Webhook não configurado. Configure TRAINING_WEBHOOK_SECRET.' });
  }

  if (!webhookSecret || webhookSecret !== expectedSecret) {
    logger.warn({ hasSecret: !!webhookSecret }, 'Tentativa de webhook com secret inválido');
    return res.status(401).json({ error: 'Webhook secret inválido ou ausente' });
  }

  const tenantId = req.headers['x-tenant-id'] as string | undefined;
  if (!tenantId) {
    return res.status(400).json({ error: 'Header X-Tenant-ID obrigatório' });
  }

  try {
    const validation = webhookSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Payload inválido',
        details: validation.error.issues,
      });
    }

    const { event, payload } = validation.data;

    if (event === 'training_data' && payload.messages) {
      const text = payload.messages.map(m => m.content).join(' ');
      let embedding: number[] | null = null;
      let semhash: string | null = null;

      try {
        embedding = await embeddingsBreaker.fire(text) as number[];
        semhash = crypto.createHash('sha256').update(text.toLowerCase().trim()).digest('hex');
      } catch (embError) {
        logger.warn({ error: embError }, 'Erro ao gerar embedding no webhook');
      }

      const [inserted] = await db.insert(schema.trainingData).values({
        tenantId,
        source: 'webhook',
        messages: payload.messages,
        rating: payload.rating,
        status: 'pending',
        semhash,
        embedding,
      }).returning();

      logger.info({ id: inserted.id, event }, 'Dados recebidos via webhook');
      res.status(201).json({ success: true, id: inserted.id });
    } else if (event === 'feedback' && payload.conversationId) {
      await db.update(schema.trainingData)
        .set({ rating: payload.rating })
        .where(eq(schema.trainingData.conversationId, payload.conversationId));

      logger.info({ conversationId: payload.conversationId, rating: payload.rating }, 'Feedback atualizado via webhook');
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Evento não suportado ou payload incompleto' });
    }
  } catch (error) {
    logger.error({ error }, 'Falha ao processar webhook');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// APROVAÇÃO EM LOTE
// ============================================================================

app.post('/api/training/data/approve-batch', requirePermission('training:training_data:update'), async (req: Request, res: Response) => {
  // OWASP API3 - Validação Zod obrigatória
  const parseResult = batchApproveSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Input inválido' });
  }
  const { ids, action } = parseResult.data;

  try {
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    let updatedCount = 0;

    for (const id of ids) {
      const [updated] = await db.update(schema.trainingData)
        .set({ 
          status: newStatus,
          processadoEm: new Date(),
        })
        .where(eq(schema.trainingData.id, id))
        .returning();

      if (updated) updatedCount++;
    }

    logger.info({ action, count: updatedCount }, 'Aprovação em lote concluída');
    res.json({ success: true, updated: updatedCount });
  } catch (error) {
    logger.error({ error }, 'Falha na aprovação em lote');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// AUTO-LEARNING STATUS
// ============================================================================

app.get('/api/training/auto-learning/status', requirePermission('training:training_data:read'), async (req: Request, res: Response) => {
  // OWASP API3: Validação de query params
  const queryResult = autoLearningStatusQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }
  const { tenantId } = queryResult.data;

  try {
    const modelVersions = await db.query.modelVersions.findMany({
      where: tenantId ? eq(schema.modelVersions.tenantId, tenantId) : undefined,
      orderBy: [desc(schema.modelVersions.version)],
      limit: 10,
    });

    const activeVersion = modelVersions.find((v: typeof schema.modelVersions.$inferSelect) => v.isActive);

    const schedules = await db.query.autoLearningSchedule.findMany({
      where: tenantId ? eq(schema.autoLearningSchedule.tenantId, tenantId) : undefined,
      orderBy: [desc(schema.autoLearningSchedule.scheduledFor)],
      limit: 5,
    });

    const pendingData = await db.select({ count: sql<number>`count(*)` })
      .from(schema.trainingData)
      .where(and(
        eq(schema.trainingData.status, 'approved'),
        isNull(schema.trainingData.usedInJobId),
        tenantId ? eq(schema.trainingData.tenantId, tenantId) : undefined,
      ));

    const pendingImages = await db.select({ count: sql<number>`count(*)` })
      .from(schema.generatedImages)
      .where(and(
        eq(schema.generatedImages.approvedForTraining, true),
        eq(schema.generatedImages.usedInFineTuning, false),
        tenantId ? eq(schema.generatedImages.tenantId, tenantId) : undefined,
      ));

    res.json({
      activeModel: {
        version: activeVersion?.version || 0,
        name: activeVersion?.name || 'baseline',
        improvementPercent: activeVersion?.improvementPercent || 0,
        trainingDataUsed: activeVersion?.trainingDataCount || 0,
        imagesUsed: activeVersion?.imageDataCount || 0,
      },
      pendingData: {
        trainingEntries: pendingData[0]?.count || 0,
        images: pendingImages[0]?.count || 0,
      },
      recentVersions: modelVersions.slice(0, 5).map((v: typeof schema.modelVersions.$inferSelect) => ({
        version: v.version,
        status: v.status,
        createdAt: v.criadoEm,
      })),
      upcomingSchedules: schedules.map((s: typeof schema.autoLearningSchedule.$inferSelect) => ({
        id: s.id,
        type: s.scheduleType,
        scheduledFor: s.scheduledFor,
        status: s.status,
      })),
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter status do auto-learning');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/training/stats', requirePermission('training:training_data:read'), async (req: Request, res: Response) => {
  // OWASP API3: Validação de query params
  const queryResult = trainingStatsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }
  const { tenantId } = queryResult.data;

  try {
    const pendingCount = await db.select({ count: sql<number>`count(*)` })
      .from(schema.trainingData)
      .where(and(
        eq(schema.trainingData.status, 'pending'),
        tenantId ? eq(schema.trainingData.tenantId, tenantId) : undefined,
      ));

    const approvedCount = await db.select({ count: sql<number>`count(*)` })
      .from(schema.trainingData)
      .where(and(
        eq(schema.trainingData.status, 'approved'),
        tenantId ? eq(schema.trainingData.tenantId, tenantId) : undefined,
      ));

    const duplicatesCount = await db.select({ count: sql<number>`count(*)` })
      .from(schema.trainingData)
      .where(and(
        eq(schema.trainingData.isDuplicate, true),
        tenantId ? eq(schema.trainingData.tenantId, tenantId) : undefined,
      ));

    const completedJobs = await db.select({ count: sql<number>`count(*)` })
      .from(schema.fineTuningJobs)
      .where(and(
        eq(schema.fineTuningJobs.status, 'completed'),
        tenantId ? eq(schema.fineTuningJobs.tenantId, tenantId) : undefined,
      ));

    res.json({
      trainingData: {
        pending: pendingCount[0]?.count || 0,
        approved: approvedCount[0]?.count || 0,
        duplicatesFiltered: duplicatesCount[0]?.count || 0,
      },
      jobs: {
        completed: completedJobs[0]?.count || 0,
      },
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter estatísticas');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// MIDDLEWARE: Not Found + Error Handler (Express.js 2025)
// ============================================================================

// Not Found handler (antes do error handler)
app.use(createNotFoundHandler({ serviceName: 'training-service' }));

// Error handler global (OWASP 2023 + Express.js 2025)
app.use(createErrorHandler({ 
  serviceName: 'training-service', 
  logger,
  includeStackInDev: true,
}));

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info({ 
    port: PORT, 
    embeddingsConfigured: !!SALAD_API_KEY,
    circuitBreaker: 'enabled',
  }, 'Training service iniciado com Circuit Breaker');
});

// SEGURANÇA: Timeouts para prevenir conexões pendentes (Node.js 20 LTS Best Practices)
server.timeout = 30000; // 30s timeout para requisições
server.keepAliveTimeout = 65000; // 65s (maior que ALB timeout padrão de 60s)
server.headersTimeout = 66000; // Ligeiramente maior que keepAliveTimeout

// GRACEFUL SHUTDOWN (Enterprise-Grade - Regra 16 replit.md)
// setupGracefulShutdown já registra handlers SIGTERM/SIGINT para pool de conexões
// Usamos process.once() em vez de process.on() para evitar listeners duplicados
const gracefulShutdown = (signal: string) => {
  logger.info({ signal }, `Encerrando training service (${signal})...`);
  server.close(() => {
    logger.info('HTTP server fechado');
    process.exit(0);
  });
};

process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
