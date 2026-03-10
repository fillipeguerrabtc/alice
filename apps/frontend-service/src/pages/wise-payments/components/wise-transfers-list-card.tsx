import { Send } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { WiseTransfersTabContentProps } from './wise-transfers-tab-types';

type WiseTransfersListCardProps = Pick<
  WiseTransfersTabContentProps,
  | 'formatCurrency'
  | 'formatDate'
  | 'getStatusBadge'
  | 'isLoadingTransfers'
  | 'locale'
  | 't'
  | 'timeZone'
  | 'transfers'
>;

export function WiseTransfersListCard({
  formatCurrency,
  formatDate,
  getStatusBadge,
  isLoadingTransfers,
  locale,
  t,
  timeZone,
  transfers,
}: WiseTransfersListCardProps) {
  if (isLoadingTransfers) {
    return <Skeleton className="h-64" />;
  }

  if (transfers.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Send className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{t('wise.transfers.noTransfers')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>{t('wise.transfers.amount')}</TableHead>
            <TableHead>{t('wise.transfers.recipient')}</TableHead>
            <TableHead>{t('wise.transfers.reference')}</TableHead>
            <TableHead>{t('wise.transfers.status')}</TableHead>
            <TableHead>{t('wise.transfers.created')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transfers.map((transfer) => (
            <TableRow key={transfer.id} data-testid={`row-transfer-${transfer.id}`}>
              <TableCell className="font-mono">{transfer.id}</TableCell>
              <TableCell>
                <div className="font-medium">
                  {formatCurrency(transfer.sourceValue, transfer.sourceCurrency, locale)}
                </div>
                <div className="text-sm text-muted-foreground">
                  → {formatCurrency(transfer.targetValue, transfer.targetCurrency, locale)}
                </div>
              </TableCell>
              <TableCell>{transfer.targetAccount}</TableCell>
              <TableCell>{transfer.reference || '-'}</TableCell>
              <TableCell>{getStatusBadge(transfer.status)}</TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(transfer.created, { locale, timeZone })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
