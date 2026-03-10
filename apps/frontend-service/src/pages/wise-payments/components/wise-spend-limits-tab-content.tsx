import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';
import { WiseSpendLimitsFetchControls } from './wise-spend-limits-fetch-controls';
import { WiseSpendLimitsResponsePanels } from './wise-spend-limits-response-panels';
import type { WiseSpendLimitsTabContentProps } from './wise-spend-limits-tab-types';
import { WiseSpendLimitsUpdatePanels } from './wise-spend-limits-update-panels';

export function WiseSpendLimitsTabContent({
  isPendingDeleteSpendLimitsCard,
  isPendingUpdateSpendLimitsCard,
  isPendingUpdateSpendLimitsProfile,
  onDeleteSpendLimitsCard,
  onFetchSpendLimitsCard,
  onFetchSpendLimitsProfile,
  onUpdateSpendLimitsCard,
  onUpdateSpendLimitsProfile,
  setSpendLimitsCardPayload,
  setSpendLimitsCardToken,
  setSpendLimitsDeleteCardToken,
  setSpendLimitsPayload,
  setSpendLimitsProfileId,
  spendLimitsCardPayload,
  spendLimitsCardResult,
  spendLimitsCardToken,
  spendLimitsDeleteCardToken,
  spendLimitsPayload,
  spendLimitsProfileId,
  spendLimitsProfileResult,
  t,
}: WiseSpendLimitsTabContentProps) {
  return (
    <TabsContent value="spend-limits" className="space-y-4 mt-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('wise.spendLimits.title')}</CardTitle>
          <CardDescription>{t('wise.spendLimits.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <WiseSpendLimitsFetchControls
            onFetchSpendLimitsCard={onFetchSpendLimitsCard}
            onFetchSpendLimitsProfile={onFetchSpendLimitsProfile}
            setSpendLimitsCardToken={setSpendLimitsCardToken}
            setSpendLimitsProfileId={setSpendLimitsProfileId}
            spendLimitsCardToken={spendLimitsCardToken}
            spendLimitsProfileId={spendLimitsProfileId}
            t={t}
          />
          <WiseSpendLimitsUpdatePanels
            isPendingDeleteSpendLimitsCard={isPendingDeleteSpendLimitsCard}
            isPendingUpdateSpendLimitsCard={isPendingUpdateSpendLimitsCard}
            isPendingUpdateSpendLimitsProfile={isPendingUpdateSpendLimitsProfile}
            onDeleteSpendLimitsCard={onDeleteSpendLimitsCard}
            onUpdateSpendLimitsCard={onUpdateSpendLimitsCard}
            onUpdateSpendLimitsProfile={onUpdateSpendLimitsProfile}
            setSpendLimitsCardPayload={setSpendLimitsCardPayload}
            setSpendLimitsDeleteCardToken={setSpendLimitsDeleteCardToken}
            setSpendLimitsPayload={setSpendLimitsPayload}
            spendLimitsCardPayload={spendLimitsCardPayload}
            spendLimitsDeleteCardToken={spendLimitsDeleteCardToken}
            spendLimitsPayload={spendLimitsPayload}
            t={t}
          />
          <WiseSpendLimitsResponsePanels
            spendLimitsCardResult={spendLimitsCardResult}
            spendLimitsProfileResult={spendLimitsProfileResult}
            t={t}
          />
        </CardContent>
      </Card>
    </TabsContent>
  );
}
