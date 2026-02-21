import { getDatabase, schema } from '@alice/database';
import { runDeterministicBacktest } from '../validation/backtest.js';
import { computeDeflatedSharpe, computeDsrProbability, computePboFromRanks } from '../validation/multiple-testing.js';

export async function runBacktestWorker(payload: { tenantId: string; instrumentId?: string; marketType: 'spot' | 'futures' | 'margin'; strategyKey: string; strategyVersion: number; returns: number[]; costsBps: number }) {
  const backtest = runDeterministicBacktest({ returns: payload.returns, costsBps: payload.costsBps });
  const dsr = computeDeflatedSharpe(backtest.sharpeProxy, 10, payload.returns.length || 2);
  const inSampleRanks = payload.returns
    .map((value, index) => ({ value, rank: index + 1 }))
    .sort((a, b) => b.value - a.value)
    .map((entry) => entry.rank);
  const outSampleRanks = [...inSampleRanks].reverse();
  const pbo = computePboFromRanks(inSampleRanks, outSampleRanks);
  const db = getDatabase();
  await db.insert(schema.tradingBacktestRuns).values({
    tenantId: payload.tenantId,
    instrumentId: payload.instrumentId,
    marketType: payload.marketType,
    strategyKey: payload.strategyKey,
    strategyVersion: payload.strategyVersion,
    metrics: { backtest },
    oosMetrics: { probability: computeDsrProbability(dsr) },
    dsr: { value: dsr },
    pbo: { value: pbo },
    status: 'succeeded',
    startedAt: new Date(),
    finishedAt: new Date(),
  });
}
