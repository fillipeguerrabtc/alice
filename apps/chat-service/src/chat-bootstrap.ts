import type { Server } from 'http';
import { ShutdownPriority, registerShutdownCallback } from '@alice/shared-utils';

interface ChatBootstrapLogger {
  info: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  fatal: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
}

interface StartChatServiceParams {
  logger: ChatBootstrapLogger;
  server: Server;
  port: number;
  initializeAllCaches: () => Promise<void>;
  initializeTradingBroadcastSubscriber: () => Promise<void>;
  initializeRuntimeAnnouncementSubscriber: () => Promise<void>;
  ensureCambioResources: () => Promise<void>;
  refreshSlaMetricsForAllTenants: () => Promise<void>;
  slaMetricsRefreshMs: number;
  onSlaIntervalRegistered: (interval: NodeJS.Timeout) => void;
  getSessionCacheDistributed: () => boolean;
  getRbacCacheDistributed: () => boolean;
}

interface RegisterChatShutdownCallbacksParams {
  logger: ChatBootstrapLogger;
  server: Server;
  clearHeartbeatInterval: () => void;
  clearRateLimitCleanupInterval: () => void;
  clearAuthCleanupInterval: () => void;
  clearSlaMetricsInterval: () => void;
  closeMainWebSocketServer: () => Promise<void>;
  closeAgentWebSocketServer: () => Promise<void>;
  closePermissionCache: () => Promise<void>;
  closeTradingBroadcastSubscriber: () => Promise<void>;
  closeRuntimeAnnouncementSubscriber: () => Promise<void>;
  closeRedisCacheClient: () => Promise<void>;
  closeDatabasePool: () => Promise<void>;
}

export async function startChatService(params: StartChatServiceParams): Promise<void> {
  const {
    logger,
    server,
    port,
    initializeAllCaches,
    initializeTradingBroadcastSubscriber,
    initializeRuntimeAnnouncementSubscriber,
    ensureCambioResources,
    refreshSlaMetricsForAllTenants,
    slaMetricsRefreshMs,
    onSlaIntervalRegistered,
    getSessionCacheDistributed,
    getRbacCacheDistributed,
  } = params;

  try {
    await initializeAllCaches();
    await initializeTradingBroadcastSubscriber();
    await initializeRuntimeAnnouncementSubscriber();
    await ensureCambioResources();

    await new Promise<void>((resolve) => {
      server.listen(port, () => {
        resolve();
      });
    });

    logger.info(
      {
        port,
        llmConfigured: true,
        circuitBreaker: 'enabled',
        sessionCacheDistributed: getSessionCacheDistributed(),
        rbacCacheDistributed: getRbacCacheDistributed(),
      },
      'Chat service iniciado com Circuit Breaker e caches distribuídos',
    );

    refreshSlaMetricsForAllTenants().catch((error) => {
      logger.warn({ error }, 'Falha ao atualizar métricas SLA no startup');
    });

    const interval = setInterval(() => {
      refreshSlaMetricsForAllTenants().catch((error) => {
        logger.warn({ error }, 'Falha ao atualizar métricas SLA');
      });
    }, slaMetricsRefreshMs);

    onSlaIntervalRegistered(interval);
  } catch (error) {
    logger.fatal({ error: (error as Error).message }, 'Falha ao iniciar chat-service');
    throw error;
  }
}

export function registerChatShutdownCallbacks(params: RegisterChatShutdownCallbacksParams): void {
  const {
    logger,
    server,
    clearHeartbeatInterval,
    clearRateLimitCleanupInterval,
    clearAuthCleanupInterval,
    clearSlaMetricsInterval,
    closeMainWebSocketServer,
    closeAgentWebSocketServer,
    closePermissionCache,
    closeTradingBroadcastSubscriber,
    closeRuntimeAnnouncementSubscriber,
    closeRedisCacheClient,
    closeDatabasePool,
  } = params;

  registerShutdownCallback(
    'chat-background-intervals',
    async () => {
      logger.info('Limpando background intervals...');
      clearHeartbeatInterval();
      clearRateLimitCleanupInterval();
      clearAuthCleanupInterval();
      clearSlaMetricsInterval();
      logger.info('Background intervals limpos');
    },
    { priority: ShutdownPriority.BACKGROUND_JOBS },
  );

  registerShutdownCallback(
    'chat-websocket-server',
    async () => {
      logger.info('Encerrando WebSocket server...');
      await closeMainWebSocketServer();
      await closeAgentWebSocketServer();
      logger.info('WebSocket server fechado');
    },
    { priority: ShutdownPriority.WEBSOCKET },
  );

  registerShutdownCallback(
    'chat-http-server',
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
    { priority: ShutdownPriority.HTTP_SERVER },
  );

  registerShutdownCallback(
    'chat-permission-cache',
    async () => {
      logger.info('Encerrando cache de permissões RBAC...');
      await closePermissionCache();
      logger.info('Cache de permissões encerrado');
    },
    { priority: ShutdownPriority.BACKGROUND_JOBS - 5 },
  );

  registerShutdownCallback(
    'chat-trading-broadcast',
    async () => {
      await closeTradingBroadcastSubscriber();
    },
    { priority: ShutdownPriority.BACKGROUND_JOBS - 8 },
  );

  registerShutdownCallback(
    'chat-runtime-announcements',
    async () => {
      await closeRuntimeAnnouncementSubscriber();
    },
    { priority: ShutdownPriority.BACKGROUND_JOBS - 9 },
  );

  registerShutdownCallback(
    'chat-redis-cache',
    async () => {
      logger.info('Encerrando cliente Redis cache...');
      await closeRedisCacheClient();
      logger.info('Cliente Redis cache encerrado');
    },
    { priority: ShutdownPriority.BACKGROUND_JOBS - 10 },
  );

  registerShutdownCallback(
    'chat-database-pool',
    async () => {
      logger.info('Encerrando pool de conexões database...');
      await closeDatabasePool();
      logger.info('Pool de conexões encerrado com sucesso');
    },
    { priority: ShutdownPriority.DATABASE },
  );
}
