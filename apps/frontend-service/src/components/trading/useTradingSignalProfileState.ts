import { useEffect, useState } from 'react';
import { DEFAULT_ARBITRAGE_CONFIG, MAX_ARBITRAGE_ASSETS } from './TradingSignalConfig';
import { createDefaultSignalProfileForm } from './TradingFormDefaults';
import type { TradingProfileForm } from './TradingDomainTypes';

type UseTradingSignalProfileStateParams = {
  selectedInterval: string;
  defaultInterval: string;
};

export function useTradingSignalProfileState({ selectedInterval, defaultInterval }: UseTradingSignalProfileStateParams) {
  const [signalProfileForm, setSignalProfileForm] = useState<TradingProfileForm>(() => createDefaultSignalProfileForm(selectedInterval, defaultInterval));

  const updateSignalTimeframes = (next: string[]) => {
    setSignalProfileForm((prev) => ({
      ...prev,
      timeframes: next,
    }));
  };

  const updateSignalIndicators = (next: string[]) => {
    setSignalProfileForm((prev) => ({
      ...prev,
      indicators: next,
    }));
  };

  const updateSignalTechniques = (next: string[]) => {
    setSignalProfileForm((prev) => ({
      ...prev,
      techniques: next,
    }));
  };

  const updateSignalArbitrageConfig = (updates: Partial<NonNullable<TradingProfileForm['arbitrageConfig']>>) => {
    setSignalProfileForm((prev) => ({
      ...prev,
      arbitrageConfig: {
        ...(prev.arbitrageConfig ?? DEFAULT_ARBITRAGE_CONFIG),
        ...updates,
      },
    }));
  };

  const updateSignalArbitrageExchanges = (next: string[]) => {
    const unique = Array.from(new Set(next.map((value) => value.trim()).filter(Boolean)));
    updateSignalArbitrageConfig({ exchanges: unique });
  };

  const updateSignalArbitrageAssets = (next: string[]) => {
    const normalized = Array.from(new Set(next.map((value) => value.trim().toUpperCase()).filter(Boolean)));
    updateSignalArbitrageConfig({ intermediateAssets: normalized.slice(0, MAX_ARBITRAGE_ASSETS) });
  };

  const updateSignalSources = (next: string[]) => {
    const selected = new Set(next);
    setSignalProfileForm((prev) => ({
      ...prev,
      dataSources: {
        orderBook: selected.has('orderBook'),
        news: selected.has('news'),
        trainingData: selected.has('trainingData'),
      },
    }));
  };

  useEffect(() => {
    const hasArbitrage = signalProfileForm.techniques.includes('arbitrage_triangular');
    setSignalProfileForm((prev) => {
      if (hasArbitrage && !prev.arbitrageConfig) {
        return { ...prev, arbitrageConfig: DEFAULT_ARBITRAGE_CONFIG };
      }
      if (!hasArbitrage && prev.arbitrageConfig) {
        return { ...prev, arbitrageConfig: null };
      }
      return prev;
    });
  }, [signalProfileForm.techniques]);

  return {
    signalProfileForm,
    setSignalProfileForm,
    updateSignalTimeframes,
    updateSignalIndicators,
    updateSignalTechniques,
    updateSignalArbitrageConfig,
    updateSignalArbitrageExchanges,
    updateSignalArbitrageAssets,
    updateSignalSources,
  };
}
