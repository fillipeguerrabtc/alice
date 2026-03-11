import type { Express, Request, Response, RequestHandler } from 'express';
import {
  checkAllServices,
  checkServiceHealth,
  type ServiceHealthTarget,
} from './observability-health-monitor.js';

interface HealthRoutesLogger {
  debug: (obj: object | string, msg?: string) => void;
  info: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
}

interface RegisterObservabilityHealthRoutesParams {
  app: Express;
  logger: HealthRoutesLogger;
  requireObservabilityRead: RequestHandler;
  serviceTargets: ServiceHealthTarget[];
}

export function registerObservabilityHealthRoutes(params: RegisterObservabilityHealthRoutesParams): void {
  const { app, logger, requireObservabilityRead, serviceTargets } = params;

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'observability-health',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/live', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'alive',
      service: 'observability-service',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ready', async (_req: Request, res: Response) => {
    try {
      const health = await checkAllServices(serviceTargets, logger);
      const atLeastOneHealthy = health.services.some((service) => service.status === 'healthy');

      const dependencies = Object.fromEntries(
        health.services.map((service) => [
          service.name.toLowerCase(),
          service.status === 'healthy' ? 'ready' : 'not_ready',
        ]),
      );

      if (atLeastOneHealthy) {
        res.status(200).json({
          status: 'ready',
          service: 'observability-service',
          timestamp: new Date().toISOString(),
          dependencies,
        });
        return;
      }

      res.status(503).json({
        status: 'not_ready',
        service: 'observability-service',
        reason: 'Nenhum serviço de observability disponível',
        timestamp: new Date().toISOString(),
        dependencies,
      });
    } catch (error) {
      logger.error({ error }, 'Erro ao verificar readiness');
      res.status(503).json({
        status: 'not_ready',
        service: 'observability-service',
        reason: 'Erro ao verificar dependências',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get('/api/observability/health', requireObservabilityRead, async (_req: Request, res: Response) => {
    try {
      const health = await checkAllServices(serviceTargets, logger);
      const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 207 : 503;
      res.status(statusCode).json(health);
    } catch (error) {
      logger.error({ error }, 'Erro ao verificar saúde do stack');
      res.status(500).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Erro interno',
      });
    }
  });

  const serviceConfigByName = Object.fromEntries(
    serviceTargets.map((target) => [target.name.toLowerCase(), target]),
  );

  app.get('/api/observability/services/:name', requireObservabilityRead, async (req: Request, res: Response) => {
    const serviceName = req.params.name.toLowerCase();
    const config = serviceConfigByName[serviceName];

    if (!config) {
      res.status(404).json({
        error: 'Serviço não encontrado',
        available: Object.keys(serviceConfigByName),
      });
      return;
    }

    const status = await checkServiceHealth(config.name, config.baseUrl, config.healthPath, logger);
    res.json(status);
  });
}
