import { useMemo } from 'react';

type UseTradingRealtimeConnectionStateOptions = {
  availableSymbols: string[];
  selectedMarketType: 'futures' | 'spot' | 'margin';
  selectedSymbol: string;
  statusIsConfigured: boolean;
  statusRequiresTenant: boolean;
  wsInterval: string | null;
};

export function useTradingRealtimeConnectionState({
  availableSymbols,
  selectedMarketType,
  selectedSymbol,
  statusIsConfigured,
  statusRequiresTenant,
  wsInterval,
}: UseTradingRealtimeConnectionStateOptions) {
  const sanitizedSymbol = selectedSymbol.trim();
  const isSymbolValidForMarket = Boolean(sanitizedSymbol && availableSymbols.includes(sanitizedSymbol));
  const requestSymbol = isSymbolValidForMarket ? sanitizedSymbol : '';
  const isFuturesMarket = selectedMarketType === 'futures';
  const wsEnabled = isSymbolValidForMarket
    && statusIsConfigured
    && !statusRequiresTenant;

  const wsChannels = useMemo(() => {
    if (!wsEnabled) return [];
    const baseChannels: Array<'ticker' | 'orderbook' | 'klines' | 'trades' | 'balance' | 'positions' | 'orders'> = ['ticker', 'orderbook', 'trades', 'balance', 'positions', 'orders'];
    if (wsInterval) {
      baseChannels.push('klines');
    }
    return baseChannels;
  }, [wsEnabled, wsInterval]);

  return {
    isFuturesMarket,
    isSymbolValidForMarket,
    requestSymbol,
    sanitizedSymbol,
    wsChannels,
    wsEnabled,
  };
}
