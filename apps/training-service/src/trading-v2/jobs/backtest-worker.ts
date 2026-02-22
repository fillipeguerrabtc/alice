import { getDatabase, schema } from '@alice/database';
import { runDeterministicBacktest } from '../validation/backtest.js';
import { buildWalkForwardPlan } from '../validation/walk-forward.js';
import { computeDeflatedSharpe, computeDsrProbability, computePboFromRanks } from '../validation/multiple-testing.js';

export async function runBacktestWorker(payload: { tenantId: string; instrumentId?: string; marketType: 'spot' | 'futures' | 'margin'; strategyKey: string; strategyVersion: number; returns: number[]; costsBps: number }) {
  const startedAt = new Date();
  const timestamps = payload.returns.map((_, index) => index + 1);
  const walkForward = buildWalkForwardPlan(timestamps, 4, 2, 1);

  const splitMetrics = walkForward.splits.map((split) => {
    const trainEndIndex = Math.max(1, split.trainEnd - split.trainStart);
    const testStartIndex = Math.max(0, split.testStart - timestamps[0]);
    const testEndIndex = Math.max(testStartIndex + 1, split.testEnd - timestamps[0]);
    const trainReturns = payload.returns.slice(0, trainEndIndex);
    const testReturns = payload.returns.slice(testStartIndex, testEndIndex + 1);
    return {
      train: runDeterministicBacktest({ returns: trainReturns, costsBps: payload.costsBps }),
      test: runDeterministicBacktest({ returns: testReturns, costsBps: payload.costsBps }),
    };
  });

  const inSampleSharpe = splitMetrics.map((split) => split.train.sharpeProxy);
  const outSampleSharpe = splitMetrics.map((split) => split.test.sharpeProxy);
  const aggregateIS = inSampleSharpe.length > 0
    ? inSampleSharpe.reduce((sum, value) => sum + value, 0) / inSampleSharpe.length
    : 0;
  const aggregateOOS = outSampleSharpe.length > 0
    ? outSampleSharpe.reduce((sum, value) => sum + value, 0) / outSampleSharpe.length
    : 0;

  const finalBacktest = runDeterministicBacktest({ returns: payload.returns, costsBps: payload.costsBps });
  const dsr = computeDeflatedSharpe(aggregateOOS || finalBacktest.sharpeProxy, Math.max(splitMetrics.length, 1), payload.returns.length || 2);
  const inSampleRanks = inSampleSharpe
    .map((value, index) => ({ value, rank: index + 1 }))
    .sort((a, b) => b.value - a.value)
    .map((entry) => entry.rank);
  const outSampleRanks = outSampleSharpe
    .map((value, index) => ({ value, rank: index + 1 }))
    .sort((a, b) => b.value - a.value)
    .map((entry) => entry.rank);
  const pbo = computePboFromRanks(inSampleRanks, outSampleRanks);
  const db = getDatabase();
  await db.insert(schema.tradingBacktestRuns).values({
    tenantId: payload.tenantId,
    instrumentId: payload.instrumentId,
    marketType: payload.marketType,
    strategyKey: payload.strategyKey,
    strategyVersion: payload.strategyVersion,
    walkForwardConfig: {
      folds: 4,
      purgeBars: 2,
      embargoBars: 1,
      splits: walkForward.splits,
    },
    costModel: {
      costsBps: payload.costsBps,
    },
    metrics: {
      aggregateInSampleSharpe: aggregateIS,
      splitMetrics: splitMetrics.map((split) => split.train),
      backtest: finalBacktest,
    },
    oosMetrics: {
      aggregateOutOfSampleSharpe: aggregateOOS,
      splitMetrics: splitMetrics.map((split) => split.test),
      dsrProbability: computeDsrProbability(dsr),
    },
    dsr: {
      value: dsr,
      probability: computeDsrProbability(dsr),
      trials: splitMetrics.length,
    },
    pbo: {
      value: pbo,
      inSampleRanks,
      outSampleRanks,
    },
    status: 'succeeded',
    startedAt,
    finishedAt: new Date(),
  });
}
