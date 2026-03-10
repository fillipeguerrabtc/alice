import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { WiseExchangeTabContentProps } from './wise-exchange-tab-types';
import { WiseExchangeQuoteFormFields } from './wise-exchange-quote-form-fields';
import { WiseExchangeQuoteResultCard } from './wise-exchange-quote-result-card';

type WiseExchangeQuoteFormCardProps = Pick<
  WiseExchangeTabContentProps,
  | 'balanceCurrencies'
  | 'currencies'
  | 'exchangeExecutePending'
  | 'exchangeForm'
  | 'exchangeQuote'
  | 'exchangeQuotePending'
  | 'formatCurrency'
  | 'formatDate'
  | 'formatNumber'
  | 'locale'
  | 'onExecuteExchange'
  | 'onGetExchangeQuote'
  | 'setExchangeForm'
  | 't'
  | 'timeZone'
>;

export function WiseExchangeQuoteFormCard({
  balanceCurrencies,
  currencies,
  exchangeExecutePending,
  exchangeForm,
  exchangeQuote,
  exchangeQuotePending,
  formatCurrency,
  formatDate,
  formatNumber,
  locale,
  onExecuteExchange,
  onGetExchangeQuote,
  setExchangeForm,
  t,
  timeZone,
}: WiseExchangeQuoteFormCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.exchange.title')}</CardTitle>
        <CardDescription>{t('wise.exchange.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <WiseExchangeQuoteFormFields
          balanceCurrencies={balanceCurrencies}
          currencies={currencies}
          exchangeForm={exchangeForm}
          exchangeQuotePending={exchangeQuotePending}
          onGetExchangeQuote={onGetExchangeQuote}
          setExchangeForm={setExchangeForm}
          t={t}
        />
        <WiseExchangeQuoteResultCard
          exchangeExecutePending={exchangeExecutePending}
          exchangeForm={exchangeForm}
          exchangeQuote={exchangeQuote}
          formatCurrency={formatCurrency}
          formatDate={formatDate}
          formatNumber={formatNumber}
          locale={locale}
          onExecuteExchange={onExecuteExchange}
          t={t}
          timeZone={timeZone}
        />
      </CardContent>
    </Card>
  );
}
