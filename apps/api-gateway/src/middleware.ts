import compression from 'compression';
import cors from 'cors';
import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createRateLimiter, createSecurityMiddleware } from '@alice/shared-utils';
import type { GatewayConfig, GatewayLogger } from './types.js';

export function shouldBypassCompressionForSse(req: Request): boolean {
  const acceptHeader = req.headers.accept ?? '';
  const acceptsSse = typeof acceptHeader === 'string' && acceptHeader.includes('text/event-stream');
  const isStreamPath = req.path.includes('/stream');
  return acceptsSse || isStreamPath;
}

export function configureCoreMiddleware(params: {
  app: express.Application;
  config: GatewayConfig;
  validatedCorsOrigins: string[];
  logger: GatewayLogger;
}): void {
  const { app, config, validatedCorsOrigins, logger } = params;

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const defaultCompressionFilter: (req: Request, res: Response) => boolean =
    typeof (compression as unknown as { filter?: (req: Request, res: Response) => boolean }).filter === 'function'
      ? (compression as unknown as { filter: (req: Request, res: Response) => boolean }).filter
      : () => true;

  app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
      if (shouldBypassCompressionForSse(req)) {
        logger.debug(
          { path: req.path, accept: req.headers.accept ?? null },
          'Bypass de compression para SSE/stream no API Gateway'
        );
        return false;
      }
      return defaultCompressionFilter(req, res);
    },
  }));

  app.use(createSecurityMiddleware({
    contentSecurityPolicy: config.NODE_ENV === 'production',
    isDevelopment: config.NODE_ENV === 'development',
  }));

  app.use(cors({
    origin: validatedCorsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Cookie',
      'X-Requested-With',
      'x-tenant-id',
      'x-correlation-id',
    ],
  }));

  app.use(createRateLimiter({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    max: config.RATE_LIMIT_MAX_REQUESTS,
    serviceName: 'api-gateway',
    skipRoutes: ['/health', '/api/health', '/metrics'],
  }) as RequestHandler);

  app.use(express.json({ limit: '10mb' }));
}

export function registerRequestLogger(app: express.Application, logger: GatewayLogger): void {
  const requestLogger = (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
        ip: req.ip,
      }, 'Requisição processada');
    });
    next();
  };

  app.use(requestLogger);
}

export function registerAuthRateLimiters(app: express.Application): void {
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
    keyGenerator: (req) => req.ip || 'unknown',
  });

  app.use('/api/auth/login', authLimiter as RequestHandler);
  app.use('/api/auth/register', authLimiter as RequestHandler);
}
