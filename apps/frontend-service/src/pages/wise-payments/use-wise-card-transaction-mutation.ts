import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { TFunction } from 'i18next';
import type { NotifyFn } from './wise-account-card-dispute-types';

type UseWiseCardTransactionMutationOptions = {
  notify: NotifyFn;
  profileFilter: string;
  setCardTransactionDetails: (value: string | null) => void;
  t: TFunction;
};

export function useWiseCardTransactionMutation(
  options: UseWiseCardTransactionMutationOptions
) {
  const { notify, profileFilter, setCardTransactionDetails, t } = options;

  const getCardTransactionMutation = useMutation({
    mutationFn: async (transactionId: string) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const response = await apiRequest(
        'GET',
        `/api/integrations/wise/cards/transactions/${encodeURIComponent(transactionId)}?profileId=${encodeURIComponent(profileFilter)}`
      );
      return response.json();
    },
    onSuccess: (data) => {
      setCardTransactionDetails(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setCardTransactionDetails(null);
      notify({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  return { getCardTransactionMutation };
}
