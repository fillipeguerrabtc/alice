import type express from 'express';
import type { Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Options } from 'http-proxy-middleware';
import { shouldBypassCompressionForSse } from './middleware.js';
import type { GatewayLogger, ServiceConfig } from './types.js';

const LONG_RUNNING_PROXY_TIMEOUT_MS = 180000;

function createServiceProxy(service: ServiceConfig, logger: GatewayLogger): Options {
  return {
    target: service.url,
    changeOrigin: true,
    pathRewrite: undefined,
    on: {
      proxyReq: (_proxyReq, req) => {
        const request = req as Request;
        logger.debug({
          service: service.name,
          path: request.path,
          method: request.method,
        }, 'Proxy request');
      },
      proxyRes: (proxyRes, req, res) => {
        const request = req as Request;
        const response = res as Response;
        const contentTypeHeader = proxyRes.headers['content-type'];
        const contentType = Array.isArray(contentTypeHeader)
          ? contentTypeHeader.join(';')
          : (contentTypeHeader ?? '');

        const isSseResponse =
          (typeof contentType === 'string' && contentType.includes('text/event-stream'))
          || shouldBypassCompressionForSse(request);

        if (isSseResponse) {
          response.setHeader('Cache-Control', 'no-cache, no-transform');
          response.setHeader('Connection', 'keep-alive');
          response.setHeader('X-Accel-Buffering', 'no');
          logger.debug(
            {
              service: service.name,
              path: request.path,
              contentType: typeof contentType === 'string' ? contentType : null,
            },
            'Headers anti-buffer aplicados para proxy SSE',
          );
        }
      },
      error: (err, _req, res) => {
        logger.error({ error: err, service: service.name }, 'Erro no proxy');
        if (res && 'writeHead' in res && typeof res.writeHead === 'function') {
          const response = res as Response;
          if (!response.headersSent) {
            response.status(503).json({
              error: 'Serviço temporariamente indisponível',
              service: service.name,
            });
          }
        }
      },
    },
  };
}

function createLongRunningProxy(service: ServiceConfig, logger: GatewayLogger): Options {
  return {
    ...createServiceProxy(service, logger),
    timeout: LONG_RUNNING_PROXY_TIMEOUT_MS,
    proxyTimeout: LONG_RUNNING_PROXY_TIMEOUT_MS,
  };
}

export function registerGatewayProxies(params: {
  app: express.Application;
  services: ServiceConfig[];
  integrationsService: ServiceConfig | null;
  logger: GatewayLogger;
}): void {
  const {
    app,
    services,
    integrationsService,
    logger,
  } = params;

  if (integrationsService) {
    app.use(
      '/api/integrations/trading/signals/generate',
      createProxyMiddleware(createLongRunningProxy(integrationsService, logger)),
    );
    app.use(
      '/api/integrations/trading/analysis',
      createProxyMiddleware(createLongRunningProxy(integrationsService, logger)),
    );
  }

  services.forEach((service) => {
    app.use(service.pathPrefix, createProxyMiddleware(createServiceProxy(service, logger)));
    logger.info({ service: service.name, prefix: service.pathPrefix, target: service.url }, 'Proxy configurado');
  });
}
