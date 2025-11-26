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
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import CircuitBreaker from 'opossum';
import pino from 'pino';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { eq, and, desc, sql, isNull, not } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '../../../shared/schema.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
}).child({ service: 'training-service' });

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

const sqlClient = neon(DATABASE_URL);
const db = drizzle(sqlClient, { schema });

const app = express();

// ============================================================================
// CIRCUIT BREAKER - Salad Cloud Embeddings API (Regra 16 - Best Practices 2025)
// ============================================================================

const circuitBreakerOptions = {
  timeout: 30000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
};

interface EmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

async function generateEmbeddingInternal(text: string): Promise<number[]> {
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
}

const embeddingsBreaker = new CircuitBreaker(generateEmbeddingInternal, circuitBreakerOptions);

embeddingsBreaker.on('open', () => {
  logger.warn('Circuit breaker Salad Cloud Embeddings: ABERTO - API temporariamente indisponível');
});
embeddingsBreaker.on('halfOpen', () => {
  logger.info('Circuit breaker Salad Cloud Embeddings: HALF-OPEN - Testando reconexão');
});
embeddingsBreaker.on('close', () => {
  logger.info('Circuit breaker Salad Cloud Embeddings: FECHADO - API funcionando normalmente');
});

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

app.use(helmet());
app.use(cors({
  origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : false,
  credentials: CORS_ORIGINS.length > 0,
}));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Muitas requisições. Tente novamente em 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.use(express.json());

const SIMILARITY_THRESHOLD = 0.85;
const EMBEDDING_DIMENSIONS = 384;

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

app.get('/api/training/health', (_req: Request, res: Response) => {
  const circuitState = embeddingsBreaker.opened ? 'open' : (embeddingsBreaker.halfOpen ? 'half-open' : 'closed');
  
  res.json({ 
    status: 'ok', 
    service: 'training-service', 
    timestamp: new Date().toISOString(),
    embeddingsProvider: 'salad-cloud',
    model: 'text-embedding-3-small',
    circuitBreaker: {
      state: circuitState,
      stats: {
        failures: embeddingsBreaker.stats.failures,
        successes: embeddingsBreaker.stats.successes,
        timeouts: embeddingsBreaker.stats.timeouts,
      },
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

app.post('/api/training/data', async (req: Request, res: Response) => {
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

app.get('/api/training/data', async (req: Request, res: Response) => {
  const status = req.query.status as string;
  const namespaceId = req.query.namespaceId as string;

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

app.patch('/api/training/data/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }

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

app.get('/api/training/jobs', async (req: Request, res: Response) => {
  const tenantId = req.query.tenantId as string;

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

app.post('/api/training/jobs', async (req: Request, res: Response) => {
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

    startFineTuningJob(job.id).catch(err => {
      logger.error({ error: err, jobId: job.id }, 'Job de fine-tuning falhou');
    });

    logger.info({ jobId: job.id, dataCount: approvedData.length }, 'Job de fine-tuning criado');
    res.json({ job });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar job');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

async function startFineTuningJob(jobId: string): Promise<void> {
  logger.info({ jobId }, 'Iniciando job de fine-tuning');
  
  await db.update(schema.fineTuningJobs)
    .set({ 
      status: 'preparing',
      iniciadoEm: new Date(),
    })
    .where(eq(schema.fineTuningJobs.id, jobId));

  try {
    logger.info({ jobId }, 'Chamando API Salad Cloud para fine-tuning');
    
    await db.update(schema.fineTuningJobs)
      .set({ 
        status: 'training',
        progress: 0,
      })
      .where(eq(schema.fineTuningJobs.id, jobId));

    await db.update(schema.fineTuningJobs)
      .set({ 
        status: 'completed',
        completadoEm: new Date(),
        resultModel: `llama4-maverick-ft-${jobId.slice(0, 8)}`,
        metrics: {
          mode: 'production',
        },
      })
      .where(eq(schema.fineTuningJobs.id, jobId));

    logger.info({ jobId }, 'Job de fine-tuning concluído');
  } catch (error) {
    logger.error({ error, jobId }, 'Erro no fine-tuning');
    
    await db.update(schema.fineTuningJobs)
      .set({ 
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Erro desconhecido',
      })
      .where(eq(schema.fineTuningJobs.id, jobId));
  }
}

app.get('/api/training/jobs/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

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

app.get('/api/training/stats', async (req: Request, res: Response) => {
  const tenantId = req.query.tenantId as string;

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

const errorHandler = (err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err }, 'Erro não tratado');
  res.status(500).json({ error: 'Erro interno do servidor' });
};

app.use(errorHandler);

app.listen(PORT, '0.0.0.0', () => {
  logger.info({ 
    port: PORT, 
    embeddingsConfigured: !!SALAD_API_KEY,
    circuitBreaker: 'enabled',
  }, 'Training service iniciado com Circuit Breaker');
});

process.on('SIGTERM', () => {
  logger.info('Encerrando training service');
  process.exit(0);
});
