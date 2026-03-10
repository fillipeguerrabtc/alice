import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { WiseDisputeStatusUpdate } from './wise-disputes-tab-types';

type WiseDisputeStatusUpdateCardProps = {
  disputeStatusUpdate: WiseDisputeStatusUpdate;
  isPendingDisputeStatusUpdate: boolean;
  onUpdateDisputeStatus: () => void;
  setDisputeStatusUpdate: (updater: (prev: WiseDisputeStatusUpdate) => WiseDisputeStatusUpdate) => void;
  t: TFunction;
};

export function WiseDisputeStatusUpdateCard({
  disputeStatusUpdate,
  isPendingDisputeStatusUpdate,
  onUpdateDisputeStatus,
  setDisputeStatusUpdate,
  t,
}: WiseDisputeStatusUpdateCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.disputes.updateTitle')}</CardTitle>
        <CardDescription>{t('wise.disputes.updateSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t('wise.disputes.disputeId')}</Label>
            <Input
              value={disputeStatusUpdate.disputeId}
              onChange={(event) => setDisputeStatusUpdate((prev) => ({ ...prev, disputeId: event.target.value }))}
              data-testid="input-dispute-id"
            />
          </div>
          <div className="space-y-2">
            <Label>{t('wise.disputes.status')}</Label>
            <Input
              value={disputeStatusUpdate.status}
              onChange={(event) => setDisputeStatusUpdate((prev) => ({ ...prev, status: event.target.value }))}
              data-testid="input-dispute-status"
            />
          </div>
        </div>
        <Button onClick={onUpdateDisputeStatus} disabled={isPendingDisputeStatusUpdate} data-testid="button-update-dispute">
          {t('wise.disputes.update')}
        </Button>
      </CardContent>
    </Card>
  );
}
