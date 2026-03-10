import { TabsContent } from '@/components/ui/tabs';
import { WiseQuotesFormCard } from './wise-quotes-form-card';
import { WiseQuotesResultCard } from './wise-quotes-result-card';
import type { WiseQuotesTabContentProps } from './wise-quotes-tab-types';

export function WiseQuotesTabContent({
  currencies,
  formatCurrency,
  formatDate,
  formatNumber,
  isPendingQuote,
  locale,
  onGetQuote,
  quote,
  quoteForm,
  setQuoteForm,
  t,
  timeZone,
}: WiseQuotesTabContentProps) {
  return (
    <TabsContent value="quotes" className="space-y-4 mt-6">
      <WiseQuotesFormCard
        currencies={currencies}
        isPendingQuote={isPendingQuote}
        onGetQuote={onGetQuote}
        quoteForm={quoteForm}
        setQuoteForm={setQuoteForm}
        t={t}
      />
      <WiseQuotesResultCard
        formatCurrency={formatCurrency}
        formatDate={formatDate}
        formatNumber={formatNumber}
        locale={locale}
        quote={quote}
        quoteForm={quoteForm}
        t={t}
        timeZone={timeZone}
      />
    </TabsContent>
  );
}
