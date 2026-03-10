import { CardDescription } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { WiseSimulationsTabContentProps } from './wise-simulations-tab-types';

type WiseSimulationsToolbarProps = Pick<
  WiseSimulationsTabContentProps,
  'profileFilter' | 'profiles' | 'setProfileFilter' | 't'
>;

export function WiseSimulationsToolbar({
  profileFilter,
  profiles,
  setProfileFilter,
  t,
}: WiseSimulationsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <CardDescription>{t('wise.simulations.subtitle')}</CardDescription>
      <Select value={profileFilter} onValueChange={setProfileFilter}>
        <SelectTrigger className="min-w-[200px]" data-testid="select-simulations-profile">
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
