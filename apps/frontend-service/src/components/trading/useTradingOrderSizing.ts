import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { parseLocaleNumberInput } from '@/lib/utils';
import type { TickerData } from '@/hooks/useKucoinWebSocket';
import type { TradingOrderForm } from './TradingFormDefaults';
import type { MarketData } from './TradingDomainTypes';

type TradingOrderSizingOptions = {
  market: MarketData | undefined;
  wsEnabled: boolean;
  wsTicker: TickerData | null;
  normalizedSymbol: string;
  isFuturesMarket: boolean;
  setOrderForm: Dispatch<SetStateAction<TradingOrderForm>>;
};

export function resolveTradingCurrentPrice(params: {
  market: MarketData | undefined;
  wsEnabled: boolean;
  wsTicker: TickerData | null;
  normalizedSymbol: string;
  isFuturesMarket: boolean;
}): { currentPrice: number; contractMultiplier: number } {
  const { market, wsEnabled, wsTicker, normalizedSymbol, isFuturesMarket } = params;
  const contractMultiplier = market?.contract?.multiplier ?? 0.001;
  const wsTickerPrice = wsEnabled && wsTicker?.symbol?.toUpperCase() === normalizedSymbol
    ? Number(wsTicker.price)
    : NaN;
  const fallbackPrice = isFuturesMarket
    ? market?.contract?.lastTradePrice
    : (market?.ticker?.price ? Number(market.ticker.price) : undefined);
  const fallbackPriceValue = Number.isFinite(fallbackPrice ?? NaN) ? Number(fallbackPrice) : 0;
  const currentPrice = Number.isFinite(wsTickerPrice) ? wsTickerPrice : fallbackPriceValue;
  return { currentPrice, contractMultiplier };
}

export function useTradingOrderSizing(options: TradingOrderSizingOptions): {
  currentPrice: number;
  contractMultiplier: number;
  handleOrderSizeChange: (sizeValue: string) => void;
  handleOrderUsdtChange: (usdtValue: string) => void;
} {
  const { market, wsEnabled, wsTicker, normalizedSymbol, isFuturesMarket, setOrderForm } = options;
  const { currentPrice, contractMultiplier } = resolveTradingCurrentPrice({
    market,
    wsEnabled,
    wsTicker,
    normalizedSymbol,
    isFuturesMarket,
  });

  const handleOrderSizeChange = useCallback((sizeValue: string) => {
    setOrderForm((prev) => {
      const sizeNum = parseLocaleNumberInput(sizeValue);
      if (currentPrice > 0 && sizeNum !== null && Number.isFinite(sizeNum) && sizeNum > 0 && isFuturesMarket) {
        const usdtValue = sizeNum * currentPrice * contractMultiplier;
        return { ...prev, size: sizeValue, usdtAmount: usdtValue.toFixed(2) };
      }
      return { ...prev, size: sizeValue, usdtAmount: '' };
    });
  }, [contractMultiplier, currentPrice, isFuturesMarket, setOrderForm]);

  const handleOrderUsdtChange = useCallback((usdtValue: string) => {
    setOrderForm((prev) => {
      const usdtNum = parseLocaleNumberInput(usdtValue);
      if (currentPrice > 0 && usdtNum !== null && Number.isFinite(usdtNum) && usdtNum > 0 && isFuturesMarket) {
        const quantity = usdtNum / (currentPrice * contractMultiplier);
        return { ...prev, usdtAmount: usdtValue, size: quantity.toFixed(4) };
      }
      return { ...prev, usdtAmount: usdtValue, size: '' };
    });
  }, [contractMultiplier, currentPrice, isFuturesMarket, setOrderForm]);

  return {
    currentPrice,
    contractMultiplier,
    handleOrderSizeChange,
    handleOrderUsdtChange,
  };
}
