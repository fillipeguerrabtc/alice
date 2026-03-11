import type { Server } from 'http';
import {
  registerShutdownCallback,
  ShutdownPriority,
} from '@alice/shared-utils';
import type { GatewayCircuitBreakers, GatewayLogger } from './types.js';

export function registerGatewayShutdownCallbacks(params: {
  server: Server;
  circuitBreakers: GatewayCircuitBreakers;
  logger: GatewayLogger;
}): void {
  const { server, circuitBreakers, logger } = params;

  registerShutdownCallback(
    'api-gateway-circuit-breakers',
    async () => {
      logger.info('Encerrando circuit breakers...');
      circuitBreakers.forEach((breaker, name) => {
        breaker.shutdown();
        logger.info({ service: name }, 'Circuit breaker encerrado');
      });
    },
    { priority: ShutdownPriority.EXTERNAL_CONNECTIONS },
  );

  registerShutdownCallback(
    'api-gateway-http-server',
    async () => {
      logger.info('Encerrando HTTP server...');
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            logger.error({ error: err }, 'Erro ao fechar HTTP server');
            reject(err);
            return;
          }

          logger.info('HTTP server encerrado com sucesso');
          resolve();
        });
      });
    },
    { priority: ShutdownPriority.HTTP_SERVER },
  );
}
