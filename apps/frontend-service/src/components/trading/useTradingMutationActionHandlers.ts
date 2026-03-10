import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { TradingTabKey } from './TradingNavigationConfig';

type UseTradingMutationActionHandlersOptions = {
  approveReviewOrder: (orderId: string) => void;
  cancelOrder: (orderId: string) => void;
  deactivateSignal: (signalId: string) => void;
  refetchSignals: () => void;
  rejectReviewOrder: (payload: { orderId: string; reason?: string }) => void;
  setActiveTab: Dispatch<SetStateAction<TradingTabKey>>;
  setSelectedSignalId: Dispatch<SetStateAction<string | null>>;
  syncOrders: () => void;
};

export function useTradingMutationActionHandlers(options: UseTradingMutationActionHandlersOptions) {
  const {
    approveReviewOrder,
    cancelOrder,
    deactivateSignal,
    refetchSignals,
    rejectReviewOrder,
    setActiveTab,
    setSelectedSignalId,
    syncOrders,
  } = options;

  const handleApproveReviewOrderById = useCallback((orderId: string) => {
    approveReviewOrder(orderId);
  }, [approveReviewOrder]);

  const handleCancelOrderById = useCallback((orderId: string) => {
    cancelOrder(orderId);
  }, [cancelOrder]);

  const handleRejectReviewOrderById = useCallback((orderId: string) => {
    rejectReviewOrder({ orderId });
  }, [rejectReviewOrder]);

  const handleSyncOrdersNow = useCallback(() => {
    syncOrders();
  }, [syncOrders]);

  const handleDeactivateSignalById = useCallback((signalId: string) => {
    deactivateSignal(signalId);
  }, [deactivateSignal]);

  const handleOpenGeneratedSignal = useCallback((signalId: string | null) => {
    if (!signalId) return;
    setSelectedSignalId(signalId);
    setActiveTab('signals');
    refetchSignals();
  }, [refetchSignals, setActiveTab, setSelectedSignalId]);

  const handleOpenSignalsPanel = useCallback(() => {
    setActiveTab('signals');
  }, [setActiveTab]);

  const handleOpenAnalysisPanel = useCallback(() => {
    setActiveTab('analysis');
  }, [setActiveTab]);

  const handleOpenLabPanel = useCallback(() => {
    setActiveTab('lab');
  }, [setActiveTab]);

  return {
    handleApproveReviewOrderById,
    handleCancelOrderById,
    handleDeactivateSignalById,
    handleOpenAnalysisPanel,
    handleOpenGeneratedSignal,
    handleOpenLabPanel,
    handleOpenSignalsPanel,
    handleRejectReviewOrderById,
    handleSyncOrdersNow,
  };
}
