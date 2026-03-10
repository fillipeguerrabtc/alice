import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';

export type CurrencyOption = {
  code: string;
  name: string;
};

export type ExchangeForm = {
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: string;
};

export type RatesForm = {
  sourceCurrency: string;
  targetCurrency: string;
};

export type WiseQuote = {
  fee: number;
  expirationTime: string | null;
  rate: number;
  targetAmount: number;
};

export type WiseExchangeTabContentProps = {
  balanceCurrencies: string[];
  currencies: CurrencyOption[];
  exchangeExecutePending: boolean;
  exchangeForm: ExchangeForm;
  exchangeQuote: WiseQuote | null;
  exchangeQuotePending: boolean;
  formatCurrency: (value: number, currency: string, locale: string) => string;
  formatDate: (value: string, options: { locale?: string; timeZone?: string }) => string;
  formatNumber: (
    value: number,
    locale: string,
    options?: Intl.NumberFormatOptions,
  ) => string;
  locale: string;
  onExecuteExchange: () => void;
  onFetchRates: () => void;
  onGetExchangeQuote: () => void;
  ratesForm: RatesForm;
  ratesResult: string | null;
  setExchangeForm: Dispatch<SetStateAction<ExchangeForm>>;
  setRatesForm: Dispatch<SetStateAction<RatesForm>>;
  t: TFunction;
  timeZone: string;
};
