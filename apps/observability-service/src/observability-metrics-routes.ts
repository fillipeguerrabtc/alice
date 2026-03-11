import type { Express, Request, Response, RequestHandler } from 'express';
import { getDatabase, schema, and, eq, gte, sql } from '@alice/database';
import {
  checkAllServices,
  listCircuitBreakerSnapshots,
  type ServiceHealthTarget,
} from './observability-health-monitor.js';

interface MetricsRoutesLogger {
  debug: (obj: object | string, msg?: string) => void;
  info: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
}

type PrometheusVectorResult = {
  metric: Record<string, string>;
  value: [number, string];
};

type PrometheusQueryResponse = {
  status: 'success' | 'error';
  data?: {
    resultType: 'vector';
    result: PrometheusVectorResult[];
  };
  error?: string;
};

interface RegisterObservabilityMetricsRoutesParams {
  app: Express;
  logger: MetricsRoutesLogger;
  requireObservabilityRead: RequestHandler;
  prometheusUrl: string;
  serviceTargets: ServiceHealthTarget[];
  backupMetricsWindowDays: number;
}

async function queryPrometheus(prometheusUrl: string, query: string): Promise<PrometheusVectorResult[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${prometheusUrl}/api/v1/query?query=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Prometheus HTTP ${response.status}`);
    }

    const payload = (await response.json()) as PrometheusQueryResponse;
    if (payload.status !== 'success') {
      throw new Error(payload.error || 'Prometheus retornou status de erro');
    }

    return payload.data?.result ?? [];
  } finally {
    clearTimeout(timeoutId);
  }
}

function vectorToMap(result: PrometheusVectorResult[], labelKey: string): Map<string, number> {
  const output = new Map<string, number>();
  for (const item of result) {
    const key = item.metric[labelKey];
    if (!key) continue;
    const value = Number(item.value[1]);
    if (!Number.isFinite(value)) continue;
    output.set(key, value);
  }
  return output;
}

async function loadBackupJobCounts(windowDays: number): Promise<{ completed: number; failed: number }> {
  const db = getDatabase();
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [completed] = await db
    .select({ value: sql<number>`count(*)` })
    .from(schema.backupJobs)
    .where(and(eq(schema.backupJobs.status, 'completed'), gte(schema.backupJobs.completedAt, since)));

  const [failed] = await db
    .select({ value: sql<number>`count(*)` })
    .from(schema.backupJobs)
    .where(and(eq(schema.backupJobs.status, 'failed'), gte(schema.backupJobs.completedAt, since)));

  return {
    completed: Number(completed?.value ?? 0),
    failed: Number(failed?.value ?? 0),
  };
}

export function registerObservabilityMetricsRoutes(params: RegisterObservabilityMetricsRoutesParams): void {
  const {
    app,
    logger,
    requireObservabilityRead,
    prometheusUrl,
    serviceTargets,
    backupMetricsWindowDays,
  } = params;

  app.get('/api/observability/metrics/services', requireObservabilityRead, async (_req: Request, res: Response) => {
    try {
      const [upResult, uptimeResult, requestsResult, latencyResult] = await Promise.all([
        queryPrometheus(prometheusUrl, 'up{job="alice-services"}'),
        queryPrometheus(
          prometheusUrl,
          'avg by (service) (time() - process_start_time_seconds{job="alice-services"})',
        ),
        queryPrometheus(
          prometheusUrl,
          'sum by (service) (rate(alice_http_requests_total{job="alice-services"}[5m])) * 60',
        ),
        queryPrometheus(
          prometheusUrl,
          'sum by (service) (rate(alice_http_request_duration_seconds_sum{job="alice-services"}[5m])) / sum by (service) (rate(alice_http_request_duration_seconds_count{job="alice-services"}[5m]))',
        ),
      ]);

      const upMap = vectorToMap(upResult, 'service');
      const uptimeMap = vectorToMap(uptimeResult, 'service');
      const requestsMap = vectorToMap(requestsResult, 'service');
      const latencyMap = vectorToMap(latencyResult, 'service');

      const serviceNames = new Set<string>([
        ...upMap.keys(),
        ...uptimeMap.keys(),
        ...requestsMap.keys(),
        ...latencyMap.keys(),
      ]);

      const services = Array.from(serviceNames).map((serviceName) => {
        const upValue = upMap.get(serviceName);
        const status = upValue === 1 ? 'healthy' : upValue === 0 ? 'unhealthy' : 'unknown';
        const avgLatencySeconds = latencyMap.get(serviceName);
        return {
          name: serviceName,
          status,
          uptime: uptimeMap.get(serviceName) ?? 0,
          requestsPerMinute: requestsMap.get(serviceName) ?? 0,
          avgLatency: avgLatencySeconds ? Math.round(avgLatencySeconds * 1000) : 0,
        };
      });

      res.json({ services, timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error({ error }, 'Falha ao coletar métricas de serviços via Prometheus');
      res.status(500).json({ error: 'Falha ao consultar Prometheus' });
    }
  });

  app.get(
    '/api/observability/metrics/circuit-breakers',
    requireObservabilityRead,
    async (_req: Request, res: Response) => {
      try {
        const [stateResult, failuresResult, successesResult] = await Promise.all([
          queryPrometheus(prometheusUrl, 'alice_circuit_breaker_state{job="alice-services"}'),
          queryPrometheus(
            prometheusUrl,
            'sum by (service, name) (rate(alice_circuit_breaker_failures_total{job="alice-services"}[5m])) * 60',
          ),
          queryPrometheus(
            prometheusUrl,
            'sum by (service, name) (rate(alice_circuit_breaker_successes_total{job="alice-services"}[5m])) * 60',
          ),
        ]);

        const stateMap = new Map<string, number>();
        const failuresMap = new Map<string, number>();
        const successesMap = new Map<string, number>();

        for (const item of stateResult) {
          const name = item.metric.name;
          const service = item.metric.service || 'unknown';
          if (!name) continue;
          const key = `${service}:${name}`;
          const value = Number(item.value[1]);
          if (!Number.isFinite(value)) continue;
          stateMap.set(key, value);
        }

        for (const item of failuresResult) {
          const name = item.metric.name;
          const service = item.metric.service || 'unknown';
          if (!name) continue;
          const key = `${service}:${name}`;
          const value = Number(item.value[1]);
          if (!Number.isFinite(value)) continue;
          failuresMap.set(key, value);
        }

        for (const item of successesResult) {
          const name = item.metric.name;
          const service = item.metric.service || 'unknown';
          if (!name) continue;
          const key = `${service}:${name}`;
          const value = Number(item.value[1]);
          if (!Number.isFinite(value)) continue;
          successesMap.set(key, value);
        }

        const breakerNames = new Set<string>([
          ...stateMap.keys(),
          ...failuresMap.keys(),
          ...successesMap.keys(),
        ]);

        const breakers = Array.from(breakerNames).map((name) => {
          const stateValue = stateMap.get(name) ?? 0;
          const failures = failuresMap.get(name) ?? 0;
          const successes = successesMap.get(name) ?? 0;
          const total = successes + failures;
          const successRate = total > 0 ? Math.round((successes / total) * 100) : 100;
          const status = stateValue >= 1 ? 'open' : stateValue >= 0.5 ? 'half-open' : 'closed';
          return {
            name,
            status,
            failures: Math.round(failures),
            successRate,
          };
        });

        res.json({ breakers, timestamp: new Date().toISOString() });
      } catch (error) {
        logger.error({ error }, 'Falha ao coletar métricas de circuit breakers via Prometheus');
        res.status(500).json({ error: 'Falha ao consultar Prometheus' });
      }
    },
  );

  app.get(
    '/api/observability/metrics/integrations',
    requireObservabilityRead,
    async (_req: Request, res: Response) => {
      try {
        const [configuredResult, operationalResult] = await Promise.all([
          queryPrometheus(prometheusUrl, 'alice_integrations_configured'),
          queryPrometheus(prometheusUrl, 'alice_integrations_operational'),
        ]);

        const configuredMap = vectorToMap(configuredResult, 'integration');
        const operationalMap = vectorToMap(operationalResult, 'integration');
        const integrationNames = new Set<string>([
          ...configuredMap.keys(),
          ...operationalMap.keys(),
        ]);

        const integrations = Array.from(integrationNames).map((integration) => ({
          name: integration,
          configured: (configuredMap.get(integration) ?? 0) >= 1,
          operational: (operationalMap.get(integration) ?? 0) >= 1,
        }));

        res.json({ integrations, timestamp: new Date().toISOString() });
      } catch (error) {
        logger.error({ error }, 'Falha ao coletar métricas de integrações via Prometheus');
        res.status(500).json({ error: 'Falha ao consultar Prometheus' });
      }
    },
  );

  app.get('/api/observability/metrics/sla', requireObservabilityRead, async (req: Request, res: Response) => {
    const tenantId =
      typeof req.query.tenantId === 'string'
        ? req.query.tenantId.trim()
        : typeof req.headers['x-tenant-id'] === 'string'
          ? req.headers['x-tenant-id'].trim()
          : '';

    if (!tenantId) {
      res.status(400).json({ error: 'tenantId é obrigatório para métricas SLA' });
      return;
    }

    try {
      const [
        breachedResult,
        atRiskResult,
        onTrackResult,
        avgFirstResponseResult,
        avgResolutionResult,
      ] = await Promise.all([
        queryPrometheus(prometheusUrl, `alice_sla_breached_total{tenant_id="${tenantId}"}`),
        queryPrometheus(prometheusUrl, `alice_sla_at_risk_total{tenant_id="${tenantId}"}`),
        queryPrometheus(prometheusUrl, `alice_sla_on_track_total{tenant_id="${tenantId}"}`),
        queryPrometheus(prometheusUrl, `alice_sla_avg_first_response_seconds{tenant_id="${tenantId}"}`),
        queryPrometheus(prometheusUrl, `alice_sla_avg_resolution_seconds{tenant_id="${tenantId}"}`),
      ]);

      const parseValue = (result: PrometheusVectorResult[]) => {
        const value = result[0]?.value?.[1];
        const parsed = Number(value ?? 0);
        return Number.isFinite(parsed) ? parsed : 0;
      };

      res.json({
        breachedCount: Math.round(parseValue(breachedResult)),
        atRiskCount: Math.round(parseValue(atRiskResult)),
        onTrackCount: Math.round(parseValue(onTrackResult)),
        avgFirstResponseTime: parseValue(avgFirstResponseResult),
        avgResolutionTime: parseValue(avgResolutionResult),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error, tenantId }, 'Falha ao coletar métricas SLA via Prometheus');
      res.status(500).json({ error: 'Falha ao consultar Prometheus' });
    }
  });

  app.get('/metrics', async (_req: Request, res: Response) => {
    try {
      const health = await checkAllServices(serviceTargets, logger);
      const circuitBreakers = listCircuitBreakerSnapshots();

      let metrics = '# HELP observability_service_up Whether the observability service is up\n';
      metrics += '# TYPE observability_service_up gauge\n';

      for (const service of health.services) {
        const value = service.status === 'healthy' ? 1 : service.status === 'unknown' ? 0.5 : 0;
        metrics += `observability_service_up{service="${service.name.toLowerCase()}"} ${value}\n`;
      }

      metrics += '\n# HELP observability_service_latency_ms Latency to check service health in milliseconds\n';
      metrics += '# TYPE observability_service_latency_ms gauge\n';

      for (const service of health.services) {
        metrics += `observability_service_latency_ms{service="${service.name.toLowerCase()}"} ${service.latencyMs}\n`;
      }

      metrics += '\n# HELP observability_stack_status Overall observability stack status (1=healthy, 0.5=degraded, 0=unhealthy)\n';
      metrics += '# TYPE observability_stack_status gauge\n';
      const statusValue = health.status === 'healthy' ? 1 : health.status === 'degraded' ? 0.5 : 0;
      metrics += `observability_stack_status ${statusValue}\n`;

      metrics += '\n# HELP observability_uptime_seconds Uptime of health checker in seconds\n';
      metrics += '# TYPE observability_uptime_seconds counter\n';
      metrics += `observability_uptime_seconds ${health.uptimeSeconds}\n`;

      metrics += '\n# HELP observability_circuit_breaker_state Circuit breaker state (0=closed, 0.5=half-open, 1=open)\n';
      metrics += '# TYPE observability_circuit_breaker_state gauge\n';
      for (const service of health.services) {
        const stateValue =
          service.circuitBreakerState === 'open' ? 1 : service.circuitBreakerState === 'half-open' ? 0.5 : 0;
        metrics += `observability_circuit_breaker_state{service="${service.name.toLowerCase()}"} ${stateValue}\n`;
      }

      metrics += '\n# HELP observability_circuit_breaker_fires_total Total circuit breaker fire attempts\n';
      metrics += '# TYPE observability_circuit_breaker_fires_total counter\n';
      for (const breaker of circuitBreakers) {
        metrics += `observability_circuit_breaker_fires_total{service="${breaker.name.toLowerCase()}"} ${breaker.stats.fires}\n`;
      }

      metrics += '\n# HELP observability_circuit_breaker_failures_total Total circuit breaker failures\n';
      metrics += '# TYPE observability_circuit_breaker_failures_total counter\n';
      for (const breaker of circuitBreakers) {
        metrics += `observability_circuit_breaker_failures_total{service="${breaker.name.toLowerCase()}"} ${breaker.stats.failures}\n`;
      }

      metrics += '\n# HELP alice_backup_jobs_total Total de backups por status no periodo\n';
      metrics += '# TYPE alice_backup_jobs_total gauge\n';

      try {
        const { completed, failed } = await loadBackupJobCounts(backupMetricsWindowDays);
        metrics += `alice_backup_jobs_total{status="completed",window="7d"} ${completed}\n`;
        metrics += `alice_backup_jobs_total{status="failed",window="7d"} ${failed}\n`;
      } catch (error) {
        logger.error({ error }, 'Erro ao carregar metricas de backup');
        metrics += '# backup metrics unavailable\n';
      }

      res.set('Content-Type', 'text/plain');
      res.send(metrics);
    } catch {
      res.status(500).send('# Error generating metrics\n');
    }
  });
}
