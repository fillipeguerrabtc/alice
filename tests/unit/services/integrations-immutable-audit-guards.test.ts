import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadKucoinServiceSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'integrations-service', 'src', 'kucoinService.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('integrations immutable audit guards', () => {
  it('persists trading audit and immutable audit in the same transaction', () => {
    const source = loadKucoinServiceSource();
    expect(source.includes('const [result] = await db.transaction(async (tx) => {')).toBe(true);
    expect(source.includes('.insert(schema.tradingAuditLog)')).toBe(true);
    expect(source.includes('appendImmutableAuditEventWithExecutor({')).toBe(true);
    expect(source.includes("stream: 'trading_operations',")).toBe(true);
  });

  it('keeps immutable audit payload containing action details and before/after states', () => {
    const source = loadKucoinServiceSource();
    expect(source.includes('payload: {')).toBe(true);
    expect(source.includes('details,')).toBe(true);
    expect(source.includes('previousState: previousState ?? null,')).toBe(true);
    expect(source.includes('newState: newState ?? null,')).toBe(true);
  });

  it('exposes high-risk audit observer hooks for approval/rejection/risk actions', () => {
    const source = loadKucoinServiceSource();
    expect(source.includes('setHighRiskAuditMetricObserver')).toBe(true);
    expect(source.includes('observeHighRiskAuditMetric(')).toBe(true);
    expect(source.includes("normalizedAction.includes('approve')")).toBe(true);
    expect(source.includes("normalizedAction.includes('reject')")).toBe(true);
  });
});
