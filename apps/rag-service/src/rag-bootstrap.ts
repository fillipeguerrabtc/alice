import http from 'http';
import { readOptionalStringEnv } from '@alice/config';
import {
  setPermissionResolver,
  createDatabasePermissionResolver,
  initializeRedisCache,
  initializeSessionAuthCache,
  createCacheAdapter,
  registerShutdownCallback,
  ShutdownPriority,
  initTextCollection,
  isQdrantConfigured,
  TEXT_COLLECTION_NAME,
  TEXT_EMBEDDING_DIM,
} from '@alice/shared-utils';
import { initEmbeddingWebSocket, closeEmbeddingWebSocket } from './embedding-websocket.js';
import type { Express } from 'express';
import type { Logger } from 'pino';

interface StartRagBootstrapParams {
  app: Express;
  logger: Logger;
  port: number;
  isProduction: boolean;
  gpuManagerUrl: string;
  workerTenantId?: string;
  ragQueryCacheTtlMs: number;
  startEmbeddingWorkerWhenRedisReady: (redisConnected: boolean) => void;
  startDocumentProcessingWorkerWhenRedisReady: (redisConnected: boolean) => void;
  startDocumentProcessingReconcilerWhenRedisReady: (redisConnected: boolean) => void;
  startTenantScopedWorkers: (tenantId: string) => void;
  validateEmbeddingDimensionsSSOT: () => Promise<void>;
  setRagSearchCache: (cache: ReturnType<typeof createCacheAdapter<unknown>> | null) => void;
  setRagContextCache: (cache: ReturnType<typeof createCacheAdapter<unknown>> | null) => void;
}

export async function startRagBootstrap(params: StartRagBootstrapParams): Promise<void> {
  const {
    app,
    logger,
    port,
    isProduction,
    gpuManagerUrl,
    workerTenantId,
    ragQueryCacheTtlMs,
    startEmbeddingWorkerWhenRedisReady,
    startDocumentProcessingWorkerWhenRedisReady,
    startDocumentProcessingReconcilerWhenRedisReady,
    startTenantScopedWorkers,
    validateEmbeddingDimensionsSSOT,
    setRagSearchCache,
    setRagContextCache,
  } = params;

  try {
    setPermissionResolver(createDatabasePermissionResolver());

    let redisConnected = false;
    try {
      redisConnected = await initializeRedisCache();
      redisConnected = Boolean(redisConnected);
    } catch (redisError) {
      redisConnected = false;
      logger.error({ error: redisError }, 'CRITICAL: Falha ao inicializar Redis cache - exceção lançada');
    }

    await initializeSessionAuthCache();

    if (redisConnected) {
      logger.info('Redis cache inicializado para embedding-websocket');
    } else if (isProduction) {
      logger.error('CRITICAL: Redis é OBRIGATÓRIO para embedding-websocket Pub/Sub em produção. Abortando.');
      process.exit(1);
    } else {
      logger.warn('Redis cache não disponível - WebSocket funcionará sem Pub/Sub (modo desenvolvimento)');
    }

    startEmbeddingWorkerWhenRedisReady(redisConnected);
    startDocumentProcessingWorkerWhenRedisReady(redisConnected);
    startDocumentProcessingReconcilerWhenRedisReady(redisConnected);
    if (workerTenantId) {
      startTenantScopedWorkers(workerTenantId);
    } else {
      logger.info('Workers tenant-scoped desativados: defina WORKER_TENANT_ID para habilitar learning/web-crawl em background');
    }

    if (redisConnected) {
      const searchAdapter = createCacheAdapter<unknown>('rag-search', ragQueryCacheTtlMs);
      if (searchAdapter.isDistributed()) {
        setRagSearchCache(searchAdapter);
      } else {
        setRagSearchCache(null);
        logger.warn('Cache RAG (search) desabilitado: adapter não é distribuído');
      }

      const contextAdapter = createCacheAdapter<unknown>('rag-context', ragQueryCacheTtlMs);
      if (contextAdapter.isDistributed()) {
        setRagContextCache(contextAdapter);
      } else {
        setRagContextCache(null);
        logger.warn('Cache RAG (context) desabilitado: adapter não é distribuído');
      }
    } else {
      setRagSearchCache(null);
      setRagContextCache(null);
      logger.info('Cache RAG desabilitado (Redis indisponível)');
    }

    await validateEmbeddingDimensionsSSOT();

    const server = http.createServer(app);

    if (isQdrantConfigured()) {
      try {
        await initTextCollection();
        logger.info({
          collection: TEXT_COLLECTION_NAME,
          dimension: TEXT_EMBEDDING_DIM,
        }, 'Coleção Qdrant para embeddings de texto inicializada');
      } catch (error) {
        logger.error({ error }, 'Falha ao inicializar coleção Qdrant - servidor não iniciará');
        throw error;
      }
    } else {
      logger.warn('Qdrant não configurado (QDRANT_URL/QDRANT_API_KEY) - buscas de texto indisponíveis');
    }

    try {
      await initEmbeddingWebSocket(server);
      logger.info({ path: '/ws/embeddings' }, 'WebSocket para notificações de embeddings ativo');
    } catch (error) {
      logger.error({ error }, 'CRITICAL: Falha ao inicializar WebSocket - abortando');
      throw error;
    }

    registerShutdownCallback(
      'rag-websocket-server',
      async () => {
        logger.info('Encerrando WebSocket server...');
        await closeEmbeddingWebSocket();
        logger.info('WebSocket server encerrado com sucesso');
      },
      { priority: ShutdownPriority.WEBSOCKET }
    );

    registerShutdownCallback(
      'rag-http-server',
      async () => {
        logger.info('Encerrando HTTP server...');
        await new Promise<void>((resolve, reject) => {
          server.close((err) => {
            if (err) {
              logger.error({ error: err }, 'Erro ao fechar HTTP server');
              reject(err);
            } else {
              logger.info('HTTP server encerrado com sucesso');
              resolve();
            }
          });
        });
      },
      { priority: ShutdownPriority.HTTP_SERVER }
    );

    server.timeout = 60000;
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;

    server.on('error', (err: NodeJS.ErrnoException) => {
      logger.error({
        error: err.message,
        code: err.code,
        port,
        stack: err.stack,
      }, 'Falha crítica ao iniciar servidor HTTP - abortando');
      process.exit(1);
    });

    server.listen(port, () => {
      logger.info({
        port,
        gpuManagerUrl,
        qdrantConfigured: isQdrantConfigured(),
        qdrantUrl: readOptionalStringEnv('QDRANT_URL') ?? 'not_configured',
        architecture: {
          text: 'Qwen3-Embedding-0.6B (1024 dim) → Qdrant',
          image: 'OpenAI Vision (descrição) - sem embeddings de imagem',
        },
        circuitBreaker: 'enabled',
        gpuDedicated: true,
        redisConnected,
      }, 'RAG service iniciado - ARQUITETURA ENTERPRISE (26/12/2025) via GPU Manager Service');
    });
  } catch (error) {
    logger.error({
      error: (error as Error).message,
      stack: (error as Error).stack,
    }, 'Falha crítica ao inicializar servidor - abortando');
    process.exit(1);
  }
}
