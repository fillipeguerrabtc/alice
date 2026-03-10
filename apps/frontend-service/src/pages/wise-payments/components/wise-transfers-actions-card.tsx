import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { WiseTransfersTabContentProps } from './wise-transfers-tab-types';

type WiseTransfersActionsCardProps = Pick<
  WiseTransfersTabContentProps,
  | 'onCancelTransfer'
  | 'onFundTransfer'
  | 'setTransferActionId'
  | 't'
  | 'transferActionId'
  | 'transferActionResult'
>;

export function WiseTransfersActionsCard({
  onCancelTransfer,
  onFundTransfer,
  setTransferActionId,
  t,
  transferActionId,
  transferActionResult,
}: WiseTransfersActionsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.transfers.actionsTitle')}</CardTitle>
        <CardDescription>{t('wise.transfers.actionsSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <Input
            value={transferActionId}
            onChange={(event) => setTransferActionId(event.target.value)}
            placeholder={t('wise.transfers.transferIdPlaceholder')}
            data-testid="input-transfer-action-id"
          />
          <Button variant="outline" onClick={onFundTransfer} data-testid="button-transfer-fund">
            {t('wise.transfers.fund')}
          </Button>
          <Button variant="outline" onClick={onCancelTransfer} data-testid="button-transfer-cancel">
            {t('wise.transfers.cancel')}
          </Button>
        </div>
        <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
          {transferActionResult ?? t('wise.transfers.responseEmpty')}
        </pre>
      </CardContent>
    </Card>
  );
}
