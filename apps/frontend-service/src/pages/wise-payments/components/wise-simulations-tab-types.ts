import type { TFunction } from 'i18next';

export type WiseProfileOption = {
  id: number;
  type: string;
};

export type WiseSimulationTransfer = {
  transferId: string;
  action: string;
};

export type WiseSimulationCard = {
  cardToken: string;
  action: string;
};

export type WiseSimulationKyc = {
  kycReviewId: string;
};

export type WiseSimulationsTabContentProps = {
  isPendingRunSimulation: boolean;
  onRunSimulation: () => void;
  profileFilter: string;
  profiles: WiseProfileOption[];
  setProfileFilter: (value: string) => void;
  setSimulationCard: (updater: (prev: WiseSimulationCard) => WiseSimulationCard) => void;
  setSimulationKyc: (updater: (prev: WiseSimulationKyc) => WiseSimulationKyc) => void;
  setSimulationOperation: (value: string) => void;
  setSimulationPayload: (value: string) => void;
  setSimulationTransfer: (updater: (prev: WiseSimulationTransfer) => WiseSimulationTransfer) => void;
  simulationCard: WiseSimulationCard;
  simulationKyc: WiseSimulationKyc;
  simulationOperation: string;
  simulationPayload: string;
  simulationResponse: string | null;
  simulationTransfer: WiseSimulationTransfer;
  t: TFunction;
};
