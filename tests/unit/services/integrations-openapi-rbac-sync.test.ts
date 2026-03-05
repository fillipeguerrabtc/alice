import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { integrationsServicePaths } from '../../../apps/integrations-service/src/openapi-specs';

type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

const CRITICAL_RBAC_CONTRACTS: Array<{
  method: HttpMethod;
  openapiPath: string;
  requiredPermission: string;
}> = [
  { method: 'get', openapiPath: '/api/integrations/health', requiredPermission: 'integrations:integrations:read' },
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

function loadIntegrationsSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'integrations-service', 'src', 'index.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('Integrations OpenAPI RBAC contract sync', () => {
  it('declares required permission in OpenAPI for critical routes', () => {
    for (const contract of CRITICAL_RBAC_CONTRACTS) {
      const pathEntry = integrationsServicePaths[contract.openapiPath as keyof typeof integrationsServicePaths] as
        | Record<string, unknown>
        | undefined;
      expect(pathEntry, `Missing path in OpenAPI: ${contract.openapiPath}`).toBeDefined();
      const documentedPermission = pathEntry?.['x-required-permission'];
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
