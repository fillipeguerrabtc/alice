import { frontendLogger } from '@/lib/logger';
import { ApiError } from '@/lib/queryClient';

export type TradingTelemetryEvent =
  | 'trading.workspace.usage'
  | 'trading.autorun.started'
  | 'trading.autorun.completed'
  | 'trading.autorun.terminal'
  | 'trading.signal.generation.succeeded'
  | 'trading.signal.generation.no_trade'
  | 'trading.signal.generation.blocked'
  | 'trading.signal.generation.failed';

type TradingTelemetryLevel = 'info' | 'warn' | 'error';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function emitTradingTelemetry(
  event: TradingTelemetryEvent,
  payload: Record<string, unknown>,
  level: TradingTelemetryLevel = 'info',
): void {
  const context = {
    domain: 'trading',
    event,
    ...payload,
  };

  if (level === 'warn') {
    frontendLogger.warn('Trading telemetry event', context);
    return;
  }

  if (level === 'error') {
    frontendLogger.error('Trading telemetry event', context);
    return;
  }

  frontendLogger.info('Trading telemetry event', context);
}

export function classifySignalGenerationResult(responsePayload: unknown): 'succeeded' | 'no_trade' {
  const responseRecord = asRecord(responsePayload);
  const dataRecord = asRecord(responseRecord?.data);
  const signalType = typeof dataRecord?.signalType === 'string' ? dataRecord.signalType : null;
  const metadataRecord = asRecord(dataRecord?.metadata);
  const noTradeReasonCode = typeof metadataRecord?.noTradeReasonCode === 'string'
    ? metadataRecord.noTradeReasonCode
    : null;

  if (signalType === 'hold' || signalType === 'neutral' || Boolean(noTradeReasonCode)) {
    return 'no_trade';
  }

  return 'succeeded';
}

export function classifySignalGenerationFailure(error: unknown): 'blocked' | 'failed' {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const normalizedMessage = errorMessage.toUpperCase();
  const blockedByScope = normalizedMessage.includes('TRADING_SCOPE_REQUIRED');

  if (blockedByScope) {
    return 'blocked';
  }

  if (error instanceof ApiError) {
    if ([400, 403, 409, 412, 422].includes(error.status)) {
      return 'blocked';
    }
  }

  return 'failed';
}
