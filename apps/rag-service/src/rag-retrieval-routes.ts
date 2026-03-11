import type { Express, Request, Response } from 'express';
import { requireAuth, requireSameTenant } from '@alice/shared-utils';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { WebSearchOptions, WebSearchResult } from './web-search.js';
import { sanitizeWebSnippet } from './web-sanitize.js';

type QueryType = 'internal' | 'web' | 'hybrid';

interface ClassificationResult {
  type: QueryType;
  confidence: number;
  reason: string;
  webMode?: 'web' | 'deepweb';
}

interface RegisterRagRetrievalRoutesParams {
  app: Express;
  logger: Logger;
  webSearchClient: {
    isEnabled: () => boolean;
    searchImages: (query: string, count?: number, options?: WebSearchOptions) => Promise<Array<{ title: string; imageUrl: string; sourceUrl?: string; thumbnailUrl?: string }>>;
    breakerState: () => {
      state: 'open' | 'half-open' | 'closed';
      stats: {
        failures: number;
        successes: number;
        timeouts: number;
      };
    };
  };
  webSearch: (query: string, count?: number, options?: WebSearchOptions) => Promise<WebSearchResult[]>;
  classifyQuery: (query: string) => ClassificationResult;
  isQdrantConfigured: () => boolean;
  generateEmbedding: (text: string) => Promise<number[]>;
  searchDocumentsForContext: (
    queryEmbedding: number[],
    tenantId: string,
    options: {
      limit: number;
      threshold: number;
      namespaceId?: string;
    }
  ) => Promise<Array<{ documentId: string; titulo?: string; conteudo: string; similarity: number }>>;
  gpuManagerEmbeddingsBreaker: {
    opened: boolean;
    halfOpen: boolean;
    stats: {
      failures: number;
      successes: number;
      timeouts: number;
    };
  };
  webSearchKeywordCount: number;
  internalKeywordCount: number;
}

const agenticSearchSchema = z.object({
  query: z.string().min(1),
  namespaceId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(20).default(5),
  threshold: z.coerce.number().min(0).max(1).default(0.6),
  forceMode: z.enum(['internal', 'web', 'hybrid']).optional(),
  webMode: z.enum(['web', 'deepweb']).optional(),
});

const webSearchSchema = z.object({
  query: z.string().min(1),
  limit: z.coerce.number().min(1).max(20).default(5),
  mode: z.enum(['web', 'deepweb']).optional(),
  engines: z.array(z.string().min(1)).optional(),
  categories: z.string().min(1).optional(),
  language: z.string().min(2).optional(),
  safesearch: z.string().min(1).optional(),
  timeRange: z.enum(['day', 'week', 'month', 'year']).optional(),
});

const webImageSearchSchema = z.object({
  query: z.string().min(1),
  limit: z.coerce.number().min(1).max(12).default(5),
});

const ragClassifySchema = z.object({
  query: z.string().trim().min(1, 'Query é obrigatória'),
});

function getTenantIdFromRequest(req: Request): string {
  return req.tenantId as string;
}

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
      const sanitizedDescription = sanitizeWebSnippet(result.description);
      if (sanitizedDescription) {
        parts.push(sanitizedDescription);
      }
      parts.push('');
    });
  }

  return parts.join('\n');
}

export function registerRagRetrievalRoutes(params: RegisterRagRetrievalRoutesParams): void {
  const {
    app,
    logger,
    webSearchClient,
    webSearch,
    classifyQuery,
    isQdrantConfigured,
    generateEmbedding,
    searchDocumentsForContext,
    gpuManagerEmbeddingsBreaker,
    webSearchKeywordCount,
    internalKeywordCount,
  } = params;

  app.post('/api/rag/web-search', requireAuth(), async (req: Request, res: Response) => {
    try {
      const { query, limit, mode, engines, categories, language, safesearch, timeRange } = webSearchSchema.parse(req.body);

      if (!webSearchClient.isEnabled()) {
        return res.status(503).json({
          error: 'Busca web não configurada',
          message: 'SEARXNG_SECRET_KEY não está configurada',
        });
      }

      const options: WebSearchOptions | undefined = mode === 'deepweb'
        ? { engines: ['ahmia'] }
        : {
          engines,
          categories,
          language,
          safesearch,
          timeRange,
        };
      const results = await webSearch(query, limit, options);

      logger.info({ query, results: results.length }, 'Busca web concluída');
      res.json({ results, source: 'searxng' });
    } catch (error) {
      logger.error({ error }, 'Falha na busca web');
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.post('/api/rag/web-search/images', requireAuth(), async (req: Request, res: Response) => {
    try {
      const { query, limit } = webImageSearchSchema.parse(req.body);

      if (!webSearchClient.isEnabled()) {
        return res.status(503).json({
          error: 'Busca web não configurada',
          message: 'SEARXNG_SECRET_KEY não está configurada',
        });
      }

      const results = await webSearchClient.searchImages(query, limit, { categories: 'images' });

      logger.info({ query, results: results.length }, 'Busca de imagens na web concluída');
      res.json({ results, source: 'searxng' });
    } catch (error) {
      logger.error({ error }, 'Falha na busca de imagens na web');
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.post('/api/rag/classify', requireAuth(), async (req: Request, res: Response) => {
    try {
      const parseResult = ragClassifySchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Payload inválido', details: parseResult.error.format() });
      }
      const { query } = parseResult.data;

      const classification = classifyQuery(query);

      res.json({
        query,
        classification,
        webSearchAvailable: webSearchClient.isEnabled(),
      });
    } catch (error) {
      logger.error({ error }, 'Falha na classificação');
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.post('/api/rag/agentic', requireAuth(), requireSameTenant(getTenantIdFromRequest), async (req: Request, res: Response) => {
    const tenantId = req.tenantId;

    if (!tenantId) {
      return res.status(401).json({ error: 'Autenticação necessária' });
    }

    try {
      const body = agenticSearchSchema.parse(req.body);

      const classification = body.forceMode
        ? { type: body.forceMode, confidence: 1, reason: 'Modo forçado pelo usuário' }
        : classifyQuery(body.query);
      const resolvedWebMode = body.webMode ?? classification.webMode ?? 'web';

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
        if (!isQdrantConfigured()) {
          logger.warn('Qdrant não configurado - busca interna indisponível para agentic');
        } else {
          const queryEmbedding = await generateEmbedding(body.query);

          results.internal = await searchDocumentsForContext(queryEmbedding, tenantId, {
            limit: body.limit,
            threshold: body.threshold,
            namespaceId: body.namespaceId,
          });
        }
      }

      if ((classification.type === 'web' || classification.type === 'hybrid') && webSearchClient.isEnabled()) {
        const webOptions: WebSearchOptions | undefined = resolvedWebMode === 'deepweb'
          ? { engines: ['ahmia'] }
          : undefined;
        results.web = await webSearch(body.query, body.limit, webOptions);
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

  app.get('/api/rag/agentic/status', requireAuth(), async (_req: Request, res: Response) => {
    const embeddingsState = gpuManagerEmbeddingsBreaker.opened ? 'open' : (gpuManagerEmbeddingsBreaker.halfOpen ? 'half-open' : 'closed');
    const webSearchState = webSearchClient.breakerState();

    res.json({
      webSearchEnabled: webSearchClient.isEnabled(),
      circuitBreakers: {
        embeddings: {
          state: embeddingsState,
          stats: {
            failures: gpuManagerEmbeddingsBreaker.stats.failures,
            successes: gpuManagerEmbeddingsBreaker.stats.successes,
            timeouts: gpuManagerEmbeddingsBreaker.stats.timeouts,
          },
        },
        webSearch: {
          state: webSearchState.state,
          stats: webSearchState.stats,
        },
      },
      classificationKeywords: {
        web: webSearchKeywordCount,
        internal: internalKeywordCount,
      },
    });
  });
}
