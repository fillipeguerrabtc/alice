import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { WiseSpendLimitsTabContentProps } from './wise-spend-limits-tab-types';

type WiseSpendLimitsUpdatePanelsProps = Pick<
  WiseSpendLimitsTabContentProps,
  | 'isPendingDeleteSpendLimitsCard'
  | 'isPendingUpdateSpendLimitsCard'
  | 'isPendingUpdateSpendLimitsProfile'
  | 'onDeleteSpendLimitsCard'
  | 'onUpdateSpendLimitsCard'
  | 'onUpdateSpendLimitsProfile'
  | 'setSpendLimitsCardPayload'
  | 'setSpendLimitsDeleteCardToken'
  | 'setSpendLimitsPayload'
  | 'spendLimitsCardPayload'
  | 'spendLimitsDeleteCardToken'
  | 'spendLimitsPayload'
  | 't'
>;

export function WiseSpendLimitsUpdatePanels({
  isPendingDeleteSpendLimitsCard,
  isPendingUpdateSpendLimitsCard,
  isPendingUpdateSpendLimitsProfile,
  onDeleteSpendLimitsCard,
  onUpdateSpendLimitsCard,
  onUpdateSpendLimitsProfile,
  setSpendLimitsCardPayload,
  setSpendLimitsDeleteCardToken,
  setSpendLimitsPayload,
  spendLimitsCardPayload,
  spendLimitsDeleteCardToken,
  spendLimitsPayload,
  t,
}: WiseSpendLimitsUpdatePanelsProps) {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label>{t('wise.spendLimits.profilePayload')}</Label>
          <Textarea
            value={spendLimitsPayload}
            onChange={(event) => setSpendLimitsPayload(event.target.value)}
            rows={5}
            placeholder="{ }"
            data-testid="textarea-spend-limits-profile"
          />
          <Button
            onClick={onUpdateSpendLimitsProfile}
            disabled={isPendingUpdateSpendLimitsProfile}
            data-testid="button-update-spend-limits-profile"
          >
            {t('wise.spendLimits.updateProfile')}
          </Button>
        </div>
        <div className="space-y-2">
          <Label>{t('wise.spendLimits.cardPayload')}</Label>
          <Textarea
            value={spendLimitsCardPayload}
            onChange={(event) => setSpendLimitsCardPayload(event.target.value)}
            rows={5}
            placeholder="{ }"
            data-testid="textarea-spend-limits-card"
          />
          <Button
            onClick={onUpdateSpendLimitsCard}
            disabled={isPendingUpdateSpendLimitsCard}
            data-testid="button-update-spend-limits-card"
          >
            {t('wise.spendLimits.updateCard')}
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <Label>{t('wise.spendLimits.cardDelete')}</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            value={spendLimitsDeleteCardToken}
            onChange={(event) => setSpendLimitsDeleteCardToken(event.target.value)}
            placeholder={t('wise.spendLimits.cardDeletePlaceholder')}
            data-testid="input-spend-limits-delete-card"
          />
          <Button
            variant="destructive"
            onClick={onDeleteSpendLimitsCard}
            disabled={isPendingDeleteSpendLimitsCard}
            data-testid="button-delete-spend-limits-card"
          >
            {t('wise.spendLimits.deleteCard')}
          </Button>
        </div>
      </div>
    </>
  );
}
