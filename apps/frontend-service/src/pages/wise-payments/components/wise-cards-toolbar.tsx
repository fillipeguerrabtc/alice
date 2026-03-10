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
import type { WiseCardsTabContentProps } from './wise-cards-tab-types';

type WiseCardsToolbarProps = Pick<
  WiseCardsTabContentProps,
  'onRefreshCards' | 'profileFilter' | 'profiles' | 'setProfileFilter' | 't'
>;

export function WiseCardsToolbar({
  onRefreshCards,
  profileFilter,
  profiles,
  setProfileFilter,
  t,
}: WiseCardsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <CardDescription>{t('wise.cards.subtitle')}</CardDescription>
      <div className="flex items-center gap-2">
        <Select value={profileFilter} onValueChange={setProfileFilter}>
          <SelectTrigger className="min-w-[200px]" data-testid="select-cards-profile">
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
        <Button variant="outline" size="sm" onClick={onRefreshCards} data-testid="button-refresh-cards">
          <RefreshCw className="h-4 w-4 mr-2" />
          {t('common.refresh')}
        </Button>
      </div>
    </div>
  );
}
