import { z } from 'zod';

export const TRADING_V2_STREAMS = {
  universeScan: 'alice:trading:v2:universe-scan',
  backtest: 'alice:trading:v2:backtest',
  calibration: 'alice:trading:v2:calibration',
  portfolioRebalance: 'alice:trading:v2:portfolio-rebalance',
  modelRisk: 'alice:trading:v2:model-risk',
} as const;

export type TradingV2StreamName = (typeof TRADING_V2_STREAMS)[keyof typeof TRADING_V2_STREAMS];

const tradingV2JobBaseSchema = z.object({
  idempotencyKey: z.string().min(8),
  tenantId: z.string().uuid(),
  requestedBy: z.string().uuid(),
});

export const tradingUniverseEnqueueSchema = tradingV2JobBaseSchema.extend({
  instrumentId: z.string().uuid(),
  marketType: z.enum(['spot', 'futures', 'margin']),
  timeframe: z.string().min(2).max(10),
  strategyKey: z.string().min(3).max(64),
  strategyVersion: z.number().int().positive(),
  candleTimestamp: z.string().datetime(),
});

export const tradingBacktestEnqueueSchema = tradingV2JobBaseSchema.extend({
  instrumentId: z.string().uuid().optional(),
  marketType: z.enum(['spot', 'futures', 'margin']),
  strategyKey: z.string().min(3).max(64),
  strategyVersion: z.number().int().positive(),
  returns: z.array(z.number()).min(3),
  costsBps: z.number().min(0).max(500),
});

export const tradingCalibrationEnqueueSchema = tradingV2JobBaseSchema.extend({
  instrumentId: z.string().uuid(),
  marketType: z.enum(['spot', 'futures', 'margin']),
  strategyKey: z.string().min(3).max(64),
  strategyVersion: z.number().int().positive(),
  points: z.array(z.object({ raw: z.number().min(0).max(1), outcome: z.union([z.literal(0), z.literal(1)]) })).min(5),
});

export const tradingRebalanceEnqueueSchema = tradingV2JobBaseSchema.extend({
  portfolioId: z.string().uuid(),
  asofTimestamp: z.string().datetime(),
  inputs: z.record(z.unknown()),
  decisions: z.record(z.unknown()),
});

export const tradingModelRiskEnqueueSchema = tradingV2JobBaseSchema.extend({
  scope: z.enum(['strategy', 'portfolio', 'instrument']),
  scopeKey: z.string().min(2).max(128),
  criticalEvents: z.number().int().min(0),
  drawdown: z.number().min(0),
  maxDrawdown: z.number().min(0),
});

export function buildTradingV2IdempotencyKey(stream: TradingV2StreamName, payload: Record<string, unknown>): string {
  const tenantId = String(payload.tenantId ?? 'unknown');
  if (stream === TRADING_V2_STREAMS.universeScan) {
    return [
      tenantId,
      String(payload.instrumentId ?? 'unknown'),
      String(payload.timeframe ?? 'unknown'),
      String(payload.candleTimestamp ?? 'unknown'),
      String(payload.strategyVersion ?? 'unknown'),
    ].join(':');
  }
  if (stream === TRADING_V2_STREAMS.backtest) {
    return [
      tenantId,
      String(payload.instrumentId ?? 'portfolio'),
      String(payload.timeframe ?? 'backtest'),
      String(payload.strategyVersion ?? 'unknown'),
    ].join(':');
  }
  if (stream === TRADING_V2_STREAMS.calibration) {
    return [
      tenantId,
      String(payload.instrumentId ?? 'unknown'),
      String(payload.strategyVersion ?? 'unknown'),
      'calibration',
    ].join(':');
  }
  if (stream === TRADING_V2_STREAMS.portfolioRebalance) {
    return [
      tenantId,
      String(payload.portfolioId ?? 'unknown'),
      String(payload.asofTimestamp ?? 'unknown'),
      'rebalance',
    ].join(':');
  }
  return [
    tenantId,
    String(payload.scope ?? 'unknown'),
    String(payload.scopeKey ?? 'unknown'),
    'model-risk',
  ].join(':');
}
