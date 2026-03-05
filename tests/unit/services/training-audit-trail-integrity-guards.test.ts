import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadTrainingSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'training-service', 'src', 'index.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('training audit-trail integrity guards', () => {
  it('includes immutable audit stream payload in audit-trail endpoint', () => {
    const source = loadTrainingSource();
    expect(source.includes("app.get('/api/training/jobs/:id/audit-trail'")).toBe(true);
    expect(source.includes("eq(schema.immutableAuditEvents.stream, 'training_governance')")).toBe(true);
    expect(source.includes('immutableAudit: {')).toBe(true);
    expect(source.includes('streamKey: immutableStreamKey,')).toBe(true);
  });

  it('verifies chain order and previous-hash linkage before responding', () => {
    const source = loadTrainingSource();
    expect(source.includes('function verifyImmutableChain(events: Array<{')).toBe(true);
    expect(source.includes('CHAIN_POSITION_MISMATCH')).toBe(true);
    expect(source.includes('PREV_HASH_MISMATCH')).toBe(true);
    expect(source.includes('const immutableIntegrity = verifyImmutableChain(')).toBe(true);
  });
});

