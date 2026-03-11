import type express from 'express';
import type { Request, Response } from 'express';
import CircuitBreaker from 'opossum';
import {
  CIRCUIT_BREAKER_PRESETS,
  createCircuitBreaker,
} from '@alice/shared-utils';
import type { GatewayCircuitBreakers, ServiceConfig } from './types.js';

interface HealthCheckFunction {
  (): Promise<{ status: string; service: string }>;
}

interface ServiceHealthResult {
  name: string;
  status: string;
  circuit?: string;
}

export function createServiceCircuitBreakers(services: ServiceConfig[]): GatewayCircuitBreakers {
  const circuitBreakers = new Map<string, CircuitBreaker>();

  services.forEach((service) => {
    const healthCheck: HealthCheckFunction = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(`${service.url}${service.healthPath}`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Serviço ${service.name} não está saudável`);
        }

        return { status: 'ok', service: service.name };
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    };

    const breaker = createCircuitBreaker(healthCheck, {
      name: `health-${service.name}`,
      ...CIRCUIT_BREAKER_PRESETS.healthCheck,
      timeout: 10000,
    });

    circuitBreakers.set(service.name, breaker);
  });

  return circuitBreakers;
}

export function registerHealthRoutes(
  app: express.Application,
  services: ServiceConfig[],
  circuitBreakers: GatewayCircuitBreakers,
): void {
  app.get('/api/health', async (_req: Request, res: Response) => {
    const healthResults: Record<string, unknown> = {
      gateway: { status: 'ok', timestamp: new Date().toISOString() },
      services: {},
    };

    const serviceChecks = await Promise.allSettled(
      services.map(async (service) => {
        const breaker = circuitBreakers.get(service.name);
        if (!breaker) {
          return { name: service.name, status: 'unknown' };
        }

        try {
          await breaker.fire();
          return { name: service.name, status: 'ok', circuit: 'closed' };
        } catch {
          return {
            name: service.name,
            status: 'error',
            circuit: breaker.opened ? 'open' : 'closed',
          };
        }
      }),
    );

    let allHealthy = true;
    serviceChecks.forEach((result) => {
      if (result.status === 'fulfilled') {
        const serviceResult = result.value as ServiceHealthResult;
        (healthResults.services as Record<string, unknown>)[serviceResult.name] = {
          status: serviceResult.status,
          circuit: serviceResult.circuit ?? 'unknown',
        };

        if (serviceResult.status !== 'ok') {
          allHealthy = false;
        }
      } else {
        allHealthy = false;
      }
    });

    healthResults.overall = allHealthy ? 'healthy' : 'degraded';
    res.status(allHealthy ? 200 : 503).json(healthResults);
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'api-gateway', timestamp: new Date().toISOString() });
  });

  app.get('/live', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'alive',
      service: 'api-gateway',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ready', async (_req: Request, res: Response) => {
    let atLeastOneServiceUp = false;
    const serviceStatuses: Record<string, string> = {};

    const checks = await Promise.allSettled(
      services.map(async (service) => {
        const breaker = circuitBreakers.get(service.name);
        if (!breaker) {
          return { name: service.name, ready: false };
        }

        try {
          await breaker.fire();
          return { name: service.name, ready: true };
        } catch {
          return { name: service.name, ready: false };
        }
      }),
    );

    checks.forEach((result) => {
      if (result.status === 'fulfilled') {
        const { name, ready } = result.value;
        serviceStatuses[name] = ready ? 'ready' : 'not_ready';

        if (ready) {
          atLeastOneServiceUp = true;
        }
      }
    });

    if (atLeastOneServiceUp) {
      res.status(200).json({
        status: 'ready',
        service: 'api-gateway',
        timestamp: new Date().toISOString(),
        backends: serviceStatuses,
      });
      return;
    }

    res.status(503).json({
      status: 'not_ready',
      service: 'api-gateway',
      reason: 'Nenhum serviço backend disponível',
      timestamp: new Date().toISOString(),
      backends: serviceStatuses,
    });
  });

  app.get('/metrics', (_req: Request, res: Response) => {
    const metrics: string[] = [];

    circuitBreakers.forEach((breaker, serviceName) => {
      const stats = breaker.stats;
      metrics.push(`# HELP circuit_breaker_${serviceName}_fires Total de requisições`);
      metrics.push(`circuit_breaker_${serviceName}_fires ${stats.fires}`);
      metrics.push(`circuit_breaker_${serviceName}_failures ${stats.failures}`);
      metrics.push(`circuit_breaker_${serviceName}_successes ${stats.successes}`);
      metrics.push(`circuit_breaker_${serviceName}_timeouts ${stats.timeouts}`);
      metrics.push(`circuit_breaker_${serviceName}_state ${breaker.opened ? 1 : 0}`);
    });

    res.type('text/plain').send(metrics.join('\n'));
  });
}
