import { getDatabase, schema } from '@alice/database';
import { applyPlatt, calibratePlatt, type CalibrationPoint } from '../validation/calibration.js';

export async function runCalibrationWorker(payload: { tenantId: string; instrumentId: string; marketType: 'spot' | 'futures' | 'margin'; strategyKey: string; strategyVersion: number; points: CalibrationPoint[] }) {
  const model = calibratePlatt(payload.points);
  const preview = payload.points.slice(0, 10).map((point) => ({ raw: point.raw, calibrated: applyPlatt(point.raw, model) }));
  const db = getDatabase();
  await db.insert(schema.tradingSignalCalibration).values({
    tenantId: payload.tenantId,
    instrumentId: payload.instrumentId,
    marketType: payload.marketType,
    strategyKey: payload.strategyKey,
    strategyVersion: payload.strategyVersion,
    method: 'platt',
    payload: model,
    evalMetrics: { preview },
  }).onConflictDoNothing();
}
