import { formatDate } from '@/lib/utils';
import type {
  BuildWiseProfileTabsPropsOptions,
  WiseProfileComplianceTabsProps,
} from './wise-profile-tabs-props-types';

export function buildWiseProfileComplianceTabsProps({
  accountCardDisputeActions,
  dataQueries,
  derivedData,
  fileUploadState,
  locale,
  profileScopedTabProps,
  refreshActions,
  t,
  timeZone,
  webhookSimulationScaActions,
}: BuildWiseProfileTabsPropsOptions): WiseProfileComplianceTabsProps {
  const disputesTabProps = {
    ...profileScopedTabProps,
    disputeFlowForm: accountCardDisputeActions.disputeFlowForm,
    disputeFlowStepResult: accountCardDisputeActions.disputeFlowStepResult,
    disputeFlowSubmitResult: accountCardDisputeActions.disputeFlowSubmitResult,
    disputeReasonsData: dataQueries.disputeReasonsData,
    disputeStatusUpdate: accountCardDisputeActions.disputeStatusUpdate,
    disputes: derivedData.disputes,
    formatDate,
    isLoadingDisputeReasons: dataQueries.isLoadingDisputeReasons,
    isLoadingDisputes: dataQueries.isLoadingDisputes,
    isPendingDisputeFileUpload: accountCardDisputeActions.isPendingDisputeFileUpload,
    isPendingDisputeFlowStep: accountCardDisputeActions.isPendingDisputeFlowStep,
    isPendingDisputeFlowSubmit: accountCardDisputeActions.isPendingDisputeFlowSubmit,
    isPendingDisputeStatusUpdate: accountCardDisputeActions.isPendingDisputeStatusUpdate,
    locale,
    onDisputeFileChange: fileUploadState.handleDisputeFileChange,
    onDisputeFileUpload: accountCardDisputeActions.handleDisputeFileUpload,
    onDisputeFlowStep: accountCardDisputeActions.handleDisputeFlowStep,
    onDisputeFlowSubmit: accountCardDisputeActions.handleDisputeFlowSubmit,
    onRefreshDisputes: refreshActions.handleRefreshDisputes,
    onUpdateDisputeStatus: accountCardDisputeActions.handleUpdateDisputeStatus,
    setDisputeFlowForm: accountCardDisputeActions.setDisputeFlowForm,
    setDisputeStatusUpdate: accountCardDisputeActions.setDisputeStatusUpdate,
    t,
    timeZone,
  };

  const kycTabProps = {
    ...profileScopedTabProps,
    formatDate,
    isLoadingKycReviews: dataQueries.isLoadingKycReviews,
    isPendingFetchKycEvidences: accountCardDisputeActions.isPendingFetchKycEvidences,
    isPendingUploadKycAdditional: accountCardDisputeActions.isPendingUploadKycAdditional,
    isPendingUploadKycDocument: accountCardDisputeActions.isPendingUploadKycDocument,
    kycRequiredEvidences: accountCardDisputeActions.kycRequiredEvidences,
    kycReviews: derivedData.kycReviews,
    locale,
    onFetchKycEvidences: accountCardDisputeActions.handleFetchKycEvidences,
    onKycDocumentChange: fileUploadState.handleKycDocumentChange,
    onRefreshKycReviews: refreshActions.handleRefreshKycReviews,
    onUploadKycAdditional: accountCardDisputeActions.handleUploadKycAdditional,
    onUploadKycDocument: accountCardDisputeActions.handleUploadKycDocument,
    t,
    timeZone,
  };

  const webhooksTabProps = {
    ...profileScopedTabProps,
    isPendingCreateWebhook: webhookSimulationScaActions.isPendingCreateWebhook,
    isPendingDeleteWebhook: webhookSimulationScaActions.isPendingDeleteWebhook,
    isPendingListWebhooks: webhookSimulationScaActions.isPendingListWebhooks,
    onCreateWebhook: webhookSimulationScaActions.handleCreateWebhook,
    onDeleteWebhook: webhookSimulationScaActions.handleDeleteWebhook,
    onListWebhooks: webhookSimulationScaActions.handleListWebhooks,
    setWebhookApplication: webhookSimulationScaActions.setWebhookApplication,
    setWebhookDeleteId: webhookSimulationScaActions.setWebhookDeleteId,
    setWebhookPayload: webhookSimulationScaActions.setWebhookPayload,
    t,
    webhookApplication: webhookSimulationScaActions.webhookApplication,
    webhookDeleteId: webhookSimulationScaActions.webhookDeleteId,
    webhookPayload: webhookSimulationScaActions.webhookPayload,
    webhookResponse: webhookSimulationScaActions.webhookResponse,
  };

  const simulationsTabProps = {
    ...profileScopedTabProps,
    isPendingRunSimulation: webhookSimulationScaActions.isPendingRunSimulation,
    onRunSimulation: webhookSimulationScaActions.handleRunSimulation,
    setSimulationCard: webhookSimulationScaActions.setSimulationCard,
    setSimulationKyc: webhookSimulationScaActions.setSimulationKyc,
    setSimulationOperation: webhookSimulationScaActions.setSimulationOperation,
    setSimulationPayload: webhookSimulationScaActions.setSimulationPayload,
    setSimulationTransfer: webhookSimulationScaActions.setSimulationTransfer,
    simulationCard: webhookSimulationScaActions.simulationCard,
    simulationKyc: webhookSimulationScaActions.simulationKyc,
    simulationOperation: webhookSimulationScaActions.simulationOperation,
    simulationPayload: webhookSimulationScaActions.simulationPayload,
    simulationResponse: webhookSimulationScaActions.simulationResponse,
    simulationTransfer: webhookSimulationScaActions.simulationTransfer,
    t,
  };

  const scaTabProps = {
    ...profileScopedTabProps,
    onRunSca: webhookSimulationScaActions.handleRunSca,
    onRunScaDelete: webhookSimulationScaActions.handleRunScaDelete,
    scaJosePayload: webhookSimulationScaActions.scaJosePayload,
    scaResponse: webhookSimulationScaActions.scaResponse,
    setScaJosePayload: webhookSimulationScaActions.setScaJosePayload,
    t,
  };

  return {
    disputesTabProps,
    kycTabProps,
    scaTabProps,
    simulationsTabProps,
    webhooksTabProps,
  };
}
