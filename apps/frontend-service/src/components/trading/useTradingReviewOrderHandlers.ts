import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { TradingOrder } from './TradingDomainTypes';
import type { TradingReviewOrderForm } from './TradingFormDefaults';

type ReviewOrderUpdates = {
  orderType?: TradingOrder['orderType'];
  size?: number;
  price?: number;
  leverage?: number;
  stopLoss?: number;
  takeProfit?: number;
};

type UseTradingReviewOrderHandlersOptions = {
  onApproveReviewOrder: (orderId: string) => void;
  onUpdateReviewOrder: (payload: { orderId: string; updates: ReviewOrderUpdates }) => void;
  reviewOrderForm: TradingReviewOrderForm;
  reviewOrderTarget: TradingOrder | null;
  setReviewOrderForm: Dispatch<SetStateAction<TradingReviewOrderForm>>;
};

function parseOptionalNumber(value: string): number | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function buildTradingReviewOrderUpdates(form: TradingReviewOrderForm): ReviewOrderUpdates {
  return {
    orderType: form.orderType,
    size: parseOptionalNumber(form.size),
    price: parseOptionalNumber(form.price),
    leverage: parseOptionalNumber(form.leverage),
    stopLoss: parseOptionalNumber(form.stopLoss),
    takeProfit: parseOptionalNumber(form.takeProfit),
  };
}

export function useTradingReviewOrderHandlers(options: UseTradingReviewOrderHandlersOptions) {
  const {
    onApproveReviewOrder,
    onUpdateReviewOrder,
    reviewOrderForm,
    reviewOrderTarget,
    setReviewOrderForm,
  } = options;

  const handleApproveReviewOrder = useCallback(() => {
    if (!reviewOrderTarget) return;
    onApproveReviewOrder(reviewOrderTarget.id);
  }, [onApproveReviewOrder, reviewOrderTarget]);

  const handleSaveReviewOrderAdjustments = useCallback(() => {
    if (!reviewOrderTarget) return;
    onUpdateReviewOrder({
      orderId: reviewOrderTarget.id,
      updates: buildTradingReviewOrderUpdates(reviewOrderForm),
    });
  }, [onUpdateReviewOrder, reviewOrderForm, reviewOrderTarget]);

  const handleReviewOrderFieldUpdate = useCallback((
    field: keyof TradingReviewOrderForm,
    value: string
  ) => {
    setReviewOrderForm((previous) => {
      if (field === 'orderType') {
        return { ...previous, orderType: value as TradingOrder['orderType'] };
      }
      return { ...previous, [field]: value };
    });
  }, [setReviewOrderForm]);

  return {
    handleApproveReviewOrder,
    handleReviewOrderFieldUpdate,
    handleSaveReviewOrderAdjustments,
  };
}
