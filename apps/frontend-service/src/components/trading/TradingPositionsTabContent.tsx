import type { TFunction } from 'i18next';
import { Layers, RefreshCw, Target } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatNumber } from '@/lib/utils';
import { MarginDebitPanel } from './MarginDebitPanel';
import { PositionActions, PositionHistoryButton } from './PositionActions';
import type { FuturesPosition } from './PositionActions';

type SpotPosition = {
  available: string;
  balance: string;
  currency: string;
  holds: string;
  id: string;
};

type MarginCrossAccountEntry = {
  available: string;
  currency: string;
  liability: string;
  total: string;
};

type MarginCrossPositions = {
  accounts: MarginCrossAccountEntry[];
};

type MarginIsolatedAssetDetail = {
  available: string;
  currency: string;
  liability: string;
  total: string;
};

type MarginIsolatedAsset = {
  baseAsset: MarginIsolatedAssetDetail;
  quoteAsset: MarginIsolatedAssetDetail;
  symbol: string;
};

type MarginIsolatedPositions = {
  assets: MarginIsolatedAsset[];
};

type TradingPositionsTabContentProps = {
  defaultSymbol: string;
  isFuturesMarket: boolean;
  isLoadingPositions: boolean;
  isSpotMarket: boolean;
  locale: string;
  marginCrossPositions: MarginCrossPositions | null;
  marginIsolatedPositions: MarginIsolatedPositions | null;
  onPrefillSellOrderFromAsset: (
    asset: string,
    availableAmount: number,
    marketType: 'spot' | 'margin',
    isolatedSymbol?: string,
  ) => void;
  onRefreshPositions: () => void;
  openFuturesPositions: FuturesPosition[];
  positionLiveQuotes: Record<string, number>;
  selectedMarketType: 'futures' | 'spot' | 'margin';
  selectedSymbol: string;
  spotPositions: SpotPosition[];
  t: TFunction;
};

export function TradingPositionsTabContent({
  defaultSymbol,
  isFuturesMarket,
  isLoadingPositions,
  isSpotMarket,
  locale,
  marginCrossPositions,
  marginIsolatedPositions,
  onPrefillSellOrderFromAsset,
  onRefreshPositions,
  openFuturesPositions,
  positionLiveQuotes,
  selectedMarketType,
  selectedSymbol,
  spotPositions,
  t,
}: TradingPositionsTabContentProps) {
  return (
    <div className="space-y-4 mt-6">
      <div className="flex justify-between items-center">
        <CardDescription>{t('trading.positions.subtitle')}</CardDescription>
        <div className="flex gap-2">
          {isFuturesMarket && (
            <PositionHistoryButton symbol={selectedSymbol || defaultSymbol} />
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefreshPositions}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {isLoadingPositions ? (
        <Skeleton className="h-64" />
      ) : isFuturesMarket ? (
        openFuturesPositions.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Target className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">{t('trading.positions.noPositions')}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {openFuturesPositions.map((position) => {
              const liveQuote = positionLiveQuotes[position.symbol.toUpperCase()];
              const effectiveMarkPrice = Number.isFinite(liveQuote) && liveQuote > 0 ? liveQuote : position.markPrice;
              const liveUnrealizedPnl = (effectiveMarkPrice - position.avgEntryPrice) * position.currentQty;
              const liveUnrealizedPnlPct = position.posMargin > 0 ? (liveUnrealizedPnl / position.posMargin) : 0;
              return (
                <Card key={position.id} data-testid={`card-position-${position.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <Badge
                          variant="outline"
                          className={position.currentQty > 0 ? 'text-green-500 border-green-500' : 'text-red-500 border-red-500'}
                        >
                          {position.currentQty > 0 ? 'LONG' : 'SHORT'}
                        </Badge>
                        <div>
                          <p className="font-medium">{position.symbol}</p>
                          <p className="text-sm text-muted-foreground">
                            {Math.abs(position.currentQty)} {t('trading.positions.contracts')} @ {position.realLeverage.toFixed(1)}x
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-lg font-bold ${liveUnrealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {liveUnrealizedPnl >= 0 ? '+' : ''}${liveUnrealizedPnl.toFixed(2)}
                        </p>
                        <p className={`text-sm ${liveUnrealizedPnlPct >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {liveUnrealizedPnlPct >= 0 ? '+' : ''}{(liveUnrealizedPnlPct * 100).toFixed(2)}%
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">{t('trading.positions.entryPrice')}</p>
                        <p className="font-medium">${formatNumber(position.avgEntryPrice, locale)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Cotação RT</p>
                        <p className="font-medium">
                          ${formatNumber(effectiveMarkPrice, locale)}
                          <span className="ml-2 text-xs text-green-500">WS</span>
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t('trading.positions.markPrice')}</p>
                        <p className="font-medium">${formatNumber(position.markPrice, locale)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t('trading.positions.liquidationPrice')}</p>
                        <p className="font-medium text-red-500">
                          ${formatNumber(position.liquidationPrice, locale)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t('trading.positions.margin')}</p>
                        <p className="font-medium">${position.posMargin.toFixed(2)}</p>
                      </div>
                    </div>

                    <PositionActions
                      position={position}
                      onActionComplete={onRefreshPositions}
                    />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )
      ) : isSpotMarket ? (
        spotPositions.filter((entry) => Number(entry.balance) > 0).length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Layers className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">{t('trading.positions.noSpotBalance')}</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('trading.positions.asset')}</TableHead>
                  <TableHead>{t('trading.positions.balance')}</TableHead>
                  <TableHead>{t('trading.positions.available')}</TableHead>
                  <TableHead>{t('trading.positions.hold')}</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spotPositions
                  .filter((entry) => Number(entry.balance) > 0)
                  .map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium">{entry.currency}</TableCell>
                      <TableCell>{formatNumber(Number(entry.balance), locale)}</TableCell>
                      <TableCell>{formatNumber(Number(entry.available), locale)}</TableCell>
                      <TableCell>{formatNumber(Number(entry.holds), locale)}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={Number(entry.available) <= 0 || entry.currency.toUpperCase() === 'USDT'}
                          onClick={() => onPrefillSellOrderFromAsset(entry.currency, Number(entry.available), 'spot')}
                        >
                          Vender
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </Card>
        )
      ) : marginCrossPositions || marginIsolatedPositions ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('trading.positions.asset')}</TableHead>
                <TableHead>{t('trading.positions.balance')}</TableHead>
                <TableHead>{t('trading.positions.available')}</TableHead>
                <TableHead>{t('trading.positions.liability')}</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {marginCrossPositions?.accounts.map((entry) => (
                <TableRow key={entry.currency}>
                  <TableCell className="font-medium">{entry.currency}</TableCell>
                  <TableCell>{formatNumber(Number(entry.total), locale)}</TableCell>
                  <TableCell>{formatNumber(Number(entry.available), locale)}</TableCell>
                  <TableCell>{formatNumber(Number(entry.liability), locale)}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={Number(entry.available) <= 0 || entry.currency.toUpperCase() === 'USDT'}
                      onClick={() => onPrefillSellOrderFromAsset(entry.currency, Number(entry.available), 'margin')}
                    >
                      Vender
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {marginIsolatedPositions?.assets.map((asset) => (
                <TableRow key={asset.symbol}>
                  <TableCell className="font-medium">{asset.symbol}</TableCell>
                  <TableCell>
                    {formatNumber(Number(asset.baseAsset.total), locale)} {asset.baseAsset.currency} / {formatNumber(Number(asset.quoteAsset.total), locale)} {asset.quoteAsset.currency}
                  </TableCell>
                  <TableCell>
                    {formatNumber(Number(asset.baseAsset.available), locale)} {asset.baseAsset.currency} / {formatNumber(Number(asset.quoteAsset.available), locale)} {asset.quoteAsset.currency}
                  </TableCell>
                  <TableCell>
                    {formatNumber(Number(asset.baseAsset.liability), locale)} {asset.baseAsset.currency} / {formatNumber(Number(asset.quoteAsset.liability), locale)} {asset.quoteAsset.currency}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={Number(asset.baseAsset.available) <= 0 || asset.baseAsset.currency.toUpperCase() === 'USDT'}
                      onClick={() => onPrefillSellOrderFromAsset(
                        asset.baseAsset.currency,
                        Number(asset.baseAsset.available),
                        'margin',
                        asset.symbol,
                      )}
                    >
                      Vender
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Target className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">{t('trading.positions.noPositions')}</p>
          </CardContent>
        </Card>
      )}

      {selectedMarketType === 'margin' && (
        <MarginDebitPanel defaultCurrency="USDT" />
      )}
    </div>
  );
}
