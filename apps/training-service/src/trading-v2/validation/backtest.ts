export interface BacktestInput {
  returns: number[];
  costsBps: number;
  liquidityByBar?: number[];
  depthPressureByBar?: number[];
  slippageMultiplier?: number;
}

export interface BacktestMetrics {
  pnl: number;
  averageReturn: number;
  turnover: number;
  sharpeProxy: number;
  partialFillRate: number;
  averageSlippageBps: number;
}

export function runDeterministicBacktest(input: BacktestInput): BacktestMetrics {
  const slippageMultiplier = Number.isFinite(input.slippageMultiplier) ? Math.max(0, input.slippageMultiplier ?? 1) : 1;
  const net = input.returns.map((value, index) => {
    const liquidity = Math.max(0.05, Math.min(1, input.liquidityByBar?.[index] ?? 1));
    const depthPressure = Math.max(0, Math.min(1, input.depthPressureByBar?.[index] ?? 0));
    const fillRatio = Math.max(0.1, Math.min(1, liquidity * (1 - (depthPressure * 0.5))));
    const effectiveSlippageBps = input.costsBps * slippageMultiplier * (1 + depthPressure) * (1 / Math.max(liquidity, 0.1));
    const effectiveCost = effectiveSlippageBps / 10_000;
    return (value * fillRatio) - effectiveCost;
  });
  const pnl = net.reduce((sum, value) => sum + value, 0);
  const averageReturn = net.length ? pnl / net.length : 0;
  const variance = net.length
    ? net.reduce((sum, value) => sum + (value - averageReturn) ** 2, 0) / net.length
    : 0;
  const std = Math.sqrt(variance);
  const averageFillRatio = net.length
    ? net.reduce((sum, _value, index) => {
      const liquidity = Math.max(0.05, Math.min(1, input.liquidityByBar?.[index] ?? 1));
      const depthPressure = Math.max(0, Math.min(1, input.depthPressureByBar?.[index] ?? 0));
      return sum + Math.max(0.1, Math.min(1, liquidity * (1 - (depthPressure * 0.5))));
    }, 0) / net.length
    : 1;
  const averageSlippageBps = net.length
    ? net.reduce((sum, _value, index) => {
      const liquidity = Math.max(0.05, Math.min(1, input.liquidityByBar?.[index] ?? 1));
      const depthPressure = Math.max(0, Math.min(1, input.depthPressureByBar?.[index] ?? 0));
      return sum + (input.costsBps * slippageMultiplier * (1 + depthPressure) * (1 / Math.max(liquidity, 0.1)));
    }, 0) / net.length
    : input.costsBps;
  return {
    pnl,
    averageReturn,
    turnover: input.returns.length,
    sharpeProxy: std === 0 ? 0 : averageReturn / std,
    partialFillRate: averageFillRatio,
    averageSlippageBps,
  };
}
