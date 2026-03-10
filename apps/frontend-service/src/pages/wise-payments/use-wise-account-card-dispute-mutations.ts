import type { TFunction } from 'i18next';
import type { NotifyFn, WiseFilePayload } from './wise-account-card-dispute-types';
import { useWiseAccountCardDisputeCardOrderMutations } from './use-wise-account-card-dispute-card-order-mutations';
import { useWiseAccountCardDisputeDisputeKycMutations } from './use-wise-account-card-dispute-dispute-kyc-mutations';

type UseWiseAccountCardDisputeMutationsOptions = {
  disputeUpload: WiseFilePayload;
  kycUploadAdditional: WiseFilePayload;
  kycUploadDocument: WiseFilePayload;
  notify: NotifyFn;
  profileFilter: string;
  setAccountDetailsResponse: (value: string | null) => void;
  setCardOrderAvailability: (value: string | null) => void;
  setCardOrderDetails: (value: string | null) => void;
  setCardOrderRequirements: (value: string | null) => void;
  setCardTransactionDetails: (value: string | null) => void;
  setDisputeFlowStepResult: (value: string | null) => void;
  setDisputeFlowSubmitResult: (value: string | null) => void;
  setKycRequiredEvidences: (value: string | null) => void;
  t: TFunction;
};

export function useWiseAccountCardDisputeMutations(
  options: UseWiseAccountCardDisputeMutationsOptions
) {
  const {
    disputeUpload,
    kycUploadAdditional,
    kycUploadDocument,
    notify,
    profileFilter,
    setAccountDetailsResponse,
    setCardOrderAvailability,
    setCardOrderDetails,
    setCardOrderRequirements,
    setCardTransactionDetails,
    setDisputeFlowStepResult,
    setDisputeFlowSubmitResult,
    setKycRequiredEvidences,
    t,
  } = options;

  const cardOrderMutations = useWiseAccountCardDisputeCardOrderMutations({
    notify,
    profileFilter,
    setAccountDetailsResponse,
    setCardOrderAvailability,
    setCardOrderDetails,
    setCardOrderRequirements,
    setCardTransactionDetails,
    t,
  });

  const disputeKycMutations = useWiseAccountCardDisputeDisputeKycMutations({
    disputeUpload,
    kycUploadAdditional,
    kycUploadDocument,
    notify,
    profileFilter,
    setDisputeFlowStepResult,
    setDisputeFlowSubmitResult,
    setKycRequiredEvidences,
    t,
  });

  return {
    ...cardOrderMutations,
    ...disputeKycMutations,
  };
}
