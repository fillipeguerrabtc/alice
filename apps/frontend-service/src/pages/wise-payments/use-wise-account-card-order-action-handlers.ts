import { useCallback } from 'react';
import type { TFunction } from 'i18next';
import type { NotifyFn, ParseJsonFn } from './wise-account-card-dispute-types';

type MutationWithoutPayload = { mutate: () => void };
type MutationWithPayload<TPayload> = { mutate: (payload: TPayload) => void };

type UseWiseAccountCardOrderActionHandlersOptions = {
  accountDetailsPayload: string;
  cardOrderId: string;
  cardOrderPayload: string;
  cardOrderPinPayload: string;
  cardOrderStatusPayload: string;
  cardOrderValidationPayload: string;
  cardTransactionId: string;
  createAccountDetailsOrderMutation: MutationWithPayload<Record<string, unknown>>;
  createCardOrderMutation: MutationWithPayload<Record<string, unknown>>;
  getCardOrderAvailabilityMutation: MutationWithoutPayload;
  getCardOrderDetailsMutation: MutationWithPayload<string>;
  getCardOrderRequirementsMutation: MutationWithPayload<string>;
  getCardTransactionMutation: MutationWithPayload<string>;
  notify: NotifyFn;
  parseJsonSafe: ParseJsonFn;
  presetCardOrderPinMutation: MutationWithPayload<{
    body: Record<string, unknown>;
    cardOrderId: string;
  }>;
  t: TFunction;
  updateCardOrderStatusMutation: MutationWithPayload<{
    body: Record<string, unknown>;
    cardOrderId: string;
  }>;
  validateCardOrderAddressMutation: MutationWithPayload<Record<string, unknown>>;
};

export function useWiseAccountCardOrderActionHandlers(
  options: UseWiseAccountCardOrderActionHandlersOptions
) {
  const {
    accountDetailsPayload,
    cardOrderId,
    cardOrderPayload,
    cardOrderPinPayload,
    cardOrderStatusPayload,
    cardOrderValidationPayload,
    cardTransactionId,
    createAccountDetailsOrderMutation,
    createCardOrderMutation,
    getCardOrderAvailabilityMutation,
    getCardOrderDetailsMutation,
    getCardOrderRequirementsMutation,
    getCardTransactionMutation,
    notify,
    parseJsonSafe,
    presetCardOrderPinMutation,
    t,
    updateCardOrderStatusMutation,
    validateCardOrderAddressMutation,
  } = options;

  const handleCreateCardOrder = useCallback(() => {
    if (!cardOrderPayload.trim()) {
      notify({ title: t('wise.cardOrders.missingPayload'), variant: 'destructive' });
      return;
    }
    const body = parseJsonSafe(cardOrderPayload, t('wise.cardOrders.invalidPayload'));
    if (!body) return;
    createCardOrderMutation.mutate(body);
  }, [cardOrderPayload, createCardOrderMutation, notify, parseJsonSafe, t]);

  const handleCreateAccountDetailsOrder = useCallback(() => {
    if (!accountDetailsPayload.trim()) {
      notify({ title: t('wise.accountDetails.missingPayload'), variant: 'destructive' });
      return;
    }
    const body = parseJsonSafe(accountDetailsPayload, t('wise.accountDetails.invalidPayload'));
    if (!body) return;
    createAccountDetailsOrderMutation.mutate(body);
  }, [accountDetailsPayload, createAccountDetailsOrderMutation, notify, parseJsonSafe, t]);

  const handleUpdateCardOrderStatus = useCallback(() => {
    if (!cardOrderId.trim() || !cardOrderStatusPayload.trim()) {
      notify({ title: t('wise.cardOrders.missingParams'), variant: 'destructive' });
      return;
    }
    const body = parseJsonSafe(cardOrderStatusPayload, t('wise.cardOrders.invalidPayload'));
    if (!body) return;
    updateCardOrderStatusMutation.mutate({ body, cardOrderId: cardOrderId.trim() });
  }, [cardOrderId, cardOrderStatusPayload, notify, parseJsonSafe, t, updateCardOrderStatusMutation]);

  const handleValidateCardOrderAddress = useCallback(() => {
    if (!cardOrderValidationPayload.trim()) {
      notify({ title: t('wise.cardOrders.missingPayload'), variant: 'destructive' });
      return;
    }
    const body = parseJsonSafe(cardOrderValidationPayload, t('wise.cardOrders.invalidPayload'));
    if (!body) return;
    validateCardOrderAddressMutation.mutate(body);
  }, [cardOrderValidationPayload, notify, parseJsonSafe, t, validateCardOrderAddressMutation]);

  const handlePresetCardOrderPin = useCallback(() => {
    if (!cardOrderId.trim() || !cardOrderPinPayload.trim()) {
      notify({ title: t('wise.cardOrders.missingParams'), variant: 'destructive' });
      return;
    }
    const body = parseJsonSafe(cardOrderPinPayload, t('wise.cardOrders.invalidPayload'));
    if (!body) return;
    presetCardOrderPinMutation.mutate({ body, cardOrderId: cardOrderId.trim() });
  }, [cardOrderId, cardOrderPinPayload, notify, parseJsonSafe, presetCardOrderPinMutation, t]);

  const handleFetchCardOrderDetails = useCallback(() => {
    if (!cardOrderId.trim()) {
      notify({ title: t('wise.cardOrders.missingOrderId'), variant: 'destructive' });
      return;
    }
    getCardOrderDetailsMutation.mutate(cardOrderId.trim());
  }, [cardOrderId, getCardOrderDetailsMutation, notify, t]);

  const handleFetchCardOrderRequirements = useCallback(() => {
    if (!cardOrderId.trim()) {
      notify({ title: t('wise.cardOrders.missingOrderId'), variant: 'destructive' });
      return;
    }
    getCardOrderRequirementsMutation.mutate(cardOrderId.trim());
  }, [cardOrderId, getCardOrderRequirementsMutation, notify, t]);

  const handleFetchCardOrderAvailability = useCallback(() => {
    getCardOrderAvailabilityMutation.mutate();
  }, [getCardOrderAvailabilityMutation]);

  const handleFetchCardTransaction = useCallback(() => {
    if (!cardTransactionId.trim()) {
      notify({ title: t('wise.cardTransactions.missingId'), variant: 'destructive' });
      return;
    }
    getCardTransactionMutation.mutate(cardTransactionId.trim());
  }, [cardTransactionId, getCardTransactionMutation, notify, t]);

  return {
    handleCreateAccountDetailsOrder,
    handleCreateCardOrder,
    handleFetchCardOrderAvailability,
    handleFetchCardOrderDetails,
    handleFetchCardOrderRequirements,
    handleFetchCardTransaction,
    handlePresetCardOrderPin,
    handleUpdateCardOrderStatus,
    handleValidateCardOrderAddress,
  };
}
