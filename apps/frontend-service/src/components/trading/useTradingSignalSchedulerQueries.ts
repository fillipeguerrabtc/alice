import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { Dispatch, SetStateAction } from 'react';
import type { TradingSignal } from './TradingDomainTypes';

export type TradingSignalSchedulerConfig = {
  enabled: boolean;
  intervalMinutes: number;
  interval: string;
  symbols: string[];
  maxSignalsPerRun: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastDurationMs: number | null;
} | null;

type UseTradingSignalSchedulerQueriesOptions = {
  defaultInterval: string;
  selectedMarketType: 'futures' | 'spot' | 'margin';
  selectedSignalId: string | null;
  setSelectedSignalId: Dispatch<SetStateAction<string | null>>;
  signalRefetchInterval: number;
  statusIsConfigured: boolean;
  statusRequiresTenant: boolean;
};

export function useTradingSignalSchedulerQueries({
  defaultInterval,
  selectedMarketType,
  selectedSignalId,
  setSelectedSignalId,
  signalRefetchInterval,
  statusIsConfigured,
  statusRequiresTenant,
}: UseTradingSignalSchedulerQueriesOptions) {
  const {
    data: signalsData,
    isLoading: isLoadingSignals,
    error: signalsError,
    refetch: refetchSignals,
  } = useQuery<{ success: boolean; data: TradingSignal[] }>({
    queryKey: ['/api/integrations/trading/signals', selectedMarketType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedMarketType) {
        params.set('marketType', selectedMarketType);
      }
      const response = await apiRequest('GET', `/api/integrations/trading/signals${params.toString() ? `?${params}` : ''}`);
      return response.json();
    },
    refetchInterval: signalRefetchInterval,
    enabled: statusIsConfigured && !statusRequiresTenant,
  });

  const signals = signalsData?.data || [];

  useEffect(() => {
    if (signals.length === 0) {
      setSelectedSignalId(null);
      return;
    }
    if (selectedSignalId && signals.some((signal) => signal.id === selectedSignalId)) {
      return;
    }
    setSelectedSignalId(signals[0]?.id ?? null);
  }, [selectedSignalId, setSelectedSignalId, signals]);

  const selectedSignal = useMemo(
    () => (selectedSignalId ? signals.find((signal) => signal.id === selectedSignalId) ?? null : null),
    [signals, selectedSignalId]
  );

  const {
    data: schedulerData,
    isLoading: isLoadingScheduler,
    error: schedulerError,
    refetch: refetchScheduler,
  } = useQuery<{ success: boolean; data: Array<Record<string, unknown>> }>({
    queryKey: ['/api/integrations/trading/signal-scheduler', selectedMarketType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedMarketType) {
        params.set('marketType', selectedMarketType);
      }
      const response = await apiRequest('GET', `/api/integrations/trading/signal-scheduler${params.toString() ? `?${params}` : ''}`);
      return response.json();
    },
    enabled: statusIsConfigured && !statusRequiresTenant,
  });

  const schedulerConfig = useMemo<TradingSignalSchedulerConfig>(() => {
    const config = schedulerData?.data?.[0] as Record<string, unknown> | undefined;
    if (!config) return null;
    return {
      enabled: Boolean(config.enabled),
      intervalMinutes: Number(config.intervalMinutes ?? 15),
      interval: String(config.interval ?? defaultInterval),
      symbols: Array.isArray(config.symbols) ? (config.symbols as string[]) : [],
      maxSignalsPerRun: Number(config.maxSignalsPerRun ?? 1),
      nextRunAt: config.nextRunAt as string | null,
      lastRunAt: config.lastRunAt as string | null,
      lastSuccessAt: config.lastSuccessAt as string | null,
      lastError: config.lastError as string | null,
      lastDurationMs: config.lastDurationMs as number | null,
    };
  }, [defaultInterval, schedulerData]);

  return {
    isLoadingScheduler,
    isLoadingSignals,
    refetchScheduler,
    refetchSignals,
    schedulerConfig,
    schedulerError,
    selectedSignal,
    signals,
    signalsError,
  };
}
