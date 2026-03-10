import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { WiseAccountDetailsTabContentProps } from './wise-account-details-tab-types';

type WiseAccountDetailsToolbarProps = Pick<
  WiseAccountDetailsTabContentProps,
  | 'onRefreshAccountDetails'
  | 'onRefreshAccountDetailsOrders'
  | 'profileFilter'
  | 'profiles'
  | 'setProfileFilter'
  | 't'
>;

export function WiseAccountDetailsToolbar({
  onRefreshAccountDetails,
  onRefreshAccountDetailsOrders,
  profileFilter,
  profiles,
  setProfileFilter,
  t,
}: WiseAccountDetailsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <CardDescription>{t('wise.accountDetails.subtitle')}</CardDescription>
      <div className="flex items-center gap-2">
        <Select value={profileFilter} onValueChange={setProfileFilter}>
          <SelectTrigger className="min-w-[200px]" data-testid="select-account-details-profile">
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
        <Button
          variant="outline"
          size="sm"
          onClick={onRefreshAccountDetails}
          data-testid="button-refresh-account-details"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          {t('common.refresh')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefreshAccountDetailsOrders}
          data-testid="button-refresh-account-orders"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          {t('wise.accountDetails.refreshOrders')}
        </Button>
      </div>
    </div>
  );
}
