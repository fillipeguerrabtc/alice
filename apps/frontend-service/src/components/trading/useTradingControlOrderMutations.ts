import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type {
  ReviewOrderUpdates,
  UseTradingControlOrderMutationsOptions,
} from './trading-control-order-types';
import { useTradingOrderExecutionMutations } from './useTradingOrderExecutionMutations';
import { useTradingRiskControlActions } from './useTradingRiskControlActions';

export function useTradingControlOrderMutations(options: UseTradingControlOrderMutationsOptions) {
  const {
    notify,
    refetchAccount,
    refetchControlHistory,
    refetchOrders,
    refetchPositions,
    refetchRiskConfig,
    refetchStatus,
    selectedMarginMode,
    selectedMarketType,
    selectedSymbol,
    setControlMode,
    setOrderForm,
    setReviewOrderTarget,
    setShowNewOrderDialog,
    setShowReviewOrderDialog,
    setShowRiskConfigDialog,
    t,
  } = options;

  const {
    createOrderMutation,
    cancelOrderMutation,
    syncOrdersMutation,
  } = useTradingOrderExecutionMutations({
    notify,
    refetchAccount,
    refetchOrders,
    selectedMarginMode,
    selectedMarketType,
    selectedSymbol,
    setOrderForm,
    setShowNewOrderDialog,
    t,
  });

  const approveReviewOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await apiRequest('POST', `/api/integrations/trading/orders/${orderId}/approve`);
      return res.json();
    },
    onSuccess: () => {
      notify({ title: 'Ordem aprovada', description: 'Ordem enviada para execução na KuCoin.' });
      refetchOrders();
      refetchPositions();
    },
    onError: (error: Error) => {
      notify({
        title: 'Falha ao aprovar ordem',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const rejectReviewOrderMutation = useMutation({
    mutationFn: async ({ orderId, reason }: { orderId: string; reason?: string }) => {
      const res = await apiRequest('POST', `/api/integrations/trading/orders/${orderId}/reject`, { reason });
      return res.json();
    },
    onSuccess: () => {
      notify({ title: 'Ordem rejeitada', description: 'Ordem marcada como rejeitada.' });
      refetchOrders();
    },
    onError: (error: Error) => {
      notify({
        title: 'Falha ao rejeitar ordem',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const updateReviewOrderMutation = useMutation({
    mutationFn: async (payload: { orderId: string; updates: ReviewOrderUpdates }) => {
      const res = await apiRequest('PATCH', `/api/integrations/trading/orders/${payload.orderId}/review`, payload.updates);
      return res.json();
    },
    onSuccess: () => {
      notify({ title: 'Ordem atualizada', description: 'Ajustes salvos com sucesso.' });
      setShowReviewOrderDialog(false);
      setReviewOrderTarget(null);
      refetchOrders();
    },
    onError: (error: Error) => {
      notify({
        title: 'Falha ao atualizar ordem',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const {
    updateRiskConfigMutation,
    handleModeChange,
    handleTradingToggle,
  } = useTradingRiskControlActions({
    notify,
    refetchControlHistory,
    refetchRiskConfig,
    refetchStatus,
    setControlMode,
    setShowRiskConfigDialog,
    t,
  });

  return {
    approveReviewOrderMutation,
    cancelOrderMutation,
    createOrderMutation,
    handleModeChange,
    handleTradingToggle,
    rejectReviewOrderMutation,
    syncOrdersMutation,
    updateReviewOrderMutation,
    updateRiskConfigMutation,
  };
}
