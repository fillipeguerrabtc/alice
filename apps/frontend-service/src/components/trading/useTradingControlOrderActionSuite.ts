import { useTradingControlOrderMutations } from './useTradingControlOrderMutations';
import { useTradingMutationActionHandlers } from './useTradingMutationActionHandlers';
import { useTradingReviewOrderHandlers } from './useTradingReviewOrderHandlers';

type UseTradingControlOrderMutationsOptions = Parameters<typeof useTradingControlOrderMutations>[0];
type UseTradingReviewOrderHandlersOptions = Parameters<typeof useTradingReviewOrderHandlers>[0];
type UseTradingMutationActionHandlersOptions = Parameters<typeof useTradingMutationActionHandlers>[0];

type UseTradingControlOrderActionSuiteOptions = {
  controlOrderMutationOptions: UseTradingControlOrderMutationsOptions;
  reviewOrderHandlersOptions: Omit<
    UseTradingReviewOrderHandlersOptions,
    'onApproveReviewOrder' | 'onUpdateReviewOrder'
  >;
  mutationActionHandlersOptions: Omit<
    UseTradingMutationActionHandlersOptions,
    'approveReviewOrder' | 'cancelOrder' | 'deactivateSignal' | 'rejectReviewOrder' | 'syncOrders'
  > & {
    deactivateSignal: (signalId: string) => void;
  };
};

/**
 * Concentra a orquestração de mutações/handlers de controle e ordens
 * para manter `Trading.tsx` como composition root mais fino.
 */
export function useTradingControlOrderActionSuite(options: UseTradingControlOrderActionSuiteOptions) {
  const {
    controlOrderMutationOptions,
    reviewOrderHandlersOptions,
    mutationActionHandlersOptions,
  } = options;

  const controlOrderMutations = useTradingControlOrderMutations(controlOrderMutationOptions);

  const reviewOrderHandlers = useTradingReviewOrderHandlers({
    ...reviewOrderHandlersOptions,
    onApproveReviewOrder: controlOrderMutations.approveReviewOrderMutation.mutate,
    onUpdateReviewOrder: controlOrderMutations.updateReviewOrderMutation.mutate,
  });

  const mutationActionHandlers = useTradingMutationActionHandlers({
    ...mutationActionHandlersOptions,
    approveReviewOrder: controlOrderMutations.approveReviewOrderMutation.mutate,
    cancelOrder: controlOrderMutations.cancelOrderMutation.mutate,
    rejectReviewOrder: controlOrderMutations.rejectReviewOrderMutation.mutate,
    syncOrders: controlOrderMutations.syncOrdersMutation.mutate,
  });

  return {
    ...controlOrderMutations,
    ...reviewOrderHandlers,
    ...mutationActionHandlers,
  };
}
