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
  operationIntent?: 'scalping' | 'intraday' | 'swing' | 'positional' | 'arbitrage_internal' | 'arbitrage_cross_exchange' | 'cash_and_carry' | 'market_neutral' | 'volatility_breakout';
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

type TradingOperationIntent = NonNullable<UniversePayload['operationIntent']>;
const CONNECTED_EXCHANGES_CACHE_TTL_MS = 30_000;
const CASH_AND_CARRY_VOL_THRESHOLD = 0.008;
const VOLATILITY_BREAKOUT_THRESHOLD = 0.03;
const SCALPING_MIN_LIQUIDITY = 0.4;
const POSITIONAL_LOW_LIQUIDITY = 0.2;
const connectedExchangesCache = new Map<string, { count: number; expiresAt: number }>();

export function autoSelectOperationIntent(input: {
  requestedIntent: TradingOperationIntent;
  timeframe: z.infer<typeof tradingIntervalSchema>;
  marketType: UniversePayload['marketType'];
  expectedEdge: number;
  expectedVolatility: number;
  liquidityProxy: number;
  trend: string;
  volatilityRegime: string;
}): TradingOperationIntent {
  if (input.requestedIntent !== 'intraday') {
    return input.requestedIntent;
  }
  if (input.marketType === 'futures' && input.expectedEdge > 0 && input.expectedVolatility < CASH_AND_CARRY_VOL_THRESHOLD) {
    return 'cash_and_carry';
  }
  if (input.volatilityRegime === 'high' || input.expectedVolatility > VOLATILITY_BREAKOUT_THRESHOLD) {
    return 'volatility_breakout';
  }
  if ((input.timeframe === '1m' || input.timeframe === '3m' || input.timeframe === '5m') && input.liquidityProxy > SCALPING_MIN_LIQUIDITY) {
    return 'scalping';
  }
  if (input.timeframe === '1d' || input.timeframe === '1w') {
    return input.trend === 'up' || input.trend === 'down' ? 'swing' : 'positional';
  }
  if (input.liquidityProxy < POSITIONAL_LOW_LIQUIDITY) {
    return 'positional';
  }
  return 'intraday';
}

export function allowsCrossExchangeArbitrage(operationIntent: TradingOperationIntent, connectedExchangesCount: number): boolean {
  if (operationIntent !== 'arbitrage_cross_exchange') {
    return true;
  }
  return connectedExchangesCount >= 2;
}

async function getConnectedExchangesCountCached(tenantId: string): Promise<number> {
  const now = Date.now();
  const cached = connectedExchangesCache.get(tenantId);
  if (cached && cached.expiresAt > now) {
    return cached.count;
  }

  const db = getDatabase();
  const connectedExchanges = await db.query.tradingExchanges.findMany({
    where: and(
      eq(schema.tradingExchanges.tenantId, tenantId),
      eq(schema.tradingExchanges.apiConnected, true),
    ),
  });
  const count = connectedExchanges.length;
  connectedExchangesCache.set(tenantId, { count, expiresAt: now + CONNECTED_EXCHANGES_CACHE_TTL_MS });
  return count;
}

function resolveCandidateSide(input: {
  hasCostModel: boolean;
  baseSide: 'long' | 'short' | 'neutral';
  operationIntent: TradingOperationIntent;
  crossExchangeAllowed: boolean;
}): 'long' | 'short' | 'neutral' {
  if (!input.hasCostModel) return 'neutral';
  if (input.operationIntent === 'arbitrage_cross_exchange' && !input.crossExchangeAllowed) {
    return 'neutral';
  }
  return input.baseSide;
}

export async function runUniverseScanWorker(payload: UniversePayload): Promise<{ side: 'long' | 'short' | 'neutral'; operationIntent: TradingOperationIntent }> {
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
  const trend = latestIndicator?.maTrend ?? 'neutral';
  const volatilityRegime = latestIndicator?.atrVolatility ?? 'low';

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

  const strategyParams = (strategy.params ?? {}) as Record<string, unknown>;
  const longThreshold = Number(strategyParams.longThreshold ?? 0);
  const shortThreshold = Number(strategyParams.shortThreshold ?? 0);
  const sideByThreshold: 'long' | 'short' | 'neutral' = expectedEdge >= longThreshold
    ? 'long'
    : expectedEdge <= shortThreshold
      ? 'short'
      : 'neutral';

  const operationIntent = autoSelectOperationIntent({
    requestedIntent: payload.operationIntent ?? 'intraday',
    timeframe,
    marketType: payload.marketType,
    expectedEdge,
    expectedVolatility,
    liquidityProxy,
    trend,
    volatilityRegime,
  });

  const entryModel = {
    entry: currentPrice,
    stop: sideByThreshold === 'short' ? currentPrice + stopDistance : currentPrice - stopDistance,
    takeProfit: sideByThreshold === 'short' ? currentPrice - takeProfitDistance : currentPrice + takeProfitDistance,
    liquidityProxy,
  };

  const riskFlags: unknown[] = [];
  if (expectedEdge <= 0) {
    riskFlags.push('edge_liquido_negativo');
  }
  if (!costModel) {
    riskFlags.push('missing_cost_model');
  }
  const connectedExchangesCount = await getConnectedExchangesCountCached(payload.tenantId);
  const crossExchangeAllowed = allowsCrossExchangeArbitrage(operationIntent, connectedExchangesCount);
  if (operationIntent === 'arbitrage_cross_exchange' && !crossExchangeAllowed) {
    riskFlags.push('cross_exchange_not_available');
  }
  const finalSide = resolveCandidateSide({
    hasCostModel: Boolean(costModel),
    baseSide: sideByThreshold,
    operationIntent,
    crossExchangeAllowed,
  });

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
      trend,
      volatilityRegime,
      operationIntent,
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
    operationIntent,
    strategyKey: payload.strategyKey,
    strategyVersion: payload.strategyVersion,
    timeframe,
    candleTimestamp,
    side: finalSide,
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
      schema.tradingUniverseCandidates.operationIntent,
    ],
    set: {
      side: finalSide,
      operationIntent,
      entryModel,
      expectedEdge: String(expectedEdge),
      confidenceRaw: String(confidenceRaw),
      riskFlags,
      createdAt: new Date(),
    },
  });

  return { side: finalSide, operationIntent };
}
