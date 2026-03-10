import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WiseSpendLimitsTabContentProps } from './wise-spend-limits-tab-types';

type WiseSpendLimitsFetchControlsProps = Pick<
  WiseSpendLimitsTabContentProps,
  | 'onFetchSpendLimitsCard'
  | 'onFetchSpendLimitsProfile'
  | 'setSpendLimitsCardToken'
  | 'setSpendLimitsProfileId'
  | 'spendLimitsCardToken'
  | 'spendLimitsProfileId'
  | 't'
>;

export function WiseSpendLimitsFetchControls({
  onFetchSpendLimitsCard,
  onFetchSpendLimitsProfile,
  setSpendLimitsCardToken,
  setSpendLimitsProfileId,
  spendLimitsCardToken,
  spendLimitsProfileId,
  t,
}: WiseSpendLimitsFetchControlsProps) {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label>{t('wise.spendLimits.profileId')}</Label>
          <Input
            value={spendLimitsProfileId}
            onChange={(event) => setSpendLimitsProfileId(event.target.value)}
            placeholder={t('wise.spendLimits.profilePlaceholder')}
            data-testid="input-spend-limits-profile"
          />
        </div>
        <div className="space-y-2">
          <Label>{t('wise.spendLimits.cardToken')}</Label>
          <Input
            value={spendLimitsCardToken}
            onChange={(event) => setSpendLimitsCardToken(event.target.value)}
            placeholder={t('wise.spendLimits.cardPlaceholder')}
            data-testid="input-spend-limits-card"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onFetchSpendLimitsProfile} data-testid="button-spend-limits-profile">
          {t('wise.spendLimits.fetchProfile')}
        </Button>
        <Button variant="outline" onClick={onFetchSpendLimitsCard} data-testid="button-spend-limits-card">
          {t('wise.spendLimits.fetchCard')}
        </Button>
      </div>
    </>
  );
}
