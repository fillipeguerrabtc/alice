import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { WiseBalancesTabContentProps } from './wise-balances-tab-types';

type WiseBalanceCapacityCardProps = Pick<
  WiseBalancesTabContentProps,
  | 'balanceCapacityCurrency'
  | 'balanceCapacityResult'
  | 'onFetchBalanceCapacity'
  | 'setBalanceCapacityCurrency'
  | 't'
>;

export function WiseBalanceCapacityCard({
  balanceCapacityCurrency,
  balanceCapacityResult,
  onFetchBalanceCapacity,
  setBalanceCapacityCurrency,
  t,
}: WiseBalanceCapacityCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.balanceCapacity.title')}</CardTitle>
        <CardDescription>{t('wise.balanceCapacity.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Input
            value={balanceCapacityCurrency}
            onChange={(event) => setBalanceCapacityCurrency(event.target.value)}
            placeholder={t('wise.balanceCapacity.currencyPlaceholder')}
            data-testid="input-balance-capacity-currency"
          />
          <Button onClick={onFetchBalanceCapacity} data-testid="button-balance-capacity">
            {t('wise.balanceCapacity.fetch')}
          </Button>
        </div>
        <pre className="text-xs bg-muted rounded-md p-3 overflow-auto">
          {balanceCapacityResult ?? t('wise.balanceCapacity.responseEmpty')}
        </pre>
      </CardContent>
    </Card>
  );
}
