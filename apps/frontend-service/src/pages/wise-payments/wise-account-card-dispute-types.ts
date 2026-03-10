import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';

export type NotifyFn = (params: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

export type ParseJsonFn = (raw: string, errorTitle: string) => Record<string, unknown> | null;

export type WiseFilePayload = {
  contentType: string;
  fileBase64: string;
  fileName: string;
};

export type WiseDisputeStatusUpdate = {
  disputeId: string;
  status: string;
};

export type WiseDisputeFlowForm = {
  payload: string;
  reason: string;
  scheme: string;
  transactionId: string;
};

export type UseWiseAccountCardDisputeActionsOptions = {
  disputeUpload: WiseFilePayload;
  kycUploadAdditional: WiseFilePayload;
  kycUploadDocument: WiseFilePayload;
  notify: NotifyFn;
  parseJsonSafe: ParseJsonFn;
  profileFilter: string;
  t: TFunction;
};

export type UseWiseAccountCardDisputeActionsResult = {
  accountDetailsPayload: string;
  accountDetailsResponse: string | null;
  cardOrderAvailability: string | null;
  cardOrderDetails: string | null;
  cardOrderId: string;
  cardOrderPayload: string;
  cardOrderPinPayload: string;
  cardOrderRequirements: string | null;
  cardOrderStatusPayload: string;
  cardOrderValidationPayload: string;
  cardTransactionDetails: string | null;
  cardTransactionId: string;
  disputeFlowForm: WiseDisputeFlowForm;
  disputeFlowStepResult: string | null;
  disputeFlowSubmitResult: string | null;
  disputeStatusUpdate: WiseDisputeStatusUpdate;
  handleCreateAccountDetailsOrder: () => void;
  handleCreateCardOrder: () => void;
  handleDisputeFlowStep: () => void;
  handleDisputeFlowSubmit: () => void;
  handleDisputeFileUpload: () => void;
  handleFetchCardOrderAvailability: () => void;
  handleFetchCardOrderDetails: () => void;
  handleFetchCardOrderRequirements: () => void;
  handleFetchCardTransaction: () => void;
  handleFetchKycEvidences: () => void;
  handlePresetCardOrderPin: () => void;
  handleUpdateCardOrderStatus: () => void;
  handleUpdateDisputeStatus: () => void;
  handleUploadKycAdditional: () => void;
  handleUploadKycDocument: () => void;
  handleValidateCardOrderAddress: () => void;
  isPendingCardOrderAvailability: boolean;
  isPendingCardOrderCreate: boolean;
  isPendingCardOrderPin: boolean;
  isPendingCardOrderStatusUpdate: boolean;
  isPendingCardOrderValidateAddress: boolean;
  isPendingCardTransactionFetch: boolean;
  isPendingCreateAccountDetailsOrder: boolean;
  isPendingDisputeFileUpload: boolean;
  isPendingDisputeFlowStep: boolean;
  isPendingDisputeFlowSubmit: boolean;
  isPendingDisputeStatusUpdate: boolean;
  isPendingFetchKycEvidences: boolean;
  isPendingUploadKycAdditional: boolean;
  isPendingUploadKycDocument: boolean;
  kycRequiredEvidences: string | null;
  setAccountDetailsPayload: (value: string) => void;
  setCardOrderId: (value: string) => void;
  setCardOrderPayload: (value: string) => void;
  setCardOrderPinPayload: (value: string) => void;
  setCardOrderStatusPayload: (value: string) => void;
  setCardOrderValidationPayload: (value: string) => void;
  setCardTransactionId: (value: string) => void;
  setDisputeFlowForm: Dispatch<SetStateAction<WiseDisputeFlowForm>>;
  setDisputeStatusUpdate: Dispatch<SetStateAction<WiseDisputeStatusUpdate>>;
};
