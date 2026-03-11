import type express from 'express';
import { createAlicePrometheus } from '@alice/shared-utils';

export type LlmGatewayMetrics = ReturnType<typeof createAlicePrometheus>['metrics'];

export function registerLlmMetrics(app: express.Express): LlmGatewayMetrics {
  // Prometheus: /metrics exposto antes do auth (scrape sem autenticação - rede interna)
  const { metrics, metricsRouter, httpMetricsMiddleware } = createAlicePrometheus({
    serviceName: 'llm-gateway-service',
    collectDefaultMetrics: true,
  });

  app.use(metricsRouter);
  app.use(httpMetricsMiddleware);

  return metrics;
}
