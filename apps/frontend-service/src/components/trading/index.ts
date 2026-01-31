/**
 * Trading Components - Barrel Export
 * 
 * Exporta todos os componentes de trading para uso no frontend.
 * 
 * Autor: Fillipe Guerra
 * Data: 21 de Dezembro de 2025
 */

export { CandleChart } from './CandleChart';
export type { CandleChartProps, KlineData } from './CandleChart';

export { OrderBookViz } from './OrderBookViz';
export type { OrderBookVizProps, OrderBookData, OrderBookEntry } from './OrderBookViz';

export { HandoverPanel } from './HandoverPanel';
export type { HandoverPanelProps, TradingControlMode, ControlHistoryEntry } from './HandoverPanel';

export { TechnicalAnalysisPanel } from './TechnicalAnalysisPanel';
export type { 
  TechnicalAnalysisPanelProps,
  TechnicalAnalysisResult,
  RSIResult,
  MACDResult,
  MovingAverageResult,
  BollingerResult,
  ATRResult,
  StochasticResult,
  ADXResult,
  SupportResistanceResult,
  VolumeAnalysisResult,
} from './TechnicalAnalysisPanel';

export { SignalApprovalPanel } from './SignalApprovalPanel';
export type { SignalApprovalPanelProps } from './SignalApprovalPanel';

export { NewsConfigEditor, DEFAULT_TRADING_NEWS_CONFIG, normalizeTradingNewsConfigForm } from './NewsConfigEditor';
export type { TradingNewsConfigForm, TradingNewsPresetOption } from './NewsConfigEditor';
