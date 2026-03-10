import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

type WiseWebhooksCreateCardProps = {
  isPendingCreateWebhook: boolean;
  onCreateWebhook: () => void;
  setWebhookPayload: (value: string) => void;
  t: TFunction;
  webhookPayload: string;
};

export function WiseWebhooksCreateCard({
  isPendingCreateWebhook,
  onCreateWebhook,
  setWebhookPayload,
  t,
  webhookPayload,
}: WiseWebhooksCreateCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.webhooks.createTitle')}</CardTitle>
        <CardDescription>{t('wise.webhooks.createSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={webhookPayload}
          onChange={(event) => setWebhookPayload(event.target.value)}
          rows={5}
          placeholder="{ }"
          data-testid="textarea-webhook-payload"
        />
        <Button onClick={onCreateWebhook} disabled={isPendingCreateWebhook} data-testid="button-webhook-create">
          {t('wise.webhooks.create')}
        </Button>
      </CardContent>
    </Card>
  );
}
