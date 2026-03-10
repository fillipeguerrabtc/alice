import type { TFunction } from 'i18next';

export type WiseProfileOption = {
  id: number;
  type: string;
};

export type WiseWebhooksTabContentProps = {
  isPendingCreateWebhook: boolean;
  isPendingDeleteWebhook: boolean;
  isPendingListWebhooks: boolean;
  onCreateWebhook: () => void;
  onDeleteWebhook: () => void;
  onListWebhooks: () => void;
  profileFilter: string;
  profiles: WiseProfileOption[];
  setProfileFilter: (value: string) => void;
  setWebhookApplication: (value: string) => void;
  setWebhookDeleteId: (value: string) => void;
  setWebhookPayload: (value: string) => void;
  t: TFunction;
  webhookApplication: string;
  webhookDeleteId: string;
  webhookPayload: string;
  webhookResponse: string | null;
};
