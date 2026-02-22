import { describe, expect, it } from 'vitest';
import { runDeterministicBacktest } from '../../apps/training-service/src/trading-v2/validation/backtest';

describe('backtest execution realism', () => {
  it('reduces pnl under low liquidity and high depth pressure', () => {
    const baseline = runDeterministicBacktest({
      returns: [0.01, 0.012, -0.005, 0.008],
      costsBps: 10,
      liquidityByBar: [1, 1, 1, 1],
      depthPressureByBar: [0, 0, 0, 0],
      slippageMultiplier: 1,
    });

    const stressed = runDeterministicBacktest({
      returns: [0.01, 0.012, -0.005, 0.008],
      costsBps: 10,
      liquidityByBar: [0.2, 0.2, 0.2, 0.2],
      depthPressureByBar: [0.8, 0.8, 0.8, 0.8],
      slippageMultiplier: 1.3,
    });

    expect(stressed.pnl).toBeLessThan(baseline.pnl);
    expect(stressed.partialFillRate).toBeLessThan(baseline.partialFillRate);
    expect(stressed.averageSlippageBps).toBeGreaterThan(baseline.averageSlippageBps);
  });
});
