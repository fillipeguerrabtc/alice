import { FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { WiseAccountDetailsTabContentProps } from './wise-account-details-tab-types';

type WiseAccountDetailsOrdersCardProps = Pick<
  WiseAccountDetailsTabContentProps,
  'accountDetailsOrders' | 'isLoadingAccountDetailsOrders' | 't'
>;

type WiseAccountOrderRecord = {
  currency?: string;
  id?: string;
  status?: string;
};

export function WiseAccountDetailsOrdersCard({
  accountDetailsOrders,
  isLoadingAccountDetailsOrders,
  t,
}: WiseAccountDetailsOrdersCardProps) {
  if (isLoadingAccountDetailsOrders) {
    return <Skeleton className="h-40" />;
  }

  if (accountDetailsOrders.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8">
          <FileText className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-muted-foreground">{t('wise.accountDetails.noOrders')}</p>
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
            <TableHead>{t('wise.accountDetails.status')}</TableHead>
            <TableHead>{t('wise.accountDetails.currency')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accountDetailsOrders.map((rawOrder, index) => {
            const order = rawOrder as WiseAccountOrderRecord;
            const rowId = order.id ?? `${index}`;
            return (
              <TableRow key={rowId} data-testid={`row-account-order-${rowId}`}>
                <TableCell className="font-mono">{order.id ?? '-'}</TableCell>
                <TableCell>{order.status ?? '-'}</TableCell>
                <TableCell>{order.currency ?? '-'}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
