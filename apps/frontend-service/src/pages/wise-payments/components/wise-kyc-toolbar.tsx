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
import type { WiseKycTabContentProps } from './wise-kyc-tab-types';

type WiseKycToolbarProps = Pick<
  WiseKycTabContentProps,
  'onRefreshKycReviews' | 'profileFilter' | 'profiles' | 'setProfileFilter' | 't'
>;

export function WiseKycToolbar({
  onRefreshKycReviews,
  profileFilter,
  profiles,
  setProfileFilter,
  t,
}: WiseKycToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <CardDescription>{t('wise.kyc.subtitle')}</CardDescription>
      <div className="flex items-center gap-2">
        <Select value={profileFilter} onValueChange={setProfileFilter}>
          <SelectTrigger className="min-w-[200px]" data-testid="select-kyc-profile">
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
        <Button variant="outline" size="sm" onClick={onRefreshKycReviews} data-testid="button-refresh-kyc">
          <RefreshCw className="h-4 w-4 mr-2" />
          {t('common.refresh')}
        </Button>
      </div>
    </div>
  );
}
