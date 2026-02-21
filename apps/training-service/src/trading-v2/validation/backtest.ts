export interface BacktestInput {
  returns: number[];
  costsBps: number;
}

export interface BacktestMetrics {
  pnl: number;
  averageReturn: number;
  turnover: number;
  sharpeProxy: number;
}

export function runDeterministicBacktest(input: BacktestInput): BacktestMetrics {
  const costs = input.costsBps / 10_000;
  const net = input.returns.map((value) => value - costs);
  const pnl = net.reduce((sum, value) => sum + value, 0);
  const averageReturn = net.length ? pnl / net.length : 0;
  const variance = net.length
    ? net.reduce((sum, value) => sum + (value - averageReturn) ** 2, 0) / net.length
    : 0;
  const std = Math.sqrt(variance);
  return {
    pnl,
    averageReturn,
    turnover: input.returns.length,
    sharpeProxy: std === 0 ? 0 : averageReturn / std,
  };
}
