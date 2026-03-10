import type { TradingOperationType, TradingRiskConfig } from '@alice/shared';
import { parseTradingIntervalToMinutes } from './kucoin-ws-config-service.js';
import type * as technicalIndicators from './technical-indicators.js';

type TradingMarketType = 'futures' | 'spot' | 'margin';
type TradingMarginMode = 'cross' | 'isolated';

export function resolveSignalTypeFromAnalysis(
  analysis: technicalIndicators.TechnicalAnalysisResult
): 'entry_long' | 'entry_short' | 'hold' {
  if (analysis.overallSignal === 'strong_buy' || analysis.overallSignal === 'buy') {
    return 'entry_long';
  }
  if (analysis.overallSignal === 'strong_sell' || analysis.overallSignal === 'sell') {
    return 'entry_short';
  }
  return 'hold';
}

export function formatDurationLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return 'N/A';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  if (minutes < 10080) return `${Math.round(minutes / 1440)}d`;
  return `${Math.round(minutes / 10080)}w`;
}

function resolveOperationTypeFromInterval(params: {
  intervalMinutes: number | null;
  overallSignal: technicalIndicators.TechnicalAnalysisResult['overallSignal'];
}): TradingOperationType {
  if (params.overallSignal === 'neutral') return 'neutral';
  const minutes = params.intervalMinutes ?? 15;
  if (minutes <= 5) return 'scalping';
  if (minutes <= 30) return 'swing';
  return 'position';
}

function resolveExpectedDurationMinutes(intervalMinutes: number | null, timeframes: string[]): number {
  const baseMinutes = intervalMinutes ?? 15;
  const multiplier = Math.max(3, timeframes.length);
  return baseMinutes * multiplier;
}

function resolveStopLossTakeProfitFromAnalysis(params: {
  analysis: technicalIndicators.TechnicalAnalysisResult;
  direction: 'long' | 'short' | 'neutral';
  riskConfig: TradingRiskConfig | null;
}): { stopLoss: number | null; takeProfit: number | null } {
  if (params.direction === 'neutral') {
    return { stopLoss: null, takeProfit: null };
  }

  const entry = params.analysis.currentPrice;
  let stopLoss: number | null = null;
  let takeProfit: number | null = null;

  const levels = params.analysis.supportResistance;
  if (levels) {
    if (params.direction === 'long') {
      stopLoss = levels.support1 ?? levels.support2 ?? levels.support3 ?? null;
      takeProfit = levels.resistance1 ?? levels.resistance2 ?? levels.resistance3 ?? null;
    } else {
      stopLoss = levels.resistance1 ?? levels.resistance2 ?? levels.resistance3 ?? null;
      takeProfit = levels.support1 ?? levels.support2 ?? levels.support3 ?? null;
    }
  }

  if (params.riskConfig) {
    if (stopLoss === null && Number.isFinite(params.riskConfig.defaultStopLoss)) {
      const ratio = Number(params.riskConfig.defaultStopLoss);
      stopLoss = params.direction === 'long' ? entry * (1 - ratio) : entry * (1 + ratio);
    }
    if (takeProfit === null && Number.isFinite(params.riskConfig.defaultTakeProfit)) {
      const ratio = Number(params.riskConfig.defaultTakeProfit);
      takeProfit = params.direction === 'long' ? entry * (1 + ratio) : entry * (1 - ratio);
    }
  }

  if (Number.isFinite(stopLoss)) {
    if (params.direction === 'long' && (stopLoss as number) >= entry) stopLoss = null;
    if (params.direction === 'short' && (stopLoss as number) <= entry) stopLoss = null;
  }
  if (Number.isFinite(takeProfit)) {
    if (params.direction === 'long' && (takeProfit as number) <= entry) takeProfit = null;
    if (params.direction === 'short' && (takeProfit as number) >= entry) takeProfit = null;
  }

  return { stopLoss, takeProfit };
}

export function buildAnalysisMotivators(analysis: technicalIndicators.TechnicalAnalysisResult): string[] {
  const motivators: string[] = [];
  if (analysis.rsi) {
    motivators.push(`RSI em ${analysis.rsi.value.toFixed(2)} indica ${analysis.rsi.interpretation}`);
  }
  if (analysis.macd) {
    if (analysis.macd.crossover !== 'none') {
      motivators.push(`MACD com ${analysis.macd.crossover.replace('_', ' ')} e histograma ${analysis.macd.histogram.toFixed(2)}`);
    } else {
      motivators.push(`MACD ${analysis.macd.interpretation} com histograma ${analysis.macd.histogram.toFixed(2)}`);
    }
  }
  if (analysis.movingAverages) {
    motivators.push(`Tendência ${analysis.movingAverages.trend} via médias móveis`);
  }
  if (analysis.adx) {
    motivators.push(`ADX ${analysis.adx.adx.toFixed(2)} indica força ${analysis.adx.trendStrength}`);
  }
  if (analysis.bollinger) {
    motivators.push(`Bollinger %B ${(analysis.bollinger.percentB * 100).toFixed(0)}% (${analysis.bollinger.interpretation})`);
  }
  if (analysis.volume) {
    motivators.push(`Volume ${analysis.volume.interpretation} (${analysis.volume.volumeRatio.toFixed(2)}x)`);
  }
  if (motivators.length === 0) {
    motivators.push(`Sinal ${analysis.overallSignal} com confiança ${(analysis.confidence * 100).toFixed(0)}%`);
  }
  return motivators;
}

export function buildAnalysisInvalidationReasons(params: {
  analysis: technicalIndicators.TechnicalAnalysisResult;
  direction: 'long' | 'short' | 'neutral';
}): string[] {
  const reasons: string[] = [];
  const levels = params.analysis.supportResistance;
  if (levels) {
    if (params.direction === 'long' && levels.support1 !== undefined) {
      reasons.push(`Perda do suporte S1 (${levels.support1.toFixed(2)})`);
    }
    if (params.direction === 'short' && levels.resistance1 !== undefined) {
      reasons.push(`Rompimento da resistência R1 (${levels.resistance1.toFixed(2)})`);
    }
  }
  if (params.analysis.movingAverages?.trend === 'sideways') {
    reasons.push('Tendência lateral reduz vantagem direcional');
  }
  if (params.analysis.overallSignal === 'neutral') {
    reasons.push('Sinal neutro: aguardar confirmação adicional');
  }
  return reasons.length > 0 ? reasons : ['Condição de mercado sem confirmação suficiente'];
}

export function buildTradePlanFromAnalysis(params: {
  analysis: technicalIndicators.TechnicalAnalysisResult;
  interval: string;
  timeframes: string[];
  marketType: TradingMarketType;
  marginMode?: TradingMarginMode;
  riskConfig: TradingRiskConfig | null;
}) {
  const intervalMinutes = parseTradingIntervalToMinutes(params.interval);
  const direction = params.analysis.overallSignal === 'sell' || params.analysis.overallSignal === 'strong_sell'
    ? 'short'
    : params.analysis.overallSignal === 'buy' || params.analysis.overallSignal === 'strong_buy'
      ? 'long'
      : 'neutral';
  const operationType = resolveOperationTypeFromInterval({
    intervalMinutes,
    overallSignal: params.analysis.overallSignal,
  });
  const expectedDurationMinutes = resolveExpectedDurationMinutes(intervalMinutes, params.timeframes);
  const expectedDurationLabel = formatDurationLabel(expectedDurationMinutes);
  const entryPrice = params.analysis.currentPrice;
  const { stopLoss, takeProfit } = resolveStopLossTakeProfitFromAnalysis({
    analysis: params.analysis,
    direction,
    riskConfig: params.riskConfig,
  });
  const riskReward = stopLoss && takeProfit
    ? Math.abs((takeProfit - entryPrice) / (entryPrice - stopLoss))
    : null;
  const motivators = buildAnalysisMotivators(params.analysis);
  const invalidationReasons = buildAnalysisInvalidationReasons({ analysis: params.analysis, direction });
  const summary = `Sinal ${params.analysis.overallSignal.toUpperCase()} com ${(params.analysis.confidence * 100).toFixed(0)}% de confiança.`
    + ` Operação ${operationType} estimada para ${expectedDurationLabel}.`;

  return {
    operationType,
    expectedDurationMinutes,
    expectedDurationLabel,
    entryPrice,
    stopLoss,
    takeProfit,
    riskReward,
    motivators,
    invalidationReasons,
    tradeSummary: summary,
    marketType: params.marketType,
    marginMode: params.marginMode ?? null,
    direction,
  };
}
