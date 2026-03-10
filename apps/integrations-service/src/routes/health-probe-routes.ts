import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';

interface RegisterHealthProbeRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isPoolHealthy: () => Promise<boolean>;
}

export function registerHealthProbeRoutes(
  app: Express,
  deps: RegisterHealthProbeRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  app.get('/live', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'alive',
      service: 'integrations-service',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ready', async (_req: Request, res: Response) => {
    try {
      const dbHealthy = await deps.isPoolHealthy();

      if (dbHealthy) {
        res.status(200).json({
          status: 'ready',
          service: 'integrations-service',
          timestamp: new Date().toISOString(),
          dependencies: {
            postgresql: 'ready',
          },
        });
        return;
      }

      res.status(503).json({
        status: 'not_ready',
        service: 'integrations-service',
        reason: 'PostgreSQL não está acessível',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgresql: 'not_ready',
        },
      });
    } catch (error) {
      logger.error({ error }, 'Erro ao verificar readiness');
      res.status(503).json({
        status: 'not_ready',
        service: 'integrations-service',
        reason: 'Erro ao verificar dependências',
        timestamp: new Date().toISOString(),
      });
    }
  });
}
