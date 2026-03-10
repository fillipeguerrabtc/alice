import { describe, expect, it } from 'vitest';
import { integrationsServicePaths } from '../../../apps/integrations-service/src/openapi-specs';
import { loadIntegrationsSource } from './helpers/integrations-source';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

const CRITICAL_OPENAPI_ROUTES: Array<{ method: HttpMethod; path: string }> = [
  { method: 'get', path: '/api/integrations/health' },
  { method: 'get', path: '/api/integrations/stats' },
  { method: 'get', path: '/api/integrations/trading/analysis-profile' },
  { method: 'put', path: '/api/integrations/trading/analysis-profile' },
  { method: 'get', path: '/api/integrations/trading/arbitrage/catalog' },
  { method: 'get', path: '/api/integrations/trading/signal-scheduler' },
  { method: 'put', path: '/api/integrations/trading/signal-scheduler' },
  { method: 'get', path: '/api/integrations/trading/analysis-scheduler' },
  { method: 'put', path: '/api/integrations/trading/analysis-scheduler' },
  { method: 'get', path: '/api/integrations/trading/stop-orders' },
  { method: 'delete', path: '/api/integrations/trading/stop-orders/{id}' },
  { method: 'get', path: '/api/integrations/trading/klines/{symbol}' },
  { method: 'get', path: '/api/integrations/trading/klines' },
  { method: 'get', path: '/api/integrations/trading/orderbook/{symbol}' },
  { method: 'get', path: '/api/integrations/trading/orderbook' },
  { method: 'get', path: '/api/integrations/trading/funding-rate/{symbol}' },
  { method: 'get', path: '/api/integrations/trading/mark-price/{symbol}' },
  { method: 'get', path: '/api/integrations/trading/trades/{symbol}' },
  { method: 'get', path: '/api/integrations/trading/control-history' },
  { method: 'post', path: '/api/integrations/trading/control' },
  { method: 'get', path: '/api/integrations/trading/analysis/{symbol}' },
  { method: 'get', path: '/api/integrations/trading/orders/history' },
  { method: 'post', path: '/api/integrations/trading/orders/history/delete' },
  { method: 'get', path: '/api/integrations/trading/analysis/history' },
  { method: 'post', path: '/api/integrations/trading/analysis/history/delete' },
  { method: 'post', path: '/api/integrations/trading/analysis/history/purge' },
  { method: 'get', path: '/api/integrations/trading/validations' },
  { method: 'get', path: '/api/integrations/trading/validations/diagnostics' },
  { method: 'get', path: '/api/integrations/trading/datasets/stats' },
  { method: 'get', path: '/api/integrations/trading/datasets' },
  { method: 'post', path: '/api/integrations/trading/datasets/from-signal' },
  { method: 'patch', path: '/api/integrations/trading/datasets/{id}/review' },
  { method: 'get', path: '/api/integrations/trading/ws/status' },
  { method: 'post', path: '/api/integrations/trading/ws/subscribe' },
  { method: 'post', path: '/api/integrations/trading/ws/unsubscribe' },
  { method: 'get', path: '/api/integrations/trading/intervals' },
  { method: 'get', path: '/api/integrations/postmortem/{positionId}' },
  { method: 'get', path: '/api/integrations/postmortem' },
  { method: 'get', path: '/api/integrations/postmortem/queue/stats' },
  { method: 'post', path: '/api/integrations/postmortem/queue/retry/{jobId}' },
  { method: 'get', path: '/api/integrations/postmortem/snapshots/{positionId}' },
  { method: 'post', path: '/api/integrations/postmortem/send-to-training' },
  { method: 'post', path: '/api/integrations/postmortem/send-to-training/batch' },
];

function openApiPathToExpressPath(pathname: string): string {
  return pathname.replace(/\{([^}]+)\}/g, ':$1');
}

function loadExpressRouteSignatures(): Set<string> {
  const source = loadIntegrationsSource();
  const routeRegex = /app\.(get|post|put|patch|delete)\('([^']+)'/g;

  const signatures = new Set<string>();
  let match = routeRegex.exec(source);
  while (match) {
    const [, method, pathname] = match;
    signatures.add(`${method.toUpperCase()} ${pathname}`);
    match = routeRegex.exec(source);
  }
  return signatures;
}

describe('Integrations OpenAPI - critical route sync', () => {
  it('documents all critical enterprise routes', () => {
    for (const route of CRITICAL_OPENAPI_ROUTES) {
      const pathEntry = integrationsServicePaths[route.path as keyof typeof integrationsServicePaths] as
        | Record<string, unknown>
        | undefined;
      expect(pathEntry, `Missing path in OpenAPI: ${route.path}`).toBeDefined();
      expect(
        Boolean(pathEntry && route.method in pathEntry),
        `Missing method in OpenAPI: ${route.method.toUpperCase()} ${route.path}`
      ).toBe(true);
    }
  });

  it('keeps OpenAPI critical routes aligned with Express route handlers', () => {
    const expressRoutes = loadExpressRouteSignatures();

    for (const route of CRITICAL_OPENAPI_ROUTES) {
      const expressPath = openApiPathToExpressPath(route.path);
      const signature = `${route.method.toUpperCase()} ${expressPath}`;
      expect(
        expressRoutes.has(signature),
        `OpenAPI route does not match a real handler: ${signature}`
      ).toBe(true);
    }
  });
});
