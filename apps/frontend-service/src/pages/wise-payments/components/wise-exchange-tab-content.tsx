import { TabsContent } from '@/components/ui/tabs';
import { WiseExchangeQuoteFormCard } from './wise-exchange-quote-form-card';
import { WiseExchangeRatesCard } from './wise-exchange-rates-card';
import type { WiseExchangeTabContentProps } from './wise-exchange-tab-types';

export function WiseExchangeTabContent({
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
  onFetchRates,
  onGetExchangeQuote,
  ratesForm,
  ratesResult,
  setExchangeForm,
  setRatesForm,
  t,
  timeZone,
}: WiseExchangeTabContentProps) {
  return (
    <TabsContent value="exchange" className="space-y-4 mt-6">
      <WiseExchangeQuoteFormCard
        balanceCurrencies={balanceCurrencies}
        currencies={currencies}
        exchangeExecutePending={exchangeExecutePending}
        exchangeForm={exchangeForm}
        exchangeQuote={exchangeQuote}
        exchangeQuotePending={exchangeQuotePending}
        formatCurrency={formatCurrency}
        formatDate={formatDate}
        formatNumber={formatNumber}
        locale={locale}
        onExecuteExchange={onExecuteExchange}
        onGetExchangeQuote={onGetExchangeQuote}
        setExchangeForm={setExchangeForm}
        t={t}
        timeZone={timeZone}
      />

      <WiseExchangeRatesCard
        onFetchRates={onFetchRates}
        ratesForm={ratesForm}
        ratesResult={ratesResult}
        setRatesForm={setRatesForm}
        t={t}
      />
    </TabsContent>
  );
}
