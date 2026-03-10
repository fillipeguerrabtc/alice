import { useMutation } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { NotifyFn } from './wise-card-spend-types';

type UseWiseCardStatusMutationsOptions = {
  notify: NotifyFn;
  profileFilter: string;
  t: TFunction;
};

export function useWiseCardStatusMutations(
  options: UseWiseCardStatusMutationsOptions
) {
  const { notify, profileFilter, t } = options;

  const updateCardStatusMutation = useMutation({
    mutationFn: async (payload: { cardToken: string; status: string }) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const response = await apiRequest(
        'PUT',
        `/api/integrations/wise/cards/${encodeURIComponent(payload.cardToken)}/status?profileId=${encodeURIComponent(profileFilter)}`,
        { status: payload.status }
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['/api/integrations/wise/cards', profileFilter],
      });
      notify({ title: t('wise.cards.updated') });
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  return { updateCardStatusMutation };
}
