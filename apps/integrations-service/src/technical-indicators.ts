/**
 * Serviço de Indicadores Técnicos - Alice Enterprise Platform
 * 
 * Cálculo DETERMINÍSTICO de indicadores técnicos para análise de trading.
 * Este serviço usa apenas CÓDIGO (não LLM) para calcular indicadores,
 * eliminando alucinações e garantindo precisão numérica.
 * 
 * ARQUITETURA ENTERPRISE:
 * 1. Dados da KuCoin API (candlesticks reais)
 * 2. Este serviço CALCULA indicadores (determinístico)
 * 3. LLM INTERPRETA indicadores (não calcula)
 * 4. Código VALIDA se LLM citou números corretos
 * 
 * Indicadores implementados:
 * - RSI (Relative Strength Index)
 * - MACD (Moving Average Convergence Divergence)
 * - EMA (Exponential Moving Average)
 * - SMA (Simple Moving Average)
 * - Bollinger Bands
 * - ATR (Average True Range)
 * - Volume Analysis
 * - Suporte/Resistência (Pivot Points)
 * 
 * Autor: Fillipe Guerra
 * Data: 21 de Dezembro de 2025
 * Regra 6: Código determinístico, sem mocks
 * Regra 8: TypeScript strict, zero any
 */

import { createLogger } from '@alice/logger';
import type { TradingIndicatorKey, TradingTechnique, TradingTechniqueScore, TradingOverallSignal } from '@alice/shared';
import {
  RSI,
  MACD,
  EMA,
  SMA,
  BollingerBands,
  ATR,
  Stochastic,
  ADX,
  OBV,
} from 'technicalindicators';

const logger = createLogger('technical-indicators');

// ============================================================================
// TIPOS
// ============================================================================

/** Dados de candlestick da KuCoin */
export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Resultado do cálculo de RSI */
export interface RSIResult {
  value: number;
  interpretation: 'oversold' | 'neutral' | 'overbought';
  period: number;
}

/** Resultado do cálculo de MACD */
export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
  // BUG FIX 21/12/2025: Usar 'sideways' ao invés de 'neutral' para compatibilidade com trendEnum do PostgreSQL
  interpretation: 'bullish' | 'bearish' | 'sideways';
  crossover: 'bullish_cross' | 'bearish_cross' | 'none';
}

/** Resultado de médias móveis */
export interface MovingAverageResult {
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  sma20: number;
  sma50: number;
  sma200: number;
  trend: 'bullish' | 'bearish' | 'sideways';
}

/** Resultado de Bollinger Bands */
export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
  width: number;
  percentB: number;
  interpretation: 'oversold' | 'neutral' | 'overbought';
}

/** Resultado de ATR */
export interface ATRResult {
  value: number;
  percentage: number;
  volatility: 'low' | 'medium' | 'high';
}

/** Resultado de Stochastic */
export interface StochasticResult {
  k: number;
  d: number;
  interpretation: 'oversold' | 'neutral' | 'overbought';
}

/** Resultado de ADX */
export interface ADXResult {
  adx: number;
  plusDI: number;
  minusDI: number;
  trendStrength: 'weak' | 'moderate' | 'strong' | 'very_strong';
}

/** Níveis de suporte e resistência */
export interface SupportResistanceResult {
  pivot: number;
  resistance1: number;
  resistance2: number;
  resistance3: number;
  support1: number;
  support2: number;
  support3: number;
}

/** Análise de volume */
export interface VolumeAnalysisResult {
  currentVolume: number;
  averageVolume: number;
  volumeRatio: number;
  obv: number;
  interpretation: 'low' | 'normal' | 'high' | 'very_high';
}

/** Resultado completo da análise técnica */
export interface TechnicalAnalysisResult {
  timestamp: number;
  symbol: string;
  interval: string;
  currentPrice: number;
  rsi?: RSIResult;
  macd?: MACDResult;
  movingAverages?: MovingAverageResult;
  bollinger?: BollingerResult;
  atr?: ATRResult;
  stochastic?: StochasticResult;
  adx?: ADXResult;
  supportResistance?: SupportResistanceResult;
  volume?: VolumeAnalysisResult;
  overallSignal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  confidence: number;
}

// ============================================================================
// FUNÇÕES DE CÁLCULO (DETERMINÍSTICAS)
// ============================================================================

/**
 * Calcula RSI (Relative Strength Index)
 * Valores: 0-100
 * < 30 = oversold (possível compra)
 * > 70 = overbought (possível venda)
 */
export function calculateRSI(closes: number[], period = 14): RSIResult {
  if (closes.length < period + 1) {
    throw new Error(`RSI requer pelo menos ${period + 1} candles, recebido: ${closes.length}`);
  }

  const rsiValues = RSI.calculate({
    values: closes,
    period,
  });

  const value = rsiValues[rsiValues.length - 1];
  
  let interpretation: RSIResult['interpretation'] = 'neutral';
  if (value < 30) interpretation = 'oversold';
  else if (value > 70) interpretation = 'overbought';

  return {
    value: Math.round(value * 100) / 100,
    interpretation,
    period,
  };
}

/**
 * Calcula MACD (Moving Average Convergence Divergence)
 * Crossover bullish = MACD cruza acima do Signal
 * Crossover bearish = MACD cruza abaixo do Signal
 */
export function calculateMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MACDResult {
  const minRequired = slowPeriod + signalPeriod;
  if (closes.length < minRequired) {
    throw new Error(`MACD requer pelo menos ${minRequired} candles, recebido: ${closes.length}`);
  }

  const macdValues = MACD.calculate({
    values: closes,
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  const current = macdValues[macdValues.length - 1];
  const previous = macdValues[macdValues.length - 2];

  const macd = current.MACD ?? 0;
  const signal = current.signal ?? 0;
  const histogram = current.histogram ?? 0;

  // Determinar interpretação
  // BUG FIX 21/12/2025: Usar 'sideways' ao invés de 'neutral' para compatibilidade com trendEnum do PostgreSQL
  let interpretation: MACDResult['interpretation'] = 'sideways';
  if (histogram > 0) interpretation = 'bullish';
  else if (histogram < 0) interpretation = 'bearish';

  // Detectar crossover
  let crossover: MACDResult['crossover'] = 'none';
  if (previous) {
    const prevMacd = previous.MACD ?? 0;
    const prevSignal = previous.signal ?? 0;
    
    if (prevMacd < prevSignal && macd > signal) {
      crossover = 'bullish_cross';
    } else if (prevMacd > prevSignal && macd < signal) {
      crossover = 'bearish_cross';
    }
  }

  return {
    macd: Math.round(macd * 100) / 100,
    signal: Math.round(signal * 100) / 100,
    histogram: Math.round(histogram * 100) / 100,
    interpretation,
    crossover,
  };
}

/**
 * Calcula múltiplas médias móveis
 */
export function calculateMovingAverages(closes: number[]): MovingAverageResult {
  if (closes.length < 200) {
    throw new Error(`Médias móveis requerem pelo menos 200 candles, recebido: ${closes.length}`);
  }

  const ema9 = EMA.calculate({ values: closes, period: 9 });
  const ema21 = EMA.calculate({ values: closes, period: 21 });
  const ema50 = EMA.calculate({ values: closes, period: 50 });
  const ema200 = EMA.calculate({ values: closes, period: 200 });
  const sma20 = SMA.calculate({ values: closes, period: 20 });
  const sma50 = SMA.calculate({ values: closes, period: 50 });
  const sma200 = SMA.calculate({ values: closes, period: 200 });

  const currentPrice = closes[closes.length - 1];
  const ema9Val = ema9[ema9.length - 1];
  const ema21Val = ema21[ema21.length - 1];
  const ema200Val = ema200[ema200.length - 1];

  // Determinar tendência
  let trend: MovingAverageResult['trend'] = 'sideways';
  if (currentPrice > ema9Val && ema9Val > ema21Val && ema21Val > ema200Val) {
    trend = 'bullish';
  } else if (currentPrice < ema9Val && ema9Val < ema21Val && ema21Val < ema200Val) {
    trend = 'bearish';
  }

  return {
    ema9: Math.round(ema9Val * 100) / 100,
    ema21: Math.round(ema21Val * 100) / 100,
    ema50: Math.round(ema50[ema50.length - 1] * 100) / 100,
    ema200: Math.round(ema200Val * 100) / 100,
    sma20: Math.round(sma20[sma20.length - 1] * 100) / 100,
    sma50: Math.round(sma50[sma50.length - 1] * 100) / 100,
    sma200: Math.round(sma200[sma200.length - 1] * 100) / 100,
    trend,
  };
}

/**
 * Calcula Bollinger Bands
 * %B < 0 = preço abaixo da banda inferior (oversold)
 * %B > 1 = preço acima da banda superior (overbought)
 */
export function calculateBollinger(closes: number[], period = 20, stdDev = 2): BollingerResult {
  if (closes.length < period) {
    throw new Error(`Bollinger requer pelo menos ${period} candles, recebido: ${closes.length}`);
  }

  const bb = BollingerBands.calculate({
    values: closes,
    period,
    stdDev,
  });

  const current = bb[bb.length - 1];
  const currentPrice = closes[closes.length - 1];

  const upper = current.upper;
  const middle = current.middle;
  const lower = current.lower;
  const width = (upper - lower) / middle;
  const percentB = (currentPrice - lower) / (upper - lower);

  let interpretation: BollingerResult['interpretation'] = 'neutral';
  if (percentB < 0.2) interpretation = 'oversold';
  else if (percentB > 0.8) interpretation = 'overbought';

  return {
    upper: Math.round(upper * 100) / 100,
    middle: Math.round(middle * 100) / 100,
    lower: Math.round(lower * 100) / 100,
    width: Math.round(width * 10000) / 10000,
    percentB: Math.round(percentB * 100) / 100,
    interpretation,
  };
}

/**
 * Calcula ATR (Average True Range)
 * Mede volatilidade do mercado
 */
export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): ATRResult {
  if (closes.length < period + 1) {
    throw new Error(`ATR requer pelo menos ${period + 1} candles, recebido: ${closes.length}`);
  }

  const atrValues = ATR.calculate({
    high: highs,
    low: lows,
    close: closes,
    period,
  });

  const value = atrValues[atrValues.length - 1];
  const currentPrice = closes[closes.length - 1];
  const percentage = (value / currentPrice) * 100;

  let volatility: ATRResult['volatility'] = 'medium';
  if (percentage < 1) volatility = 'low';
  else if (percentage > 3) volatility = 'high';

  return {
    value: Math.round(value * 100) / 100,
    percentage: Math.round(percentage * 100) / 100,
    volatility,
  };
}

/**
 * Calcula Stochastic Oscillator
 * < 20 = oversold
 * > 80 = overbought
 */
export function calculateStochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
  signalPeriod = 3
): StochasticResult {
  if (closes.length < period + signalPeriod) {
    throw new Error(`Stochastic requer pelo menos ${period + signalPeriod} candles`);
  }

  const stoch = Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period,
    signalPeriod,
  });

  const current = stoch[stoch.length - 1];
  const k = current.k;
  const d = current.d;

  let interpretation: StochasticResult['interpretation'] = 'neutral';
  if (k < 20 && d < 20) interpretation = 'oversold';
  else if (k > 80 && d > 80) interpretation = 'overbought';

  return {
    k: Math.round(k * 100) / 100,
    d: Math.round(d * 100) / 100,
    interpretation,
  };
}

/**
 * Calcula ADX (Average Directional Index)
 * Mede força da tendência (não direção)
 * < 20 = tendência fraca
 * 20-40 = tendência moderada
 * 40-60 = tendência forte
 * > 60 = tendência muito forte
 */
export function calculateADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): ADXResult {
  if (closes.length < period * 2) {
    throw new Error(`ADX requer pelo menos ${period * 2} candles`);
  }

  const adxResult = ADX.calculate({
    high: highs,
    low: lows,
    close: closes,
    period,
  });

  const current = adxResult[adxResult.length - 1];

  let trendStrength: ADXResult['trendStrength'] = 'weak';
  if (current.adx >= 60) trendStrength = 'very_strong';
  else if (current.adx >= 40) trendStrength = 'strong';
  else if (current.adx >= 20) trendStrength = 'moderate';

  return {
    adx: Math.round(current.adx * 100) / 100,
    plusDI: Math.round(current.pdi * 100) / 100,
    minusDI: Math.round(current.mdi * 100) / 100,
    trendStrength,
  };
}

/**
 * Calcula níveis de suporte e resistência usando Pivot Points
 * Método: Standard Pivot Points (mais usado)
 */
export function calculateSupportResistance(
  high: number,
  low: number,
  close: number
): SupportResistanceResult {
  const pivot = (high + low + close) / 3;
  
  const resistance1 = 2 * pivot - low;
  const resistance2 = pivot + (high - low);
  const resistance3 = high + 2 * (pivot - low);
  
  const support1 = 2 * pivot - high;
  const support2 = pivot - (high - low);
  const support3 = low - 2 * (high - pivot);

  return {
    pivot: Math.round(pivot * 100) / 100,
    resistance1: Math.round(resistance1 * 100) / 100,
    resistance2: Math.round(resistance2 * 100) / 100,
    resistance3: Math.round(resistance3 * 100) / 100,
    support1: Math.round(support1 * 100) / 100,
    support2: Math.round(support2 * 100) / 100,
    support3: Math.round(support3 * 100) / 100,
  };
}

/**
 * Análise de volume
 */
export function calculateVolumeAnalysis(
  volumes: number[],
  closes: number[],
  period = 20
): VolumeAnalysisResult {
  if (volumes.length < period) {
    throw new Error(`Volume analysis requer pelo menos ${period} candles`);
  }

  const currentVolume = volumes[volumes.length - 1];
  const recentVolumes = volumes.slice(-period);
  const averageVolume = recentVolumes.reduce((a, b) => a + b, 0) / period;
  const volumeRatio = currentVolume / averageVolume;

  // Calcular OBV (On-Balance Volume)
  const obvValues = OBV.calculate({
    close: closes,
    volume: volumes,
  });
  const obv = obvValues[obvValues.length - 1];

  let interpretation: VolumeAnalysisResult['interpretation'] = 'normal';
  if (volumeRatio < 0.5) interpretation = 'low';
  else if (volumeRatio > 2) interpretation = 'very_high';
  else if (volumeRatio > 1.5) interpretation = 'high';

  return {
    currentVolume: Math.round(currentVolume),
    averageVolume: Math.round(averageVolume),
    volumeRatio: Math.round(volumeRatio * 100) / 100,
    obv: Math.round(obv),
    interpretation,
  };
}

// ============================================================================
// ANÁLISE COMPLETA
// ============================================================================

/**
 * Executa análise técnica completa
 * Retorna TODOS os indicadores calculados de forma DETERMINÍSTICA
 */
export function calculateFullAnalysis(
  candles: CandleData[],
  symbol: string,
  interval: string,
  enabledIndicators?: TradingIndicatorKey[]
): TechnicalAnalysisResult {
  if (candles.length < 200) {
    throw new Error(`Análise completa requer pelo menos 200 candles, recebido: ${candles.length}`);
  }

  logger.info({ symbol, interval, candleCount: candles.length }, 'Iniciando análise técnica completa');

  // Extrair arrays para cálculos de indicadores
  // NOTA: opens não é usado diretamente nos indicadores atuais (RSI, MACD, etc usam close)
  // mas highs/lows são necessários para ATR, Stochastic, ADX e Pivot Points
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

  const currentPrice = closes[closes.length - 1];
  const lastCandle = candles[candles.length - 1];

  const enabled = new Set<TradingIndicatorKey>(enabledIndicators ?? [
    'rsi',
    'macd',
    'moving_averages',
    'bollinger',
    'atr',
    'stochastic',
    'adx',
    'support_resistance',
    'volume',
  ]);

  // Calcular indicadores habilitados
  const rsi = enabled.has('rsi') ? calculateRSI(closes) : undefined;
  const macd = enabled.has('macd') ? calculateMACD(closes) : undefined;
  const movingAverages = enabled.has('moving_averages') ? calculateMovingAverages(closes) : undefined;
  const bollinger = enabled.has('bollinger') ? calculateBollinger(closes) : undefined;
  const atr = enabled.has('atr') ? calculateATR(highs, lows, closes) : undefined;
  const stochastic = enabled.has('stochastic') ? calculateStochastic(highs, lows, closes) : undefined;
  const adx = enabled.has('adx') ? calculateADX(highs, lows, closes) : undefined;
  const supportResistance = enabled.has('support_resistance')
    ? calculateSupportResistance(
        lastCandle.high,
        lastCandle.low,
        lastCandle.close
      )
    : undefined;
  const volume = enabled.has('volume') ? calculateVolumeAnalysis(volumes, closes) : undefined;

  // Calcular sinal geral baseado em pontuação
  let score = 0;

  let maxScore = 0;

  // RSI
  if (rsi) {
    maxScore += 2;
    if (rsi.interpretation === 'oversold') score += 2;
    else if (rsi.interpretation === 'overbought') score -= 2;
  }

  // MACD
  if (macd) {
    maxScore += 4;
    if (macd.crossover === 'bullish_cross') score += 3;
    else if (macd.crossover === 'bearish_cross') score -= 3;
    if (macd.interpretation === 'bullish') score += 1;
    else if (macd.interpretation === 'bearish') score -= 1;
  }

  // Tendência (médias móveis)
  if (movingAverages) {
    maxScore += 2;
    if (movingAverages.trend === 'bullish') score += 2;
    else if (movingAverages.trend === 'bearish') score -= 2;
  }

  // Bollinger
  if (bollinger) {
    maxScore += 1;
    if (bollinger.interpretation === 'oversold') score += 1;
    else if (bollinger.interpretation === 'overbought') score -= 1;
  }

  // Stochastic
  if (stochastic) {
    maxScore += 1;
    if (stochastic.interpretation === 'oversold') score += 1;
    else if (stochastic.interpretation === 'overbought') score -= 1;
  }

  // ADX (força da tendência)
  if (adx) {
    maxScore += 1;
    if (adx.trendStrength === 'strong' || adx.trendStrength === 'very_strong') {
      if (adx.plusDI > adx.minusDI) score += 1;
      else score -= 1;
    }
  }

  // Determinar sinal final
  let overallSignal: TechnicalAnalysisResult['overallSignal'] = 'neutral';
  if (score >= 5) overallSignal = 'strong_buy';
  else if (score >= 2) overallSignal = 'buy';
  else if (score <= -5) overallSignal = 'strong_sell';
  else if (score <= -2) overallSignal = 'sell';

  // Calcular confiança (0-1)
  const confidence = maxScore > 0 ? Math.min(Math.abs(score) / maxScore, 1) : 0;

  const result: TechnicalAnalysisResult = {
    timestamp: Date.now(),
    symbol,
    interval,
    currentPrice: Math.round(currentPrice * 100) / 100,
    rsi,
    macd,
    movingAverages,
    bollinger,
    atr,
    stochastic,
    adx,
    supportResistance,
    volume,
    overallSignal,
    confidence: Math.round(confidence * 100) / 100,
  };

  logger.info({
    symbol,
    interval,
    currentPrice: result.currentPrice,
    overallSignal: result.overallSignal,
    confidence: result.confidence,
    rsi: result.rsi?.value,
    macdHistogram: result.macd?.histogram,
    trend: result.movingAverages?.trend,
  }, 'Análise técnica completa finalizada');

  return result;
}

function resolveSignalFromRatio(ratio: number): TradingOverallSignal {
  if (ratio >= 0.6) return 'strong_buy';
  if (ratio >= 0.2) return 'buy';
  if (ratio <= -0.6) return 'strong_sell';
  if (ratio <= -0.2) return 'sell';
  return 'neutral';
}

function buildTechniqueScore(params: {
  technique: TradingTechnique;
  score: number;
  maxScore: number;
  rationale?: string;
}): TradingTechniqueScore {
  const ratio = params.maxScore > 0 ? params.score / params.maxScore : 0;
  const confidence = params.maxScore > 0 ? Math.min(Math.abs(ratio), 1) : 0;
  return {
    technique: params.technique,
    signal: resolveSignalFromRatio(ratio),
    confidence: Math.round(confidence * 100) / 100,
    rationale: params.rationale,
  };
}

export function calculateTechniqueScores(params: {
  analysis: TechnicalAnalysisResult;
  techniques: TradingTechnique[];
}): TradingTechniqueScore[] {
  const { analysis, techniques } = params;
  const scores: TradingTechniqueScore[] = [];

  for (const technique of techniques) {
    if (technique === 'arbitrage_triangular') {
      continue;
    }
    let score = 0;
    let maxScore = 0;
    let rationale = '';

    if (technique === 'scalping' || technique === 'mean_reversion') {
      if (analysis.rsi) {
        maxScore += 1;
        if (analysis.rsi.interpretation === 'oversold') score += 1;
        if (analysis.rsi.interpretation === 'overbought') score -= 1;
      }
      if (analysis.stochastic) {
        maxScore += 1;
        if (analysis.stochastic.interpretation === 'oversold') score += 1;
        if (analysis.stochastic.interpretation === 'overbought') score -= 1;
      }
      if (analysis.bollinger) {
        maxScore += 1;
        if (analysis.bollinger.interpretation === 'oversold') score += 1;
        if (analysis.bollinger.interpretation === 'overbought') score -= 1;
      }
      rationale = 'RSI/Stochastic/Bollinger para reversões curtas.';
    }

    if (technique === 'day_trade') {
      if (analysis.macd) {
        maxScore += 3;
        if (analysis.macd.crossover === 'bullish_cross') score += 2;
        if (analysis.macd.crossover === 'bearish_cross') score -= 2;
        if (analysis.macd.interpretation === 'bullish') score += 1;
        if (analysis.macd.interpretation === 'bearish') score -= 1;
      }
      if (analysis.movingAverages) {
        maxScore += 1;
        if (analysis.movingAverages.trend === 'bullish') score += 1;
        if (analysis.movingAverages.trend === 'bearish') score -= 1;
      }
      if (analysis.adx) {
        maxScore += 1;
        if (analysis.adx.trendStrength === 'strong' || analysis.adx.trendStrength === 'very_strong') {
          score += analysis.adx.plusDI > analysis.adx.minusDI ? 1 : -1;
        }
      }
      rationale = 'MACD + tendência + força (ADX) para entradas intradiárias.';
    }

    if (technique === 'swing') {
      if (analysis.movingAverages) {
        maxScore += 2;
        if (analysis.movingAverages.trend === 'bullish') score += 2;
        if (analysis.movingAverages.trend === 'bearish') score -= 2;
      }
      if (analysis.supportResistance) {
        maxScore += 1;
        const price = analysis.currentPrice;
        if (price <= analysis.supportResistance.support1 * 1.01) score += 1;
        if (price >= analysis.supportResistance.resistance1 * 0.99) score -= 1;
      }
      if (analysis.adx) {
        maxScore += 1;
        if (analysis.adx.trendStrength === 'strong' || analysis.adx.trendStrength === 'very_strong') {
          score += analysis.adx.plusDI > analysis.adx.minusDI ? 1 : -1;
        }
      }
      rationale = 'Tendência + S/R + ADX para swings.';
    }

    if (technique === 'position' || technique === 'trend') {
      if (analysis.movingAverages) {
        maxScore += 2;
        if (analysis.movingAverages.trend === 'bullish') score += 2;
        if (analysis.movingAverages.trend === 'bearish') score -= 2;
      }
      if (analysis.adx) {
        maxScore += 1;
        if (analysis.adx.trendStrength === 'strong' || analysis.adx.trendStrength === 'very_strong') {
          score += analysis.adx.plusDI > analysis.adx.minusDI ? 1 : -1;
        }
      }
      if (analysis.macd) {
        maxScore += 1;
        if (analysis.macd.interpretation === 'bullish') score += 1;
        if (analysis.macd.interpretation === 'bearish') score -= 1;
      }
      rationale = 'Tendência prolongada com confirmação MACD/ADX.';
    }

    if (technique === 'breakout') {
      if (analysis.bollinger) {
        maxScore += 2;
        if (analysis.bollinger.percentB > 1) score += 2;
        if (analysis.bollinger.percentB < 0) score -= 2;
      }
      if (analysis.volume) {
        maxScore += 1;
        if (analysis.volume.interpretation === 'high' || analysis.volume.interpretation === 'very_high') {
          score += score >= 0 ? 1 : -1;
        }
      }
      rationale = 'Bollinger + volume para rompimentos.';
    }

    if (technique === 'range') {
      if (analysis.supportResistance) {
        maxScore += 2;
        const price = analysis.currentPrice;
        if (price <= analysis.supportResistance.support1 * 1.01) score += 2;
        if (price >= analysis.supportResistance.resistance1 * 0.99) score -= 2;
      }
      rationale = 'Suporte/Resistência para range.';
    }

    if (technique === 'momentum') {
      if (analysis.macd) {
        maxScore += 1;
        score += analysis.macd.histogram >= 0 ? 1 : -1;
      }
      if (analysis.rsi) {
        maxScore += 1;
        if (analysis.rsi.value >= 60) score += 1;
        if (analysis.rsi.value <= 40) score -= 1;
      }
      if (analysis.volume) {
        maxScore += 1;
        if (analysis.volume.interpretation === 'high' || analysis.volume.interpretation === 'very_high') {
          score += score >= 0 ? 1 : -1;
        }
      }
      rationale = 'MACD/RSI/Volume para momentum.';
    }

    scores.push(buildTechniqueScore({ technique, score, maxScore, rationale }));
  }

  return scores;
}

/**
 * Formata análise técnica para enviar ao LLM
 * O LLM recebe APENAS os números já calculados e deve INTERPRETAR, não calcular
 */
export function formatAnalysisForLLM(analysis: TechnicalAnalysisResult): string {
  const rsiBlock = analysis.rsi
    ? `**RSI (14):** ${analysis.rsi.value} [${analysis.rsi.interpretation}]`
    : '';
  const macdBlock = analysis.macd
    ? `**MACD (12,26,9):**
- MACD Line: ${analysis.macd.macd}
- Signal Line: ${analysis.macd.signal}
- Histograma: ${analysis.macd.histogram}
- Crossover: ${analysis.macd.crossover}`
    : '';
  const movingAveragesBlock = analysis.movingAverages
    ? `**Médias Móveis:**
- EMA 9: $${analysis.movingAverages.ema9}
- EMA 21: $${analysis.movingAverages.ema21}
- EMA 50: $${analysis.movingAverages.ema50}
- EMA 200: $${analysis.movingAverages.ema200}
- SMA 20: $${analysis.movingAverages.sma20}
- Tendência: ${analysis.movingAverages.trend}`
    : '';
  const bollingerBlock = analysis.bollinger
    ? `**Bollinger Bands (20,2):**
- Superior: $${analysis.bollinger.upper}
- Média: $${analysis.bollinger.middle}
- Inferior: $${analysis.bollinger.lower}
- %B: ${analysis.bollinger.percentB}`
    : '';
  const atrBlock = analysis.atr
    ? `**ATR (14):** $${analysis.atr.value} (${analysis.atr.percentage}%) [${analysis.atr.volatility}]`
    : '';
  const stochasticBlock = analysis.stochastic
    ? `**Stochastic (14,3):** K=${analysis.stochastic.k} D=${analysis.stochastic.d} [${analysis.stochastic.interpretation}]`
    : '';
  const adxBlock = analysis.adx
    ? `**ADX (14):** ${analysis.adx.adx} [${analysis.adx.trendStrength}]
- +DI: ${analysis.adx.plusDI}
- -DI: ${analysis.adx.minusDI}`
    : '';
  const supportResistanceBlock = analysis.supportResistance
    ? `**Suporte/Resistência:**
- R3: $${analysis.supportResistance.resistance3}
- R2: $${analysis.supportResistance.resistance2}
- R1: $${analysis.supportResistance.resistance1}
- Pivot: $${analysis.supportResistance.pivot}
- S1: $${analysis.supportResistance.support1}
- S2: $${analysis.supportResistance.support2}
- S3: $${analysis.supportResistance.support3}`
    : '';
  const volumeBlock = analysis.volume
    ? `**Volume:**
- Atual: ${analysis.volume.currentVolume}
- Média: ${analysis.volume.averageVolume}
- Ratio: ${analysis.volume.volumeRatio}x [${analysis.volume.interpretation}]`
    : '';

  return `
## ANÁLISE TÉCNICA - ${analysis.symbol} (${analysis.interval}min)
Timestamp: ${new Date(analysis.timestamp).toISOString()}
Preço Atual: $${analysis.currentPrice}

### INDICADORES CALCULADOS (VALORES EXATOS - NÃO ALTERAR):

${rsiBlock}
${macdBlock}
${movingAveragesBlock}
${bollingerBlock}
${atrBlock}
${stochasticBlock}
${adxBlock}
${supportResistanceBlock}
${volumeBlock}

### SINAL PRÉ-CALCULADO:
Sinal: ${analysis.overallSignal.toUpperCase()}
Confiança: ${Math.round(analysis.confidence * 100)}%

---
INSTRUÇÕES PARA O LLM:
1. Use APENAS os números acima para sua análise
2. NÃO invente ou altere nenhum valor
3. Cite os valores EXATOS ao explicar sua análise
4. Sua resposta será VERIFICADA contra esses valores
`.trim();
}

