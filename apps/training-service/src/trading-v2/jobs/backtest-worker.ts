import { and, desc, eq, getDatabase, lte, schema } from '@alice/database';
import { runDeterministicBacktest } from '../validation/backtest.js';
import { buildWalkForwardPlan } from '../validation/walk-forward.js';
import { computeDeflatedSharpe, computeDsrProbability, computePboFromRanks } from '../validation/multiple-testing.js';

type BacktestPayload = {
  tenantId: string;
  namespaceId?: string;
  instrumentId: string;
  marketType: 'spot' | 'futures' | 'margin';
  strategyKey: string;
  strategyVersion: number;
  operationIntent?: 'scalping' | 'intraday' | 'swing' | 'positional' | 'arbitrage_internal' | 'arbitrage_cross_exchange' | 'cash_and_carry' | 'market_neutral' | 'volatility_breakout';
  timeframe: string;
  lookback: number;
  asofTimestamp: string;
};

const timeframeToDataType: Record<string, (typeof schema.tradingMarketData.$inferSelect)['dataType']> = {
  '1m': 'candle_1m',
  '3m': 'candle_3m',
  '5m': 'candle_5m',
  '15m': 'candle_15m',
  '30m': 'candle_30m',
  '1h': 'candle_1h',
  '2h': 'candle_2h',
  '4h': 'candle_4h',
  '8h': 'candle_8h',
  '12h': 'candle_12h',
  '1d': 'candle_1d',
  '1w': 'candle_1w',
};
const BACKTEST_LIQUIDITY_DEPTH_DROP_WEIGHT = 0.6;
const BACKTEST_LIQUIDITY_IMBALANCE_WEIGHT = 0.2;
const BACKTEST_LIQUIDITY_VOLUME_CAP = 0.2;
const BACKTEST_LIQUIDITY_VOLUME_NORMALIZATION_FACTOR = 1_000_000;
const BACKTEST_SPREAD_BPS_NORMALIZATION_FACTOR = 100;

function parseClose(data: Record<string, unknown>): number | null {
  const close = data.close;
  if (typeof close === 'number' && Number.isFinite(close)) return close;
  if (typeof close === 'string') {
    const parsed = Number(close);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function resolveCostsBps(costModel: (typeof schema.tradingCostModels.$inferSelect) | undefined): number {
  if (!costModel) {
    throw new Error('Cost model não encontrado para backtest');
  }
  const feeBps = Number(costModel.feeBps ?? 0);
  const slippageBps = Number(((costModel.slippageModel ?? {}) as Record<string, unknown>).baseBps ?? 0);
  const spreadBps = Number(((costModel.spreadModel ?? {}) as Record<string, unknown>).baseBps ?? 0);
  return Math.max(0, feeBps + slippageBps + spreadBps);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export async function runBacktestWorker(payload: BacktestPayload): Promise<{ dsr: number; pbo: number }> {
  const startedAt = new Date();
  const db = getDatabase();

  const instrument = await db.query.tradingInstruments.findFirst({
    where: and(
      eq(schema.tradingInstruments.id, payload.instrumentId),
      eq(schema.tradingInstruments.tenantId, payload.tenantId),
    ),
  });
  if (!instrument) {
    throw new Error('Instrumento não encontrado para backtest');
  }

  const dataType = timeframeToDataType[payload.timeframe];
  if (!dataType) {
    throw new Error(`Timeframe não suportado: ${payload.timeframe}`);
  }

  const rows = await db.query.tradingMarketData.findMany({
    where: and(
      eq(schema.tradingMarketData.symbol, instrument.symbol),
      eq(schema.tradingMarketData.dataType, dataType),
      lte(schema.tradingMarketData.timestamp, new Date(payload.asofTimestamp)),
    ),
    orderBy: [desc(schema.tradingMarketData.timestamp)],
    limit: payload.lookback + 1,
  });

  const closes = rows
    .map((row) => parseClose((row.data ?? {}) as Record<string, unknown>))
    .filter((value): value is number => value !== null)
    .reverse();
  const returns = closes.slice(1).map((close, index) => (close - closes[index]) / Math.max(closes[index], 1e-9));
  if (returns.length < 20) {
    throw new Error('Série insuficiente para backtest robusto');
  }

  const costModel = await db.query.tradingCostModels.findFirst({
    where: and(
      eq(schema.tradingCostModels.tenantId, payload.tenantId),
      eq(schema.tradingCostModels.venue, instrument.venue),
      eq(schema.tradingCostModels.assetClass, instrument.assetClass),
      eq(schema.tradingCostModels.marketType, payload.marketType),
      eq(schema.tradingCostModels.active, true),
    ),
    orderBy: [desc(schema.tradingCostModels.version)],
  });
  const costsBps = resolveCostsBps(costModel ?? undefined);
  const microSnapshots = await db.query.tradingOrderbookSnapshots.findMany({
    where: and(
      eq(schema.tradingOrderbookSnapshots.tenantId, payload.tenantId),
      eq(schema.tradingOrderbookSnapshots.instrumentId, payload.instrumentId),
      eq(schema.tradingOrderbookSnapshots.marketType, payload.marketType),
      eq(schema.tradingOrderbookSnapshots.timeframe, payload.timeframe as typeof schema.tradingOrderbookSnapshots.$inferSelect['timeframe']),
      lte(schema.tradingOrderbookSnapshots.snapshotAt, new Date(payload.asofTimestamp)),
    ),
    orderBy: [desc(schema.tradingOrderbookSnapshots.snapshotAt)],
    limit: Math.max(returns.length, 10),
  });
  const tradeAggRows = await db.query.tradingTradeTicksAgg.findMany({
    where: and(
      eq(schema.tradingTradeTicksAgg.tenantId, payload.tenantId),
      eq(schema.tradingTradeTicksAgg.instrumentId, payload.instrumentId),
      eq(schema.tradingTradeTicksAgg.marketType, payload.marketType),
      eq(schema.tradingTradeTicksAgg.timeframe, payload.timeframe as typeof schema.tradingTradeTicksAgg.$inferSelect['timeframe']),
      lte(schema.tradingTradeTicksAgg.windowEnd, new Date(payload.asofTimestamp)),
    ),
    orderBy: [desc(schema.tradingTradeTicksAgg.windowEnd)],
    limit: Math.max(returns.length, 10),
  });
  const liquidityByBar = returns.map((_, index) => {
    const micro = microSnapshots[index % Math.max(microSnapshots.length, 1)];
    const tradeAgg = tradeAggRows[index % Math.max(tradeAggRows.length, 1)];
    const depthDrop = Number(micro?.depthDropRatio ?? 0);
    const imbalance = Math.abs(Number(micro?.orderBookImbalance ?? 0));
    const volumeProxy = Number(tradeAgg?.buyVolume ?? 0) + Number(tradeAgg?.sellVolume ?? 0);
    const liquidity = 1
      - (depthDrop * BACKTEST_LIQUIDITY_DEPTH_DROP_WEIGHT)
      - (imbalance * BACKTEST_LIQUIDITY_IMBALANCE_WEIGHT)
      + Math.min(BACKTEST_LIQUIDITY_VOLUME_CAP, volumeProxy / BACKTEST_LIQUIDITY_VOLUME_NORMALIZATION_FACTOR);
    return clamp01(liquidity);
  });
  const depthPressureByBar = returns.map((_, index) => {
    const micro = microSnapshots[index % Math.max(microSnapshots.length, 1)];
    const spreadBps = Number(micro?.spreadBps ?? 0);
    const depthDrop = Number(micro?.depthDropRatio ?? 0);
    const pressure = (spreadBps / BACKTEST_SPREAD_BPS_NORMALIZATION_FACTOR) + depthDrop;
    return clamp01(pressure);
  });

  const timestamps = returns.map((_, index) => index + 1);
  const walkForward = buildWalkForwardPlan(timestamps, 4, 2, 1);

  const splitMetrics = walkForward.splits.map((split) => {
    const trainEndIndex = Math.max(1, split.trainEnd - split.trainStart);
    const testStartIndex = Math.max(0, split.testStart - timestamps[0]);
    const testEndIndex = Math.max(testStartIndex + 1, split.testEnd - timestamps[0]);
    const trainReturns = returns.slice(0, trainEndIndex);
    const testReturns = returns.slice(testStartIndex, testEndIndex + 1);
    return {
      train: runDeterministicBacktest({
        returns: trainReturns,
        costsBps,
        liquidityByBar: liquidityByBar.slice(0, trainReturns.length),
        depthPressureByBar: depthPressureByBar.slice(0, trainReturns.length),
        slippageMultiplier: 1.1,
      }),
      test: runDeterministicBacktest({
        returns: testReturns,
        costsBps,
        liquidityByBar: liquidityByBar.slice(testStartIndex, testStartIndex + testReturns.length),
        depthPressureByBar: depthPressureByBar.slice(testStartIndex, testStartIndex + testReturns.length),
        slippageMultiplier: 1.1,
      }),
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

  const finalBacktest = runDeterministicBacktest({
    returns,
    costsBps,
    liquidityByBar,
    depthPressureByBar,
    slippageMultiplier: 1.1,
  });
  const dsr = computeDeflatedSharpe(aggregateOOS || finalBacktest.sharpeProxy, Math.max(splitMetrics.length, 1), returns.length || 2);
  const inSampleRanks = inSampleSharpe
    .map((value, index) => ({ value, rank: index + 1 }))
    .sort((a, b) => b.value - a.value)
    .map((entry) => entry.rank);
  const outSampleRanks = outSampleSharpe
    .map((value, index) => ({ value, rank: index + 1 }))
    .sort((a, b) => b.value - a.value)
    .map((entry) => entry.rank);
  const pbo = computePboFromRanks(inSampleRanks, outSampleRanks);

  await db.insert(schema.tradingBacktestRuns).values({
    tenantId: payload.tenantId,
    instrumentId: payload.instrumentId,
    marketType: payload.marketType,
    operationIntent: payload.operationIntent ?? 'intraday',
    strategyKey: payload.strategyKey,
    strategyVersion: payload.strategyVersion,
    walkForwardConfig: {
      folds: 4,
      purgeBars: 2,
      embargoBars: 1,
      timeframe: payload.timeframe,
      lookback: payload.lookback,
      asofTimestamp: payload.asofTimestamp,
      splits: walkForward.splits,
      microstructureInput: {
        microSnapshots: microSnapshots.length,
        tradeAggRows: tradeAggRows.length,
      },
    },
    costModel: {
      costModelId: costModel?.id ?? null,
      version: costModel?.version ?? null,
      costsBps,
    },
    metrics: {
      aggregateInSampleSharpe: aggregateIS,
      splitMetrics: splitMetrics.map((split) => split.train),
      backtest: finalBacktest,
      dataWindow: {
        from: rows[rows.length - 1]?.timestamp ?? null,
        to: rows[0]?.timestamp ?? null,
        count: rows.length,
      },
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

  return { dsr, pbo };
}
