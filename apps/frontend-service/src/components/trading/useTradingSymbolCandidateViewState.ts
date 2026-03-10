import { useMemo } from 'react';
import type { TFunction } from 'i18next';

type UseTradingSymbolCandidateViewStateOptions = {
  availableSymbols: string[];
  favoriteSymbols: string[];
  featuredSymbols: string[];
  t: TFunction;
};

type SymbolSelectItem = {
  kind: 'label' | 'symbol';
  value: string;
  isFavorite?: boolean;
  isFeatured?: boolean;
  label?: string;
};

export function useTradingSymbolCandidateViewState({
  availableSymbols,
  favoriteSymbols,
  featuredSymbols,
  t,
}: UseTradingSymbolCandidateViewStateOptions) {
  const symbolOptions = useMemo(() => {
    if (availableSymbols.length === 0) return [];
    const alphabetic = [...availableSymbols].sort((a, b) => a.localeCompare(b));
    const featuredSet = new Set(featuredSymbols);
    const favoritesSet = new Set(favoriteSymbols);
    const featuredList = featuredSymbols.filter((symbol) => featuredSet.has(symbol));
    const favoritesList = favoriteSymbols.filter((symbol) => !featuredSet.has(symbol));
    const remaining = alphabetic.filter((symbol) => !featuredSet.has(symbol) && !favoritesSet.has(symbol));
    return [...featuredList, ...favoritesList, ...remaining];
  }, [availableSymbols, favoriteSymbols, featuredSymbols]);

  const symbolSelectItems = useMemo<SymbolSelectItem[]>(() => {
    const items: SymbolSelectItem[] = [];
    const featuredSet = new Set(featuredSymbols);
    const favoritesSet = new Set(favoriteSymbols);
    const featuredList = featuredSymbols.filter((symbol) => featuredSet.has(symbol));
    const favoritesList = favoriteSymbols.filter((symbol) => !featuredSet.has(symbol));
    const remaining = symbolOptions.filter((symbol) => !featuredSet.has(symbol) && !favoritesSet.has(symbol));

    if (featuredList.length > 0) {
      items.push({ kind: 'label', value: '__featured', label: t('trading.symbols.featured') });
      featuredList.forEach((symbol) => items.push({ kind: 'symbol', value: symbol, isFeatured: true }));
    }
    if (favoritesList.length > 0) {
      items.push({ kind: 'label', value: '__favorites', label: t('trading.symbols.favorites') });
      favoritesList.forEach((symbol) => items.push({ kind: 'symbol', value: symbol, isFavorite: true }));
    }
    if (remaining.length > 0) {
      items.push({ kind: 'label', value: '__all', label: t('trading.symbols.all') });
      remaining.forEach((symbol) => items.push({ kind: 'symbol', value: symbol }));
    }
    return items;
  }, [favoriteSymbols, featuredSymbols, symbolOptions, t]);

  return {
    symbolOptions,
    symbolSelectItems,
  };
}
