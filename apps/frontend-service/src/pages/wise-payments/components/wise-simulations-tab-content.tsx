import { TabsContent } from '@/components/ui/tabs';
import { WiseSimulationsOperationCard } from './wise-simulations-operation-card';
import type { WiseSimulationsTabContentProps } from './wise-simulations-tab-types';
import { WiseSimulationsToolbar } from './wise-simulations-toolbar';

export function WiseSimulationsTabContent({
  isPendingRunSimulation,
  onRunSimulation,
  profileFilter,
  profiles,
  setProfileFilter,
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
}: WiseSimulationsTabContentProps) {
  return (
    <TabsContent value="simulations" className="space-y-4 mt-6">
      <WiseSimulationsToolbar
        profileFilter={profileFilter}
        profiles={profiles}
        setProfileFilter={setProfileFilter}
        t={t}
      />

      <WiseSimulationsOperationCard
        isPendingRunSimulation={isPendingRunSimulation}
        onRunSimulation={onRunSimulation}
        setSimulationCard={setSimulationCard}
        setSimulationKyc={setSimulationKyc}
        setSimulationOperation={setSimulationOperation}
        setSimulationPayload={setSimulationPayload}
        setSimulationTransfer={setSimulationTransfer}
        simulationCard={simulationCard}
        simulationKyc={simulationKyc}
        simulationOperation={simulationOperation}
        simulationPayload={simulationPayload}
        simulationResponse={simulationResponse}
        simulationTransfer={simulationTransfer}
        t={t}
      />
    </TabsContent>
  );
}
