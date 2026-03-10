import { useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { TFunction } from 'i18next';
import type {
  NotifyFn,
  WiseFilePayload,
} from './wise-account-card-dispute-types';

type UseWiseAccountCardDisputeFlowMutationsOptions = {
  disputeUpload: WiseFilePayload;
  notify: NotifyFn;
  profileFilter: string;
  setDisputeFlowStepResult: (value: string | null) => void;
  setDisputeFlowSubmitResult: (value: string | null) => void;
  t: TFunction;
};

export function useWiseAccountCardDisputeFlowMutations(
  options: UseWiseAccountCardDisputeFlowMutationsOptions
) {
  const {
    disputeUpload,
    notify,
    profileFilter,
    setDisputeFlowStepResult,
    setDisputeFlowSubmitResult,
    t,
  } = options;

  const updateDisputeStatusMutation = useMutation({
    mutationFn: async (payload: { disputeId: string; status: string }) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const response = await apiRequest(
        'PUT',
        `/api/integrations/wise/disputes/${encodeURIComponent(payload.disputeId)}/status?profileId=${encodeURIComponent(profileFilter)}`,
        { status: payload.status }
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['/api/integrations/wise/disputes', profileFilter],
      });
      notify({ title: t('wise.disputes.updated') });
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const disputeFlowStepMutation = useMutation({
    mutationFn: async (payload: {
      body: Record<string, unknown>;
      reason: string;
      scheme: string;
      transactionId: string;
    }) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const response = await apiRequest(
        'POST',
        '/api/integrations/wise/disputes/flow/step',
        {
          payload: payload.body,
          profileId: profileFilter,
          reason: payload.reason,
          scheme: payload.scheme,
          transactionId: payload.transactionId,
        }
      );
      return response.json();
    },
    onSuccess: (data) => {
      setDisputeFlowStepResult(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setDisputeFlowStepResult(null);
      notify({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const disputeFlowSubmitMutation = useMutation({
    mutationFn: async (payload: {
      body: Record<string, unknown>;
      reason: string;
      scheme: string;
      transactionId: string;
    }) => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const response = await apiRequest(
        'POST',
        '/api/integrations/wise/disputes/flow/submit',
        {
          payload: payload.body,
          profileId: profileFilter,
          reason: payload.reason,
          scheme: payload.scheme,
          transactionId: payload.transactionId,
        }
      );
      return response.json();
    },
    onSuccess: (data) => {
      setDisputeFlowSubmitResult(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setDisputeFlowSubmitResult(null);
      notify({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const uploadDisputeFileMutation = useMutation({
    mutationFn: async () => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const response = await apiRequest(
        'POST',
        `/api/integrations/wise/disputes/upload?profileId=${encodeURIComponent(profileFilter)}`,
        disputeUpload
      );
      return response.json();
    },
    onSuccess: () => {
      notify({ title: t('wise.disputes.uploaded') });
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
    updateDisputeStatusMutation,
    disputeFlowStepMutation,
    disputeFlowSubmitMutation,
    uploadDisputeFileMutation,
  };
}
