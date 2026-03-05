import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { observabilityServicePaths } from '../../../apps/observability-service/src/openapi-specs';

type HttpMethod = 'get' | 'post';

const CRITICAL_OBSERVABILITY_RBAC_CONTRACTS: Array<{
  method: HttpMethod;
  openapiPath: string;
  requiredPermission: string;
  middlewareName: 'requireObservabilityRead' | 'requireObservabilityAdmin' | 'requireObservabilityLogsWrite';
}> = [
  {
    method: 'get',
    openapiPath: '/api/observability/health',
    requiredPermission: 'observability:core:read',
    middlewareName: 'requireObservabilityRead',
  },
  {
    method: 'get',
    openapiPath: '/api/observability/services/{name}',
    requiredPermission: 'observability:core:read',
    middlewareName: 'requireObservabilityRead',
  },
  {
    method: 'get',
    openapiPath: '/api/observability/metrics/services',
    requiredPermission: 'observability:core:read',
    middlewareName: 'requireObservabilityRead',
  },
  {
    method: 'get',
    openapiPath: '/api/observability/metrics/circuit-breakers',
    requiredPermission: 'observability:core:read',
    middlewareName: 'requireObservabilityRead',
  },
  {
    method: 'get',
    openapiPath: '/api/observability/metrics/integrations',
    requiredPermission: 'observability:core:read',
    middlewareName: 'requireObservabilityRead',
  },
  {
    method: 'get',
    openapiPath: '/api/observability/metrics/sla',
    requiredPermission: 'observability:core:read',
    middlewareName: 'requireObservabilityRead',
  },
  {
    method: 'post',
    openapiPath: '/api/observability/logs',
    requiredPermission: 'observability:logs:write',
    middlewareName: 'requireObservabilityLogsWrite',
  },
  {
    method: 'get',
    openapiPath: '/api/observability/circuit-breakers',
    requiredPermission: 'observability:core:read',
    middlewareName: 'requireObservabilityRead',
  },
  {
    method: 'get',
    openapiPath: '/api/observability/urls',
    requiredPermission: 'observability:core:admin',
    middlewareName: 'requireObservabilityAdmin',
  },
];

function openApiPathToExpressPath(pathname: string): string {
  return pathname.replace(/\{([^}]+)\}/g, ':$1');
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadObservabilitySource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'observability-service', 'src', 'index.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('Observability OpenAPI RBAC contract sync', () => {
  it('declares required permission in OpenAPI for critical routes', () => {
    for (const contract of CRITICAL_OBSERVABILITY_RBAC_CONTRACTS) {
      const pathEntry = observabilityServicePaths[contract.openapiPath as keyof typeof observabilityServicePaths] as
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

  it('keeps OpenAPI RBAC contract aligned with route middleware wrappers', () => {
    const source = loadObservabilitySource();

    for (const contract of CRITICAL_OBSERVABILITY_RBAC_CONTRACTS) {
      const expressPath = openApiPathToExpressPath(contract.openapiPath);
      const pattern = new RegExp(
        `app\\.${contract.method}\\('${escapeRegex(expressPath)}',\\s*${contract.middlewareName},`
      );
      expect(
        pattern.test(source),
        `RBAC middleware mismatch for ${contract.method.toUpperCase()} ${expressPath}`
      ).toBe(true);
    }
  });
});
