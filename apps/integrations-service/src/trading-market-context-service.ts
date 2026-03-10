import { schema } from '@alice/database';
import type { TradingCandleData } from '@alice/shared';
import * as technicalIndicators from './technical-indicators.js';
import * as kucoinClient from './kucoinClient.js';
import * as kucoinSpotClient from './kucoinSpotClient.js';
import * as kucoinService from './kucoinService.js';

type TradingAuth = { tenantId: string; userId: string };
type TradingMarketType = 'futures' | 'spot' | 'margin';
type TradingMarginMode = 'cross' | 'isolated';

type TradingMarketContextDependencies = {
  resolveTradingIntervalGranularity: (interval: string) => number | null;
};

export function createTradingMarketContextService(deps: TradingMarketContextDependencies) {
  async function fetchRecentCandles(
    auth: TradingAuth,
    symbol: string,
    interval: string,
    marketType?: TradingMarketType,
    marginMode?: TradingMarginMode
  ): Promise<TradingCandleData[]> {
    const resolvedSymbol = await kucoinService.resolveTradingSymbolStrict(auth, symbol, marketType, marginMode);
    const granularity = deps.resolveTradingIntervalGranularity(interval);
    if (!granularity) {
      throw new Error(`Intervalo inválido para candles: ${interval}`);
    }
    const now = Math.floor(Date.now() / 1000);
    const from = now - granularity * 200;
    const klinesRaw = marketType === 'spot' || marketType === 'margin'
      ? await kucoinSpotClient.getSpotKlines(resolvedSymbol, `${granularity}min`, from, now)
      : await kucoinClient.getKlines(resolvedSymbol, granularity, from, now);

    return klinesRaw.map((k) => ({
      timestamp: k.time,
      open: parseFloat(k.open),
      high: parseFloat(k.high),
      low: parseFloat(k.low),
      close: parseFloat(k.close),
      volume: parseFloat(k.volume),
    }));
  }

  function buildIndicatorSnapshot(analysis?: technicalIndicators.TechnicalAnalysisResult): Record<string, number> | undefined {
    if (!analysis) return undefined;
    const indicators: Record<string, number> = {};
    if (analysis.rsi?.value !== undefined) indicators.rsi = analysis.rsi.value;
    if (analysis.macd?.macd !== undefined) indicators.macd = analysis.macd.macd;
    if (analysis.macd?.signal !== undefined) indicators.macdSignal = analysis.macd.signal;
    if (analysis.bollinger?.percentB !== undefined) indicators.bollingerPercentB = analysis.bollinger.percentB;
    if (analysis.atr?.value !== undefined) indicators.atr = analysis.atr.value;
    if (analysis.stochastic?.k !== undefined) indicators.stochasticK = analysis.stochastic.k;
    if (analysis.adx?.adx !== undefined) indicators.adx = analysis.adx.adx;
    if (analysis.supportResistance?.pivot !== undefined) indicators.pivot = analysis.supportResistance.pivot;
    if (analysis.volume?.volumeRatio !== undefined) indicators.volumeRatio = analysis.volume.volumeRatio;
    return Object.keys(indicators).length > 0 ? indicators : undefined;
  }

  async function buildMarketContextFromSignal(params: {
    auth: TradingAuth;
    symbol: string;
    interval: string;
    marketType: TradingMarketType;
    marginMode?: TradingMarginMode;
    analysis?: technicalIndicators.TechnicalAnalysisResult;
  }): Promise<schema.TradingDataset['marketContext']> {
    const { ticker, contract } = await kucoinService.getMarketData(params.auth, params.symbol, params.marketType, params.marginMode);
    const recentCandles = await fetchRecentCandles(
      params.auth,
      params.symbol,
      params.interval,
      params.marketType,
      params.marginMode
    );
    const latestPrice = parseFloat((ticker as { price: string }).price);
    const oldestClose = recentCandles[0]?.close ?? latestPrice;
    const changePercent = oldestClose !== 0 ? ((latestPrice - oldestClose) / oldestClose) * 100 : 0;
    const volumeSum = recentCandles.reduce((sum, candle) => sum + candle.volume, 0);

    return {
      symbol: params.symbol,
      timestamp: new Date().toISOString(),
      price: latestPrice,
      change24h: changePercent,
      volume24h: contract?.volumeOf24h ?? volumeSum,
      fundingRate: contract?.fundingFeeRate ?? 0,
      openInterest: contract?.openInterest ? Number(contract.openInterest) : 0,
      recentCandles,
      indicators: buildIndicatorSnapshot(params.analysis),
    };
  }

  return {
    buildMarketContextFromSignal,
  };
}
