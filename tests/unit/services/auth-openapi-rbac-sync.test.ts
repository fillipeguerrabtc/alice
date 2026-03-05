import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { authServicePaths } from '../../../apps/auth-service/src/openapi-specs';

type HttpMethod = 'get' | 'post' | 'patch' | 'delete' | 'put';

const CRITICAL_AUTH_RBAC_CONTRACTS: Array<{
  method: HttpMethod;
  openapiPath: string;
  requiredPermission: string;
}> = [
  { method: 'get', openapiPath: '/api/auth/permissions', requiredPermission: 'admin:permissions:read' },
  { method: 'get', openapiPath: '/api/auth/permissions/{id}', requiredPermission: 'admin:permissions:read' },
  { method: 'post', openapiPath: '/api/auth/permissions', requiredPermission: 'admin:permissions:write' },
  { method: 'patch', openapiPath: '/api/auth/permissions/{id}', requiredPermission: 'admin:permissions:write' },
  { method: 'delete', openapiPath: '/api/auth/permissions/{id}', requiredPermission: 'admin:permissions:delete' },
  {
    method: 'get',
    openapiPath: '/api/auth/roles/{role}/permissions',
    requiredPermission: 'admin:permissions:read',
  },
  {
    method: 'put',
    openapiPath: '/api/auth/roles/{role}/permissions',
    requiredPermission: 'admin:permissions:manage',
  },
  { method: 'get', openapiPath: '/api/auth/groups', requiredPermission: 'admin:groups:read' },
  { method: 'post', openapiPath: '/api/auth/groups', requiredPermission: 'admin:groups:write' },
  { method: 'patch', openapiPath: '/api/auth/groups/{id}', requiredPermission: 'admin:groups:write' },
  { method: 'delete', openapiPath: '/api/auth/groups/{id}', requiredPermission: 'admin:groups:delete' },
  { method: 'get', openapiPath: '/api/auth/groups/{id}/users', requiredPermission: 'admin:groups:read' },
  { method: 'post', openapiPath: '/api/auth/groups/{id}/users', requiredPermission: 'admin:groups:manage' },
  {
    method: 'delete',
    openapiPath: '/api/auth/groups/{id}/users/{userId}',
    requiredPermission: 'admin:groups:manage',
  },
];

function openApiPathToExpressPath(pathname: string): string {
  return pathname.replace(/\{([^}]+)\}/g, ':$1');
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadAuthSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'auth-service', 'src', 'index.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('Auth OpenAPI RBAC contract sync', () => {
  it('declares required permission in OpenAPI for critical admin routes', () => {
    for (const contract of CRITICAL_AUTH_RBAC_CONTRACTS) {
      const pathEntry = authServicePaths[contract.openapiPath as keyof typeof authServicePaths] as
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
    const source = loadAuthSource();

    for (const contract of CRITICAL_AUTH_RBAC_CONTRACTS) {
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
