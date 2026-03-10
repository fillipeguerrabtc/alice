import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { TradingOrderForm, TradingRiskForm, TradingSignalForm } from './TradingFormDefaults';

type UseTradingDialogFormHandlersOptions = {
  createOrder: (form: TradingOrderForm) => void;
  createSignal: (form: TradingSignalForm) => void;
  handleOrderSizeChange: (value: string) => void;
  isFuturesMarket: boolean;
  orderForm: TradingOrderForm;
  riskForm: TradingRiskForm;
  setOrderForm: Dispatch<SetStateAction<TradingOrderForm>>;
  setRiskForm: Dispatch<SetStateAction<TradingRiskForm>>;
  setShowNewOrderDialog: Dispatch<SetStateAction<boolean>>;
  setShowNewSignalDialog: Dispatch<SetStateAction<boolean>>;
  setSignalForm: Dispatch<SetStateAction<TradingSignalForm>>;
  signalForm: TradingSignalForm;
  updateRiskConfig: (form: TradingRiskForm) => void;
};

export function useTradingDialogFormHandlers(options: UseTradingDialogFormHandlersOptions) {
  const {
    createOrder,
    createSignal,
    handleOrderSizeChange,
    isFuturesMarket,
    orderForm,
    riskForm,
    setOrderForm,
    setRiskForm,
    setShowNewOrderDialog,
    setShowNewSignalDialog,
    setSignalForm,
    signalForm,
    updateRiskConfig,
  } = options;

  const handleOpenNewOrderDialog = useCallback(() => {
    setShowNewOrderDialog(true);
  }, [setShowNewOrderDialog]);

  const handleCloseNewOrderDialog = useCallback(() => {
    setShowNewOrderDialog(false);
  }, [setShowNewOrderDialog]);

  const handleOpenNewSignalDialog = useCallback(() => {
    setShowNewSignalDialog(true);
  }, [setShowNewSignalDialog]);

  const handlePatchOrderForm = useCallback((patch: Partial<TradingOrderForm>) => {
    setOrderForm((previous) => ({ ...previous, ...patch }));
  }, [setOrderForm]);

  const handleNewOrderSizeChange = useCallback((value: string) => {
    if (isFuturesMarket) {
      handleOrderSizeChange(value);
      return;
    }
    setOrderForm((previous) => ({ ...previous, size: value }));
  }, [handleOrderSizeChange, isFuturesMarket, setOrderForm]);

  const handleSubmitNewOrder = useCallback(() => {
    createOrder(orderForm);
  }, [createOrder, orderForm]);

  const handlePatchRiskForm = useCallback((patch: Partial<TradingRiskForm>) => {
    setRiskForm((previous) => ({ ...previous, ...patch }));
  }, [setRiskForm]);

  const handleSubmitRiskConfig = useCallback(() => {
    updateRiskConfig(riskForm);
  }, [riskForm, updateRiskConfig]);

  const handleQuickOrder = useCallback((side: TradingOrderForm['side']) => {
    setOrderForm((previous) => ({ ...previous, side }));
    setShowNewOrderDialog(true);
  }, [setOrderForm, setShowNewOrderDialog]);

  const handleSignalConfidenceChange = useCallback((value: string) => {
    setSignalForm((previous) => ({ ...previous, confidence: value }));
  }, [setSignalForm]);

  const handleSignalReasoningChange = useCallback((value: string) => {
    setSignalForm((previous) => ({ ...previous, reasoning: value }));
  }, [setSignalForm]);

  const handleSignalTypeChange = useCallback((value: string) => {
    setSignalForm((previous) => ({ ...previous, signalType: value as TradingSignalForm['signalType'] }));
  }, [setSignalForm]);

  const handleSubmitSignal = useCallback(() => {
    createSignal(signalForm);
  }, [createSignal, signalForm]);

  return {
    handleCloseNewOrderDialog,
    handleNewOrderSizeChange,
    handleOpenNewOrderDialog,
    handleOpenNewSignalDialog,
    handlePatchOrderForm,
    handlePatchRiskForm,
    handleQuickOrder,
    handleSignalConfidenceChange,
    handleSignalReasoningChange,
    handleSignalTypeChange,
    handleSubmitNewOrder,
    handleSubmitRiskConfig,
    handleSubmitSignal,
  };
}
