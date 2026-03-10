import { useState } from 'react';
import type {
  WiseDisputeFlowForm,
  WiseDisputeStatusUpdate,
} from './wise-account-card-dispute-types';

export function useWiseAccountCardDisputeState() {
  const [disputeStatusUpdate, setDisputeStatusUpdate] = useState<WiseDisputeStatusUpdate>({
    disputeId: '',
    status: '',
  });
  const [cardOrderId, setCardOrderId] = useState('');
  const [cardOrderPayload, setCardOrderPayload] = useState('');
  const [cardOrderStatusPayload, setCardOrderStatusPayload] = useState('');
  const [cardOrderValidationPayload, setCardOrderValidationPayload] = useState('');
  const [cardOrderPinPayload, setCardOrderPinPayload] = useState('');
  const [cardOrderAvailability, setCardOrderAvailability] = useState<string | null>(null);
  const [cardOrderDetails, setCardOrderDetails] = useState<string | null>(null);
  const [cardOrderRequirements, setCardOrderRequirements] = useState<string | null>(null);
  const [cardTransactionId, setCardTransactionId] = useState('');
  const [cardTransactionDetails, setCardTransactionDetails] = useState<string | null>(null);
  const [disputeFlowForm, setDisputeFlowForm] = useState<WiseDisputeFlowForm>({
    payload: '',
    reason: '',
    scheme: '',
    transactionId: '',
  });
  const [disputeFlowStepResult, setDisputeFlowStepResult] = useState<string | null>(null);
  const [disputeFlowSubmitResult, setDisputeFlowSubmitResult] = useState<string | null>(null);
  const [kycRequiredEvidences, setKycRequiredEvidences] = useState<string | null>(null);
  const [accountDetailsPayload, setAccountDetailsPayload] = useState('');
  const [accountDetailsResponse, setAccountDetailsResponse] = useState<string | null>(null);

  return {
    accountDetailsPayload,
    accountDetailsResponse,
    cardOrderAvailability,
    cardOrderDetails,
    cardOrderId,
    cardOrderPayload,
    cardOrderPinPayload,
    cardOrderRequirements,
    cardOrderStatusPayload,
    cardOrderValidationPayload,
    cardTransactionDetails,
    cardTransactionId,
    disputeFlowForm,
    disputeFlowStepResult,
    disputeFlowSubmitResult,
    disputeStatusUpdate,
    kycRequiredEvidences,
    setAccountDetailsPayload,
    setAccountDetailsResponse,
    setCardOrderAvailability,
    setCardOrderDetails,
    setCardOrderId,
    setCardOrderPayload,
    setCardOrderPinPayload,
    setCardOrderRequirements,
    setCardOrderStatusPayload,
    setCardOrderValidationPayload,
    setCardTransactionDetails,
    setCardTransactionId,
    setDisputeFlowForm,
    setDisputeFlowStepResult,
    setDisputeFlowSubmitResult,
    setDisputeStatusUpdate,
    setKycRequiredEvidences,
  };
}
