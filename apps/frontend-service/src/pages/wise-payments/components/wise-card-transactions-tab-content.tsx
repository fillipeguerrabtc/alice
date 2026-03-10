import { CardDescription } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TabsContent } from '@/components/ui/tabs';
import { WiseCardTransactionsFetchCard } from './wise-card-transactions-fetch-card';
import type { WiseCardTransactionsTabContentProps } from './wise-card-transactions-tab-types';

export function WiseCardTransactionsTabContent({
  cardTransactionDetails,
  cardTransactionId,
  isPendingCardTransactionFetch,
  onFetchCardTransaction,
  profileFilter,
  profiles,
  setCardTransactionId,
  setProfileFilter,
  t,
}: WiseCardTransactionsTabContentProps) {
  return (
    <TabsContent value="card-transactions" className="space-y-4 mt-6">
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

      <WiseCardTransactionsFetchCard
        cardTransactionDetails={cardTransactionDetails}
        cardTransactionId={cardTransactionId}
        isPendingCardTransactionFetch={isPendingCardTransactionFetch}
        onFetchCardTransaction={onFetchCardTransaction}
        setCardTransactionId={setCardTransactionId}
        t={t}
      />
    </TabsContent>
  );
}
