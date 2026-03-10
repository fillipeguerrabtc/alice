import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';

export type CurrencyOption = {
  code: string;
  name: string;
};

export type NewBalanceForm = {
  currency: string;
  type: 'STANDARD' | 'SAVINGS';
  name: string;
};

export type WiseBalanceCard = {
  id: number;
  currency: string;
  type: 'STANDARD' | 'SAVINGS';
  name?: string | null;
  amount: {
    value: number;
    currency: string;
  };
  reservedAmount?: {
    value: number;
    currency: string;
  };
  totalWorth?: {
    value: number;
    currency: string;
  };
};

export type WiseBalancesTabContentProps = {
  balanceCapacityCurrency: string;
  balanceCapacityResult: string | null;
  balances: WiseBalanceCard[];
  createBalancePending: boolean;
  currencies: CurrencyOption[];
  formatCurrency: (value: number, currency: string, locale: string) => string;
  isLoadingBalances: boolean;
  locale: string;
  newBalanceForm: NewBalanceForm;
  onCreateBalance: () => void;
  onDeleteBalance: (balanceId: number) => void;
  onFetchBalanceCapacity: () => void;
  onFetchTotalFunds: () => void;
  setBalanceCapacityCurrency: (value: string) => void;
  setNewBalanceForm: Dispatch<SetStateAction<NewBalanceForm>>;
  setShowNewBalanceDialog: (open: boolean) => void;
  setTotalFundsCurrency: (value: string) => void;
  showNewBalanceDialog: boolean;
  t: TFunction;
  totalFundsCurrency: string;
  totalFundsResult: string | null;
};
