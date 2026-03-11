import type express from 'express';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { createErrorHandler, createNotFoundHandler } from '@alice/shared-utils';
import type { GatewayLogger } from './types.js';

export function registerGatewayErrorHandlers(
  app: express.Application,
  logger: GatewayLogger,
): void {
  app.use(createNotFoundHandler({ serviceName: 'api-gateway' }) as RequestHandler);

  app.use(createErrorHandler({
    serviceName: 'api-gateway',
    logger: {
      error: (obj: object, msg: string) => logger.error(obj, msg),
    },
  }) as ErrorRequestHandler);
}
