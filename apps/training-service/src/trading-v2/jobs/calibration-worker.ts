import { and, desc, eq, getDatabase, lte, schema } from '@alice/database';
import { applyPlatt, calibratePlatt, type CalibrationPoint } from '../validation/calibration.js';

function calibrateIsotonic(points: CalibrationPoint[]): Array<{ threshold: number; value: number }> {
  const sorted = [...points].sort((a, b) => a.raw - b.raw);
  const buckets: Array<{ threshold: number; value: number; count: number }> = sorted
    .map((point) => ({ threshold: point.raw, value: point.outcome, count: 1 }));
  let i = 0;
  while (i < buckets.length - 1) {
    if (buckets[i].value > buckets[i + 1].value) {
      const totalCount = buckets[i].count + buckets[i + 1].count;
      const mergedValue = ((buckets[i].value * buckets[i].count) + (buckets[i + 1].value * buckets[i + 1].count)) / totalCount;
      buckets[i] = {
        threshold: buckets[i + 1].threshold,
        value: mergedValue,
        count: totalCount,
      };
      buckets.splice(i + 1, 1);
      i = Math.max(0, i - 1);
    } else {
      i += 1;
    }
  }
  return buckets.map((bucket) => ({ threshold: bucket.threshold, value: bucket.value }));
}

function applyIsotonic(raw: number, model: Array<{ threshold: number; value: number }>): number {
  for (const bucket of model) {
    if (raw <= bucket.threshold) return bucket.value;
  }
  return model.length > 0 ? model[model.length - 1].value : raw;
}

function brierScore(points: CalibrationPoint[], predict: (raw: number) => number): number {
  if (points.length === 0) return 0;
  return points.reduce((sum, point) => {
    const predicted = predict(point.raw);
    return sum + ((predicted - point.outcome) ** 2);
  }, 0) / points.length;
}

function eceScore(points: CalibrationPoint[], predict: (raw: number) => number): number {
  if (points.length === 0) return 0;
  const bins = Array.from({ length: 10 }, () => ({ pred: 0, outcome: 0, count: 0 }));
  for (const point of points) {
    const predicted = predict(point.raw);
    const index = Math.min(9, Math.max(0, Math.floor(predicted * 10)));
    bins[index].pred += predicted;
    bins[index].outcome += point.outcome;
    bins[index].count += 1;
  }
  return bins.reduce((sum, bin) => {
    if (bin.count === 0) return sum;
    const avgPred = bin.pred / bin.count;
    const avgOutcome = bin.outcome / bin.count;
    return sum + ((bin.count / points.length) * Math.abs(avgPred - avgOutcome));
  }, 0);
}

type CalibrationPayload = {
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

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export async function runCalibrationWorker(payload: CalibrationPayload) {
  const db = getDatabase();
  const backtestRuns = await db.query.tradingBacktestRuns.findMany({
    where: and(
      eq(schema.tradingBacktestRuns.tenantId, payload.tenantId),
      eq(schema.tradingBacktestRuns.instrumentId, payload.instrumentId),
      eq(schema.tradingBacktestRuns.marketType, payload.marketType),
      eq(schema.tradingBacktestRuns.operationIntent, payload.operationIntent ?? 'intraday'),
      eq(schema.tradingBacktestRuns.strategyKey, payload.strategyKey),
      eq(schema.tradingBacktestRuns.strategyVersion, payload.strategyVersion),
      lte(schema.tradingBacktestRuns.createdAt, new Date(payload.asofTimestamp)),
    ),
    orderBy: [desc(schema.tradingBacktestRuns.createdAt)],
    limit: payload.lookback,
  });

  const points: CalibrationPoint[] = backtestRuns
    .map((run) => {
      const dsrProbability = Number(((run.dsr ?? {}) as Record<string, unknown>).probability ?? 0);
      const aggregateOosSharpe = Number(((run.oosMetrics ?? {}) as Record<string, unknown>).aggregateOutOfSampleSharpe ?? 0);
      if (!Number.isFinite(dsrProbability) || !Number.isFinite(aggregateOosSharpe)) {
        return null;
      }
      return {
        raw: clamp01(dsrProbability),
        outcome: aggregateOosSharpe > 0 ? 1 : 0,
      } as CalibrationPoint;
    })
    .filter((point): point is CalibrationPoint => point !== null);

  if (points.length < 5) {
    return;
  }

  const plattModel = calibratePlatt(points);
  const isotonicModel = calibrateIsotonic(points);
  const plattBrier = brierScore(points, (raw) => applyPlatt(raw, plattModel));
  const isotonicBrier = brierScore(points, (raw) => applyIsotonic(raw, isotonicModel));
  const method = isotonicBrier < plattBrier ? 'isotonic' : 'platt';
  const predict = method === 'isotonic'
    ? (raw: number) => applyIsotonic(raw, isotonicModel)
    : (raw: number) => applyPlatt(raw, plattModel);
  const preview = points.slice(0, 10).map((point) => ({ raw: point.raw, calibrated: predict(point.raw) }));

  await db.insert(schema.tradingSignalCalibration).values({
    tenantId: payload.tenantId,
    instrumentId: payload.instrumentId,
    marketType: payload.marketType,
    operationIntent: payload.operationIntent ?? 'intraday',
    strategyKey: payload.strategyKey,
    strategyVersion: payload.strategyVersion,
    method,
    payload: method === 'isotonic' ? { isotonic: isotonicModel } : { platt: plattModel },
    evalMetrics: {
      preview,
      brier: method === 'isotonic' ? isotonicBrier : plattBrier,
      ece: eceScore(points, predict),
      plattBrier,
      isotonicBrier,
      bins: 10,
      timeframe: payload.timeframe,
    },
  }).onConflictDoNothing();

  const recentCandidates = await db.query.tradingUniverseCandidates.findMany({
    where: and(
      eq(schema.tradingUniverseCandidates.tenantId, payload.tenantId),
      eq(schema.tradingUniverseCandidates.instrumentId, payload.instrumentId),
      eq(schema.tradingUniverseCandidates.marketType, payload.marketType),
      eq(schema.tradingUniverseCandidates.operationIntent, payload.operationIntent ?? 'intraday'),
      eq(schema.tradingUniverseCandidates.strategyKey, payload.strategyKey),
      eq(schema.tradingUniverseCandidates.strategyVersion, payload.strategyVersion),
    ),
    orderBy: [desc(schema.tradingUniverseCandidates.createdAt)],
    limit: 25,
  });

  for (const candidate of recentCandidates) {
    const raw = Number(candidate.confidenceRaw ?? 0);
    const calibrated = predict(Math.min(1, Math.max(0, raw)));
    await db
      .update(schema.tradingUniverseCandidates)
      .set({ confidenceCalibrated: String(calibrated) })
      .where(eq(schema.tradingUniverseCandidates.id, candidate.id));
  }
}
