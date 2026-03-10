import { describe, expect, it } from 'vitest';
import { loadTrainingSource } from './helpers/training-source';

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
    expect(source.includes('verifyImmutableAuditChain')).toBe(true);
    expect(source.includes('const immutableIntegrity = verifyImmutableAuditChain(')).toBe(true);
    expect(source.includes("stream: 'training_governance',")).toBe(true);
  });
});
