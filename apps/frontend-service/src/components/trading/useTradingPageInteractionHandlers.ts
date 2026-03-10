import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { TradingOrder } from './TradingDomainTypes';
import type { TradingOrderForm } from './TradingFormDefaults';
import type { TradingTabKey } from './TradingNavigationConfig';

type TradingMarketType = 'futures' | 'spot' | 'margin';

type UseTradingPageInteractionHandlersOptions = {
  availableSymbols: string[];
  openReviewDialog: (order: TradingOrder) => void;
  orders: TradingOrder[];
  setActiveTab: Dispatch<SetStateAction<TradingTabKey>>;
  setOrderForm: Dispatch<SetStateAction<TradingOrderForm>>;
  setSelectedInterval: Dispatch<SetStateAction<string>>;
  setSelectedMarketType: Dispatch<SetStateAction<TradingMarketType>>;
  setSelectedSymbol: Dispatch<SetStateAction<string>>;
};

export function useTradingPageInteractionHandlers(options: UseTradingPageInteractionHandlersOptions) {
  const {
    availableSymbols,
    openReviewDialog,
    orders,
    setActiveTab,
    setOrderForm,
    setSelectedInterval,
    setSelectedMarketType,
    setSelectedSymbol,
  } = options;

  const resolveSpotLikeSymbol = useCallback((asset: string) => {
    const normalized = asset.trim().toUpperCase();
    const withDash = `${normalized}-USDT`;
    const withoutDash = `${normalized}USDT`;
    if (availableSymbols.includes(withDash)) return withDash;
    if (availableSymbols.includes(withoutDash)) return withoutDash;
    return withDash;
  }, [availableSymbols]);

  const prefillSellOrderFromAsset = useCallback((
    asset: string,
    availableAmount: number,
    marketType: 'spot' | 'margin',
    isolatedSymbol?: string
  ) => {
    const normalizedAsset = asset.trim().toUpperCase();
    if (!normalizedAsset || normalizedAsset === 'USDT' || availableAmount <= 0) return;
    const symbolToUse = isolatedSymbol || resolveSpotLikeSymbol(normalizedAsset);
    setSelectedMarketType(marketType);
    setSelectedSymbol(symbolToUse);
    setActiveTab('orders');
    setOrderForm((prev) => ({
      ...prev,
      side: 'sell',
      orderType: 'market',
      size: availableAmount.toString(),
      funds: '',
      price: '',
      leverage: marketType === 'margin' ? prev.leverage : '1',
      stopLoss: '',
      takeProfit: '',
    }));
  }, [resolveSpotLikeSymbol, setActiveTab, setOrderForm, setSelectedMarketType, setSelectedSymbol]);

  const handleIntervalChange = useCallback((newInterval: string) => {
    setSelectedInterval(newInterval);
  }, [setSelectedInterval]);

  const openReviewDialogById = useCallback((orderId: string) => {
    const target = orders.find((order) => order.id === orderId);
    if (!target) return;
    openReviewDialog(target);
  }, [openReviewDialog, orders]);

  return {
    handleIntervalChange,
    openReviewDialogById,
    prefillSellOrderFromAsset,
    resolveSpotLikeSymbol,
  };
}
