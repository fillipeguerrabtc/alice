import type { TFunction } from 'i18next';
import { LineChart, Pause, Pin, Play, Settings, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type MarketType = 'futures' | 'spot' | 'margin';
type MarginMode = 'cross' | 'isolated';

type SymbolSelectItem =
  {
    isFavorite?: boolean;
    isFeatured?: boolean;
    kind: 'label' | 'symbol';
    label?: string;
    value: string;
  };

type TradingHeaderSectionProps = {
  favoriteSymbols: string[];
  featuredOverride: string[];
  featuredSymbols: string[];
  isLoadingSymbols: boolean;
  isTradingEnabled: boolean;
  isUpdatingSymbolPrefs: boolean;
  onMarketTypeChange: (value: MarketType) => void;
  onMarginModeChange: (value: MarginMode) => void;
  onOpenRiskConfigDialog: () => void;
  onSelectFeaturedSymbol: (symbol: string) => void;
  onSymbolChange: (value: string) => void;
  onToggleFavorite: (symbol: string) => void;
  onToggleFeatured: (symbol: string) => void;
  selectedMarginMode: MarginMode;
  selectedMarketType: MarketType;
  selectedSymbol: string;
  symbolOptionsLength: number;
  symbolSelectItems: SymbolSelectItem[];
  t: TFunction;
  wsConnecting: boolean;
  wsEnabled: boolean;
  wsHealthy: boolean;
};

export function TradingHeaderSection({
  favoriteSymbols,
  featuredOverride,
  featuredSymbols,
  isLoadingSymbols,
  isTradingEnabled,
  isUpdatingSymbolPrefs,
  onMarketTypeChange,
  onMarginModeChange,
  onOpenRiskConfigDialog,
  onSelectFeaturedSymbol,
  onSymbolChange,
  onToggleFavorite,
  onToggleFeatured,
  selectedMarginMode,
  selectedMarketType,
  selectedSymbol,
  symbolOptionsLength,
  symbolSelectItems,
  t,
  wsConnecting,
  wsEnabled,
  wsHealthy,
}: TradingHeaderSectionProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-trading-title">
          <LineChart className="h-6 w-6 text-primary" />
          {t('trading.title')}
        </h1>
        <p className="text-muted-foreground">{t('trading.subtitle')}</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {isTradingEnabled ? (
          <Badge variant="default" className="bg-green-500">
            <Play className="h-3 w-3 mr-1" />
            {t('trading.status.enabled')}
          </Badge>
        ) : (
          <Badge variant="secondary">
            <Pause className="h-3 w-3 mr-1" />
            {t('trading.status.disabled')}
          </Badge>
        )}

        <Select
          value={selectedMarketType}
          onValueChange={onMarketTypeChange}
          data-testid="select-market-type"
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="futures">{t('trading.marketType.futures')}</SelectItem>
            <SelectItem value="spot">{t('trading.marketType.spot')}</SelectItem>
            <SelectItem value="margin">{t('trading.marketType.margin')}</SelectItem>
          </SelectContent>
        </Select>

        {selectedMarketType === 'margin' ? (
          <Select
            value={selectedMarginMode}
            onValueChange={onMarginModeChange}
            data-testid="select-margin-mode"
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cross">{t('trading.marginMode.cross')}</SelectItem>
              <SelectItem value="isolated">{t('trading.marginMode.isolated')}</SelectItem>
            </SelectContent>
          </Select>
        ) : null}

        <Select
          value={selectedSymbol}
          onValueChange={onSymbolChange}
          disabled={isLoadingSymbols || symbolOptionsLength === 0}
        >
          <SelectTrigger className="w-[180px]" data-testid="select-symbol">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-60 overflow-y-auto">
            {symbolSelectItems.map((item) => {
              if (item.kind === 'label') {
                return (
                  <SelectItem
                    key={item.value}
                    value={item.value}
                    disabled
                    className="text-xs uppercase text-muted-foreground"
                  >
                    {item.label ?? item.value}
                  </SelectItem>
                );
              }

              return (
                <SelectItem key={item.value} value={item.value}>
                  <span className="flex items-center gap-2">
                    {item.isFeatured ? <Pin className="h-3 w-3 text-blue-400" /> : null}
                    {item.isFavorite ? <Star className="h-3 w-3 text-yellow-400" /> : null}
                    {item.value}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={() => onToggleFavorite(selectedSymbol)}
          disabled={!selectedSymbol || isUpdatingSymbolPrefs}
        >
          {favoriteSymbols.includes(selectedSymbol) ? (
            <Star className="h-4 w-4 text-yellow-400" />
          ) : (
            <Star className="h-4 w-4" />
          )}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => onToggleFeatured(selectedSymbol)}
          disabled={!selectedSymbol || isUpdatingSymbolPrefs}
        >
          {featuredOverride.includes(selectedSymbol) ? (
            <Pin className="h-4 w-4 text-blue-400" />
          ) : (
            <Pin className="h-4 w-4" />
          )}
        </Button>

        {wsEnabled ? (
          <div className="flex items-center gap-1.5 text-xs px-2">
            <span
              className={`h-2 w-2 rounded-full ${
                wsHealthy ? 'bg-green-500 animate-pulse' : (wsConnecting ? 'bg-yellow-500' : 'bg-red-500')
              }`}
            />
            <span className="text-muted-foreground">
              {wsHealthy ? 'Live' : (wsConnecting ? 'Connecting...' : 'Offline')}
            </span>
          </div>
        ) : null}

        <Button
          variant="outline"
          size="sm"
          onClick={onOpenRiskConfigDialog}
          data-testid="button-risk-config"
        >
          <Settings className="h-4 w-4 mr-2" />
          {t('trading.riskConfig.title')}
        </Button>
      </div>

      {featuredSymbols.length > 0 ? (
        <div className="flex items-center gap-2 flex-wrap">
          {featuredSymbols.map((symbol) => (
            <Button
              key={symbol}
              variant={symbol === selectedSymbol ? 'default' : 'outline'}
              size="sm"
              onClick={() => onSelectFeaturedSymbol(symbol)}
              className="h-7 px-2 text-xs"
            >
              {symbol}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
