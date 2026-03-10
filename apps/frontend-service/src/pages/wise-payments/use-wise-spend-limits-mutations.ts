import { useMutation } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { apiRequest } from '@/lib/queryClient';
import type { NotifyFn } from './wise-card-spend-types';

type UseWiseSpendLimitsMutationsOptions = {
  notify: NotifyFn;
  setSpendLimitsCardResult: Dispatch<SetStateAction<string | null>>;
  setSpendLimitsProfileResult: Dispatch<SetStateAction<string | null>>;
  t: TFunction;
};

export function useWiseSpendLimitsMutations(
  options: UseWiseSpendLimitsMutationsOptions
) {
  const { notify, setSpendLimitsCardResult, setSpendLimitsProfileResult, t } = options;

  const getSpendLimitsProfileMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const response = await apiRequest(
        'GET',
        `/api/integrations/wise/spend-limits/profile?profileId=${encodeURIComponent(profileId)}`
      );
      return response.json() as Promise<{ limits: Record<string, unknown> }>;
    },
    onSuccess: (data) => {
      setSpendLimitsProfileResult(JSON.stringify(data.limits, null, 2));
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const updateSpendLimitsProfileMutation = useMutation({
    mutationFn: async (payload: {
      profileId: string;
      body: Record<string, unknown>;
    }) => {
      const response = await apiRequest(
        'PATCH',
        `/api/integrations/wise/spend-limits/profile?profileId=${encodeURIComponent(payload.profileId)}`,
        payload.body
      );
      return response.json();
    },
    onSuccess: () => {
      notify({ title: t('wise.spendLimits.updated') });
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const getSpendLimitsCardMutation = useMutation({
    mutationFn: async (payload: { profileId: string; cardToken: string }) => {
      const response = await apiRequest(
        'GET',
        `/api/integrations/wise/spend-limits/cards/${encodeURIComponent(payload.cardToken)}?profileId=${encodeURIComponent(payload.profileId)}`
      );
      return response.json() as Promise<{ limits: Record<string, unknown> }>;
    },
    onSuccess: (data) => {
      setSpendLimitsCardResult(JSON.stringify(data.limits, null, 2));
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const updateSpendLimitsCardMutation = useMutation({
    mutationFn: async (payload: {
      profileId: string;
      cardToken: string;
      body: Record<string, unknown>;
    }) => {
      const response = await apiRequest(
        'PATCH',
        `/api/integrations/wise/spend-limits/cards/${encodeURIComponent(payload.cardToken)}?profileId=${encodeURIComponent(payload.profileId)}`,
        payload.body
      );
      return response.json();
    },
    onSuccess: () => {
      notify({ title: t('wise.spendLimits.updated') });
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const deleteSpendLimitsCardMutation = useMutation({
    mutationFn: async (payload: { profileId: string; cardToken: string }) => {
      const response = await apiRequest(
        'DELETE',
        `/api/integrations/wise/spend-limits/cards/${encodeURIComponent(payload.cardToken)}?profileId=${encodeURIComponent(payload.profileId)}`
      );
      return response.json();
    },
    onSuccess: () => {
      notify({ title: t('wise.spendLimits.deleted') });
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.deleteFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  return {
    getSpendLimitsProfileMutation,
    updateSpendLimitsProfileMutation,
    getSpendLimitsCardMutation,
    updateSpendLimitsCardMutation,
    deleteSpendLimitsCardMutation,
  };
}
