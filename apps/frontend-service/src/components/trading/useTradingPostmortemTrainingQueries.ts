import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { NamespaceOption, TradingPostMortem } from './TradingDomainTypes';

type UseTradingPostmortemTrainingQueriesOptions = {
  activeTab: string;
  selectedMarketType: 'futures' | 'spot' | 'margin';
  showPostmortemTrainingDialog: boolean;
  statusIsConfigured: boolean;
  statusRequiresTenant: boolean;
};

export function useTradingPostmortemTrainingQueries({
  activeTab,
  selectedMarketType,
  showPostmortemTrainingDialog,
  statusIsConfigured,
  statusRequiresTenant,
}: UseTradingPostmortemTrainingQueriesOptions) {
  const shouldLoadPostmortems = statusIsConfigured
    && !statusRequiresTenant
    && (activeTab === 'postmortems' || showPostmortemTrainingDialog);

  const {
    data: postmortemsData,
    isLoading: isLoadingPostmortems,
    refetch: refetchPostmortems,
  } = useQuery<{ success: boolean; data: TradingPostMortem[] }>({
    queryKey: ['/api/integrations/postmortem', selectedMarketType, 'real'],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('isDemo', 'false');
      if (selectedMarketType) {
        params.set('marketType', selectedMarketType);
      }
      const response = await apiRequest('GET', `/api/integrations/postmortem?${params.toString()}`);
      return response.json();
    },
    enabled: shouldLoadPostmortems,
  });

  const postmortems = postmortemsData?.data ?? [];

  const { data: namespacesData } = useQuery<NamespaceOption[]>({
    queryKey: ['/api/namespaces'],
    staleTime: 60_000,
    enabled: showPostmortemTrainingDialog,
  });

  const availableNamespaces = useMemo(
    () => (namespacesData ?? []).filter((namespace) => namespace.ativo !== false),
    [namespacesData]
  );

  const { data: tradingDatasetsForSentCheck } = useQuery({
    queryKey: ['/api/integrations/trading/datasets', 'postmortem-ids'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/integrations/trading/datasets?limit=200');
      const json = await res.json() as { data: Array<{ sourceType?: string; sourceId?: string }> };
      return json.data ?? [];
    },
    staleTime: 30_000,
    enabled: shouldLoadPostmortems,
  });

  const postmortemIdsSentToTraining = useMemo(() => {
    const data = tradingDatasetsForSentCheck ?? [];
    return new Set(
      data
        .filter((entry) => (entry.sourceType === 'trading_postmortem' || entry.sourceType === 'postmortem') && entry.sourceId)
        .map((entry) => entry.sourceId as string)
    );
  }, [tradingDatasetsForSentCheck]);

  return {
    availableNamespaces,
    isLoadingPostmortems,
    postmortemIdsSentToTraining,
    postmortems,
    refetchPostmortems,
  };
}
