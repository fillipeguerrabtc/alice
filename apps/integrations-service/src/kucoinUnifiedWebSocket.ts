/**
 * KuCoin Unified WebSocket Client - Alice Enterprise Platform
 *
 * Cliente WebSocket unificado para Futures + Spot/Margin.
 * Elimina duplicação entre kucoinWebSocket.ts e kucoinSpotWebSocket.ts.
 *
 * Formato verificado: Classic WebSocket API (mesmo do SDK oficial KuCoin v1.3.0)
 * - Token: /api/v1/bullet-public (público) e /api/v1/bullet-private (privado)
 * - Subscribe: { type: 'subscribe', topic, response: true, privateChannel }
 * - Dados: { type: 'message', topic, subject, data }
 *
 * Funcionalidades:
 * - Parametrizado por mercado (futures | spot) — um único código para ambos
 * - Resolução automática de tópicos por mercado
 * - Ping/Pong heartbeat com timeout configurável
 * - Reconexão automática com backoff exponencial (max 10 tentativas)
 * - Renovação de token antes de expirar (23h de 24h)
 * - Validação de payload com type guards para Spot
 * - Suporte a canais públicos e privados
 * - Ordens via WebSocket (baixa latência)
 *
 * Regra 6 - SEM MOCKS: Conexão real com KuCoin API
 * Regra 8 - TypeScript strict, zero any
 * Regra 16 - Resiliência com reconnect automático
 *
 * Autor: Fillipe Guerra
 * Data: 10 de Fevereiro de 2026
 */

import WebSocket from 'ws';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createLogger } from '@alice/logger';
import { readOptionalStringEnv } from '@alice/config';
import { getKucoinAuthHeaders } from './kucoinRequest.js';

// ============================================================================
// CONFIGURAÇÃO (via variáveis de ambiente - Regra 6: sem hardcoded)
// ============================================================================
const KUCOIN_FUTURES_BASE_URL = readOptionalStringEnv('KUCOIN_PRO_BASE_URL') ?? 'https://api-futures.kucoin.com';
const KUCOIN_SPOT_BASE_URL = readOptionalStringEnv('KUCOIN_SPOT_BASE_URL') ?? 'https://api.kucoin.com';
const KUCOIN_PRO_API_KEY = readOptionalStringEnv('KUCOIN_PRO_API_KEY');
const KUCOIN_PRO_API_SECRET = readOptionalStringEnv('KUCOIN_PRO_API_SECRET');
const KUCOIN_PRO_API_PASSPHRASE = readOptionalStringEnv('KUCOIN_PRO_API_PASSPHRASE');
const KUCOIN_WS_MAX_TOPICS = 400;

// ============================================================================
// TIPOS COMPARTILHADOS
// ============================================================================
export type MarketDomain = 'futures' | 'spot';
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface BulletResponse {
  code: string;
  data: {
    token: string;
    instanceServers: Array<{
      endpoint: string;
      encrypt: boolean;
      protocol: string;
      pingInterval: number;
      pingTimeout: number;
    }>;
  };
}

export interface KucoinWSMessage {
  type: string;
  topic?: string;
  subject?: string;
  data?: unknown;
  id?: string;
  code?: number;
}

// ============================================================================
// TIPOS FUTURES
// ============================================================================
export interface FuturesTickerData {
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

export interface OrderBookEntry {
  price: string;
  size: string;
  sequence: number;
}

export interface FuturesOrderBookData {
  symbol: string;
  sequence: number;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  timestamp: number;
}

interface RawFuturesOrderBookData {
  sequence: number;
  asks: Array<[string | number, string | number]>;
  bids: Array<[string | number, string | number]>;
  ts: number;
}

export interface FuturesKlineData {
  symbol: string;
  interval?: string;
  candles: [number, string, string, string, string, string, string];
  time: number;
}

export interface FuturesTradeData {
  symbol: string;
  sequence: number;
  side: string;
  size: number;
  price: string;
  takerOrderId: string;
  makerOrderId: string;
  tradeId: string;
  ts: number;
}

export interface OrderUpdateData {
  orderId: string;
  symbol: string;
  type: string;
  status: string;
  matchSize?: string;
  matchPrice?: string;
  orderType: string;
  side: string;
  price?: string;
  size: string;
  remainSize: string;
  filledSize: string;
  canceledSize?: string;
  tradeId?: string;
  clientOid: string;
  orderTime: number;
  ts: number;
}

export interface PositionUpdateData {
  symbol: string;
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
}

export interface BalanceUpdateData {
  availableBalance: string;
  holdBalance: string;
  currency: string;
  timestamp: number;
}

export interface StopOrderUpdateData {
  orderId: string;
  symbol: string;
  type: string;
  orderType: string;
  side: string;
  size: string;
  orderPrice?: string;
  stop: string;
  stopPrice: string;
  stopPriceType: string;
  triggerSuccess: boolean;
  error?: string;
  createdAt: number;
  ts: number;
}

export interface FundingRateData {
  symbol: string;
  granularity: number;
  fundingRate: number;
  timestamp: number;
}

export interface CrossLeverageUpdateData {
  symbol: string;
  currentLeverage: number;
  previousLeverage?: number;
  timestamp: number;
}

export interface LiquidationWarningData {
  symbol: string;
  positionSide: string;
  markPrice: string;
  liquidationPrice: string;
  unrealisedPnl: string;
  maintenanceMargin: string;
  timestamp: number;
}

export interface ExecutionData {
  symbol: string;
  side: string;
  orderId: string;
  matchSize: string;
  matchPrice: string;
  orderType: string;
  tradeId: string;
  ts: number;
  liquidity: string;
  feeRate: string;
  feeCurrency: string;
  fee: string;
}

// ============================================================================
// TIPOS SPOT/MARGIN
// ============================================================================
export interface SpotTickerData {
  symbol: string;
  price: string;
  size: string;
  bestAsk: string;
  bestAskSize: string;
  bestBid: string;
  bestBidSize: string;
  time: number;
}

export interface SpotOrderBookData {
  symbol: string;
  asks: Array<[string | number, string | number]>;
  bids: Array<[string | number, string | number]>;
  timestamp: number;
}

export interface SpotKlineData {
  symbol: string;
  candles: [string, string, string, string, string, string, string];
  time: number;
  interval?: string;
}

export interface SpotTradeData {
  symbol: string;
  price: string;
  size: string;
  side: string;
  tradeId: string;
  time: number;
}

export interface MarginPositionData {
  symbol?: string;
  [key: string]: unknown;
}

export interface SpotOrderUpdateData {
  symbol: string;
  orderType: string;
  side: string;
  orderId: string;
  type: string;
  orderTime: number;
  size: string;
  filledSize: string;
  price: string;
  clientOid: string;
  remainSize: string;
  status: string;
  ts: number;
}

export interface SpotBalanceUpdateData {
  total: string;
  available: string;
  availableChange: string;
  currency: string;
  hold: string;
  holdChange: string;
  relationEvent: string;
  relationEventId: string;
  relationContext: string;
  time: string;
}

// ============================================================================
// TYPE GUARDS (para validação de payload Spot)
// ============================================================================
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSpotTickerData(value: unknown): value is SpotTickerData {
  if (!isRecord(value)) return false;
  return isString(value.symbol)
    && isString(value.price)
    && isString(value.size)
    && isString(value.bestAsk)
    && isString(value.bestAskSize)
    && isString(value.bestBid)
    && isString(value.bestBidSize)
    && isNumber(value.time);
}

function isSpotOrderBookData(value: unknown): value is SpotOrderBookData {
  if (!isRecord(value)) return false;
  return isString(value.symbol)
    && Array.isArray(value.asks)
    && Array.isArray(value.bids)
    && isNumber(value.timestamp);
}

function isSpotKlineData(value: unknown): value is SpotKlineData {
  if (!isRecord(value)) return false;
  return isString(value.symbol)
    && Array.isArray(value.candles)
    && isNumber(value.time);
}

function isSpotTradeData(value: unknown): value is SpotTradeData {
  if (!isRecord(value)) return false;
  return isString(value.symbol)
    && isString(value.price)
    && isString(value.size)
    && isString(value.side)
    && isString(value.tradeId)
    && isNumber(value.time);
}

// ============================================================================
// HELPERS
// ============================================================================

/** Constrói tópico para mercado Spot baseado no canal e parâmetros */
export function buildSpotMarketTopic(params: {
  channel: 'ticker' | 'orderbook' | 'klines' | 'trades';
  symbol: string;
  interval?: string;
  depth?: 5 | 50;
}): string {
  const symbol = params.symbol.toUpperCase();
  switch (params.channel) {
    case 'ticker':
      return `/market/ticker:${symbol}`;
    case 'orderbook': {
      const depth = params.depth ?? 50;
      return `/spotMarket/level2Depth${depth}:${symbol}`;
    }
    case 'klines': {
      const interval = params.interval ?? '1min';
      return `/market/candles:${symbol}_${interval}`;
    }
    case 'trades':
      return `/market/match:${symbol}`;
    default:
      return `/market/ticker:${symbol}`;
  }
}

// ============================================================================
// CLASSE PRINCIPAL: KuCoin Unified WebSocket Client
// ============================================================================
export class KucoinUnifiedWSClient extends EventEmitter {
  private readonly market: MarketDomain;
  private readonly baseUrl: string;
  private readonly loggerInstance;
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private endpoint: string | null = null;
  private pingInterval: number = 18000;
  private pingTimeout: number = 10000;
  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private tokenRefreshTimer: NodeJS.Timeout | null = null;
  private state: ConnectionState = 'disconnected';
  private subscriptions: Set<string> = new Set();
  private connectId: string = '';
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 10;
  private isPrivate: boolean = false;

  constructor(market: MarketDomain) {
    super();
    this.market = market;
    this.baseUrl = market === 'futures' ? KUCOIN_FUTURES_BASE_URL : KUCOIN_SPOT_BASE_URL;
    this.loggerInstance = createLogger(`kucoin-ws-${market}`);
  }

  // --------------------------------------------------------------------------
  // Conexão
  // --------------------------------------------------------------------------

  /** Obtém token para conexão WebSocket */
  private async getToken(isPrivate: boolean): Promise<BulletResponse> {
    const endpoint = isPrivate ? '/api/v1/bullet-private' : '/api/v1/bullet-public';
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = isPrivate
      ? await getKucoinAuthHeaders({ baseUrl: this.baseUrl, method: 'POST', endpoint })
      : { 'Content-Type': 'application/json' };

    this.loggerInstance.debug({ isPrivate, endpoint }, 'Obtendo token WebSocket');

    const response = await fetch(url, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.loggerInstance.error({ status: response.status, body: errorBody }, 'Erro ao obter token WebSocket');
      throw new Error(`Falha ao obter token WebSocket (${this.market}): ${response.status} - ${errorBody}`);
    }

    const data = await response.json() as BulletResponse;
    if (data.code !== '200000') {
      throw new Error(`Erro na API KuCoin (${this.market}): ${data.code}`);
    }
    return data;
  }

  /** Conecta ao WebSocket KuCoin */
  async connect(isPrivate: boolean = false): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      this.loggerInstance.warn('WebSocket já está conectado ou conectando');
      return;
    }

    this.isPrivate = isPrivate;
    this.setState('connecting');

    try {
      const bulletData = await this.getToken(isPrivate);
      this.token = bulletData.data.token;

      if (!bulletData.data.instanceServers || bulletData.data.instanceServers.length === 0) {
        throw new Error(`KuCoin WebSocket (${this.market}): Nenhum servidor disponível`);
      }
      const server = bulletData.data.instanceServers[0];
      this.endpoint = server.endpoint;
      this.pingInterval = server.pingInterval;
      this.pingTimeout = server.pingTimeout;

      this.connectId = `alice-${this.market}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const wsUrl = `${this.endpoint}?token=${this.token}&connectId=${this.connectId}`;

      this.loggerInstance.info({ endpoint: this.endpoint, isPrivate }, 'Conectando ao WebSocket KuCoin');

      // CORREÇÃO 11/02/2026: Aguardar WebSocket ABRIR de fato antes de resolver a Promise
      // Antes: connect() resolvia quando token era obtido, mas WS ainda em CONNECTING
      // Callers faziam subscribeTicker() com readyState=0 → subscribe silenciosamente falha
      await new Promise<void>((resolve, reject) => {
        this.ws = new WebSocket(wsUrl);

        const onOpenHandler = () => {
          cleanup();
          this.onOpen();
          resolve();
        };

        const onErrorHandler = (error: Error) => {
          cleanup();
          this.onError(error);
          reject(error);
        };

        const cleanup = () => {
          this.ws?.removeListener('open', onOpenHandler);
          this.ws?.removeListener('error', onErrorHandler);
        };

        this.ws.once('open', onOpenHandler);
        this.ws.once('error', onErrorHandler);

        // Handlers permanentes para após a conexão estabelecida
        this.ws.on('message', (data: WebSocket.Data) => this.onMessage(data));
        this.ws.on('close', (code: number, reason: Buffer) => this.onClose(code, reason.toString()));
        this.ws.on('error', (error: Error) => this.onError(error));
      });

      this.scheduleTokenRefresh();
    } catch (error) {
      this.loggerInstance.error({ error: (error as Error).message }, 'Erro ao conectar WebSocket');
      this.setState('disconnected');
      this.emit('error', error as Error);
      throw error;
    }
  }

  /** Handler para conexão aberta */
  private onOpen(): void {
    this.loggerInstance.info({ connectId: this.connectId }, 'WebSocket KuCoin conectado');
    this.setState('connected');
    this.reconnectAttempts = 0;
    this.startPing();
    this.emit('connected');

    // Resubscrever após reconexão
    if (this.subscriptions.size > 0) {
      this.loggerInstance.info({ count: this.subscriptions.size }, 'Resubscrevendo canais após reconexão');
      for (const topic of this.subscriptions) {
        this.sendSubscribeRaw(topic, true);
      }
    }
  }

  /** Handler para mensagens recebidas */
  private onMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString()) as KucoinWSMessage;

      if (message.type === 'pong') { this.onPong(); return; }

      if (message.type === 'welcome') {
        this.loggerInstance.info({ connectId: message.id }, 'KuCoin welcome recebido');
        return;
      }

      // CORREÇÃO 11/02/2026: Logar confirmações de subscribe para diagnóstico
      // Antes: 'ack' era silenciosamente descartado, impossível verificar se subscribe funcionou
      if (message.type === 'ack') {
        this.loggerInstance.info({ id: message.id }, 'KuCoin subscribe confirmado (ack)');
        return;
      }

      // CORREÇÃO 11/02/2026: Tratar respostas de erro da KuCoin explicitamente
      // Antes: mensagens com type 'error' eram silenciosamente descartadas,
      // impossível saber se subscribe falhou → zero dados recebidos → bug fantasma
      if (message.type === 'error') {
        this.loggerInstance.error(
          { code: (message as unknown as Record<string, unknown>).code, data: (message as unknown as Record<string, unknown>).data, id: message.id },
          'KuCoin retornou ERRO para subscribe/unsubscribe'
        );
        this.emit('error', new Error(`KuCoin WS error: ${JSON.stringify(message)}`));
        return;
      }

      if (message.type === 'message' && message.topic && message.data) {
        this.handleDataMessage(message);
        return;
      }

      // CORREÇÃO 11/02/2026: Logar tipos de mensagem não reconhecidos para diagnóstico
      this.loggerInstance.warn(
        { type: message.type, topic: message.topic, id: message.id },
        'Mensagem KuCoin com tipo não tratado'
      );
    } catch (error) {
      this.loggerInstance.error({ error: (error as Error).message }, 'Erro ao processar mensagem WS');
    }
  }

  /** Handler para conexão fechada */
  private onClose(code: number, reason: string): void {
    this.loggerInstance.warn({ code, reason }, 'WebSocket KuCoin desconectado');
    this.cleanup();
    this.emit('disconnected', reason);

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    } else {
      this.loggerInstance.error('Máximo de tentativas de reconexão atingido');
      this.setState('disconnected');
    }
  }

  /** Handler para erros */
  private onError(error: Error): void {
    this.loggerInstance.error({ error: error.message }, 'Erro no WebSocket KuCoin');
    this.emit('error', error);
  }

  // --------------------------------------------------------------------------
  // Processamento de mensagens de dados — roteamento por tópico
  // --------------------------------------------------------------------------

  /** Contador de mensagens para logging periódico (evita flood) */
  private dataMessageCount = 0;

  private handleDataMessage(message: KucoinWSMessage): void {
    const topic = message.topic ?? '';
    const subject = message.subject ?? '';
    const data = message.data;

    // CORREÇÃO 11/02/2026: Log periódico de mensagens de dados recebidas
    // A cada 100 mensagens, logar contagem para confirmar fluxo de dados ativo
    this.dataMessageCount++;
    if (this.dataMessageCount === 1 || this.dataMessageCount % 100 === 0) {
      this.loggerInstance.info(
        { topic, subject, totalReceived: this.dataMessageCount },
        'Dados recebidos do KuCoin WS'
      );
    }

    if (this.market === 'futures') {
      this.handleFuturesData(topic, subject, data);
    } else {
      this.handleSpotData(topic, data);
    }
  }

  // ---- FUTURES ----

  private handleFuturesData(topic: string, subject: string, data: unknown): void {
    // Ticker: /contractMarket/tickerV2:{symbol}
    if (topic.startsWith('/contractMarket/tickerV2:')) {
      this.emit('ticker', data as FuturesTickerData, topic);
      return;
    }

    // Order Book: /contractMarket/level2Depth{5|50}:{symbol}
    if (topic.startsWith('/contractMarket/level2Depth')) {
      const symbol = topic.split(':')[1] ?? '';
      const raw = data as RawFuturesOrderBookData;
      const normalizeEntry = ([price, size]: [string | number, string | number]): OrderBookEntry => ({
        price: String(price),
        size: String(size),
        sequence: raw.sequence,
      });
      const normalized: FuturesOrderBookData = {
        symbol,
        sequence: raw.sequence,
        bids: Array.isArray(raw.bids) ? raw.bids.map(normalizeEntry) : [],
        asks: Array.isArray(raw.asks) ? raw.asks.map(normalizeEntry) : [],
        timestamp: raw.ts,
      };
      this.emit('orderbook', normalized, topic);
      return;
    }

    // Kline: /contractMarket/limitCandle:{symbol}_{interval}
    if (topic.startsWith('/contractMarket/limitCandle:')) {
      const rawTopic = topic.split(':')[1] ?? '';
      const [symbolFromTopic, intervalFromTopic] = rawTopic.split('_');
      const payload = data as FuturesKlineData;
      const enriched: FuturesKlineData = {
        ...payload,
        symbol: payload.symbol || symbolFromTopic,
        interval: payload.interval || intervalFromTopic,
      };
      this.emit('kline', enriched, topic);
      return;
    }

    // Trade: /contractMarket/execution:{symbol}
    if (topic.startsWith('/contractMarket/execution:') && !topic.includes('tradeOrders')) {
      this.emit('trade', data as FuturesTradeData, topic);
      return;
    }

    // Ordens privadas: /contractMarket/tradeOrders
    if (topic.startsWith('/contractMarket/tradeOrders') && !topic.includes('/v2') &&
        (subject === 'orderChange' || subject === 'symbolOrderChange')) {
      this.emit('order', data as OrderUpdateData, topic);
      return;
    }

    // Posições privadas: /contract/position:{symbol} ou /contract/positionAll
    if (topic.startsWith('/contract/position:') || topic === '/contract/positionAll') {
      this.emit('position', data as PositionUpdateData, topic);
      return;
    }

    // Balance: /contractAccount/wallet
    if (topic === '/contractAccount/wallet') {
      this.emit('balance', data as BalanceUpdateData, topic);
      return;
    }

    // Stop Orders: /contractMarket/advancedOrders
    if (topic === '/contractMarket/advancedOrders') {
      this.emit('stopOrder', data as StopOrderUpdateData, topic);
      return;
    }

    // Funding Rate: /contract/funding:{symbol}
    if (topic.startsWith('/contract/funding:')) {
      this.emit('fundingRate', data as FundingRateData, topic);
      return;
    }

    // Cross Leverage: /contract/crossLeverage
    if (topic === '/contract/crossLeverage') {
      this.emit('crossLeverage', data as CrossLeverageUpdateData, topic);
      return;
    }

    // Liquidation Warning: /contract/positionMarginEvent
    if (topic === '/contract/positionMarginEvent') {
      this.emit('liquidationWarning', data as LiquidationWarningData, topic);
      return;
    }

    // Execution privada: /contractMarket/tradeOrders/v2
    if (topic.startsWith('/contractMarket/tradeOrders/v2') && subject === 'match') {
      this.emit('execution', data as unknown as ExecutionData, topic);
      return;
    }

    this.loggerInstance.debug({ topic, subject }, 'Tópico Futures não mapeado');
  }

  // ---- SPOT/MARGIN ----

  private handleSpotData(topic: string, data: unknown): void {
    // Ticker: /market/ticker:{symbol}
    if (topic.startsWith('/market/ticker:')) {
      if (isSpotTickerData(data)) {
        this.emit('ticker', data, topic);
      } else {
        this.loggerInstance.warn({ topic }, 'Payload inválido de ticker Spot/Margin');
      }
      return;
    }

    // OrderBook: /spotMarket/level2Depth{5|50}:{symbol}
    if (topic.startsWith('/spotMarket/level2Depth')) {
      if (isSpotOrderBookData(data)) {
        this.emit('orderbook', data, topic);
      } else {
        this.loggerInstance.warn({ topic }, 'Payload inválido de orderbook Spot/Margin');
      }
      return;
    }

    // Klines: /market/candles:{symbol}_{interval}
    if (topic.startsWith('/market/candles:')) {
      const parts = (topic.split(':')[1] ?? '').split('_');
      const interval = parts.length >= 2 ? parts[1] : undefined;
      if (isSpotKlineData(data)) {
        this.emit('kline', { ...data, interval }, topic);
      } else {
        this.loggerInstance.warn({ topic }, 'Payload inválido de kline Spot/Margin');
      }
      return;
    }

    // Trades: /market/match:{symbol}
    if (topic.startsWith('/market/match:')) {
      if (isSpotTradeData(data)) {
        this.emit('trade', data, topic);
      } else {
        this.loggerInstance.warn({ topic }, 'Payload inválido de trade Spot/Margin');
      }
      return;
    }

    // Margin Position: /margin/position ou /margin/isolatedPosition:{symbol}
    if (topic.startsWith('/margin/position') || topic.startsWith('/margin/isolatedPosition')) {
      if (isRecord(data)) {
        this.emit('marginPosition', data as MarginPositionData, topic);
      }
      return;
    }

    // Ordens Spot/Margin: /spotMarket/tradeOrders
    if (topic.startsWith('/spotMarket/tradeOrders')) {
      if (isRecord(data)) {
        this.emit('order', data as unknown as SpotOrderUpdateData, topic);
      }
      return;
    }

    // Balance Spot/Margin: /account/balance
    if (topic === '/account/balance') {
      if (isRecord(data)) {
        this.emit('balance', data as unknown as SpotBalanceUpdateData, topic);
      }
      return;
    }

    this.loggerInstance.debug({ topic }, 'Tópico Spot/Margin não mapeado');
  }

  // --------------------------------------------------------------------------
  // Ping/Pong e reconexão
  // --------------------------------------------------------------------------

  private startPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const pingId = `ping-${Date.now()}`;
        this.ws.send(JSON.stringify({ id: pingId, type: 'ping' }));
        this.pongTimer = setTimeout(() => {
          this.loggerInstance.warn('Pong timeout - reconectando');
          this.ws?.close();
        }, this.pingTimeout);
      }
    }, this.pingInterval);
  }

  private onPong(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private scheduleTokenRefresh(): void {
    if (this.tokenRefreshTimer) clearTimeout(this.tokenRefreshTimer);
    const refreshInterval = 23 * 60 * 60 * 1000; // 23 horas
    this.tokenRefreshTimer = setTimeout(async () => {
      this.loggerInstance.info('Renovando token WebSocket');
      try {
        const bulletData = await this.getToken(this.isPrivate);
        this.token = bulletData.data.token;
        this.loggerInstance.info('Token WebSocket renovado com sucesso');
        this.scheduleTokenRefresh();
      } catch (error) {
        this.loggerInstance.error({ error: (error as Error).message }, 'Erro ao renovar token - reconectando');
        this.ws?.close();
      }
    }, refreshInterval);
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.loggerInstance.info({ attempt: this.reconnectAttempts, delay }, 'Agendando reconexão');
    this.setState('reconnecting');

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect(this.isPrivate);
      } catch (error) {
        this.loggerInstance.error({ error: (error as Error).message }, 'Falha na reconexão');
      }
    }, delay);
  }

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.emit('stateChange', state);
    }
  }

  private cleanup(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws = null;
  }

  // --------------------------------------------------------------------------
  // Subscribe / Unsubscribe (interno)
  // --------------------------------------------------------------------------

  private sendSubscribeRaw(topic: string, isResubscribe: boolean = false): void {
    // CORREÇÃO CRÍTICA: Registrar tópico no Set ANTES de verificar readyState.
    // Sem isso, subscriptions feitas antes do WS estar OPEN eram silenciosamente
    // descartadas e NUNCA reenviadas em onOpen() (subscriptions.size === 0).
    // Agora: tópico é registrado → onOpen() resubscreve todos os tópicos pendentes.
    if (!isResubscribe) {
      if (this.subscriptions.has(topic)) return;
      if (this.subscriptions.size >= KUCOIN_WS_MAX_TOPICS) {
        this.loggerInstance.warn({ topic, total: this.subscriptions.size }, 'Limite de tópicos WS atingido');
        return;
      }
      this.subscriptions.add(topic);
    }

    // Se WS não está pronto, o tópico já foi registrado e será enviado em onOpen()
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.loggerInstance.info(
        { topic, readyState: this.ws?.readyState ?? 'null' },
        'Subscribe enfileirado — será enviado quando WebSocket abrir'
      );
      return;
    }

    const isPrivateChannel = this.isPrivate && this.isPrivateTopic(topic);
    const subId = `sub-${Date.now()}`;
    this.ws.send(JSON.stringify({
      id: subId,
      type: 'subscribe',
      topic,
      privateChannel: isPrivateChannel,
      response: true,
    }));
    // CORREÇÃO 11/02/2026: Logar em INFO (antes era DEBUG, invisível em produção)
    // Essencial para diagnosticar se subscribes são realmente enviados
    this.loggerInstance.info({ topic, subId, isResubscribe }, 'Subscribe enviado ao KuCoin');
  }

  private sendUnsubscribeRaw(topic: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const isPrivateChannel = this.isPrivate && this.isPrivateTopic(topic);
    this.ws.send(JSON.stringify({
      id: `unsub-${Date.now()}`,
      type: 'unsubscribe',
      topic,
      privateChannel: isPrivateChannel,
      response: true,
    }));
    this.subscriptions.delete(topic);
    this.loggerInstance.debug({ topic }, 'Unsubscribe enviado');
  }

  /** Verifica se tópico é de canal privado */
  private isPrivateTopic(topic: string): boolean {
    if (this.market === 'futures') {
      return topic.startsWith('/contractMarket/tradeOrders')
        || topic.startsWith('/contract/position')
        || topic === '/contract/positionAll'
        || topic === '/contractAccount/wallet'
        || topic === '/contractMarket/advancedOrders'
        || topic === '/contract/crossLeverage'
        || topic === '/contract/positionMarginEvent';
    }
    // spot
    return topic.startsWith('/margin/')
      || topic.startsWith('/spotMarket/tradeOrders')
      || topic === '/account/balance'
      || topic.startsWith('/margin/fundingBook');
  }

  // --------------------------------------------------------------------------
  // MÉTODOS PÚBLICOS DE SUBSCRIPTION (market-aware)
  // --------------------------------------------------------------------------

  /** Subscreve ao ticker de um símbolo */
  subscribeTicker(symbol: string): string {
    const topic = this.market === 'futures'
      ? `/contractMarket/tickerV2:${symbol}`
      : `/market/ticker:${symbol}`;
    this.sendSubscribeRaw(topic);
    return topic;
  }

  /** Subscreve ao order book de um símbolo */
  subscribeOrderBook(symbol: string, depth: 5 | 50): string {
    const topic = this.market === 'futures'
      ? `/contractMarket/level2Depth${depth}:${symbol}`
      : `/spotMarket/level2Depth${depth}:${symbol}`;
    this.sendSubscribeRaw(topic);
    return topic;
  }

  /** Subscreve a candles/klines de um símbolo */
  subscribeKlines(symbol: string, interval: string): string {
    const topic = this.market === 'futures'
      ? `/contractMarket/limitCandle:${symbol}_${interval}`
      : `/market/candles:${symbol}_${interval}`;
    this.sendSubscribeRaw(topic);
    return topic;
  }

  /** Subscreve a trades de um símbolo */
  subscribeTrades(symbol: string): string {
    const topic = this.market === 'futures'
      ? `/contractMarket/execution:${symbol}`
      : `/market/match:${symbol}`;
    this.sendSubscribeRaw(topic);
    return topic;
  }

  // -- Futures private --

  /** Subscreve a updates de ordens (privado) */
  subscribeOrders(): string {
    const topic = this.market === 'futures'
      ? '/contractMarket/tradeOrders'
      : '/spotMarket/tradeOrders';
    this.sendSubscribeRaw(topic);
    return topic;
  }

  /** Subscreve a updates de posição (privado, Futures) */
  subscribePosition(symbol: string): string {
    const topic = `/contract/position:${symbol}`;
    this.sendSubscribeRaw(topic);
    return topic;
  }

  /** Subscreve a todas as posições (privado, Futures) */
  subscribePositionAll(): string {
    const topic = '/contract/positionAll';
    this.sendSubscribeRaw(topic);
    return topic;
  }

  /** Subscreve a updates de balance (privado) */
  subscribeBalance(): string {
    const topic = this.market === 'futures'
      ? '/contractAccount/wallet'
      : '/account/balance';
    this.sendSubscribeRaw(topic);
    return topic;
  }

  /** Subscreve a stop orders / advanced orders (privado, Futures) */
  subscribeStopOrders(): string {
    const topic = '/contractMarket/advancedOrders';
    this.sendSubscribeRaw(topic);
    return topic;
  }

  /** Subscreve a funding rate (público, Futures) */
  subscribeFundingRate(symbol: string): string {
    const topic = `/contract/funding:${symbol}`;
    this.sendSubscribeRaw(topic);
    return topic;
  }

  /** Subscreve a mudanças de cross leverage (privado, Futures) */
  subscribeCrossLeverage(): string {
    const topic = '/contract/crossLeverage';
    this.sendSubscribeRaw(topic);
    return topic;
  }

  /** Subscreve a avisos de liquidação (privado, Futures) */
  subscribeLiquidationWarning(): string {
    const topic = '/contract/positionMarginEvent';
    this.sendSubscribeRaw(topic);
    return topic;
  }

  /** Subscreve a execution privada (fills) (privado, Futures) */
  subscribeExecution(): string {
    const topic = '/contractMarket/tradeOrders/v2';
    this.sendSubscribeRaw(topic);
    return topic;
  }

  // -- Spot/Margin private --

  /** Subscreve a posição de margem (privado, Spot/Margin) */
  subscribeMarginPosition(mode: 'cross' | 'isolated', symbol?: string): string {
    const topic = mode === 'cross'
      ? '/margin/position'
      : `/margin/isolatedPosition:${(symbol ?? '').toUpperCase()}`;
    this.sendSubscribeRaw(topic);
    return topic;
  }

  /** Subscreve a debt ratio (privado, Spot/Margin) */
  subscribeDebtRatio(): string {
    const topic = '/margin/fundingBook';
    this.sendSubscribeRaw(topic);
    return topic;
  }

  // --------------------------------------------------------------------------
  // Unsubscribe
  // --------------------------------------------------------------------------

  unsubscribeTicker(symbol: string): void {
    const topic = this.market === 'futures'
      ? `/contractMarket/tickerV2:${symbol}`
      : `/market/ticker:${symbol}`;
    this.sendUnsubscribeRaw(topic);
  }

  unsubscribeOrderBook(symbol: string, depth: 5 | 50): void {
    const topic = this.market === 'futures'
      ? `/contractMarket/level2Depth${depth}:${symbol}`
      : `/spotMarket/level2Depth${depth}:${symbol}`;
    this.sendUnsubscribeRaw(topic);
  }

  unsubscribeKlines(symbol: string, interval: string): void {
    const topic = this.market === 'futures'
      ? `/contractMarket/limitCandle:${symbol}_${interval}`
      : `/market/candles:${symbol}_${interval}`;
    this.sendUnsubscribeRaw(topic);
  }

  unsubscribeTrades(symbol: string): void {
    const topic = this.market === 'futures'
      ? `/contractMarket/execution:${symbol}`
      : `/market/match:${symbol}`;
    this.sendUnsubscribeRaw(topic);
  }

  unsubscribePosition(symbol: string): void {
    this.sendUnsubscribeRaw(`/contract/position:${symbol}`);
  }

  unsubscribePositionAll(): void {
    this.sendUnsubscribeRaw('/contract/positionAll');
  }

  unsubscribeExecution(): void {
    this.sendUnsubscribeRaw('/contractMarket/tradeOrders/v2');
  }

  unsubscribe(topic: string): void {
    this.sendUnsubscribeRaw(topic);
  }

  // --------------------------------------------------------------------------
  // Ordens via WebSocket (baixa latência)
  // --------------------------------------------------------------------------

  /** Cria ordem via WebSocket (baixa latência) */
  wsPlaceOrder(params: {
    clientOid: string;
    side: 'buy' | 'sell';
    symbol: string;
    leverage?: number;
    type?: 'limit' | 'market';
    price?: string;
    size?: number | string;
    funds?: string;
    timeInForce?: string;
    postOnly?: boolean;
    hidden?: boolean;
    iceberg?: boolean;
    visibleSize?: number | string;
    reduceOnly?: boolean;
    closeOrder?: boolean;
    forceHold?: boolean;
    marginMode?: string;
    cancelAfter?: number;
  }): void {
    if (!this.isPrivate || !this.isConnected()) {
      this.loggerInstance.warn('wsPlaceOrder requer conexão privada ativa');
      return;
    }
    const orderTopic = this.market === 'futures'
      ? '/contractMarket/tradeOrders'
      : '/spotMarket/tradeOrders';
    const id = `ws-order-${Date.now()}`;
    this.ws!.send(JSON.stringify({
      id,
      type: 'openTrade',
      topic: orderTopic,
      data: params,
      response: true,
      privateChannel: true,
    }));
    this.loggerInstance.info({ id, clientOid: params.clientOid, symbol: params.symbol, side: params.side }, 'Ordem WS enviada');
  }

  /** Cancela ordem via WebSocket (baixa latência) */
  wsCancelOrder(orderId: string): void {
    if (!this.isPrivate || !this.isConnected()) return;
    const orderTopic = this.market === 'futures'
      ? '/contractMarket/tradeOrders'
      : '/spotMarket/tradeOrders';
    const id = `ws-cancel-${Date.now()}`;
    this.ws!.send(JSON.stringify({
      id,
      type: 'cancelTrade',
      topic: orderTopic,
      data: { orderId },
      response: true,
      privateChannel: true,
    }));
    this.loggerInstance.info({ id, orderId }, 'Cancelamento WS enviado');
  }

  /** Cancela ordem por clientOid via WebSocket */
  wsCancelOrderByClientOid(clientOid: string, symbol: string): void {
    if (!this.isPrivate || !this.isConnected()) return;
    const orderTopic = this.market === 'futures'
      ? '/contractMarket/tradeOrders'
      : '/spotMarket/tradeOrders';
    const id = `ws-cancel-coid-${Date.now()}`;
    this.ws!.send(JSON.stringify({
      id,
      type: 'cancelTrade',
      topic: orderTopic,
      data: { clientOid, symbol },
      response: true,
      privateChannel: true,
    }));
    this.loggerInstance.info({ id, clientOid, symbol }, 'Cancelamento WS por clientOid enviado');
  }

  // --------------------------------------------------------------------------
  // Estado e utilidades
  // --------------------------------------------------------------------------

  getState(): ConnectionState { return this.state; }
  getMarket(): MarketDomain { return this.market; }
  isConnected(): boolean {
    return this.state === 'connected' && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
  getSubscriptions(): string[] { return Array.from(this.subscriptions); }

  /** Desconecta do WebSocket */
  disconnect(): void {
    this.loggerInstance.info('Desconectando WebSocket KuCoin');
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close(1000, 'Client disconnect');
    }
    this.cleanup();
    this.subscriptions.clear();
    this.setState('disconnected');
  }
}

// ============================================================================
// SINGLETONS — Interface compatível com código existente
// ============================================================================

// --- Futures ---
let futuresPublicClient: KucoinUnifiedWSClient | null = null;
let futuresPrivateClient: KucoinUnifiedWSClient | null = null;

/** Obtém cliente WebSocket Futures público (singleton) */
export function getPublicWebSocketClient(): KucoinUnifiedWSClient {
  if (!futuresPublicClient) {
    futuresPublicClient = new KucoinUnifiedWSClient('futures');
  }
  return futuresPublicClient;
}

/** Obtém cliente WebSocket Futures privado (singleton) */
export function getPrivateWebSocketClient(): KucoinUnifiedWSClient {
  if (!futuresPrivateClient) {
    futuresPrivateClient = new KucoinUnifiedWSClient('futures');
  }
  return futuresPrivateClient;
}

/** Verifica se WebSocket tem credenciais disponíveis */
export function isWebSocketConfigured(): boolean {
  return !!(KUCOIN_PRO_API_KEY && KUCOIN_PRO_API_SECRET && KUCOIN_PRO_API_PASSPHRASE);
}

/** Inicializa clientes WebSocket Futures */
export async function initializeWebSocketClients(): Promise<void> {
  const logger = createLogger('kucoin-ws-futures');
  logger.info('Inicializando clientes WebSocket KuCoin Futures');

  try {
    const publicWs = getPublicWebSocketClient();
    await publicWs.connect(false);
    logger.info('Cliente WebSocket Futures público conectado');

    if (isWebSocketConfigured()) {
      const privateWs = getPrivateWebSocketClient();
      await privateWs.connect(true);
      logger.info('Cliente WebSocket Futures privado conectado');
    } else {
      logger.warn('Credenciais KuCoin não configuradas - cliente privado não inicializado');
    }
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Erro ao inicializar WebSocket Futures');
    throw error;
  }
}

/** Encerra clientes WebSocket Futures */
export function closeWebSocketClients(): void {
  if (futuresPublicClient) { futuresPublicClient.disconnect(); futuresPublicClient = null; }
  if (futuresPrivateClient) { futuresPrivateClient.disconnect(); futuresPrivateClient = null; }
}

// --- Spot/Margin ---
let spotPublicClient: KucoinUnifiedWSClient | null = null;
let spotPrivateClient: KucoinUnifiedWSClient | null = null;

/** Obtém cliente WebSocket Spot/Margin público (singleton) */
export function getSpotPublicWebSocketClient(): KucoinUnifiedWSClient {
  if (!spotPublicClient) {
    spotPublicClient = new KucoinUnifiedWSClient('spot');
  }
  return spotPublicClient;
}

/** Obtém cliente WebSocket Spot/Margin privado (singleton) */
export function getSpotPrivateWebSocketClient(): KucoinUnifiedWSClient {
  if (!spotPrivateClient) {
    spotPrivateClient = new KucoinUnifiedWSClient('spot');
  }
  return spotPrivateClient;
}

/** Verifica se WebSocket Spot tem credenciais (mesmas credenciais de Futures) */
export function isSpotWebSocketConfigured(): boolean {
  return isWebSocketConfigured();
}

/** Inicializa clientes WebSocket Spot/Margin */
export async function initializeSpotWebSocketClients(): Promise<void> {
  const logger = createLogger('kucoin-ws-spot');
  logger.info('Inicializando clientes WebSocket KuCoin Spot/Margin');

  try {
    const publicWs = getSpotPublicWebSocketClient();
    await publicWs.connect(false);
    logger.info('Cliente WebSocket Spot público conectado');

    if (isSpotWebSocketConfigured()) {
      const privateWs = getSpotPrivateWebSocketClient();
      await privateWs.connect(true);
      logger.info('Cliente WebSocket Spot/Margin privado conectado');
    } else {
      logger.warn('Credenciais KuCoin não configuradas - WS Spot/Margin privado não inicializado');
    }
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Erro ao inicializar WS Spot/Margin');
    throw error;
  }
}

/** Encerra clientes WebSocket Spot/Margin */
export function closeSpotWebSocketClients(): void {
  if (spotPublicClient) { spotPublicClient.disconnect(); spotPublicClient = null; }
  if (spotPrivateClient) { spotPrivateClient.disconnect(); spotPrivateClient = null; }
}

// Re-exportar tipos para compatibilidade com imports existentes
// (aliases para manter backward compatibility com nomes do kucoinWebSocket.ts)
export type TickerData = FuturesTickerData;
export type OrderBookData = FuturesOrderBookData;
export type KlineData = FuturesKlineData;
export type TradeData = FuturesTradeData;

export default {
  KucoinUnifiedWSClient,
  buildSpotMarketTopic,
  getPublicWebSocketClient,
  getPrivateWebSocketClient,
  isWebSocketConfigured,
  initializeWebSocketClients,
  closeWebSocketClients,
  getSpotPublicWebSocketClient,
  getSpotPrivateWebSocketClient,
  isSpotWebSocketConfigured,
  initializeSpotWebSocketClients,
  closeSpotWebSocketClients,
};
