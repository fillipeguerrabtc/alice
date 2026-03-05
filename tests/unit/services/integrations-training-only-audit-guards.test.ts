import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadIntegrationsSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'integrations-service', 'src', 'index.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('integrations training-only approval audit guards', () => {
  it('records trading audit for neutral/hold approval path', () => {
    const source = loadIntegrationsSource();
    expect(source.includes('APPROVE_SIGNAL_TRAINING_ONLY')).toBe(true);
    expect(source.includes('kucoinService.recordTradingAuditEvent({')).toBe(true);
    expect(source.includes('auditLogId: auditResult.auditLogId,')).toBe(true);
  });

  it('keeps audit payload bound to dataset quality/duplicate metadata', () => {
    const source = loadIntegrationsSource();
    expect(source.includes('datasetResult.qualityScore')).toBe(true);
    expect(source.includes('datasetResult.duplicate.isDuplicate')).toBe(true);
  });
});

