import type { TFunction } from 'i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  WiseSimulationCard,
  WiseSimulationKyc,
  WiseSimulationTransfer,
} from './wise-simulations-tab-types';

type WiseSimulationsOperationFieldsProps = {
  setSimulationCard: (updater: (prev: WiseSimulationCard) => WiseSimulationCard) => void;
  setSimulationKyc: (updater: (prev: WiseSimulationKyc) => WiseSimulationKyc) => void;
  setSimulationTransfer: (updater: (prev: WiseSimulationTransfer) => WiseSimulationTransfer) => void;
  simulationCard: WiseSimulationCard;
  simulationKyc: WiseSimulationKyc;
  simulationTransfer: WiseSimulationTransfer;
  t: TFunction;
};

export function WiseSimulationsOperationFields({
  setSimulationCard,
  setSimulationKyc,
  setSimulationTransfer,
  simulationCard,
  simulationKyc,
  simulationTransfer,
  t,
}: WiseSimulationsOperationFieldsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label>{t('wise.simulations.transferId')}</Label>
        <Input
          value={simulationTransfer.transferId}
          onChange={(event) => setSimulationTransfer((prev) => ({ ...prev, transferId: event.target.value }))}
          data-testid="input-sim-transfer-id"
        />
      </div>
      <div className="space-y-2">
        <Label>{t('wise.simulations.transferAction')}</Label>
        <Input
          value={simulationTransfer.action}
          onChange={(event) => setSimulationTransfer((prev) => ({ ...prev, action: event.target.value }))}
          data-testid="input-sim-transfer-action"
        />
      </div>
      <div className="space-y-2">
        <Label>{t('wise.simulations.cardToken')}</Label>
        <Input
          value={simulationCard.cardToken}
          onChange={(event) => setSimulationCard((prev) => ({ ...prev, cardToken: event.target.value }))}
          data-testid="input-sim-card-token"
        />
      </div>
      <div className="space-y-2">
        <Label>{t('wise.simulations.cardAction')}</Label>
        <Input
          value={simulationCard.action}
          onChange={(event) => setSimulationCard((prev) => ({ ...prev, action: event.target.value }))}
          data-testid="input-sim-card-action"
        />
      </div>
      <div className="space-y-2">
        <Label>{t('wise.simulations.kycReviewId')}</Label>
        <Input
          value={simulationKyc.kycReviewId}
          onChange={(event) => setSimulationKyc((prev) => ({ ...prev, kycReviewId: event.target.value }))}
          data-testid="input-sim-kyc-id"
        />
      </div>
    </div>
  );
}
