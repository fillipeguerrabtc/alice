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
  const url = process.env.KUCOIN_PRO_BASE_URL;
  if (!url && process.env.NODE_ENV === 'production') {
    logger.info('KUCOIN_PRO_BASE_URL não configurada em produção, usando URL oficial padrão');
  }
  return url || 'https://api-futures.kucoin.com';
})();

// Credenciais da API - Usando nomes corretos dos secrets GitHub
// ANTES: KUCOIN_API_KEY, KUCOIN_API_SECRET, KUCOIN_API_PASSPHRASE (workaround)
// AGORA: KUCOIN_PRO_API_KEY, KUCOIN_PRO_API_SECRET, KUCOIN_PRO_API_PASSPHRASE (enterprise)
const KUCOIN_PRO_API_KEY = process.env.KUCOIN_PRO_API_KEY;
const KUCOIN_PRO_API_SECRET = process.env.KUCOIN_PRO_API_SECRET;
const KUCOIN_PRO_API_PASSPHRASE = process.env.KUCOIN_PRO_API_PASSPHRASE;


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
  const configured = process.env.KUCOIN_DEFAULT_SYMBOL?.trim().toUpperCase();
  const allowed = await getAllowedSymbols();

  if (configured) {
    if (!allowed.includes(configured)) {
      const message = `KUCOIN_DEFAULT_SYMBOL inválido: "${configured}". Valores permitidos: ${allowed.join(', ')}`;
      if (process.env.NODE_ENV === 'production') {
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

/** Parâmetros para criar ordem */
export interface CreateOrderParams {
  clientOid: string;           // ID único do cliente (UUID)
  symbol: string;              // Par de trading (ex: SYMBOL)
  side: 'buy' | 'sell';        // Direção
  type: 'limit' | 'market';    // Tipo de ordem
  leverage?: number;           // Alavancagem (1-100)
  size: number;                // Quantidade em contratos (inteiro positivo)
  price?: string;              // Preço (obrigatório para limit)
  timeInForce?: 'GTC' | 'IOC'; // Validade da ordem
  postOnly?: boolean;          // Apenas maker
  reduceOnly?: boolean;        // Apenas reduzir posição
  stopPrice?: string;          // Preço de stop (stop-loss/take-profit)
  stopPriceType?: 'TP' | 'MP'; // Tipo de preço para stop (TP=Trade, MP=Mark)
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

const kucoinFuturesRequester = createKucoinRequester({
  name: 'kucoin-futures',
  operationPrefix: 'futures',
  baseUrl: KUCOIN_FUTURES_BASE_URL,
  circuitBreakerPreset: CIRCUIT_BREAKER_PRESETS.kucoinFutures,
});

export function initKucoinMetrics(prometheusMetrics: ReturnType<typeof createAlicePrometheus>['metrics']): void {
  kucoinFuturesRequester.initMetrics(prometheusMetrics);
  logger.info('Métricas do circuit breaker KuCoin inicializadas');
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
  return kucoinFuturesRequester.executeRequest<T>(method, endpoint, body, requiresAuth);
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
  qty?: number;                   // Quantidade (novo parâmetro KuCoin 2025)
  valueQty?: number;              // Valor da quantidade (novo parâmetro KuCoin 2025)
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
  
  // Stop Orders (TP/SL) - KuCoin API 2025
  createStopOrder,
  cancelStopOrder,
  getOpenStopOrders,
  
  // Posições
  getPosition,
  getAllPositions,
  
  // Helpers
  generateClientOid,
  isValidSymbol,
  granularityToInterval,
  intervalToGranularity,
};
