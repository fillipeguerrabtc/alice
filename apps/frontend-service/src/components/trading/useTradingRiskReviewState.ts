import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import {
  createReviewOrderFormFromOrder,
  createRiskFormFromConfig,
  type TradingReviewOrderForm,
  type TradingRiskForm,
} from './TradingFormDefaults';
import type { RiskConfig, TradingOrder } from './TradingDomainTypes';

type UseTradingRiskReviewStateOptions = {
  marketDefaultsInitialized: boolean;
  riskConfigData?: { success: boolean; data: RiskConfig | null };
  setControlMode: Dispatch<SetStateAction<'alice' | 'manual'>>;
  setMarketDefaultsInitialized: Dispatch<SetStateAction<boolean>>;
  setReviewOrderForm: Dispatch<SetStateAction<TradingReviewOrderForm>>;
  setReviewOrderTarget: Dispatch<SetStateAction<TradingOrder | null>>;
  setRiskForm: Dispatch<SetStateAction<TradingRiskForm>>;
  setSelectedMarginMode: Dispatch<SetStateAction<'cross' | 'isolated'>>;
  setSelectedMarketType: Dispatch<SetStateAction<'futures' | 'spot' | 'margin'>>;
  setShowReviewOrderDialog: Dispatch<SetStateAction<boolean>>;
};

export function useTradingRiskReviewState({
  marketDefaultsInitialized,
  riskConfigData,
  setControlMode,
  setMarketDefaultsInitialized,
  setReviewOrderForm,
  setReviewOrderTarget,
  setRiskForm,
  setSelectedMarginMode,
  setSelectedMarketType,
  setShowReviewOrderDialog,
}: UseTradingRiskReviewStateOptions) {
  useEffect(() => {
    if (!riskConfigData?.data) return;

    const config = riskConfigData.data;
    const nextRiskForm = createRiskFormFromConfig(config);
    setRiskForm((previous) => {
      const sameRiskForm = JSON.stringify(previous) === JSON.stringify(nextRiskForm);
      return sameRiskForm ? previous : nextRiskForm;
    });
    setControlMode((previous) => (previous === 'manual' ? previous : 'manual'));

    if (!marketDefaultsInitialized) {
      setSelectedMarketType(config.defaultMarketType ?? 'futures');
      setSelectedMarginMode(config.marginMode ?? 'cross');
      setMarketDefaultsInitialized(true);
    }
  }, [
    marketDefaultsInitialized,
    riskConfigData,
    setControlMode,
    setMarketDefaultsInitialized,
    setRiskForm,
    setSelectedMarginMode,
    setSelectedMarketType,
  ]);

  const openReviewDialog = useCallback((order: TradingOrder) => {
    setReviewOrderTarget(order);
    setReviewOrderForm(createReviewOrderFormFromOrder(order));
    setShowReviewOrderDialog(true);
  }, [setReviewOrderForm, setReviewOrderTarget, setShowReviewOrderDialog]);

  return {
    openReviewDialog,
  };
}
