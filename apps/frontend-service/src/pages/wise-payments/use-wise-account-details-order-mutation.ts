import { useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { TFunction } from 'i18next';
import type { NotifyFn } from './wise-account-card-dispute-types';

type UseWiseAccountDetailsOrderMutationOptions = {
  notify: NotifyFn;
  profileFilter: string;
  setAccountDetailsResponse: (value: string | null) => void;
  t: TFunction;
};

export function useWiseAccountDetailsOrderMutation(
  options: UseWiseAccountDetailsOrderMutationOptions
) {
  const { notify, profileFilter, setAccountDetailsResponse, t } = options;

  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const response = await apiRequest(
        'POST',
        `/api/integrations/wise/account-details/orders?profileId=${encodeURIComponent(profileFilter)}`,
        payload
      );
      return response.json();
    },
    onSuccess: (data) => {
      setAccountDetailsResponse(JSON.stringify(data, null, 2));
      queryClient.invalidateQueries({
        queryKey: ['/api/integrations/wise/account-details/orders', profileFilter],
      });
      notify({ title: t('wise.accountDetails.created') });
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.createFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });
}
