import compression from 'compression';
import connectPgSimple from 'connect-pg-simple';
import cors from 'cors';
import express from 'express';
import type { RequestHandler } from 'express';
import session from 'express-session';
import type { PassportStatic } from 'passport';
import { resolveCorsOrigins } from '@alice/config';
import {
  AUTH_SERVICE_TAGS,
  createAlicePrometheus,
  createCorrelationMiddleware,
  createRateLimiter,
  createSecurityMiddleware,
  initRbacPrometheusMetrics,
  setupSwaggerUI,
} from '@alice/shared-utils';
import { getPool } from '@alice/database';
import type { createLogger } from '@alice/logger';
import { authServicePaths, authServiceSchemas } from './openapi-specs.js';

export interface AuthMiddlewareConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  SESSION_SECRET: string;
}

export type AuthLogger = ReturnType<typeof createLogger>;
export type AuthPrometheusMetrics = ReturnType<typeof createAlicePrometheus>['metrics'];

interface SetupAuthServiceMiddlewaresParams {
  app: express.Express;
  config: AuthMiddlewareConfig;
  serviceBaseUrl: string;
  csrfProtection: RequestHandler;
  passport: PassportStatic;
  logger: AuthLogger;
}

interface SetupAuthServiceMiddlewaresResult {
  metrics: AuthPrometheusMetrics;
}

export function setupAuthServiceMiddlewares(
  params: SetupAuthServiceMiddlewaresParams,
): SetupAuthServiceMiddlewaresResult {
  const {
    app,
    config,
    serviceBaseUrl,
    csrfProtection,
    passport,
    logger,
  } = params;

  const { metrics, metricsRouter, httpMetricsMiddleware } = createAlicePrometheus({
    serviceName: 'auth-service',
    collectDefaultMetrics: true,
  });

  initRbacPrometheusMetrics(metrics.rbac);
  logger.info('Métricas RBAC Prometheus inicializadas no auth-service');

  app.use(metricsRouter);

  setupSwaggerUI(app, {
    serviceName: 'auth-service',
    version: '1.0.0',
    description: 'Serviço de autenticação enterprise com OAuth 2.0, SAML 2.0, OIDC e RBAC.',
    port: config.PORT ?? 3001,
    tags: AUTH_SERVICE_TAGS,
    paths: authServicePaths,
    schemas: authServiceSchemas,
  });
  logger.info('Swagger UI configurado em /api/docs');

  app.use(httpMetricsMiddleware);

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(createSecurityMiddleware({
    contentSecurityPolicy: config.NODE_ENV === 'production',
    isDevelopment: config.NODE_ENV !== 'production',
  }));

  app.use(createCorrelationMiddleware({ serviceName: 'auth-service' }));

  app.use(compression());

  app.use(createRateLimiter({
    windowMs: 60 * 1000,
    max: 100,
    skipRoutes: ['/api/auth/health', '/api/auth/google', '/api/auth/github', '/api/auth/saml'],
    serviceName: 'auth-service',
  }));

  const corsOrigins = resolveCorsOrigins({
    requiredInProduction: true,
    developmentFallback: [serviceBaseUrl],
  });

  app.use(cors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  }));

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  const PgSession = connectPgSimple(session);
  const pool = getPool();

  app.use(session({
    store: new PgSession({
      pool,
      tableName: 'sessions',
      createTableIfMissing: true,
    }),
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: config.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: config.NODE_ENV === 'production' ? 'strict' : 'lax',
    },
    name: 'alice.sid',
  }));

  app.use(passport.initialize());
  app.use(passport.session());

  app.use(csrfProtection);

  return { metrics };
}
