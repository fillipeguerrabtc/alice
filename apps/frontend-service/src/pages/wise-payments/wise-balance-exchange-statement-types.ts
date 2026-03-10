import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';

export type NotifyFn = (params: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

export type QuoteForm = {
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: string;
};

export type ExchangeForm = {
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: string;
};

export type StatementForm = {
  balanceId: string;
  currency: string;
  intervalStart: string;
  intervalEnd: string;
};

export type NewBalanceForm = {
  currency: string;
  type: 'STANDARD' | 'SAVINGS';
  name: string;
};

export type WiseQuote = {
  id: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: number;
  targetAmount: number;
  rate: number;
  fee: number;
  expirationTime: string | null;
  deliveryEstimate: string | null;
  formattedEstimatedDelivery: string | null;
};

export type WiseBalance = {
  id: number;
  currency: string;
  type: 'STANDARD' | 'SAVINGS';
  name?: string | null;
  amount: {
    value: number;
    currency: string;
  };
};

export type WiseBalanceStatement = {
  type: string;
  amount: { value: number; currency: string };
  date: string;
  note?: string;
  totalFees?: { value: number; currency: string };
  reference?: string;
  runningBalance?: { value: number; currency: string };
};

export type WiseBalanceStatementResponse = {
  accountId: number;
  currency: string;
  intervalStart: string;
  intervalEnd: string;
  transactions: WiseBalanceStatement[];
};

export type UseWiseBalanceExchangeStatementActionsOptions = {
  notify: NotifyFn;
  t: TFunction;
};

export type UseWiseBalanceExchangeStatementActionsResult = {
  exchangeForm: ExchangeForm;
  exchangeQuote: WiseQuote | null;
  handleCreateBalance: () => void;
  handleDeleteBalance: (balanceId: number) => void;
  handleExecuteExchange: () => void;
  handleFetchStatement: () => void;
  handleGetExchangeQuote: () => void;
  handleGetQuote: () => void;
  isPendingCreateBalance: boolean;
  isPendingExchangeExecute: boolean;
  isPendingExchangeQuote: boolean;
  isPendingQuote: boolean;
  isPendingStatement: boolean;
  newBalanceForm: NewBalanceForm;
  onStatementFieldChange: (field: keyof StatementForm, value: string) => void;
  quote: WiseQuote | null;
  quoteForm: QuoteForm;
  setExchangeForm: Dispatch<SetStateAction<ExchangeForm>>;
  setNewBalanceForm: Dispatch<SetStateAction<NewBalanceForm>>;
  setQuoteForm: Dispatch<SetStateAction<QuoteForm>>;
  setShowNewBalanceDialog: (open: boolean) => void;
  showNewBalanceDialog: boolean;
  statementData: WiseBalanceStatementResponse | null;
  statementForm: StatementForm;
};

export const INITIAL_QUOTE_FORM: QuoteForm = {
  sourceCurrency: 'EUR',
  targetCurrency: 'USD',
  sourceAmount: '',
};

export const INITIAL_EXCHANGE_FORM: ExchangeForm = {
  sourceCurrency: 'EUR',
  targetCurrency: 'USD',
  sourceAmount: '',
};

export const INITIAL_STATEMENT_FORM: StatementForm = {
  balanceId: '',
  currency: 'EUR',
  intervalStart: '',
  intervalEnd: '',
};

export const INITIAL_NEW_BALANCE_FORM: NewBalanceForm = {
  currency: 'EUR',
  type: 'STANDARD',
  name: '',
};
