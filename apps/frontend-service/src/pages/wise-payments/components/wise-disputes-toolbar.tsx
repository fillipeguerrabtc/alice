import { RefreshCw } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { WiseProfileOption } from './wise-disputes-tab-types';

type WiseDisputesToolbarProps = {
  onRefreshDisputes: () => void;
  profileFilter: string;
  profiles: WiseProfileOption[];
  setProfileFilter: (value: string) => void;
  t: TFunction;
};

export function WiseDisputesToolbar({
  onRefreshDisputes,
  profileFilter,
  profiles,
  setProfileFilter,
  t,
}: WiseDisputesToolbarProps) {
  return (
    <div className="flex items-center gap-2">
      <Select value={profileFilter} onValueChange={setProfileFilter}>
        <SelectTrigger className="min-w-[200px]" data-testid="select-disputes-profile">
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
      <Button variant="outline" size="sm" onClick={onRefreshDisputes} data-testid="button-refresh-disputes">
        <RefreshCw className="h-4 w-4 mr-2" />
        {t('common.refresh')}
      </Button>
    </div>
  );
}
