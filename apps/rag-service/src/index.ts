/**
 * RAG Service - Alice Enterprise Platform
 * 
 * Serviço de Retrieval-Augmented Generation com pgvector para embeddings.
 * Implementa Circuit Breaker pattern (Regra 16 - Best Practices 2025).
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import crypto from 'crypto';
import CircuitBreaker from 'opossum';
import pino from 'pino';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { eq, sql, desc } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '../../../shared/schema.js';

interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
}).child({ service: 'rag-service' });

const PORT = process.env.PORT || 3003;
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
  logger.error('SALAD_API_KEY não configurada - serviço requer API key para embeddings');
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
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

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
      input: text,
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
  max: 50,
  message: { error: 'Muitas requisições. Tente novamente em 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.use(express.json());

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const EMBEDDING_DIMENSIONS = 1536;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));
    start = end - CHUNK_OVERLAP;
  }

  return chunks;
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

app.get('/api/rag/health', (_req: Request, res: Response) => {
  const circuitState = embeddingsBreaker.opened ? 'open' : (embeddingsBreaker.halfOpen ? 'half-open' : 'closed');
  
  res.json({ 
    status: 'ok', 
    service: 'rag-service', 
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

app.get('/api/rag/documents', async (req: Request, res: Response) => {
  const namespaceId = req.query.namespaceId as string;

  try {
    const whereClause = namespaceId 
      ? eq(schema.documents.namespaceId, namespaceId)
      : undefined;

    const documents = await db.query.documents.findMany({
      where: whereClause,
      orderBy: [desc(schema.documents.criadoEm)],
      limit: 100,
    });

    res.json({ documents });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar documentos');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

const createDocumentSchema = z.object({
  namespaceId: z.string().uuid().optional(),
  titulo: z.string().min(1),
  conteudo: z.string().min(1),
  tipo: z.string().optional(),
  fonte: z.string().optional(),
  urlOrigem: z.string().url().optional(),
});

app.post('/api/rag/documents', async (req: Request, res: Response) => {
  try {
    const body = createDocumentSchema.parse(req.body);

    const hashConteudo = hashContent(body.conteudo);
    
    const existing = await db.query.documents.findFirst({
      where: eq(schema.documents.hashConteudo, hashConteudo),
    });

    if (existing) {
      return res.status(409).json({ 
        error: 'Documento duplicado', 
        existingId: existing.id,
      });
    }

    const documentEmbedding = await generateEmbedding(body.conteudo.slice(0, 2000));

    const [document] = await db.insert(schema.documents).values({
      namespaceId: body.namespaceId,
      titulo: body.titulo,
      conteudo: body.conteudo,
      tipo: body.tipo,
      fonte: body.fonte,
      urlOrigem: body.urlOrigem,
      hashConteudo,
      embedding: documentEmbedding,
      processado: false,
    }).returning();

    const chunks = chunkText(body.conteudo);
    
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generateEmbedding(chunks[i]);
      
      await db.insert(schema.documentChunks).values({
        documentId: document.id,
        conteudo: chunks[i],
        posicao: i,
        embedding,
      });
    }

    await db.update(schema.documents)
      .set({ processado: true })
      .where(eq(schema.documents.id, document.id));

    logger.info({ documentId: document.id, chunks: chunks.length }, 'Documento processado');
    res.json({ document, chunksCreated: chunks.length });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar documento');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/rag/documents/upload', upload.single('file'), async (req: MulterRequest, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  try {
    const content = req.file.buffer.toString('utf-8');
    const titulo = req.body.titulo || req.file.originalname;
    const namespaceId = req.body.namespaceId;

    const hashConteudo = hashContent(content);

    const documentEmbedding = await generateEmbedding(content.slice(0, 2000));

    const [document] = await db.insert(schema.documents).values({
      namespaceId,
      titulo,
      conteudo: content,
      tipo: req.file.mimetype,
      hashConteudo,
      embedding: documentEmbedding,
      processado: false,
    }).returning();

    const chunks = chunkText(content);
    
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generateEmbedding(chunks[i]);
      
      await db.insert(schema.documentChunks).values({
        documentId: document.id,
        conteudo: chunks[i],
        posicao: i,
        embedding,
      });
    }

    await db.update(schema.documents)
      .set({ processado: true })
      .where(eq(schema.documents.id, document.id));

    logger.info({ documentId: document.id, filename: req.file.originalname }, 'Arquivo enviado e processado');
    res.json({ document, chunksCreated: chunks.length });
  } catch (error) {
    logger.error({ error }, 'Falha ao enviar documento');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

const searchSchema = z.object({
  query: z.string().min(1),
  namespaceId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(20).default(5),
  threshold: z.coerce.number().min(0).max(1).default(0.7),
});

app.post('/api/rag/search', async (req: Request, res: Response) => {
  try {
    const body = searchSchema.parse(req.body);

    const queryEmbedding = await generateEmbedding(body.query);

    const allChunks = await db.query.documentChunks.findMany({
      with: {
        document: true,
      },
    });

    const results = allChunks
      .filter(chunk => {
        if (body.namespaceId && chunk.document?.namespaceId !== body.namespaceId) {
          return false;
        }
        return true;
      })
      .map(chunk => ({
        ...chunk,
        similarity: chunk.embedding 
          ? cosineSimilarity(queryEmbedding, chunk.embedding)
          : 0,
      }))
      .filter(chunk => chunk.similarity >= body.threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, body.limit);

    logger.info({ query: body.query, results: results.length }, 'Busca concluída');
    res.json({ results });
  } catch (error) {
    logger.error({ error }, 'Falha na busca');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/rag/context', async (req: Request, res: Response) => {
  try {
    const body = searchSchema.parse(req.body);

    const queryEmbedding = await generateEmbedding(body.query);

    const allChunks = await db.query.documentChunks.findMany({
      with: {
        document: true,
      },
    });

    const results = allChunks
      .filter(chunk => {
        if (body.namespaceId && chunk.document?.namespaceId !== body.namespaceId) {
          return false;
        }
        return true;
      })
      .map(chunk => ({
        ...chunk,
        similarity: chunk.embedding 
          ? cosineSimilarity(queryEmbedding, chunk.embedding)
          : 0,
      }))
      .filter(chunk => chunk.similarity >= body.threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, body.limit);

    const context = results
      .map(r => `[Fonte: ${r.document?.titulo || 'Desconhecido'}]\n${r.conteudo}`)
      .join('\n\n---\n\n');

    res.json({ 
      context,
      sources: results.map(r => ({
        documentId: r.documentId,
        titulo: r.document?.titulo,
        similarity: r.similarity,
      })),
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao gerar contexto');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.delete('/api/rag/documents/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    await db.delete(schema.documentChunks)
      .where(eq(schema.documentChunks.documentId, id));

    await db.delete(schema.documents)
      .where(eq(schema.documents.id, id));

    logger.info({ documentId: id }, 'Documento excluído');
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Falha ao excluir documento');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/rag/namespaces/:id/stats', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const documents = await db.query.documents.findMany({
      where: eq(schema.documents.namespaceId, id),
    });

    const totalDocuments = documents.length;
    const processedDocuments = documents.filter(d => d.processado).length;

    const chunks = await db.select({ count: sql<number>`count(*)` })
      .from(schema.documentChunks)
      .innerJoin(schema.documents, eq(schema.documentChunks.documentId, schema.documents.id))
      .where(eq(schema.documents.namespaceId, id));

    res.json({
      totalDocuments,
      processedDocuments,
      totalChunks: chunks[0]?.count || 0,
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

app.listen(PORT, () => {
  logger.info({ 
    port: PORT, 
    embeddingsConfigured: !!SALAD_API_KEY,
    circuitBreaker: 'enabled',
  }, 'RAG service iniciado com Circuit Breaker');
});

process.on('SIGTERM', () => {
  logger.info('Encerrando RAG service');
  process.exit(0);
});
