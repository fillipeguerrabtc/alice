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
import { 
  requirePermission, 
  requireAuth,
  requireSameTenant,
  extractAuthContext,
} from '../../../packages/shared-utils/src/rbac/middleware.js';

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

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';

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

// ============================================================================
// AGENTIC RAG - Web Search Integration (Regra 16 - Best Practices 2025)
// ============================================================================

interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  snippet?: string;
}

interface BraveSearchResponse {
  web?: {
    results: Array<{
      title: string;
      url: string;
      description: string;
    }>;
  };
}

async function webSearchInternal(query: string, count: number = 5): Promise<WebSearchResult[]> {
  if (!BRAVE_API_KEY) {
    logger.warn('BRAVE_API_KEY não configurada - busca web desabilitada');
    return [];
  }

  const params = new URLSearchParams({
    q: query,
    count: count.toString(),
    safesearch: 'moderate',
    country: 'BR',
    text_decorations: 'false',
  });

  const response = await fetch(`${BRAVE_SEARCH_URL}?${params}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': BRAVE_API_KEY,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Falha na busca web: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as BraveSearchResponse;
  
  return (data.web?.results || []).map(r => ({
    title: r.title,
    url: r.url,
    description: r.description,
    snippet: r.description,
  }));
}

const webSearchBreakerOptions = {
  timeout: 10000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 3,
};

const webSearchBreaker = new CircuitBreaker(webSearchInternal, webSearchBreakerOptions);

webSearchBreaker.on('open', () => {
  logger.warn('Circuit breaker Brave Search: ABERTO - API temporariamente indisponível');
});
webSearchBreaker.on('halfOpen', () => {
  logger.info('Circuit breaker Brave Search: HALF-OPEN - Testando reconexão');
});
webSearchBreaker.on('close', () => {
  logger.info('Circuit breaker Brave Search: FECHADO - API funcionando normalmente');
});

async function webSearch(query: string, count?: number): Promise<WebSearchResult[]> {
  try {
    return await webSearchBreaker.fire(query, count) as WebSearchResult[];
  } catch (error) {
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      logger.warn('Circuit breaker aberto - Busca web temporariamente indisponível');
      return [];
    }
    logger.error({ error, query }, 'Erro na busca web');
    return [];
  }
}

// ============================================================================
// QUERY CLASSIFIER - Decidir entre RAG interno vs Web Search
// ============================================================================

type QueryType = 'internal' | 'web' | 'hybrid';

interface ClassificationResult {
  type: QueryType;
  confidence: number;
  reason: string;
}

const WEB_SEARCH_KEYWORDS = [
  'notícias', 'news', 'atualidades', 'hoje', 'ontem', 'recente',
  'preço', 'cotação', 'valor atual', 'quanto custa',
  'tempo', 'clima', 'previsão',
  'resultado', 'placar', 'jogo',
  'lançamento', 'novo', 'última versão',
  'como fazer', 'tutorial', 'passo a passo',
  'onde encontrar', 'onde comprar', 'onde fica',
  'quem é', 'biografia', 'história de',
];

const INTERNAL_KEYWORDS = [
  'nosso', 'nossa', 'empresa', 'produto',
  'política', 'procedimento', 'processo interno',
  'manual', 'documentação interna', 'wiki',
  'funcionário', 'equipe', 'time',
  'projeto', 'sistema interno', 'ferramenta interna',
  'alice', 'plataforma',
];

function classifyQuery(query: string): ClassificationResult {
  const lowerQuery = query.toLowerCase();
  
  const webScore = WEB_SEARCH_KEYWORDS.reduce((score, keyword) => {
    return lowerQuery.includes(keyword) ? score + 1 : score;
  }, 0);
  
  const internalScore = INTERNAL_KEYWORDS.reduce((score, keyword) => {
    return lowerQuery.includes(keyword) ? score + 1 : score;
  }, 0);
  
  const hasQuestionMark = query.includes('?');
  const hasCurrentTimeReference = /(?:hoje|agora|atualmente|202\d)/i.test(query);
  
  if (internalScore > 0 && webScore === 0) {
    return {
      type: 'internal',
      confidence: 0.9,
      reason: 'Query contém referências a documentos internos',
    };
  }
  
  if (webScore > 0 && internalScore === 0 && hasCurrentTimeReference) {
    return {
      type: 'web',
      confidence: 0.85,
      reason: 'Query requer informações atualizadas da web',
    };
  }
  
  if (webScore > 0 || hasCurrentTimeReference) {
    return {
      type: 'hybrid',
      confidence: 0.7,
      reason: 'Query pode se beneficiar de ambas as fontes',
    };
  }
  
  return {
    type: 'internal',
    confidence: 0.6,
    reason: 'Consulta padrão para base de conhecimento interna',
  };
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

app.get('/api/rag/documents', requirePermission('rag:documents:read'), async (req: Request, res: Response) => {
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

app.post('/api/rag/documents', requirePermission('rag:documents:write'), async (req: Request, res: Response) => {
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

app.post('/api/rag/documents/upload', requirePermission('rag:documents:upload'), upload.single('file'), async (req: MulterRequest, res: Response) => {
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

app.post('/api/rag/search', requirePermission('rag:documents:read'), async (req: Request, res: Response) => {
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

app.post('/api/rag/context', requireAuth(), async (req: Request, res: Response) => {
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

app.delete('/api/rag/documents/:id', requirePermission('rag:documents:delete'), async (req: Request, res: Response) => {
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

app.get('/api/rag/namespaces/:id/stats', requirePermission('rag:namespaces:read'), async (req: Request, res: Response) => {
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

// ============================================================================
// AGENTIC RAG ENDPOINTS - Busca híbrida inteligente
// ============================================================================

const agenticSearchSchema = z.object({
  query: z.string().min(1),
  namespaceId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(20).default(5),
  threshold: z.coerce.number().min(0).max(1).default(0.6),
  forceMode: z.enum(['internal', 'web', 'hybrid']).optional(),
});

app.post('/api/rag/web-search', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { query, limit = 5 } = req.body;
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query é obrigatória' });
    }

    if (!BRAVE_API_KEY) {
      return res.status(503).json({ 
        error: 'Busca web não configurada', 
        message: 'BRAVE_API_KEY não está configurada',
      });
    }

    const results = await webSearch(query, limit);
    
    logger.info({ query, results: results.length }, 'Busca web concluída');
    res.json({ results, source: 'brave-search' });
  } catch (error) {
    logger.error({ error }, 'Falha na busca web');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/rag/classify', requireAuth(), async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query é obrigatória' });
    }

    const classification = classifyQuery(query);
    
    res.json({ 
      query, 
      classification,
      webSearchAvailable: !!BRAVE_API_KEY,
    });
  } catch (error) {
    logger.error({ error }, 'Falha na classificação');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

function getTenantIdFromRequest(req: Request): string {
  return req.headers['x-tenant-id'] as string;
}

app.post('/api/rag/agentic', requireAuth(), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  
  if (!tenantId) {
    return res.status(400).json({ error: 'Tenant ID obrigatório' });
  }

  try {
    const body = agenticSearchSchema.parse(req.body);
    
    const classification = body.forceMode 
      ? { type: body.forceMode, confidence: 1, reason: 'Modo forçado pelo usuário' }
      : classifyQuery(body.query);
    
    const results: {
      internal: Array<{ documentId: string; titulo?: string; conteudo: string; similarity: number }>;
      web: WebSearchResult[];
      classification: ClassificationResult;
    } = {
      internal: [],
      web: [],
      classification,
    };

    if (classification.type === 'internal' || classification.type === 'hybrid') {
      const tenantNamespaces = await db.query.namespaces.findMany({
        where: eq(schema.namespaces.tenantId, tenantId),
      });
      const tenantNamespaceIds = new Set(tenantNamespaces.map(ns => ns.id));

      const queryEmbedding = await generateEmbedding(body.query);

      const allChunks = await db.query.documentChunks.findMany({
        with: {
          document: true,
        },
      });

      const internalResults = allChunks
        .filter(chunk => {
          if (!chunk.document?.namespaceId) return false;
          if (!tenantNamespaceIds.has(chunk.document.namespaceId)) return false;
          if (body.namespaceId && chunk.document.namespaceId !== body.namespaceId) {
            return false;
          }
          return true;
        })
        .map(chunk => ({
          documentId: chunk.documentId,
          titulo: chunk.document?.titulo,
          conteudo: chunk.conteudo,
          similarity: chunk.embedding 
            ? cosineSimilarity(queryEmbedding, chunk.embedding)
            : 0,
        }))
        .filter(chunk => chunk.similarity >= body.threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, body.limit);

      results.internal = internalResults;
    }

    if ((classification.type === 'web' || classification.type === 'hybrid') && BRAVE_API_KEY) {
      results.web = await webSearch(body.query, body.limit);
    }

    const context = buildAgenticContext(results.internal, results.web);

    logger.info({ 
      query: body.query, 
      tenantId,
      classification: classification.type,
      internalResults: results.internal.length,
      webResults: results.web.length,
    }, 'Busca agentic concluída');

    res.json({ 
      ...results,
      context,
      sources: {
        internal: results.internal.map(r => ({
          documentId: r.documentId,
          titulo: r.titulo,
          similarity: r.similarity,
        })),
        web: results.web.map(r => ({
          title: r.title,
          url: r.url,
        })),
      },
    });
  } catch (error) {
    logger.error({ error }, 'Falha na busca agentic');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

function buildAgenticContext(
  internal: Array<{ titulo?: string; conteudo: string; similarity: number }>,
  web: WebSearchResult[]
): string {
  const parts: string[] = [];

  if (internal.length > 0) {
    parts.push('## Documentos Internos\n');
    internal.forEach((doc, i) => {
      parts.push(`### ${i + 1}. ${doc.titulo || 'Documento sem título'} (Relevância: ${(doc.similarity * 100).toFixed(0)}%)`);
      parts.push(doc.conteudo);
      parts.push('');
    });
  }

  if (web.length > 0) {
    parts.push('\n## Resultados da Web\n');
    web.forEach((result, i) => {
      parts.push(`### ${i + 1}. ${result.title}`);
      parts.push(`Fonte: ${result.url}`);
      parts.push(result.description);
      parts.push('');
    });
  }

  return parts.join('\n');
}

app.get('/api/rag/agentic/status', requireAuth(), async (_req: Request, res: Response) => {
  const embeddingsState = embeddingsBreaker.opened ? 'open' : (embeddingsBreaker.halfOpen ? 'half-open' : 'closed');
  const webSearchState = webSearchBreaker.opened ? 'open' : (webSearchBreaker.halfOpen ? 'half-open' : 'closed');

  res.json({
    webSearchEnabled: !!BRAVE_API_KEY,
    circuitBreakers: {
      embeddings: {
        state: embeddingsState,
        stats: {
          failures: embeddingsBreaker.stats.failures,
          successes: embeddingsBreaker.stats.successes,
          timeouts: embeddingsBreaker.stats.timeouts,
        },
      },
      webSearch: {
        state: webSearchState,
        stats: {
          failures: webSearchBreaker.stats.failures,
          successes: webSearchBreaker.stats.successes,
          timeouts: webSearchBreaker.stats.timeouts,
        },
      },
    },
    classificationKeywords: {
      web: WEB_SEARCH_KEYWORDS.length,
      internal: INTERNAL_KEYWORDS.length,
    },
  });
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
