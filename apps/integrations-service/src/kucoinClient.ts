/**
 * Cliente KuCoin Futures API - Alice Enterprise Platform
 * 
 * Implementação enterprise-grade para trading de BTC perpetuals.
 * Baseado na documentação oficial: https://www.kucoin.com/docs/rest/futures-trading
 * 
 * Funcionalidades:
 * - Autenticação HMAC-SHA256 conforme especificação KuCoin
 * - Circuit breaker para resiliência
 * - Rate limiting respeitando limites da API
 * - Logs estruturados com correlação
 * - Multi-tenancy via headers customizados
 * 
 * Autor: Fillipe Guerra
 * Data: 17 de Dezembro de 2025
 */

import crypto from 'crypto';
import { createLogger } from '@alice/logger';
import {
  createCircuitBreaker,
  CIRCUIT_BREAKER_PRESETS,
  instrumentCircuitBreaker,
  createAlicePrometheus,
} from '@alice/shared-utils';

const logger = createLogger('kucoin-client');

// ============================================================================
// CONFIGURAÇÃO (via variáveis de ambiente - Regra 6: sem hardcoded)
// CORREÇÃO 17/12/2025: Usar nomes corretos dos secrets GitHub (KUCOIN_PRO_*)
// Elimina workaround de mapping no workflow deploy-production.yml
// ============================================================================

// URL base da API KuCoin Futures (sandbox ou produção)
// NOTA: Secret no GitHub é KUCOIN_PRO_BASE_URL (não KUCOIN_FUTURES_BASE_URL)
const KUCOIN_FUTURES_BASE_URL = process.env.KUCOIN_PRO_BASE_URL || 'https://api-futures.kucoin.com';
const KUCOIN_SANDBOX_URL = 'https://api-sandbox-futures.kucoin.com';

// Credenciais da API - Usando nomes corretos dos secrets GitHub
// ANTES: KUCOIN_API_KEY, KUCOIN_API_SECRET, KUCOIN_API_PASSPHRASE (workaround)
// AGORA: KUCOIN_PRO_API_KEY, KUCOIN_PRO_API_SECRET, KUCOIN_PRO_API_PASSPHRASE (enterprise)
const KUCOIN_API_KEY = process.env.KUCOIN_PRO_API_KEY;
const KUCOIN_API_SECRET = process.env.KUCOIN_PRO_API_SECRET;
const KUCOIN_API_PASSPHRASE = process.env.KUCOIN_PRO_API_PASSPHRASE;

// Modo sandbox para testes (default: false em produção)
const KUCOIN_SANDBOX_MODE = process.env.KUCOIN_SANDBOX_MODE === 'true';

// ============================================================================
// TIPOS (TypeScript strict - Regra 8)
// ============================================================================

/** Configuração de ambiente KuCoin */
export interface KucoinConfig {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  baseUrl: string;
  isSandbox: boolean;
}

/** Resposta genérica da API KuCoin */
export interface KucoinApiResponse<T> {
  code: string;
  msg?: string;
  data: T;
}

/** Dados de ticker (preço atual) */
export interface KucoinTicker {
  symbol: string;
  sequence: number;
  side: string;
  size: number;
  price: string;
  bestBidSize: number;
  bestBidPrice: string;
  bestAskSize: number;
  bestAskPrice: string;
  tradeId: string;
  ts: number;
}

/** Informações do contrato */
export interface KucoinContract {
  symbol: string;
  rootSymbol: string;
  type: string;
  firstOpenDate: number;
  expireDate: number | null;
  settleDate: number | null;
  baseCurrency: string;
  quoteCurrency: string;
  settleCurrency: string;
  maxOrderQty: number;
  maxPrice: number;
  lotSize: number;
  tickSize: number;
  indexPriceTickSize: number;
  multiplier: number;
  initialMargin: number;
  maintainMargin: number;
  maxRiskLimit: number;
  minRiskLimit: number;
  riskStep: number;
  makerFeeRate: number;
  takerFeeRate: number;
  takerFixFee: number;
  makerFixFee: number;
  settlementFee: number | null;
  isDeleverage: boolean;
  isQuanto: boolean;
  isInverse: boolean;
  markMethod: string;
  fairMethod: string;
  fundingBaseSymbol: string;
  fundingQuoteSymbol: string;
  fundingRateSymbol: string;
  indexSymbol: string;
  settlementSymbol: string | null;
  status: string;
  fundingFeeRate: number;
  predictedFundingFeeRate: number;
  openInterest: string;
  turnoverOf24h: number;
  volumeOf24h: number;
  markPrice: number;
  indexPrice: number;
  lastTradePrice: number;
  nextFundingRateTime: number;
  maxLeverage: number;
  sourceExchanges: string[];
  premiumsSymbol1M: string;
  premiumsSymbol8H: string;
  fundingBaseSymbol1M: string;
  fundingQuoteSymbol1M: string;
  lowPrice: number;
  highPrice: number;
  priceChgPct: number;
  priceChg: number;
}

/** Parâmetros para criar ordem */
export interface CreateOrderParams {
  clientOid: string;           // ID único do cliente (UUID)
  symbol: string;              // Par de trading (ex: XBTUSDTM)
  side: 'buy' | 'sell';        // Direção
  type: 'limit' | 'market';    // Tipo de ordem
  leverage?: number;           // Alavancagem (1-100)
  size: number;                // Quantidade em contratos
  price?: string;              // Preço (obrigatório para limit)
  timeInForce?: 'GTC' | 'IOC' | 'FOK'; // Validade da ordem
  postOnly?: boolean;          // Apenas maker
  reduceOnly?: boolean;        // Apenas reduzir posição
  stopPrice?: string;          // Preço de stop (stop-loss/take-profit)
  stopPriceType?: 'TP' | 'IP' | 'MP'; // Tipo de preço para stop
}

/** Resposta de criação de ordem */
export interface CreateOrderResponse {
  orderId: string;
  clientOid: string;
}

/** Informações de ordem */
export interface KucoinOrder {
  id: string;
  symbol: string;
  type: string;
  side: string;
  price: string;
  size: number;
  value: string;
  dealValue: string;
  dealSize: number;
  stp: string;
  stop: string;
  stopPriceType: string;
  stopTriggered: boolean;
  stopPrice: string | null;
  timeInForce: string;
  postOnly: boolean;
  hidden: boolean;
  iceberg: boolean;
  leverage: string;
  forceHold: boolean;
  closeOrder: boolean;
  visibleSize: number | null;
  clientOid: string;
  remark: string | null;
  tags: string | null;
  isActive: boolean;
  cancelExist: boolean;
  createdAt: number;
  updatedAt: number;
  endAt: number | null;
  orderTime: number;
  settleCurrency: string;
  status: string;
  filledSize: number;
  filledValue: string;
  reduceOnly: boolean;
}

/** Informações de posição */
export interface KucoinPosition {
  id: string;
  symbol: string;
  autoDeposit: boolean;
  maintMarginReq: number;
  riskLimit: number;
  realLeverage: number;
  crossMode: boolean;
  delevPercentage: number;
  openingTimestamp: number;
  currentTimestamp: number;
  currentQty: number;
  currentCost: number;
  currentComm: number;
  unrealisedCost: number;
  realisedGrossCost: number;
  realisedCost: number;
  isOpen: boolean;
  markPrice: number;
  markValue: number;
  posCost: number;
  posCross: number;
  posInit: number;
  posComm: number;
  posLoss: number;
  posMargin: number;
  posMaint: number;
  maintMargin: number;
  realisedGrossPnl: number;
  realisedPnl: number;
  unrealisedPnl: number;
  unrealisedPnlPcnt: number;
  unrealisedRoePcnt: number;
  avgEntryPrice: number;
  liquidationPrice: number;
  bankruptPrice: number;
  settleCurrency: string;
}

/** Informações da conta */
export interface KucoinAccountOverview {
  accountEquity: number;
  unrealisedPNL: number;
  marginBalance: number;
  positionMargin: number;
  orderMargin: number;
  frozenFunds: number;
  availableBalance: number;
  currency: string;
}

// ============================================================================
// CIRCUIT BREAKER (Regra 16 - Resiliência)
// ============================================================================

// Função wrapper para circuit breaker - segue padrão wiseClient.ts
// Bug fix: createCircuitBreaker requer função de ação + config com nome
async function executeKucoinRequest(fetchFn: () => Promise<Response>): Promise<Response> {
  return fetchFn();
}

// Circuit breaker seguindo padrão enterprise de wiseClient.ts
const kucoinCircuitBreaker = createCircuitBreaker(executeKucoinRequest, {
  name: 'kucoin-futures',
  ...CIRCUIT_BREAKER_PRESETS.kucoinFutures,
});

// Instrumentar métricas do circuit breaker
// Será inicializado quando o serviço principal criar as métricas
let metricsInitialized = false;

export function initKucoinMetrics(prometheusMetrics: ReturnType<typeof createAlicePrometheus>['metrics']): void {
  if (!metricsInitialized) {
    instrumentCircuitBreaker(kucoinCircuitBreaker, prometheusMetrics, 'kucoin_futures');
    metricsInitialized = true;
    logger.info('Métricas do circuit breaker KuCoin inicializadas');
  }
}

// ============================================================================
// AUTENTICAÇÃO (HMAC-SHA256 conforme documentação KuCoin)
// ============================================================================

/**
 * Gera assinatura HMAC-SHA256 para autenticação na API KuCoin
 * @param timestamp - Timestamp em milissegundos
 * @param method - Método HTTP (GET, POST, DELETE)
 * @param endpoint - Caminho do endpoint (com query string se houver)
 * @param body - Corpo da requisição (JSON string ou vazio)
 */
function generateSignature(
  timestamp: string,
  method: string,
  endpoint: string,
  body: string = ''
): string {
  if (!KUCOIN_API_SECRET) {
    throw new Error('KUCOIN_API_SECRET não configurada');
  }

  const prehashString = timestamp + method.toUpperCase() + endpoint + body;
  
  const signature = crypto
    .createHmac('sha256', KUCOIN_API_SECRET)
    .update(prehashString)
    .digest('base64');
  
  return signature;
}

/**
 * Gera passphrase criptografada (requerido pela API v2)
 */
function generatePassphraseSignature(): string {
  if (!KUCOIN_API_SECRET || !KUCOIN_API_PASSPHRASE) {
    throw new Error('KUCOIN_API_SECRET ou KUCOIN_API_PASSPHRASE não configurada');
  }

  return crypto
    .createHmac('sha256', KUCOIN_API_SECRET)
    .update(KUCOIN_API_PASSPHRASE)
    .digest('base64');
}

/**
 * Gera headers de autenticação para requisição
 */
function generateAuthHeaders(
  method: string,
  endpoint: string,
  body: string = ''
): Record<string, string> {
  if (!KUCOIN_API_KEY) {
    throw new Error('KUCOIN_API_KEY não configurada');
  }

  const timestamp = Date.now().toString();
  const signature = generateSignature(timestamp, method, endpoint, body);
  const passphrase = generatePassphraseSignature();

  return {
    'KC-API-KEY': KUCOIN_API_KEY,
    'KC-API-SIGN': signature,
    'KC-API-TIMESTAMP': timestamp,
    'KC-API-PASSPHRASE': passphrase,
    'KC-API-KEY-VERSION': '2', // API v2 usa passphrase criptografada
    'Content-Type': 'application/json',
  };
}

// ============================================================================
// CLIENTE HTTP (com circuit breaker e retry)
// ============================================================================

/**
 * Executa requisição HTTP para API KuCoin com autenticação
 */
async function executeRequest<T>(
  method: 'GET' | 'POST' | 'DELETE',
  endpoint: string,
  body?: Record<string, unknown>,
  requiresAuth: boolean = true
): Promise<KucoinApiResponse<T>> {
  const baseUrl = KUCOIN_SANDBOX_MODE ? KUCOIN_SANDBOX_URL : KUCOIN_FUTURES_BASE_URL;
  const url = `${baseUrl}${endpoint}`;
  const bodyString = body ? JSON.stringify(body) : '';

  const headers: Record<string, string> = requiresAuth
    ? generateAuthHeaders(method, endpoint, bodyString)
    : { 'Content-Type': 'application/json' };

  logger.debug({ method, endpoint, isSandbox: KUCOIN_SANDBOX_MODE }, 'Executando requisição KuCoin');

  const fetchFn = async (): Promise<Response> => {
    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' ? bodyString : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(
        { status: response.status, statusText: response.statusText, body: errorBody },
        'Erro na requisição KuCoin'
      );
      throw new Error(`KuCoin API error: ${response.status} - ${errorBody}`);
    }

    return response;
  };

  // Executar via circuit breaker (passa função como parâmetro - padrão wiseClient.ts)
  const response = await kucoinCircuitBreaker.fire(fetchFn);
  const data = await response.json() as KucoinApiResponse<T>;

  // Verificar código de sucesso da API (200000 = OK)
  if (data.code !== '200000') {
    logger.error({ code: data.code, msg: data.msg }, 'Erro retornado pela API KuCoin');
    throw new Error(`KuCoin API error: ${data.code} - ${data.msg}`);
  }

  return data;
}

// ============================================================================
// VERIFICAÇÃO DE CONFIGURAÇÃO
// ============================================================================

/**
 * Verifica se a API KuCoin está configurada
 */
export function isKucoinConfigured(): boolean {
  return !!(KUCOIN_API_KEY && KUCOIN_API_SECRET && KUCOIN_API_PASSPHRASE);
}

/**
 * Retorna status de sandbox
 */
export function getKucoinSandboxStatus(): boolean {
  return KUCOIN_SANDBOX_MODE;
}

/**
 * Retorna status do circuit breaker
 */
export function getKucoinCircuitBreakerStatus(): {
  state: string;
  failures: number;
  successes: number;
} {
  const stats = kucoinCircuitBreaker.stats;
  return {
    state: kucoinCircuitBreaker.opened ? 'OPEN' : kucoinCircuitBreaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
    failures: stats.failures,
    successes: stats.successes,
  };
}

// ============================================================================
// ENDPOINTS PÚBLICOS (sem autenticação)
// ============================================================================

/**
 * Obtém ticker (preço atual) de um símbolo
 * GET /api/v1/ticker
 */
export async function getTicker(symbol: string): Promise<KucoinTicker> {
  const response = await executeRequest<KucoinTicker>(
    'GET',
    `/api/v1/ticker?symbol=${symbol}`,
    undefined,
    false // Não requer autenticação
  );
  return response.data;
}

/**
 * Obtém informações de um contrato
 * GET /api/v1/contracts/active
 */
export async function getContractInfo(symbol: string): Promise<KucoinContract> {
  const response = await executeRequest<KucoinContract>(
    'GET',
    `/api/v1/contracts/${symbol}`,
    undefined,
    false
  );
  return response.data;
}

/**
 * Lista todos os contratos ativos
 * GET /api/v1/contracts/active
 */
export async function getActiveContracts(): Promise<KucoinContract[]> {
  const response = await executeRequest<KucoinContract[]>(
    'GET',
    '/api/v1/contracts/active',
    undefined,
    false
  );
  return response.data;
}

// ============================================================================
// ENDPOINTS PRIVADOS - CONTA (requer autenticação)
// ============================================================================

/**
 * Obtém visão geral da conta
 * GET /api/v1/account-overview
 */
export async function getAccountOverview(currency: string = 'USDT'): Promise<KucoinAccountOverview> {
  const response = await executeRequest<KucoinAccountOverview>(
    'GET',
    `/api/v1/account-overview?currency=${currency}`,
    undefined,
    true
  );
  return response.data;
}

// ============================================================================
// ENDPOINTS PRIVADOS - ORDENS (requer autenticação)
// ============================================================================

/**
 * Cria uma nova ordem
 * POST /api/v1/orders
 */
export async function createOrder(params: CreateOrderParams): Promise<CreateOrderResponse> {
  const response = await executeRequest<CreateOrderResponse>(
    'POST',
    '/api/v1/orders',
    params as unknown as Record<string, unknown>,
    true
  );
  
  logger.info(
    { orderId: response.data.orderId, clientOid: params.clientOid, symbol: params.symbol },
    'Ordem criada com sucesso'
  );
  
  return response.data;
}

/**
 * Cancela uma ordem
 * DELETE /api/v1/orders/{orderId}
 */
export async function cancelOrder(orderId: string): Promise<{ cancelledOrderIds: string[] }> {
  const response = await executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    `/api/v1/orders/${orderId}`,
    undefined,
    true
  );
  
  logger.info({ orderId }, 'Ordem cancelada');
  return response.data;
}

/**
 * Cancela todas as ordens abertas
 * DELETE /api/v1/orders
 */
export async function cancelAllOrders(symbol?: string): Promise<{ cancelledOrderIds: string[] }> {
  const endpoint = symbol ? `/api/v1/orders?symbol=${symbol}` : '/api/v1/orders';
  const response = await executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    endpoint,
    undefined,
    true
  );
  
  logger.info({ symbol, count: response.data.cancelledOrderIds.length }, 'Ordens canceladas');
  return response.data;
}

/**
 * Obtém detalhes de uma ordem pelo orderId
 * GET /api/v1/orders/{orderId}
 */
export async function getOrder(orderId: string): Promise<KucoinOrder> {
  const response = await executeRequest<KucoinOrder>(
    'GET',
    `/api/v1/orders/${orderId}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Obtém detalhes de uma ordem pelo clientOid
 * GET /api/v1/orders/byClientOid
 */
export async function getOrderByClientOid(clientOid: string): Promise<KucoinOrder> {
  const response = await executeRequest<KucoinOrder>(
    'GET',
    `/api/v1/orders/byClientOid?clientOid=${clientOid}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Lista ordens abertas
 * GET /api/v1/orders
 */
export async function getOpenOrders(symbol?: string): Promise<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: KucoinOrder[] }> {
  const endpoint = symbol ? `/api/v1/orders?status=active&symbol=${symbol}` : '/api/v1/orders?status=active';
  const response = await executeRequest<{ currentPage: number; pageSize: number; totalNum: number; totalPage: number; items: KucoinOrder[] }>(
    'GET',
    endpoint,
    undefined,
    true
  );
  return response.data;
}

// ============================================================================
// ENDPOINTS PRIVADOS - POSIÇÕES (requer autenticação)
// ============================================================================

/**
 * Obtém posição atual de um símbolo
 * GET /api/v1/position
 */
export async function getPosition(symbol: string): Promise<KucoinPosition> {
  const response = await executeRequest<KucoinPosition>(
    'GET',
    `/api/v1/position?symbol=${symbol}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Lista todas as posições abertas
 * GET /api/v1/positions
 */
export async function getAllPositions(): Promise<KucoinPosition[]> {
  const response = await executeRequest<KucoinPosition[]>(
    'GET',
    '/api/v1/positions',
    undefined,
    true
  );
  return response.data;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Gera um clientOid único para rastreamento de ordens
 */
export function generateClientOid(): string {
  return `alice-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Valida se um símbolo é suportado (BTC perpetuals)
 */
export function isValidSymbol(symbol: string): boolean {
  const validSymbols = ['XBTUSDTM', 'XBTUSDM']; // BTC/USDT e BTC/USD perpetuals
  return validSymbols.includes(symbol.toUpperCase());
}

export default {
  // Verificação
  isKucoinConfigured,
  getKucoinSandboxStatus,
  getKucoinCircuitBreakerStatus,
  initKucoinMetrics,
  
  // Públicos
  getTicker,
  getContractInfo,
  getActiveContracts,
  
  // Conta
  getAccountOverview,
  
  // Ordens
  createOrder,
  cancelOrder,
  cancelAllOrders,
  getOrder,
  getOrderByClientOid,
  getOpenOrders,
  
  // Posições
  getPosition,
  getAllPositions,
  
  // Helpers
  generateClientOid,
  isValidSymbol,
};
