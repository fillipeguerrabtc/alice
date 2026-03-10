import type { TFunction } from 'i18next';
import type {
  NotifyFn,
  WiseFilePayload,
} from './wise-account-card-dispute-types';
import { useWiseAccountCardDisputeFlowMutations } from './use-wise-account-card-dispute-flow-mutations';
import { useWiseAccountCardDisputeKycMutations } from './use-wise-account-card-dispute-kyc-mutations';

type UseWiseAccountCardDisputeDisputeKycMutationsOptions = {
  disputeUpload: WiseFilePayload;
  kycUploadAdditional: WiseFilePayload;
  kycUploadDocument: WiseFilePayload;
  notify: NotifyFn;
  profileFilter: string;
  setDisputeFlowStepResult: (value: string | null) => void;
  setDisputeFlowSubmitResult: (value: string | null) => void;
  setKycRequiredEvidences: (value: string | null) => void;
  t: TFunction;
};

export function useWiseAccountCardDisputeDisputeKycMutations(
  options: UseWiseAccountCardDisputeDisputeKycMutationsOptions
) {
  const {
    disputeUpload,
    kycUploadAdditional,
    kycUploadDocument,
    notify,
    profileFilter,
    setDisputeFlowStepResult,
    setDisputeFlowSubmitResult,
    setKycRequiredEvidences,
    t,
  } = options;

  const disputeFlowMutations = useWiseAccountCardDisputeFlowMutations({
    disputeUpload,
    notify,
    profileFilter,
    setDisputeFlowStepResult,
    setDisputeFlowSubmitResult,
    t,
  });

  const kycMutations = useWiseAccountCardDisputeKycMutations({
    kycUploadAdditional,
    kycUploadDocument,
    notify,
    profileFilter,
    setKycRequiredEvidences,
    t,
  });

  return {
    ...disputeFlowMutations,
    ...kycMutations,
  };
}
