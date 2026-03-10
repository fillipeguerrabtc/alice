import { describe, expect, it } from 'vitest';
import { loadTrainingSource } from './helpers/training-source';

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
    expect(source.includes("app.get('/api/training/audit/high-risk'")).toBe(true);
    expect(source.includes("requirePermission('training:fine_tuning_jobs:read')")).toBe(true);
    expect(source.includes('immutableAuditIntegrity:')).toBe(true);
    expect(source.includes("stream: 'training_governance'")).toBe(true);
    expect(source.includes('alice_high_risk_audit_events_total')).toBe(true);
  });
});
