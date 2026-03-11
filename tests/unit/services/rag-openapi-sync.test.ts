import { describe, expect, it } from 'vitest';
import { ragServicePaths } from '../../../apps/rag-service/src/openapi-specs';
import { loadRagRouteSignatures } from './helpers/rag-source';

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
    const expressRoutes = loadRagRouteSignatures();

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
