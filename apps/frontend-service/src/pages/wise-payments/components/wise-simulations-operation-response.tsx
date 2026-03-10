import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

type WiseSimulationsOperationResponseProps = {
  isPendingRunSimulation: boolean;
  onRunSimulation: () => void;
  simulationResponse: string | null;
  t: TFunction;
};

export function WiseSimulationsOperationResponse({
  isPendingRunSimulation,
  onRunSimulation,
  simulationResponse,
  t,
}: WiseSimulationsOperationResponseProps) {
  return (
    <>
      <Button onClick={onRunSimulation} disabled={isPendingRunSimulation} data-testid="button-run-simulation">
        {t('wise.simulations.run')}
      </Button>

      <div className="space-y-2">
        <Label>{t('wise.simulations.response')}</Label>
        <pre className="max-h-80 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
          {simulationResponse ?? t('wise.simulations.responseEmpty')}
        </pre>
      </div>
    </>
  );
}
