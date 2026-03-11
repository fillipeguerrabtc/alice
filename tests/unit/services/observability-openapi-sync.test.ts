import { describe, expect, it } from 'vitest';
import { observabilityServicePaths } from '../../../apps/observability-service/src/openapi-specs';
import { loadObservabilityRouteSignatures } from './helpers/observability-source';

type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

const CRITICAL_OPENAPI_ROUTES: Array<{ method: HttpMethod; path: string }> = [
  { method: 'get', path: '/api/observability/health' },
  { method: 'get', path: '/api/observability/services/{name}' },
  { method: 'get', path: '/api/observability/metrics/services' },
  { method: 'get', path: '/api/observability/metrics/circuit-breakers' },
  { method: 'get', path: '/api/observability/metrics/integrations' },
  { method: 'get', path: '/api/observability/metrics/sla' },
  { method: 'post', path: '/api/observability/logs' },
  { method: 'get', path: '/api/observability/circuit-breakers' },
  { method: 'get', path: '/api/observability/urls' },
];

function openApiPathToExpressPath(pathname: string): string {
  return pathname.replace(/\{([^}]+)\}/g, ':$1');
}

describe('Observability OpenAPI - critical route sync', () => {
  it('documents all critical enterprise routes', () => {
    for (const route of CRITICAL_OPENAPI_ROUTES) {
      const pathEntry = observabilityServicePaths[route.path as keyof typeof observabilityServicePaths] as
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
    const expressRoutes = loadObservabilityRouteSignatures();

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
