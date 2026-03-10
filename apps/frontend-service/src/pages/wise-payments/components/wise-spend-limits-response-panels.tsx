import { Label } from '@/components/ui/label';
import type { WiseSpendLimitsTabContentProps } from './wise-spend-limits-tab-types';

type WiseSpendLimitsResponsePanelsProps = Pick<
  WiseSpendLimitsTabContentProps,
  'spendLimitsCardResult' | 'spendLimitsProfileResult' | 't'
>;

export function WiseSpendLimitsResponsePanels({
  spendLimitsCardResult,
  spendLimitsProfileResult,
  t,
}: WiseSpendLimitsResponsePanelsProps) {
  return (
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
  );
}
