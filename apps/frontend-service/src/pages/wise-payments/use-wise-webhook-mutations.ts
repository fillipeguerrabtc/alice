import { useMutation } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { apiRequest } from '@/lib/queryClient';
import type { NotifyFn } from './wise-webhook-simulation-sca-types';

type UseWiseWebhookMutationsOptions = {
  notify: NotifyFn;
  profileFilter: string;
  setWebhookResponse: Dispatch<SetStateAction<string | null>>;
  t: TFunction;
  webhookApplication: string;
};

export function useWiseWebhookMutations(options: UseWiseWebhookMutationsOptions) {
  const { notify, profileFilter, setWebhookResponse, t, webhookApplication } = options;

  const listWebhooksMutation = useMutation({
    mutationFn: async () => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const params = new URLSearchParams({
        profileId: profileFilter,
        application: webhookApplication,
      });
      const response = await apiRequest(
        'GET',
        `/api/integrations/wise/webhooks?${params.toString()}`
      );
      return response.json();
    },
    onSuccess: (data) => {
      setWebhookResponse(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setWebhookResponse(null);
      notify({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const createWebhookMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const params = new URLSearchParams({
        profileId: profileFilter,
        application: webhookApplication,
      });
      const response = await apiRequest(
        'POST',
        `/api/integrations/wise/webhooks?${params.toString()}`,
        payload
      );
      return response.json();
    },
    onSuccess: (data) => {
      setWebhookResponse(JSON.stringify(data, null, 2));
      notify({ title: t('wise.webhooks.created') });
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.createFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const deleteWebhookMutation = useMutation({
    mutationFn: async (subscriptionId: string) => {
      const response = await apiRequest(
        'DELETE',
        `/api/integrations/wise/webhooks/${encodeURIComponent(subscriptionId)}`
      );
      return response.json();
    },
    onSuccess: (data) => {
      setWebhookResponse(JSON.stringify(data, null, 2));
      notify({ title: t('wise.webhooks.deleted') });
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
    listWebhooksMutation,
    createWebhookMutation,
    deleteWebhookMutation,
  };
}
