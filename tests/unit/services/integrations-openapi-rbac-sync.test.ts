import { describe, expect, it } from 'vitest';
import { integrationsServicePaths } from '../../../apps/integrations-service/src/openapi-specs';
import { loadIntegrationsSource } from './helpers/integrations-source';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

const CRITICAL_RBAC_CONTRACTS: Array<{
  method: HttpMethod;
  openapiPath: string;
  requiredPermission: string;
}> = [
  { method: 'get', openapiPath: '/api/integrations/health', requiredPermission: 'integrations:integrations:read' },
  { method: 'get', openapiPath: '/api/integrations/trading/analysis-profile', requiredPermission: 'integrations:trading:read' },
  { method: 'put', openapiPath: '/api/integrations/trading/analysis-profile', requiredPermission: 'integrations:trading:write' },
  { method: 'get', openapiPath: '/api/integrations/trading/arbitrage/catalog', requiredPermission: 'integrations:trading:read' },
  { method: 'get', openapiPath: '/api/integrations/trading/signal-scheduler', requiredPermission: 'integrations:trading:read' },
  { method: 'put', openapiPath: '/api/integrations/trading/signal-scheduler', requiredPermission: 'integrations:trading:write' },
  { method: 'get', openapiPath: '/api/integrations/trading/analysis-scheduler', requiredPermission: 'integrations:trading:read' },
  { method: 'put', openapiPath: '/api/integrations/trading/analysis-scheduler', requiredPermission: 'integrations:trading:write' },
  { method: 'get', openapiPath: '/api/integrations/trading/stop-orders', requiredPermission: 'integrations:trading:read' },
  { method: 'delete', openapiPath: '/api/integrations/trading/stop-orders/{id}', requiredPermission: 'integrations:trading:write' },
  { method: 'get', openapiPath: '/api/integrations/trading/klines/{symbol}', requiredPermission: 'integrations:trading:read' },
  { method: 'get', openapiPath: '/api/integrations/trading/klines', requiredPermission: 'integrations:trading:read' },
  { method: 'get', openapiPath: '/api/integrations/trading/orderbook/{symbol}', requiredPermission: 'integrations:trading:read' },
  { method: 'get', openapiPath: '/api/integrations/trading/orderbook', requiredPermission: 'integrations:trading:read' },
  { method: 'get', openapiPath: '/api/integrations/trading/funding-rate/{symbol}', requiredPermission: 'integrations:trading:read' },
  { method: 'get', openapiPath: '/api/integrations/trading/mark-price/{symbol}', requiredPermission: 'integrations:trading:read' },
  { method: 'get', openapiPath: '/api/integrations/trading/trades/{symbol}', requiredPermission: 'integrations:trading:read' },
  { method: 'get', openapiPath: '/api/integrations/trading/control-history', requiredPermission: 'integrations:trading:read' },
  { method: 'post', openapiPath: '/api/integrations/trading/control', requiredPermission: 'integrations:trading:manage' },
  { method: 'get', openapiPath: '/api/integrations/trading/analysis/{symbol}', requiredPermission: 'integrations:trading:read' },
  { method: 'get', openapiPath: '/api/integrations/trading/orders/history', requiredPermission: 'integrations:trading:read' },
  { method: 'post', openapiPath: '/api/integrations/trading/orders/history/delete', requiredPermission: 'integrations:trading:write' },
  { method: 'get', openapiPath: '/api/integrations/trading/analysis/history', requiredPermission: 'integrations:trading:read' },
  { method: 'post', openapiPath: '/api/integrations/trading/analysis/history/delete', requiredPermission: 'integrations:trading:write' },
  { method: 'post', openapiPath: '/api/integrations/trading/analysis/history/purge', requiredPermission: 'integrations:trading:write' },
  { method: 'get', openapiPath: '/api/integrations/trading/validations', requiredPermission: 'integrations:trading:read' },
  { method: 'get', openapiPath: '/api/integrations/trading/validations/diagnostics', requiredPermission: 'integrations:trading:read' },
  { method: 'get', openapiPath: '/api/integrations/trading/datasets/stats', requiredPermission: 'integrations:trading:read' },
  { method: 'get', openapiPath: '/api/integrations/trading/datasets', requiredPermission: 'integrations:trading:read' },
  { method: 'post', openapiPath: '/api/integrations/trading/datasets/from-signal', requiredPermission: 'integrations:trading:write' },
  { method: 'patch', openapiPath: '/api/integrations/trading/datasets/{id}/review', requiredPermission: 'integrations:trading:write' },
  { method: 'get', openapiPath: '/api/integrations/postmortem/{positionId}', requiredPermission: 'integrations:trading:read' },
  { method: 'get', openapiPath: '/api/integrations/postmortem', requiredPermission: 'integrations:trading:read' },
  { method: 'get', openapiPath: '/api/integrations/postmortem/queue/stats', requiredPermission: 'integrations:trading:manage' },
  { method: 'post', openapiPath: '/api/integrations/postmortem/queue/retry/{jobId}', requiredPermission: 'integrations:trading:manage' },
  { method: 'get', openapiPath: '/api/integrations/postmortem/snapshots/{positionId}', requiredPermission: 'integrations:trading:read' },
  { method: 'post', openapiPath: '/api/integrations/postmortem/send-to-training', requiredPermission: 'integrations:trading:write' },
  { method: 'post', openapiPath: '/api/integrations/postmortem/send-to-training/batch', requiredPermission: 'integrations:trading:write' },
];

function openApiPathToExpressPath(pathname: string): string {
  return pathname.replace(/\{([^}]+)\}/g, ':$1');
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('Integrations OpenAPI RBAC contract sync', () => {
  it('declares required permission in OpenAPI for critical routes', () => {
    for (const contract of CRITICAL_RBAC_CONTRACTS) {
      const pathEntry = integrationsServicePaths[contract.openapiPath as keyof typeof integrationsServicePaths] as
        | Record<string, unknown> & { [key in HttpMethod]?: Record<string, unknown> }
        | undefined;
      expect(pathEntry, `Missing path in OpenAPI: ${contract.openapiPath}`).toBeDefined();
      const methodPermission = pathEntry?.[contract.method]?.['x-required-permission'];
      const pathPermission = pathEntry?.['x-required-permission'];
      const documentedPermission = methodPermission ?? pathPermission;
      expect(
        documentedPermission,
        `Missing OpenAPI RBAC extension for ${contract.method.toUpperCase()} ${contract.openapiPath}`
      ).toBe(contract.requiredPermission);
    }
  });

  it('keeps OpenAPI RBAC permission aligned with express requirePermission middleware', () => {
    const source = loadIntegrationsSource();

    for (const contract of CRITICAL_RBAC_CONTRACTS) {
      const expressPath = openApiPathToExpressPath(contract.openapiPath);
      const pattern = new RegExp(
        `app\\.${contract.method}\\('${escapeRegex(expressPath)}',\\s*requirePermission\\('${escapeRegex(contract.requiredPermission)}'\\),`
      );
      expect(
        pattern.test(source),
        `RBAC mismatch between OpenAPI and handler for ${contract.method.toUpperCase()} ${expressPath}`
      ).toBe(true);
    }
  });
});
