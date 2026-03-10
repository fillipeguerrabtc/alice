import type { TFunction } from 'i18next';

export type WiseSpendLimitsTabContentProps = {
  isPendingDeleteSpendLimitsCard: boolean;
  isPendingUpdateSpendLimitsCard: boolean;
  isPendingUpdateSpendLimitsProfile: boolean;
  onDeleteSpendLimitsCard: () => void;
  onFetchSpendLimitsCard: () => void;
  onFetchSpendLimitsProfile: () => void;
  onUpdateSpendLimitsCard: () => void;
  onUpdateSpendLimitsProfile: () => void;
  setSpendLimitsCardPayload: (value: string) => void;
  setSpendLimitsCardToken: (value: string) => void;
  setSpendLimitsDeleteCardToken: (value: string) => void;
  setSpendLimitsPayload: (value: string) => void;
  setSpendLimitsProfileId: (value: string) => void;
  spendLimitsCardPayload: string;
  spendLimitsCardResult: string | null;
  spendLimitsCardToken: string;
  spendLimitsDeleteCardToken: string;
  spendLimitsPayload: string;
  spendLimitsProfileId: string;
  spendLimitsProfileResult: string | null;
  t: TFunction;
};
