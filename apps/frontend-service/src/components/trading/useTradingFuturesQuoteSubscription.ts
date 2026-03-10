import { useEffect } from 'react';
import type { Position } from './TradingDomainTypes';

type SubscribeFn = (
  channel: 'ticker' | 'orderbook' | 'klines' | 'trades' | 'balance' | 'positions' | 'orders',
  symbol: string,
  interval?: string,
  marketType?: 'futures' | 'spot' | 'margin',
  marginMode?: 'cross' | 'isolated',
) => void;

type UnsubscribeFn = (
  channel: 'ticker' | 'orderbook' | 'klines' | 'trades' | 'balance' | 'positions' | 'orders',
  symbol: string,
  interval?: string,
  marketType?: 'futures' | 'spot' | 'margin',
  marginMode?: 'cross' | 'isolated',
) => void;

type UseTradingFuturesQuoteSubscriptionOptions = {
  isFuturesMarket: boolean;
  openFuturesPositions: Position[];
  subscribePositionQuotes: SubscribeFn;
  unsubscribePositionQuotes: UnsubscribeFn;
  wsConnected: boolean;
};

export function useTradingFuturesQuoteSubscription({
  isFuturesMarket,
  openFuturesPositions,
  subscribePositionQuotes,
  unsubscribePositionQuotes,
  wsConnected,
}: UseTradingFuturesQuoteSubscriptionOptions) {
  useEffect(() => {
    if (!isFuturesMarket || !wsConnected) return;
    const activeSymbols = new Set(
      openFuturesPositions
        .map((position) => position.symbol.toUpperCase())
        .filter((symbol) => symbol.length > 0),
    );

    activeSymbols.forEach((symbol) => {
      subscribePositionQuotes('ticker', symbol, undefined, 'futures', 'cross');
    });

    return () => {
      activeSymbols.forEach((symbol) => {
        unsubscribePositionQuotes('ticker', symbol, undefined, 'futures', 'cross');
      });
    };
  }, [
    isFuturesMarket,
    openFuturesPositions,
    subscribePositionQuotes,
    unsubscribePositionQuotes,
    wsConnected,
  ]);
}
