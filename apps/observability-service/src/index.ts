/**
 * Observability Health Checker - Alice Enterprise Platform
 *
 * Serviço de health check para o stack de observabilidade.
 * Monitora Prometheus, Grafana, Jaeger e Langfuse.
 * Expõe endpoint unificado para status do stack.
 *
 * Porta: 3007
 *
 * Documentação PT-BR (Regra 10 CLAUDE.md)
 * TypeScript strict (Regra 8 CLAUDE.md)
 */

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import compression from 'compression';
import cors from 'cors';
import { getPool } from '@alice/database';
import {
  createSecurityMiddleware,
  createRateLimiter,
  createErrorHandler,
  createNotFoundHandler,
  createAlicePrometheus,
  requirePermission,
  setupSwaggerUI,
  OBSERVABILITY_SERVICE_TAGS,
  createSessionAuthMiddleware,
  createCorrelationMiddleware,
  requireInternalHmacAuth,
} from '@alice/shared-utils';
import { createLogger } from '@alice/logger';
import { observabilityServicePaths, observabilityServiceSchemas } from './openapi-specs.js';
import { backupRouter } from './backup-orchestrator.js';
import {
  type ServiceHealthTarget,
  shutdownHealthCircuitBreakers,
} from './observability-health-monitor.js';
import { registerObservabilityHealthRoutes } from './observability-health-routes.js';
import { registerObservabilityMetricsRoutes } from './observability-metrics-routes.js';
import { registerObservabilityAdminRoutes } from './observability-admin-routes.js';
import { registerObservabilityBackupRoutes } from './observability-backup-routes.js';
import { startObservabilityBootstrap } from './observability-bootstrap.js';

const logger = createLogger('observability-health');
const isProduction = process.env.NODE_ENV === 'production';

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

if (!INTERNAL_API_SECRET && isProduction) {
  logger.error('CRITICAL: INTERNAL_API_SECRET é OBRIGATÓRIO em produção. Abortando.');
  process.exit(1);
}

function isInternalAuthValid(req: Request): boolean {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');

  if (!INTERNAL_API_SECRET && !isProduction) {
    return true;
  }

  return Boolean(token && token === INTERNAL_API_SECRET);
}

function requireInternalAuth(req: Request, res: Response, next: NextFunction): void {
  if (['/health', '/live', '/ready'].includes(req.path)) {
    next();
    return;
  }

  const hasHmacHeaders = Boolean(
    req.headers['x-internal-signature']
      && req.headers['x-internal-timestamp']
      && req.headers['x-internal-user-id']
      && req.headers['x-internal-role'],
  );
  if (hasHmacHeaders) {
    const hmacMiddleware = requireInternalHmacAuth();
    hmacMiddleware(req, res, () => {
      res.locals.internalAuthValidated = true;
      next();
    });
    return;
  }

  if (!isInternalAuthValid(req)) {
    logger.warn({ path: req.path, ip: req.ip }, 'Tentativa de acesso não autorizado');
    res.status(401).json({ error: 'Token de autenticação inválido ou ausente' });
    return;
  }

  res.locals.internalAuthValidated = true;
  next();
}

function requireInternalOrSessionAuth(req: Request, res: Response, next: NextFunction): void {
  if (['/health', '/live', '/ready'].includes(req.path)) {
    next();
    return;
  }

  if (req.user) {
    next();
    return;
  }

  requireInternalAuth(req, res, next);
}

const requireObservabilityReadPermission = requirePermission('observability:core:read');
const requireObservabilityAdminPermission = requirePermission('observability:core:admin');
const requireObservabilityLogsWritePermission = requirePermission('observability:logs:write');

function requireObservabilityRead(req: Request, res: Response, next: NextFunction): void {
  if (res.locals.internalAuthValidated === true) {
    next();
    return;
  }
  void requireObservabilityReadPermission(req, res, next);
}

function requireObservabilityAdmin(req: Request, res: Response, next: NextFunction): void {
  if (res.locals.internalAuthValidated === true) {
    next();
    return;
  }
  void requireObservabilityAdminPermission(req, res, next);
}

function requireObservabilityLogsWrite(req: Request, res: Response, next: NextFunction): void {
  if (res.locals.internalAuthValidated === true) {
    next();
    return;
  }
  void requireObservabilityLogsWritePermission(req, res, next);
}

const PORT = Number(process.env.PORT || 3007);

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://prometheus:9090';
const GRAFANA_URL = process.env.GRAFANA_URL || 'http://grafana:3000';
const JAEGER_URL = process.env.JAEGER_URL || 'http://jaeger:16686';
const LANGFUSE_URL = process.env.LANGFUSE_URL || 'http://langfuse:3000';

const BACKUP_METRICS_WINDOW_DAYS = 7;

const PROMETHEUS_EXTERNAL = process.env.PROMETHEUS_EXTERNAL_URL || 'https://metrics.yesyoudeserve.duckdns.org';
const GRAFANA_EXTERNAL = process.env.GRAFANA_EXTERNAL_URL || 'https://observability.yesyoudeserve.duckdns.org';
const JAEGER_EXTERNAL = process.env.JAEGER_EXTERNAL_URL || 'https://traces.yesyoudeserve.duckdns.org';
const LANGFUSE_EXTERNAL = process.env.LANGFUSE_EXTERNAL_URL || 'https://langfuse.yesyoudeserve.duckdns.org';

const serviceTargets: ServiceHealthTarget[] = [
  { name: 'Prometheus', baseUrl: PROMETHEUS_URL, healthPath: '/-/healthy' },
  { name: 'Grafana', baseUrl: GRAFANA_URL, healthPath: '/api/health' },
  { name: 'Jaeger', baseUrl: JAEGER_URL, healthPath: '/' },
  { name: 'Langfuse', baseUrl: LANGFUSE_URL, healthPath: '/api/public/health' },
];

const app = express();
const { registry: metricsRegistry, httpMetricsMiddleware } = createAlicePrometheus({
  serviceName: 'observability-service',
  collectDefaultMetrics: true,
});

setupSwaggerUI(app, {
  serviceName: 'observability-service',
  version: '1.0.0',
  description: 'Serviço de observabilidade: backup, restore, métricas agregadas.',
  port: PORT,
  tags: OBSERVABILITY_SERVICE_TAGS,
  paths: observabilityServicePaths,
  schemas: observabilityServiceSchemas,
});
logger.info('Swagger UI configurado em /api/docs');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(compression({ level: 6, threshold: 1024 }));

app.use(
  createSecurityMiddleware({
    contentSecurityPolicy: isProduction,
    isDevelopment: !isProduction,
  }),
);

app.use(createCorrelationMiddleware({ serviceName: 'observability-service' }));
app.use(httpMetricsMiddleware);

const corsOriginsEnv = process.env.CORS_ORIGINS;
if (!corsOriginsEnv && isProduction) {
  logger.error('CORS_ORIGINS é obrigatório em produção (Regra 6 - fail-fast)');
  process.exit(1);
}
app.use(
  cors({
    origin: corsOriginsEnv
      ? corsOriginsEnv
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean)
      : [],
    credentials: true,
  }),
);

app.use(express.json({ limit: '1mb' }));

app.use(
  createSessionAuthMiddleware({
    pool: getPool(),
    publicPaths: ['/health', '/live', '/ready', '/metrics'],
  }),
);

app.use(
  createRateLimiter({
    windowMs: 60 * 1000,
    max: 100,
    serviceName: 'observability-service',
    skipRoutes: ['/health', '/metrics'],
  }),
);

app.use(requireInternalOrSessionAuth);

registerObservabilityHealthRoutes({
  app,
  logger,
  requireObservabilityRead,
  serviceTargets,
});

registerObservabilityMetricsRoutes({
  app,
  logger,
  requireObservabilityRead,
  prometheusUrl: PROMETHEUS_URL,
  serviceTargets,
  backupMetricsWindowDays: BACKUP_METRICS_WINDOW_DAYS,
  metricsRegistry,
});

registerObservabilityAdminRoutes({
  app,
  logger,
  requireObservabilityRead,
  requireObservabilityAdmin,
  requireObservabilityLogsWrite,
  urls: {
    prometheus: { internal: PROMETHEUS_URL, external: PROMETHEUS_EXTERNAL },
    grafana: { internal: GRAFANA_URL, external: GRAFANA_EXTERNAL },
    jaeger: { internal: JAEGER_URL, external: JAEGER_EXTERNAL },
    langfuse: { internal: LANGFUSE_URL, external: LANGFUSE_EXTERNAL },
  },
});

registerObservabilityBackupRoutes({
  app,
  logger,
  requireObservabilityAdmin,
  router: backupRouter,
});

app.use(createNotFoundHandler({ serviceName: 'observability-service' }));

app.use(
  createErrorHandler({
    serviceName: 'observability-service',
    logger: {
      error: (obj: object, msg: string) => logger.error(obj, msg),
    },
  }),
);

startObservabilityBootstrap({
  app,
  logger,
  port: PORT,
  monitoredServices: {
    prometheus: PROMETHEUS_URL,
    grafana: GRAFANA_URL,
    jaeger: JAEGER_URL,
    langfuse: LANGFUSE_URL,
  },
  shutdownCircuitBreakers: () => shutdownHealthCircuitBreakers(logger),
}).catch((error) => {
  logger.error({ error }, 'Falha ao inicializar caches do observability-service');
  if (isProduction) {
    process.exit(1);
  }
});
