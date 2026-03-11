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

import { createLogger } from '@alice/logger';
import {
  isProductionEnv,
  readOptionalStringEnv,
} from '@alice/config';
import {
  CIRCUIT_BREAKER_PRESETS,
  createAlicePrometheus,
} from '@alice/shared-utils';
import {
  createKucoinRequester,
  type KucoinApiResponse,
  KucoinRequestError,
  isKucoinRequestError,
  isKucoinTransientError,
} from './kucoinRequest.js';

const logger = createLogger('kucoin-client');
const IS_PRODUCTION = isProductionEnv();

export { KucoinRequestError, isKucoinRequestError, isKucoinTransientError };

// ============================================================================
// CONFIGURAÇÃO (via variáveis de ambiente - Regra 6: sem hardcoded)
// CORREÇÃO 17/12/2025: Usar nomes corretos dos secrets GitHub (KUCOIN_PRO_*)
// Elimina workaround de mapping no workflow deploy-production.yml
// ============================================================================

// URL base da API KuCoin Futures (produção)
// NOTA: Secret no GitHub é KUCOIN_PRO_BASE_URL (não KUCOIN_FUTURES_BASE_URL)
// NOTA: Não é secret. Se ausente, usamos a URL oficial de produção.
const KUCOIN_FUTURES_BASE_URL = (() => {
  const url = readOptionalStringEnv('KUCOIN_PRO_BASE_URL');
  if (!url && IS_PRODUCTION) {
    logger.info('KUCOIN_PRO_BASE_URL não configurada em produção, usando URL oficial padrão');
  }
  return url ?? 'https://api-futures.kucoin.com';
})();

// Credenciais da API - Usando nomes corretos dos secrets GitHub
// ANTES: KUCOIN_API_KEY, KUCOIN_API_SECRET, KUCOIN_API_PASSPHRASE (workaround)
// AGORA: KUCOIN_PRO_API_KEY, KUCOIN_PRO_API_SECRET, KUCOIN_PRO_API_PASSPHRASE (enterprise)
const KUCOIN_PRO_API_KEY = readOptionalStringEnv('KUCOIN_PRO_API_KEY');
const KUCOIN_PRO_API_SECRET = readOptionalStringEnv('KUCOIN_PRO_API_SECRET');
const KUCOIN_PRO_API_PASSPHRASE = readOptionalStringEnv('KUCOIN_PRO_API_PASSPHRASE');

export function getKucoinConfigStatus(): { isConfigured: boolean; missingKeys: string[] } {
  const missingKeys: string[] = [];
  if (!KUCOIN_PRO_API_KEY?.trim()) missingKeys.push('KUCOIN_PRO_API_KEY');
  if (!KUCOIN_PRO_API_SECRET?.trim()) missingKeys.push('KUCOIN_PRO_API_SECRET');
  if (!KUCOIN_PRO_API_PASSPHRASE?.trim()) missingKeys.push('KUCOIN_PRO_API_PASSPHRASE');
  return { isConfigured: missingKeys.length === 0, missingKeys };
}


// ============================================================================
// SÍMBOLOS (dinâmicos via API KuCoin - sem hardcoded)
// ============================================================================

/**
 * Lista símbolos permitidos para trading/market data.
 * Fonte de verdade: API KuCoin (/api/v1/contracts/active).
 */
export async function getAllowedSymbols(): Promise<string[]> {
  const contracts = await getActiveContracts();
  const symbols = contracts
    .map((contract) => contract.symbol?.trim())
    .filter((symbol): symbol is string => Boolean(symbol));

  const unique = Array.from(new Set(symbols));
  if (unique.length === 0) {
    throw new Error('KuCoin não retornou símbolos ativos (contracts/active vazio).');
  }
  return unique;
}

/**
 * Símbolo default para endpoints que permitem omissão.
 * Fonte: API KuCoin + opcionalmente KUCOIN_DEFAULT_SYMBOL (validação real).
 */
export async function getDefaultSymbol(): Promise<string> {
  const configured = readOptionalStringEnv('KUCOIN_DEFAULT_SYMBOL')?.toUpperCase();
  const allowed = await getAllowedSymbols();

  if (configured) {
    if (!allowed.includes(configured)) {
      const message = `KUCOIN_DEFAULT_SYMBOL inválido: "${configured}". Valores permitidos: ${allowed.join(', ')}`;
      if (IS_PRODUCTION) {
        throw new Error(message);
      }
      logger.warn(message);
      return allowed[0]!;
    }
    return configured;
  }

  return allowed[0]!;
}

// ============================================================================
// TIPOS (TypeScript strict - Regra 8)
// ============================================================================

/** Configuração de ambiente KuCoin */
export interface KucoinConfig {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  baseUrl: string;
}

/** Resposta genérica da API KuCoin */
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

/**
 * Parâmetros para criar ordem Futures
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/orders/add-order
 * Ref: tiagosiebler/kucoin-api src/types/request/futures.types.ts
 * Atualizado conforme documentação oficial KuCoin 2025/2026
 */
export interface CreateOrderParams {
  clientOid: string;           // ID único do cliente (UUID)
  symbol: string;              // Par de trading (ex: XBTUSDTM)
  side: 'buy' | 'sell';        // Direção
  type: 'limit' | 'market';    // Tipo de ordem
  leverage?: number;           // Alavancagem (1-100)
  size?: number;               // Quantidade em contratos (inteiro positivo)
  qty?: string;                // Quantidade alternativa (string) - novo parâmetro KuCoin
  valueQty?: string;           // Ordem baseada em valor (USDT) ao invés de quantidade
  price?: string;              // Preço (obrigatório para limit)
  timeInForce?: 'GTC' | 'IOC' | 'RPI'; // Validade da ordem (RPI adicionado 2025.01.02)
  postOnly?: boolean;          // Apenas maker
  reduceOnly?: boolean;        // Apenas reduzir posição
  closeOrder?: boolean;        // Fecha posição automaticamente
  forceHold?: boolean;         // Força hold de margem
  stopPrice?: string;          // Preço de stop (stop-loss/take-profit)
  stopPriceType?: 'TP' | 'MP' | 'IP'; // Tipo de preço para stop (TP=Trade, MP=Mark, IP=Index)
  stop?: 'down' | 'up';       // Direção do stop trigger (down=stop loss long, up=stop loss short)
  marginMode?: 'ISOLATED' | 'CROSS'; // Modo de margem (novo - permite definir por ordem)
  positionSide?: 'BOTH' | 'LONG' | 'SHORT'; // Lado da posição (obrigatório em Hedge Mode)
  stp?: string;                // Self-trade prevention (DC, CO, CN, CB)
  hidden?: boolean;            // Ordem oculta
  iceberg?: boolean;           // Modo iceberg
  visibleSize?: number;        // Quantidade visível no iceberg
  remark?: string;             // Observação (max 100 chars)
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

/** Histórico de posições fechadas (FASE 2) */
export interface KucoinPositionHistory {
  closeId: string;
  positionId: string;
  uid: number;
  userId: string;
  symbol: string;
  settleCurrency: string;
  leverage: string;
  type: string;
  pnl: string;
  realisedGrossCost: string;
  withdrawPnl: string;
  tradeFee: string;
  fundingFee: string;
  openTime: number;
  closeTime: number;
  openPrice: string;
  closePrice: string;
  qty: number;
}

/** Risk limit por símbolo (FASE 2) */
export interface RiskLimitData {
  symbol: string;
  level: number;
  maxRiskLimit: number;
  minRiskLimit: number;
  maxLeverage: number;
  initialMargin: string;
  maintainMargin: string;
}

// ============================================================================
// CIRCUIT BREAKER (Regra 16 - Resiliência)
// ============================================================================

const kucoinFuturesRequester = createKucoinRequester({
  name: 'kucoin-futures',
  operationPrefix: 'futures',
  baseUrl: KUCOIN_FUTURES_BASE_URL,
  circuitBreakerPreset: CIRCUIT_BREAKER_PRESETS.kucoinFutures,
});

// URL base da API KuCoin Spot/Margin (produção)
// Spot e Margin usam a mesma base URL — diferem apenas nos endpoints de conta/ordens
const KUCOIN_SPOT_BASE_URL = readOptionalStringEnv('KUCOIN_SPOT_BASE_URL') ?? 'https://api.kucoin.com';

const kucoinSpotRequester = createKucoinRequester({
  name: 'kucoin-spot',
  operationPrefix: 'spot',
  baseUrl: KUCOIN_SPOT_BASE_URL,
  circuitBreakerPreset: CIRCUIT_BREAKER_PRESETS.kucoinFutures, // Mesmo preset de resiliência
});

/** Tipo de mercado para roteamento de requisições REST */
export type RestMarketType = 'futures' | 'spot' | 'margin';

/** Seleciona o requester correto baseado no tipo de mercado */
function _getRequester(marketType: RestMarketType = 'futures') {
  return marketType === 'futures' ? kucoinFuturesRequester : kucoinSpotRequester;
}

export function initKucoinMetrics(prometheusMetrics: ReturnType<typeof createAlicePrometheus>['metrics']): void {
  kucoinFuturesRequester.initMetrics(prometheusMetrics);
  kucoinSpotRequester.initMetrics(prometheusMetrics);
  logger.info('Métricas dos circuit breakers KuCoin (Futures + Spot) inicializadas');
}


// ============================================================================
// CLIENTE HTTP (com circuit breaker e retry)
// ============================================================================

/**
 * Executa requisição HTTP para API KuCoin Futures com autenticação
 */
async function executeRequest<T>(
  method: 'GET' | 'POST' | 'DELETE',
  endpoint: string,
  body?: Record<string, unknown>,
  requiresAuth: boolean = true
): Promise<KucoinApiResponse<T>> {
  return kucoinFuturesRequester.executeRequest<T>(method, endpoint, body, requiresAuth);
}

/**
 * Executa requisição HTTP para API KuCoin Spot/Margin com autenticação
 */
async function executeSpotRequest<T>(
  method: 'GET' | 'POST' | 'DELETE',
  endpoint: string,
  body?: Record<string, unknown>,
  requiresAuth: boolean = true
): Promise<KucoinApiResponse<T>> {
  return kucoinSpotRequester.executeRequest<T>(method, endpoint, body, requiresAuth);
}

// ============================================================================
// VERIFICAÇÃO DE CONFIGURAÇÃO
// ============================================================================

/**
 * Verifica se a API KuCoin está configurada
 */
export function isKucoinConfigured(): boolean {
  return !!(KUCOIN_PRO_API_KEY && KUCOIN_PRO_API_SECRET && KUCOIN_PRO_API_PASSPHRASE);
}

/**
 * Retorna status do circuit breaker
 */
export function getKucoinCircuitBreakerStatus(): {
  state: string;
  failures: number;
  successes: number;
} {
  return kucoinFuturesRequester.getCircuitBreakerStatus();
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
 * DELETE /api/v3/orders
 * 
 * MIGRADO de /api/v1/orders (DEPRECADO - "Abandoned Endpoints" na documentação oficial KuCoin)
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/orders/cancel-all-orders
 * Ref: https://www.kucoin.com/docs-new/abandoned-endpoints/futures-trading/cancel-all-orders-v1
 */
export async function cancelAllOrders(symbol?: string): Promise<{ cancelledOrderIds: string[] }> {
  const endpoint = symbol ? `/api/v3/orders?symbol=${symbol}` : '/api/v3/orders';
  const response = await executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    endpoint,
    undefined,
    true
  );
  
  logger.info({ symbol, count: response.data.cancelledOrderIds.length }, 'Ordens canceladas via API v3');
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
// ENDPOINTS PRIVADOS - MARGIN MODE E POSITION MODE (07/02/2026)
// Ref: https://www.kucoin.com/docs-new/rest/futures-trading/positions
// Ref: tiagosiebler/kucoin-api src/FuturesClient.ts
// ============================================================================

/** Resposta de Margin Mode */
export interface MarginModeResponse {
  symbol: string;
  marginMode: 'ISOLATED' | 'CROSS';
}

/** Resposta de Position Mode */
export interface PositionModeResponse {
  positionMode: 'ONE_WAY' | 'HEDGE';
}

/** Resposta de alavancagem cross */
export interface CrossUserLeverageResponse {
  symbol: string;
  leverage: string;
}

/**
 * Obtém modo de margem de um símbolo
 * GET /api/v2/position/getMarginMode
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/positions/get-margin-mode
 */
export async function getMarginMode(symbol: string): Promise<MarginModeResponse> {
  const response = await executeRequest<MarginModeResponse>(
    'GET',
    `/api/v2/position/getMarginMode?symbol=${symbol}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Altera modo de margem de um símbolo
 * POST /api/v2/position/changeMarginMode
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/positions/modify-margin-mode
 */
export async function changeMarginMode(symbol: string, marginMode: 'ISOLATED' | 'CROSS'): Promise<MarginModeResponse> {
  const response = await executeRequest<MarginModeResponse>(
    'POST',
    '/api/v2/position/changeMarginMode',
    { symbol, marginMode },
    true
  );
  logger.info({ symbol, marginMode }, 'Modo de margem alterado');
  return response.data;
}

/**
 * Obtém modo de posição (One-Way ou Hedge)
 * GET /api/v2/position/getPositionMode
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/positions/get-position-mode
 */
export async function getPositionMode(): Promise<PositionModeResponse> {
  const response = await executeRequest<PositionModeResponse>(
    'GET',
    '/api/v2/position/getPositionMode',
    undefined,
    true
  );
  return response.data;
}

/**
 * Altera modo de posição (One-Way ou Hedge)
 * POST /api/v2/position/changePositionMode
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/positions/modify-position-mode
 */
export async function changePositionMode(positionMode: 'ONE_WAY' | 'HEDGE'): Promise<PositionModeResponse> {
  const response = await executeRequest<PositionModeResponse>(
    'POST',
    '/api/v2/position/changePositionMode',
    { positionMode },
    true
  );
  logger.info({ positionMode }, 'Modo de posição alterado');
  return response.data;
}

/**
 * Obtém alavancagem cross de um símbolo
 * GET /api/v2/getCrossUserLeverage
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/positions/get-cross-margin-leverage
 */
export async function getCrossUserLeverage(symbol: string): Promise<CrossUserLeverageResponse> {
  const response = await executeRequest<CrossUserLeverageResponse>(
    'GET',
    `/api/v2/getCrossUserLeverage?symbol=${symbol}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Altera alavancagem cross de um símbolo
 * POST /api/v2/changeCrossUserLeverage
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/positions/modify-cross-margin-leverage
 */
export async function changeCrossUserLeverage(symbol: string, leverage: string): Promise<CrossUserLeverageResponse> {
  const response = await executeRequest<CrossUserLeverageResponse>(
    'POST',
    '/api/v2/changeCrossUserLeverage',
    { symbol, leverage },
    true
  );
  logger.info({ symbol, leverage }, 'Alavancagem cross alterada');
  return response.data;
}

// ============================================================================
// ENDPOINTS PÚBLICOS - DADOS DE MERCADO ADICIONAIS (17/12/2025)
// ============================================================================

/** Dados de Kline/Candle */
export interface KucoinKline {
  time: number;       // Timestamp em ms
  open: string;       // Preço de abertura
  close: string;      // Preço de fechamento
  high: string;       // Preço máximo
  low: string;        // Preço mínimo
  volume: string;     // Volume em contratos
  turnover: string;   // Volume em moeda base
}

/** Dados de Order Book */
export interface KucoinOrderBook {
  sequence: number;
  asks: Array<[string, number]>;  // [price, size]
  bids: Array<[string, number]>;  // [price, size]
  ts: number;
}

/** Dados de Funding Rate */
export interface KucoinFundingRate {
  symbol: string;
  granularity: number;
  timePoint: number;
  value: number;
  predictedValue: number;
}

/** Dados de Mark Price */
export interface KucoinMarkPrice {
  symbol: string;
  granularity: number;
  timePoint: number;
  value: number;
  indexPrice: number;
}

/** Dados de Trade History */
export interface KucoinTrade {
  sequence: number;
  tradeId: string;
  takerOrderId: string;
  makerOrderId: string;
  price: string;
  size: number;
  side: string;
  ts: number;
}

/** Dados de histórico de ordem */
export interface KucoinOrderHistory {
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
  endAt: number;
  orderTime: number;
  settleCurrency: string;
  status: string;
  filledSize: number;
  filledValue: string;
  reduceOnly: boolean;
}

/**
 * Obtém dados de klines/candles
 * GET /api/v1/kline/query
 * @param symbol - Símbolo do contrato (ex: SYMBOL)
 * @param granularity - Intervalo em minutos (1, 3, 5, 15, 30, 60, 120, 240, 480, 720, 1440, 10080)
 * @param from - Timestamp inicial (ms)
 * @param to - Timestamp final (ms)
 */
export async function getKlines(
  symbol: string,
  granularity: number,
  from?: number,
  to?: number
): Promise<KucoinKline[]> {
  let endpoint = `/api/v1/kline/query?symbol=${symbol}&granularity=${granularity}`;
  
  if (from) endpoint += `&from=${from}`;
  if (to) endpoint += `&to=${to}`;

  const response = await executeRequest<Array<[number, string, string, string, string, string, string]>>(
    'GET',
    endpoint,
    undefined,
    false // Endpoint público
  );

  // Converter array de arrays para objetos tipados
  return response.data.map(([time, open, close, high, low, volume, turnover]) => ({
    time,
    open,
    close,
    high,
    low,
    volume,
    turnover,
  }));
}

/**
 * Obtém order book (Level 2)
 * GET /api/v1/level2/depth{depth}
 * @param symbol - Símbolo do contrato
 * @param depth - Profundidade (20 ou 100)
 */
export async function getOrderBook(symbol: string, depth: 20 | 100): Promise<KucoinOrderBook> {
  const response = await executeRequest<KucoinOrderBook>(
    'GET',
    `/api/v1/level2/depth${depth}?symbol=${symbol}`,
    undefined,
    false // Endpoint público
  );
  return response.data;
}

/**
 * Obtém funding rate atual
 * GET /api/v1/funding-rate/{symbol}/current
 */
export async function getCurrentFundingRate(symbol: string): Promise<KucoinFundingRate> {
  const response = await executeRequest<KucoinFundingRate>(
    'GET',
    `/api/v1/funding-rate/${symbol}/current`,
    undefined,
    false // Endpoint público
  );
  return response.data;
}

/**
 * Obtém mark price atual
 * GET /api/v1/mark-price/{symbol}/current
 */
export async function getMarkPrice(symbol: string): Promise<KucoinMarkPrice> {
  const response = await executeRequest<KucoinMarkPrice>(
    'GET',
    `/api/v1/mark-price/${symbol}/current`,
    undefined,
    false // Endpoint público
  );
  return response.data;
}

/**
 * Obtém histórico de trades recentes
 * GET /api/v1/trade/history
 * @param symbol - Símbolo do contrato
 */
export async function getTradeHistory(symbol: string): Promise<KucoinTrade[]> {
  const response = await executeRequest<KucoinTrade[]>(
    'GET',
    `/api/v1/trade/history?symbol=${symbol}`,
    undefined,
    false // Endpoint público
  );
  return response.data;
}

// ============================================================================
// FUNÇÕES UNIFICADAS MULTI-MERCADO (10/02/2026)
// Roteiam entre Futures e Spot/Margin automaticamente
// Ref: https://www.kucoin.com/docs (Spot), https://www.kucoin.com/docs/futures (Futures)
// ============================================================================

/** Resposta de klines Spot: [time, open, close, high, low, volume, amount] */
type SpotKlineRaw = [string, string, string, string, string, string, string];

/**
 * Obtém klines/candles para qualquer mercado
 * Futures: GET /api/v1/kline/query (granularity em minutos)
 * Spot/Margin: GET /api/v1/market/candles (type = string como "1min", "1hour", "1day")
 */
export async function getKlinesMultiMarket(
  symbol: string,
  granularity: number | string,
  marketType: RestMarketType = 'futures',
  from?: number,
  to?: number
): Promise<KucoinKline[]> {
  if (marketType === 'futures') {
    return getKlines(symbol, typeof granularity === 'string' ? parseInt(granularity, 10) : granularity, from, to);
  }

  // Spot/Margin: granularity é string (ex: "1min", "5min", "1hour", "1day")
  const type = typeof granularity === 'number' ? granularityToSpotType(granularity) : granularity;
  let endpoint = `/api/v1/market/candles?type=${type}&symbol=${symbol}`;
  if (from) endpoint += `&startAt=${Math.floor(from / 1000)}`; // Spot usa segundos
  if (to) endpoint += `&endAt=${Math.floor(to / 1000)}`;

  const response = await executeSpotRequest<SpotKlineRaw[]>(
    'GET',
    endpoint,
    undefined,
    false
  );

  // Spot retorna [time(s), open, close, high, low, volume, amount] — converter para formato unificado
  return response.data.map(([time, open, close, high, low, volume, amount]) => ({
    time: parseInt(time, 10) * 1000, // Converter segundos para ms (consistente com Futures)
    open,
    close,
    high,
    low,
    volume,
    turnover: amount,
  })).reverse(); // Spot retorna em ordem decrescente — reverter para cronológica
}

/**
 * Obtém orderbook para qualquer mercado
 * Futures: GET /api/v1/level2/depth{depth}
 * Spot/Margin: GET /api/v1/market/orderbook/level2_{depth}
 */
export async function getOrderBookMultiMarket(
  symbol: string,
  depth: 20 | 100,
  marketType: RestMarketType = 'futures'
): Promise<KucoinOrderBook> {
  if (marketType === 'futures') {
    return getOrderBook(symbol, depth);
  }

  // Spot/Margin: depth 20 ou 100
  const response = await executeSpotRequest<KucoinOrderBook>(
    'GET',
    `/api/v1/market/orderbook/level2_${depth}?symbol=${symbol}`,
    undefined,
    false
  );
  return response.data;
}

/**
 * Obtém trades recentes para qualquer mercado
 * Futures: GET /api/v1/trade/history
 * Spot/Margin: GET /api/v1/market/histories
 */
export async function getTradeHistoryMultiMarket(
  symbol: string,
  marketType: RestMarketType = 'futures'
): Promise<KucoinTrade[]> {
  if (marketType === 'futures') {
    return getTradeHistory(symbol);
  }

  const response = await executeSpotRequest<KucoinTrade[]>(
    'GET',
    `/api/v1/market/histories?symbol=${symbol}`,
    undefined,
    false
  );
  return response.data;
}

/**
 * Obtém ticker para qualquer mercado
 * Futures: GET /api/v1/ticker
 * Spot/Margin: GET /api/v1/market/orderbook/level1 (best bid/ask + last price)
 */
export async function getTickerMultiMarket(
  symbol: string,
  marketType: RestMarketType = 'futures'
): Promise<Record<string, unknown>> {
  if (marketType === 'futures') {
    const response = await executeRequest<Record<string, unknown>>(
      'GET',
      `/api/v1/ticker?symbol=${symbol}`,
      undefined,
      false
    );
    return response.data;
  }

  const response = await executeSpotRequest<Record<string, unknown>>(
    'GET',
    `/api/v1/market/orderbook/level1?symbol=${symbol}`,
    undefined,
    false
  );
  return response.data;
}

/** Converte granularity numérica (minutos) para tipo string do Spot API */
function granularityToSpotType(minutes: number): string {
  const map: Record<number, string> = {
    1: '1min', 3: '3min', 5: '5min', 15: '15min', 30: '30min',
    60: '1hour', 120: '2hour', 240: '4hour', 360: '6hour', 480: '8hour', 720: '12hour',
    1440: '1day', 10080: '1week',
  };
  return map[minutes] || '1min';
}

// ============================================================================
// ENDPOINTS PRIVADOS - HISTÓRICO DE ORDENS (17/12/2025)
// ============================================================================

/**
 * Obtém histórico de ordens (filled, cancelled, etc.)
 * GET /api/v1/orders (com status done)
 * @param symbol - Símbolo opcional para filtrar
 * @param pageSize - Número de resultados por página (max 100)
 * @param currentPage - Página atual
 */
export async function getOrderHistory(
  symbol?: string,
  pageSize: number = 50,
  currentPage: number = 1
): Promise<{
  currentPage: number;
  pageSize: number;
  totalNum: number;
  totalPage: number;
  items: KucoinOrderHistory[];
}> {
  let endpoint = `/api/v1/orders?status=done&pageSize=${pageSize}&currentPage=${currentPage}`;
  if (symbol) endpoint += `&symbol=${symbol}`;

  const response = await executeRequest<{
    currentPage: number;
    pageSize: number;
    totalNum: number;
    totalPage: number;
    items: KucoinOrderHistory[];
  }>(
    'GET',
    endpoint,
    undefined,
    true // Requer autenticação
  );
  return response.data;
}

/**
 * Obtém detalhes de uma ordem por ID
 * GET /api/v1/orders/{order-id}
 * @param orderId - ID da ordem
 */
export async function getOrderById(orderId: string): Promise<KucoinOrder> {
  const response = await executeRequest<KucoinOrder>(
    'GET',
    `/api/v1/orders/${orderId}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Obtém detalhes de múltiplas ordens por IDs
 * Implementado via chamadas sequenciais ao endpoint oficial.
 * @param orderIds - Lista de IDs de ordens
 */
export async function getOrdersByIds(orderIds: string[]): Promise<KucoinOrder[]> {
  const results: KucoinOrder[] = [];
  for (const orderId of orderIds) {
    results.push(await getOrderById(orderId));
  }
  return results;
}

// ============================================================================
// ENDPOINTS PRIVADOS - STOP ORDERS (TP/SL) - Documentação Oficial KuCoin 2025
// POST /api/v1/st-orders - Criar ordem com Take Profit e Stop Loss
// Referência: https://www.kucoin.com/docs-new/rest/futures-trading/orders/add-take-profit-and-stop-loss-order
// ============================================================================

/** Parâmetros para criar ordem stop (TP/SL) - KuCoin API 2025 */
export interface CreateStopOrderParams {
  clientOid: string;              // ID único do cliente
  symbol: string;                 // Símbolo do contrato (ex: SYMBOL)
  side: 'buy' | 'sell';           // Direção
  type: 'limit' | 'market';       // Tipo de ordem
  leverage?: number;              // Alavancagem
  size?: number;                  // Quantidade em contratos
  price?: string;                 // Preço (obrigatório para limit)
  timeInForce?: 'GTC' | 'IOC';    // Validade
  triggerStopUpPrice?: string;    // Preço de take profit (trigger para fechar com lucro)
  triggerStopDownPrice?: string;  // Preço de stop loss (trigger para fechar com perda)
  stopPriceType?: 'TP' | 'MP'; // Tipo: Trade Price, Mark Price
  reduceOnly?: boolean;           // Apenas reduzir posição
  closeOrder?: boolean;           // Fechar posição inteira
  forceHold?: boolean;            // Forçar hold de margem
  qty?: string;                    // Quantidade alternativa (string) - novo parâmetro KuCoin 2025
  valueQty?: string;               // Valor da quantidade (string) - novo parâmetro KuCoin 2025
}

/** Resposta de criação de ordem stop */
export interface CreateStopOrderResponse {
  orderId: string;
  clientOid: string;
}

/**
 * Cria ordem com Take Profit e/ou Stop Loss
 * POST /api/v1/st-orders
 * 
 * Documentação oficial KuCoin 2025:
 * - triggerStopUpPrice: Preço acima do qual a ordem TP é disparada
 * - triggerStopDownPrice: Preço abaixo do qual a ordem SL é disparada
 * - stopPriceType: TP (Trade Price), IP (Index Price), MP (Mark Price)
 * 
 * @param params - Parâmetros da ordem stop
 * @returns Resposta com orderId e clientOid
 */
export async function createStopOrder(params: CreateStopOrderParams): Promise<CreateStopOrderResponse> {
  // Validar que pelo menos um trigger está definido
  if (!params.triggerStopUpPrice && !params.triggerStopDownPrice) {
    throw new Error('Pelo menos triggerStopUpPrice (TP) ou triggerStopDownPrice (SL) deve ser definido');
  }
  // stopPriceType é obrigatório quando há triggers (docs oficiais KuCoin Futures)
  if (!params.stopPriceType) {
    throw new Error('stopPriceType é obrigatório quando há triggerStopUpPrice ou triggerStopDownPrice');
  }

  const response = await executeRequest<CreateStopOrderResponse>(
    'POST',
    '/api/v1/st-orders',
    params as unknown as Record<string, unknown>,
    true
  );
  
  logger.info(
    { 
      orderId: response.data.orderId, 
      clientOid: params.clientOid, 
      symbol: params.symbol,
      tp: params.triggerStopUpPrice,
      sl: params.triggerStopDownPrice,
    },
    'Ordem stop (TP/SL) criada com sucesso'
  );
  
  return response.data;
}

/**
 * Cancela uma ordem stop
 * DELETE /api/v1/st-orders/{orderId}
 */
export async function cancelStopOrder(orderId: string): Promise<{ cancelledOrderIds: string[] }> {
  const response = await executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    `/api/v1/st-orders/${orderId}`,
    undefined,
    true
  );
  
  logger.info({ orderId }, 'Ordem stop cancelada');
  return response.data;
}

/**
 * Lista ordens stop abertas
 * GET /api/v1/st-orders
 */
export async function getOpenStopOrders(symbol?: string): Promise<{
  currentPage: number;
  pageSize: number;
  totalNum: number;
  totalPage: number;
  items: KucoinOrder[];
}> {
  const endpoint = symbol 
    ? `/api/v1/st-orders?symbol=${symbol}` 
    : '/api/v1/st-orders';
  
  const response = await executeRequest<{
    currentPage: number;
    pageSize: number;
    totalNum: number;
    totalPage: number;
    items: KucoinOrder[];
  }>(
    'GET',
    endpoint,
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
// ============================================================================
// FASE 2 - Position History, Max Open Size, Isolated Margin, Risk Limits
// Ref: KuCoin Futures API - https://www.kucoin.com/docs-new/rest/futures-trading/positions
// ============================================================================

/**
 * Histórico de posições fechadas
 * GET /api/v1/history-positions
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/positions/get-positions-history
 */
export async function getPositionsHistory(symbol?: string): Promise<{ items: KucoinPositionHistory[] }> {
  const params = symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
  const response = await executeRequest<{ items: KucoinPositionHistory[] }>(
    'GET',
    `/api/v1/history-positions${params}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Tamanho máximo de abertura de posição
 * GET /api/v2/getMaxOpenSize
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/positions/get-max-open-size
 */
export async function getMaxOpenSize(symbol: string, price: string, leverage: number): Promise<{ maxBuyOpenSize: number; maxSellOpenSize: number }> {
  const response = await executeRequest<{ maxBuyOpenSize: number; maxSellOpenSize: number }>(
    'GET',
    `/api/v2/getMaxOpenSize?symbol=${encodeURIComponent(symbol)}&price=${encodeURIComponent(price)}&leverage=${leverage}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Adicionar margem isolada à posição
 * POST /api/v1/position/margin/deposit-margin
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/positions/add-isolated-margin
 */
export async function addIsolatedMargin(symbol: string, margin: number, bizNo: string): Promise<KucoinPosition> {
  const response = await executeRequest<KucoinPosition>(
    'POST',
    '/api/v1/position/margin/deposit-margin',
    { symbol, margin, bizNo },
    true
  );
  
  logger.info({ symbol, margin, bizNo }, 'Margem isolada adicionada');
  return response.data;
}

/**
 * Remover margem isolada da posição
 * POST /api/v1/margin/withdrawMargin
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/positions/remove-isolated-margin
 */
export async function removeIsolatedMargin(symbol: string, withdrawAmount: string): Promise<{ withdrawAmount: number }> {
  const response = await executeRequest<{ withdrawAmount: number }>(
    'POST',
    '/api/v1/margin/withdrawMargin',
    { symbol, withdrawAmount },
    true
  );
  
  logger.info({ symbol, withdrawAmount }, 'Margem isolada removida');
  return response.data;
}

/**
 * Margem máxima que pode ser retirada de posição isolada
 * GET /api/v1/margin/maxWithdrawMargin
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/positions/get-max-withdraw-margin
 */
export async function getMaxWithdrawMargin(symbol: string): Promise<{ maxWithdrawMargin: number }> {
  const response = await executeRequest<{ maxWithdrawMargin: number }>(
    'GET',
    `/api/v1/margin/maxWithdrawMargin?symbol=${encodeURIComponent(symbol)}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Alterar modo de margem em batch (múltiplos símbolos)
 * POST /api/v2/position/batchChangeMarginMode
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/positions/batch-change-margin-mode
 */
export async function batchChangeMarginMode(symbolModes: { symbol: string; marginMode: 'ISOLATED' | 'CROSS' }[]): Promise<MarginModeResponse[]> {
  const response = await executeRequest<MarginModeResponse[]>(
    'POST',
    '/api/v2/position/batchChangeMarginMode',
    symbolModes as unknown as Record<string, unknown>,
    true
  );
  
  logger.info({ count: symbolModes.length }, 'Batch de margin mode alterado');
  return response.data;
}

/**
 * Risk limits para margem cross
 * GET /api/v2/contracts/risk-limit/{symbol}
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/risk-limit/get-cross-margin-risk-limit
 */
export async function getCrossMarginRiskLimit(symbol: string): Promise<RiskLimitData[]> {
  const response = await executeRequest<RiskLimitData[]>(
    'GET',
    `/api/v2/contracts/risk-limit/${encodeURIComponent(symbol)}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Risk limits para margem isolada
 * GET /api/v1/contracts/risk-limit/{symbol}
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/risk-limit/get-isolated-margin-risk-limit
 */
export async function getIsolatedMarginRiskLimit(symbol: string): Promise<RiskLimitData[]> {
  const response = await executeRequest<RiskLimitData[]>(
    'GET',
    `/api/v1/contracts/risk-limit/${encodeURIComponent(symbol)}`,
    undefined,
    true
  );
  return response.data;
}

// ============================================================================
// MARKET DATA AVANÇADO - Cobertura 100% KuCoin Futures API
// ============================================================================

/**
 * Obtém todos os tickers Futures
 * GET /api/v1/allTickers
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/market-data/get-all-tickers
 */
export async function getAllFuturesTickers(): Promise<KucoinTicker[]> {
  const response = await executeRequest<KucoinTicker[]>(
    'GET',
    '/api/v1/allTickers',
    undefined,
    false
  );
  return response.data;
}

/**
 * Obtém order book completo (Level 2 snapshot)
 * GET /api/v1/level2/snapshot
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/market-data/get-full-order-book-level2
 */
export async function getFullFuturesOrderBook(symbol: string): Promise<KucoinOrderBook> {
  const response = await executeRequest<KucoinOrderBook>(
    'GET',
    `/api/v1/level2/snapshot?symbol=${encodeURIComponent(symbol)}`,
    undefined,
    false
  );
  return response.data;
}

/** Dados de índice de preço spot */
export interface SpotIndexPrice {
  symbol: string;
  granularity: number;
  timePoint: number;
  value: number;
  decomposionList: { exchange: string; price: number; weight: number }[];
}

/**
 * Obtém índice de preço spot
 * GET /api/v1/index/query
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/market-data/get-spot-index-price
 */
export async function getSpotIndexPrice(symbol: string, params?: { startAt?: number; endAt?: number; reverse?: boolean; offset?: number; forward?: boolean; maxCount?: number }): Promise<{ dataList: SpotIndexPrice[] }> {
  let endpoint = `/api/v1/index/query?symbol=${encodeURIComponent(symbol)}`;
  if (params?.startAt) endpoint += `&startAt=${params.startAt}`;
  if (params?.endAt) endpoint += `&endAt=${params.endAt}`;
  if (params?.reverse !== undefined) endpoint += `&reverse=${params.reverse}`;
  if (params?.offset !== undefined) endpoint += `&offset=${params.offset}`;
  if (params?.forward !== undefined) endpoint += `&forward=${params.forward}`;
  if (params?.maxCount) endpoint += `&maxCount=${params.maxCount}`;
  const response = await executeRequest<{ dataList: SpotIndexPrice[] }>(
    'GET',
    endpoint,
    undefined,
    false
  );
  return response.data;
}

/** Dados de índice de taxa de juros */
export interface InterestRateIndex {
  symbol: string;
  granularity: number;
  timePoint: number;
  value: number;
}

/**
 * Obtém índice de taxa de juros
 * GET /api/v1/interest/query
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/market-data/get-interest-rate-index
 */
export async function getInterestRateIndex(symbol: string, params?: { startAt?: number; endAt?: number; reverse?: boolean; offset?: number; forward?: boolean; maxCount?: number }): Promise<{ dataList: InterestRateIndex[] }> {
  let endpoint = `/api/v1/interest/query?symbol=${encodeURIComponent(symbol)}`;
  if (params?.startAt) endpoint += `&startAt=${params.startAt}`;
  if (params?.endAt) endpoint += `&endAt=${params.endAt}`;
  if (params?.reverse !== undefined) endpoint += `&reverse=${params.reverse}`;
  if (params?.offset !== undefined) endpoint += `&offset=${params.offset}`;
  if (params?.forward !== undefined) endpoint += `&forward=${params.forward}`;
  if (params?.maxCount) endpoint += `&maxCount=${params.maxCount}`;
  const response = await executeRequest<{ dataList: InterestRateIndex[] }>(
    'GET',
    endpoint,
    undefined,
    false
  );
  return response.data;
}

/** Dados de índice premium */
export interface PremiumIndex {
  symbol: string;
  granularity: number;
  timePoint: number;
  value: number;
}

/**
 * Obtém índice premium
 * GET /api/v1/premium/query
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/market-data/get-premium-index
 */
export async function getPremiumIndex(symbol: string, params?: { startAt?: number; endAt?: number; reverse?: boolean; offset?: number; forward?: boolean; maxCount?: number }): Promise<{ dataList: PremiumIndex[] }> {
  let endpoint = `/api/v1/premium/query?symbol=${encodeURIComponent(symbol)}`;
  if (params?.startAt) endpoint += `&startAt=${params.startAt}`;
  if (params?.endAt) endpoint += `&endAt=${params.endAt}`;
  if (params?.reverse !== undefined) endpoint += `&reverse=${params.reverse}`;
  if (params?.offset !== undefined) endpoint += `&offset=${params.offset}`;
  if (params?.forward !== undefined) endpoint += `&forward=${params.forward}`;
  if (params?.maxCount) endpoint += `&maxCount=${params.maxCount}`;
  const response = await executeRequest<{ dataList: PremiumIndex[] }>(
    'GET',
    endpoint,
    undefined,
    false
  );
  return response.data;
}

/** Estatísticas 24h */
export interface Futures24hrStats {
  turnoverOf24h: number;
  volumeOf24h: number;
}

/**
 * Obtém estatísticas de trading 24h
 * GET /api/v1/trade-statistics
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/market-data/get-24hr-stats
 */
export async function get24hrStats(): Promise<Futures24hrStats> {
  const response = await executeRequest<Futures24hrStats>(
    'GET',
    '/api/v1/trade-statistics',
    undefined,
    false
  );
  return response.data;
}

/**
 * Obtém hora do servidor Futures
 * GET /api/v1/timestamp
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/market-data/get-server-time
 */
export async function getFuturesServerTime(): Promise<number> {
  const response = await executeRequest<number>(
    'GET',
    '/api/v1/timestamp',
    undefined,
    false
  );
  return response.data;
}

/** Status do serviço Futures */
export interface FuturesServiceStatus {
  status: string;
  msg: string;
}

/**
 * Obtém status do serviço Futures
 * GET /api/v1/status
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/market-data/get-service-status
 */
export async function getFuturesServiceStatus(): Promise<FuturesServiceStatus> {
  const response = await executeRequest<FuturesServiceStatus>(
    'GET',
    '/api/v1/status',
    undefined,
    false
  );
  return response.data;
}

// ============================================================================
// ORDENS AVANÇADAS - Cobertura 100% KuCoin Futures API
// ============================================================================

/**
 * Cancela múltiplas ordens em batch por IDs
 * DELETE /api/v1/orders/multi-cancel
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/orders/batch-cancel-orders
 */
export async function batchCancelOrders(orderIds: string[]): Promise<{ cancelledOrderIds: string[]; failedOrderIds?: string[] }> {
  if (orderIds.length === 0) {
    return { cancelledOrderIds: [] };
  }
  const response = await executeRequest<{ cancelledOrderIds: string[]; failedOrderIds?: string[] }>(
    'DELETE',
    `/api/v1/orders/multi-cancel?orderIds=${orderIds.join(',')}`,
    undefined,
    true
  );
  
  logger.info({ count: response.data.cancelledOrderIds.length }, 'Batch de ordens canceladas');
  return response.data;
}

/** Dados de fill/trade */
export interface KucoinFill {
  symbol: string;
  tradeId: string;
  orderId: string;
  side: string;
  liquidity: string;
  forceTaker: boolean;
  price: string;
  size: number;
  value: string;
  feeRate: string;
  fixFee: string;
  feeCurrency: string;
  stop: string;
  fee: string;
  orderType: string;
  tradeType: string;
  createdAt: number;
  settleCurrency: string;
  openFeePay: string;
  closeFeePay: string;
  tradeTime: number;
  marginMode: string;
}

/**
 * Obtém ordens recentes fechadas (últimas 1000)
 * GET /api/v1/recentDoneOrders
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/orders/get-recent-closed-orders
 */
export async function getRecentClosedOrders(symbol?: string): Promise<KucoinOrder[]> {
  const params = symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
  const response = await executeRequest<KucoinOrder[]>(
    'GET',
    `/api/v1/recentDoneOrders${params}`,
    undefined,
    true
  );
  return response.data;
}

/** Estatísticas de ordens abertas */
export interface OpenOrderStatistics {
  openOrderBuySize: number;
  openOrderSellSize: number;
  openOrderBuyCost: string;
  openOrderSellCost: string;
  settleCurrency: string;
}

/**
 * Obtém valor de ordens abertas (margem usada por ordens)
 * GET /api/v1/openOrderStatistics
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/orders/get-open-order-value
 */
export async function getOpenOrderValue(symbol: string): Promise<OpenOrderStatistics> {
  const response = await executeRequest<OpenOrderStatistics>(
    'GET',
    `/api/v1/openOrderStatistics?symbol=${encodeURIComponent(symbol)}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Obtém fills/trades paginados
 * GET /api/v1/fills
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/fills/get-recent-filled-list
 */
export async function getFills(params?: {
  symbol?: string;
  orderId?: string;
  side?: 'buy' | 'sell';
  type?: 'limit' | 'market';
  startAt?: number;
  endAt?: number;
  pageSize?: number;
  currentPage?: number;
}): Promise<{
  currentPage: number;
  pageSize: number;
  totalNum: number;
  totalPage: number;
  items: KucoinFill[];
}> {
  let endpoint = '/api/v1/fills?';
  const queryParts: string[] = [];
  if (params?.symbol) queryParts.push(`symbol=${encodeURIComponent(params.symbol)}`);
  if (params?.orderId) queryParts.push(`orderId=${encodeURIComponent(params.orderId)}`);
  if (params?.side) queryParts.push(`side=${params.side}`);
  if (params?.type) queryParts.push(`type=${params.type}`);
  if (params?.startAt) queryParts.push(`startAt=${params.startAt}`);
  if (params?.endAt) queryParts.push(`endAt=${params.endAt}`);
  if (params?.pageSize) queryParts.push(`pageSize=${params.pageSize}`);
  if (params?.currentPage) queryParts.push(`currentPage=${params.currentPage}`);
  endpoint += queryParts.join('&');
  
  const response = await executeRequest<{
    currentPage: number;
    pageSize: number;
    totalNum: number;
    totalPage: number;
    items: KucoinFill[];
  }>(
    'GET',
    endpoint,
    undefined,
    true
  );
  return response.data;
}

// ============================================================================
// POSIÇÕES AVANÇADAS - Cobertura 100% KuCoin Futures API
// ============================================================================

/** Requisito de margem cross */
export interface CrossMarginRequirement {
  symbol: string;
  currency: string;
  positionQty: number;
  orderQty: number;
  positionMargin: string;
  orderMargin: string;
  totalMargin: string;
}

/**
 * Obtém requisito de margem cross
 * GET /api/v2/getCrossMarginRequirement
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/positions/get-cross-margin-requirement
 */
export async function getCrossMarginRequirement(symbol: string): Promise<CrossMarginRequirement> {
  const response = await executeRequest<CrossMarginRequirement>(
    'GET',
    `/api/v2/getCrossMarginRequirement?symbol=${encodeURIComponent(symbol)}`,
    undefined,
    true
  );
  return response.data;
}

/**
 * Modifica risk limit de posição isolada
 * POST /api/v1/position/riskLimit
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/risk-limit/modify-isolated-margin-risk-limit
 */
export async function modifyIsolatedMarginRiskLimit(symbol: string, level: number): Promise<boolean> {
  const response = await executeRequest<boolean>(
    'POST',
    '/api/v1/position/riskLimit',
    { symbol, level },
    true
  );
  
  logger.info({ symbol, level }, 'Risk limit isolado modificado');
  return response.data;
}

// ============================================================================
// FUNDING FEES - Cobertura 100% KuCoin Futures API
// ============================================================================

/** Dados de funding rate histórico */
export interface FundingRateHistory {
  symbol: string;
  fundingRate: number;
  timePoint: number;
}

/**
 * Obtém histórico público de funding rates
 * GET /api/v1/contract/funding-rates
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/funding-fees/get-public-funding-history
 */
export async function getPublicFundingHistory(symbol: string, from: number, to: number): Promise<FundingRateHistory[]> {
  const response = await executeRequest<FundingRateHistory[]>(
    'GET',
    `/api/v1/contract/funding-rates?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`,
    undefined,
    false
  );
  return response.data;
}

/** Dados de funding fee privado */
export interface PrivateFundingHistory {
  id: number;
  symbol: string;
  timePoint: number;
  fundingRate: number;
  markPrice: number;
  positionQty: number;
  positionCost: number;
  funding: number;
  settleCurrency: string;
  context: string;
}

/**
 * Obtém histórico privado de funding fees (posições do usuário)
 * GET /api/v1/funding-history
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/funding-fees/get-private-funding-history
 */
export async function getPrivateFundingHistory(symbol: string, params?: {
  startAt?: number;
  endAt?: number;
  reverse?: boolean;
  offset?: number;
  forward?: boolean;
  maxCount?: number;
}): Promise<{ dataList: PrivateFundingHistory[]; hasMore: boolean }> {
  let endpoint = `/api/v1/funding-history?symbol=${encodeURIComponent(symbol)}`;
  if (params?.startAt) endpoint += `&startAt=${params.startAt}`;
  if (params?.endAt) endpoint += `&endAt=${params.endAt}`;
  if (params?.reverse !== undefined) endpoint += `&reverse=${params.reverse}`;
  if (params?.offset !== undefined) endpoint += `&offset=${params.offset}`;
  if (params?.forward !== undefined) endpoint += `&forward=${params.forward}`;
  if (params?.maxCount) endpoint += `&maxCount=${params.maxCount}`;
  const response = await executeRequest<{ dataList: PrivateFundingHistory[]; hasMore: boolean }>(
    'GET',
    endpoint,
    undefined,
    true
  );
  return response.data;
}

// ============================================================================
// FASE 1 - Batch Orders, Cancel by ClientOid, Order Test, Cancel All Stop Orders
// Ref: KuCoin Futures API - https://www.kucoin.com/docs-new/rest/futures-trading/orders
// ============================================================================

/**
 * Cria múltiplas ordens em batch (até 20 por vez)
 * POST /api/v1/orders/multi
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/orders/batch-add-orders
 */
export async function batchCreateOrders(orders: CreateOrderParams[]): Promise<{ orderId: string; clientOid: string }[]> {
  if (orders.length === 0) {
    return [];
  }
  if (orders.length > 20) {
    throw new Error('Máximo de 20 ordens por batch (limite KuCoin)');
  }
  const response = await executeRequest<{ orderId: string; clientOid: string }[]>(
    'POST',
    '/api/v1/orders/multi',
    orders as unknown as Record<string, unknown>,
    true
  );
  
  logger.info(
    { count: response.data.length },
    'Batch de ordens criadas com sucesso'
  );
  
  return response.data;
}

/**
 * Cria uma ordem de teste (dry run - não executa de verdade)
 * POST /api/v1/orders/test
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/orders/add-order-test
 */
export async function createOrderTest(params: CreateOrderParams): Promise<CreateOrderResponse> {
  const response = await executeRequest<CreateOrderResponse>(
    'POST',
    '/api/v1/orders/test',
    params as unknown as Record<string, unknown>,
    true
  );
  
  logger.info(
    { orderId: response.data.orderId, clientOid: params.clientOid, symbol: params.symbol },
    'Ordem de teste criada (dry run)'
  );
  
  return response.data;
}

/**
 * Cancela uma ordem pelo clientOid
 * DELETE /api/v1/orders/client-order/{clientOid}
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/orders/cancel-order-by-clientoid
 */
export async function cancelOrderByClientOid(clientOid: string, symbol: string): Promise<{ clientOid: string }> {
  const response = await executeRequest<{ clientOid: string }>(
    'DELETE',
    `/api/v1/orders/client-order/${clientOid}?symbol=${encodeURIComponent(symbol)}`,
    undefined,
    true
  );
  
  logger.info({ clientOid, symbol }, 'Ordem cancelada por clientOid');
  return response.data;
}

/**
 * Cancela todas as stop orders abertas
 * DELETE /api/v1/st-orders
 * Ref: https://www.kucoin.com/docs-new/rest/futures-trading/orders/cancel-all-stop-orders
 */
export async function cancelAllStopOrders(symbol?: string): Promise<{ cancelledOrderIds: string[] }> {
  const endpoint = symbol ? `/api/v1/st-orders?symbol=${encodeURIComponent(symbol)}` : '/api/v1/st-orders';
  const response = await executeRequest<{ cancelledOrderIds: string[] }>(
    'DELETE',
    endpoint,
    undefined,
    true
  );
  
  logger.info({ symbol, count: response.data.cancelledOrderIds.length }, 'Todas stop orders canceladas');
  return response.data;
}

export function generateClientOid(): string {
  // UUID v4 nativo do Node.js (mais robusto que timestamp + randomBytes)
  return `alice-${crypto.randomUUID()}`;
}

/**
 * Valida se um símbolo é suportado (BTC perpetuals)
 * 
 * CORREÇÃO AUDITORIA 17/12/2025: Símbolos agora vêm de variável de ambiente
 * Permite expansão futura sem modificar código
 */
export async function isValidSymbol(symbol: string): Promise<boolean> {
  const allowed = await getAllowedSymbols();
  return allowed.includes(symbol.trim().toUpperCase());
}

/**
 * Converte granularidade em minutos para string de intervalo
 */
export function granularityToInterval(granularity: number): string {
  const map: Record<number, string> = {
    1: '1min',
    3: '3min',
    5: '5min',
    15: '15min',
    30: '30min',
    60: '1hour',
    120: '2hour',
    240: '4hour',
    480: '8hour',
    720: '12hour',
    1440: '1day',
    10080: '1week',
  };
  return map[granularity] || '1min';
}

/**
 * Converte string de intervalo para granularidade em minutos
 */
export function intervalToGranularity(interval: string): number {
  const map: Record<string, number> = {
    '1min': 1,
    '3min': 3,
    '5min': 5,
    '15min': 15,
    '30min': 30,
    '1hour': 60,
    '2hour': 120,
    '4hour': 240,
    '8hour': 480,
    '12hour': 720,
    '1day': 1440,
    '1week': 10080,
  };
  return map[interval] || 1;
}

export default {
  // Verificação
  isKucoinConfigured,
  getKucoinCircuitBreakerStatus,
  initKucoinMetrics,
  
  // Públicos - Básicos
  getTicker,
  getContractInfo,
  getActiveContracts,
  
  // Públicos - Dados de Mercado (17/12/2025)
  getKlines,
  getOrderBook,
  getCurrentFundingRate,
  getMarkPrice,
  getTradeHistory,
  
  // Públicos - Market Data Avançado (cobertura 100%)
  getAllFuturesTickers,
  getFullFuturesOrderBook,
  getSpotIndexPrice,
  getInterestRateIndex,
  getPremiumIndex,
  get24hrStats,
  getFuturesServerTime,
  getFuturesServiceStatus,
  
  // Conta
  getAccountOverview,
  
  // Ordens
  createOrder,
  cancelOrder,
  cancelAllOrders,
  getOrder,
  getOrderById,
  getOrderByClientOid,
  getOpenOrders,
  getOrderHistory,
  getOrdersByIds,
  
  // Ordens Avançadas (cobertura 100%)
  batchCancelOrders,
  getRecentClosedOrders,
  getOpenOrderValue,
  getFills,
  
  // Stop Orders (TP/SL) - KuCoin API 2025
  createStopOrder,
  cancelStopOrder,
  getOpenStopOrders,
  cancelAllStopOrders,
  
  // Batch + Test + Cancel by ClientOid (FASE 1)
  batchCreateOrders,
  createOrderTest,
  cancelOrderByClientOid,
  
  // Posições
  getPosition,
  getAllPositions,
  
  // Margin Mode e Position Mode (07/02/2026)
  getMarginMode,
  changeMarginMode,
  getPositionMode,
  changePositionMode,
  getCrossUserLeverage,
  changeCrossUserLeverage,
  
  // Position History + Isolated Margin + Risk Limits (FASE 2)
  getPositionsHistory,
  getMaxOpenSize,
  addIsolatedMargin,
  removeIsolatedMargin,
  getMaxWithdrawMargin,
  batchChangeMarginMode,
  getCrossMarginRiskLimit,
  getIsolatedMarginRiskLimit,
  
  // Posições Avançadas (cobertura 100%)
  getCrossMarginRequirement,
  modifyIsolatedMarginRiskLimit,
  
  // Funding Fees (cobertura 100%)
  getPublicFundingHistory,
  getPrivateFundingHistory,
  
  // Helpers
  generateClientOid,
  isValidSymbol,
  granularityToInterval,
  intervalToGranularity,
};
