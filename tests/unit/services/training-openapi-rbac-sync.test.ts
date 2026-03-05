import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { trainingServicePaths } from '../../../apps/training-service/src/openapi-specs';

type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

const CRITICAL_TRAINING_RBAC_CONTRACTS: Array<{
  method: HttpMethod;
  openapiPath: string;
  requiredPermission: string;
}> = [
  { method: 'post', openapiPath: '/api/training/jobs', requiredPermission: 'training:fine_tuning_jobs:start' },
  { method: 'get', openapiPath: '/api/training/jobs/{id}', requiredPermission: 'training:fine_tuning_jobs:read' },
  { method: 'get', openapiPath: '/api/training/jobs/{id}/audit-trail', requiredPermission: 'training:fine_tuning_jobs:read' },
  { method: 'get', openapiPath: '/api/training/jobs/{id}/promotion-approvals', requiredPermission: 'training:fine_tuning_jobs:read' },
  { method: 'post', openapiPath: '/api/training/jobs/{id}/promotion-approval', requiredPermission: 'training:fine_tuning_jobs:start' },
  { method: 'post', openapiPath: '/api/training/jobs/{id}/promote', requiredPermission: 'training:fine_tuning_jobs:start' },
  { method: 'post', openapiPath: '/api/training/jobs/{id}/rollback', requiredPermission: 'training:fine_tuning_jobs:start' },
  { method: 'post', openapiPath: '/api/training/schedule/configure', requiredPermission: 'training:training_data:manage' },
  { method: 'post', openapiPath: '/api/training/run/start', requiredPermission: 'training:training_data:manage' },
  { method: 'get', openapiPath: '/api/training/run/status', requiredPermission: 'training:training_data:read' },
  { method: 'get', openapiPath: '/api/training/run/history', requiredPermission: 'training:training_data:read' },
  { method: 'delete', openapiPath: '/api/training/run/cancel', requiredPermission: 'training:training_data:manage' },
  { method: 'get', openapiPath: '/api/training/queue/status', requiredPermission: 'training:fine_tuning_jobs:read' },
  { method: 'get', openapiPath: '/api/training/auto-learning/status', requiredPermission: 'training:training_data:read' },
  { method: 'get', openapiPath: '/api/training/execution-modes', requiredPermission: 'training:training_data:read' },
];

function openApiPathToExpressPath(pathname: string): string {
  return pathname.replace(/\{([^}]+)\}/g, ':$1');
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadTrainingSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'training-service', 'src', 'index.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('Training OpenAPI RBAC contract sync', () => {
  it('declares required permission in OpenAPI for critical training routes', () => {
    for (const contract of CRITICAL_TRAINING_RBAC_CONTRACTS) {
      const pathEntry = trainingServicePaths[contract.openapiPath as keyof typeof trainingServicePaths] as
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
    const source = loadTrainingSource();

    for (const contract of CRITICAL_TRAINING_RBAC_CONTRACTS) {
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
