import { TabsContent } from '@/components/ui/tabs';
import { WiseCardTransactionsFetchCard } from './wise-card-transactions-fetch-card';
import type { WiseCardTransactionsTabContentProps } from './wise-card-transactions-tab-types';
import { WiseCardTransactionsToolbar } from './wise-card-transactions-toolbar';

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
      <WiseCardTransactionsToolbar
        profileFilter={profileFilter}
        profiles={profiles}
        setProfileFilter={setProfileFilter}
        t={t}
      />

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
