import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function load(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('integrations trading risk gate guards', () => {
  it('keeps explicit risk gate and real-order metrics wiring', () => {
    const source = load('apps/integrations-service/src/index.ts');
    expect(source.includes('alice_trading_risk_gate_block_total')).toBe(true);
    expect(source.includes('alice_trading_real_order_attempt_total')).toBe(true);
    expect(source.includes('kucoinService.setTradingRiskGateMetricObserver')).toBe(true);
    expect(source.includes('kucoinService.setTradingRealOrderAttemptMetricObserver')).toBe(true);
  });

  it('keeps structured risk gate decisions in kucoin service flows', () => {
    const source = load('apps/integrations-service/src/kucoinService.ts');
    expect(source.includes('reasonCode')).toBe(true);
    expect(source.includes('riskGateDecision')).toBe(true);
    expect(source.includes('riskGateReason')).toBe(true);
    expect(source.includes("observeTradingRealOrderAttemptMetric('blocked'")).toBe(true);
  });

  it('keeps risk gate decision columns on trading_orders schema', () => {
    const source = load('packages/shared/src/schema.ts');
    expect(source.includes('riskGateDecision: varchar("risk_gate_decision"')).toBe(true);
    expect(source.includes('riskGateReason: text("risk_gate_reason")')).toBe(true);
  });
});
