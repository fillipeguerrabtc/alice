import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardDescription } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { WiseProfileOption } from './wise-webhooks-tab-types';
import type { TFunction } from 'i18next';

type WiseWebhooksToolbarProps = {
  isPendingListWebhooks: boolean;
  onListWebhooks: () => void;
  profileFilter: string;
  profiles: WiseProfileOption[];
  setProfileFilter: (value: string) => void;
  setWebhookApplication: (value: string) => void;
  t: TFunction;
  webhookApplication: string;
};

export function WiseWebhooksToolbar({
  isPendingListWebhooks,
  onListWebhooks,
  profileFilter,
  profiles,
  setProfileFilter,
  setWebhookApplication,
  t,
  webhookApplication,
}: WiseWebhooksToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <CardDescription>{t('wise.webhooks.subtitle')}</CardDescription>
      <div className="flex items-center gap-2">
        <Select value={profileFilter} onValueChange={setProfileFilter}>
          <SelectTrigger className="min-w-[200px]" data-testid="select-webhooks-profile">
            <SelectValue placeholder={t('wise.catalog.profileId')} />
          </SelectTrigger>
          <SelectContent>
            {profiles.map((profile) => (
              <SelectItem key={profile.id} value={String(profile.id)}>
                {profile.id} • {profile.type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={webhookApplication} onValueChange={setWebhookApplication}>
          <SelectTrigger className="min-w-[180px]" data-testid="select-webhooks-application">
            <SelectValue placeholder={t('wise.webhooks.application')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="false">{t('wise.webhooks.profileScope')}</SelectItem>
            <SelectItem value="true">{t('wise.webhooks.applicationScope')}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={onListWebhooks}
          disabled={isPendingListWebhooks}
          data-testid="button-webhooks-list"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          {t('wise.webhooks.list')}
        </Button>
      </div>
    </div>
  );
}
