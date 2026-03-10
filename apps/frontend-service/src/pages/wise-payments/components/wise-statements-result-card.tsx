import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { WiseStatementsTabContentProps } from './wise-statements-tab-types';

type WiseStatementsResultCardProps = Pick<
  WiseStatementsTabContentProps,
  'formatCurrency' | 'formatDate' | 'locale' | 'statementData' | 't' | 'timeZone'
>;

export function WiseStatementsResultCard({
  formatCurrency,
  formatDate,
  locale,
  statementData,
  t,
  timeZone,
}: WiseStatementsResultCardProps) {
  if (!statementData || statementData.transactions.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('wise.history.noHistory')}</p>;
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('wise.history.date')}</TableHead>
            <TableHead>{t('wise.history.type')}</TableHead>
            <TableHead>{t('wise.history.amount')}</TableHead>
            <TableHead>{t('wise.history.fees')}</TableHead>
            <TableHead>{t('wise.history.reference')}</TableHead>
            <TableHead>{t('wise.history.balanceAfter')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {statementData.transactions.map((row, index) => (
            <TableRow key={`${row.date}-${index}`}>
              <TableCell>{formatDate(row.date, { locale, timeZone })}</TableCell>
              <TableCell>{row.type}</TableCell>
              <TableCell>{formatCurrency(row.amount.value, row.amount.currency, locale)}</TableCell>
              <TableCell>
                {row.totalFees
                  ? formatCurrency(row.totalFees.value, row.totalFees.currency, locale)
                  : '-'}
              </TableCell>
              <TableCell>{row.reference || '-'}</TableCell>
              <TableCell>
                {row.runningBalance
                  ? formatCurrency(row.runningBalance.value, row.runningBalance.currency, locale)
                  : '-'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
