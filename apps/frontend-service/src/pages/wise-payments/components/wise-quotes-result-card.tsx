import { Card, CardContent } from '@/components/ui/card';
import type { WiseQuotesTabContentProps } from './wise-quotes-tab-types';

type WiseQuotesResultCardProps = Pick<
  WiseQuotesTabContentProps,
  'formatCurrency' | 'formatDate' | 'formatNumber' | 'locale' | 'quote' | 'quoteForm' | 't' | 'timeZone'
>;

export function WiseQuotesResultCard({
  formatCurrency,
  formatDate,
  formatNumber,
  locale,
  quote,
  quoteForm,
  t,
  timeZone,
}: WiseQuotesResultCardProps) {
  if (!quote) {
    return null;
  }

  return (
    <Card className="bg-muted/50">
      <CardContent className="pt-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{t('wise.quotes.rate')}</p>
            <p className="text-lg font-medium">
              {formatNumber(quote.rate, locale, {
                minimumFractionDigits: 4,
                maximumFractionDigits: 4,
              })}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t('wise.quotes.fee')}</p>
            <p className="text-lg font-medium">{formatCurrency(quote.fee, quoteForm.sourceCurrency, locale)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t('wise.quotes.receive')}</p>
            <p className="text-lg font-medium text-green-600">
              {formatCurrency(quote.targetAmount, quoteForm.targetCurrency, locale)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t('wise.quotes.delivery')}</p>
            <p className="text-lg font-medium">
              {quote.deliveryEstimate
                ? formatDate(quote.deliveryEstimate, { locale, timeZone })
                : (quote.formattedEstimatedDelivery ?? '-')}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
