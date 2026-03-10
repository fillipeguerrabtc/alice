import type { TFunction } from 'i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type WiseSimulationsOperationSelectProps = {
  setSimulationOperation: (value: string) => void;
  simulationOperation: string;
  t: TFunction;
};

type WiseSimulationOperationOption = {
  labelKey: string;
  value: string;
};

const SIMULATION_OPERATION_OPTIONS: WiseSimulationOperationOption[] = [
  { value: 'transferState', labelKey: 'wise.simulations.transferState' },
  { value: 'profileVerification', labelKey: 'wise.simulations.profileVerification' },
  { value: 'balanceTopup', labelKey: 'wise.simulations.balanceTopup' },
  { value: 'cardTransaction', labelKey: 'wise.simulations.cardTransaction' },
  { value: 'cardAuthorisation', labelKey: 'wise.simulations.cardAuthorisation' },
  { value: 'cardRefund', labelKey: 'wise.simulations.cardRefund' },
  { value: 'cardProduction', labelKey: 'wise.simulations.cardProduction' },
  { value: 'cardRecent', labelKey: 'wise.simulations.cardRecent' },
  { value: 'kycRequirements', labelKey: 'wise.simulations.kycRequirements' },
  { value: 'bankImport', labelKey: 'wise.simulations.bankImport' },
];

export function WiseSimulationsOperationSelect({
  setSimulationOperation,
  simulationOperation,
  t,
}: WiseSimulationsOperationSelectProps) {
  return (
    <Select value={simulationOperation} onValueChange={setSimulationOperation}>
      <SelectTrigger data-testid="select-simulations-operation">
        <SelectValue placeholder={t('wise.simulations.operation')} />
      </SelectTrigger>
      <SelectContent>
        {SIMULATION_OPERATION_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {t(option.labelKey)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
