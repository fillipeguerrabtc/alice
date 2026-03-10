import type { TFunction } from 'i18next';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  DollarSign,
  Layers,
  Percent,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/utils';

type TradingStatsPrimaryRowProps = {
  accountMode: 'futures' | 'spot' | 'margin';
  currentPrice: number;
  futuresAvailableBalance: number;
  futuresCurrency: string | undefined;
  futuresUnrealisedPnl: number;
  isLoadingAccount: boolean;
  isLoadingMarket: boolean;
  locale: string;
  marginTotalAsset: number;
  marginTotalLiability: number;
  marketHighPrice: number;
  marketLowPrice: number;
  marketVolumeOf24h: number;
  priceChange: number;
  priceChangePercent: number;
  quoteCurrency: string | null;
  selectedSymbol: string;
  spotQuoteAvailable: number;
  spotAssetsWithBalance: number;
  t: TFunction;
  wsConfigured: boolean;
  wsHealthy: boolean;
  wsPrivateEnabled: boolean;
  wsPrivateState: string;
  wsPublicState: string;
};

type TradingStatsSecondaryRowProps = {
  activeSignals: number;
  circuitBreakerFailures: number;
  circuitBreakerState: string;
  fundingRate: number;
  isFuturesMarket: boolean;
  locale: string;
  maxLeverage: number;
  openPositionsCount: number;
  pendingOrders: number;
  t: TFunction;
};

function PriceDisplay({
  change,
  changePercent,
  locale,
  price,
}: {
  change: number;
  changePercent: number;
  locale: string;
  price: number;
}) {
  const isPositive = change >= 0;

  return (
    <div className="flex items-baseline gap-2">
      <span className="text-3xl font-bold tabular-nums">
        ${formatNumber(price, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <div className={`flex items-center gap-1 text-sm ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
        {isPositive ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
        <span>
          {isPositive ? '+' : ''}
          {formatNumber(change, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <span>
          ({isPositive ? '+' : ''}
          {formatNumber(changePercent * 100, locale, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
          %)
        </span>
      </div>
    </div>
  );
}

function StatCard({
  className = '',
  icon: Icon,
  isLoading,
  subtitle,
  title,
  trend,
  value,
}: {
  className?: string;
  icon: typeof Activity;
  isLoading?: boolean;
  subtitle?: string;
  title: string;
  trend?: 'up' | 'down' | 'neutral';
  value: string | number;
}) {
  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="p-4">
          <Skeleton className="h-4 w-20 mb-2" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-3 w-16 mt-1" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{title}</p>
          <Icon className={`h-4 w-4 ${
            trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-muted-foreground'
          }`}
          />
        </div>
        <p className="text-2xl font-bold mt-1">{value}</p>
        {subtitle ? <p className="text-xs text-muted-foreground mt-1">{subtitle}</p> : null}
      </CardContent>
    </Card>
  );
}

function CircuitBreakerStatus({
  failures,
  state,
}: {
  failures: number;
  state: string;
}) {
  const color = (() => {
    switch (state.toLowerCase()) {
      case 'closed': return 'bg-green-500';
      case 'open': return 'bg-red-500';
      case 'half_open': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  })();

  return (
    <div className="flex items-center gap-2">
      <div className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-sm">{state}</span>
      {failures > 0 ? (
        <Badge variant="destructive" className="text-xs">
          {failures} falhas
        </Badge>
      ) : null}
    </div>
  );
}

export function TradingStatsPrimaryRow({
  accountMode,
  currentPrice,
  futuresAvailableBalance,
  futuresCurrency,
  futuresUnrealisedPnl,
  isLoadingAccount,
  isLoadingMarket,
  locale,
  marginTotalAsset,
  marginTotalLiability,
  marketHighPrice,
  marketLowPrice,
  marketVolumeOf24h,
  priceChange,
  priceChangePercent,
  quoteCurrency,
  selectedSymbol,
  spotQuoteAvailable,
  spotAssetsWithBalance,
  t,
  wsConfigured,
  wsHealthy,
  wsPrivateEnabled,
  wsPrivateState,
  wsPublicState,
}: TradingStatsPrimaryRowProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card className="md:col-span-2">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-muted-foreground">
              {selectedSymbol} - {t('trading.market.lastPrice')}
            </p>
            <div className="flex items-center gap-2">
              {wsConfigured ? (
                <Badge
                  variant="outline"
                  className={`text-xs ${wsHealthy ? 'text-green-600 border-green-600' : ''}`}
                  title={`KuCoin WS public=${wsPublicState} private=${wsPrivateEnabled ? wsPrivateState : 'disabled'}`}
                >
                  WS: {wsPublicState}
                </Badge>
              ) : null}
              <Badge variant="outline" className="text-xs">
                {t('trading.market.live')}
              </Badge>
            </div>
          </div>
          {isLoadingMarket ? (
            <Skeleton className="h-10 w-64" />
          ) : (
            <PriceDisplay
              change={priceChange}
              changePercent={priceChangePercent}
              locale={locale}
              price={currentPrice}
            />
          )}
          <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
            <div>
              <p className="text-muted-foreground">{t('trading.market.high24h')}</p>
              <p className="font-medium">${marketHighPrice ? formatNumber(marketHighPrice, locale) : '-'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t('trading.market.low24h')}</p>
              <p className="font-medium">${marketLowPrice ? formatNumber(marketLowPrice, locale) : '-'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t('trading.market.volume24h')}</p>
              <p className="font-medium">{marketVolumeOf24h ? formatNumber(marketVolumeOf24h, locale) : '-'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <StatCard
        title={accountMode === 'margin' ? t('trading.account.totalAsset') : t('trading.account.availableBalance')}
        value={
          isLoadingAccount
            ? '-'
            : `$${formatNumber(
                accountMode === 'futures'
                  ? futuresAvailableBalance
                  : accountMode === 'spot'
                    ? spotQuoteAvailable
                    : marginTotalAsset,
                locale,
                { minimumFractionDigits: 2, maximumFractionDigits: 2 }
              )}`
        }
        subtitle={accountMode === 'futures' ? futuresCurrency : (quoteCurrency ?? t('trading.account.multiCurrency'))}
        icon={DollarSign}
        isLoading={isLoadingAccount}
      />

      {accountMode === 'futures' ? (
        <StatCard
          title={t('trading.account.unrealisedPnl')}
          value={
            isLoadingAccount
              ? '-'
              : `$${formatNumber(futuresUnrealisedPnl, locale, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`
          }
          subtitle={t('trading.account.allPositions')}
          icon={futuresUnrealisedPnl >= 0 ? TrendingUp : TrendingDown}
          trend={futuresUnrealisedPnl >= 0 ? 'up' : 'down'}
          isLoading={isLoadingAccount}
        />
      ) : accountMode === 'spot' ? (
        <StatCard
          title={t('trading.account.assetsWithBalance')}
          value={isLoadingAccount ? '-' : formatNumber(spotAssetsWithBalance, locale)}
          subtitle={t('trading.account.assetsSubtitle')}
          icon={Layers}
          isLoading={isLoadingAccount}
        />
      ) : (
        <StatCard
          title={t('trading.account.totalLiability')}
          value={
            isLoadingAccount
              ? '-'
              : `$${formatNumber(marginTotalLiability, locale, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`
          }
          subtitle={quoteCurrency ?? t('trading.account.multiCurrency')}
          icon={AlertTriangle}
          isLoading={isLoadingAccount}
        />
      )}
    </div>
  );
}

export function TradingStatsSecondaryRow({
  activeSignals,
  circuitBreakerFailures,
  circuitBreakerState,
  fundingRate,
  isFuturesMarket,
  locale,
  maxLeverage,
  openPositionsCount,
  pendingOrders,
  t,
}: TradingStatsSecondaryRowProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
      <StatCard
        title={t('trading.stats.activeSignals')}
        value={formatNumber(activeSignals, locale)}
        icon={Zap}
      />
      <StatCard
        title={t('trading.stats.pendingOrders')}
        value={formatNumber(pendingOrders, locale)}
        icon={Clock}
      />
      <StatCard
        title={t('trading.stats.openPositions')}
        value={formatNumber(openPositionsCount, locale)}
        icon={Activity}
      />
      <StatCard
        title={t('trading.stats.fundingRate')}
        value={isFuturesMarket
          ? `${formatNumber(fundingRate * 100, locale, {
              minimumFractionDigits: 4,
              maximumFractionDigits: 4,
            })}%`
          : '-'}
        icon={Percent}
      />
      <StatCard
        title={t('trading.stats.maxLeverage')}
        value={isFuturesMarket ? `${formatNumber(maxLeverage, locale)}x` : '-'}
        icon={Target}
      />
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground mb-1">{t('trading.stats.circuitBreaker')}</p>
          <CircuitBreakerStatus
            state={circuitBreakerState}
            failures={circuitBreakerFailures}
          />
        </CardContent>
      </Card>
    </div>
  );
}
