import { and, desc, eq, getDatabase, schema } from '@alice/database';
import { z } from 'zod';

const tradingIntervalSchema = z.enum(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '1w']);

type UniversePayload = {
  tenantId: string;
  instrumentId: string;
  marketType: 'spot' | 'futures' | 'margin';
  timeframe: string;
  strategyKey: string;
  strategyVersion: number;
  candleTimestamp: string;
};

function toDataType(interval: z.infer<typeof tradingIntervalSchema>): (typeof schema.tradingMarketData.$inferSelect)['dataType'] {
  const map: Record<z.infer<typeof tradingIntervalSchema>, (typeof schema.tradingMarketData.$inferSelect)['dataType']> = {
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
  return map[interval];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, value) => sum + ((value - m) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function skew(values: number[]): number {
  if (values.length < 3) return 0;
  const m = mean(values);
  const s = std(values);
  if (s === 0) return 0;
  return values.reduce((sum, value) => sum + (((value - m) / s) ** 3), 0) / values.length;
}

function kurt(values: number[]): number {
  if (values.length < 4) return 0;
  const m = mean(values);
  const s = std(values);
  if (s === 0) return 0;
  return values.reduce((sum, value) => sum + (((value - m) / s) ** 4), 0) / values.length;
}

function autocorrProxy(values: number[]): number {
  if (values.length < 3) return 0;
  const left = values.slice(0, -1);
  const right = values.slice(1);
  const lm = mean(left);
  const rm = mean(right);
  const numerator = left.reduce((sum, value, index) => sum + ((value - lm) * (right[index] - rm)), 0);
  const denom = Math.sqrt(
    left.reduce((sum, value) => sum + ((value - lm) ** 2), 0)
    * right.reduce((sum, value) => sum + ((value - rm) ** 2), 0),
  );
  if (denom === 0) return 0;
  return numerator / denom;
}

function parseCandleClose(data: Record<string, unknown>): number | null {
  const close = data.close;
  if (typeof close === 'number' && Number.isFinite(close)) return close;
  if (typeof close === 'string') {
    const parsed = Number(close);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseCandleVolume(data: Record<string, unknown>): number {
  const volume = data.volume;
  if (typeof volume === 'number' && Number.isFinite(volume)) return volume;
  if (typeof volume === 'string') {
    const parsed = Number(volume);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export async function runUniverseScanWorker(payload: UniversePayload): Promise<{ side: 'long' | 'short' | 'neutral' }> {
  const db = getDatabase();
  const timeframe = tradingIntervalSchema.parse(payload.timeframe);
  const candleTimestamp = new Date(payload.candleTimestamp);

  const instrument = await db.query.tradingInstruments.findFirst({
    where: and(
      eq(schema.tradingInstruments.id, payload.instrumentId),
      eq(schema.tradingInstruments.tenantId, payload.tenantId),
    ),
  });
  if (!instrument) {
    throw new Error('Instrumento não encontrado para universe scan');
  }

  const strategy = await db.query.tradingStrategyRegistry.findFirst({
    where: and(
      eq(schema.tradingStrategyRegistry.strategyKey, payload.strategyKey),
      eq(schema.tradingStrategyRegistry.version, payload.strategyVersion),
      eq(schema.tradingStrategyRegistry.enabled, true),
    ),
  });
  if (!strategy) {
    throw new Error('Estratégia não habilitada para universe scan');
  }

  const rows = await db.query.tradingMarketData.findMany({
    where: and(
      eq(schema.tradingMarketData.symbol, instrument.symbol),
      eq(schema.tradingMarketData.dataType, toDataType(timeframe)),
    ),
    orderBy: [desc(schema.tradingMarketData.timestamp)],
    limit: 120,
  });

  const closes = rows
    .map((row) => parseCandleClose((row.data ?? {}) as Record<string, unknown>))
    .filter((value): value is number => value !== null)
    .reverse();
  const volumes = rows.map((row) => parseCandleVolume((row.data ?? {}) as Record<string, unknown>));
  const returns = closes.slice(1).map((close, index) => (close - closes[index]) / Math.max(closes[index], 1e-9));
  const expectedReturn = mean(returns);
  const expectedVolatility = std(returns);
  const sharpeProxy = expectedVolatility === 0 ? 0 : expectedReturn / expectedVolatility;
  const liquidityProxy = Math.min(1, mean(volumes) / Math.max(...volumes, 1));

  const latestIndicator = await db.query.tradingTechnicalIndicators.findFirst({
    where: and(
      eq(schema.tradingTechnicalIndicators.tenantId, payload.tenantId),
      eq(schema.tradingTechnicalIndicators.symbol, instrument.symbol),
      eq(schema.tradingTechnicalIndicators.interval, timeframe),
    ),
    orderBy: [desc(schema.tradingTechnicalIndicators.calculatedAt)],
  });

  const signal = latestIndicator?.overallSignal ?? 'neutral';

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

  const feeBps = Number(costModel?.feeBps ?? 0);
  const slippageBps = Number(((costModel?.slippageModel ?? {}) as Record<string, unknown>).baseBps ?? 0);
  const spreadBps = Number(((costModel?.spreadModel ?? {}) as Record<string, unknown>).baseBps ?? 0);
  const totalCost = (feeBps + slippageBps + spreadBps) / 10_000;
  const expectedEdge = expectedReturn - totalCost;
  const confidenceRaw = Math.max(0, Math.min(1, (Math.abs(expectedEdge) / Math.max(expectedVolatility, 1e-6)) * (latestIndicator?.signalConfidence ?? 0.5)));

  const currentPrice = closes.length > 0 ? closes[closes.length - 1] : Number(latestIndicator?.currentPrice ?? 0);
  const stopDistance = Math.max(expectedVolatility * currentPrice * 1.2, currentPrice * 0.003);
  const takeProfitDistance = Math.max(expectedVolatility * currentPrice * 1.8, currentPrice * 0.005);
  const entryModel = {
    entry: currentPrice,
    stop: side === 'short' ? currentPrice + stopDistance : currentPrice - stopDistance,
    takeProfit: side === 'short' ? currentPrice - takeProfitDistance : currentPrice + takeProfitDistance,
    liquidityProxy,
  };

  const strategyParams = (strategy.params ?? {}) as Record<string, unknown>;
  const longThreshold = Number(strategyParams.longThreshold ?? 0);
  const shortThreshold = Number(strategyParams.shortThreshold ?? 0);
  const sideByThreshold: 'long' | 'short' | 'neutral' = expectedEdge >= longThreshold
    ? 'long'
    : expectedEdge <= shortThreshold
      ? 'short'
      : 'neutral';

  const riskFlags: unknown[] = [];
  if (expectedEdge <= 0) {
    riskFlags.push('edge_liquido_negativo');
  }
  if (!costModel) {
    riskFlags.push('missing_cost_model');
  }

  await db.insert(schema.tradingFactorSnapshotsV2).values({
    tenantId: payload.tenantId,
    instrumentId: payload.instrumentId,
    marketType: payload.marketType,
    interval: timeframe,
    candleTimestamp,
    asofTimestamp: new Date(),
    featureVersion: payload.strategyVersion,
    regimes: {
      signal,
      trend: latestIndicator?.maTrend ?? 'neutral',
      volatilityRegime: latestIndicator?.atrVolatility ?? 'low',
    },
    factors: {
      meanReturn: expectedReturn,
      volatility: expectedVolatility,
      skew: skew(returns),
      kurtosis: kurt(returns),
      autocorr: autocorrProxy(returns),
      liquidityProxy,
      indicatorConfidence: latestIndicator?.signalConfidence ?? 0.5,
      dataWindow: {
        from: rows[rows.length - 1]?.timestamp ?? null,
        to: rows[0]?.timestamp ?? null,
        count: rows.length,
      },
    },
    costsEstimate: {
      feeBps,
      slippageBps,
      spreadBps,
      totalCost,
    },
    expectedReturn: String(expectedReturn),
    expectedVolatility: String(expectedVolatility),
    sharpeProxy: String(sharpeProxy),
    riskScore: String(Math.min(1, expectedVolatility * 10)),
  }).onConflictDoNothing();

  await db.insert(schema.tradingUniverseCandidates).values({
    tenantId: payload.tenantId,
    instrumentId: payload.instrumentId,
    marketType: payload.marketType,
    strategyKey: payload.strategyKey,
    strategyVersion: payload.strategyVersion,
    timeframe,
    candleTimestamp,
    side: costModel ? sideByThreshold : 'neutral',
    entryModel,
    expectedEdge: String(expectedEdge),
    confidenceRaw: String(confidenceRaw),
    riskFlags,
  }).onConflictDoUpdate({
    target: [
      schema.tradingUniverseCandidates.tenantId,
      schema.tradingUniverseCandidates.instrumentId,
      schema.tradingUniverseCandidates.marketType,
      schema.tradingUniverseCandidates.timeframe,
      schema.tradingUniverseCandidates.candleTimestamp,
      schema.tradingUniverseCandidates.strategyKey,
      schema.tradingUniverseCandidates.strategyVersion,
    ],
    set: {
      side: costModel ? sideByThreshold : 'neutral',
      entryModel,
      expectedEdge: String(expectedEdge),
      confidenceRaw: String(confidenceRaw),
      riskFlags,
      createdAt: new Date(),
    },
  });

  return { side: costModel ? sideByThreshold : 'neutral' };
}
