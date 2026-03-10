import { useCallback } from 'react';
import type { TFunction } from 'i18next';
import type {
  NotifyFn,
  ParseJsonFn,
  WiseDisputeFlowForm,
  WiseDisputeStatusUpdate,
  WiseFilePayload,
} from './wise-account-card-dispute-types';

type MutationWithoutPayload = { mutate: () => void };
type MutationWithPayload<TPayload> = { mutate: (payload: TPayload) => void };

type UseWiseDisputeKycActionHandlersOptions = {
  disputeFlowForm: WiseDisputeFlowForm;
  disputeUpload: WiseFilePayload;
  disputeFlowStepMutation: MutationWithPayload<{
    body: Record<string, unknown>;
    reason: string;
    scheme: string;
    transactionId: string;
  }>;
  disputeFlowSubmitMutation: MutationWithPayload<{
    body: Record<string, unknown>;
    reason: string;
    scheme: string;
    transactionId: string;
  }>;
  disputeStatusUpdate: WiseDisputeStatusUpdate;
  getKycRequiredEvidencesMutation: MutationWithoutPayload;
  kycUploadAdditional: WiseFilePayload;
  kycUploadDocument: WiseFilePayload;
  notify: NotifyFn;
  parseJsonSafe: ParseJsonFn;
  t: TFunction;
  updateDisputeStatusMutation: MutationWithPayload<{ disputeId: string; status: string }>;
  uploadDisputeFileMutation: MutationWithoutPayload;
  uploadKycAdditionalMutation: MutationWithoutPayload;
  uploadKycDocumentMutation: MutationWithoutPayload;
};

export function useWiseDisputeKycActionHandlers(
  options: UseWiseDisputeKycActionHandlersOptions
) {
  const {
    disputeFlowForm,
    disputeFlowStepMutation,
    disputeFlowSubmitMutation,
    disputeStatusUpdate,
    disputeUpload,
    getKycRequiredEvidencesMutation,
    kycUploadAdditional,
    kycUploadDocument,
    notify,
    parseJsonSafe,
    t,
    updateDisputeStatusMutation,
    uploadDisputeFileMutation,
    uploadKycAdditionalMutation,
    uploadKycDocumentMutation,
  } = options;

  const handleUpdateDisputeStatus = useCallback(() => {
    if (!disputeStatusUpdate.disputeId.trim() || !disputeStatusUpdate.status.trim()) {
      notify({ title: t('wise.disputes.missingParams'), variant: 'destructive' });
      return;
    }
    updateDisputeStatusMutation.mutate({
      disputeId: disputeStatusUpdate.disputeId.trim(),
      status: disputeStatusUpdate.status.trim(),
    });
  }, [disputeStatusUpdate.disputeId, disputeStatusUpdate.status, notify, t, updateDisputeStatusMutation]);

  const handleDisputeFlowStep = useCallback(() => {
    if (!disputeFlowForm.scheme.trim() || !disputeFlowForm.reason.trim() || !disputeFlowForm.transactionId.trim()) {
      notify({ title: t('wise.disputes.flowMissing'), variant: 'destructive' });
      return;
    }
    const body = disputeFlowForm.payload.trim()
      ? parseJsonSafe(disputeFlowForm.payload, t('wise.disputes.invalidPayload'))
      : {};
    if (body === null) return;
    disputeFlowStepMutation.mutate({
      body,
      reason: disputeFlowForm.reason.trim(),
      scheme: disputeFlowForm.scheme.trim(),
      transactionId: disputeFlowForm.transactionId.trim(),
    });
  }, [disputeFlowForm.payload, disputeFlowForm.reason, disputeFlowForm.scheme, disputeFlowForm.transactionId, disputeFlowStepMutation, notify, parseJsonSafe, t]);

  const handleDisputeFlowSubmit = useCallback(() => {
    if (!disputeFlowForm.scheme.trim() || !disputeFlowForm.reason.trim() || !disputeFlowForm.transactionId.trim()) {
      notify({ title: t('wise.disputes.flowMissing'), variant: 'destructive' });
      return;
    }
    const body = disputeFlowForm.payload.trim()
      ? parseJsonSafe(disputeFlowForm.payload, t('wise.disputes.invalidPayload'))
      : {};
    if (body === null) return;
    disputeFlowSubmitMutation.mutate({
      body,
      reason: disputeFlowForm.reason.trim(),
      scheme: disputeFlowForm.scheme.trim(),
      transactionId: disputeFlowForm.transactionId.trim(),
    });
  }, [disputeFlowForm.payload, disputeFlowForm.reason, disputeFlowForm.scheme, disputeFlowForm.transactionId, disputeFlowSubmitMutation, notify, parseJsonSafe, t]);

  const handleDisputeFileUpload = useCallback(() => {
    if (!disputeUpload.fileBase64) {
      notify({ title: t('wise.disputes.missingFile'), variant: 'destructive' });
      return;
    }
    uploadDisputeFileMutation.mutate();
  }, [disputeUpload.fileBase64, notify, t, uploadDisputeFileMutation]);

  const handleUploadKycDocument = useCallback(() => {
    if (!kycUploadDocument.fileBase64) {
      notify({ title: t('wise.kyc.missingFile'), variant: 'destructive' });
      return;
    }
    uploadKycDocumentMutation.mutate();
  }, [kycUploadDocument.fileBase64, notify, t, uploadKycDocumentMutation]);

  const handleUploadKycAdditional = useCallback(() => {
    if (!kycUploadAdditional.fileBase64) {
      notify({ title: t('wise.kyc.missingFile'), variant: 'destructive' });
      return;
    }
    uploadKycAdditionalMutation.mutate();
  }, [kycUploadAdditional.fileBase64, notify, t, uploadKycAdditionalMutation]);

  const handleFetchKycEvidences = useCallback(() => {
    getKycRequiredEvidencesMutation.mutate();
  }, [getKycRequiredEvidencesMutation]);

  return {
    handleDisputeFileUpload,
    handleDisputeFlowStep,
    handleDisputeFlowSubmit,
    handleFetchKycEvidences,
    handleUpdateDisputeStatus,
    handleUploadKycAdditional,
    handleUploadKycDocument,
  };
}
