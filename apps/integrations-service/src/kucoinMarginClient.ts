/**
 * KuCoin Margin Client - Alice Enterprise Platform
 *
 * Implementação dedicada para Margin trading (REST),
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

const logger = createLogger('kucoin-margin-client');

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

const KUCOIN_MARGIN_BASE_URL = (process.env.KUCOIN_MARGIN_BASE_URL || 'https://api.kucoin.com').trim();
const KUCOIN_PRO_API_KEY = process.env.KUCOIN_PRO_API_KEY;
const KUCOIN_PRO_API_SECRET = process.env.KUCOIN_PRO_API_SECRET;
const KUCOIN_PRO_API_PASSPHRASE = process.env.KUCOIN_PRO_API_PASSPHRASE;

const kucoinMarginRequester = createKucoinRequester({
  name: 'kucoin-margin',
  operationPrefix: 'margin',
  baseUrl: KUCOIN_MARGIN_BASE_URL,
  circuitBreakerPreset: CIRCUIT_BREAKER_PRESETS.kucoinMargin,
});

export function initKucoinMarginMetrics(prometheusMetrics: ReturnType<typeof createAlicePrometheus>['metrics']): void {
  kucoinMarginRequester.initMetrics(prometheusMetrics);
  logger.info('Métricas KuCoin Margin inicializadas');
}

// ============================================================================
// TIPOS
// ============================================================================

export interface MarginSymbolInfo {
  symbol: string;
  name?: string;
  baseCurrency?: string;
  quoteCurrency?: string;
  baseIncrement?: string;
  quoteIncrement?: string;
  priceIncrement?: string;
  enableTrading?: boolean;
}

export interface MarginOrder {
  id: string;
  symbol: string;
  type: string;
  side: string;
  price: string;
  size: string;
  funds?: string;
  dealFunds?: string;
  dealSize?: string;
  fee?: string;
  isActive?: boolean;
  cancelExist?: boolean;
  createdAt: number;
}

export interface MarginOrderCreateResponse {
  orderId: string;
  clientOid: string;
}

export interface MarginCrossAccountEntry {
  currency: string;
  total: string;
  available: string;
  hold: string;
  liability: string;
  liabilityPrincipal: string;
  liabilityInterest: string;
  maxBorrowSize: string;
  borrowEnabled: boolean;
  transferInEnabled: boolean;
}

export interface MarginCrossAccount {
  totalAssetOfQuoteCurrency: string;
  totalLiabilityOfQuoteCurrency: string;
  debtRatio: string;
  status: string;
  accounts: MarginCrossAccountEntry[];
}

export interface MarginIsolatedAssetDetail {
  currency: string;
  borrowEnabled: boolean;
  transferInEnabled: boolean;
  liability: string;
  liabilityPrincipal: string;
  liabilityInterest: string;
  total: string;
  available: string;
  hold: string;
  maxBorrowSize: string;
}

export interface MarginIsolatedAsset {
  symbol: string;
  status: string;
  debtRatio: string;
  baseAsset: MarginIsolatedAssetDetail;
  quoteAsset: MarginIsolatedAssetDetail;
}

export interface MarginIsolatedAccount {
  totalAssetOfQuoteCurrency: string;
  totalLiabilityOfQuoteCurrency: string;
  timestamp: number;
  assets: MarginIsolatedAsset[];
}

export interface CreateMarginOrderParams {
  clientOid: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price?: string;
  size?: string;
  funds?: string;
  timeInForce?: 'GTC' | 'GTT' | 'IOC' | 'FOK';
  isIsolated?: boolean;
  autoBorrow?: boolean;
  autoRepay?: boolean;
  remark?: string;
}

export interface CreateMarginStopOrderParams {
  clientOid: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  stopPrice: string;
  price?: string;
  size?: string;
  funds?: string;
  isIsolated?: boolean;
  autoBorrow?: boolean;
  autoRepay?: boolean;
  remark?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function buildEndpoint(base: string, query?: Record<string, string | number | boolean | undefined>): string {
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
 * Lista símbolos Margin (Cross)
 * GET /api/v3/margin/symbols
 */
export async function getCrossMarginSymbols(symbol?: string): Promise<MarginSymbolInfo[]> {
  const endpoint = buildEndpoint('/api/v3/margin/symbols', { symbol });
  const response = await kucoinMarginRequester.executeRequest<{ items: MarginSymbolInfo[] }>(
    'GET',
    endpoint,
    undefined,
    false
  );
  const items = response.data?.items ?? [];
  return items.filter((item) => item.enableTrading !== false);
}

/**
 * Lista símbolos Margin (Isolated)
 * GET /api/v1/isolated/symbols
 */
export async function getIsolatedMarginSymbols(): Promise<MarginSymbolInfo[]> {
  const response = await kucoinMarginRequester.executeRequest<MarginSymbolInfo[]>(
    'GET',
    '/api/v1/isolated/symbols',
    undefined,
    false
  );
  const items = response.data ?? [];
  return items.filter((item) => item.enableTrading !== false);
}

// ============================================================================
// ENDPOINTS PRIVADOS
// ============================================================================

/**
 * Obtém conta Cross Margin
 * GET /api/v3/margin/accounts
 */
export async function getCrossMarginAccount(quoteCurrency?: string): Promise<MarginCrossAccount> {
  const endpoint = buildEndpoint('/api/v3/margin/accounts', {
    quoteCurrency,
    queryType: 'MARGIN',
  });
  const response = await kucoinMarginRequester.executeRequest<MarginCrossAccount>(
    'GET',
    endpoint,
    undefined,
    true
  );
  return response.data;
}

/**
 * Obtém conta Isolated Margin
 * GET /api/v3/isolated/accounts
 */
export async function getIsolatedMarginAccount(symbol?: string, quoteCurrency?: string): Promise<MarginIsolatedAccount> {
  const endpoint = buildEndpoint('/api/v3/isolated/accounts', {
    symbol,
    quoteCurrency,
    queryType: 'ISOLATED',
  });
  const response = await kucoinMarginRequester.executeRequest<MarginIsolatedAccount>(
    'GET',
    endpoint,
    undefined,
    true
  );
  return response.data;
}

/**
 * Cria ordem Margin
 * POST /api/v3/hf/margin/order
 */
export async function createMarginOrder(params: CreateMarginOrderParams): Promise<MarginOrderCreateResponse> {
  const response = await kucoinMarginRequester.executeRequest<MarginOrderCreateResponse>(
    'POST',
    '/api/v3/hf/margin/order',
    params as unknown as Record<string, unknown>,
    true
  );
  logger.info({ orderId: response.data.orderId, symbol: params.symbol }, 'Ordem Margin criada');
  return response.data;
}

/**
 * Cancela ordem Margin por orderId
 * DELETE /api/v3/hf/margin/order/{orderId}
 */
export async function cancelMarginOrder(orderId: string): Promise<{ cancelledOrderIds: string[] }> {
  const response = await kucoinMarginRequester.executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    `/api/v3/hf/margin/order/${orderId}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Obtém detalhes de ordem Margin
 * GET /api/v3/hf/margin/order/{orderId}
 */
export async function getMarginOrder(orderId: string): Promise<MarginOrder> {
  const response = await kucoinMarginRequester.executeRequest<MarginOrder>(
    'GET',
    `/api/v3/hf/margin/order/${orderId}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Lista ordens Margin abertas
 * GET /api/v3/hf/margin/orders/active
 */
export async function getOpenMarginOrders(): Promise<MarginOrder[]> {
  const response = await kucoinMarginRequester.executeRequest<{ items: MarginOrder[] }>(
    'GET',
    '/api/v3/hf/margin/orders/active',
    undefined,
    true
  );
  return response.data.items ?? [];
}

/**
 * Lista ordens Margin encerradas
 * GET /api/v3/hf/margin/orders/done
 */
export async function getClosedMarginOrders(): Promise<MarginOrder[]> {
  const response = await kucoinMarginRequester.executeRequest<{ items: MarginOrder[] }>(
    'GET',
    '/api/v3/hf/margin/orders/done',
    undefined,
    true
  );
  return response.data.items ?? [];
}

/**
 * Cria stop order Margin
 * POST /api/v3/hf/margin/stop-order
 */
export async function createMarginStopOrder(params: CreateMarginStopOrderParams): Promise<MarginOrderCreateResponse> {
  const response = await kucoinMarginRequester.executeRequest<MarginOrderCreateResponse>(
    'POST',
    '/api/v3/hf/margin/stop-order',
    params as unknown as Record<string, unknown>,
    true
  );
  logger.info({ orderId: response.data.orderId, symbol: params.symbol }, 'Stop order Margin criada');
  return response.data;
}

/**
 * Lista stop orders Margin
 * GET /api/v3/hf/margin/stop-orders
 */
export async function getMarginStopOrders(): Promise<MarginOrder[]> {
  const response = await kucoinMarginRequester.executeRequest<{ items: MarginOrder[] }>(
    'GET',
    '/api/v3/hf/margin/stop-orders',
    undefined,
    true
  );
  return response.data.items ?? [];
}

/**
 * Cancela stop order Margin
 * DELETE /api/v3/hf/margin/stop-order/{orderId}
 */
export async function cancelMarginStopOrder(orderId: string): Promise<{ cancelledOrderIds: string[] }> {
  const response = await kucoinMarginRequester.executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    `/api/v3/hf/margin/stop-order/${orderId}`,
    undefined,
    true
  );
  return response.data;
}

export function getMarginCircuitBreakerStatus() {
  return kucoinMarginRequester.getCircuitBreakerStatus();
}

export function isMarginConfigured(): boolean {
  return !!(KUCOIN_PRO_API_KEY && KUCOIN_PRO_API_SECRET && KUCOIN_PRO_API_PASSPHRASE);
}

export default {
  getCrossMarginSymbols,
  getIsolatedMarginSymbols,
  getCrossMarginAccount,
  getIsolatedMarginAccount,
  createMarginOrder,
  cancelMarginOrder,
  getMarginOrder,
  getOpenMarginOrders,
  getClosedMarginOrders,
  createMarginStopOrder,
  getMarginStopOrders,
  cancelMarginStopOrder,
  isMarginConfigured,
  getMarginCircuitBreakerStatus,
  initKucoinMarginMetrics,
};
