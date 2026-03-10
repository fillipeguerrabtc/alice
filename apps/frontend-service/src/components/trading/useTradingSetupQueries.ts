import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import {
  getTradingCandidates,
  getTradingPortfolios,
  getTradingRebalances,
  getTradingAutoRuns,
  getTradingAutoRunDetail,
} from '@/services/api/trading';
import type { TradingAutoRun, TradingAutoRunDetail } from '@/services/api/trading';
import type { TradingProfileForm, TradingStatus } from './TradingDomainTypes';

type UseTradingSetupQueriesOptions = {
  activeAutoRunId: string | null;
  csrfReady: boolean;
  selectedMarketType: 'futures' | 'spot' | 'margin';
  selectedPortfolioAutoId: string;
  selectedSymbol: string;
  signalProfileForm: TradingProfileForm;
  statusRefetchInterval: number;
  userId?: string;
};

export function useTradingSetupQueries({
  activeAutoRunId,
  csrfReady,
  selectedMarketType,
  selectedPortfolioAutoId,
  selectedSymbol,
  signalProfileForm,
  statusRefetchInterval,
  userId,
}: UseTradingSetupQueriesOptions) {
  const {
    data: statusData,
    isLoading: isLoadingStatus,
    error: statusError,
    refetch: refetchStatus,
  } = useQuery<{ success: boolean; data: TradingStatus }>({
    queryKey: ['/api/integrations/trading/status'],
    refetchInterval: statusRefetchInterval,
    enabled: Boolean(userId) && csrfReady,
  });

  const statusIsConfigured = Boolean(statusData?.data?.isConfigured);
  const statusRequiresTenant = Boolean(statusData?.data?.requiresTenant);

  const {
    data: tradingPortfolios = [],
    refetch: refetchTradingPortfolios,
  } = useQuery({
    queryKey: ['/api/trading/portfolios'],
    queryFn: getTradingPortfolios,
    enabled: Boolean(userId) && csrfReady,
  });

  const {
    data: tradingCandidates = [],
    refetch: refetchTradingCandidates,
  } = useQuery({
    queryKey: ['/api/trading/candidates', selectedMarketType],
    queryFn: async () => getTradingCandidates({ marketType: selectedMarketType, limit: 30 }),
    enabled: Boolean(userId) && csrfReady,
  });

  const {
    data: tradingRebalancesPayload = { rebalances: [], executionReports: [] },
    refetch: refetchTradingRebalances,
  } = useQuery({
    queryKey: ['/api/trading/rebalances', selectedPortfolioAutoId],
    queryFn: async () => getTradingRebalances({ portfolioId: selectedPortfolioAutoId || undefined, limit: 20 }),
    enabled: Boolean(userId) && csrfReady,
  });

  const {
    data: activeAutoRunDetail,
  } = useQuery<TradingAutoRunDetail>({
    queryKey: ['/api/trading/auto/runs', activeAutoRunId],
    queryFn: async () => getTradingAutoRunDetail(activeAutoRunId!),
    enabled: Boolean(activeAutoRunId) && Boolean(userId) && csrfReady,
    refetchInterval: (query) => {
      const status = query.state.data?.run?.status;
      if (status === 'succeeded' || status === 'failed' || status === 'cancelled') return false;
      return 3000;
    },
  });

  const {
    data: signalAutoRuns = [],
    refetch: refetchSignalAutoRuns,
  } = useQuery<TradingAutoRun[]>({
    queryKey: ['/api/trading/auto/runs', 'signal_auto'],
    queryFn: async () => getTradingAutoRuns({ type: 'signal_auto', limit: 30 }),
    enabled: Boolean(userId) && csrfReady,
    refetchInterval: 5000,
  });

  const {
    data: intervalsData,
    error: intervalsError,
  } = useQuery<{
    success: boolean;
    data: {
      intervals: string[];
      granularityMap: Record<string, number>;
      wsIntervalMap: Record<string, string>;
      defaultInterval: string;
      restOrderBookDepth: number;
      restOrderBookDepths: number[];
      wsOrderBookDepth: number;
      wsOrderBookDepths: number[];
    };
  }>({
    queryKey: ['/api/integrations/trading/intervals'],
    enabled: Boolean(userId) && statusIsConfigured && !statusRequiresTenant,
  });

  const {
    data: signalProfileResponse,
    refetch: refetchSignalProfile,
  } = useQuery<{ success: boolean; data: TradingProfileForm }>({
    queryKey: ['/api/integrations/trading/analysis-profile', selectedMarketType, 'signal'],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('kind', 'signal');
      const response = await apiRequest('GET', `/api/integrations/trading/analysis-profile?${params.toString()}`);
      return response.json();
    },
    enabled: Boolean(selectedSymbol),
  });

  const {
    data: signalArbitrageCatalogResponse,
    isLoading: isSignalArbitrageCatalogLoading,
  } = useQuery<{
    success: boolean;
    data: {
      exchanges: Array<{ id: string; label: string }>;
      intermediateAssets: string[];
      feePctByExchange: Record<string, number>;
      effectiveFeePct: number;
      networkFeesByAsset: Record<string, number>;
      updatedAt: string;
    };
  }>({
    queryKey: [
      '/api/integrations/trading/arbitrage/catalog',
      selectedMarketType,
      selectedSymbol,
      signalProfileForm.arbitrageConfig?.exchanges,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedMarketType) params.set('marketType', selectedMarketType);
      if (selectedSymbol) params.set('symbol', selectedSymbol);
      const exchanges = signalProfileForm.arbitrageConfig?.exchanges ?? [];
      if (exchanges.length > 0) {
        params.set('exchanges', exchanges.join(','));
      }
      const response = await apiRequest('GET', `/api/integrations/trading/arbitrage/catalog?${params.toString()}`);
      return response.json();
    },
    enabled: Boolean(signalProfileForm.arbitrageConfig && signalProfileForm.techniques.includes('arbitrage_triangular')),
  });

  return {
    activeAutoRunDetail,
    intervalsData,
    intervalsError,
    isLoadingStatus,
    isSignalArbitrageCatalogLoading,
    refetchSignalAutoRuns,
    refetchSignalProfile,
    refetchStatus,
    refetchTradingCandidates,
    refetchTradingPortfolios,
    refetchTradingRebalances,
    signalArbitrageCatalogResponse,
    signalAutoRuns,
    signalProfileResponse,
    statusData,
    statusError,
    statusIsConfigured,
    statusRequiresTenant,
    tradingCandidates,
    tradingPortfolios,
    tradingRebalancesPayload,
  };
}
