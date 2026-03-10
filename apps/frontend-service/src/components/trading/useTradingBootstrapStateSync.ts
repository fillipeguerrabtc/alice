import { useEffect } from 'react';

type TradingPortfolio = {
  id: string;
};

type TradingStatusData = {
  data?: {
    defaultSymbol?: string;
  };
};

type TradingSymbolsData = {
  data?: {
    defaultSymbol?: string;
    symbols?: string[];
  };
};

type TradingIntervalsData = {
  data?: {
    defaultInterval?: string;
    intervals?: string[];
  };
};

type TradingSignalArbitrageCatalogResponse = {
  data: {
    effectiveFeePct: number;
  };
  success: boolean;
};

type TradingSignalProfileForm = {
  arbitrageConfig?: {
    feePct: number;
  } | null;
};

type UseTradingBootstrapStateSyncOptions = {
  autoMix: boolean;
  autoSelectAllAssets: boolean;
  autoSignalAllModes: string[];
  autoSignalAssetMap: Map<string, unknown>;
  autoUniverseScope: 'all' | 'futures' | 'margin' | 'spot';
  intervalsData?: TradingIntervalsData;
  sanitizedSymbol: string;
  selectedInterval: string;
  selectedPortfolioAutoId: string;
  setAllowedModes: React.Dispatch<React.SetStateAction<string[]>>;
  setAutoSelectAllAssets: React.Dispatch<React.SetStateAction<boolean>>;
  setAutoSelectedAssetKeys: React.Dispatch<React.SetStateAction<string[]>>;
  setAutoUniverseScope: React.Dispatch<React.SetStateAction<'all' | 'futures' | 'margin' | 'spot'>>;
  setSelectedInterval: React.Dispatch<React.SetStateAction<string>>;
  setSelectedPortfolioAutoId: React.Dispatch<React.SetStateAction<string>>;
  setSelectedSymbol: React.Dispatch<React.SetStateAction<string>>;
  setSymbolReady: React.Dispatch<React.SetStateAction<boolean>>;
  signalArbitrageCatalogResponse?: TradingSignalArbitrageCatalogResponse;
  signalProfileForm: TradingSignalProfileForm;
  statusData?: TradingStatusData;
  symbolsData?: TradingSymbolsData;
  tradingPortfolios: TradingPortfolio[];
  updateSignalArbitrageConfig: (patch: { feePct: number }) => void;
};

export function useTradingBootstrapStateSync({
  autoMix,
  autoSelectAllAssets,
  autoSignalAllModes,
  autoSignalAssetMap,
  autoUniverseScope,
  intervalsData,
  sanitizedSymbol,
  selectedInterval,
  selectedPortfolioAutoId,
  setAllowedModes,
  setAutoSelectAllAssets,
  setAutoSelectedAssetKeys,
  setAutoUniverseScope,
  setSelectedInterval,
  setSelectedPortfolioAutoId,
  setSelectedSymbol,
  setSymbolReady,
  signalArbitrageCatalogResponse,
  signalProfileForm,
  statusData,
  symbolsData,
  tradingPortfolios,
  updateSignalArbitrageConfig,
}: UseTradingBootstrapStateSyncOptions) {
  useEffect(() => {
    if (!selectedPortfolioAutoId && tradingPortfolios.length > 0) {
      setSelectedPortfolioAutoId(tradingPortfolios[0].id);
    }
  }, [selectedPortfolioAutoId, setSelectedPortfolioAutoId, tradingPortfolios]);

  useEffect(() => {
    if (!signalProfileForm.arbitrageConfig || !signalArbitrageCatalogResponse?.success) return;
    const effectiveFee = signalArbitrageCatalogResponse.data.effectiveFeePct;
    if (Number.isFinite(effectiveFee) && effectiveFee !== signalProfileForm.arbitrageConfig.feePct) {
      updateSignalArbitrageConfig({ feePct: effectiveFee });
    }
  }, [signalArbitrageCatalogResponse, signalProfileForm.arbitrageConfig, updateSignalArbitrageConfig]);

  useEffect(() => {
    setAutoSelectedAssetKeys((previous) => {
      const filtered = previous.filter((key) => autoSignalAssetMap.has(key));
      if (filtered.length === previous.length && filtered.every((value, index) => value === previous[index])) {
        return previous;
      }
      return filtered;
    });
  }, [autoSignalAssetMap, setAutoSelectedAssetKeys]);

  useEffect(() => {
    if (!autoMix) return;
    if (autoUniverseScope !== 'all') {
      setAutoUniverseScope('all');
    }
    if (!autoSelectAllAssets) {
      setAutoSelectAllAssets(true);
    }
    setAllowedModes((previous) => {
      const previousSet = new Set(previous);
      const isAlreadyAll = previousSet.size === autoSignalAllModes.length
        && autoSignalAllModes.every((mode) => previousSet.has(mode));
      return isAlreadyAll ? previous : [...autoSignalAllModes];
    });
  }, [
    autoMix,
    autoSelectAllAssets,
    autoSignalAllModes,
    autoUniverseScope,
    setAllowedModes,
    setAutoSelectAllAssets,
    setAutoUniverseScope,
  ]);

  useEffect(() => {
    const symbols = symbolsData?.data?.symbols ?? [];
    if (symbols.length === 0) return;

    // D4: Fallback seguro - preferir defaultSymbol do endpoint (já filtrado por marketType),
    // depois defaultSymbol do status, e apenas em último caso o primeiro da lista.
    // Sempre validar que o símbolo preferido está na lista de símbolos válidos para o market type atual.
    const apiDefault = symbolsData?.data?.defaultSymbol;
    const statusDefault = statusData?.data?.defaultSymbol;
    const firstAvailable = symbols[0] ?? '';

    // D1: Priorizar símbolo que EXISTA na lista do market type atual
    const preferred = (apiDefault && symbols.includes(apiDefault)) ? apiDefault
      : (statusDefault && symbols.includes(statusDefault)) ? statusDefault
      : firstAvailable;

    // CORREÇÃO: validar símbolo antes de marcar como ready
    if (!preferred) {
      setSymbolReady(false);
      return;
    }

    if (!sanitizedSymbol || !symbols.includes(sanitizedSymbol)) {
      setSelectedSymbol(preferred);
    }

    setSymbolReady(true);
  }, [sanitizedSymbol, setSelectedSymbol, setSymbolReady, statusData, symbolsData]);

  useEffect(() => {
    const intervals = intervalsData?.data?.intervals ?? [];
    if (intervals.length === 0) return;
    if (!selectedInterval || !intervals.includes(selectedInterval)) {
      const fallback = intervalsData?.data?.defaultInterval || intervals[0];
      setSelectedInterval(fallback);
    }
  }, [intervalsData, selectedInterval, setSelectedInterval]);
}
