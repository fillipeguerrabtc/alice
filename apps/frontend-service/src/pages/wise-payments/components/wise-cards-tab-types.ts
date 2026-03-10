import type { TFunction } from 'i18next';

export type WiseProfileOption = {
  id: number;
  type: string;
};

export type WiseCard = {
  cardToken: string;
  lastFourDigits?: string;
  status: string;
  type?: string;
};

export type WiseCardsTabContentProps = {
  cardStatusUpdates: Record<string, string>;
  cards: WiseCard[];
  isLoadingCards: boolean;
  isUpdatingCardStatus: boolean;
  onRefreshCards: () => void;
  onUpdateCardStatus: (cardToken: string) => void;
  profileFilter: string;
  profiles: WiseProfileOption[];
  setCardStatusUpdates: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  setProfileFilter: (value: string) => void;
  t: TFunction;
};
