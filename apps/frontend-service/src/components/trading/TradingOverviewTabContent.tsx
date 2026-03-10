import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import {
  Activity,
  Brain,
  CheckCircle,
  DollarSign,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/utils';

type AccountMode = 'futures' | 'spot' | 'margin';

type FuturesAccountSummary = {
  equity: number;
  frozenFunds: number;
  marginBalance: number;
  orderMargin: number;
  positionMargin: number;
};

type SpotAccountSummary = {
  assetsWithBalance: number;
  baseAvailable: number;
  baseBalance: number;
  baseCurrency: string;
  quoteAvailable: number;
  quoteBalance: number;
  quoteCurrency: string;
};

type MarginAccountSummary = {
  debtRatio: number;
  totalAsset: number;
  totalLiability: number;
};

type TradingOverviewSignal = {
  confidence: number;
  id: string;
  metadata: {
    generationSource?: 'on_demand' | 'scheduler' | 'chat';
    [key: string]: unknown;
  };
  signalType: string;
  sourceModel: string | null;
  symbol: string;
};

type TradingOverviewOrder = {
  id: string;
  price: string;
  side: 'buy' | 'sell';
  size: string;
  status: 'pending_review' | 'review_rejected' | 'pending' | 'submitted' | 'open' | 'filled' | 'cancelled' | 'rejected' | 'expired' | 'error';
  symbol: string;
};

type TradingOverviewTabContentProps = {
  accountMode: AccountMode;
  bestAskPrice: string;
  bestBidPrice: string;
  futuresSummary: FuturesAccountSummary;
  isLoadingAccount: boolean;
  isLoadingOrders: boolean;
  isLoadingSignals: boolean;
  isSyncingOrders: boolean;
  locale: string;
  marginSummary: MarginAccountSummary;
  onApproveReviewOrder: (orderId: string) => void;
  onCancelOrder: (orderId: string) => void;
  onDeactivateSignal: (signalId: string) => void;
  onOpenNewOrderDialog: () => void;
  onOpenNewSignalDialog: () => void;
  onOpenReviewDialog: (orderId: string) => void;
  onQuickOrder: (side: 'buy' | 'sell') => void;
  onRejectReviewOrder: (orderId: string) => void;
  onSyncOrders: () => void;
  orders: TradingOverviewOrder[];
  renderOrderStatusBadge: (status: string) => ReactNode;
  renderSignalTypeBadge: (signalType: string) => ReactNode;
  signals: TradingOverviewSignal[];
  spotSummary: SpotAccountSummary;
  t: TFunction;
  tradingEnabled: boolean;
};

export function TradingOverviewTabContent({
  accountMode,
  bestAskPrice,
  bestBidPrice,
  futuresSummary,
  isLoadingAccount,
  isLoadingOrders,
  isLoadingSignals,
  isSyncingOrders,
  locale,
  marginSummary,
  onApproveReviewOrder,
  onCancelOrder,
  onDeactivateSignal,
  onOpenNewOrderDialog,
  onOpenNewSignalDialog,
  onOpenReviewDialog,
  onQuickOrder,
  onRejectReviewOrder,
  onSyncOrders,
  orders,
  renderOrderStatusBadge,
  renderSignalTypeBadge,
  signals,
  spotSummary,
  t,
  tradingEnabled,
}: TradingOverviewTabContentProps) {
  return (
    <div className="space-y-4 mt-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Rocket className="h-5 w-5" />
              {t('trading.quickTrade.title')}
            </CardTitle>
            <CardDescription>{t('trading.quickTrade.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                className="h-16 bg-green-600 hover:bg-green-700"
                onClick={() => onQuickOrder('buy')}
                disabled={!tradingEnabled}
                data-testid="button-quick-buy"
              >
                <div className="flex flex-col items-center">
                  <TrendingUp className="h-5 w-5 mb-1" />
                  <span>{t('trading.quickTrade.buy')}</span>
                </div>
              </Button>
              <Button
                className="h-16 bg-red-600 hover:bg-red-700"
                onClick={() => onQuickOrder('sell')}
                disabled={!tradingEnabled}
                data-testid="button-quick-sell"
              >
                <div className="flex flex-col items-center">
                  <TrendingDown className="h-5 w-5 mb-1" />
                  <span>{t('trading.quickTrade.sell')}</span>
                </div>
              </Button>
            </div>

            <Separator />

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('trading.quickTrade.bestBid')}</span>
                <span className="text-green-500 font-mono">
                  ${bestBidPrice || '-'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('trading.quickTrade.bestAsk')}</span>
                <span className="text-red-500 font-mono">
                  ${bestAskPrice || '-'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('trading.quickTrade.spread')}</span>
                <span className="font-mono">
                  ${formatNumber(
                    parseFloat(bestAskPrice || '0') - parseFloat(bestBidPrice || '0'),
                    locale,
                    { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                  )}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              {t('trading.account.title')}
            </CardTitle>
            <CardDescription>{t('trading.account.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingAccount ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : accountMode === 'futures' ? (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('trading.account.equity')}</span>
                  <span className="font-medium">${formatNumber(futuresSummary.equity, locale)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('trading.account.marginBalance')}</span>
                  <span className="font-medium">${formatNumber(futuresSummary.marginBalance, locale)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('trading.account.positionMargin')}</span>
                  <span className="font-medium">${formatNumber(futuresSummary.positionMargin, locale)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('trading.account.orderMargin')}</span>
                  <span className="font-medium">${formatNumber(futuresSummary.orderMargin, locale)}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('trading.account.frozenFunds')}</span>
                  <span className="font-medium">${formatNumber(futuresSummary.frozenFunds, locale)}</span>
                </div>
              </div>
            ) : accountMode === 'spot' ? (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t('trading.account.availableBalance')} {spotSummary.baseCurrency}
                  </span>
                  <span className="font-medium">{formatNumber(spotSummary.baseAvailable, locale)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t('trading.account.totalBalance')} {spotSummary.baseCurrency}
                  </span>
                  <span className="font-medium">{formatNumber(spotSummary.baseBalance, locale)}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t('trading.account.availableBalance')} {spotSummary.quoteCurrency}
                  </span>
                  <span className="font-medium">{formatNumber(spotSummary.quoteAvailable, locale)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t('trading.account.totalBalance')} {spotSummary.quoteCurrency}
                  </span>
                  <span className="font-medium">{formatNumber(spotSummary.quoteBalance, locale)}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('trading.account.assetsWithBalance')}</span>
                  <span className="font-medium">{formatNumber(spotSummary.assetsWithBalance, locale)}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('trading.account.totalAsset')}</span>
                  <span className="font-medium">${formatNumber(marginSummary.totalAsset, locale)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('trading.account.totalLiability')}</span>
                  <span className="font-medium">${formatNumber(marginSummary.totalLiability, locale)}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('trading.account.debtRatio')}</span>
                  <span className="font-medium">
                    {formatNumber(marginSummary.debtRatio * 100, locale, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                    %
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Brain className="h-4 w-4" />
                {t('trading.signals.recent')}
              </CardTitle>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenNewSignalDialog}
              data-testid="button-new-signal"
            >
              <Plus className="h-4 w-4 mr-1" />
              {t('trading.signals.new')}
            </Button>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[200px]">
              {isLoadingSignals ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : signals.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <Brain className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-sm">{t('trading.signals.noSignals')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {signals.slice(0, 5).map((signal) => (
                    <div
                      key={signal.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                    >
                      <div className="flex items-center gap-2">
                        {renderSignalTypeBadge(signal.signalType)}
                        <div>
                          <p className="text-sm font-medium">{signal.symbol}</p>
                          <p className="text-xs text-muted-foreground">
                            {t('trading.signals.confidence')}: {(Math.max(0, Math.min(1, signal.confidence)) * 100).toFixed(0)}%
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {signal.metadata?.generationSource
                            ? t(`trading.signals.source.${signal.metadata.generationSource}`)
                            : (signal.sourceModel || t('common.notAvailable'))}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => onDeactivateSignal(signal.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4" />
                {t('trading.orders.recent')}
              </CardTitle>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onSyncOrders}
                disabled={isSyncingOrders}
                data-testid="button-sync-orders"
              >
                {isSyncingOrders ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1" />
                )}
                {t('trading.orders.sync')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenNewOrderDialog}
                disabled={!tradingEnabled}
                data-testid="button-new-order"
              >
                <Plus className="h-4 w-4 mr-1" />
                {t('trading.orders.new')}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[200px]">
              {isLoadingOrders ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : orders.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <Activity className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-sm">{t('trading.orders.noOrders')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {orders.slice(0, 5).map((order) => (
                    <div
                      key={order.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                    >
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={order.side === 'buy' ? 'text-green-500 border-green-500' : 'text-red-500 border-red-500'}
                        >
                          {order.side === 'buy' ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                          {order.side.toUpperCase()}
                        </Badge>
                        <div>
                          <p className="text-sm font-medium">
                            {order.size} @ {order.price ? `$${order.price}` : 'Mercado'}
                          </p>
                          <p className="text-xs text-muted-foreground">{order.symbol}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {renderOrderStatusBadge(order.status)}
                        {order.status === 'pending_review' && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => onOpenReviewDialog(order.id)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-green-600"
                              onClick={() => onApproveReviewOrder(order.id)}
                            >
                              <CheckCircle className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive"
                              onClick={() => onRejectReviewOrder(order.id)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                        {(order.status === 'pending' || order.status === 'open') && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive"
                            onClick={() => onCancelOrder(order.id)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
