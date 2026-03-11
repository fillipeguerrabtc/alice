import type { Express, Request, Response, RequestHandler } from 'express';
import {
  listCircuitBreakerSnapshots,
  circuitBreakerOptions,
} from './observability-health-monitor.js';

interface AdminRoutesLogger {
  debug: (obj: object | string, msg?: string) => void;
  info: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
}

interface FrontendLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
  service: string;
}

const frontendLogSchema = {
  validate(body: unknown): body is FrontendLogEntry {
    if (!body || typeof body !== 'object') return false;
    const log = body as Record<string, unknown>;
    return (
      typeof log.level === 'string'
      && ['debug', 'info', 'warn', 'error'].includes(log.level)
      && typeof log.message === 'string'
      && typeof log.timestamp === 'string'
      && typeof log.service === 'string'
    );
  },
};

interface RegisterObservabilityAdminRoutesParams {
  app: Express;
  logger: AdminRoutesLogger;
  requireObservabilityRead: RequestHandler;
  requireObservabilityAdmin: RequestHandler;
  requireObservabilityLogsWrite: RequestHandler;
  urls: {
    prometheus: { internal: string; external: string };
    grafana: { internal: string; external: string };
    jaeger: { internal: string; external: string };
    langfuse: { internal: string; external: string };
  };
}

export function registerObservabilityAdminRoutes(params: RegisterObservabilityAdminRoutesParams): void {
  const {
    app,
    logger,
    requireObservabilityRead,
    requireObservabilityAdmin,
    requireObservabilityLogsWrite,
    urls,
  } = params;

  app.post('/api/observability/logs', requireObservabilityLogsWrite, (req: Request, res: Response) => {
    try {
      const body = req.body;
      if (!frontendLogSchema.validate(body)) {
        res.status(400).json({ error: 'Formato de log inválido' });
        return;
      }

      if (body.level === 'error') {
        logger.error(
          {
            frontendLog: true,
            originalTimestamp: body.timestamp,
            frontendService: body.service,
            ...body.context,
          },
          `[FRONTEND] ${body.message}`,
        );
      } else if (body.level === 'warn') {
        logger.warn(
          {
            frontendLog: true,
            originalTimestamp: body.timestamp,
            frontendService: body.service,
            ...body.context,
          },
          `[FRONTEND] ${body.message}`,
        );
      } else if (body.level === 'info') {
        logger.info(
          {
            frontendLog: true,
            originalTimestamp: body.timestamp,
            frontendService: body.service,
            ...body.context,
          },
          `[FRONTEND] ${body.message}`,
        );
      } else {
        logger.debug(
          {
            frontendLog: true,
            originalTimestamp: body.timestamp,
            frontendService: body.service,
            ...body.context,
          },
          `[FRONTEND] ${body.message}`,
        );
      }

      res.status(202).json({ received: true });
    } catch (error) {
      logger.error({ error }, 'Erro ao processar log do frontend');
      res.status(500).json({ error: 'Erro interno' });
    }
  });

  app.get('/api/observability/circuit-breakers', requireObservabilityRead, (_req: Request, res: Response) => {
    const statuses = listCircuitBreakerSnapshots().map((snapshot) => ({
      name: snapshot.name,
      state: snapshot.state,
      stats: snapshot.stats,
      config: {
        timeout: circuitBreakerOptions.timeout,
        errorThresholdPercentage: circuitBreakerOptions.errorThresholdPercentage,
        resetTimeout: circuitBreakerOptions.resetTimeout,
      },
    }));

    res.json({
      circuitBreakers: statuses,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/observability/urls', requireObservabilityAdmin, (_req: Request, res: Response) => {
    res.json({
      prometheus: {
        internal: urls.prometheus.internal,
        external: urls.prometheus.external,
        description: 'Métricas e alertas',
      },
      grafana: {
        internal: urls.grafana.internal,
        external: urls.grafana.external,
        description: 'Dashboards e visualização',
      },
      jaeger: {
        internal: urls.jaeger.internal,
        external: urls.jaeger.external,
        description: 'Distributed tracing',
      },
      langfuse: {
        internal: urls.langfuse.internal,
        external: urls.langfuse.external,
        description: 'Métricas LLM específicas',
      },
    });
  });
}
