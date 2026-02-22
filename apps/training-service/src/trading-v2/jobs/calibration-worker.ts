import { and, desc, eq, getDatabase, schema } from '@alice/database';
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

export async function runCalibrationWorker(payload: { tenantId: string; instrumentId: string; marketType: 'spot' | 'futures' | 'margin'; strategyKey: string; strategyVersion: number; points: CalibrationPoint[] }) {
  const plattModel = calibratePlatt(payload.points);
  const isotonicModel = calibrateIsotonic(payload.points);
  const plattBrier = brierScore(payload.points, (raw) => applyPlatt(raw, plattModel));
  const isotonicBrier = brierScore(payload.points, (raw) => applyIsotonic(raw, isotonicModel));
  const method = isotonicBrier < plattBrier ? 'isotonic' : 'platt';
  const predict = method === 'isotonic'
    ? (raw: number) => applyIsotonic(raw, isotonicModel)
    : (raw: number) => applyPlatt(raw, plattModel);
  const preview = payload.points.slice(0, 10).map((point) => ({ raw: point.raw, calibrated: predict(point.raw) }));
  const db = getDatabase();
  await db.insert(schema.tradingSignalCalibration).values({
    tenantId: payload.tenantId,
    instrumentId: payload.instrumentId,
    marketType: payload.marketType,
    strategyKey: payload.strategyKey,
    strategyVersion: payload.strategyVersion,
    method,
    payload: method === 'isotonic' ? { isotonic: isotonicModel } : { platt: plattModel },
    evalMetrics: {
      preview,
      brier: method === 'isotonic' ? isotonicBrier : plattBrier,
      ece: eceScore(payload.points, predict),
      plattBrier,
      isotonicBrier,
    },
  }).onConflictDoNothing();

  const recentCandidates = await db.query.tradingUniverseCandidates.findMany({
    where: and(
      eq(schema.tradingUniverseCandidates.tenantId, payload.tenantId),
      eq(schema.tradingUniverseCandidates.instrumentId, payload.instrumentId),
      eq(schema.tradingUniverseCandidates.marketType, payload.marketType),
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
