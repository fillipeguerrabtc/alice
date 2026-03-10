import { useMemo } from 'react';
import { buildTradingAccountSummaries, resolveTradingOpenPositionsCount } from './TradingDerivedMetrics';
import {
  isFuturesAccountOverview,
  isMarginCrossAccount,
  isMarginCrossOverview,
  isMarginIsolatedAccount,
  isMarginIsolatedOverview,
  isSpotAccountArray,
} from './TradingDomainTypes';
import { getBaseCurrencyFromSymbol, getQuoteCurrencyFromSymbol } from './TradingPageUtils';
import type {
  Position,
  PositionsResponse,
  TradingAccountOverview,
} from './TradingDomainTypes';

type TradingMarketType = 'futures' | 'spot' | 'margin';

type UseTradingAccountPositionStateOptions = {
  account: TradingAccountOverview | undefined;
  isFuturesMarket: boolean;
  openFuturesPositions: Position[];
  positionsPayload: PositionsResponse | null;
  selectedMarketType: TradingMarketType;
  selectedSymbol: string;
};

export function useTradingAccountPositionState({
  account,
  isFuturesMarket,
  openFuturesPositions,
  positionsPayload,
  selectedMarketType,
  selectedSymbol,
}: UseTradingAccountPositionStateOptions) {
  return useMemo(() => {
    const isSpotMarket = selectedMarketType === 'spot';
    const isMarginMarket = selectedMarketType === 'margin';
    const baseCurrency = getBaseCurrencyFromSymbol(selectedSymbol);
    const quoteCurrency = getQuoteCurrencyFromSymbol(selectedSymbol);
    const spotAccounts = isSpotMarket && isSpotAccountArray(account)
      ? account.filter((entry) => entry.type === 'trade')
      : [];
    const spotBaseAccount = spotAccounts.find((entry) => entry.currency === (baseCurrency ?? entry.currency));
    const spotQuoteAccount = spotAccounts.find((entry) => entry.currency === (quoteCurrency ?? entry.currency));
    const marginCrossAccount = isMarginMarket && isMarginCrossOverview(account)
      ? account
      : null;
    const marginIsolatedAccount = isMarginMarket && isMarginIsolatedOverview(account)
      ? account
      : null;
    const marginIsolatedAsset = marginIsolatedAccount?.assets.find((asset) => asset.symbol === selectedSymbol)
      ?? marginIsolatedAccount?.assets[0];
    const marginCrossPositions = selectedMarketType === 'margin' && isMarginCrossAccount(positionsPayload)
      ? positionsPayload
      : null;
    const marginIsolatedPositions = selectedMarketType === 'margin' && isMarginIsolatedAccount(positionsPayload)
      ? positionsPayload
      : null;
    const spotPositions = selectedMarketType === 'spot' && isSpotAccountArray(positionsPayload)
      ? positionsPayload
      : [];
    const openPositionsCount = resolveTradingOpenPositionsCount({
      isFuturesMarket,
      isMarginMarket,
      isSpotMarket,
      marginCrossPositions,
      marginIsolatedPositions,
      openFuturesPositions,
      spotPositions,
    });
    const accountMode: TradingMarketType = isFuturesMarket ? 'futures' : isSpotMarket ? 'spot' : 'margin';
    const {
      futuresAccountSummary,
      marginAccountSummary,
      spotAccountSummary,
    } = buildTradingAccountSummaries({
      account,
      baseCurrency,
      marginCrossAccount,
      marginIsolatedAccount,
      marginIsolatedAsset,
      quoteCurrency,
      spotAccounts,
      spotBaseAccount,
      spotQuoteAccount,
    });
    const futuresAccount = isFuturesMarket && isFuturesAccountOverview(account)
      ? account
      : null;

    return {
      accountMode,
      futuresAccount,
      futuresAccountSummary,
      isMarginMarket,
      isSpotMarket,
      marginAccountSummary,
      marginCrossPositions,
      marginIsolatedPositions,
      openPositionsCount,
      quoteCurrency,
      spotAccountSummary,
      spotPositions,
    };
  }, [account, isFuturesMarket, openFuturesPositions, positionsPayload, selectedMarketType, selectedSymbol]);
}
