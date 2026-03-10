import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import {
  Activity,
  CheckCircle,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime, formatNumber } from '@/lib/utils';

type TradingOrderRow = {
  atualizadoEm: string;
  avgFilledPrice: string | null;
  clientOid: string;
  criadoEm: string;
  filledSize: string | null;
  id: string;
  kucoinOrderId: string;
  leverage: number;
  metadata: Record<string, unknown>;
  orderType: 'limit' | 'market' | 'stop_limit' | 'stop_market' | 'take_profit';
  price: string;
  side: 'buy' | 'sell';
  signalId: string | null;
  size: string;
  status: 'pending_review' | 'review_rejected' | 'pending' | 'submitted' | 'open' | 'filled' | 'cancelled' | 'rejected' | 'expired' | 'error';
  stopLoss: string | null;
  symbol: string;
  takeProfit: string | null;
  tenantId: string;
};

type TradingOrdersTabContentProps = {
  isLoadingOrders: boolean;
  isSyncingOrders: boolean;
  locale: string;
  onApproveReviewOrder: (orderId: string) => void;
  onCancelOrder: (orderId: string) => void;
  onOpenNewOrderDialog: () => void;
  onOpenOcoOrderDialog: () => void;
  onOpenReviewDialog: (order: TradingOrderRow) => void;
  onRejectReviewOrder: (orderId: string) => void;
  onSyncOrders: () => void;
  orders: TradingOrderRow[];
  renderOrderStatusBadge: (status: string) => ReactNode;
  t: TFunction;
  timeZone: string;
  tradingEnabled: boolean;
};

export function TradingOrdersTabContent({
  isLoadingOrders,
  isSyncingOrders,
  locale,
  onApproveReviewOrder,
  onCancelOrder,
  onOpenNewOrderDialog,
  onOpenOcoOrderDialog,
  onOpenReviewDialog,
  onRejectReviewOrder,
  onSyncOrders,
  orders,
  renderOrderStatusBadge,
  t,
  timeZone,
  tradingEnabled,
}: TradingOrdersTabContentProps) {
  return (
    <div className="space-y-4 mt-6">
      <div className="flex justify-between items-center">
        <CardDescription>{t('trading.orders.subtitle')}</CardDescription>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onSyncOrders}
            disabled={isSyncingOrders}
          >
            {isSyncingOrders ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {t('trading.orders.sync')}
          </Button>
          <Button
            variant="outline"
            onClick={onOpenOcoOrderDialog}
            disabled={!tradingEnabled}
          >
            <Link2 className="h-4 w-4 mr-2" />
            {t('trading.oco.button')}
          </Button>
          <Button
            onClick={onOpenNewOrderDialog}
            disabled={!tradingEnabled}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('trading.orders.new')}
          </Button>
        </div>
      </div>

      {isLoadingOrders ? (
        <Skeleton className="h-64" />
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Activity className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">{t('trading.orders.noOrders')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('trading.orders.table.id')}</TableHead>
                <TableHead>{t('trading.orders.table.symbol')}</TableHead>
                <TableHead>{t('trading.orders.table.side')}</TableHead>
                <TableHead>{t('trading.orders.table.type')}</TableHead>
                <TableHead>{t('trading.orders.table.size')}</TableHead>
                <TableHead>{t('trading.orders.table.price')}</TableHead>
                <TableHead>{t('trading.orders.table.filled')}</TableHead>
                <TableHead>{t('trading.orders.table.status')}</TableHead>
                <TableHead>{t('trading.orders.table.created')}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id} data-testid={`row-order-${order.id}`}>
                  <TableCell className="font-mono text-xs">{order.clientOid.slice(-8)}</TableCell>
                  <TableCell>{order.symbol}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={order.side === 'buy' ? 'text-green-500 border-green-500' : 'text-red-500 border-red-500'}
                    >
                      {order.side === 'buy' ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                      {order.side.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="capitalize">{order.orderType}</TableCell>
                  <TableCell>{order.size}</TableCell>
                  <TableCell>
                    {order.price ? `$${formatNumber(Number.parseFloat(order.price), locale)}` : 'Mercado'}
                  </TableCell>
                  <TableCell>
                    {order.filledSize || '0'} / {order.size}
                  </TableCell>
                  <TableCell>{renderOrderStatusBadge(order.status)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDateTime(order.criadoEm, { locale, timeZone })}
                  </TableCell>
                  <TableCell>
                    {order.status === 'pending_review' && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onOpenReviewDialog(order)}
                          data-testid={`button-review-order-${order.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onApproveReviewOrder(order.id)}
                          data-testid={`button-approve-order-${order.id}`}
                        >
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onRejectReviewOrder(order.id)}
                          data-testid={`button-reject-order-${order.id}`}
                        >
                          <X className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    )}
                    {(order.status === 'pending' || order.status === 'open') && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onCancelOrder(order.id)}
                        data-testid={`button-cancel-order-${order.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
