import { TabsContent } from '@/components/ui/tabs';
import type { WiseWebhooksTabContentProps } from './wise-webhooks-tab-types';
import { WiseWebhooksCreateCard } from './wise-webhooks-create-card';
import { WiseWebhooksDeleteCard } from './wise-webhooks-delete-card';
import { WiseWebhooksResponseCard } from './wise-webhooks-response-card';
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

      <WiseWebhooksResponseCard t={t} webhookResponse={webhookResponse} />
    </TabsContent>
  );
}
