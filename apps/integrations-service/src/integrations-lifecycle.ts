import type { Express } from 'express';
import type { Server } from 'node:http';
import {
  registerShutdownCallback,
  ShutdownPriority,
} from '@alice/shared-utils';

interface IntegrationsLogger {
  info: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
}

interface StartIntegrationsServerParams {
  app: Express;
  port: number;
  logger: IntegrationsLogger;
}

export function startIntegrationsServer(params: StartIntegrationsServerParams): Server {
  const { app, port, logger } = params;

  const server = app.listen(port, '0.0.0.0', () => {
    logger.info({ port }, 'Integrations service started');
  });

  // SEGURANÇA: Timeouts para prevenir conexões pendentes (Node.js 20 LTS Best Practices)
  server.timeout = 180000; // 180s para requisições longas (LLM/Trading)
  server.keepAliveTimeout = 65000; // 65s (maior que ALB timeout padrão de 60s)
  server.headersTimeout = 66000; // Ligeiramente maior que keepAliveTimeout

  return server;
}

interface RegisterIntegrationsShutdownParams {
  logger: IntegrationsLogger;
  server: Server;
  closeDatabasePool: () => Promise<void>;
  stopTradingMetricsScheduler: () => void;
  stopIntegrationsImmutableAuditIntegrityScheduler: () => void;
  stopTradingSignalScheduler: () => void;
  stopTradingAnalysisScheduler: () => void;
  stopDemoScheduler: () => void;
  stopPostMortemWorker: () => void;
  closeKucoinWebSocketClients: () => void;
  closeSpotWebSocketClients: () => void;
  closeBroadcast: () => Promise<void>;
  clearIntegrationHealthInterval: () => void;
}

export function registerIntegrationsShutdownCallbacks(params: RegisterIntegrationsShutdownParams): void {
  const {
    logger,
    server,
    closeDatabasePool,
    stopTradingMetricsScheduler,
    stopIntegrationsImmutableAuditIntegrityScheduler,
    stopTradingSignalScheduler,
    stopTradingAnalysisScheduler,
    stopDemoScheduler,
    stopPostMortemWorker,
    closeKucoinWebSocketClients,
    closeSpotWebSocketClients,
    closeBroadcast,
    clearIntegrationHealthInterval,
  } = params;

  registerShutdownCallback(
    'integrations-http-server',
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
    'integrations-database-pool',
    async () => {
      logger.info('Encerrando pool de conexões database...');
      await closeDatabasePool();
      logger.info('Pool de conexões encerrado com sucesso');
    },
    { priority: ShutdownPriority.DATABASE },
  );

  registerShutdownCallback(
    'integrations-trading-metrics',
    async () => {
      stopTradingMetricsScheduler();
    },
    { priority: ShutdownPriority.BACKGROUND_JOBS },
  );

  registerShutdownCallback(
    'integrations-immutable-audit-integrity',
    async () => {
      stopIntegrationsImmutableAuditIntegrityScheduler();
    },
    { priority: ShutdownPriority.BACKGROUND_JOBS },
  );

  registerShutdownCallback(
    'integrations-trading-signal-scheduler',
    async () => {
      stopTradingSignalScheduler();
    },
    { priority: ShutdownPriority.BACKGROUND_JOBS },
  );

  registerShutdownCallback(
    'integrations-trading-analysis-scheduler',
    async () => {
      stopTradingAnalysisScheduler();
    },
    { priority: ShutdownPriority.BACKGROUND_JOBS },
  );

  registerShutdownCallback(
    'integrations-health-metrics',
    async () => {
      clearIntegrationHealthInterval();
    },
    { priority: ShutdownPriority.BACKGROUND_JOBS },
  );

  registerShutdownCallback(
    'integrations-demo-scheduler',
    async () => {
      stopDemoScheduler();
    },
    { priority: ShutdownPriority.BACKGROUND_JOBS },
  );

  registerShutdownCallback(
    'integrations-postmortem-worker',
    async () => {
      stopPostMortemWorker();
    },
    { priority: ShutdownPriority.BACKGROUND_JOBS },
  );

  registerShutdownCallback(
    'integrations-kucoin-websocket',
    async () => {
      // WS5: garante shutdown limpo dos clientes WS (evita sockets pendurados)
      closeKucoinWebSocketClients();
      closeSpotWebSocketClients();
    },
    { priority: ShutdownPriority.EXTERNAL_CONNECTIONS },
  );

  registerShutdownCallback(
    'integrations-trading-broadcast',
    async () => {
      await closeBroadcast();
    },
    { priority: ShutdownPriority.EXTERNAL_CONNECTIONS },
  );
}
