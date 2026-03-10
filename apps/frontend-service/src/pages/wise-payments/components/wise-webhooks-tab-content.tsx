import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';
import type { WiseWebhooksTabContentProps } from './wise-webhooks-tab-types';
import { WiseWebhooksCreateCard } from './wise-webhooks-create-card';
import { WiseWebhooksDeleteCard } from './wise-webhooks-delete-card';
import { WiseWebhooksToolbar } from './wise-webhooks-toolbar';

export function WiseWebhooksTabContent({
  isPendingCreateWebhook,
  isPendingDeleteWebhook,
  isPendingListWebhooks,
  onCreateWebhook,
  onDeleteWebhook,
  onListWebhooks,
  profileFilter,
  profiles,
  setProfileFilter,
  setWebhookApplication,
  setWebhookDeleteId,
  setWebhookPayload,
  t,
  webhookApplication,
  webhookDeleteId,
  webhookPayload,
  webhookResponse,
}: WiseWebhooksTabContentProps) {
  return (
    <TabsContent value="webhooks" className="space-y-4 mt-6">
      <WiseWebhooksToolbar
        isPendingListWebhooks={isPendingListWebhooks}
        onListWebhooks={onListWebhooks}
        profileFilter={profileFilter}
        profiles={profiles}
        setProfileFilter={setProfileFilter}
        setWebhookApplication={setWebhookApplication}
        t={t}
        webhookApplication={webhookApplication}
      />

      <WiseWebhooksCreateCard
        isPendingCreateWebhook={isPendingCreateWebhook}
        onCreateWebhook={onCreateWebhook}
        setWebhookPayload={setWebhookPayload}
        t={t}
        webhookPayload={webhookPayload}
      />

      <WiseWebhooksDeleteCard
        isPendingDeleteWebhook={isPendingDeleteWebhook}
        onDeleteWebhook={onDeleteWebhook}
        setWebhookDeleteId={setWebhookDeleteId}
        t={t}
        webhookDeleteId={webhookDeleteId}
      />

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
    </TabsContent>
  );
}
