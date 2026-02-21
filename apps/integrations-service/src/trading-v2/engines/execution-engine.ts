import type { AllocationDecision, ExecutionPlanItem } from '../core/types.js';

export function buildExecutionPlan(decisions: AllocationDecision[], liquidityScoreByInstrument: Record<string, number>): ExecutionPlanItem[] {
  return decisions
    .filter((decision) => decision.side !== 'hold' && decision.targetWeight > 0)
    .map((decision) => {
      const liquidity = liquidityScoreByInstrument[decision.instrumentId] ?? 0.5;
      const twapLite = decision.targetWeight > 0.2 || liquidity < 0.35;
      const slices = twapLite ? Math.min(8, Math.max(2, Math.ceil(decision.targetWeight / 0.05))) : 1;
      return {
        instrumentId: decision.instrumentId,
        symbol: decision.symbol,
        side: decision.side,
        targetWeight: decision.targetWeight,
        slicing: twapLite ? 'twap_lite' : 'single',
        slices,
        expectedSlippageBps: twapLite ? 14 : 6,
      };
    });
}
