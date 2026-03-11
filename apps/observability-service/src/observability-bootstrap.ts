import type { Express } from 'express';
import {
  initializeSessionAuthCache,
  initializeRedisCache,
  registerShutdownCallback,
  ShutdownPriority,
} from '@alice/shared-utils';

interface ObservabilityBootstrapLogger {
  info: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
}

interface StartObservabilityBootstrapParams {
  app: Express;
  logger: ObservabilityBootstrapLogger;
  port: number;
  monitoredServices: {
    prometheus: string;
    grafana: string;
    jaeger: string;
    langfuse: string;
  };
  shutdownCircuitBreakers: () => void;
}

export async function startObservabilityBootstrap(
  params: StartObservabilityBootstrapParams,
): Promise<void> {
  const { app, logger, port, monitoredServices, shutdownCircuitBreakers } = params;

  const redisConnected = await initializeRedisCache();
  logger.info({ redisConnected }, 'Redis cache inicializado');

  await initializeSessionAuthCache();
  logger.info('Session auth cache inicializado');

  const server = app.listen(port, () => {
    logger.info({ port }, 'Observability Health Checker iniciado');
    logger.info(monitoredServices, 'Monitorando serviços de observabilidade');
  });

  server.timeout = 30000;
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  registerShutdownCallback(
    'observability-circuit-breakers',
    async () => {
      logger.info('Encerrando circuit breakers de health check...');
      shutdownCircuitBreakers();
    },
    { priority: ShutdownPriority.EXTERNAL_CONNECTIONS },
  );

  registerShutdownCallback(
    'observability-http-server',
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
}
