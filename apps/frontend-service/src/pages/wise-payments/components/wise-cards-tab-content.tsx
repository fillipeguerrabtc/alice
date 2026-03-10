import { TabsContent } from '@/components/ui/tabs';
import { WiseCardsListCard } from './wise-cards-list-card';
import type { WiseCardsTabContentProps } from './wise-cards-tab-types';
import { WiseCardsToolbar } from './wise-cards-toolbar';

export function WiseCardsTabContent({
  cardStatusUpdates,
  cards,
  isLoadingCards,
  isUpdatingCardStatus,
  onRefreshCards,
  onUpdateCardStatus,
  profileFilter,
  profiles,
  setCardStatusUpdates,
  setProfileFilter,
  t,
}: WiseCardsTabContentProps) {
  return (
    <TabsContent value="cards" className="space-y-4 mt-6">
      <WiseCardsToolbar
        onRefreshCards={onRefreshCards}
        profileFilter={profileFilter}
        profiles={profiles}
        setProfileFilter={setProfileFilter}
        t={t}
      />
      <WiseCardsListCard
        cardStatusUpdates={cardStatusUpdates}
        cards={cards}
        isLoadingCards={isLoadingCards}
        isUpdatingCardStatus={isUpdatingCardStatus}
        onUpdateCardStatus={onUpdateCardStatus}
        profileFilter={profileFilter}
        setCardStatusUpdates={setCardStatusUpdates}
        t={t}
      />
    </TabsContent>
  );
}
