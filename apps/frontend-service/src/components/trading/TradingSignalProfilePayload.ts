import type { SignalProfilePayload, TradingProfileForm } from './TradingDomainTypes';

type BuildTradingSignalProfilePayloadOptions = {
  form: TradingProfileForm;
  selectedMarketType: 'futures' | 'spot' | 'margin';
  selectedSymbol: string;
};

export function buildTradingSignalProfilePayload(
  options: BuildTradingSignalProfilePayloadOptions
): SignalProfilePayload {
  const { form, selectedMarketType, selectedSymbol } = options;
  return {
    kind: 'signal',
    marketType: selectedMarketType,
    symbol: selectedSymbol || undefined,
    timeframes: form.timeframes,
    indicators: form.indicators,
    dataSources: form.dataSources,
    newsConfig: form.newsConfig,
    techniques: form.techniques,
    ensembleConfig: form.ensembleConfig,
    arbitrageConfig: form.arbitrageConfig ?? undefined,
    modelConfig: form.modelConfig,
    consensus: form.consensus,
  };
}

export function isTradingSignalProfilePayloadComplete(payload: SignalProfilePayload): boolean {
  return payload.timeframes.length > 0
    && payload.indicators.length > 0
    && payload.techniques.length > 0;
}
