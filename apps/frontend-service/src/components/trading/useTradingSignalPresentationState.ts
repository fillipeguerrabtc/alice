import { useMemo } from 'react';
import type { TFunction } from 'i18next';
import type { TradingProfileForm } from './TradingDomainTypes';

type TradingIntervalsData = {
  data?: {
    granularityMap?: Record<string, number>;
    intervals?: string[];
    restOrderBookDepths?: number[];
    wsIntervalMap?: Record<string, string>;
    wsOrderBookDepths?: number[];
  };
};

type TradingSignalArbitrageCatalogResponse = {
  data?: {
    exchanges?: Array<{
      id: string;
      label: string;
    }>;
    intermediateAssets?: string[];
  };
  success: boolean;
};

type UseTradingSignalPresentationStateOptions = {
  defaultArbitrageMaxIntervalMinutes: number;
  fallbackIntervalMinutes: Record<string, number>;
  intervalsData?: TradingIntervalsData;
  selectedInterval: string;
  signalArbitrageCatalogResponse?: TradingSignalArbitrageCatalogResponse;
  signalProfileForm: TradingProfileForm;
  t: TFunction;
};

export function useTradingSignalPresentationState({
  defaultArbitrageMaxIntervalMinutes,
  fallbackIntervalMinutes,
  intervalsData,
  selectedInterval,
  signalArbitrageCatalogResponse,
  signalProfileForm,
  t,
}: UseTradingSignalPresentationStateOptions) {
  const intervalOptions = useMemo(() => {
    const intervals = intervalsData?.data?.intervals ?? [];
    return intervals.map((interval) => ({
      value: interval,
      label: t(`trading.chart.timeframes.${interval}`, { defaultValue: interval }),
    }));
  }, [intervalsData, t]);

  const signalIntervalOptions = useMemo(
    () => intervalOptions.map((option) => ({ value: option.value, label: option.label })),
    [intervalOptions],
  );

  const signalArbitrageCatalog = signalArbitrageCatalogResponse?.success
    ? signalArbitrageCatalogResponse.data
    : undefined;

  const availableSignalArbitrageExchanges = signalArbitrageCatalog?.exchanges?.length
    ? signalArbitrageCatalog.exchanges
    : [{ id: 'kucoin', label: 'KuCoin' }];

  const availableSignalArbitrageAssets = signalArbitrageCatalog?.intermediateAssets?.length
    ? signalArbitrageCatalog.intermediateAssets
    : (signalProfileForm.arbitrageConfig?.intermediateAssets ?? []);

  const signalSourceOptions = useMemo(() => ([
    {
      value: 'orderBook',
      label: t('trading.signals.profile.sourcesOrderBookTitle'),
      description: t('trading.signals.profile.sourcesOrderBookDesc'),
    },
    {
      value: 'news',
      label: t('trading.signals.profile.sourcesNewsTitle'),
      description: t('trading.signals.profile.sourcesNewsDesc'),
    },
    {
      value: 'trainingData',
      label: t('trading.signals.profile.sourcesTrainingTitle'),
      description: t('trading.signals.profile.sourcesTrainingDesc'),
    },
  ]), [t]);

  const selectedSignalSources = useMemo(
    () => Object.entries(signalProfileForm.dataSources)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key),
    [signalProfileForm.dataSources],
  );

  const wsInterval = useMemo(() => {
    if (!selectedInterval) return '';
    const mapped = intervalsData?.data?.wsIntervalMap?.[selectedInterval] ?? '';
    return mapped || selectedInterval;
  }, [intervalsData, selectedInterval]);

  const granularityValue = useMemo(() => {
    if (!selectedInterval) return null;
    return intervalsData?.data?.granularityMap?.[selectedInterval] ?? null;
  }, [intervalsData, selectedInterval]);

  const signalIntervalMinutesMap = useMemo(
    () => intervalsData?.data?.granularityMap ?? fallbackIntervalMinutes,
    [fallbackIntervalMinutes, intervalsData],
  );

  const signalArbitrageInvalidFrames = useMemo(() => {
    if (!signalProfileForm.techniques.includes('arbitrage_triangular')) return [];
    const maxMinutes = signalProfileForm.arbitrageConfig?.maxIntervalMinutes ?? defaultArbitrageMaxIntervalMinutes;
    return signalProfileForm.timeframes.filter((frame) => {
      const minutes = signalIntervalMinutesMap[frame] ?? Infinity;
      return minutes > maxMinutes;
    });
  }, [
    defaultArbitrageMaxIntervalMinutes,
    signalIntervalMinutesMap,
    signalProfileForm.arbitrageConfig?.maxIntervalMinutes,
    signalProfileForm.techniques,
    signalProfileForm.timeframes,
  ]);

  const isSignalArbitrageInvalid = signalArbitrageInvalidFrames.length > 0;
  const signalArbitrageErrorMessage = isSignalArbitrageInvalid
    ? t('trading.errors.arbitrageTimeframesInvalid', {
      max: signalProfileForm.arbitrageConfig?.maxIntervalMinutes ?? defaultArbitrageMaxIntervalMinutes,
      frames: signalArbitrageInvalidFrames.join(', '),
    })
    : '';

  const wsOrderBookDepth = useMemo<5 | 50 | null>(() => {
    const depths = intervalsData?.data?.wsOrderBookDepths ?? [];
    if (!depths.length) return null;
    return Math.min(...depths) as 5 | 50;
  }, [intervalsData]);

  const restOrderBookDepth = useMemo(() => {
    const depths = intervalsData?.data?.restOrderBookDepths ?? [];
    if (!depths.length) return null;
    return Math.min(...depths);
  }, [intervalsData]);

  return {
    availableSignalArbitrageAssets,
    availableSignalArbitrageExchanges,
    granularityValue,
    intervalOptions,
    isSignalArbitrageInvalid,
    restOrderBookDepth,
    selectedSignalSources,
    signalArbitrageErrorMessage,
    signalIntervalOptions,
    signalSourceOptions,
    wsInterval,
    wsOrderBookDepth,
  };
}
