import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { WiseExchangeTabContentProps } from './wise-exchange-tab-types';

type WiseExchangeRatesCardProps = Pick<
  WiseExchangeTabContentProps,
  | 'onFetchRates'
  | 'ratesForm'
  | 'ratesResult'
  | 'setRatesForm'
  | 't'
>;

export function WiseExchangeRatesCard({
  onFetchRates,
  ratesForm,
  ratesResult,
  setRatesForm,
  t,
}: WiseExchangeRatesCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.rates.title')}</CardTitle>
        <CardDescription>{t('wise.rates.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <Input
            value={ratesForm.sourceCurrency}
            onChange={(event) => setRatesForm((prev) => ({ ...prev, sourceCurrency: event.target.value }))}
            placeholder={t('wise.rates.sourcePlaceholder')}
            data-testid="input-rates-source"
          />
          <Input
            value={ratesForm.targetCurrency}
            onChange={(event) => setRatesForm((prev) => ({ ...prev, targetCurrency: event.target.value }))}
            placeholder={t('wise.rates.targetPlaceholder')}
            data-testid="input-rates-target"
          />
          <Button onClick={onFetchRates} data-testid="button-rates-fetch">
            {t('wise.rates.fetch')}
          </Button>
        </div>
        <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
          {ratesResult ?? t('wise.rates.responseEmpty')}
        </pre>
      </CardContent>
    </Card>
  );
}
