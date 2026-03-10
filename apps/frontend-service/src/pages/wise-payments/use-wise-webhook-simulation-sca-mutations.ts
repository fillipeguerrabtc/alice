import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import type {
  JsonParser,
  NotifyFn,
  WiseSimulationCard,
  WiseSimulationKyc,
  WiseSimulationTransfer,
} from './wise-webhook-simulation-sca-types';
import { useWiseScaMutations } from './use-wise-sca-mutations';
import { useWiseSimulationMutations } from './use-wise-simulation-mutations';
import { useWiseWebhookMutations } from './use-wise-webhook-mutations';

type UseWiseWebhookSimulationScaMutationsOptions = {
  notify: NotifyFn;
  parseJsonSafe: JsonParser;
  profileFilter: string;
  t: TFunction;
  webhookApplication: string;
  simulationOperation: string;
  simulationTransfer: WiseSimulationTransfer;
  simulationCard: WiseSimulationCard;
  simulationKyc: WiseSimulationKyc;
  simulationPayload: string;
  scaJosePayload: string;
  setWebhookResponse: Dispatch<SetStateAction<string | null>>;
  setSimulationResponse: Dispatch<SetStateAction<string | null>>;
  setScaResponse: Dispatch<SetStateAction<string | null>>;
};

export function useWiseWebhookSimulationScaMutations(
  options: UseWiseWebhookSimulationScaMutationsOptions
) {
  const {
    notify,
    parseJsonSafe,
    profileFilter,
    t,
    webhookApplication,
    simulationOperation,
    simulationTransfer,
    simulationCard,
    simulationKyc,
    simulationPayload,
    scaJosePayload,
    setWebhookResponse,
    setSimulationResponse,
    setScaResponse,
  } = options;

  const {
    listWebhooksMutation,
    createWebhookMutation,
    deleteWebhookMutation,
  } = useWiseWebhookMutations({
    notify,
    profileFilter,
    setWebhookResponse,
    t,
    webhookApplication,
  });

  const { runSimulationMutation } = useWiseSimulationMutations({
    notify,
    parseJsonSafe,
    profileFilter,
    setSimulationResponse,
    simulationCard,
    simulationKyc,
    simulationOperation,
    simulationPayload,
    simulationTransfer,
    t,
  });

  const { runScaMutation, runScaDeleteMutation } = useWiseScaMutations({
    notify,
    parseJsonSafe,
    profileFilter,
    scaJosePayload,
    setScaResponse,
    t,
  });

  return {
    listWebhooksMutation,
    createWebhookMutation,
    deleteWebhookMutation,
    runSimulationMutation,
    runScaMutation,
    runScaDeleteMutation,
  };
}
