import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { ControlHistoryEntry } from './HandoverPanel';
import type {
  KucoinWsStatus,
  RiskConfig,
} from './TradingDomainTypes';

type UseTradingOperationalQueriesOptions = {
  statusIsConfigured: boolean;
  statusRefetchInterval: number;
  statusRequiresTenant: boolean;
};

export function useTradingOperationalQueries({
  statusIsConfigured,
  statusRefetchInterval,
  statusRequiresTenant,
}: UseTradingOperationalQueriesOptions) {
  const { data: wsStatusData } = useQuery<{ success: boolean; data: KucoinWsStatus }>({
    queryKey: ['/api/integrations/trading/ws/status'],
    refetchInterval: statusRefetchInterval,
    enabled: statusIsConfigured,
  });

  const {
    data: riskConfigData,
    error: riskConfigError,
    refetch: refetchRiskConfig,
  } = useQuery<{ success: boolean; data: RiskConfig | null }>({
    queryKey: ['/api/integrations/trading/risk-config'],
    enabled: statusIsConfigured && !statusRequiresTenant,
  });

  const {
    data: controlHistoryData,
    isLoading: isLoadingControlHistory,
    error: controlHistoryError,
    refetch: refetchControlHistory,
  } = useQuery<{ success: boolean; data: ControlHistoryEntry[] }>({
    queryKey: ['/api/integrations/trading/control-history'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/integrations/trading/control-history');
      return res.json();
    },
    enabled: statusIsConfigured,
  });

  return {
    controlHistoryData,
    controlHistoryError,
    isLoadingControlHistory,
    refetchControlHistory,
    refetchRiskConfig,
    riskConfigData,
    riskConfigError,
    wsStatusData,
  };
}
