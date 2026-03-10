import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { KlineData } from './CandleChart';
import type { OrderBookResponse } from './TradingDomainTypes';

type UseTradingMarketRealtimeQueriesOptions = {
  granularityValue: number | null;
  isSymbolValidForMarket: boolean;
  marketQueryString: string;
  requestSymbol: string;
  restOrderBookDepth: number | null;
  selectedInterval: string;
  selectedMarginMode: 'cross' | 'isolated';
  selectedMarketType: 'futures' | 'spot' | 'margin';
  statusIsConfigured: boolean;
  symbolReady: boolean;
};

export function useTradingMarketRealtimeQueries({
  granularityValue,
  isSymbolValidForMarket,
  marketQueryString,
  requestSymbol,
  restOrderBookDepth,
  selectedInterval,
  selectedMarginMode,
  selectedMarketType,
  statusIsConfigured,
  symbolReady,
}: UseTradingMarketRealtimeQueriesOptions) {
  const {
    data: klinesData,
    isLoading: isLoadingKlines,
    error: klinesError,
    refetch: refetchKlines,
  } = useQuery<{ success: boolean; data: KlineData[] }>({
    queryKey: ['/api/integrations/trading/klines', requestSymbol, selectedInterval, selectedMarketType, selectedMarginMode],
    queryFn: async () => {
      const params = new URLSearchParams(marketQueryString);
      if (!granularityValue) {
        throw new Error('Intervalo inválido para klines');
      }
      params.set('granularity', String(granularityValue));
      const res = await apiRequest('GET', `/api/integrations/trading/klines/${requestSymbol}?${params.toString()}`);
      return res.json();
    },
    enabled: symbolReady && statusIsConfigured && Boolean(granularityValue) && isSymbolValidForMarket,
  });

  const {
    data: orderBookResponse,
    isLoading: isLoadingOrderBook,
    error: orderBookError,
  } = useQuery<OrderBookResponse>({
    queryKey: ['/api/integrations/trading/orderbook', requestSymbol, selectedMarketType, selectedMarginMode, restOrderBookDepth],
    queryFn: async () => {
      const params = new URLSearchParams(marketQueryString);
      if (restOrderBookDepth) {
        params.set('depth', String(restOrderBookDepth));
      }
      const res = await apiRequest('GET', `/api/integrations/trading/orderbook/${requestSymbol}?${params.toString()}`);
      return res.json();
    },
    enabled: symbolReady && statusIsConfigured && Boolean(restOrderBookDepth) && isSymbolValidForMarket,
  });

  return {
    isLoadingKlines,
    isLoadingOrderBook,
    klinesData,
    klinesError,
    orderBookError,
    orderBookResponse,
    refetchKlines,
  };
}
