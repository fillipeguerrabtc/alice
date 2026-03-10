import { ArrowLeftRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { WiseExchangeTabContentProps } from './wise-exchange-tab-types';

type WiseExchangeQuoteResultCardProps = Pick<
  WiseExchangeTabContentProps,
  | 'exchangeExecutePending'
  | 'exchangeForm'
  | 'exchangeQuote'
  | 'formatCurrency'
  | 'formatDate'
  | 'formatNumber'
  | 'locale'
  | 'onExecuteExchange'
  | 't'
  | 'timeZone'
>;

export function WiseExchangeQuoteResultCard({
  exchangeExecutePending,
  exchangeForm,
  exchangeQuote,
  formatCurrency,
  formatDate,
  formatNumber,
  locale,
  onExecuteExchange,
  t,
  timeZone,
}: WiseExchangeQuoteResultCardProps) {
  if (!exchangeQuote) {
    return null;
  }

  return (
    <Card className="mt-4 bg-muted/50">
      <CardContent className="pt-6 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{t('wise.quotes.rate')}</p>
            <p className="text-lg font-medium">
              {formatNumber(exchangeQuote.rate, locale, {
                minimumFractionDigits: 4,
                maximumFractionDigits: 4,
              })}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t('wise.quotes.fee')}</p>
            <p className="text-lg font-medium">
              {formatCurrency(exchangeQuote.fee, exchangeForm.sourceCurrency, locale)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t('wise.exchange.receive')}</p>
            <p className="text-lg font-medium text-green-600">
              {formatCurrency(exchangeQuote.targetAmount, exchangeForm.targetCurrency, locale)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t('wise.quotes.expires')}</p>
            <p className="text-lg font-medium">
              {exchangeQuote.expirationTime
                ? formatDate(exchangeQuote.expirationTime, { locale, timeZone })
                : '-'}
            </p>
          </div>
        </div>
        <Button onClick={onExecuteExchange} disabled={exchangeExecutePending} data-testid="button-exchange-execute">
          {exchangeExecutePending ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <ArrowLeftRight className="h-4 w-4 mr-2" />
          )}
          {t('wise.exchange.execute')}
        </Button>
      </CardContent>
    </Card>
  );
}
