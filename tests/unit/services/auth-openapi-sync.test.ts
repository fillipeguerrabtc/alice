import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { authServicePaths } from '../../../apps/auth-service/src/openapi-specs';

type HttpMethod = 'get' | 'post' | 'patch' | 'delete' | 'put';

const CRITICAL_AUTH_OPENAPI_ROUTES: Array<{ method: HttpMethod; path: string }> = [
  { method: 'get', path: '/api/audit/recent' },
  { method: 'get', path: '/api/auth/roles' },
  { method: 'get', path: '/api/auth/custom-roles' },
  { method: 'post', path: '/api/auth/custom-roles' },
  { method: 'patch', path: '/api/auth/custom-roles/{id}' },
  { method: 'delete', path: '/api/auth/custom-roles/{id}' },
  { method: 'get', path: '/api/auth/custom-roles/{id}/permissions' },
  { method: 'put', path: '/api/auth/custom-roles/{id}/permissions' },
  { method: 'get', path: '/api/auth/permissions' },
  { method: 'get', path: '/api/auth/permissions/{id}' },
  { method: 'post', path: '/api/auth/permissions' },
  { method: 'patch', path: '/api/auth/permissions/{id}' },
  { method: 'delete', path: '/api/auth/permissions/{id}' },
  { method: 'get', path: '/api/auth/roles/{role}/permissions' },
  { method: 'put', path: '/api/auth/roles/{role}/permissions' },
  { method: 'get', path: '/api/auth/groups' },
  { method: 'post', path: '/api/auth/groups' },
  { method: 'patch', path: '/api/auth/groups/{id}' },
  { method: 'delete', path: '/api/auth/groups/{id}' },
  { method: 'get', path: '/api/auth/groups/{id}/users' },
  { method: 'post', path: '/api/auth/groups/{id}/users' },
  { method: 'delete', path: '/api/auth/groups/{id}/users/{userId}' },
];

function openApiPathToExpressPath(pathname: string): string {
  return pathname.replace(/\{([^}]+)\}/g, ':$1');
}

function loadExpressRouteSignatures(): Set<string> {
  const indexPath = path.join(process.cwd(), 'apps', 'auth-service', 'src', 'index.ts');
  const source = readFileSync(indexPath, 'utf-8');
  const routeRegex = /app\.(get|post|patch|delete|put)\('([^']+)'/g;

  const signatures = new Set<string>();
  let match = routeRegex.exec(source);
  while (match) {
    const [, method, pathname] = match;
    signatures.add(`${method.toUpperCase()} ${pathname}`);
    match = routeRegex.exec(source);
  }
  return signatures;
}

describe('Auth OpenAPI - critical route sync', () => {
  it('documents all critical admin routes', () => {
    for (const route of CRITICAL_AUTH_OPENAPI_ROUTES) {
      const pathEntry = authServicePaths[route.path as keyof typeof authServicePaths] as
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

    for (const route of CRITICAL_AUTH_OPENAPI_ROUTES) {
      const expressPath = openApiPathToExpressPath(route.path);
      const signature = `${route.method.toUpperCase()} ${expressPath}`;
      expect(
        expressRoutes.has(signature),
        `OpenAPI route does not match a real handler: ${signature}`
      ).toBe(true);
    }
  });
});
