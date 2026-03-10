import type { TFunction } from 'i18next';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type WiseWebhooksDeleteCardProps = {
  isPendingDeleteWebhook: boolean;
  onDeleteWebhook: () => void;
  setWebhookDeleteId: (value: string) => void;
  t: TFunction;
  webhookDeleteId: string;
};

export function WiseWebhooksDeleteCard({
  isPendingDeleteWebhook,
  onDeleteWebhook,
  setWebhookDeleteId,
  t,
  webhookDeleteId,
}: WiseWebhooksDeleteCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.webhooks.deleteTitle')}</CardTitle>
        <CardDescription>{t('wise.webhooks.deleteSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          value={webhookDeleteId}
          onChange={(event) => setWebhookDeleteId(event.target.value)}
          placeholder={t('wise.webhooks.subscriptionId')}
          data-testid="input-webhook-delete"
        />
        <Button
          variant="destructive"
          onClick={onDeleteWebhook}
          disabled={isPendingDeleteWebhook}
          data-testid="button-webhook-delete"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          {t('wise.webhooks.delete')}
        </Button>
      </CardContent>
    </Card>
  );
}
