import type { TFunction } from 'i18next';
import type { TradingOrderForm, TradingRiskForm } from './TradingFormDefaults';
import type { TradingOrder } from './TradingDomainTypes';
import type { TradingControlMode } from './HandoverPanel';

export type NotifyFn = (params: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

export type RefetchFn = () => void;

export type UseTradingControlOrderMutationsOptions = {
  notify: NotifyFn;
  refetchAccount: RefetchFn;
  refetchControlHistory: RefetchFn;
  refetchOrders: RefetchFn;
  refetchPositions: RefetchFn;
  refetchRiskConfig: RefetchFn;
  refetchStatus: RefetchFn;
  selectedMarginMode: 'cross' | 'isolated';
  selectedMarketType: 'futures' | 'spot' | 'margin';
  selectedSymbol: string;
  setControlMode: (mode: TradingControlMode) => void;
  setOrderForm: (updater: (previous: TradingOrderForm) => TradingOrderForm) => void;
  setReviewOrderTarget: (value: TradingOrder | null) => void;
  setShowNewOrderDialog: (value: boolean) => void;
  setShowReviewOrderDialog: (value: boolean) => void;
  setShowRiskConfigDialog: (value: boolean) => void;
  t: TFunction;
};

export type ReviewOrderUpdates = {
  orderType?: TradingOrder['orderType'];
  size?: number;
  price?: number;
  leverage?: number;
  stopLoss?: number;
  takeProfit?: number;
};

export type TradingOrderExecutionMutationOptions = Pick<
  UseTradingControlOrderMutationsOptions,
  | 'notify'
  | 'refetchAccount'
  | 'refetchOrders'
  | 'selectedMarginMode'
  | 'selectedMarketType'
  | 'selectedSymbol'
  | 'setOrderForm'
  | 'setShowNewOrderDialog'
  | 't'
>;

export type TradingRiskControlMutationOptions = Pick<
  UseTradingControlOrderMutationsOptions,
  | 'notify'
  | 'refetchControlHistory'
  | 'refetchRiskConfig'
  | 'refetchStatus'
  | 'setControlMode'
  | 'setShowRiskConfigDialog'
  | 't'
>;

export type TradingRiskConfigMutationInput = TradingRiskForm;
