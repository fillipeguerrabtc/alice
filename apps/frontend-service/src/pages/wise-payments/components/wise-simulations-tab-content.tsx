import { CardDescription } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TabsContent } from '@/components/ui/tabs';
import { WiseSimulationsOperationCard } from './wise-simulations-operation-card';
import type { WiseSimulationsTabContentProps } from './wise-simulations-tab-types';

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardDescription>{t('wise.simulations.subtitle')}</CardDescription>
        <Select value={profileFilter} onValueChange={setProfileFilter}>
          <SelectTrigger className="min-w-[200px]" data-testid="select-simulations-profile">
            <SelectValue placeholder={t('wise.catalog.profileId')} />
          </SelectTrigger>
          <SelectContent>
            {profiles.map((profile) => (
              <SelectItem key={profile.id} value={String(profile.id)}>
                {profile.id} • {profile.type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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
