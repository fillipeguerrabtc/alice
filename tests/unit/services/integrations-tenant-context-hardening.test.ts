import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadIntegrationsSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'integrations-service', 'src', 'index.ts');
  return readFileSync(sourcePath, 'utf-8');
}

function loadDatasetGeneratorSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'integrations-service', 'src', 'dataset-generator.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('integrations tenant-context hardening', () => {
  it('keeps postmortem read routes running inside withTenantContext', () => {
    const source = loadIntegrationsSource();
    const byPositionPattern =
      /app\.get\('\/api\/integrations\/postmortem\/:positionId'[\s\S]*?withTenantContext\(tenantId,\s*false,\s*async\s*\(tx\)\s*=>/;
    const listPattern =
      /app\.get\('\/api\/integrations\/postmortem'[\s\S]*?withTenantContext\(tenantId,\s*false,\s*async\s*\(tx\)\s*=>/;
    expect(byPositionPattern.test(source)).toBe(true);
    expect(listPattern.test(source)).toBe(true);
  });

  it('keeps namespace ownership checks tenant-scoped for send-to-training routes', () => {
    const source = loadIntegrationsSource();
    const singlePattern =
      /app\.post\('\/api\/integrations\/postmortem\/send-to-training'[\s\S]*?withTenantContext\(tenantId,\s*false,\s*async\s*\(tx\)\s*=>[\s\S]*?tx\.query\.namespaces\.findFirst/;
    const batchPattern =
      /app\.post\('\/api\/integrations\/postmortem\/send-to-training\/batch'[\s\S]*?withTenantContext\(tenantId,\s*false,\s*async\s*\(tx\)\s*=>[\s\S]*?tx\.query\.namespaces\.findFirst/;
    expect(singlePattern.test(source)).toBe(true);
    expect(batchPattern.test(source)).toBe(true);
  });

  it('passes tenant context into postmortem DLQ retry operation', () => {
    const source = loadIntegrationsSource();
    const retryRoutePattern =
      /app\.post\('\/api\/integrations\/postmortem\/queue\/retry\/:jobId'[\s\S]*?const tenantId = req\.tenantId;[\s\S]*?retryPostMortemDlqJob\(req\.params\.jobId,\s*tenantId\)/;
    expect(retryRoutePattern.test(source)).toBe(true);
  });

  it('restricts postmortem queue stats endpoint to manage permission', () => {
    const source = loadIntegrationsSource();
    const queueStatsPattern =
      /app\.get\('\/api\/integrations\/postmortem\/queue\/stats',\s*requirePermission\('integrations:trading:manage'\),/;
    expect(queueStatsPattern.test(source)).toBe(true);
  });

  it('keeps dataset generator wrapped by withTenantContext fail-closed scope', () => {
    const source = loadDatasetGeneratorSource();
    expect(source.includes('return withTenantContext(tenantId, false, async (db) => {')).toBe(true);
  });

  it('keeps snapshot reads and sentToTraining update scoped by tenant in dataset generation', () => {
    const source = loadDatasetGeneratorSource();
    const snapshotTenantGuardCount = (source.match(/eq\(schema\.tradingSnapshots\.tenantId,\s*tenantId\)/g) ?? []).length;
    expect(snapshotTenantGuardCount).toBeGreaterThanOrEqual(2);
    const updateGuardPattern =
      /\.update\(schema\.tradingPostmortems\)[\s\S]*?\.where\(and\([\s\S]*?eq\(schema\.tradingPostmortems\.tenantId,\s*tenantId\)/;
    expect(updateGuardPattern.test(source)).toBe(true);
  });
});
