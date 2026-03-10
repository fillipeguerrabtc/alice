import { useEffect, useMemo } from 'react';
import type { OrderBookData as WsOrderBookData, TickerData } from '@/hooks/useKucoinWebSocket';
import type { MarketData, OrderBookResponse } from './TradingDomainTypes';

type UseTradingMarketOrderBookStateOptions = {
  granularityValue?: number | null;
  isSymbolValidForMarket: boolean;
  marketData?: { success: boolean; data: MarketData };
  onInvalidateKlines: () => void;
  orderBookResponse?: OrderBookResponse;
  requestSymbol: string;
  selectedInterval: string;
  selectedMarginMode: 'cross' | 'isolated';
  selectedMarketType: 'futures' | 'spot' | 'margin';
  statusIsConfigured: boolean;
  wsEnabled: boolean;
  wsOrderBook: WsOrderBookData | null;
  wsTicker: TickerData | null;
};

export function useTradingMarketOrderBookState({
  granularityValue,
  isSymbolValidForMarket,
  marketData,
  onInvalidateKlines,
  orderBookResponse,
  requestSymbol,
  selectedInterval,
  selectedMarginMode,
  selectedMarketType,
  statusIsConfigured,
  wsEnabled,
  wsOrderBook,
  wsTicker,
}: UseTradingMarketOrderBookStateOptions) {
  useEffect(() => {
    if (!statusIsConfigured || !granularityValue || !isSymbolValidForMarket) return;
    onInvalidateKlines();
  }, [
    granularityValue,
    isSymbolValidForMarket,
    onInvalidateKlines,
    requestSymbol,
    selectedInterval,
    selectedMarginMode,
    selectedMarketType,
    statusIsConfigured,
  ]);

  const market = marketData?.data;
  const normalizedSymbol = requestSymbol.toUpperCase();

  const wsOrderBookData = wsEnabled && wsOrderBook?.symbol?.toUpperCase() === normalizedSymbol
    ? wsOrderBook
    : null;

  const orderBookData = wsOrderBookData ?? orderBookResponse?.data ?? null;

  const orderBookPrecision = useMemo(() => {
    const samplePrice =
      orderBookData?.bids?.[0]?.price ||
      orderBookData?.asks?.[0]?.price ||
      wsTicker?.price ||
      market?.ticker?.price;

    if (!samplePrice) return null;
    const [, decimals = ''] = String(samplePrice).split('.');
    return decimals.length;
  }, [market, orderBookData, wsTicker]);

  return {
    market,
    normalizedSymbol,
    orderBookData,
    orderBookPrecision,
  };
}
