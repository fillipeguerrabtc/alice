import { CardDescription } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { WiseCardTransactionsTabContentProps } from './wise-card-transactions-tab-types';

type WiseCardTransactionsToolbarProps = Pick<
  WiseCardTransactionsTabContentProps,
  'profileFilter' | 'profiles' | 'setProfileFilter' | 't'
>;

export function WiseCardTransactionsToolbar({
  profileFilter,
  profiles,
  setProfileFilter,
  t,
}: WiseCardTransactionsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <CardDescription>{t('wise.cardTransactions.subtitle')}</CardDescription>
      <Select value={profileFilter} onValueChange={setProfileFilter}>
        <SelectTrigger className="min-w-[200px]" data-testid="select-card-transactions-profile">
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
