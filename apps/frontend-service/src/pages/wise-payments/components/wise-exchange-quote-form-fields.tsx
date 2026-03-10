import { ArrowLeftRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { WiseExchangeTabContentProps } from './wise-exchange-tab-types';

type WiseExchangeQuoteFormFieldsProps = Pick<
  WiseExchangeTabContentProps,
  | 'balanceCurrencies'
  | 'currencies'
  | 'exchangeForm'
  | 'exchangeQuotePending'
  | 'onGetExchangeQuote'
  | 'setExchangeForm'
  | 't'
>;

export function WiseExchangeQuoteFormFields({
  balanceCurrencies,
  currencies,
  exchangeForm,
  exchangeQuotePending,
  onGetExchangeQuote,
  setExchangeForm,
  t,
}: WiseExchangeQuoteFormFieldsProps) {
  const exchangeCurrencies = balanceCurrencies.length
    ? balanceCurrencies
    : currencies.map((curr) => curr.code);

  if (balanceCurrencies.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('wise.exchange.noBalances')}</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div className="space-y-2">
        <Label>{t('wise.exchange.from')}</Label>
        <Select
          value={exchangeForm.sourceCurrency}
          onValueChange={(value: string) => setExchangeForm((prev) => ({ ...prev, sourceCurrency: value }))}
        >
          <SelectTrigger data-testid="select-exchange-source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {exchangeCurrencies.map((currency) => (
              <SelectItem key={currency} value={currency}>
                {currency}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>{t('wise.exchange.amount')}</Label>
        <Input
          type="number"
          placeholder="1000"
          value={exchangeForm.sourceAmount}
          onChange={(event) => setExchangeForm((prev) => ({ ...prev, sourceAmount: event.target.value }))}
          data-testid="input-exchange-amount"
        />
      </div>
      <div className="space-y-2">
        <Label>{t('wise.exchange.to')}</Label>
        <Select
          value={exchangeForm.targetCurrency}
          onValueChange={(value: string) => setExchangeForm((prev) => ({ ...prev, targetCurrency: value }))}
        >
          <SelectTrigger data-testid="select-exchange-target">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {exchangeCurrencies.map((currency) => (
              <SelectItem key={currency} value={currency}>
                {currency}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-end">
        <Button
          className="w-full"
          onClick={onGetExchangeQuote}
          disabled={!exchangeForm.sourceAmount || exchangeQuotePending}
          data-testid="button-exchange-quote"
        >
          {exchangeQuotePending ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <ArrowLeftRight className="h-4 w-4 mr-2" />
          )}
          {t('wise.exchange.getQuote')}
        </Button>
      </div>
    </div>
  );
}
