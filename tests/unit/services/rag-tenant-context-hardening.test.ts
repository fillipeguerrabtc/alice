import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadRagSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'rag-service', 'src', 'index.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('rag tenant-context hardening', () => {
  it('keeps tenant-scoped lookup helpers for namespace and agent using withTenantContext', () => {
    const source = loadRagSource();
    expect(source.includes('async function findNamespaceByIdInTenant(tenantId: string, namespaceId: string)')).toBe(true);
    expect(source.includes('async function findAgentByIdInTenant(tenantId: string, agentId: string)')).toBe(true);
    expect(source.includes('return withTenantContext(tenantId, false, (tenantDb) =>')).toBe(true);
    expect(source.includes('tenantDb.query.namespaces.findFirst({')).toBe(true);
    expect(source.includes('tenantDb.query.agents.findFirst({')).toBe(true);
  });

  it('uses tenant-scoped helpers when sending document chunks to training', () => {
    const source = loadRagSource();
    const namespacePattern =
      /app\.post\('\/api\/rag\/documents\/:id\/send-to-training',[\s\S]*?findNamespaceByIdInTenant\(tenantId, bodyValidation\.data\.scope\.namespaceId\)/;
    const agentPattern =
      /app\.post\('\/api\/rag\/documents\/:id\/send-to-training',[\s\S]*?findAgentByIdInTenant\(tenantId, bodyValidation\.data\.scope\.agentId\)/;
    expect(namespacePattern.test(source)).toBe(true);
    expect(agentPattern.test(source)).toBe(true);
  });

  it('keeps namespace ownership assertion fail-closed through tenant-scoped helper', () => {
    const source = loadRagSource();
    const assertionPattern =
      /async function assertNamespaceOwnership\([\s\S]*?const namespace = await findNamespaceByIdInTenant\(tenantId, namespaceId\);[\s\S]*?if \(!namespace\)/;
    expect(assertionPattern.test(source)).toBe(true);
  });
});
