import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { TFunction } from 'i18next';
import type { NotifyFn } from './wise-account-card-dispute-types';

type UseWiseCardOrderReadMutationsOptions = {
  notify: NotifyFn;
  profileFilter: string;
  setCardOrderAvailability: (value: string | null) => void;
  setCardOrderDetails: (value: string | null) => void;
  setCardOrderRequirements: (value: string | null) => void;
  t: TFunction;
};

export function useWiseCardOrderReadMutations(
  options: UseWiseCardOrderReadMutationsOptions
) {
  const {
    notify,
    profileFilter,
    setCardOrderAvailability,
    setCardOrderDetails,
    setCardOrderRequirements,
    t,
  } = options;

  const getCardOrderAvailabilityMutation = useMutation({
    mutationFn: async () => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const response = await apiRequest(
        'GET',
        `/api/integrations/wise/card-orders/availability?profileId=${encodeURIComponent(profileFilter)}`
      );
      return response.json();
    },
    onSuccess: (data) => {
      setCardOrderAvailability(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setCardOrderAvailability(null);
      notify({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const getCardOrderDetailsMutation = useMutation({
    mutationFn: async (selectedCardOrderId: string) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const response = await apiRequest(
        'GET',
        `/api/integrations/wise/card-orders/${encodeURIComponent(selectedCardOrderId)}?profileId=${encodeURIComponent(profileFilter)}`
      );
      return response.json();
    },
    onSuccess: (data) => {
      setCardOrderDetails(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setCardOrderDetails(null);
      notify({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const getCardOrderRequirementsMutation = useMutation({
    mutationFn: async (selectedCardOrderId: string) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const response = await apiRequest(
        'GET',
        `/api/integrations/wise/card-orders/${encodeURIComponent(selectedCardOrderId)}/requirements?profileId=${encodeURIComponent(profileFilter)}`
      );
      return response.json();
    },
    onSuccess: (data) => {
      setCardOrderRequirements(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setCardOrderRequirements(null);
      notify({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  return {
    getCardOrderAvailabilityMutation,
    getCardOrderDetailsMutation,
    getCardOrderRequirementsMutation,
  };
}
