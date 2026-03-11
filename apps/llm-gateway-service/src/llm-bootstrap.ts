import type express from 'express';
import type { Logger } from 'pino';
import { closeDatabasePool, connectWithRetry } from '@alice/database';
import { registerShutdownCallback, ShutdownPriority } from '@alice/shared-utils';

export function startLlmGatewayBootstrap(params: {
  app: express.Express;
  port: number;
  logger: Logger;
}): void {
  const { app, port, logger } = params;

  registerShutdownCallback('llm-gateway-database-pool', closeDatabasePool, { priority: ShutdownPriority.DATABASE });

  connectWithRetry()
    .then(() => {
      const server = app.listen(port, () => {
        logger.info({ port }, 'LLM Gateway Service iniciado');
      });
      server.timeout = 120000;
      server.keepAliveTimeout = 125000;
      server.headersTimeout = 126000;
      server.on('error', (err) => {
        logger.error({ err }, 'Erro ao iniciar servidor');
        process.exit(1);
      });
    })
    .catch((err) => {
      logger.error({ err }, 'Falha ao conectar ao banco de dados');
      process.exit(1);
    });
}
