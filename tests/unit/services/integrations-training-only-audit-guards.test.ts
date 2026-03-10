import { describe, expect, it } from 'vitest';
import { loadIntegrationsSource } from './helpers/integrations-source';

describe('integrations training-only approval audit guards', () => {
  it('records trading audit for neutral/hold approval path', () => {
    const source = loadIntegrationsSource();
    expect(source.includes('APPROVE_SIGNAL_TRAINING_ONLY')).toBe(true);
    expect(source.includes('deps.recordTradingAuditEvent({')).toBe(true);
    expect(source.includes('auditLogId: auditResult.auditLogId,')).toBe(true);
  });

  it('keeps audit payload bound to dataset quality/duplicate metadata', () => {
    const source = loadIntegrationsSource();
    expect(source.includes('datasetResult.qualityScore')).toBe(true);
    expect(source.includes('datasetResult.duplicate.isDuplicate')).toBe(true);
  });
});
