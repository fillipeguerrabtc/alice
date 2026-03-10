import { useMutation } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { apiRequest, queryClient } from '@/lib/queryClient';
import {
  INITIAL_SPEND_CONTROL_FORM,
  type NotifyFn,
  type SpendControlForm,
} from './wise-card-spend-types';

type UseWiseSpendControlMutationsOptions = {
  notify: NotifyFn;
  profileFilter: string;
  setSpendControlForm: Dispatch<SetStateAction<SpendControlForm>>;
  t: TFunction;
};

export function useWiseSpendControlMutations(
  options: UseWiseSpendControlMutationsOptions
) {
  const { notify, profileFilter, setSpendControlForm, t } = options;

  const createSpendControlMutation = useMutation({
    mutationFn: async (payload: {
      name: string;
      currency: string;
      maxAmount: number;
      period: string;
    }) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const response = await apiRequest(
        'POST',
        `/api/integrations/wise/spend-controls?profileId=${encodeURIComponent(profileFilter)}`,
        payload
      );
      return response.json();
    },
    onSuccess: () => {
      setSpendControlForm(INITIAL_SPEND_CONTROL_FORM);
      queryClient.invalidateQueries({
        queryKey: ['/api/integrations/wise/spend-controls', profileFilter],
      });
      notify({ title: t('wise.spendControls.created') });
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.createFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const assignSpendControlMutation = useMutation({
    mutationFn: async (payload: { ruleId: string; cardToken: string }) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const response = await apiRequest(
        'POST',
        `/api/integrations/wise/spend-controls/${encodeURIComponent(payload.ruleId)}/assign?profileId=${encodeURIComponent(profileFilter)}`,
        { cardToken: payload.cardToken }
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['/api/integrations/wise/spend-controls', profileFilter],
      });
      notify({ title: t('wise.spendControls.assigned') });
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const deleteSpendControlMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const response = await apiRequest(
        'DELETE',
        `/api/integrations/wise/spend-controls/${encodeURIComponent(ruleId)}?profileId=${encodeURIComponent(profileFilter)}`
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['/api/integrations/wise/spend-controls', profileFilter],
      });
      notify({ title: t('wise.spendControls.deleted') });
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.deleteFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const unassignSpendControlMutation = useMutation({
    mutationFn: async (payload: { ruleId: string; cardToken: string }) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const response = await apiRequest(
        'POST',
        `/api/integrations/wise/spend-controls/${encodeURIComponent(payload.ruleId)}/unassign?profileId=${encodeURIComponent(profileFilter)}`,
        { cardToken: payload.cardToken }
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['/api/integrations/wise/spend-controls', profileFilter],
      });
      notify({ title: t('wise.spendControls.unassigned') });
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
    createSpendControlMutation,
    assignSpendControlMutation,
    deleteSpendControlMutation,
    unassignSpendControlMutation,
  };
}
