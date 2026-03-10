import { useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';

type UseTradingSymbolPreferencesOptions = {
  favoriteSymbols: string[];
  featuredOverride: string[];
  selectedMarginMode: 'cross' | 'isolated';
  selectedMarketType: 'futures' | 'spot' | 'margin';
};

export function useTradingSymbolPreferences(options: UseTradingSymbolPreferencesOptions) {
  const {
    favoriteSymbols,
    featuredOverride,
    selectedMarginMode,
    selectedMarketType,
  } = options;

  const updateSymbolPrefsMutation = useMutation({
    mutationFn: async (payload: {
      marketType: 'futures' | 'spot' | 'margin';
      marginMode?: 'cross' | 'isolated';
      favorites?: string[];
      featured?: string[];
    }) => {
      const response = await apiRequest('PUT', '/api/integrations/trading/symbol-preferences', payload);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/symbols'] });
    },
  });

  const toggleFavorite = useCallback((symbol: string) => {
    const next = favoriteSymbols.includes(symbol)
      ? favoriteSymbols.filter((item) => item !== symbol)
      : [...favoriteSymbols, symbol];
    updateSymbolPrefsMutation.mutate({
      marketType: selectedMarketType,
      marginMode: selectedMarginMode,
      favorites: next,
      featured: featuredOverride,
    });
  }, [favoriteSymbols, featuredOverride, selectedMarginMode, selectedMarketType, updateSymbolPrefsMutation]);

  const toggleFeatured = useCallback((symbol: string) => {
    const next = featuredOverride.includes(symbol)
      ? featuredOverride.filter((item) => item !== symbol)
      : [...featuredOverride, symbol];
    updateSymbolPrefsMutation.mutate({
      marketType: selectedMarketType,
      marginMode: selectedMarginMode,
      favorites: favoriteSymbols,
      featured: next,
    });
  }, [favoriteSymbols, featuredOverride, selectedMarginMode, selectedMarketType, updateSymbolPrefsMutation]);

  return {
    toggleFavorite,
    toggleFeatured,
    updateSymbolPrefsMutation,
  };
}
