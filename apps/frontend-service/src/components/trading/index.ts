/**
 * Trading Components - Barrel Export
 * 
 * Exporta todos os componentes de trading para uso no frontend.
 * 
 * Autor: Fillipe Guerra
 * Data: 17 de Dezembro de 2025
 */

export { CandleChart } from './CandleChart';
export type { CandleChartProps, KlineData } from './CandleChart';

export { OrderBookViz } from './OrderBookViz';
export type { OrderBookVizProps, OrderBookData, OrderBookEntry } from './OrderBookViz';

export { HandoverPanel } from './HandoverPanel';
export type { HandoverPanelProps, TradingControlMode, ControlHistoryEntry } from './HandoverPanel';
