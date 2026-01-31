/**
 * KuCoin Spot Client - Alice Enterprise Platform
 *
 * Implementação dedicada para Spot trading (REST),
 * alinhada à documentação oficial KuCoin 2025.
 *
 * Regra 6: SEM MOCKS - integração real.
 * Regra 8: TypeScript strict.
 *
 * Autor: Fillipe Guerra
 * Data: 27 de Janeiro de 2026
 */

import { createLogger } from '@alice/logger';
import { CIRCUIT_BREAKER_PRESETS, createAlicePrometheus } from '@alice/shared-utils';
import { createKucoinRequester } from './kucoinRequest.js';

const logger = createLogger('kucoin-spot-client');

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

const KUCOIN_SPOT_BASE_URL = (process.env.KUCOIN_SPOT_BASE_URL || 'https://api.kucoin.com').trim();
const KUCOIN_PRO_API_KEY = process.env.KUCOIN_PRO_API_KEY;
const KUCOIN_PRO_API_SECRET = process.env.KUCOIN_PRO_API_SECRET;
const KUCOIN_PRO_API_PASSPHRASE = process.env.KUCOIN_PRO_API_PASSPHRASE;

const kucoinSpotRequester = createKucoinRequester({
  name: 'kucoin-spot',
  operationPrefix: 'spot',
  baseUrl: KUCOIN_SPOT_BASE_URL,
  circuitBreakerPreset: CIRCUIT_BREAKER_PRESETS.kucoinSpot,
});

export function initKucoinSpotMetrics(prometheusMetrics: ReturnType<typeof createAlicePrometheus>['metrics']): void {
  kucoinSpotRequester.initMetrics(prometheusMetrics);
  logger.info('Métricas KuCoin Spot inicializadas');
}

// ============================================================================
// TIPOS
// ============================================================================

export interface SpotSymbolInfo {
  symbol: string;
  name?: string;
  baseCurrency?: string;
  quoteCurrency?: string;
  baseIncrement?: string;
  quoteIncrement?: string;
  priceIncrement?: string;
  enableTrading?: boolean;
}

export interface SpotTicker {
  symbol: string;
  price: string;
  size: string;
  bestBid: string;
  bestBidSize: string;
  bestAsk: string;
  bestAskSize: string;
  time: number;
}

export interface SpotTickerInfo {
  symbol: string;
  volValue?: string;
  vol?: string;
  last?: string;
  buy?: string;
  sell?: string;
}

interface SpotAllTickersResponse {
  time: number;
  ticker: SpotTickerInfo[];
}

export interface SpotOrderBook {
  sequence: string;
  time: number;
  bids: string[][];
  asks: string[][];
}

export interface SpotKline {
  time: number;
  open: string;
  close: string;
  high: string;
  low: string;
  volume: string;
  turnover: string;
}

export interface SpotTrade {
  sequence: string;
  price: string;
  size: string;
  side: string;
  time: number;
}

export interface SpotAccount {
  id: string;
  currency: string;
  type: string;
  balance: string;
  available: string;
  holds: string;
}

export interface SpotOrder {
  id: string;
  symbol: string;
  opType?: string;
  type: string;
  side: string;
  price: string;
  size: string;
  funds: string;
  dealFunds: string;
  dealSize: string;
  fee: string;
  feeCurrency: string;
  isActive?: boolean;
  cancelExist?: boolean;
  createdAt: number;
}

export interface SpotOrderCreateResponse {
  orderId: string;
}

export interface CreateSpotOrderParams {
  clientOid: string;
  side: 'buy' | 'sell';
  symbol: string;
  type: 'limit' | 'market';
  price?: string;
  size?: string;
  funds?: string;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
  remark?: string;
}

export interface CreateSpotStopOrderParams {
  clientOid: string;
  side: 'buy' | 'sell';
  symbol: string;
  type: 'limit' | 'market';
  stopPrice: string;
  price?: string;
  size?: string;
  funds?: string;
  remark?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function buildEndpoint(base: string, query?: Record<string, string | number | undefined>): string {
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const queryString = params.toString();
  return queryString ? `${base}?${queryString}` : base;
}

// ============================================================================
// ENDPOINTS PÚBLICOS
// ============================================================================

/**
 * Lista símbolos Spot disponíveis
 * GET /api/v1/symbols
 */
export async function getSpotSymbols(): Promise<SpotSymbolInfo[]> {
  const response = await kucoinSpotRequester.executeRequest<SpotSymbolInfo[]>(
    'GET',
    '/api/v1/symbols',
    undefined,
    false
  );
  const symbols = response.data ?? [];
  return symbols.filter((item) => item.enableTrading !== false);
}

/**
 * Obtém ticker Spot (level1)
 * GET /api/v1/market/orderbook/level1
 */
export async function getSpotTicker(symbol: string): Promise<SpotTicker> {
  const endpoint = buildEndpoint('/api/v1/market/orderbook/level1', { symbol });
  const response = await kucoinSpotRequester.executeRequest<SpotTicker>('GET', endpoint, undefined, false);
  return response.data;
}

/**
 * Lista todos os tickers Spot (para ranking por volume)
 * GET /api/v1/market/allTickers
 */
export async function getSpotAllTickers(): Promise<SpotTickerInfo[]> {
  const response = await kucoinSpotRequester.executeRequest<SpotAllTickersResponse>(
    'GET',
    '/api/v1/market/allTickers',
    undefined,
    false
  );
  return response.data?.ticker ?? [];
}

/**
 * Obtém order book Spot (level2_20)
 * GET /api/v1/market/orderbook/level2_20
 */
export async function getSpotOrderBook(symbol: string): Promise<SpotOrderBook> {
  const endpoint = buildEndpoint('/api/v1/market/orderbook/level2_20', { symbol });
  const response = await kucoinSpotRequester.executeRequest<SpotOrderBook>('GET', endpoint, undefined, false);
  return response.data;
}

/**
 * Obtém klines Spot
 * GET /api/v1/market/candles
 */
export async function getSpotKlines(symbol: string, type: string, startAt?: number, endAt?: number): Promise<SpotKline[]> {
  const endpoint = buildEndpoint('/api/v1/market/candles', { symbol, type, startAt, endAt });
  const response = await kucoinSpotRequester.executeRequest<string[][]>('GET', endpoint, undefined, false);
  return response.data.map(([time, open, close, high, low, volume, turnover]) => ({
    time: Number(time) * 1000,
    open,
    close,
    high,
    low,
    volume,
    turnover,
  }));
}

/**
 * Obtém trades Spot
 * GET /api/v1/market/histories
 */
export async function getSpotTrades(symbol: string): Promise<SpotTrade[]> {
  const endpoint = buildEndpoint('/api/v1/market/histories', { symbol });
  const response = await kucoinSpotRequester.executeRequest<SpotTrade[]>('GET', endpoint, undefined, false);
  return response.data;
}

// ============================================================================
// ENDPOINTS PRIVADOS
// ============================================================================

/**
 * Lista contas Spot (trade)
 * GET /api/v1/accounts
 */
export async function getSpotAccounts(type: 'trade' | 'main' | 'margin' | 'isolated' = 'trade'): Promise<SpotAccount[]> {
  const endpoint = buildEndpoint('/api/v1/accounts', { type });
  const response = await kucoinSpotRequester.executeRequest<SpotAccount[]>('GET', endpoint, undefined, true);
  return response.data;
}

/**
 * Cria ordem Spot
 * POST /api/v1/orders
 */
export async function createSpotOrder(params: CreateSpotOrderParams): Promise<SpotOrderCreateResponse> {
  const response = await kucoinSpotRequester.executeRequest<SpotOrderCreateResponse>(
    'POST',
    '/api/v1/orders',
    params as unknown as Record<string, unknown>,
    true
  );
  logger.info({ orderId: response.data.orderId, symbol: params.symbol }, 'Ordem Spot criada');
  return response.data;
}

/**
 * Cancela ordem Spot
 * DELETE /api/v1/orders/{orderId}
 */
export async function cancelSpotOrder(orderId: string): Promise<{ cancelledOrderIds: string[] }> {
  const response = await kucoinSpotRequester.executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    `/api/v1/orders/${orderId}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Obtém detalhes de ordem Spot
 * GET /api/v1/orders/{orderId}
 */
export async function getSpotOrder(orderId: string): Promise<SpotOrder> {
  const response = await kucoinSpotRequester.executeRequest<SpotOrder>(
    'GET',
    `/api/v1/orders/${orderId}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Lista ordens Spot abertas
 * GET /api/v1/orders?status=active
 */
export async function getOpenSpotOrders(symbol?: string): Promise<SpotOrder[]> {
  const endpoint = buildEndpoint('/api/v1/orders', { status: 'active', symbol });
  const response = await kucoinSpotRequester.executeRequest<{ items: SpotOrder[] }>('GET', endpoint, undefined, true);
  return response.data.items ?? [];
}

/**
 * Lista ordens Spot encerradas
 * GET /api/v1/orders?status=done
 */
export async function getClosedSpotOrders(symbol?: string): Promise<SpotOrder[]> {
  const endpoint = buildEndpoint('/api/v1/orders', { status: 'done', symbol });
  const response = await kucoinSpotRequester.executeRequest<{ items: SpotOrder[] }>('GET', endpoint, undefined, true);
  return response.data.items ?? [];
}

/**
 * Cria stop order Spot
 * POST /api/v1/stop-order
 */
export async function createSpotStopOrder(params: CreateSpotStopOrderParams): Promise<SpotOrderCreateResponse> {
  const response = await kucoinSpotRequester.executeRequest<SpotOrderCreateResponse>(
    'POST',
    '/api/v1/stop-order',
    params as unknown as Record<string, unknown>,
    true
  );
  logger.info({ orderId: response.data.orderId, symbol: params.symbol }, 'Stop order Spot criada');
  return response.data;
}

/**
 * Lista stop orders Spot
 * GET /api/v1/stop-order
 */
export async function getSpotStopOrders(symbol?: string): Promise<SpotOrder[]> {
  const endpoint = buildEndpoint('/api/v1/stop-order', { symbol });
  const response = await kucoinSpotRequester.executeRequest<{ items: SpotOrder[] }>('GET', endpoint, undefined, true);
  return response.data.items ?? [];
}

/**
 * Cancela stop order Spot por ID
 * DELETE /api/v1/stop-order/{orderId}
 */
export async function cancelSpotStopOrder(orderId: string): Promise<{ cancelledOrderIds: string[] }> {
  const response = await kucoinSpotRequester.executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    `/api/v1/stop-order/${orderId}`,
    undefined,
    true
  );
  return response.data;
}

export function getSpotCircuitBreakerStatus() {
  return kucoinSpotRequester.getCircuitBreakerStatus();
}

export function isSpotConfigured(): boolean {
  return !!(KUCOIN_PRO_API_KEY && KUCOIN_PRO_API_SECRET && KUCOIN_PRO_API_PASSPHRASE);
}

export default {
  getSpotSymbols,
  getSpotTicker,
  getSpotAllTickers,
  getSpotOrderBook,
  getSpotKlines,
  getSpotTrades,
  getSpotAccounts,
  createSpotOrder,
  cancelSpotOrder,
  getSpotOrder,
  getOpenSpotOrders,
  getClosedSpotOrders,
  createSpotStopOrder,
  getSpotStopOrders,
  cancelSpotStopOrder,
  isSpotConfigured,
  getSpotCircuitBreakerStatus,
  initKucoinSpotMetrics,
};
