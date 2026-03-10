import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { getTradingAutoSignalAssetsCatalog } from '@/services/api/trading';
import type { TradingAutoSignalAsset } from '@/services/api/trading';
import type { TradingSymbolsResponse } from './TradingDomainTypes';

type UseTradingSymbolAssetQueriesOptions = {
  selectedMarginMode: 'cross' | 'isolated';
  selectedMarketType: 'futures' | 'spot' | 'margin';
  statusIsConfigured: boolean;
  statusRequiresTenant: boolean;
  symbolsRefetchInterval: number;
};

export function useTradingSymbolAssetQueries({
  selectedMarginMode,
  selectedMarketType,
  statusIsConfigured,
  statusRequiresTenant,
  symbolsRefetchInterval,
}: UseTradingSymbolAssetQueriesOptions) {
  const {
    data: symbolsData,
    isLoading: isLoadingSymbols,
    error: symbolsError,
  } = useQuery<{ success: boolean; data: TradingSymbolsResponse }>({
    queryKey: ['/api/integrations/trading/symbols', selectedMarketType, selectedMarginMode],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('marketType', selectedMarketType);
      if (selectedMarketType === 'margin') {
        params.set('marginMode', selectedMarginMode);
      }
      const res = await apiRequest('GET', `/api/integrations/trading/symbols?${params.toString()}`);
      return res.json();
    },
    refetchInterval: symbolsRefetchInterval,
    enabled: statusIsConfigured && !statusRequiresTenant,
  });

  const availableSymbols = symbolsData?.data?.symbols ?? [];
  const favoriteSymbols = symbolsData?.data?.favorites ?? [];
  const featuredOverride = symbolsData?.data?.featured ?? [];
  const topSymbols = symbolsData?.data?.topSymbols ?? [];
  const featuredSymbols = featuredOverride.length > 0 ? featuredOverride : topSymbols;

  const {
    data: autoSignalAssetsCatalog,
    isLoading: isLoadingAutoSignalAssets,
    error: autoSignalAssetsError,
  } = useQuery({
    queryKey: ['/api/trading/auto/assets'],
    queryFn: getTradingAutoSignalAssetsCatalog,
    refetchInterval: symbolsRefetchInterval,
    enabled: statusIsConfigured && !statusRequiresTenant,
  });

  const autoSignalAssets = autoSignalAssetsCatalog?.assets ?? [];
  const autoSignalAssetMap = useMemo(
    () => new Map<string, TradingAutoSignalAsset>(autoSignalAssets.map((asset) => [asset.key, asset])),
    [autoSignalAssets]
  );
  const autoSignalAssetOptions = useMemo(
    () => autoSignalAssets.map((asset) => ({ value: asset.key, label: asset.label || `${asset.venue.toUpperCase()} · ${asset.marketType} · ${asset.symbol}` })),
    [autoSignalAssets]
  );

  return {
    autoSignalAssetMap,
    autoSignalAssetOptions,
    autoSignalAssets,
    autoSignalAssetsCatalog,
    autoSignalAssetsError,
    availableSymbols,
    favoriteSymbols,
    featuredOverride,
    featuredSymbols,
    isLoadingAutoSignalAssets,
    isLoadingSymbols,
    symbolsData,
    symbolsError,
    topSymbols,
  };
}
