import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CardOrdersPageState, WiseProfileOption } from './wise-card-orders-tab-types';
import type { TFunction } from 'i18next';

type WiseCardOrdersToolbarProps = {
  cardOrdersPage: CardOrdersPageState;
  onRefreshCardOrders: () => void;
  profileFilter: string;
  profiles: WiseProfileOption[];
  setCardOrdersPage: (updater: (prev: CardOrdersPageState) => CardOrdersPageState) => void;
  setProfileFilter: (value: string) => void;
  t: TFunction;
};

export function WiseCardOrdersToolbar({
  cardOrdersPage,
  onRefreshCardOrders,
  profileFilter,
  profiles,
  setCardOrdersPage,
  setProfileFilter,
  t,
}: WiseCardOrdersToolbarProps) {
  return (
    <div className="flex items-center gap-2">
      <Select value={profileFilter} onValueChange={setProfileFilter}>
        <SelectTrigger className="min-w-[200px]" data-testid="select-card-orders-profile">
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
      <Input
        value={cardOrdersPage.pageNumber}
        onChange={(event) =>
          setCardOrdersPage((prev) => ({ ...prev, pageNumber: event.target.value }))
        }
        placeholder={t('wise.cardOrders.page')}
        data-testid="input-card-orders-page"
      />
      <Input
        value={cardOrdersPage.pageSize}
        onChange={(event) =>
          setCardOrdersPage((prev) => ({ ...prev, pageSize: event.target.value }))
        }
        placeholder={t('wise.cardOrders.pageSize')}
        data-testid="input-card-orders-page-size"
      />
      <Button variant="outline" size="sm" onClick={onRefreshCardOrders} data-testid="button-refresh-card-orders">
        <RefreshCw className="h-4 w-4 mr-2" />
        {t('common.refresh')}
      </Button>
    </div>
  );
}
