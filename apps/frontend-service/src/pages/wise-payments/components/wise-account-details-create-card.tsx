import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import type { WiseAccountDetailsTabContentProps } from './wise-account-details-tab-types';

type WiseAccountDetailsCreateCardProps = Pick<
  WiseAccountDetailsTabContentProps,
  | 'accountDetailsPayload'
  | 'accountDetailsResponse'
  | 'isCreatingAccountDetailsOrder'
  | 'onCreateAccountDetailsOrder'
  | 'setAccountDetailsPayload'
  | 't'
>;

export function WiseAccountDetailsCreateCard({
  accountDetailsPayload,
  accountDetailsResponse,
  isCreatingAccountDetailsOrder,
  onCreateAccountDetailsOrder,
  setAccountDetailsPayload,
  t,
}: WiseAccountDetailsCreateCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.accountDetails.createTitle')}</CardTitle>
        <CardDescription>{t('wise.accountDetails.createSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={accountDetailsPayload}
          onChange={(event) => setAccountDetailsPayload(event.target.value)}
          rows={5}
          placeholder="{ }"
          data-testid="textarea-account-details-payload"
        />
        <Button
          onClick={onCreateAccountDetailsOrder}
          disabled={isCreatingAccountDetailsOrder}
          data-testid="button-create-account-order"
        >
          {t('wise.accountDetails.create')}
        </Button>
        <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
          {accountDetailsResponse ?? t('wise.accountDetails.responseEmpty')}
        </pre>
      </CardContent>
    </Card>
  );
}
