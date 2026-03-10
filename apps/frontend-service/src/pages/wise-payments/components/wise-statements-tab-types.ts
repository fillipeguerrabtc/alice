import type { TFunction } from 'i18next';

export type WiseBalanceOption = {
  currency: string;
  id: number;
  type: 'STANDARD' | 'SAVINGS';
};

export type WiseStatementForm = {
  balanceId: string;
  currency: string;
  intervalEnd: string;
  intervalStart: string;
};

export type WiseBalanceStatement = {
  amount: { value: number; currency: string };
  date: string;
  reference?: string;
  runningBalance?: { value: number; currency: string };
  totalFees?: { value: number; currency: string };
  type: string;
};

export type WiseBalanceStatementResponse = {
  transactions: WiseBalanceStatement[];
};

export type WiseStatementsTabContentProps = {
  balances: WiseBalanceOption[];
  formatCurrency: (value: number, currency: string, locale?: string) => string;
  formatDate: (value: string, options: { locale?: string; timeZone?: string }) => string;
  isPendingStatement: boolean;
  locale: string;
  onFetchStatement: () => void;
  onStatementFieldChange: (field: keyof WiseStatementForm, value: string) => void;
  statementCurrencies: string[];
  statementData: WiseBalanceStatementResponse | null;
  statementForm: WiseStatementForm;
  t: TFunction;
  timeZone: string;
};
