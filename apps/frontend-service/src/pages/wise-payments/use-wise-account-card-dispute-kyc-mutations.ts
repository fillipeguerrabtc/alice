import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { TFunction } from 'i18next';
import type {
  NotifyFn,
  WiseFilePayload,
} from './wise-account-card-dispute-types';

type UseWiseAccountCardDisputeKycMutationsOptions = {
  kycUploadAdditional: WiseFilePayload;
  kycUploadDocument: WiseFilePayload;
  notify: NotifyFn;
  profileFilter: string;
  setKycRequiredEvidences: (value: string | null) => void;
  t: TFunction;
};

export function useWiseAccountCardDisputeKycMutations(
  options: UseWiseAccountCardDisputeKycMutationsOptions
) {
  const {
    kycUploadAdditional,
    kycUploadDocument,
    notify,
    profileFilter,
    setKycRequiredEvidences,
    t,
  } = options;

  const getKycRequiredEvidencesMutation = useMutation({
    mutationFn: async () => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const response = await apiRequest(
        'GET',
        `/api/integrations/wise/verification/required-evidences?profileId=${encodeURIComponent(profileFilter)}`
      );
      return response.json();
    },
    onSuccess: (data) => {
      setKycRequiredEvidences(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setKycRequiredEvidences(null);
      notify({
        title: t('wise.errors.fetchFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const uploadKycDocumentMutation = useMutation({
    mutationFn: async () => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const response = await apiRequest(
        'POST',
        `/api/integrations/wise/verification/upload-document?profileId=${encodeURIComponent(profileFilter)}`,
        kycUploadDocument
      );
      return response.json();
    },
    onSuccess: () => {
      notify({ title: t('wise.kyc.documentUploaded') });
    },
    onError: (error) => {
      notify({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  const uploadKycAdditionalMutation = useMutation({
    mutationFn: async () => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const response = await apiRequest(
        'POST',
        `/api/integrations/wise/verification/upload-evidences?profileId=${encodeURIComponent(profileFilter)}`,
        kycUploadAdditional
      );
      return response.json();
    },
    onSuccess: () => {
      notify({ title: t('wise.kyc.additionalUploaded') });
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
    getKycRequiredEvidencesMutation,
    uploadKycDocumentMutation,
    uploadKycAdditionalMutation,
  };
}
