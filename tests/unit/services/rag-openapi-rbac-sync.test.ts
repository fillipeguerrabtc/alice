import { describe, expect, it } from 'vitest';
import { ragServicePaths } from '../../../apps/rag-service/src/openapi-specs';
import { loadRagSource } from './helpers/rag-source';

type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

const CRITICAL_RAG_RBAC_CONTRACTS: Array<{
  method: HttpMethod;
  openapiPath: string;
  requiredPermission: string;
}> = [
  { method: 'get', openapiPath: '/api/rag/workers/document-processing', requiredPermission: 'rag:documents:read' },
  { method: 'get', openapiPath: '/api/rag/documents', requiredPermission: 'rag:documents:read' },
  { method: 'post', openapiPath: '/api/rag/documents', requiredPermission: 'rag:documents:write' },
  { method: 'post', openapiPath: '/api/rag/documents/upload', requiredPermission: 'rag:documents:upload' },
  { method: 'patch', openapiPath: '/api/rag/documents/{id}', requiredPermission: 'rag:documents:write' },
  { method: 'delete', openapiPath: '/api/rag/documents/{id}', requiredPermission: 'rag:documents:delete' },
  { method: 'get', openapiPath: '/api/rag/documents/{id}/status', requiredPermission: 'rag:documents:read' },
  { method: 'post', openapiPath: '/api/rag/documents/{id}/reprocess', requiredPermission: 'rag:documents:write' },
  {
    method: 'post',
    openapiPath: '/api/rag/documents/{id}/send-to-training',
    requiredPermission: 'training:training_data:write',
  },
  { method: 'post', openapiPath: '/api/rag/search', requiredPermission: 'rag:documents:read' },
  { method: 'post', openapiPath: '/api/rag/context', requiredPermission: 'rag:documents:read' },
  { method: 'get', openapiPath: '/api/rag/namespaces/{id}/stats', requiredPermission: 'rag:namespaces:read' },
  {
    method: 'post',
    openapiPath: '/api/media/uploads/{id}/send-to-training',
    requiredPermission: 'training:training_data:write',
  },
];

function openApiPathToExpressPath(pathname: string): string {
  return pathname.replace(/\{([^}]+)\}/g, ':$1');
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('RAG OpenAPI RBAC contract sync', () => {
  it('declares required permission in OpenAPI for critical routes', () => {
    for (const contract of CRITICAL_RAG_RBAC_CONTRACTS) {
      const pathEntry = ragServicePaths[contract.openapiPath as keyof typeof ragServicePaths] as
        | Record<string, unknown>
        | undefined;
      const methodEntry = pathEntry?.[contract.method] as Record<string, unknown> | undefined;
      expect(pathEntry, `Missing path in OpenAPI: ${contract.openapiPath}`).toBeDefined();
      expect(methodEntry, `Missing method in OpenAPI: ${contract.method.toUpperCase()} ${contract.openapiPath}`).toBeDefined();
      expect(
        methodEntry?.['x-required-permission'],
        `Missing OpenAPI RBAC extension for ${contract.method.toUpperCase()} ${contract.openapiPath}`
      ).toBe(contract.requiredPermission);
    }
  });

  it('keeps OpenAPI RBAC permission aligned with express requirePermission middleware', () => {
    const source = loadRagSource();

    for (const contract of CRITICAL_RAG_RBAC_CONTRACTS) {
      const expressPath = openApiPathToExpressPath(contract.openapiPath);
      const pattern = new RegExp(
        `app\\.${contract.method}\\('${escapeRegex(expressPath)}',[\\s\\S]*?requirePermission\\('${escapeRegex(contract.requiredPermission)}'\\),`
      );
      expect(
        pattern.test(source),
        `RBAC mismatch between OpenAPI and handler for ${contract.method.toUpperCase()} ${expressPath}`
      ).toBe(true);
    }
  });
});
