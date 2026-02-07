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

export interface KucoinCurrencyChain {
  chain: string;
  withdrawalMinFee?: string;
  withdrawFeeRate?: string;
  withdrawalMinSize?: string;
  withdrawMaxFee?: string;
  isWithdrawEnabled?: boolean;
}

export interface KucoinCurrencyInfo {
  currency: string;
  name?: string;
  chains?: KucoinCurrencyChain[];
}

export interface KucoinTradeFee {
  symbol: string;
  makerFeeRate?: string;
  takerFeeRate?: string;
}

export interface CreateSpotOrderParams {
  clientOid: string;
  side: 'buy' | 'sell';
  symbol: string;
  type: 'limit' | 'market';
  price?: string;
  size?: string;
  funds?: string;
  timeInForce?: 'GTC' | 'GTT' | 'IOC' | 'FOK';
  cancelAfter?: number;
  postOnly?: boolean;
  hidden?: boolean;
  iceberg?: boolean;
  visibleSize?: string;
  remark?: string;
  stp?: 'CN' | 'CO' | 'CB' | 'DC';
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
// TIPOS FASE 3 - OCO Orders, Batch Orders, Modify Order
// ============================================================================

/** Parâmetros para criar OCO order Spot */
export interface CreateSpotOcoOrderParams {
  clientOid: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: string;
  size: string;
  stopPrice: string;
  limitPrice: string;
  tradeType?: 'TRADE';
  remark?: string;
}

/** Resposta OCO order Spot */
export interface SpotOcoOrder {
  orderId: string;
  symbol: string;
  clientOid: string;
  orderTime: number;
  status: string;
}

/** Detalhe OCO order Spot */
export interface SpotOcoOrderDetail {
  orderId: string;
  symbol: string;
  clientOid: string;
  orderTime: number;
  status: string;
  orders: Array<{
    id: string;
    symbol: string;
    side: string;
    price: string;
    size: string;
    status: string;
  }>;
}

/** Parâmetros para batch order Spot */
export interface BatchSpotOrderParams {
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

/** Parâmetros para modificar ordem Spot */
export interface ModifySpotOrderParams {
  symbol: string;
  orderId?: string;
  clientOid?: string;
  newPrice?: string;
  newSize?: string;
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
 * Lista moedas com taxas de saque (withdrawal)
 * GET /api/v3/currencies
 */
export async function getCurrencies(): Promise<KucoinCurrencyInfo[]> {
  const response = await kucoinSpotRequester.executeRequest<KucoinCurrencyInfo[]>(
    'GET',
    '/api/v3/currencies',
    undefined,
    false
  );
  return response.data ?? [];
}

/**
 * Obtém taxas de trade por símbolo (Spot/Margin)
 * GET /api/v1/trade-fees
 */
export async function getSpotTradeFees(symbols: string[]): Promise<KucoinTradeFee[]> {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    throw new Error('Símbolos são obrigatórios para obter taxas de trade.');
  }
  const endpoint = buildEndpoint('/api/v1/trade-fees', { symbols: symbols.join(',') });
  const response = await kucoinSpotRequester.executeRequest<KucoinTradeFee[]>(
    'GET',
    endpoint,
    undefined,
    true
  );
  return response.data ?? [];
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
 * Cria ordem Spot via HF (High-Frequency) API
 * POST /api/v1/hf/orders
 * 
 * MIGRADO de /api/v1/orders (API legacy) para HF API (mais rápida, melhor rate limit)
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/orders/add-order
 */
export async function createSpotOrder(params: CreateSpotOrderParams): Promise<SpotOrderCreateResponse> {
  const response = await kucoinSpotRequester.executeRequest<SpotOrderCreateResponse>(
    'POST',
    '/api/v1/hf/orders',
    params as unknown as Record<string, unknown>,
    true
  );
  logger.info({ orderId: response.data.orderId, symbol: params.symbol }, 'Ordem Spot criada via HF API');
  return response.data;
}

/**
 * Cancela ordem Spot via HF API
 * DELETE /api/v1/hf/orders/{orderId}
 * 
 * MIGRADO de /api/v1/orders/{orderId} para HF API
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/orders/cancel-order-by-orderld
 */
export async function cancelSpotOrder(orderId: string): Promise<{ cancelledOrderIds: string[] }> {
  const response = await kucoinSpotRequester.executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    `/api/v1/hf/orders/${orderId}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Obtém detalhes de ordem Spot via HF API
 * GET /api/v1/hf/orders/{orderId}
 * 
 * MIGRADO de /api/v1/orders/{orderId} para HF API
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/orders/get-order-by-orderld
 */
export async function getSpotOrder(orderId: string): Promise<SpotOrder> {
  const response = await kucoinSpotRequester.executeRequest<SpotOrder>(
    'GET',
    `/api/v1/hf/orders/${orderId}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Lista ordens Spot abertas via HF API
 * GET /api/v1/hf/orders/active
 * 
 * MIGRADO de /api/v1/orders?status=active para HF API
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/orders/get-open-orders
 */
export async function getOpenSpotOrders(symbol?: string): Promise<SpotOrder[]> {
  const endpoint = buildEndpoint('/api/v1/hf/orders/active', { symbol });
  const response = await kucoinSpotRequester.executeRequest<SpotOrder[]>('GET', endpoint, undefined, true);
  return Array.isArray(response.data) ? response.data : [];
}

/**
 * Lista ordens Spot encerradas via HF API
 * GET /api/v1/hf/orders/done
 * 
 * MIGRADO de /api/v1/orders?status=done para HF API
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/orders/get-closed-orders
 */
export async function getClosedSpotOrders(symbol?: string): Promise<SpotOrder[]> {
  const endpoint = buildEndpoint('/api/v1/hf/orders/done', { symbol });
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

// ============================================================================
// FASE 3 - OCO Orders Spot
// ============================================================================

/**
 * Criar OCO order Spot
 * POST /api/v3/oco/order
 */
export async function createSpotOcoOrder(params: CreateSpotOcoOrderParams): Promise<SpotOcoOrder> {
  const response = await kucoinSpotRequester.executeRequest<SpotOcoOrder>(
    'POST',
    '/api/v3/oco/order',
    params as unknown as Record<string, unknown>,
    true
  );
  logger.info({ orderId: response.data.orderId, symbol: params.symbol }, 'OCO order Spot criada');
  return response.data;
}

/**
 * Cancelar OCO order Spot por orderId
 * DELETE /api/v3/oco/order/:orderId
 */
export async function cancelSpotOcoOrder(orderId: string): Promise<{ cancelledOrderIds: string[] }> {
  const response = await kucoinSpotRequester.executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    `/api/v3/oco/order/${orderId}`,
    undefined,
    true
  );
  logger.info({ orderId }, 'OCO order Spot cancelada');
  return response.data;
}

/**
 * Cancelar OCO order Spot por clientOid
 * DELETE /api/v3/oco/client-order/:clientOid
 */
export async function cancelSpotOcoOrderByClientOid(clientOid: string): Promise<{ cancelledOrderIds: string[] }> {
  const response = await kucoinSpotRequester.executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    `/api/v3/oco/client-order/${clientOid}`,
    undefined,
    true
  );
  logger.info({ clientOid }, 'OCO order Spot cancelada por clientOid');
  return response.data;
}

/**
 * Cancelar todas OCO orders Spot
 * DELETE /api/v3/oco/orders
 */
export async function cancelAllSpotOcoOrders(symbol?: string, orderIds?: string): Promise<{ cancelledOrderIds: string[] }> {
  const endpoint = buildEndpoint('/api/v3/oco/orders', { symbol, orderIds });
  const response = await kucoinSpotRequester.executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    endpoint,
    undefined,
    true
  );
  logger.info({ symbol }, 'Todas OCO orders Spot canceladas');
  return response.data;
}

/**
 * Obter OCO order Spot por orderId
 * GET /api/v3/oco/order/:orderId
 */
export async function getSpotOcoOrder(orderId: string): Promise<SpotOcoOrderDetail> {
  const response = await kucoinSpotRequester.executeRequest<SpotOcoOrderDetail>(
    'GET',
    `/api/v3/oco/order/${orderId}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Obter OCO order Spot por clientOid
 * GET /api/v3/oco/client-order/:clientOid
 */
export async function getSpotOcoOrderByClientOid(clientOid: string): Promise<SpotOcoOrderDetail> {
  const response = await kucoinSpotRequester.executeRequest<SpotOcoOrderDetail>(
    'GET',
    `/api/v3/oco/client-order/${clientOid}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Listar OCO orders Spot
 * GET /api/v3/oco/orders
 */
export async function getSpotOcoOrders(params?: {
  symbol?: string;
  orderIds?: string;
  startAt?: number;
  endAt?: number;
  currentPage?: number;
  pageSize?: number;
}): Promise<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: SpotOcoOrderDetail[] }> {
  const endpoint = buildEndpoint('/api/v3/oco/orders', params as Record<string, string | number | undefined>);
  const response = await kucoinSpotRequester.executeRequest<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: SpotOcoOrderDetail[] }>(
    'GET',
    endpoint,
    undefined,
    true
  );
  return response.data;
}

// ============================================================================
// FASE 3 - Batch Orders, Cancel by ClientOid, Cancel All, Modify Order
// ============================================================================

/**
 * Batch create Spot orders via HF API
 * POST /api/v1/hf/orders/multi
 */
export async function batchCreateSpotOrders(orderList: BatchSpotOrderParams[]): Promise<{ orderId: string; clientOid: string }[]> {
  const response = await kucoinSpotRequester.executeRequest<{ orderId: string; clientOid: string }[]>(
    'POST',
    '/api/v1/hf/orders/multi',
    { orderList },
    true
  );
  logger.info({ count: orderList.length }, 'Batch spot orders criadas via HF API');
  return response.data;
}

/**
 * Cancelar Spot order por clientOid via HF API
 * DELETE /api/v1/hf/orders/client-order/:clientOid?symbol=XXX
 */
export async function cancelSpotOrderByClientOid(clientOid: string, symbol: string): Promise<{ clientOid: string }> {
  const endpoint = buildEndpoint(`/api/v1/hf/orders/client-order/${clientOid}`, { symbol });
  const response = await kucoinSpotRequester.executeRequest<{ clientOid: string }>(
    'DELETE',
    endpoint,
    undefined,
    true
  );
  logger.info({ clientOid, symbol }, 'Spot order cancelada por clientOid via HF API');
  return response.data;
}

/**
 * Cancelar todas Spot orders via HF API
 * DELETE /api/v1/hf/orders?symbol=XXX
 */
export async function cancelAllSpotOrders(symbol?: string): Promise<{ cancelledOrderIds: string[] }> {
  const endpoint = buildEndpoint('/api/v1/hf/orders', { symbol });
  const response = await kucoinSpotRequester.executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    endpoint,
    undefined,
    true
  );
  logger.info({ symbol }, 'Todas spot orders canceladas via HF API');
  return response.data;
}

/**
 * Cancelar todas stop orders Spot
 * DELETE /api/v1/stop-order/cancel
 */
export async function cancelAllSpotStopOrders(symbol?: string): Promise<{ cancelledOrderIds: string[] }> {
  const endpoint = buildEndpoint('/api/v1/stop-order/cancel', { symbol });
  const response = await kucoinSpotRequester.executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    endpoint,
    undefined,
    true
  );
  logger.info({ symbol }, 'Todas stop orders Spot canceladas');
  return response.data;
}

/**
 * Modificar ordem Spot via HF API
 * POST /api/v1/hf/orders/alter
 */
export async function modifySpotOrder(params: ModifySpotOrderParams): Promise<{ newOrderId: string }> {
  const response = await kucoinSpotRequester.executeRequest<{ newOrderId: string }>(
    'POST',
    '/api/v1/hf/orders/alter',
    params as unknown as Record<string, unknown>,
    true
  );
  logger.info({ symbol: params.symbol, orderId: params.orderId }, 'Spot order modificada via HF API');
  return response.data;
}

// ============================================================================
// MARKET DATA AVANÇADO - Cobertura 100% KuCoin Spot API
// ============================================================================

/** Anúncio KuCoin */
export interface SpotAnnouncement {
  annId: number;
  annTitle: string;
  annType: string;
  annDesc: string;
  cTime: number;
  language: string;
  annUrl: string;
}

/**
 * Obtém anúncios KuCoin
 * GET /api/v3/announcements
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/market-data/get-announcements
 */
export async function getSpotAnnouncements(params?: { currentPage?: number; pageSize?: number; annType?: string; lang?: string; startTime?: number; endTime?: number }): Promise<{ totalNum: number; items: SpotAnnouncement[] }> {
  const endpoint = buildEndpoint('/api/v3/announcements', params as Record<string, string | number | undefined>);
  const response = await kucoinSpotRequester.executeRequest<{ totalNum: number; items: SpotAnnouncement[] }>('GET', endpoint, undefined, false);
  return response.data;
}

/**
 * Obtém detalhes de uma moeda específica
 * GET /api/v3/currencies/{currency}
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/market-data/get-currency-detail
 */
export async function getSpotCurrency(currency: string): Promise<KucoinCurrencyInfo> {
  const response = await kucoinSpotRequester.executeRequest<KucoinCurrencyInfo>('GET', `/api/v3/currencies/${encodeURIComponent(currency)}`, undefined, false);
  return response.data;
}

/**
 * Obtém detalhes de um símbolo Spot
 * GET /api/v2/symbols/{symbol}
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/market-data/get-symbol-detail
 */
export async function getSpotSymbol(symbol: string): Promise<SpotSymbolInfo> {
  const response = await kucoinSpotRequester.executeRequest<SpotSymbolInfo>('GET', `/api/v2/symbols/${encodeURIComponent(symbol)}`, undefined, false);
  return response.data;
}

/**
 * Obtém order book completo Level 2
 * GET /api/v3/market/orderbook/level2
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/market-data/get-full-orderbook
 */
export async function getFullSpotOrderBook(symbol: string): Promise<SpotOrderBook> {
  const endpoint = buildEndpoint('/api/v3/market/orderbook/level2', { symbol });
  const response = await kucoinSpotRequester.executeRequest<SpotOrderBook>('GET', endpoint, undefined, true);
  return response.data;
}

/** Dados de call auction order book */
export interface CallAuctionOrderBook {
  sequence: string;
  time: number;
  bids: string[][];
  asks: string[][];
}

/**
 * Obtém order book de call auction
 * GET /api/v3/market/orderbook/callAuction/level5
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/market-data/get-call-auction-orderbook
 */
export async function getCallAuctionOrderBook(symbol: string): Promise<CallAuctionOrderBook> {
  const endpoint = buildEndpoint('/api/v3/market/orderbook/callAuction/level5', { symbol });
  const response = await kucoinSpotRequester.executeRequest<CallAuctionOrderBook>('GET', endpoint, undefined, false);
  return response.data;
}

/** Dados de call auction */
export interface CallAuctionInfo {
  symbol: string;
  price: string;
  size: string;
  time: number;
  status: string;
}

/**
 * Obtém informações de call auction
 * GET /api/v3/market/callAuction/{symbol}
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/market-data/get-call-auction-info
 */
export async function getCallAuctionInfo(symbol: string): Promise<CallAuctionInfo> {
  const response = await kucoinSpotRequester.executeRequest<CallAuctionInfo>('GET', `/api/v3/market/callAuction/${encodeURIComponent(symbol)}`, undefined, false);
  return response.data;
}

/**
 * Obtém preços FIAT
 * GET /api/v1/prices
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/market-data/get-fiat-price
 */
export async function getFiatPrice(params?: { base?: string; currencies?: string }): Promise<Record<string, string>> {
  const endpoint = buildEndpoint('/api/v1/prices', params as Record<string, string | number | undefined>);
  const response = await kucoinSpotRequester.executeRequest<Record<string, string>>('GET', endpoint, undefined, false);
  return response.data;
}

/** Estatísticas 24h Spot */
export interface Spot24hrStats {
  time: number;
  symbol: string;
  buy: string;
  sell: string;
  changeRate: string;
  changePrice: string;
  high: string;
  low: string;
  vol: string;
  volValue: string;
  last: string;
  averagePrice: string;
  takerFeeRate: string;
  makerFeeRate: string;
  takerCoefficient: string;
  makerCoefficient: string;
}

/**
 * Obtém estatísticas 24h de um símbolo Spot
 * GET /api/v1/market/stats
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/market-data/get-24hr-stats
 */
export async function getSpot24hrStats(symbol: string): Promise<Spot24hrStats> {
  const endpoint = buildEndpoint('/api/v1/market/stats', { symbol });
  const response = await kucoinSpotRequester.executeRequest<Spot24hrStats>('GET', endpoint, undefined, false);
  return response.data;
}

/**
 * Obtém lista de mercados Spot
 * GET /api/v1/markets
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/market-data/get-market-list
 */
export async function getSpotMarketList(): Promise<string[]> {
  const response = await kucoinSpotRequester.executeRequest<string[]>('GET', '/api/v1/markets', undefined, false);
  return response.data;
}

/**
 * Obtém hora do servidor Spot
 * GET /api/v1/timestamp
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/market-data/get-server-time
 */
export async function getSpotServerTime(): Promise<number> {
  const response = await kucoinSpotRequester.executeRequest<number>('GET', '/api/v1/timestamp', undefined, false);
  return response.data;
}

/** Status do serviço Spot */
export interface SpotServiceStatus {
  status: string;
  msg: string;
}

/**
 * Obtém status do serviço Spot
 * GET /api/v1/status
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/market-data/get-service-status
 */
export async function getSpotServiceStatus(): Promise<SpotServiceStatus> {
  const response = await kucoinSpotRequester.executeRequest<SpotServiceStatus>('GET', '/api/v1/status', undefined, false);
  return response.data;
}

// ============================================================================
// ORDENS AVANÇADAS - Cobertura 100% KuCoin Spot API (sync, test, fills, DCP)
// ============================================================================

/** Resposta de criação de ordem sync */
export interface SpotOrderSyncResponse {
  orderId: string;
  orderTime: number;
  originSize: string;
  dealSize: string;
  remainSize: string;
  cancelledSize: string;
  status: string;
  matchTime: number;
}

/**
 * Cria ordem Spot com resposta síncrona
 * POST /api/v1/hf/orders/sync
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/orders/add-order-sync
 */
export async function createSpotOrderSync(params: CreateSpotOrderParams): Promise<SpotOrderSyncResponse> {
  const response = await kucoinSpotRequester.executeRequest<SpotOrderSyncResponse>('POST', '/api/v1/hf/orders/sync', params as unknown as Record<string, unknown>, true);
  logger.info({ orderId: response.data.orderId, symbol: params.symbol }, 'Spot order criada (sync)');
  return response.data;
}

/**
 * Cria ordem Spot de teste (dry run)
 * POST /api/v1/hf/orders/test
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/orders/add-order-test
 */
export async function createSpotOrderTest(params: CreateSpotOrderParams): Promise<SpotOrderCreateResponse> {
  const response = await kucoinSpotRequester.executeRequest<SpotOrderCreateResponse>('POST', '/api/v1/hf/orders/test', params as unknown as Record<string, unknown>, true);
  logger.info({ orderId: response.data.orderId, symbol: params.symbol }, 'Spot order de teste criada (dry run)');
  return response.data;
}

/**
 * Cria múltiplas ordens Spot sync
 * POST /api/v1/hf/orders/multi/sync
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/orders/batch-add-orders-sync
 */
export async function batchCreateSpotOrdersSync(orders: BatchSpotOrderParams[]): Promise<SpotOrderSyncResponse[]> {
  const response = await kucoinSpotRequester.executeRequest<SpotOrderSyncResponse[]>('POST', '/api/v1/hf/orders/multi/sync', { orderList: orders } as unknown as Record<string, unknown>, true);
  logger.info({ count: orders.length }, 'Batch de ordens Spot sync criadas');
  return response.data;
}

/**
 * Cancela ordem Spot com resposta síncrona
 * DELETE /api/v1/hf/orders/sync/{orderId}
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/orders/cancel-order-by-orderid-sync
 */
export async function cancelSpotOrderSync(orderId: string, symbol: string): Promise<{ orderId: string; cancelledSize: string; status: string }> {
  const response = await kucoinSpotRequester.executeRequest<{ orderId: string; cancelledSize: string; status: string }>('DELETE', `/api/v1/hf/orders/sync/${encodeURIComponent(orderId)}?symbol=${encodeURIComponent(symbol)}`, undefined, true);
  logger.info({ orderId, symbol }, 'Spot order cancelada sync');
  return response.data;
}

/**
 * Cancela ordem Spot por clientOid sync
 * DELETE /api/v1/hf/orders/sync/client-order/{clientOid}
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/orders/cancel-order-by-clientoid-sync
 */
export async function cancelSpotOrderByClientOidSync(clientOid: string, symbol: string): Promise<{ clientOid: string; cancelledSize: string; status: string }> {
  const response = await kucoinSpotRequester.executeRequest<{ clientOid: string; cancelledSize: string; status: string }>('DELETE', `/api/v1/hf/orders/sync/client-order/${encodeURIComponent(clientOid)}?symbol=${encodeURIComponent(symbol)}`, undefined, true);
  logger.info({ clientOid, symbol }, 'Spot order cancelada por clientOid sync');
  return response.data;
}

/**
 * Cancela ordem Spot parcialmente
 * DELETE /api/v1/hf/orders/cancel/{orderId}
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/orders/cancel-partial-order
 */
export async function cancelPartialSpotOrder(orderId: string, symbol: string, cancelSize: string): Promise<{ orderId: string; cancelledSize: string }> {
  const response = await kucoinSpotRequester.executeRequest<{ orderId: string; cancelledSize: string }>('DELETE', `/api/v1/hf/orders/cancel/${encodeURIComponent(orderId)}?symbol=${encodeURIComponent(symbol)}&cancelSize=${encodeURIComponent(cancelSize)}`, undefined, true);
  logger.info({ orderId, symbol, cancelSize }, 'Spot order parcialmente cancelada');
  return response.data;
}

/**
 * Cancela todas ordens Spot por símbolo
 * DELETE /api/v1/hf/orders/cancelAll
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/orders/cancel-all-orders-by-symbol
 */
export async function cancelSpotOrdersBySymbol(symbol: string): Promise<string> {
  const endpoint = buildEndpoint('/api/v1/hf/orders/cancelAll', { symbol });
  const response = await kucoinSpotRequester.executeRequest<string>('DELETE', endpoint, undefined, true);
  logger.info({ symbol }, 'Todas ordens Spot canceladas por símbolo');
  return response.data;
}

/**
 * Obtém ordem Spot por clientOid
 * GET /api/v1/hf/orders/client-order/{clientOid}
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/orders/get-order-by-clientoid
 */
export async function getSpotOrderByClientOid(clientOid: string, symbol: string): Promise<SpotOrder> {
  const response = await kucoinSpotRequester.executeRequest<SpotOrder>('GET', `/api/v1/hf/orders/client-order/${encodeURIComponent(clientOid)}?symbol=${encodeURIComponent(symbol)}`, undefined, true);
  return response.data;
}

/**
 * Obtém símbolos com ordens abertas
 * GET /api/v1/hf/orders/active/symbols
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/orders/get-symbols-with-open-order
 */
export async function getSymbolsWithOpenOrder(): Promise<{ symbols: string[] }> {
  const response = await kucoinSpotRequester.executeRequest<{ symbols: string[] }>('GET', '/api/v1/hf/orders/active/symbols', undefined, true);
  return response.data;
}

/**
 * Obtém ordens abertas por página
 * GET /api/v1/hf/orders/active
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/orders/get-open-orders
 */
export async function getOpenSpotOrdersByPage(params: { symbol: string; currentPage?: number; pageSize?: number }): Promise<SpotOrder[]> {
  const endpoint = buildEndpoint('/api/v1/hf/orders/active', params as Record<string, string | number | undefined>);
  const response = await kucoinSpotRequester.executeRequest<SpotOrder[]>('GET', endpoint, undefined, true);
  return response.data;
}

/** Fill/Trade Spot */
export interface SpotFill {
  id: string;
  symbol: string;
  tradeId: string;
  orderId: string;
  counterOrderId: string;
  side: string;
  liquidity: string;
  forceTaker: boolean;
  price: string;
  size: string;
  funds: string;
  fee: string;
  feeRate: string;
  feeCurrency: string;
  stop: string;
  tradeType: string;
  type: string;
  createdAt: number;
}

/**
 * Obtém histórico de trades/fills Spot
 * GET /api/v1/hf/fills
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/fills/get-recent-filled-list
 */
export async function getSpotTradeHistory(params: { symbol: string; orderId?: string; side?: 'buy' | 'sell'; type?: 'limit' | 'market'; startAt?: number; endAt?: number; lastId?: number; limit?: number }): Promise<SpotFill[]> {
  const endpoint = buildEndpoint('/api/v1/hf/fills', params as Record<string, string | number | undefined>);
  const response = await kucoinSpotRequester.executeRequest<SpotFill[]>('GET', endpoint, undefined, true);
  return response.data;
}

/** DCP (Dead Cancel All) info */
export interface SpotDCPInfo {
  timeout: number;
  symbols: string;
  currentTime: number;
  triggerTime: number;
}

/**
 * Obtém configuração DCP (Dead Cancel Protection)
 * GET /api/v1/hf/orders/dead-cancel-all/query
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/orders/get-dcp
 */
export async function getSpotDCP(): Promise<SpotDCPInfo> {
  const response = await kucoinSpotRequester.executeRequest<SpotDCPInfo>('GET', '/api/v1/hf/orders/dead-cancel-all/query', undefined, true);
  return response.data;
}

/**
 * Configura DCP (Dead Cancel Protection)
 * POST /api/v1/hf/orders/dead-cancel-all
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/orders/set-dcp
 */
export async function setSpotDCP(timeout: number, symbols?: string): Promise<{ currentTime: number; triggerTime: number }> {
  const body: Record<string, unknown> = { timeout };
  if (symbols) body.symbols = symbols;
  const response = await kucoinSpotRequester.executeRequest<{ currentTime: number; triggerTime: number }>('POST', '/api/v1/hf/orders/dead-cancel-all', body, true);
  logger.info({ timeout, symbols }, 'DCP configurado');
  return response.data;
}

/**
 * Cancela stop order Spot por clientOid
 * DELETE /api/v1/stop-order/cancelOrderByClientOid
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/stop-order/cancel-stop-order-by-clientoid
 */
export async function cancelSpotStopOrderByClientOid(clientOid: string, symbol?: string): Promise<{ cancelledOrderId: string; clientOid: string }> {
  const endpoint = buildEndpoint('/api/v1/stop-order/cancelOrderByClientOid', { clientOid, symbol });
  const response = await kucoinSpotRequester.executeRequest<{ cancelledOrderId: string; clientOid: string }>('DELETE', endpoint, undefined, true);
  logger.info({ clientOid, symbol }, 'Stop order Spot cancelada por clientOid');
  return response.data;
}

/**
 * Obtém stop order Spot por ID
 * GET /api/v1/stop-order/{orderId}
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/stop-order/get-stop-order-by-orderid
 */
export async function getSpotStopOrderById(orderId: string): Promise<SpotOrder> {
  const response = await kucoinSpotRequester.executeRequest<SpotOrder>('GET', `/api/v1/stop-order/${encodeURIComponent(orderId)}`, undefined, true);
  return response.data;
}

/**
 * Obtém stop order Spot por clientOid
 * GET /api/v1/stop-order/queryOrderByClientOid
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/stop-order/get-stop-order-by-clientoid
 */
export async function getSpotStopOrderByClientOid(clientOid: string, symbol?: string): Promise<SpotOrder[]> {
  const endpoint = buildEndpoint('/api/v1/stop-order/queryOrderByClientOid', { clientOid, symbol });
  const response = await kucoinSpotRequester.executeRequest<SpotOrder[]>('GET', endpoint, undefined, true);
  return response.data;
}

/**
 * Obtém detalhes de OCO order Spot
 * GET /api/v3/oco/order/details/{orderId}
 * Ref: https://www.kucoin.com/docs-new/rest/spot-trading/oco-order/get-oco-order-detail
 */
export async function getSpotOcoOrderDetail(orderId: string): Promise<SpotOcoOrderDetail> {
  const response = await kucoinSpotRequester.executeRequest<SpotOcoOrderDetail>('GET', `/api/v3/oco/order/details/${encodeURIComponent(orderId)}`, undefined, true);
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
  // FASE 3 - OCO Orders
  createSpotOcoOrder,
  cancelSpotOcoOrder,
  cancelSpotOcoOrderByClientOid,
  cancelAllSpotOcoOrders,
  getSpotOcoOrder,
  getSpotOcoOrderByClientOid,
  getSpotOcoOrders,
  // FASE 3 - Batch, Cancel by ClientOid, Cancel All, Modify
  batchCreateSpotOrders,
  cancelSpotOrderByClientOid,
  cancelAllSpotOrders,
  cancelAllSpotStopOrders,
  modifySpotOrder,
  // Market Data Avançado (cobertura 100%)
  getSpotAnnouncements,
  getSpotCurrency,
  getSpotSymbol,
  getFullSpotOrderBook,
  getCallAuctionOrderBook,
  getCallAuctionInfo,
  getFiatPrice,
  getSpot24hrStats,
  getSpotMarketList,
  getSpotServerTime,
  getSpotServiceStatus,
  // Ordens Avançadas (sync, test, fills, DCP)
  createSpotOrderSync,
  createSpotOrderTest,
  batchCreateSpotOrdersSync,
  cancelSpotOrderSync,
  cancelSpotOrderByClientOidSync,
  cancelPartialSpotOrder,
  cancelSpotOrdersBySymbol,
  getSpotOrderByClientOid,
  getSymbolsWithOpenOrder,
  getOpenSpotOrdersByPage,
  getSpotTradeHistory,
  getSpotDCP,
  setSpotDCP,
  cancelSpotStopOrderByClientOid,
  getSpotStopOrderById,
  getSpotStopOrderByClientOid,
  getSpotOcoOrderDetail,
  isSpotConfigured,
  getSpotCircuitBreakerStatus,
  initKucoinSpotMetrics,
};
