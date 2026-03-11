import CircuitBreaker from 'opossum';

export interface ServiceStatus {
  name: string;
  url: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  latencyMs: number;
  lastCheck: string;
  error?: string;
  circuitBreakerState?: 'closed' | 'open' | 'half-open';
}

export interface StackHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  services: ServiceStatus[];
  uptimeSeconds: number;
}

export interface ServiceHealthTarget {
  name: string;
  baseUrl: string;
  healthPath: string;
}

interface HealthMonitorLogger {
  debug: (obj: object | string, msg?: string) => void;
  info: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
}

const startTime = Date.now();

export const circuitBreakerOptions: CircuitBreaker.Options = {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  volumeThreshold: 5,
  rollingCountTimeout: 10000,
};

const circuitBreakers = new Map<string, CircuitBreaker<[string, string, string], ServiceStatus>>();

async function checkServiceHealthInternal(
  name: string,
  baseUrl: string,
  healthPath: string,
  logger: HealthMonitorLogger,
): Promise<ServiceStatus> {
  const url = `${baseUrl}${healthPath}`;
  const startMs = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startMs;

    if (response.ok) {
      logger.debug({ service: name, latencyMs }, 'Serviço saudável');
      return {
        name,
        url: baseUrl,
        status: 'healthy',
        latencyMs,
        lastCheck: new Date().toISOString(),
      };
    }

    throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startMs;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';

    logger.error({ service: name, error: errorMessage }, 'Falha ao verificar serviço');

    throw Object.assign(new Error(errorMessage), {
      serviceStatus: {
        name,
        url: baseUrl,
        status: 'unhealthy' as const,
        latencyMs,
        lastCheck: new Date().toISOString(),
        error: errorMessage,
      },
    });
  }
}

function getOrCreateBreaker(
  name: string,
  logger: HealthMonitorLogger,
): CircuitBreaker<[string, string, string], ServiceStatus> {
  const existing = circuitBreakers.get(name);
  if (existing) return existing;

  const breaker = new CircuitBreaker(
    (serviceName: string, baseUrl: string, healthPath: string) =>
      checkServiceHealthInternal(serviceName, baseUrl, healthPath, logger),
    {
      ...circuitBreakerOptions,
      name: `health-check-${name}`,
    },
  );

  breaker.on('open', () => {
    logger.warn({ service: name }, 'Circuit breaker ABERTO - serviço temporariamente ignorado');
  });

  breaker.on('halfOpen', () => {
    logger.info({ service: name }, 'Circuit breaker HALF-OPEN - testando serviço');
  });

  breaker.on('close', () => {
    logger.info({ service: name }, 'Circuit breaker FECHADO - serviço recuperado');
  });

  breaker.on('fallback', () => {
    logger.debug({ service: name }, 'Circuit breaker fallback acionado');
  });

  circuitBreakers.set(name, breaker);
  return breaker;
}

function getBreakerState(name: string): 'closed' | 'open' | 'half-open' {
  const breaker = circuitBreakers.get(name);
  if (!breaker) return 'closed';
  if (breaker.opened) return 'open';
  if (breaker.halfOpen) return 'half-open';
  return 'closed';
}

export async function checkServiceHealth(
  name: string,
  baseUrl: string,
  healthPath: string,
  logger: HealthMonitorLogger,
): Promise<ServiceStatus> {
  const breaker = getOrCreateBreaker(name, logger);
  const startMs = Date.now();

  try {
    const result = await breaker.fire(name, baseUrl, healthPath);
    return {
      ...result,
      circuitBreakerState: getBreakerState(name),
    };
  } catch (error: unknown) {
    const latencyMs = Date.now() - startMs;

    if (error && typeof error === 'object' && 'serviceStatus' in error) {
      const typedError = error as { serviceStatus: ServiceStatus };
      return {
        ...typedError.serviceStatus,
        circuitBreakerState: getBreakerState(name),
      };
    }

    if (error instanceof Error && error.message.includes('Breaker is open')) {
      logger.debug({ service: name }, 'Health check ignorado - circuit breaker aberto');
      return {
        name,
        url: baseUrl,
        status: 'unknown',
        latencyMs,
        lastCheck: new Date().toISOString(),
        error: 'Circuit breaker aberto - serviço temporariamente ignorado',
        circuitBreakerState: 'open',
      };
    }

    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return {
      name,
      url: baseUrl,
      status: 'unhealthy',
      latencyMs,
      lastCheck: new Date().toISOString(),
      error: errorMessage,
      circuitBreakerState: getBreakerState(name),
    };
  }
}

export async function checkAllServices(
  targets: ServiceHealthTarget[],
  logger: HealthMonitorLogger,
): Promise<StackHealth> {
  const checks = await Promise.all(
    targets.map((target) => checkServiceHealth(target.name, target.baseUrl, target.healthPath, logger)),
  );

  const healthyCount = checks.filter((service) => service.status === 'healthy').length;
  const totalCount = checks.length;

  let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  if (healthyCount === totalCount) {
    overallStatus = 'healthy';
  } else if (healthyCount > 0) {
    overallStatus = 'degraded';
  } else {
    overallStatus = 'unhealthy';
  }

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    services: checks,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
  };
}

export interface CircuitBreakerSnapshot {
  name: string;
  state: 'closed' | 'open' | 'half-open';
  stats: {
    fires: number;
    failures: number;
    successes: number;
    timeouts: number;
    fallbacks: number;
    rejects: number;
  };
}

export function listCircuitBreakerSnapshots(): CircuitBreakerSnapshot[] {
  return Array.from(circuitBreakers.entries()).map(([name, breaker]) => ({
    name,
    state: breaker.opened ? 'open' : breaker.halfOpen ? 'half-open' : 'closed',
    stats: {
      fires: breaker.stats.fires,
      failures: breaker.stats.failures,
      successes: breaker.stats.successes,
      timeouts: breaker.stats.timeouts,
      fallbacks: breaker.stats.fallbacks,
      rejects: breaker.stats.rejects,
    },
  }));
}

export function shutdownHealthCircuitBreakers(logger: HealthMonitorLogger): void {
  circuitBreakers.forEach((breaker, name) => {
    breaker.shutdown();
    logger.info({ service: name }, 'Circuit breaker encerrado');
  });
}
