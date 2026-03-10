import type { TFunction } from 'i18next';

export type WiseProfileOption = {
  id: number;
  type: string;
};

export type WiseDispute = {
  id?: string;
  status?: string;
  reason?: string;
  scheme?: string;
  created?: string;
};

export type WiseDisputeFlowForm = {
  scheme: string;
  reason: string;
  transactionId: string;
  payload: string;
};

export type WiseDisputeStatusUpdate = {
  disputeId: string;
  status: string;
};

export type WiseDisputesTabContentProps = {
  disputeFlowForm: WiseDisputeFlowForm;
  disputeFlowStepResult: string | null;
  disputeFlowSubmitResult: string | null;
  disputeReasonsData: unknown;
  disputeStatusUpdate: WiseDisputeStatusUpdate;
  disputes: WiseDispute[];
  formatDate: (value: string, options?: { locale?: string; timeZone?: string }) => string;
  isLoadingDisputeReasons: boolean;
  isLoadingDisputes: boolean;
  isPendingDisputeFlowStep: boolean;
  isPendingDisputeFlowSubmit: boolean;
  isPendingDisputeFileUpload: boolean;
  isPendingDisputeStatusUpdate: boolean;
  locale: string;
  onDisputeFileChange: (file: File | null) => void;
  onDisputeFileUpload: () => void;
  onDisputeFlowStep: () => void;
  onDisputeFlowSubmit: () => void;
  onRefreshDisputes: () => void;
  onUpdateDisputeStatus: () => void;
  profileFilter: string;
  profiles: WiseProfileOption[];
  setDisputeFlowForm: (updater: (prev: WiseDisputeFlowForm) => WiseDisputeFlowForm) => void;
  setDisputeStatusUpdate: (updater: (prev: WiseDisputeStatusUpdate) => WiseDisputeStatusUpdate) => void;
  setProfileFilter: (value: string) => void;
  t: TFunction;
  timeZone: string;
};
