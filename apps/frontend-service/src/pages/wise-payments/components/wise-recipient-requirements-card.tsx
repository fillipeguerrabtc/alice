import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { WiseAccountDetailsTabContentProps } from './wise-account-details-tab-types';

type WiseRecipientRequirementsCardProps = Pick<
  WiseAccountDetailsTabContentProps,
  | 'onFetchRecipientRequirements'
  | 'onRecipientRequirementsFieldChange'
  | 'recipientRequirementsForm'
  | 'recipientRequirementsResult'
  | 't'
>;

export function WiseRecipientRequirementsCard({
  onFetchRecipientRequirements,
  onRecipientRequirementsFieldChange,
  recipientRequirementsForm,
  recipientRequirementsResult,
  t,
}: WiseRecipientRequirementsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.recipientRequirements.title')}</CardTitle>
        <CardDescription>{t('wise.recipientRequirements.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Input
            value={recipientRequirementsForm.sourceCurrency}
            onChange={(event) => onRecipientRequirementsFieldChange('sourceCurrency', event.target.value)}
            placeholder={t('wise.recipientRequirements.sourceCurrency')}
            data-testid="input-recipient-req-source"
          />
          <Input
            value={recipientRequirementsForm.targetCurrency}
            onChange={(event) => onRecipientRequirementsFieldChange('targetCurrency', event.target.value)}
            placeholder={t('wise.recipientRequirements.targetCurrency')}
            data-testid="input-recipient-req-target"
          />
          <Input
            value={recipientRequirementsForm.sourceAmount}
            onChange={(event) => onRecipientRequirementsFieldChange('sourceAmount', event.target.value)}
            placeholder={t('wise.recipientRequirements.sourceAmount')}
            data-testid="input-recipient-req-amount"
          />
        </div>
        <Button onClick={onFetchRecipientRequirements} data-testid="button-recipient-req">
          {t('wise.recipientRequirements.fetch')}
        </Button>
        <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
          {recipientRequirementsResult ?? t('wise.recipientRequirements.responseEmpty')}
        </pre>
      </CardContent>
    </Card>
  );
}
