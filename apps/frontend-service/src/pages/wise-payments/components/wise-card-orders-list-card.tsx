import { FileText } from 'lucide-react';
import type { TFunction } from 'i18next';
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
import type { WiseCardOrder } from './wise-card-orders-tab-types';

type WiseCardOrdersListCardProps = {
  cardOrders: WiseCardOrder[];
  formatDate: (value: string, options: { locale?: string; timeZone?: string }) => string;
  isLoadingCardOrders: boolean;
  locale: string;
  profileFilter: string;
  t: TFunction;
  timeZone: string;
};

export function WiseCardOrdersListCard({
  cardOrders,
  formatDate,
  isLoadingCardOrders,
  locale,
  profileFilter,
  t,
  timeZone,
}: WiseCardOrdersListCardProps) {
  if (!profileFilter) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <FileText className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{t('wise.cardOrders.missingProfile')}</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoadingCardOrders) {
    return <Skeleton className="h-64" />;
  }

  if (cardOrders.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <FileText className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{t('wise.cardOrders.noOrders')}</p>
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
            <TableHead>{t('wise.cardOrders.status')}</TableHead>
            <TableHead>{t('wise.cardOrders.type')}</TableHead>
            <TableHead>{t('wise.cardOrders.created')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cardOrders.map((order, index) => (
            <TableRow key={order.id ?? `${index}`} data-testid={`row-card-order-${order.id ?? index}`}>
              <TableCell className="font-mono">{order.id ?? '-'}</TableCell>
              <TableCell>{order.status ?? '-'}</TableCell>
              <TableCell>{order.cardType ?? '-'}</TableCell>
              <TableCell>
                {order.created ? formatDate(order.created, { locale, timeZone }) : '-'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
