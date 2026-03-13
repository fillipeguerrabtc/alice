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

export type SignalGenerationResultClass = 'signal_generated' | 'no_trade';

export type SignalGenerationClassification = {
  reasonCode: string | null;
  reasonHuman: string | null;
  resultClass: SignalGenerationResultClass;
};

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

export function classifySignalGenerationResult(responsePayload: unknown): SignalGenerationClassification {
  const responseRecord = asRecord(responsePayload);
  const signalGeneration = asRecord(responseRecord?.signalGeneration);
  const stateCategory = typeof signalGeneration?.stateCategory === 'string'
    ? signalGeneration.stateCategory
    : null;
  const reasonCodeFromClassification = typeof signalGeneration?.reasonCode === 'string'
    ? signalGeneration.reasonCode
    : null;
  const reasonHumanFromClassification = typeof signalGeneration?.reasonHuman === 'string'
    ? signalGeneration.reasonHuman
    : null;

  if (stateCategory === 'no_trade') {
    return {
      resultClass: 'no_trade',
      reasonCode: reasonCodeFromClassification,
      reasonHuman: reasonHumanFromClassification,
    };
  }
  if (stateCategory === 'signal_generated') {
    return {
      resultClass: 'signal_generated',
      reasonCode: reasonCodeFromClassification,
      reasonHuman: reasonHumanFromClassification,
    };
  }

  const dataRecord = asRecord(responseRecord?.data);
  const signalType = typeof dataRecord?.signalType === 'string' ? dataRecord.signalType : null;
  const metadataRecord = asRecord(dataRecord?.metadata);
  const noTradeReasonCode = typeof metadataRecord?.noTradeReasonCode === 'string'
    ? metadataRecord.noTradeReasonCode
    : null;

  if (signalType === 'hold' || signalType === 'neutral' || Boolean(noTradeReasonCode)) {
    return {
      resultClass: 'no_trade',
      reasonCode: noTradeReasonCode,
      reasonHuman: null,
    };
  }

  return {
    resultClass: 'signal_generated',
    reasonCode: null,
    reasonHuman: null,
  };
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
