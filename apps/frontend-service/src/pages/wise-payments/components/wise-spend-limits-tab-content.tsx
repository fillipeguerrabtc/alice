import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { TabsContent } from '@/components/ui/tabs';
import { WiseSpendLimitsFetchControls } from './wise-spend-limits-fetch-controls';
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
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('wise.spendLimits.profileResponse')}</Label>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
                {spendLimitsProfileResult ?? t('wise.spendLimits.responseEmpty')}
              </pre>
            </div>
            <div className="space-y-2">
              <Label>{t('wise.spendLimits.cardResponse')}</Label>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
                {spendLimitsCardResult ?? t('wise.spendLimits.responseEmpty')}
              </pre>
            </div>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}
