import { Trash2, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { WiseBalancesTabContentProps } from './wise-balances-tab-types';

type WiseBalancesGridProps = Pick<
  WiseBalancesTabContentProps,
  | 'balances'
  | 'formatCurrency'
  | 'isLoadingBalances'
  | 'locale'
  | 'onDeleteBalance'
  | 't'
>;

export function WiseBalancesGrid({
  balances,
  formatCurrency,
  isLoadingBalances,
  locale,
  onDeleteBalance,
  t,
}: WiseBalancesGridProps) {
  if (isLoadingBalances) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (balances.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{t('wise.balances.noBalances')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {balances.map((balance) => (
        <Card key={balance.id} data-testid={`card-balance-${balance.currency}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2 justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{balance.currency}</Badge>
                <Badge variant="secondary" className="text-xs">
                  {balance.type}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onDeleteBalance(balance.id)}
                data-testid={`button-delete-balance-${balance.id}`}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(balance.amount.value, balance.currency, locale)}
            </div>
            {balance.name && (
              <p className="text-sm text-muted-foreground mt-1">{balance.name}</p>
            )}
            {balance.reservedAmount && balance.reservedAmount.value > 0 && (
              <p className="text-sm text-muted-foreground mt-1">
                {t('wise.balances.reserved')}: {' '}
                {formatCurrency(balance.reservedAmount.value, balance.currency, locale)}
              </p>
            )}
            {balance.totalWorth && (
              <p className="text-sm text-muted-foreground mt-1">
                {t('wise.balances.total')}: {' '}
                {formatCurrency(balance.totalWorth.value, balance.totalWorth.currency, locale)}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
