import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { WiseDisputeFlowForm } from './wise-disputes-tab-types';

type WiseDisputeFlowCardProps = {
  disputeFlowForm: WiseDisputeFlowForm;
  disputeFlowStepResult: string | null;
  disputeFlowSubmitResult: string | null;
  isPendingDisputeFlowStep: boolean;
  isPendingDisputeFlowSubmit: boolean;
  onDisputeFlowStep: () => void;
  onDisputeFlowSubmit: () => void;
  setDisputeFlowForm: (updater: (prev: WiseDisputeFlowForm) => WiseDisputeFlowForm) => void;
  t: TFunction;
};

export function WiseDisputeFlowCard({
  disputeFlowForm,
  disputeFlowStepResult,
  disputeFlowSubmitResult,
  isPendingDisputeFlowStep,
  isPendingDisputeFlowSubmit,
  onDisputeFlowStep,
  onDisputeFlowSubmit,
  setDisputeFlowForm,
  t,
}: WiseDisputeFlowCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.disputes.flowTitle')}</CardTitle>
        <CardDescription>{t('wise.disputes.flowSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>{t('wise.disputes.scheme')}</Label>
            <Input
              value={disputeFlowForm.scheme}
              onChange={(event) => setDisputeFlowForm((prev) => ({ ...prev, scheme: event.target.value }))}
              data-testid="input-dispute-scheme"
            />
          </div>
          <div className="space-y-2">
            <Label>{t('wise.disputes.reason')}</Label>
            <Input
              value={disputeFlowForm.reason}
              onChange={(event) => setDisputeFlowForm((prev) => ({ ...prev, reason: event.target.value }))}
              data-testid="input-dispute-reason"
            />
          </div>
          <div className="space-y-2">
            <Label>{t('wise.disputes.transactionId')}</Label>
            <Input
              value={disputeFlowForm.transactionId}
              onChange={(event) => setDisputeFlowForm((prev) => ({ ...prev, transactionId: event.target.value }))}
              data-testid="input-dispute-transaction"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>{t('wise.disputes.flowPayload')}</Label>
          <Textarea
            value={disputeFlowForm.payload}
            onChange={(event) => setDisputeFlowForm((prev) => ({ ...prev, payload: event.target.value }))}
            rows={4}
            placeholder="{ }"
            data-testid="textarea-dispute-flow"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={onDisputeFlowStep} disabled={isPendingDisputeFlowStep} data-testid="button-dispute-step">
            {t('wise.disputes.flowStep')}
          </Button>
          <Button
            variant="outline"
            onClick={onDisputeFlowSubmit}
            disabled={isPendingDisputeFlowSubmit}
            data-testid="button-dispute-submit"
          >
            {t('wise.disputes.flowSubmit')}
          </Button>
        </div>
        <div className="space-y-2">
          <Label>{t('wise.disputes.flowResponse')}</Label>
          <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
            {disputeFlowStepResult || disputeFlowSubmitResult || t('wise.disputes.flowEmpty')}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
