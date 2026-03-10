import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';

export type NotifyFn = (params: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

export type JsonParser = (
  raw: string,
  errorTitle: string
) => Record<string, unknown> | null;

export type WiseSimulationTransfer = {
  action: string;
  transferId: string;
};

export type WiseSimulationCard = {
  action: string;
  cardToken: string;
};

export type WiseSimulationKyc = {
  kycReviewId: string;
};

export type UseWiseWebhookSimulationScaActionsOptions = {
  notify: NotifyFn;
  parseJsonSafe: JsonParser;
  profileFilter: string;
  t: TFunction;
};

export type UseWiseWebhookSimulationScaActionsResult = {
  handleCreateWebhook: () => void;
  handleDeleteWebhook: () => void;
  handleListWebhooks: () => void;
  handleRunSca: (endpoint: string) => void;
  handleRunScaDelete: (endpoint: string) => void;
  handleRunSimulation: () => void;
  isPendingCreateWebhook: boolean;
  isPendingDeleteWebhook: boolean;
  isPendingListWebhooks: boolean;
  isPendingRunSimulation: boolean;
  scaJosePayload: string;
  scaResponse: string | null;
  setScaJosePayload: (value: string) => void;
  setSimulationCard: Dispatch<SetStateAction<WiseSimulationCard>>;
  setSimulationKyc: Dispatch<SetStateAction<WiseSimulationKyc>>;
  setSimulationOperation: (value: string) => void;
  setSimulationPayload: (value: string) => void;
  setSimulationTransfer: Dispatch<SetStateAction<WiseSimulationTransfer>>;
  setWebhookApplication: (value: string) => void;
  setWebhookDeleteId: (value: string) => void;
  setWebhookPayload: (value: string) => void;
  simulationCard: WiseSimulationCard;
  simulationKyc: WiseSimulationKyc;
  simulationOperation: string;
  simulationPayload: string;
  simulationResponse: string | null;
  simulationTransfer: WiseSimulationTransfer;
  webhookApplication: string;
  webhookDeleteId: string;
  webhookPayload: string;
  webhookResponse: string | null;
};

export const INITIAL_WISE_SIMULATION_TRANSFER: WiseSimulationTransfer = {
  action: '',
  transferId: '',
};

export const INITIAL_WISE_SIMULATION_CARD: WiseSimulationCard = {
  action: '',
  cardToken: '',
};

export const INITIAL_WISE_SIMULATION_KYC: WiseSimulationKyc = {
  kycReviewId: '',
};
