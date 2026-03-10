import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { WiseSimulationsOperationFields } from './wise-simulations-operation-fields';
import { WiseSimulationsOperationSelect } from './wise-simulations-operation-select';
import type { WiseSimulationsTabContentProps } from './wise-simulations-tab-types';

type WiseSimulationsOperationCardProps = Pick<
  WiseSimulationsTabContentProps,
  | 'isPendingRunSimulation'
  | 'onRunSimulation'
  | 'setSimulationCard'
  | 'setSimulationKyc'
  | 'setSimulationOperation'
  | 'setSimulationPayload'
  | 'setSimulationTransfer'
  | 'simulationCard'
  | 'simulationKyc'
  | 'simulationOperation'
  | 'simulationPayload'
  | 'simulationResponse'
  | 'simulationTransfer'
  | 't'
>;

export function WiseSimulationsOperationCard({
  isPendingRunSimulation,
  onRunSimulation,
  setSimulationCard,
  setSimulationKyc,
  setSimulationOperation,
  setSimulationPayload,
  setSimulationTransfer,
  simulationCard,
  simulationKyc,
  simulationOperation,
  simulationPayload,
  simulationResponse,
  simulationTransfer,
  t,
}: WiseSimulationsOperationCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.simulations.operationTitle')}</CardTitle>
        <CardDescription>{t('wise.simulations.operationSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <WiseSimulationsOperationSelect
          setSimulationOperation={setSimulationOperation}
          simulationOperation={simulationOperation}
          t={t}
        />

        <WiseSimulationsOperationFields
          setSimulationCard={setSimulationCard}
          setSimulationKyc={setSimulationKyc}
          setSimulationTransfer={setSimulationTransfer}
          simulationCard={simulationCard}
          simulationKyc={simulationKyc}
          simulationTransfer={simulationTransfer}
          t={t}
        />

        <div className="space-y-2">
          <Label>{t('wise.simulations.payload')}</Label>
          <Textarea
            value={simulationPayload}
            onChange={(event) => setSimulationPayload(event.target.value)}
            rows={4}
            placeholder="{ }"
            data-testid="textarea-sim-payload"
          />
        </div>

        <Button onClick={onRunSimulation} disabled={isPendingRunSimulation} data-testid="button-run-simulation">
          {t('wise.simulations.run')}
        </Button>

        <div className="space-y-2">
          <Label>{t('wise.simulations.response')}</Label>
          <pre className="max-h-80 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
            {simulationResponse ?? t('wise.simulations.responseEmpty')}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
