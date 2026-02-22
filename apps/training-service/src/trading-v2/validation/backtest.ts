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

const MIN_SLIPPAGE_MULTIPLIER = 0.1;
const MIN_LIQUIDITY_THRESHOLD = 0.05;
const MAX_LIQUIDITY_THRESHOLD = 1;
const DEPTH_PRESSURE_FILL_IMPACT = 0.5;
const MIN_FILL_RATIO = 0.1;
const MAX_FILL_RATIO = 1;

function computeEffectiveSlippageBps(input: {
  baseCostsBps: number;
  slippageMultiplier: number;
  liquidity: number;
  depthPressure: number;
}): number {
  return input.baseCostsBps * input.slippageMultiplier * (1 + input.depthPressure) * (1 / Math.max(input.liquidity, 0.1));
}

function computeFillRatio(input: { liquidity: number; depthPressure: number }): number {
  return Math.max(
    MIN_FILL_RATIO,
    Math.min(MAX_FILL_RATIO, input.liquidity * (1 - (input.depthPressure * DEPTH_PRESSURE_FILL_IMPACT))),
  );
}

export function runDeterministicBacktest(input: BacktestInput): BacktestMetrics {
  const slippageMultiplier = Math.max(MIN_SLIPPAGE_MULTIPLIER, input.slippageMultiplier ?? 1);
  const barControls = input.returns.map((_value, index) => {
    const liquidity = Math.max(MIN_LIQUIDITY_THRESHOLD, Math.min(MAX_LIQUIDITY_THRESHOLD, input.liquidityByBar?.[index] ?? 1));
    const depthPressure = Math.max(0, Math.min(1, input.depthPressureByBar?.[index] ?? 0));
    const fillRatio = computeFillRatio({ liquidity, depthPressure });
    return { liquidity, depthPressure, fillRatio };
  });
  const net = input.returns.map((value, index) => {
    const controls = barControls[index] ?? { liquidity: 1, depthPressure: 0, fillRatio: 1 };
    const effectiveSlippageBps = computeEffectiveSlippageBps({
      baseCostsBps: input.costsBps,
      slippageMultiplier,
      liquidity: controls.liquidity,
      depthPressure: controls.depthPressure,
    });
    const effectiveCost = effectiveSlippageBps / 10_000;
    return (value * controls.fillRatio) - effectiveCost;
  });
  const pnl = net.reduce((sum, value) => sum + value, 0);
  const averageReturn = net.length ? pnl / net.length : 0;
  const variance = net.length
    ? net.reduce((sum, value) => sum + (value - averageReturn) ** 2, 0) / net.length
    : 0;
  const std = Math.sqrt(variance);
  const averageFillRatio = net.length
    ? barControls.reduce((sum, controls) => sum + controls.fillRatio, 0) / net.length
    : 1;
  const averageSlippageBps = net.length
    ? barControls.reduce((sum, controls) => {
      return sum + computeEffectiveSlippageBps({
        baseCostsBps: input.costsBps,
        slippageMultiplier,
        liquidity: controls.liquidity,
        depthPressure: controls.depthPressure,
      });
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
