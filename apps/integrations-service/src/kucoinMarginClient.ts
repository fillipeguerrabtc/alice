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
// TIPOS FASE 4 - OCO Orders, Debit (Borrow/Repay), Leverage
// ============================================================================

/** Parâmetros para criar OCO order Margin */
export interface CreateMarginOcoOrderParams {
  clientOid: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: string;
  size: string;
  stopPrice: string;
  limitPrice: string;
  tradeType?: 'MARGIN_TRADE' | 'MARGIN_ISOLATED_TRADE';
  remark?: string;
}

/** Resposta OCO order Margin */
export interface MarginOcoOrder {
  orderId: string;
  symbol: string;
  clientOid: string;
  orderTime: number;
  status: string;
}

/** Detalhe OCO order Margin */
export interface MarginOcoOrderDetail {
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

/** Parâmetros para borrow (empréstimo) */
export interface BorrowMarginParams {
  currency: string;
  size: string;
  timeInForce: 'IOC' | 'FOK';
  isIsolated?: boolean;
  symbol?: string;
  isHf?: boolean;
}

/** Parâmetros para repay (pagamento) */
export interface RepayMarginParams {
  currency: string;
  size: string;
  isIsolated?: boolean;
  symbol?: string;
  isHf?: boolean;
}

/** Registro de borrow */
export interface BorrowRecord {
  orderNo: string;
  symbol: string;
  currency: string;
  size: string;
  actualSize: string;
  status: string;
  createdAt: number;
}

/** Registro de repay */
export interface RepayRecord {
  orderNo: string;
  symbol: string;
  currency: string;
  size: string;
  principal: string;
  interest: string;
  status: string;
  createdAt: number;
}

/** Registro de juros */
export interface InterestRecord {
  currency: string;
  dayRatio: string;
  interestAmount: string;
  createdAt: number;
}

/** Taxa de juros de empréstimo */
export interface BorrowInterestRate {
  currency: string;
  purchaseEnable: boolean;
  redeemEnable: boolean;
  increment: string;
  minPurchaseSize: string;
  minInterestRate: string;
  maxInterestRate: string;
  interestIncrement: string;
  maxPurchaseSize: string;
  marketInterestRate: string;
  autoPurchaseEnable: boolean;
}

/** Parâmetros para histórico de borrow */
export interface BorrowHistoryParams {
  currency?: string;
  isIsolated?: boolean;
  symbol?: string;
  orderNo?: string;
  startTime?: number;
  endTime?: number;
  currentPage?: number;
  pageSize?: number;
}

/** Parâmetros para histórico de repay */
export interface RepayHistoryParams {
  currency?: string;
  isIsolated?: boolean;
  symbol?: string;
  orderNo?: string;
  startTime?: number;
  endTime?: number;
  currentPage?: number;
  pageSize?: number;
}

/** Parâmetros para histórico de juros */
export interface InterestHistoryParams {
  currency?: string;
  isIsolated?: boolean;
  symbol?: string;
  startTime?: number;
  endTime?: number;
  currentPage?: number;
  pageSize?: number;
}

// ============================================================================
// TIPOS - Market Data Avançado + Ordens Avançadas (cobertura 100%)
// ============================================================================

/** Informações de ETF Margin */
export interface MarginETFInfo {
  currency: string;
  netAsset: string;
  targetLeverage: string;
  actualLeverage: string;
  issuedSize: string;
  basket: string;
}

/** Mark Price de um símbolo */
export interface MarkPriceDetail {
  symbol: string;
  granularity: number;
  timePoint: number;
  value: number;
}

/** Configuração geral Margin */
export interface MarginConfig {
  currencyList: string[];
  warningDebtRatio: string;
  liqDebtRatio: string;
  maxLeverage: number;
}

/** Collateral ratio de uma moeda */
export interface CollateralRatioEntry {
  currency: string;
  rate: string;
  marginCoefficient: string;
}

/** Moeda disponível para margin */
export interface MarginCurrencyInfo {
  currency: string;
  purchaseEnable: boolean;
  borrowEnable: boolean;
  precision: number;
  borrowMinAmount: string;
  borrowMaxAmount: string;
  availableAmount: string;
}

/** Fill (trade) Margin */
export interface MarginFill {
  id: string;
  symbol: string;
  orderId: string;
  tradeId: string;
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
  type: string;
  createdAt: number;
}

/** Resposta de ordem síncrona Margin */
export interface MarginOrderSyncResponse {
  orderId: string;
  clientOid: string;
  orderTime: number;
  originSize: string;
  dealSize: string;
  remainSize: string;
  cancelledSize: string;
  status: string;
  matchTime: number;
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
 * POST /api/v3/margin/order
 * Ref: https://www.kucoin.com/docs-new/api-3470272 (Add Margin Order - API Unificada 2025)
 */
export async function createMarginOrder(params: CreateMarginOrderParams): Promise<MarginOrderCreateResponse> {
  const response = await kucoinMarginRequester.executeRequest<MarginOrderCreateResponse>(
    'POST',
    '/api/v3/margin/order',
    params as unknown as Record<string, unknown>,
    true
  );
  logger.info({ orderId: response.data.orderId, symbol: params.symbol }, 'Ordem Margin criada');
  return response.data;
}

/**
 * Cancela ordem Margin por orderId
 * DELETE /api/v3/margin/order/{orderId}
 * Ref: https://www.kucoin.com/docs-new/api-3470273 (Cancel Margin Order - API Unificada 2025)
 */
export async function cancelMarginOrder(orderId: string): Promise<{ cancelledOrderIds: string[] }> {
  const response = await kucoinMarginRequester.executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    `/api/v3/margin/order/${orderId}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Obtém detalhes de ordem Margin
 * GET /api/v3/margin/order/{orderId}
 * Ref: https://www.kucoin.com/docs-new/api-3470274 (Get Margin Order - API Unificada 2025)
 */
export async function getMarginOrder(orderId: string): Promise<MarginOrder> {
  const response = await kucoinMarginRequester.executeRequest<MarginOrder>(
    'GET',
    `/api/v3/margin/order/${orderId}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Lista ordens Margin abertas
 * GET /api/v3/margin/orders/active
 * Ref: https://www.kucoin.com/docs-new/api-3470275 (Get Active Margin Orders - API Unificada 2025)
 */
export async function getOpenMarginOrders(): Promise<MarginOrder[]> {
  const response = await kucoinMarginRequester.executeRequest<{ items: MarginOrder[] }>(
    'GET',
    '/api/v3/margin/orders/active',
    undefined,
    true
  );
  return response.data.items ?? [];
}

/**
 * Lista ordens Margin encerradas
 * GET /api/v3/margin/orders/done
 * Ref: https://www.kucoin.com/docs-new/api-3470276 (Get Closed Margin Orders - API Unificada 2025)
 */
export async function getClosedMarginOrders(): Promise<MarginOrder[]> {
  const response = await kucoinMarginRequester.executeRequest<{ items: MarginOrder[] }>(
    'GET',
    '/api/v3/margin/orders/done',
    undefined,
    true
  );
  return response.data.items ?? [];
}

/**
 * Cria stop order Margin
 * POST /api/v3/margin/stop-order
 * Ref: https://www.kucoin.com/docs-new/api-3470277 (Add Margin Stop Order - API Unificada 2025)
 */
export async function createMarginStopOrder(params: CreateMarginStopOrderParams): Promise<MarginOrderCreateResponse> {
  const response = await kucoinMarginRequester.executeRequest<MarginOrderCreateResponse>(
    'POST',
    '/api/v3/margin/stop-order',
    params as unknown as Record<string, unknown>,
    true
  );
  logger.info({ orderId: response.data.orderId, symbol: params.symbol }, 'Stop order Margin criada');
  return response.data;
}

/**
 * Lista stop orders Margin
 * GET /api/v3/margin/stop-orders
 * Ref: https://www.kucoin.com/docs-new/api-3470278 (Get Margin Stop Orders - API Unificada 2025)
 */
export async function getMarginStopOrders(): Promise<MarginOrder[]> {
  const response = await kucoinMarginRequester.executeRequest<{ items: MarginOrder[] }>(
    'GET',
    '/api/v3/margin/stop-orders',
    undefined,
    true
  );
  return response.data.items ?? [];
}

/**
 * Cancela stop order Margin
 * DELETE /api/v3/margin/stop-order/{orderId}
 * Ref: https://www.kucoin.com/docs-new/api-3470279 (Cancel Margin Stop Order - API Unificada 2025)
 */
export async function cancelMarginStopOrder(orderId: string): Promise<{ cancelledOrderIds: string[] }> {
  const response = await kucoinMarginRequester.executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    `/api/v3/margin/stop-order/${orderId}`,
    undefined,
    true
  );
  return response.data;
}

// ============================================================================
// FASE 4 - OCO Orders Margin
// ============================================================================

/**
 * Criar OCO order Margin
 * POST /api/v3/oco/order
 */
export async function createMarginOcoOrder(params: CreateMarginOcoOrderParams): Promise<MarginOcoOrder> {
  const response = await kucoinMarginRequester.executeRequest<MarginOcoOrder>(
    'POST',
    '/api/v3/oco/order',
    params as unknown as Record<string, unknown>,
    true
  );
  logger.info({ orderId: response.data.orderId, symbol: params.symbol }, 'OCO order margin criada');
  return response.data;
}

/**
 * Cancelar OCO order Margin por orderId
 * DELETE /api/v3/oco/order/:orderId
 */
export async function cancelMarginOcoOrder(orderId: string): Promise<{ cancelledOrderIds: string[] }> {
  const response = await kucoinMarginRequester.executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    `/api/v3/oco/order/${orderId}`,
    undefined,
    true
  );
  logger.info({ orderId }, 'OCO order margin cancelada');
  return response.data;
}

/**
 * Cancelar OCO order Margin por clientOid
 * DELETE /api/v3/oco/client-order/:clientOid
 */
export async function cancelMarginOcoOrderByClientOid(clientOid: string): Promise<{ cancelledOrderIds: string[] }> {
  const response = await kucoinMarginRequester.executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    `/api/v3/oco/client-order/${clientOid}`,
    undefined,
    true
  );
  logger.info({ clientOid }, 'OCO order margin cancelada por clientOid');
  return response.data;
}

/**
 * Cancelar todas OCO orders Margin
 * DELETE /api/v3/oco/orders
 */
export async function cancelAllMarginOcoOrders(symbol?: string, orderIds?: string): Promise<{ cancelledOrderIds: string[] }> {
  const endpoint = buildEndpoint('/api/v3/oco/orders', { symbol, orderIds });
  const response = await kucoinMarginRequester.executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    endpoint,
    undefined,
    true
  );
  logger.info({ symbol }, 'Todas OCO orders margin canceladas');
  return response.data;
}

/**
 * Obter OCO order Margin por orderId
 * GET /api/v3/oco/order/:orderId
 */
export async function getMarginOcoOrder(orderId: string): Promise<MarginOcoOrderDetail> {
  const response = await kucoinMarginRequester.executeRequest<MarginOcoOrderDetail>(
    'GET',
    `/api/v3/oco/order/${orderId}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Obter OCO order Margin por clientOid
 * GET /api/v3/oco/client-order/:clientOid
 */
export async function getMarginOcoOrderByClientOid(clientOid: string): Promise<MarginOcoOrderDetail> {
  const response = await kucoinMarginRequester.executeRequest<MarginOcoOrderDetail>(
    'GET',
    `/api/v3/oco/client-order/${clientOid}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Listar OCO orders Margin
 * GET /api/v3/oco/orders
 */
export async function getMarginOcoOrders(params?: {
  symbol?: string;
  orderIds?: string;
  startAt?: number;
  endAt?: number;
  currentPage?: number;
  pageSize?: number;
}): Promise<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: MarginOcoOrderDetail[] }> {
  const endpoint = buildEndpoint('/api/v3/oco/orders', params as Record<string, string | number | boolean | undefined>);
  const response = await kucoinMarginRequester.executeRequest<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: MarginOcoOrderDetail[] }>(
    'GET',
    endpoint,
    undefined,
    true
  );
  return response.data;
}

// ============================================================================
// FASE 4 - Margin Debit (Borrow/Repay/Interest)
// ============================================================================

/**
 * Emprestar (borrow) moeda no Margin
 * POST /api/v3/margin/borrow
 */
export async function borrowMargin(params: BorrowMarginParams): Promise<BorrowRecord> {
  const response = await kucoinMarginRequester.executeRequest<BorrowRecord>(
    'POST',
    '/api/v3/margin/borrow',
    params as unknown as Record<string, unknown>,
    true
  );
  logger.info({ currency: params.currency, size: params.size }, 'Margin borrow realizado');
  return response.data;
}

/**
 * Pagar (repay) empréstimo Margin
 * POST /api/v3/margin/repay
 */
export async function repayMargin(params: RepayMarginParams): Promise<RepayRecord> {
  const response = await kucoinMarginRequester.executeRequest<RepayRecord>(
    'POST',
    '/api/v3/margin/repay',
    params as unknown as Record<string, unknown>,
    true
  );
  logger.info({ currency: params.currency, size: params.size }, 'Margin repay realizado');
  return response.data;
}

/**
 * Histórico de borrows
 * GET /api/v3/margin/borrow
 */
export async function getBorrowHistory(params?: BorrowHistoryParams): Promise<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: BorrowRecord[] }> {
  const endpoint = buildEndpoint('/api/v3/margin/borrow', params as Record<string, string | number | boolean | undefined>);
  const response = await kucoinMarginRequester.executeRequest<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: BorrowRecord[] }>(
    'GET',
    endpoint,
    undefined,
    true
  );
  return response.data;
}

/**
 * Histórico de repays
 * GET /api/v3/margin/repay
 */
export async function getRepayHistory(params?: RepayHistoryParams): Promise<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: RepayRecord[] }> {
  const endpoint = buildEndpoint('/api/v3/margin/repay', params as Record<string, string | number | boolean | undefined>);
  const response = await kucoinMarginRequester.executeRequest<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: RepayRecord[] }>(
    'GET',
    endpoint,
    undefined,
    true
  );
  return response.data;
}

/**
 * Histórico de juros
 * GET /api/v3/margin/interest
 */
export async function getInterestHistory(params?: InterestHistoryParams): Promise<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: InterestRecord[] }> {
  const endpoint = buildEndpoint('/api/v3/margin/interest', params as Record<string, string | number | boolean | undefined>);
  const response = await kucoinMarginRequester.executeRequest<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: InterestRecord[] }>(
    'GET',
    endpoint,
    undefined,
    true
  );
  return response.data;
}

/**
 * Obter taxas de juros de empréstimo
 * GET /api/v3/project/list
 */
export async function getLendingRates(currency?: string): Promise<BorrowInterestRate[]> {
  const endpoint = buildEndpoint('/api/v3/project/list', { currency });
  const response = await kucoinMarginRequester.executeRequest<BorrowInterestRate[]>(
    'GET',
    endpoint,
    undefined,
    true
  );
  return response.data;
}

// ============================================================================
// FASE 4 - Cancelar Margin Order por ClientOid + Modificar Leverage
// ============================================================================

/**
 * Cancelar Margin Order por clientOid
 * DELETE /api/v1/order/client-order/:clientOid
 */
export async function cancelMarginOrderByClientOid(clientOid: string): Promise<{ cancelledOrderId: string; clientOid: string }> {
  const response = await kucoinMarginRequester.executeRequest<{ cancelledOrderId: string; clientOid: string }>(
    'DELETE',
    `/api/v1/order/client-order/${clientOid}`,
    undefined,
    true
  );
  logger.info({ clientOid }, 'Margin order cancelada por clientOid');
  return response.data;
}

/**
 * Modificar leverage Cross Margin
 * POST /api/v3/position/update-user-leverage
 */
export async function updateCrossMarginLeverage(leverage: number): Promise<{ leverage: number }> {
  const response = await kucoinMarginRequester.executeRequest<{ leverage: number }>(
    'POST',
    '/api/v3/position/update-user-leverage',
    { leverage },
    true
  );
  logger.info({ leverage }, 'Leverage cross margin atualizado');
  return response.data;
}

// ============================================================================
// MARKET DATA AVANÇADO (cobertura 100%)
// ============================================================================

/**
 * Informações de ETF Margin
 * GET /api/v3/etf/info
 */
export async function getMarginETFInfo(currency?: string): Promise<MarginETFInfo[]> {
  const endpoint = buildEndpoint('/api/v3/etf/info', { currency });
  const response = await kucoinMarginRequester.executeRequest<MarginETFInfo[]>(
    'GET',
    endpoint,
    undefined,
    false
  );
  return response.data;
}

/**
 * Mark Price de um símbolo
 * GET /api/v3/mark-price/{symbol}/current
 */
export async function getMarkPriceDetail(symbol: string): Promise<MarkPriceDetail> {
  const response = await kucoinMarginRequester.executeRequest<MarkPriceDetail>(
    'GET',
    `/api/v3/mark-price/${symbol}/current`,
    undefined,
    false
  );
  return response.data;
}

/**
 * Configuração geral Margin
 * GET /api/v3/margin/config
 */
export async function getMarginConfig(): Promise<MarginConfig> {
  const response = await kucoinMarginRequester.executeRequest<MarginConfig>(
    'GET',
    '/api/v3/margin/config',
    undefined,
    false
  );
  return response.data;
}

/**
 * Lista de mark prices de todos os símbolos
 * GET /api/v3/mark-price/all-symbols
 */
export async function getMarkPriceList(): Promise<MarkPriceDetail[]> {
  const response = await kucoinMarginRequester.executeRequest<MarkPriceDetail[]>(
    'GET',
    '/api/v3/mark-price/all-symbols',
    undefined,
    false
  );
  return response.data;
}

/**
 * Collateral ratio de moedas
 * GET /api/v3/margin/collateral-ratio
 */
export async function getMarginCollateralRatio(): Promise<CollateralRatioEntry[]> {
  const response = await kucoinMarginRequester.executeRequest<CollateralRatioEntry[]>(
    'GET',
    '/api/v3/margin/collateral-ratio',
    undefined,
    false
  );
  return response.data;
}

/**
 * Moedas disponíveis para margin (inventário)
 * GET /api/v3/margin/currencies
 */
export async function getMarginAvailableInventory(type?: string): Promise<MarginCurrencyInfo[]> {
  const endpoint = buildEndpoint('/api/v3/margin/currencies', { isIsolated: type === 'isolated' ? true : undefined });
  const response = await kucoinMarginRequester.executeRequest<MarginCurrencyInfo[]>(
    'GET',
    endpoint,
    undefined,
    false
  );
  return response.data;
}

// ============================================================================
// ORDENS AVANÇADAS (cobertura 100%)
// ============================================================================

/**
 * Criar ordem Margin teste (sem executar)
 * POST /api/v3/hf/margin/order/test
 */
export async function createMarginOrderTest(params: CreateMarginOrderParams): Promise<MarginOrderCreateResponse> {
  const response = await kucoinMarginRequester.executeRequest<MarginOrderCreateResponse>(
    'POST',
    '/api/v3/hf/margin/order/test',
    params as unknown as Record<string, unknown>,
    true
  );
  return response.data;
}

/**
 * Cancelar todas ordens Margin por símbolo
 * DELETE /api/v3/hf/margin/orders
 */
export async function cancelAllMarginOrdersBySymbol(symbol: string, tradeType?: string): Promise<string> {
  const endpoint = buildEndpoint('/api/v3/hf/margin/orders', { symbol, tradeType });
  const response = await kucoinMarginRequester.executeRequest<string>(
    'DELETE',
    endpoint,
    undefined,
    true
  );
  return response.data;
}

/**
 * Símbolos com ordens abertas Margin
 * GET /api/v3/hf/margin/order/active/symbols
 */
export async function getMarginSymbolsWithOpenOrder(tradeType?: string): Promise<{ symbolSize: number; symbols: string[] }> {
  const endpoint = buildEndpoint('/api/v3/hf/margin/order/active/symbols', { tradeType });
  const response = await kucoinMarginRequester.executeRequest<{ symbolSize: number; symbols: string[] }>(
    'GET',
    endpoint,
    undefined,
    true
  );
  return response.data;
}

/**
 * Histórico de fills Margin
 * GET /api/v3/hf/margin/fills
 */
export async function getMarginTradeHistory(params?: Record<string, string | number | boolean | undefined>): Promise<{ items: MarginFill[] }> {
  const endpoint = buildEndpoint('/api/v3/hf/margin/fills', params);
  const response = await kucoinMarginRequester.executeRequest<{ items: MarginFill[] }>(
    'GET',
    endpoint,
    undefined,
    true
  );
  return response.data;
}

/**
 * Buscar ordem Margin por clientOid
 * GET /api/v3/hf/margin/orders/client-order/{clientOid}
 */
export async function getMarginOrderByClientOid(clientOid: string, symbol: string): Promise<MarginOrder> {
  const endpoint = buildEndpoint(`/api/v3/hf/margin/orders/client-order/${clientOid}`, { symbol });
  const response = await kucoinMarginRequester.executeRequest<MarginOrder>(
    'GET',
    endpoint,
    undefined,
    true
  );
  return response.data;
}

/**
 * Cancelar stop order Margin por clientOid
 * DELETE /api/v1/stop-order/cancelOrderByClientOid
 */
export async function cancelMarginStopOrderByClientOid(clientOid: string, symbol?: string): Promise<{ cancelledOrderId: string; clientOid: string }> {
  const endpoint = buildEndpoint('/api/v1/stop-order/cancelOrderByClientOid', { clientOid, symbol });
  const response = await kucoinMarginRequester.executeRequest<{ cancelledOrderId: string; clientOid: string }>(
    'DELETE',
    endpoint,
    undefined,
    true
  );
  return response.data;
}

/**
 * Cancelar todas stop orders Margin
 * DELETE /api/v3/hf/margin/stop-order
 */
export async function cancelAllMarginStopOrders(params?: Record<string, string | number | boolean | undefined>): Promise<string> {
  const endpoint = buildEndpoint('/api/v3/hf/margin/stop-order', params);
  const response = await kucoinMarginRequester.executeRequest<string>(
    'DELETE',
    endpoint,
    undefined,
    true
  );
  return response.data;
}

/**
 * Detalhes de stop order Margin por ID
 * GET /api/v1/stop-order/{orderId}
 */
export async function getMarginStopOrderById(orderId: string): Promise<MarginOrder> {
  const response = await kucoinMarginRequester.executeRequest<MarginOrder>(
    'GET',
    `/api/v1/stop-order/${orderId}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Detalhes de stop order Margin por clientOid
 * GET /api/v1/stop-order/queryOrderByClientOid
 */
export async function getMarginStopOrderByClientOid(clientOid: string, symbol?: string): Promise<MarginOrder[]> {
  const endpoint = buildEndpoint('/api/v1/stop-order/queryOrderByClientOid', { clientOid, symbol });
  const response = await kucoinMarginRequester.executeRequest<MarginOrder[]>(
    'GET',
    endpoint,
    undefined,
    true
  );
  return response.data;
}

/**
 * Risk limit para moedas margin
 * GET /api/v3/margin/currencies (com parâmetro isIsolated)
 */
export async function getMarginRiskLimit(isIsolated?: boolean, symbol?: string): Promise<MarginCurrencyInfo[]> {
  const endpoint = buildEndpoint('/api/v3/margin/currencies', { isIsolated, symbol });
  const response = await kucoinMarginRequester.executeRequest<MarginCurrencyInfo[]>(
    'GET',
    endpoint,
    undefined,
    false
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
  // FASE 4 - OCO Orders
  createMarginOcoOrder,
  cancelMarginOcoOrder,
  cancelMarginOcoOrderByClientOid,
  cancelAllMarginOcoOrders,
  getMarginOcoOrder,
  getMarginOcoOrderByClientOid,
  getMarginOcoOrders,
  // FASE 4 - Debit (Borrow/Repay/Interest)
  borrowMargin,
  repayMargin,
  getBorrowHistory,
  getRepayHistory,
  getInterestHistory,
  getLendingRates,
  // FASE 4 - Cancel by ClientOid + Leverage
  cancelMarginOrderByClientOid,
  updateCrossMarginLeverage,
  // Market Data Avançado (cobertura 100%)
  getMarginETFInfo,
  getMarkPriceDetail,
  getMarginConfig,
  getMarkPriceList,
  getMarginCollateralRatio,
  getMarginAvailableInventory,
  // Ordens Avançadas (cobertura 100%)
  createMarginOrderTest,
  cancelAllMarginOrdersBySymbol,
  getMarginSymbolsWithOpenOrder,
  getMarginTradeHistory,
  getMarginOrderByClientOid,
  cancelMarginStopOrderByClientOid,
  cancelAllMarginStopOrders,
  getMarginStopOrderById,
  getMarginStopOrderByClientOid,
  getMarginRiskLimit,
  isMarginConfigured,
  getMarginCircuitBreakerStatus,
  initKucoinMarginMetrics,
};
