import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ragServicePaths } from '../../../apps/rag-service/src/openapi-specs';

type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

const CRITICAL_RAG_OPENAPI_ROUTES: Array<{ method: HttpMethod; path: string }> = [
  { method: 'get', path: '/api/rag/workers/document-processing' },
  { method: 'get', path: '/api/rag/documents' },
  { method: 'post', path: '/api/rag/documents' },
  { method: 'post', path: '/api/rag/documents/upload' },
  { method: 'patch', path: '/api/rag/documents/{id}' },
  { method: 'delete', path: '/api/rag/documents/{id}' },
  { method: 'get', path: '/api/rag/documents/{id}/status' },
  { method: 'post', path: '/api/rag/documents/{id}/reprocess' },
  { method: 'post', path: '/api/rag/documents/{id}/send-to-training' },
  { method: 'post', path: '/api/rag/search' },
  { method: 'post', path: '/api/rag/context' },
  { method: 'get', path: '/api/rag/namespaces/{id}/stats' },
  { method: 'post', path: '/api/media/uploads/{id}/send-to-training' },
];

function openApiPathToExpressPath(pathname: string): string {
  return pathname.replace(/\{([^}]+)\}/g, ':$1');
}

function loadExpressRouteSignatures(): Set<string> {
  const indexPath = path.join(process.cwd(), 'apps', 'rag-service', 'src', 'index.ts');
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

describe('RAG OpenAPI - critical route sync', () => {
  it('documents all critical enterprise routes', () => {
    for (const route of CRITICAL_RAG_OPENAPI_ROUTES) {
      const pathEntry = ragServicePaths[route.path as keyof typeof ragServicePaths] as
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

    for (const route of CRITICAL_RAG_OPENAPI_ROUTES) {
      const expressPath = openApiPathToExpressPath(route.path);
      const signature = `${route.method.toUpperCase()} ${expressPath}`;
      expect(
        expressRoutes.has(signature),
        `OpenAPI route does not match a real handler: ${signature}`
      ).toBe(true);
    }
  });
});
