import type { TFunction } from 'i18next';

export type WiseProfileOption = {
  id: number;
  type: string;
};

export type WiseCardTransactionsTabContentProps = {
  cardTransactionDetails: string | null;
  cardTransactionId: string;
  isPendingCardTransactionFetch: boolean;
  onFetchCardTransaction: () => void;
  profileFilter: string;
  profiles: WiseProfileOption[];
  setCardTransactionId: (value: string) => void;
  setProfileFilter: (value: string) => void;
  t: TFunction;
};
