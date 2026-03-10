import { TabsContent } from '@/components/ui/tabs';
import { WiseScaPayloadCard } from './wise-sca-payload-card';
import type { WiseScaTabContentProps } from './wise-sca-tab-types';
import { WiseScaToolbar } from './wise-sca-toolbar';

export function WiseScaTabContent({
  onRunSca,
  onRunScaDelete,
  profileFilter,
  profiles,
  scaJosePayload,
  scaResponse,
  setProfileFilter,
  setScaJosePayload,
  t,
}: WiseScaTabContentProps) {
  return (
    <TabsContent value="sca" className="space-y-4 mt-6">
      <WiseScaToolbar
        profileFilter={profileFilter}
        profiles={profiles}
        setProfileFilter={setProfileFilter}
        t={t}
      />

      <WiseScaPayloadCard
        onRunSca={onRunSca}
        onRunScaDelete={onRunScaDelete}
        scaJosePayload={scaJosePayload}
        scaResponse={scaResponse}
        setScaJosePayload={setScaJosePayload}
        t={t}
      />
    </TabsContent>
  );
}
