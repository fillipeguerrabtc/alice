import type { TFunction } from 'i18next';
import { Loader2, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatNumber } from '@/lib/utils';

type TradingHistoryItem = {
  avgFilledPrice: string | null;
  criadoEm: string;
  filledSize: string | null;
  id: string;
  orderType: string;
  price: string;
  side: 'buy' | 'sell';
  size: string;
  status: string;
  symbol: string;
};

type TradingHistoryTabContentProps = {
  allOrderHistorySelected: boolean;
  deleteOrderHistoryPending: boolean;
  hasOrderHistorySelection: boolean;
  isAdminRole: boolean;
  locale: string;
  onDeleteAllMine: () => void;
  onDeleteAllTenant: () => void;
  onDeleteSelected: () => void;
  onFetchOrderHistory: () => void;
  onToggleOrderHistorySelectAll: (checked: boolean) => void;
  onToggleOrderHistorySelection: (orderId: string, checked: boolean) => void;
  orderHistoryHasMore: boolean;
  orderHistoryItems: TradingHistoryItem[];
  orderHistoryLoading: boolean;
  orderHistorySelectedIds: Set<string>;
  renderOrderStatusBadge: (status: string) => ReactNode;
  t: TFunction;
  timeZone: string;
};

export function TradingHistoryTabContent({
  allOrderHistorySelected,
  deleteOrderHistoryPending,
  hasOrderHistorySelection,
  isAdminRole,
  locale,
  onDeleteAllMine,
  onDeleteAllTenant,
  onDeleteSelected,
  onFetchOrderHistory,
  onToggleOrderHistorySelectAll,
  onToggleOrderHistorySelection,
  orderHistoryHasMore,
  orderHistoryItems,
  orderHistoryLoading,
  orderHistorySelectedIds,
  renderOrderStatusBadge,
  t,
  timeZone,
}: TradingHistoryTabContentProps) {
  return (
    <div className="space-y-4 mt-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('trading.history.title')}</CardTitle>
          <CardDescription>{t('trading.history.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Button
              variant="destructive"
              disabled={!hasOrderHistorySelection || deleteOrderHistoryPending}
              onClick={onDeleteSelected}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t('trading.history.actions.deleteSelected')}
            </Button>
            <Button
              variant="outline"
              disabled={deleteOrderHistoryPending}
              onClick={onDeleteAllMine}
            >
              {t('trading.history.actions.deleteAllMine')}
            </Button>
            {isAdminRole && (
              <Button
                variant="outline"
                disabled={deleteOrderHistoryPending}
                onClick={onDeleteAllTenant}
              >
                {t('trading.history.actions.deleteAllTenant')}
              </Button>
            )}
          </div>

          {orderHistoryLoading ? (
            <Skeleton className="h-64" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allOrderHistorySelected}
                      onCheckedChange={(checked) => onToggleOrderHistorySelectAll(Boolean(checked))}
                    />
                  </TableHead>
                  <TableHead>{t('trading.history.table.date')}</TableHead>
                  <TableHead>{t('trading.history.table.type')}</TableHead>
                  <TableHead>{t('trading.history.table.symbol')}</TableHead>
                  <TableHead>{t('trading.history.table.side')}</TableHead>
                  <TableHead>{t('trading.history.table.size')}</TableHead>
                  <TableHead>{t('trading.history.table.price')}</TableHead>
                  <TableHead>{t('trading.history.table.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderHistoryItems.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Checkbox
                        checked={orderHistorySelectedIds.has(order.id)}
                        onCheckedChange={(checked) => onToggleOrderHistorySelection(order.id, Boolean(checked))}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(order.criadoEm, { locale, timeZone })}
                    </TableCell>
                    <TableCell className="capitalize">{order.orderType}</TableCell>
                    <TableCell>{order.symbol}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={order.side === 'buy' ? 'text-green-500 border-green-500' : 'text-red-500 border-red-500'}
                      >
                        {order.side.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>{order.filledSize || order.size}</TableCell>
                    <TableCell>
                      ${formatNumber(parseFloat(order.avgFilledPrice || order.price), locale)}
                    </TableCell>
                    <TableCell>{renderOrderStatusBadge(order.status)}</TableCell>
                  </TableRow>
                ))}
                {orderHistoryItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      {t('trading.history.empty')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          <div className="flex items-center justify-between mt-4">
            <span className="text-xs text-muted-foreground">
              {t('trading.history.loadedCount', { count: orderHistoryItems.length })}
            </span>
            <Button
              variant="outline"
              disabled={!orderHistoryHasMore || orderHistoryLoading}
              onClick={onFetchOrderHistory}
            >
              {orderHistoryLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {t('trading.history.loadMore')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
