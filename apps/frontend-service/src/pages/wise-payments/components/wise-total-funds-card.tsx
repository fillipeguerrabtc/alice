import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { WiseBalancesTabContentProps } from './wise-balances-tab-types';

type WiseTotalFundsCardProps = Pick<
  WiseBalancesTabContentProps,
  | 'onFetchTotalFunds'
  | 'setTotalFundsCurrency'
  | 't'
  | 'totalFundsCurrency'
  | 'totalFundsResult'
>;

export function WiseTotalFundsCard({
  onFetchTotalFunds,
  setTotalFundsCurrency,
  t,
  totalFundsCurrency,
  totalFundsResult,
}: WiseTotalFundsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.totalFunds.title')}</CardTitle>
        <CardDescription>{t('wise.totalFunds.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Input
            value={totalFundsCurrency}
            onChange={(event) => setTotalFundsCurrency(event.target.value)}
            placeholder={t('wise.totalFunds.currencyPlaceholder')}
            data-testid="input-total-funds-currency"
          />
          <Button onClick={onFetchTotalFunds} data-testid="button-total-funds">
            {t('wise.totalFunds.fetch')}
          </Button>
        </div>
        <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
          {totalFundsResult ?? t('wise.totalFunds.responseEmpty')}
        </pre>
      </CardContent>
    </Card>
  );
}
