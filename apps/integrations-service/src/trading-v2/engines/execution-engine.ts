import type { AllocationDecision, ExecutionPlanItem } from '../core/types.js';

export function buildExecutionPlan(decisions: AllocationDecision[], liquidityScoreByInstrument: Record<string, number>): ExecutionPlanItem[] {
  return decisions
    .filter((decision): decision is AllocationDecision & { side: 'buy' | 'sell' } => decision.side !== 'hold' && decision.targetWeight > 0)
    .map((decision) => {
      const liquidity = liquidityScoreByInstrument[decision.instrumentId] ?? 0.5;
      const twapLite = decision.targetWeight > 0.2 || liquidity < 0.35;
      const slices = twapLite ? Math.min(8, Math.max(2, Math.ceil(decision.targetWeight / 0.05))) : 1;
      const expectedSlippageBps = twapLite ? 14 : 6;
      const expectedImpactBps = Math.max(1, Math.round((decision.targetWeight / Math.max(liquidity, 0.05)) * 20));
      return {
        instrumentId: decision.instrumentId,
        symbol: decision.symbol,
        side: decision.side,
        targetWeight: decision.targetWeight,
        slicing: twapLite ? 'twap_lite' : 'single',
        slices,
        expectedSlippageBps,
        expectedImpactBps,
        reason: twapLite ? 'size_or_liquidity_requires_twap_lite' : 'single_slice_sufficient',
      };
    });
}
