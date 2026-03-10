import type { Dispatch, SetStateAction } from 'react';
import { useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import {
  enqueueTradingJob,
  startPortfolioAutoRun,
  type TradingCandidate,
} from '@/services/api/trading';

type RefetchFn = () => unknown;

type UseTradingPipelineActionsOptions = {
  refetchTradingCandidates: RefetchFn;
  refetchTradingPortfolios: RefetchFn;
  refetchTradingRebalances: RefetchFn;
  selectedMarketType: 'futures' | 'spot' | 'margin';
  selectedPortfolioAutoId: string;
  setActiveAutoRunId: Dispatch<SetStateAction<string | null>>;
  setTradingJobStatus: Dispatch<SetStateAction<string>>;
  t: TFunction;
  topTradingCandidates: TradingCandidate[];
  userId?: string;
  userTenantId?: string;
};

export function useTradingPipelineActions(options: UseTradingPipelineActionsOptions) {
  const {
    refetchTradingCandidates,
    refetchTradingPortfolios,
    refetchTradingRebalances,
    selectedMarketType,
    selectedPortfolioAutoId,
    setActiveAutoRunId,
    setTradingJobStatus,
    t,
    topTradingCandidates,
    userId,
    userTenantId,
  } = options;

  const enqueueTradingMutation = useMutation({
    mutationFn: async (params: {
      job: 'universe-scan' | 'backtest' | 'calibration' | 'portfolio-rebalance' | 'model-risk';
      payload: Record<string, unknown>;
    }) => enqueueTradingJob(params.job, params.payload),
    onSuccess: (result, variables) => {
      setTradingJobStatus(`${variables.job} enfileirado (${result.idempotencyKey})`);
      refetchTradingCandidates();
      refetchTradingRebalances();
      refetchTradingPortfolios();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : t('common.error');
      setTradingJobStatus(`Falha ao enfileirar job: ${message}`);
    },
  });

  const enqueueTrading = useCallback((job: 'universe-scan' | 'backtest' | 'calibration' | 'portfolio-rebalance' | 'model-risk') => {
    if (!userId) return;
    const resolvedTenantId = typeof userTenantId === 'string' ? userTenantId : '';
    if (!resolvedTenantId) return;
    const firstCandidate = topTradingCandidates[0];
    const basePayload = {
      tenantId: resolvedTenantId,
      requestedBy: userId,
      idempotencyKey: crypto.randomUUID(),
    };

    if (job === 'universe-scan') {
      if (!firstCandidate) return;
      enqueueTradingMutation.mutate({
        job,
        payload: {
          ...basePayload,
          instrumentId: firstCandidate.instrumentId,
          marketType: selectedMarketType,
          timeframe: firstCandidate.timeframe ?? '5m',
          strategyKey: firstCandidate.strategyKey,
          strategyVersion: firstCandidate.strategyVersion,
          candleTimestamp: new Date().toISOString(),
        },
      });
      return;
    }
    if (job === 'backtest') {
      if (!firstCandidate) return;
      enqueueTradingMutation.mutate({
        job,
        payload: {
          ...basePayload,
          namespaceId: firstCandidate.namespaceId,
          instrumentId: firstCandidate.instrumentId,
          marketType: selectedMarketType,
          strategyKey: firstCandidate.strategyKey,
          strategyVersion: firstCandidate.strategyVersion,
          timeframe: firstCandidate.timeframe ?? '5m',
          lookback: 500,
          asofTimestamp: new Date().toISOString(),
        },
      });
      return;
    }
    if (job === 'calibration') {
      if (!firstCandidate) return;
      enqueueTradingMutation.mutate({
        job,
        payload: {
          ...basePayload,
          namespaceId: firstCandidate.namespaceId,
          instrumentId: firstCandidate.instrumentId,
          marketType: selectedMarketType,
          strategyKey: firstCandidate.strategyKey,
          strategyVersion: firstCandidate.strategyVersion,
          timeframe: firstCandidate.timeframe ?? '5m',
          lookback: 500,
          asofTimestamp: new Date().toISOString(),
        },
      });
      return;
    }
    if (job === 'portfolio-rebalance') {
      if (!selectedPortfolioAutoId) return;
      enqueueTradingMutation.mutate({
        job,
        payload: {
          ...basePayload,
          portfolioId: selectedPortfolioAutoId,
          asofTimestamp: new Date().toISOString(),
          policyVersion: 1,
        },
      });
      return;
    }
    enqueueTradingMutation.mutate({
      job,
      payload: {
        ...basePayload,
        scope: 'portfolio',
        scopeKey: selectedPortfolioAutoId || 'global',
        criticalEvents: 0,
        drawdown: 0,
        maxDrawdown: 0.2,
      },
    });
  }, [
    enqueueTradingMutation,
    selectedMarketType,
    selectedPortfolioAutoId,
    topTradingCandidates,
    userId,
    userTenantId,
  ]);

  const runPortfolioAutoPipeline = useCallback(() => {
    if (!selectedPortfolioAutoId) {
      setTradingJobStatus('Selecione um portfólio antes de rodar o pipeline.');
      return;
    }
    setTradingJobStatus('Iniciando pipeline institucional...');
    startPortfolioAutoRun({
      portfolioId: selectedPortfolioAutoId,
      marketType: selectedMarketType !== 'futures' ? selectedMarketType : undefined,
    }).then((result) => {
      setActiveAutoRunId(result.runId);
      setTradingJobStatus(`Pipeline enfileirado (run: ${result.runId.slice(0, 8)}…). Acompanhe o status abaixo.`);
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      setTradingJobStatus(`Falha ao iniciar pipeline: ${message}`);
    });
  }, [selectedPortfolioAutoId, selectedMarketType, setActiveAutoRunId, setTradingJobStatus]);

  return {
    enqueueTrading,
    enqueueTradingMutation,
    runPortfolioAutoPipeline,
  };
}
