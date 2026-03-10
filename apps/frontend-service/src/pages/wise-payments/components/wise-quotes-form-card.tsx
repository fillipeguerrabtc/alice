import { Calculator, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { WiseQuotesTabContentProps } from './wise-quotes-tab-types';

type WiseQuotesFormCardProps = Pick<
  WiseQuotesTabContentProps,
  'currencies' | 'isPendingQuote' | 'onGetQuote' | 'quoteForm' | 'setQuoteForm' | 't'
>;

export function WiseQuotesFormCard({
  currencies,
  isPendingQuote,
  onGetQuote,
  quoteForm,
  setQuoteForm,
  t,
}: WiseQuotesFormCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.quotes.title')}</CardTitle>
        <CardDescription>{t('wise.quotes.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>{t('wise.quotes.from')}</Label>
            <Select
              value={quoteForm.sourceCurrency}
              onValueChange={(value: string) => setQuoteForm((prev) => ({ ...prev, sourceCurrency: value }))}
            >
              <SelectTrigger data-testid="select-quote-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((curr) => (
                  <SelectItem key={curr.code} value={curr.code}>
                    {curr.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('wise.quotes.amount')}</Label>
            <Input
              type="number"
              placeholder="1000"
              value={quoteForm.sourceAmount}
              onChange={(event) => setQuoteForm((prev) => ({ ...prev, sourceAmount: event.target.value }))}
              data-testid="input-quote-amount"
            />
          </div>
          <div className="space-y-2">
            <Label>{t('wise.quotes.to')}</Label>
            <Select
              value={quoteForm.targetCurrency}
              onValueChange={(value: string) => setQuoteForm((prev) => ({ ...prev, targetCurrency: value }))}
            >
              <SelectTrigger data-testid="select-quote-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((curr) => (
                  <SelectItem key={curr.code} value={curr.code}>
                    {curr.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              className="w-full"
              onClick={onGetQuote}
              disabled={!quoteForm.sourceAmount || isPendingQuote}
              data-testid="button-get-quote"
            >
              {isPendingQuote ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Calculator className="h-4 w-4 mr-2" />
              )}
              {t('wise.quotes.getQuote')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
