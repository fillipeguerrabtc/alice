import { useCallback, useState } from 'react';
import {
  INITIAL_WISE_SIMULATION_CARD,
  INITIAL_WISE_SIMULATION_KYC,
  INITIAL_WISE_SIMULATION_TRANSFER,
  type UseWiseWebhookSimulationScaActionsOptions,
  type UseWiseWebhookSimulationScaActionsResult,
} from './wise-webhook-simulation-sca-types';
import { useWiseWebhookSimulationScaMutations } from './use-wise-webhook-simulation-sca-mutations';

export type {
  WiseSimulationCard,
  WiseSimulationKyc,
  WiseSimulationTransfer,
} from './wise-webhook-simulation-sca-types';

export function useWiseWebhookSimulationScaActions(
  options: UseWiseWebhookSimulationScaActionsOptions
): UseWiseWebhookSimulationScaActionsResult {
  const { notify, parseJsonSafe, profileFilter, t } = options;

  const [webhookApplication, setWebhookApplication] = useState('false');
  const [webhookPayload, setWebhookPayload] = useState('');
  const [webhookDeleteId, setWebhookDeleteId] = useState('');
  const [webhookResponse, setWebhookResponse] = useState<string | null>(null);
  const [simulationOperation, setSimulationOperation] =
    useState('transferState');
  const [simulationTransfer, setSimulationTransfer] = useState(
    INITIAL_WISE_SIMULATION_TRANSFER
  );
  const [simulationCard, setSimulationCard] = useState(
    INITIAL_WISE_SIMULATION_CARD
  );
  const [simulationKyc, setSimulationKyc] = useState(
    INITIAL_WISE_SIMULATION_KYC
  );
  const [simulationPayload, setSimulationPayload] = useState('');
  const [simulationResponse, setSimulationResponse] = useState<string | null>(
    null
  );
  const [scaJosePayload, setScaJosePayload] = useState('');
  const [scaResponse, setScaResponse] = useState<string | null>(null);

  const {
    listWebhooksMutation,
    createWebhookMutation,
    deleteWebhookMutation,
    runSimulationMutation,
    runScaMutation,
    runScaDeleteMutation,
  } = useWiseWebhookSimulationScaMutations({
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
  });

  const handleListWebhooks = useCallback(() => {
    listWebhooksMutation.mutate();
  }, [listWebhooksMutation]);

  const handleCreateWebhook = useCallback(() => {
    if (!webhookPayload.trim()) {
      notify({ title: t('wise.webhooks.missingPayload'), variant: 'destructive' });
      return;
    }
    const body = parseJsonSafe(webhookPayload, t('wise.webhooks.invalidPayload'));
    if (!body) {
      return;
    }
    createWebhookMutation.mutate(body);
  }, [createWebhookMutation, notify, parseJsonSafe, t, webhookPayload]);

  const handleDeleteWebhook = useCallback(() => {
    if (!webhookDeleteId.trim()) {
      notify({ title: t('wise.webhooks.missingId'), variant: 'destructive' });
      return;
    }
    deleteWebhookMutation.mutate(webhookDeleteId.trim());
  }, [deleteWebhookMutation, notify, t, webhookDeleteId]);

  const handleRunSimulation = useCallback(() => {
    runSimulationMutation.mutate();
  }, [runSimulationMutation]);

  const handleRunSca = useCallback(
    (endpoint: string) => {
      runScaMutation.mutate(endpoint);
    },
    [runScaMutation]
  );

  const handleRunScaDelete = useCallback(
    (endpoint: string) => {
      runScaDeleteMutation.mutate(endpoint);
    },
    [runScaDeleteMutation]
  );

  return {
    handleCreateWebhook,
    handleDeleteWebhook,
    handleListWebhooks,
    handleRunSca,
    handleRunScaDelete,
    handleRunSimulation,
    isPendingCreateWebhook: createWebhookMutation.isPending,
    isPendingDeleteWebhook: deleteWebhookMutation.isPending,
    isPendingListWebhooks: listWebhooksMutation.isPending,
    isPendingRunSimulation: runSimulationMutation.isPending,
    scaJosePayload,
    scaResponse,
    setScaJosePayload,
    setSimulationCard,
    setSimulationKyc,
    setSimulationOperation,
    setSimulationPayload,
    setSimulationTransfer,
    setWebhookApplication,
    setWebhookDeleteId,
    setWebhookPayload,
    simulationCard,
    simulationKyc,
    simulationOperation,
    simulationPayload,
    simulationResponse,
    simulationTransfer,
    webhookApplication,
    webhookDeleteId,
    webhookPayload,
    webhookResponse,
  };
}
