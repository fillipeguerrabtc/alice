/**
 * Trading Types - Alice Enterprise Platform
 *
 * Tipos normalizados para broadcast de trading em tempo real.
 * Mantém payloads consistentes entre Futures, Spot e Margin.
 *
 * Regra 6: sem mocks, sem dados fictícios
 * Regra 8: TypeScript strict
 *
 * Autor: Fillipe Guerra
 * Data: 27 de Janeiro de 2026
 */

export type TradingMarketType = 'futures' | 'spot' | 'margin';
export type TradingMarginMode = 'cross' | 'isolated';

export interface NormalizedTickerData {
  symbol: string;
  price: string;
  size: string;
  bestBid: string;
  bestBidSize: string;
  bestAsk: string;
  bestAskSize: string;
  timestamp: number;
}

export interface NormalizedOrderBookEntry {
  price: string;
  size: string;
  sequence: number;
}

export interface NormalizedOrderBookData {
  symbol: string;
  sequence: number;
  bids: NormalizedOrderBookEntry[];
  asks: NormalizedOrderBookEntry[];
  timestamp: number;
}

export interface NormalizedKlineData {
  symbol: string;
  interval?: string;
  time: number;
  open: string;
  close: string;
  high: string;
  low: string;
  volume: string;
  turnover: string;
}

export interface NormalizedTradeData {
  symbol: string;
  price: string;
  size: number;
  side: string;
  tradeId: string;
  ts: number;
}

// ============================================================================
// FUNÇÕES DE NORMALIZAÇÃO
// ============================================================================

/**
 * Normaliza dados de ticker do WebSocket KuCoin para formato de broadcast
 */
export function normalizeTickerData(
  data: {
    symbol: string;
    price: string;
    size: number;
    bestBidPrice: string;
    bestBidSize: number;
    bestAskPrice: string;
    bestAskSize: number;
    ts: number;
  }
): NormalizedTickerData {
  return {
    symbol: data.symbol,
    price: data.price,
    size: String(data.size),
    bestBid: data.bestBidPrice,
    bestBidSize: String(data.bestBidSize),
    bestAsk: data.bestAskPrice,
    bestAskSize: String(data.bestAskSize),
    timestamp: data.ts,
  };
}

/**
 * Normaliza dados de order book do WebSocket KuCoin para formato de broadcast
 * OrderBookData já é compatível com NormalizedOrderBookData, apenas garante tipos
 */
export function normalizeOrderBookData(
  data: {
    symbol: string;
    sequence: number;
    bids: Array<{ price: string; size: string; sequence: number }>;
    asks: Array<{ price: string; size: string; sequence: number }>;
    timestamp: number;
  }
): NormalizedOrderBookData {
  // OrderBookData já tem estrutura idêntica a NormalizedOrderBookData
  return data as NormalizedOrderBookData;
}

/**
 * Normaliza dados de kline do WebSocket KuCoin para formato de broadcast
 */
export function normalizeKlineData(
  data: {
    symbol: string;
    interval?: string;
    candles: [
      number,  // timestamp
      string,  // open
      string,  // close
      string,  // high
      string,  // low
      string,  // volume
      string,  // turnover
    ];
    time: number;
  }
): NormalizedKlineData {
  return {
    symbol: data.symbol,
    interval: data.interval,
    time: data.time || data.candles[0],
    open: data.candles[1],
    close: data.candles[2],
    high: data.candles[3],
    low: data.candles[4],
    volume: data.candles[5],
    turnover: data.candles[6],
  };
}

/**
 * Normaliza dados de trade do WebSocket KuCoin para formato de broadcast
 */
export function normalizeTradeData(
  data: {
    symbol: string;
    price: string;
    size: number;
    side: string;
    tradeId: string;
    ts: number;
  }
): NormalizedTradeData {
  return {
    symbol: data.symbol,
    price: data.price,
    size: data.size,
    side: data.side,
    tradeId: data.tradeId,
    ts: data.ts,
  };
}
