import type { TFunction } from 'i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type WiseWebhooksResponseCardProps = {
  t: TFunction;
  webhookResponse: string | null;
};

export function WiseWebhooksResponseCard({
  t,
  webhookResponse,
}: WiseWebhooksResponseCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.webhooks.responseTitle')}</CardTitle>
        <CardDescription>{t('wise.webhooks.responseSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="max-h-80 overflow-auto rounded-md bg-muted/50 p-3 text-xs">
          {webhookResponse ?? t('wise.webhooks.responseEmpty')}
        </pre>
      </CardContent>
    </Card>
  );
}
