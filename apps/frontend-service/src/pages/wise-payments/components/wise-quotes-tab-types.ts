import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';

export type CurrencyOption = {
  code: string;
  name: string;
};

export type QuoteForm = {
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: string;
};

export type WiseQuote = {
  fee: number;
  rate: number;
  targetAmount: number;
  deliveryEstimate: string | null;
  formattedEstimatedDelivery: string | null;
};

export type WiseQuotesTabContentProps = {
  currencies: CurrencyOption[];
  formatCurrency: (value: number, currency: string, locale: string) => string;
  formatDate: (value: string, options: { locale?: string; timeZone?: string }) => string;
  formatNumber: (
    value: number,
    locale: string,
    options?: Intl.NumberFormatOptions,
  ) => string;
  isPendingQuote: boolean;
  locale: string;
  onGetQuote: () => void;
  quote: WiseQuote | null;
  quoteForm: QuoteForm;
  setQuoteForm: Dispatch<SetStateAction<QuoteForm>>;
  t: TFunction;
  timeZone: string;
};
