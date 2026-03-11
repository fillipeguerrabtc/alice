import type express from 'express';
import type { Server } from 'http';
import type { GatewayLogger, ServiceConfig } from './types.js';

export function startGatewayServer(params: {
  app: express.Application;
  port: number;
  services: ServiceConfig[];
  logger: GatewayLogger;
}): Server {
  const { app, port, services, logger } = params;

  const server = app.listen(port, '0.0.0.0', () => {
    logger.info({ port }, 'API Gateway iniciado');
    logger.info(
      { services: services.map((service) => ({ name: service.name, url: service.url })) },
      'Serviços configurados',
    );
  });

  server.timeout = 180000;
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  return server;
}
