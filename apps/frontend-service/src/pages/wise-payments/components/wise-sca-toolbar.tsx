import { CardDescription } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { WiseProfileOption } from './wise-sca-tab-types';
import type { TFunction } from 'i18next';

type WiseScaToolbarProps = {
  profileFilter: string;
  profiles: WiseProfileOption[];
  setProfileFilter: (value: string) => void;
  t: TFunction;
};

export function WiseScaToolbar({
  profileFilter,
  profiles,
  setProfileFilter,
  t,
}: WiseScaToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <CardDescription>{t('wise.sca.subtitle')}</CardDescription>
      <Select value={profileFilter} onValueChange={setProfileFilter}>
        <SelectTrigger className="min-w-[200px]" data-testid="select-sca-profile">
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
    </div>
  );
}
