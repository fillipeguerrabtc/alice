import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadTrainingSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'training-service', 'src', 'index.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('training immutable audit monitoring guards', () => {
  it('keeps periodic integrity checker and scheduler lifecycle hooks', () => {
    const source = loadTrainingSource();
    expect(source.includes('runTrainingImmutableAuditIntegrityCheck')).toBe(true);
    expect(source.includes('startTrainingImmutableAuditIntegrityScheduler')).toBe(true);
    expect(source.includes('startTrainingImmutableAuditIntegrityScheduler();')).toBe(true);
    expect(source.includes("'training-immutable-audit-integrity-scheduler'")).toBe(true);
  });

  it('exposes operational integrity endpoint and health snapshot', () => {
    const source = loadTrainingSource();
    expect(source.includes("app.get('/api/training/audit/integrity'")).toBe(true);
    expect(source.includes("requirePermission('training:fine_tuning_jobs:read')")).toBe(true);
    expect(source.includes('immutableAuditIntegrity: trainingImmutableAuditIntegrityState')).toBe(true);
    expect(source.includes("stream: 'training_governance'")).toBe(true);
  });
});

