import { useMutation } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { apiRequest } from '@/lib/queryClient';
import type { JsonParser, NotifyFn } from './wise-webhook-simulation-sca-types';

type UseWiseScaMutationsOptions = {
  notify: NotifyFn;
  parseJsonSafe: JsonParser;
  profileFilter: string;
  scaJosePayload: string;
  setScaResponse: Dispatch<SetStateAction<string | null>>;
  t: TFunction;
};

export function useWiseScaMutations(options: UseWiseScaMutationsOptions) {
  const {
    notify,
    parseJsonSafe,
    profileFilter,
    scaJosePayload,
    setScaResponse,
    t,
  } = options;

  const runScaMutation = useMutation({
    mutationFn: async (endpoint: string) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const payload = scaJosePayload.trim()
        ? parseJsonSafe(scaJosePayload, t('wise.sca.invalidPayload'))
        : {};
      if (payload === null) {
        throw new Error(t('wise.sca.invalidPayload'));
      }
      const response = await apiRequest(
        'POST',
        `/api/integrations/wise/${endpoint}?profileId=${encodeURIComponent(profileFilter)}`,
        payload
      );
      return response.json();
    },
    onSuccess: (data) => {
      setScaResponse(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setScaResponse(null);
      notify({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const runScaDeleteMutation = useMutation({
    mutationFn: async (endpoint: string) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const payload = scaJosePayload.trim()
        ? parseJsonSafe(scaJosePayload, t('wise.sca.invalidPayload'))
        : {};
      if (payload === null) {
        throw new Error(t('wise.sca.invalidPayload'));
      }
      const response = await apiRequest(
        'DELETE',
        `/api/integrations/wise/${endpoint}?profileId=${encodeURIComponent(profileFilter)}`,
        payload
      );
      return response.json();
    },
    onSuccess: (data) => {
      setScaResponse(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setScaResponse(null);
      notify({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  return { runScaMutation, runScaDeleteMutation };
}
