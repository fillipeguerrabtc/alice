import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chatServicePaths } from '../../../apps/chat-service/src/openapi-specs';

type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

const CRITICAL_OPENAPI_ROUTES: Array<{ method: HttpMethod; path: string }> = [
  { method: 'get', path: '/api/chat/ws-token' },
  { method: 'post', path: '/api/chat/conversations/{id}/takeover' },
  { method: 'post', path: '/api/chat/conversations/{id}/handback' },
];

function openApiPathToExpressPath(pathname: string): string {
  return pathname.replace(/\{([^}]+)\}/g, ':$1');
}

function loadExpressRouteSignatures(): Set<string> {
  const indexPath = path.join(process.cwd(), 'apps', 'chat-service', 'src', 'index.ts');
  const source = readFileSync(indexPath, 'utf-8');
  const routeRegex = /app\.(get|post|patch|delete)\('([^']+)'/g;

  const signatures = new Set<string>();
  let match = routeRegex.exec(source);
  while (match) {
    const [, method, pathname] = match;
    signatures.add(`${method.toUpperCase()} ${pathname}`);
    match = routeRegex.exec(source);
  }
  return signatures;
}

describe('Chat OpenAPI - critical route sync', () => {
  it('documents all critical enterprise routes', () => {
    for (const route of CRITICAL_OPENAPI_ROUTES) {
      const pathEntry = chatServicePaths[route.path as keyof typeof chatServicePaths] as
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
