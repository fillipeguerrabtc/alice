import { getDatabase, schema } from '@alice/database';
import type {
  TradingEnsembleConfig,
  TradingEnsembleResult,
  TradingIndicatorKey,
  TradingTechnique,
  TradingTechniqueScore,
} from '@alice/shared';
import * as technicalIndicators from './technical-indicators.js';
import type { TradingMarketType } from './tradingTypes.js';

type TradingMarginMode = 'cross' | 'isolated';
type TradingIntervalValue =
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '8h'
  | '12h'
  | '1d'
  | '1w';

type RawKline = {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};

export function createTradingTechnicalAnalysisService(deps: {
  resolveTradingIntervalGranularity: (interval: string) => number | null | undefined;
  resolveTradingSymbolStrict: (
    auth: { tenantId: string; userId: string },
    symbol: string,
    marketType?: TradingMarketType,
    marginMode?: TradingMarginMode,
  ) => Promise<string>;
  getSpotKlines: (
    symbol: string,
    granularityLabel: string,
    fromSeconds: number,
    toSeconds: number,
  ) => Promise<RawKline[]>;
  getFuturesKlines: (
    symbol: string,
    granularity: number,
    from: number,
    to: number,
  ) => Promise<RawKline[]>;
  buildEnsembleResult: (
    techniqueScores: TradingTechniqueScore[],
    ensembleConfig: TradingEnsembleConfig,
  ) => TradingEnsembleResult;
  defaultTradingTechniques: readonly TradingTechnique[];
  defaultTradingEnsembleConfig: TradingEnsembleConfig;
}) {
  async function calculateAndPersistTechnicalAnalysis(params: {
    tenantId: string;
    userId: string;
    symbol: string;
    interval: string;
    marketType?: TradingMarketType;
    marginMode?: TradingMarginMode;
    enabledIndicators?: TradingIndicatorKey[];
    techniques?: TradingTechnique[];
    ensembleConfig?: TradingEnsembleConfig;
  }): Promise<{
    analysis: technicalIndicators.TechnicalAnalysisResult;
    indicatorId: string;
    resolvedSymbol: string;
    techniqueScores: TradingTechniqueScore[];
    ensembleResult: TradingEnsembleResult;
  }> {
    const { tenantId, userId, symbol, interval, marketType, marginMode, enabledIndicators } = params;
    const tradingAuth = { tenantId, userId };

    const granularity = deps.resolveTradingIntervalGranularity(interval);
    if (!granularity) {
      throw new Error(`Intervalo inválido: ${interval}. Use: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 8h, 12h, 1d, 1w`);
    }

    const resolvedSymbol = await deps.resolveTradingSymbolStrict(tradingAuth, symbol, marketType, marginMode);
    const resolvedMarketType = marketType ?? 'futures';

    const now = Date.now();
    const from = now - (granularity * 60 * 1000 * 250);
    const klinesRaw = resolvedMarketType === 'spot' || resolvedMarketType === 'margin'
      ? await deps.getSpotKlines(resolvedSymbol, `${granularity}min`, Math.floor(from / 1000), Math.floor(now / 1000))
      : await deps.getFuturesKlines(resolvedSymbol, granularity, from, now);

    if (klinesRaw.length < 200) {
      throw new Error(`Dados insuficientes: ${klinesRaw.length} candles. Mínimo: 200`);
    }

    const candles: technicalIndicators.CandleData[] = klinesRaw.map((k) => ({
      timestamp: k.time,
      open: parseFloat(k.open),
      high: parseFloat(k.high),
      low: parseFloat(k.low),
      close: parseFloat(k.close),
      volume: parseFloat(k.volume),
    }));

    const analysis = technicalIndicators.calculateFullAnalysis(candles, resolvedSymbol, interval, enabledIndicators);
    const techniques = params.techniques === undefined
      ? [...deps.defaultTradingTechniques]
      : params.techniques;
    const ensembleConfig = params.ensembleConfig ?? { ...deps.defaultTradingEnsembleConfig };
    const techniqueScores = technicalIndicators.calculateTechniqueScores({ analysis, techniques });
    const ensembleResult = deps.buildEnsembleResult(techniqueScores, ensembleConfig);

    const validatedInterval = interval as TradingIntervalValue;
    const db = getDatabase();
    const [savedIndicator] = await db
      .insert(schema.tradingTechnicalIndicators)
      .values({
        tenantId,
        symbol: resolvedSymbol,
        interval: validatedInterval,
        candleTimestamp: new Date(candles[candles.length - 1].timestamp),
        currentPrice: analysis.currentPrice,
        // RSI
        rsiValue: analysis.rsi?.value,
        rsiInterpretation: analysis.rsi?.interpretation,
        rsiPeriod: analysis.rsi?.period ?? 14,

        // MACD
        macdLine: analysis.macd?.macd,
        macdSignal: analysis.macd?.signal,
        macdHistogram: analysis.macd?.histogram,
        macdInterpretation: analysis.macd?.interpretation as 'bullish' | 'bearish' | 'sideways' | undefined,
        macdCrossover: analysis.macd?.crossover,

        // EMAs
        ema9: analysis.movingAverages?.ema9,
        ema21: analysis.movingAverages?.ema21,
        ema50: analysis.movingAverages?.ema50,
        ema200: analysis.movingAverages?.ema200,

        // SMAs
        sma20: analysis.movingAverages?.sma20,
        sma50: analysis.movingAverages?.sma50,
        sma200: analysis.movingAverages?.sma200,
        maTrend: analysis.movingAverages?.trend,

        // Bollinger
        bollingerUpper: analysis.bollinger?.upper,
        bollingerMiddle: analysis.bollinger?.middle,
        bollingerLower: analysis.bollinger?.lower,
        bollingerWidth: analysis.bollinger?.width,
        bollingerPercentB: analysis.bollinger?.percentB,
        bollingerInterpretation: analysis.bollinger?.interpretation,

        // ATR
        atrValue: analysis.atr?.value,
        atrPercentage: analysis.atr?.percentage,
        atrVolatility: analysis.atr?.volatility,

        // Stochastic
        stochasticK: analysis.stochastic?.k,
        stochasticD: analysis.stochastic?.d,
        stochasticInterpretation: analysis.stochastic?.interpretation,

        // ADX
        adxValue: analysis.adx?.adx,
        adxPlusDI: analysis.adx?.plusDI,
        adxMinusDI: analysis.adx?.minusDI,
        adxTrendStrength: analysis.adx?.trendStrength,

        // Suporte/Resistência
        pivotPoint: analysis.supportResistance?.pivot,
        resistance1: analysis.supportResistance?.resistance1,
        resistance2: analysis.supportResistance?.resistance2,
        resistance3: analysis.supportResistance?.resistance3,
        support1: analysis.supportResistance?.support1,
        support2: analysis.supportResistance?.support2,
        support3: analysis.supportResistance?.support3,

        // Volume
        currentVolume: analysis.volume?.currentVolume,
        averageVolume: analysis.volume?.averageVolume,
        volumeRatio: analysis.volume?.volumeRatio,
        obv: analysis.volume?.obv,
        volumeInterpretation: analysis.volume?.interpretation,

        // Sinal geral
        overallSignal: analysis.overallSignal,
        signalConfidence: analysis.confidence,

        metadata: {
          calculationDurationMs: Date.now() - analysis.timestamp,
          candleCount: candles.length,
          lastCandleTime: new Date(candles[candles.length - 1].timestamp).toISOString(),
          createdByUserId: userId,
          techniques,
          ensembleConfig,
          techniqueScores,
          ensembleResult,
        },
      })
      .returning({ id: schema.tradingTechnicalIndicators.id });

    return {
      analysis,
      indicatorId: savedIndicator?.id ?? '',
      resolvedSymbol,
      techniqueScores,
      ensembleResult,
    };
  }

  return {
    calculateAndPersistTechnicalAnalysis,
  };
}
