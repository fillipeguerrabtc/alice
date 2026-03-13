import { z } from 'zod';

const demoBalanceSchema = z.object({
  id: z.string(),
  currency: z.string(),
  available: z.string(),
  frozen: z.string(),
}).passthrough();

const demoOrderSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  marketType: z.string(),
  side: z.string(),
  orderType: z.string(),
  size: z.string(),
  price: z.string(),
  fillPrice: z.string().nullable(),
  fee: z.string(),
  leverage: z.number(),
  status: z.string(),
  createdAt: z.string(),
  filledAt: z.string().nullable(),
}).passthrough();

const demoPositionSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  marketType: z.string(),
  side: z.string(),
  entryPrice: z.string(),
  exitPrice: z.string().nullable(),
  size: z.string(),
  leverage: z.number(),
  stopLoss: z.string().nullable(),
  takeProfit: z.string().nullable(),
  realizedPnl: z.string().nullable(),
  totalFees: z.string().nullable(),
  marginAmount: z.string().nullable().optional(),
  liquidationPrice: z.string().nullable().optional(),
  status: z.string(),
  metadata: z.record(z.unknown()).optional(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
}).passthrough();

const postMortemSchema = z.object({
  id: z.string(),
  positionId: z.string(),
  isDemo: z.boolean(),
  fingerprint: z.string(),
  status: z.string(),
  classification: z.object({
    tradeStyle: z.string(),
    archetype: z.string(),
    strategy: z.string(),
    pnlPct: z.number(),
    durationSec: z.number(),
  }).nullable(),
  motivators: z.array(z.object({
    title: z.string(),
    explanation: z.string(),
    citedValues: z.record(z.union([z.number(), z.string()])),
  })),
  successFactors: z.array(z.string()),
  failureFactors: z.array(z.string()),
  lessons: z.object({
    repeat: z.array(z.string()),
    avoid: z.array(z.string()),
  }).nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
}).passthrough();

const fundHistorySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  amount: z.string(),
  currency: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string(),
}).passthrough();

const queueStatsSchema = z.object({
  pending: z.number(),
  dlq: z.number(),
});

const sourceDatasetSchema = z.object({
  sourceType: z.string().optional(),
  sourceId: z.string().optional(),
}).passthrough();

const demoSignalHandoffSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  marketType: z.enum(['futures', 'spot', 'margin']),
  signalType: z.enum(['entry_long', 'entry_short', 'exit', 'adjust_sl', 'adjust_tp', 'hold', 'neutral']),
  suggestedPrice: z.union([z.coerce.number(), z.null()]).optional(),
  suggestedStopLoss: z.union([z.coerce.number(), z.null()]).optional(),
  suggestedTakeProfit: z.union([z.coerce.number(), z.null()]).optional(),
  suggestedSize: z.union([z.coerce.number(), z.null()]).optional(),
  confidence: z.coerce.number(),
  reasoning: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
}).passthrough();

const demoOrderFromSignalSchema = z.object({
  orderId: z.string(),
  status: z.string(),
  fillPrice: z.coerce.number().optional(),
  fillSize: z.coerce.number().optional(),
  fee: z.coerce.number().optional(),
  positionId: z.string().optional(),
  fromSignalId: z.string().optional(),
}).passthrough();

const responseWithData = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({
    success: z.boolean().optional(),
    data: schema,
  }).passthrough();

export const demoBalancesResponseSchema = responseWithData(z.array(demoBalanceSchema));
export const demoPositionsResponseSchema = responseWithData(z.array(demoPositionSchema));
export const demoOrdersResponseSchema = responseWithData(z.array(demoOrderSchema));
export const demoFundHistoryResponseSchema = responseWithData(z.array(fundHistorySchema));
export const demoPostMortemsResponseSchema = responseWithData(z.array(postMortemSchema));
export const demoSourceDatasetsResponseSchema = responseWithData(z.array(sourceDatasetSchema));
export const demoQueueStatsResponseSchema = responseWithData(queueStatsSchema);
export const demoHandoffSignalsResponseSchema = responseWithData(z.array(demoSignalHandoffSchema));
export const demoOrderFromSignalResponseSchema = responseWithData(demoOrderFromSignalSchema);
