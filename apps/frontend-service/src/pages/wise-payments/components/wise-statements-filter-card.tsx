import { History, RefreshCw } from 'lucide-react';
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
import type { WiseStatementsTabContentProps } from './wise-statements-tab-types';

type WiseStatementsFilterCardProps = Pick<
  WiseStatementsTabContentProps,
  | 'balances'
  | 'isPendingStatement'
  | 'onFetchStatement'
  | 'onStatementFieldChange'
  | 'statementCurrencies'
  | 'statementForm'
  | 't'
>;

export function WiseStatementsFilterCard({
  balances,
  isPendingStatement,
  onFetchStatement,
  onStatementFieldChange,
  statementCurrencies,
  statementForm,
  t,
}: WiseStatementsFilterCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('wise.history.title')}</CardTitle>
        <CardDescription>{t('wise.history.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>{t('wise.history.balance')}</Label>
            <Select
              value={statementForm.balanceId}
              onValueChange={(value) => onStatementFieldChange('balanceId', value)}
            >
              <SelectTrigger data-testid="select-statement-balance">
                <SelectValue placeholder={t('wise.history.balancePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {balances.map((balance) => (
                  <SelectItem key={balance.id} value={String(balance.id)}>
                    {balance.currency} • {balance.type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('wise.history.currency')}</Label>
            <Select
              value={statementForm.currency}
              onValueChange={(value) => onStatementFieldChange('currency', value)}
            >
              <SelectTrigger data-testid="select-statement-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statementCurrencies.map((currency) => (
                  <SelectItem key={currency} value={currency}>
                    {currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('wise.history.start')}</Label>
            <Input
              type="date"
              value={statementForm.intervalStart}
              onChange={(event) => onStatementFieldChange('intervalStart', event.target.value)}
              data-testid="input-statement-start"
            />
          </div>
          <div className="space-y-2">
            <Label>{t('wise.history.end')}</Label>
            <Input
              type="date"
              value={statementForm.intervalEnd}
              onChange={(event) => onStatementFieldChange('intervalEnd', event.target.value)}
              data-testid="input-statement-end"
            />
          </div>
        </div>
        <Button onClick={onFetchStatement} disabled={isPendingStatement} data-testid="button-fetch-statement">
          {isPendingStatement ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <History className="h-4 w-4 mr-2" />
          )}
          {t('wise.history.fetch')}
        </Button>
      </CardContent>
    </Card>
  );
}
