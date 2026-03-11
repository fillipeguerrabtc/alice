import { describe, expect, it } from 'vitest';
import { trainingServicePaths } from '../../../apps/training-service/src/openapi-specs';
import { loadTrainingRouteSignatures } from './helpers/training-source';

type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

const CRITICAL_OPENAPI_ROUTES: Array<{ method: HttpMethod; path: string }> = [
  { method: 'post', path: '/api/training/jobs' },
  { method: 'get', path: '/api/training/jobs/{id}' },
  { method: 'get', path: '/api/training/jobs/{id}/audit-trail' },
  { method: 'get', path: '/api/training/jobs/{id}/promotion-approvals' },
  { method: 'post', path: '/api/training/jobs/{id}/promotion-approval' },
  { method: 'post', path: '/api/training/jobs/{id}/promote' },
  { method: 'post', path: '/api/training/jobs/{id}/rollback' },
  { method: 'post', path: '/api/training/webhook' },
  { method: 'post', path: '/api/training/schedule/configure' },
  { method: 'post', path: '/api/training/run/start' },
  { method: 'get', path: '/api/training/run/status' },
  { method: 'get', path: '/api/training/run/history' },
  { method: 'delete', path: '/api/training/run/cancel' },
  { method: 'get', path: '/api/training/queue/status' },
  { method: 'get', path: '/api/training/auto-learning/status' },
  { method: 'get', path: '/api/training/execution-modes' },
  { method: 'post', path: '/api/training/gpu-orchestrator/prepare-training' },
  { method: 'post', path: '/api/training/gpu-orchestrator/restore-serving' },
];

function openApiPathToExpressPath(pathname: string): string {
  return pathname.replace(/\{([^}]+)\}/g, ':$1');
}

describe('Training OpenAPI - critical route sync', () => {
  it('documents all critical enterprise routes', () => {
    for (const route of CRITICAL_OPENAPI_ROUTES) {
      const pathEntry = trainingServicePaths[route.path as keyof typeof trainingServicePaths] as
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
    const expressRoutes = loadTrainingRouteSignatures();

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
