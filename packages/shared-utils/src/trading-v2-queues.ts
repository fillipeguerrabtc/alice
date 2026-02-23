import { z } from 'zod';

const TRADING_V2_IDEMPOTENCY_MIN_LENGTH = 8;

export const TRADING_V2_STREAMS = {
  universeScan: 'alice:trading:v2:universe-scan',
  backtest: 'alice:trading:v2:backtest',
  calibration: 'alice:trading:v2:calibration',
  portfolioRebalance: 'alice:trading:v2:portfolio-rebalance',
  modelRisk: 'alice:trading:v2:model-risk',
  portfolioAutoRun: 'alice:trading:v2:portfolio-auto-run',
  signalAutoRun: 'alice:trading:v2:signal-auto-run',
} as const;

export type TradingV2StreamName = (typeof TRADING_V2_STREAMS)[keyof typeof TRADING_V2_STREAMS];

const tradingV2JobBaseSchema = z.object({
  idempotencyKey: z.string().min(TRADING_V2_IDEMPOTENCY_MIN_LENGTH),
  tenantId: z.string().uuid(),
  requestedBy: z.string().uuid(),
});

const operationIntentSchema = z.enum([
  'scalping',
  'intraday',
  'swing',
  'positional',
  'arbitrage_internal',
  'arbitrage_cross_exchange',
  'cash_and_carry',
  'market_neutral',
  'volatility_breakout',
]);

const allOperationIntents = operationIntentSchema.options;

export const tradingUniverseEnqueueSchema = tradingV2JobBaseSchema.extend({
  instrumentId: z.string().uuid(),
  marketType: z.enum(['spot', 'futures', 'margin']),
  timeframe: z.string().min(2).max(10),
  strategyKey: z.string().min(3).max(64),
  strategyVersion: z.number().int().positive(),
  operationIntent: operationIntentSchema.optional().default('intraday'),
  candleTimestamp: z.string().datetime(),
}).strict();

export const tradingBacktestEnqueueSchema = tradingV2JobBaseSchema.extend({
  namespaceId: z.string().uuid().optional(),
  instrumentId: z.string().uuid(),
  marketType: z.enum(['spot', 'futures', 'margin']),
  strategyKey: z.string().min(3).max(64),
  strategyVersion: z.number().int().positive(),
  operationIntent: operationIntentSchema.optional().default('intraday'),
  timeframe: z.string().min(2).max(10),
  lookback: z.number().int().min(30).max(10000),
  asofTimestamp: z.string().datetime(),
}).strict();

export const tradingCalibrationEnqueueSchema = tradingV2JobBaseSchema.extend({
  namespaceId: z.string().uuid().optional(),
  instrumentId: z.string().uuid(),
  marketType: z.enum(['spot', 'futures', 'margin']),
  strategyKey: z.string().min(3).max(64),
  strategyVersion: z.number().int().positive(),
  operationIntent: operationIntentSchema.optional().default('intraday'),
  timeframe: z.string().min(2).max(10),
  lookback: z.number().int().min(30).max(10000),
  asofTimestamp: z.string().datetime(),
}).strict();

export const tradingRebalanceEnqueueSchema = tradingV2JobBaseSchema.extend({
  portfolioId: z.string().uuid(),
  asofTimestamp: z.string().datetime(),
  policyVersion: z.number().int().positive(),
  allowedOperationIntents: z.array(operationIntentSchema).min(1).optional().default(allOperationIntents),
}).strict();

export const tradingModelRiskEnqueueSchema = tradingV2JobBaseSchema.extend({
  scope: z.enum(['strategy', 'portfolio', 'instrument']),
  scopeKey: z.string().min(2).max(128),
  criticalEvents: z.number().int().min(0),
  drawdown: z.number().min(0),
  maxDrawdown: z.number().min(0),
}).strict();

export function buildTradingV2IdempotencyKey(stream: TradingV2StreamName, payload: Record<string, unknown>): string {
  const tenantId = String(payload.tenantId ?? 'unknown');
  if (stream === TRADING_V2_STREAMS.universeScan) {
    return [
      tenantId,
      String(payload.instrumentId ?? 'unknown'),
      String(payload.timeframe ?? 'unknown'),
      String(payload.candleTimestamp ?? 'unknown'),
      String(payload.strategyVersion ?? 'unknown'),
      String(payload.operationIntent ?? 'unknown'),
    ].join(':');
  }
  if (stream === TRADING_V2_STREAMS.backtest) {
    return [
      tenantId,
      String(payload.namespaceId ?? 'no-namespace'),
      String(payload.instrumentId ?? 'unknown'),
      String(payload.marketType ?? 'unknown'),
      String(payload.timeframe ?? 'unknown'),
      String(payload.lookback ?? 'unknown'),
      String(payload.asofTimestamp ?? 'unknown'),
      String(payload.strategyKey ?? 'unknown'),
      String(payload.strategyVersion ?? 'unknown'),
      String(payload.operationIntent ?? 'unknown'),
    ].join(':');
  }
  if (stream === TRADING_V2_STREAMS.calibration) {
    return [
      tenantId,
      String(payload.namespaceId ?? 'no-namespace'),
      String(payload.instrumentId ?? 'unknown'),
      String(payload.marketType ?? 'unknown'),
      String(payload.timeframe ?? 'unknown'),
      String(payload.lookback ?? 'unknown'),
      String(payload.asofTimestamp ?? 'unknown'),
      String(payload.strategyKey ?? 'unknown'),
      String(payload.strategyVersion ?? 'unknown'),
      String(payload.operationIntent ?? 'unknown'),
    ].join(':');
  }
  if (stream === TRADING_V2_STREAMS.portfolioRebalance) {
    return [
      tenantId,
      String(payload.portfolioId ?? 'unknown'),
      String(payload.asofTimestamp ?? 'unknown'),
      String(payload.policyVersion ?? 'unknown'),
      String((payload.allowedOperationIntents as string[] | undefined)?.join(',') ?? 'unknown'),
    ].join(':');
  }
  if (stream === TRADING_V2_STREAMS.portfolioAutoRun) {
    return [
      tenantId,
      'portfolio-auto',
      String(payload.runId ?? 'unknown'),
      String(payload.correlationId ?? 'unknown'),
    ].join(':');
  }
  if (stream === TRADING_V2_STREAMS.signalAutoRun) {
    return [
      tenantId,
      'signal-auto',
      String(payload.runId ?? 'unknown'),
      String(payload.correlationId ?? 'unknown'),
    ].join(':');
  }
  return [
    tenantId,
    String(payload.scope ?? 'unknown'),
    String(payload.scopeKey ?? 'unknown'),
    'model-risk',
  ].join(':');
}
