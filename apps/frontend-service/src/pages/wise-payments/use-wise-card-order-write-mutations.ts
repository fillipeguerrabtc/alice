import { useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { TFunction } from 'i18next';
import type { NotifyFn } from './wise-account-card-dispute-types';

type UseWiseCardOrderWriteMutationsOptions = {
  notify: NotifyFn;
  profileFilter: string;
  setCardOrderDetails: (value: string | null) => void;
  t: TFunction;
};

export function useWiseCardOrderWriteMutations(
  options: UseWiseCardOrderWriteMutationsOptions
) {
  const {
    notify,
    profileFilter,
    setCardOrderDetails,
    t,
  } = options;

  const createCardOrderMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const response = await apiRequest(
        'POST',
        `/api/integrations/wise/card-orders?profileId=${encodeURIComponent(profileFilter)}`,
        payload
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['/api/integrations/wise/card-orders', profileFilter],
      });
      notify({ title: t('wise.cardOrders.created') });
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.createFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const updateCardOrderStatusMutation = useMutation({
    mutationFn: async (payload: {
      body: Record<string, unknown>;
      cardOrderId: string;
    }) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const response = await apiRequest(
        'PUT',
        `/api/integrations/wise/card-orders/${encodeURIComponent(payload.cardOrderId)}/status?profileId=${encodeURIComponent(profileFilter)}`,
        payload.body
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['/api/integrations/wise/card-orders', profileFilter],
      });
      notify({ title: t('wise.cardOrders.updated') });
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const validateCardOrderAddressMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const response = await apiRequest(
        'POST',
        '/api/integrations/wise/card-orders/validate-address',
        body
      );
      return response.json();
    },
    onSuccess: (data) => {
      setCardOrderDetails(JSON.stringify(data, null, 2));
      notify({ title: t('wise.cardOrders.addressValidated') });
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const presetCardOrderPinMutation = useMutation({
    mutationFn: async (payload: {
      body: Record<string, unknown>;
      cardOrderId: string;
    }) => {
      const response = await apiRequest(
        'POST',
        `/api/integrations/wise/card-orders/${encodeURIComponent(payload.cardOrderId)}/preset-pin`,
        payload.body
      );
      return response.json();
    },
    onSuccess: (data) => {
      setCardOrderDetails(JSON.stringify(data, null, 2));
      notify({ title: t('wise.cardOrders.pinUpdated') });
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  return {
    createCardOrderMutation,
    presetCardOrderPinMutation,
    updateCardOrderStatusMutation,
    validateCardOrderAddressMutation,
  };
}
