import { useMutation } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { apiRequest } from '@/lib/queryClient';
import type {
  JsonParser,
  NotifyFn,
  WiseSimulationCard,
  WiseSimulationKyc,
  WiseSimulationTransfer,
} from './wise-webhook-simulation-sca-types';

type UseWiseSimulationMutationsOptions = {
  notify: NotifyFn;
  parseJsonSafe: JsonParser;
  profileFilter: string;
  setSimulationResponse: Dispatch<SetStateAction<string | null>>;
  simulationCard: WiseSimulationCard;
  simulationKyc: WiseSimulationKyc;
  simulationOperation: string;
  simulationPayload: string;
  simulationTransfer: WiseSimulationTransfer;
  t: TFunction;
};

export function useWiseSimulationMutations(
  options: UseWiseSimulationMutationsOptions
) {
  const {
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
  } = options;

  const runSimulationMutation = useMutation({
    mutationFn: async () => {
      if (!profileFilter) {
        throw new Error(t('wise.catalog.errors.missingProfileId'));
      }
      const payload = simulationPayload.trim()
        ? parseJsonSafe(simulationPayload, t('wise.simulations.invalidPayload'))
        : {};
      if (payload === null) {
        throw new Error(t('wise.simulations.invalidPayload'));
      }

      switch (simulationOperation) {
        case 'transferState': {
          if (!simulationTransfer.transferId || !simulationTransfer.action) {
            throw new Error(t('wise.simulations.missingTransfer'));
          }
          const response = await apiRequest(
            'POST',
            `/api/integrations/wise/simulation/transfers/${encodeURIComponent(simulationTransfer.transferId)}/${encodeURIComponent(simulationTransfer.action)}`,
            payload
          );
          return response.json();
        }
        case 'profileVerification': {
          const response = await apiRequest(
            'POST',
            `/api/integrations/wise/simulation/profiles/${encodeURIComponent(profileFilter)}/verifications`,
            payload
          );
          return response.json();
        }
        case 'balanceTopup': {
          const response = await apiRequest(
            'POST',
            `/api/integrations/wise/simulation/balance/topup?profileId=${encodeURIComponent(profileFilter)}`,
            payload
          );
          return response.json();
        }
        case 'cardTransaction': {
          if (!simulationCard.cardToken || !simulationCard.action) {
            throw new Error(t('wise.simulations.missingCard'));
          }
          const response = await apiRequest(
            'POST',
            `/api/integrations/wise/simulation/spend/profiles/${encodeURIComponent(profileFilter)}/cards/${encodeURIComponent(simulationCard.cardToken)}/transactions/${encodeURIComponent(simulationCard.action)}`,
            payload
          );
          return response.json();
        }
        case 'cardAuthorisation': {
          if (!simulationCard.cardToken) {
            throw new Error(t('wise.simulations.missingCard'));
          }
          const response = await apiRequest(
            'POST',
            `/api/integrations/wise/simulation/spend/profiles/${encodeURIComponent(profileFilter)}/cards/${encodeURIComponent(simulationCard.cardToken)}/transactions/authorisation`,
            payload
          );
          return response.json();
        }
        case 'cardRefund': {
          if (!simulationCard.cardToken) {
            throw new Error(t('wise.simulations.missingCard'));
          }
          const response = await apiRequest(
            'POST',
            `/api/integrations/wise/simulation/spend/profiles/${encodeURIComponent(profileFilter)}/cards/${encodeURIComponent(simulationCard.cardToken)}/transactions/refund`,
            payload
          );
          return response.json();
        }
        case 'cardProduction': {
          if (!simulationCard.cardToken) {
            throw new Error(t('wise.simulations.missingCard'));
          }
          const response = await apiRequest(
            'POST',
            `/api/integrations/wise/simulation/spend/profiles/${encodeURIComponent(profileFilter)}/cards/${encodeURIComponent(simulationCard.cardToken)}/production`,
            payload
          );
          return response.json();
        }
        case 'cardRecent': {
          if (!simulationCard.cardToken) {
            throw new Error(t('wise.simulations.missingCard'));
          }
          const response = await apiRequest(
            'GET',
            `/api/integrations/wise/simulation/spend/profiles/${encodeURIComponent(profileFilter)}/cards/${encodeURIComponent(simulationCard.cardToken)}/transactions`
          );
          return response.json();
        }
        case 'kycRequirements': {
          if (!simulationKyc.kycReviewId) {
            throw new Error(t('wise.simulations.missingKyc'));
          }
          const response = await apiRequest(
            'GET',
            `/api/integrations/wise/simulation/profiles/${encodeURIComponent(profileFilter)}/kyc-reviews/${encodeURIComponent(simulationKyc.kycReviewId)}/requirements`
          );
          return response.json();
        }
        case 'bankImport': {
          const response = await apiRequest(
            'POST',
            `/api/integrations/wise/simulation/profiles/${encodeURIComponent(profileFilter)}/bank-transactions/import`,
            payload
          );
          return response.json();
        }
        default:
          throw new Error(t('wise.simulations.missingOperation'));
      }
    },
    onSuccess: (data) => {
      setSimulationResponse(JSON.stringify(data, null, 2));
    },
    onError: (error) => {
      setSimulationResponse(null);
      notify({
        title: t('wise.errors.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    },
  });

  return { runSimulationMutation };
}
