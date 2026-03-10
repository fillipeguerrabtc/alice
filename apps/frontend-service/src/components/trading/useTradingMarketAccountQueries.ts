import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type {
  MarketData,
  PositionsResponse,
  TradingAccountOverview,
  TradingOrder,
} from './TradingDomainTypes';

type UseTradingMarketAccountQueriesOptions = {
  accountRefetchInterval: number;
  requestSymbol: string;
  selectedMarginMode: 'cross' | 'isolated';
  selectedMarketType: 'futures' | 'spot' | 'margin';
  statusIsConfigured: boolean;
  statusRequiresTenant: boolean;
  symbolReady: boolean;
  isSymbolValidForMarket: boolean;
};

export function useTradingMarketAccountQueries({
  accountRefetchInterval,
  requestSymbol,
  selectedMarginMode,
  selectedMarketType,
  statusIsConfigured,
  statusRequiresTenant,
  symbolReady,
  isSymbolValidForMarket,
}: UseTradingMarketAccountQueriesOptions) {
  const marketQueryString = useMemo(() => {
    const marketQuery = new URLSearchParams();
    marketQuery.set('marketType', selectedMarketType);
    if (selectedMarketType === 'margin') {
      marketQuery.set('marginMode', selectedMarginMode);
    }
    return marketQuery.toString();
  }, [selectedMarginMode, selectedMarketType]);

  const ordersQueryString = useMemo(() => {
    const ordersQuery = new URLSearchParams();
    ordersQuery.set('marketType', selectedMarketType);
    return ordersQuery.toString();
  }, [selectedMarketType]);

  const {
    data: marketData,
    isLoading: isLoadingMarket,
    error: marketError,
  } = useQuery<{ success: boolean; data: MarketData }>({
    queryKey: ['/api/integrations/trading/market', requestSymbol, selectedMarketType, selectedMarginMode],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/integrations/trading/market/${requestSymbol}?${marketQueryString}`);
      return res.json();
    },
    enabled: symbolReady && statusIsConfigured && !statusRequiresTenant && isSymbolValidForMarket,
    refetchInterval: accountRefetchInterval,
    refetchIntervalInBackground: false,
  });

  const {
    data: accountData,
    isLoading: isLoadingAccount,
    error: accountError,
    refetch: refetchAccount,
  } = useQuery<{ success: boolean; data: TradingAccountOverview }>({
    queryKey: ['/api/integrations/trading/account', selectedMarketType, selectedMarginMode],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/integrations/trading/account?${marketQueryString}`);
      return res.json();
    },
    refetchInterval: accountRefetchInterval,
    enabled: symbolReady && statusIsConfigured && !statusRequiresTenant && isSymbolValidForMarket,
    refetchIntervalInBackground: false,
  });

  const {
    data: positionsData,
    isLoading: isLoadingPositions,
    error: positionsError,
    refetch: refetchPositions,
  } = useQuery<{ success: boolean; data: PositionsResponse }>({
    queryKey: ['/api/integrations/trading/positions', selectedMarketType, selectedMarginMode],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/integrations/trading/positions?${marketQueryString}`);
      return res.json();
    },
    refetchInterval: accountRefetchInterval,
    enabled: symbolReady && statusIsConfigured && !statusRequiresTenant && isSymbolValidForMarket && selectedMarketType === 'futures',
    refetchIntervalInBackground: false,
  });

  const {
    data: ordersData,
    isLoading: isLoadingOrders,
    error: ordersError,
    refetch: refetchOrders,
  } = useQuery<{ success: boolean; data: TradingOrder[] }>({
    queryKey: ['/api/integrations/trading/orders', selectedMarketType],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/integrations/trading/orders?${ordersQueryString}`);
      return res.json();
    },
    refetchInterval: accountRefetchInterval,
    enabled: statusIsConfigured && !statusRequiresTenant,
    refetchIntervalInBackground: false,
  });

  return {
    accountData,
    accountError,
    isLoadingAccount,
    isLoadingMarket,
    isLoadingOrders,
    isLoadingPositions,
    marketData,
    marketError,
    marketQueryString,
    ordersData,
    ordersError,
    positionsData,
    positionsError,
    refetchAccount,
    refetchOrders,
    refetchPositions,
  };
}
