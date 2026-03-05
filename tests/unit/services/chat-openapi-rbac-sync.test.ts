import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chatServicePaths } from '../../../apps/chat-service/src/openapi-specs';

type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

const CRITICAL_CHAT_RBAC_CONTRACTS: Array<{
  method: HttpMethod;
  openapiPath: string;
  requiredPermission: string;
}> = [
  { method: 'post', openapiPath: '/api/chat/conversations/{id}/takeover', requiredPermission: 'chat:takeover:write' },
  { method: 'post', openapiPath: '/api/chat/conversations/{id}/handback', requiredPermission: 'chat:handoff:write' },
];

function openApiPathToExpressPath(pathname: string): string {
  return pathname.replace(/\{([^}]+)\}/g, ':$1');
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadChatSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'chat-service', 'src', 'index.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('Chat OpenAPI RBAC contract sync', () => {
  it('declares required permission in OpenAPI for critical takeover routes', () => {
    for (const contract of CRITICAL_CHAT_RBAC_CONTRACTS) {
      const pathEntry = chatServicePaths[contract.openapiPath as keyof typeof chatServicePaths] as
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
    const source = loadChatSource();

    for (const contract of CRITICAL_CHAT_RBAC_CONTRACTS) {
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
