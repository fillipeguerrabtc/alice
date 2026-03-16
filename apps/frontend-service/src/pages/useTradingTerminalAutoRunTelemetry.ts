import { useEffect, type MutableRefObject } from 'react';
import {
  classifySignalGenerationFailure,
  emitTradingTelemetry,
} from '@/lib/tradingTelemetry';

type TradingAutoRunDetail = {
  run?: {
    error?: string | null;
    id: string;
    payload?: unknown;
    runType: string;
    status: string;
    terminalReasonCode?: string | null;
  } | null;
  decisions?: Array<{
    approved?: boolean;
    entryPayload?: unknown;
  }> | null;
} | null;

type UseTradingTerminalAutoRunTelemetryOptions = {
  activeAutoRunDetail: TradingAutoRunDetail | undefined;
  emittedTerminalAutoRunsRef: MutableRefObject<Set<string>>;
};

export function useTradingTerminalAutoRunTelemetry({
  activeAutoRunDetail,
  emittedTerminalAutoRunsRef,
}: UseTradingTerminalAutoRunTelemetryOptions) {
  useEffect(() => {
    if (!activeAutoRunDetail?.run) {
      return;
    }

    const run = activeAutoRunDetail.run;
    const isTerminal = run.status === 'succeeded'
      || run.status === 'no_trade'
      || run.status === 'blocked'
      || run.status === 'failed'
      || run.status === 'cancelled';
    if (!isTerminal) {
      return;
    }

    const eventKey = `${run.id}:${run.status}`;
    if (emittedTerminalAutoRunsRef.current.has(eventKey)) {
      return;
    }

    const payloadRecord = run.payload && typeof run.payload === 'object' && !Array.isArray(run.payload)
      ? run.payload as Record<string, unknown>
      : {};
    const decision = Array.isArray(activeAutoRunDetail.decisions) ? activeAutoRunDetail.decisions[0] : undefined;
    const entryPayload = decision?.entryPayload && typeof decision.entryPayload === 'object' && !Array.isArray(decision.entryPayload)
      ? decision.entryPayload as Record<string, unknown>
      : null;
    const noTradeReasonCode = entryPayload && typeof entryPayload.noTradeReasonCode === 'string'
      ? entryPayload.noTradeReasonCode
      : null;
    const terminalReasonCode = typeof run.terminalReasonCode === 'string' && run.terminalReasonCode.length > 0
      ? run.terminalReasonCode
      : noTradeReasonCode;
    const payloadMarketType = typeof payloadRecord.marketType === 'string' ? payloadRecord.marketType : null;
    const payloadUniverseScope = typeof payloadRecord.universeScope === 'string' ? payloadRecord.universeScope : null;
    const payloadSymbol = typeof payloadRecord.symbol === 'string' ? payloadRecord.symbol : null;

    const outcome = run.status === 'succeeded'
      ? (run.runType === 'signal_auto' && (decision?.approved === false || Boolean(noTradeReasonCode)) ? 'no_trade' : 'succeeded')
      : run.status;

    emitTradingTelemetry(
      run.status === 'succeeded' ? 'trading.autorun.completed' : 'trading.autorun.terminal',
      {
        runType: run.runType,
        runId: run.id,
        outcome,
        status: run.status,
        terminalReasonCode,
        marketType: payloadMarketType,
        universeScope: payloadUniverseScope,
        symbol: payloadSymbol,
        noTradeReasonCode,
        error: run.error,
      },
      run.status === 'failed' ? 'error' : (run.status === 'cancelled' || run.status === 'blocked') ? 'warn' : 'info',
    );

    if (run.runType === 'signal_auto') {
      if (run.status === 'succeeded') {
        emitTradingTelemetry(
          outcome === 'no_trade'
            ? 'trading.signal.generation.no_trade'
            : 'trading.signal.generation.succeeded',
          {
            source: 'auto_run',
            runId: run.id,
            marketType: payloadMarketType,
            symbol: payloadSymbol,
            noTradeReasonCode,
          },
        );
      } else if (run.status === 'no_trade') {
        emitTradingTelemetry(
          'trading.signal.generation.no_trade',
          {
            source: 'auto_run',
            runId: run.id,
            marketType: payloadMarketType,
            symbol: payloadSymbol,
            noTradeReasonCode: terminalReasonCode,
          },
        );
      } else if (run.status === 'blocked') {
        emitTradingTelemetry(
          'trading.signal.generation.blocked',
          {
            source: 'auto_run',
            runId: run.id,
            marketType: payloadMarketType,
            symbol: payloadSymbol,
            reasonCode: terminalReasonCode,
            error: run.error,
          },
          'warn',
        );
      } else if (run.status === 'failed') {
        const failureClass = classifySignalGenerationFailure(new Error(run.error ?? 'Signal auto run falhou'));
        emitTradingTelemetry(
          failureClass === 'blocked'
            ? 'trading.signal.generation.blocked'
            : 'trading.signal.generation.failed',
          {
            source: 'auto_run',
            runId: run.id,
            marketType: payloadMarketType,
            symbol: payloadSymbol,
            error: run.error,
          },
          failureClass === 'blocked' ? 'warn' : 'error',
        );
      }
    }

    emittedTerminalAutoRunsRef.current.add(eventKey);
  }, [activeAutoRunDetail, emittedTerminalAutoRunsRef]);
}
