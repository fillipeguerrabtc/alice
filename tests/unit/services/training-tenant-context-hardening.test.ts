import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadTrainingSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'training-service', 'src', 'index.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('training tenant-context hardening', () => {
  it('keeps namespace and agent lookup helpers scoped by withTenantContext', () => {
    const source = loadTrainingSource();
    expect(source.includes('async function findNamespaceByIdInTenant(tenantId: string, namespaceId: string)')).toBe(true);
    expect(source.includes('async function findAgentByIdInTenant(tenantId: string, agentId: string)')).toBe(true);
    expect(source.includes('return withTenantContext(tenantId, false, async (tenantDb) =>')).toBe(true);
    expect(source.includes('tenantDb.query.namespaces.findFirst({')).toBe(true);
    expect(source.includes('tenantDb.query.agents.findFirst({')).toBe(true);
  });

  it('uses tenant-scoped helpers in /api/training/data scope ownership checks', () => {
    const source = loadTrainingSource();
    const dataRouteNamespacePattern =
      /app\.post\('\/api\/training\/data',[\s\S]*?validateNamespaceTenantConsistency\([\s\S]*?async \(id\) => findNamespaceByIdInTenant\(resolvedTenantId, id\)/;
    const dataRouteAgentPattern =
      /app\.post\('\/api\/training\/data',[\s\S]*?const agent = await findAgentByIdInTenant\(resolvedTenantId, body\.agentId\);/;
    expect(dataRouteNamespacePattern.test(source)).toBe(true);
    expect(dataRouteAgentPattern.test(source)).toBe(true);
  });

  it('uses tenant-scoped helpers in /api/training/bulk-import scope ownership checks', () => {
    const source = loadTrainingSource();
    const bulkNamespacePattern =
      /app\.post\('\/api\/training\/bulk-import',[\s\S]*?validateNamespaceTenantConsistency\([\s\S]*?async \(id\) => findNamespaceByIdInTenant\(tenantId, id\)/;
    const bulkAgentPattern =
      /app\.post\('\/api\/training\/bulk-import',[\s\S]*?const agent = await findAgentByIdInTenant\(tenantId, agentId\);/;
    expect(bulkNamespacePattern.test(source)).toBe(true);
    expect(bulkAgentPattern.test(source)).toBe(true);
  });

  it('keeps status review and resolve-scope routes using tenant-scoped helper lookups', () => {
    const source = loadTrainingSource();
    const reviewNamespacePattern =
      /app\.patch\('\/api\/training\/data\/:id\/status',[\s\S]*?findNamespaceByIdInTenant\(existing\.tenantId,\s*overrideScope\.namespaceId\)/;
    const reviewAgentPattern =
      /app\.patch\('\/api\/training\/data\/:id\/status',[\s\S]*?findAgentByIdInTenant\(existing\.tenantId,\s*overrideScope\.agentId\)/;
    const resolveScopeNamespacePattern =
      /app\.patch\('\/api\/training\/data\/:id\/resolve-scope',[\s\S]*?findNamespaceByIdInTenant\(existing\.tenantId,\s*bodyResult\.data\.namespaceId\)/;
    const resolveScopeAgentPattern =
      /app\.patch\('\/api\/training\/data\/:id\/resolve-scope',[\s\S]*?findAgentByIdInTenant\(existing\.tenantId,\s*nextAgentId\)/;
    expect(reviewNamespacePattern.test(source)).toBe(true);
    expect(reviewAgentPattern.test(source)).toBe(true);
    expect(resolveScopeNamespacePattern.test(source)).toBe(true);
    expect(resolveScopeAgentPattern.test(source)).toBe(true);
  });

  it('keeps jobs, schedule and run-start routes validating namespace/agent via tenant-scoped helpers', () => {
    const source = loadTrainingSource();
    const jobsNamespacePattern =
      /app\.post\('\/api\/training\/jobs',[\s\S]*?findNamespaceByIdInTenant\(authorizedTenantId,\s*body\.namespaceId\)/;
    const jobsAgentPattern =
      /app\.post\('\/api\/training\/jobs',[\s\S]*?findAgentByIdInTenant\(tenantId,\s*body\.agentId\)/;
    const scheduleNamespacePattern =
      /app\.post\('\/api\/training\/schedule\/configure',[\s\S]*?findNamespaceByIdInTenant\(scopedTenantId,\s*scheduleNamespaceId\)/;
    const runStartNamespacePattern =
      /app\.post\('\/api\/training\/run\/start',[\s\S]*?findNamespaceByIdInTenant\(scopedTenantId,\s*namespaceId\)/;
    expect(jobsNamespacePattern.test(source)).toBe(true);
    expect(jobsAgentPattern.test(source)).toBe(true);
    expect(scheduleNamespacePattern.test(source)).toBe(true);
    expect(runStartNamespacePattern.test(source)).toBe(true);
  });
});
