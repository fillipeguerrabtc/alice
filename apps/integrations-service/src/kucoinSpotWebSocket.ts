/**
 * KuCoin Spot/Margin WebSocket Client - Alice Enterprise Platform
 *
 * Cliente WebSocket enterprise-grade para dados de mercado Spot/Margin.
 * Baseado na documentação oficial (Classic WS):
 * - https://www.kucoin.com/docs-new/websocket-api/base-info/get-public-token-spot-margin
 * - https://www.kucoin.com/docs-new/3470063w0 (Ticker)
 * - https://www.kucoin.com/docs-new/3470070w0 (Orderbook L50)
 * - https://www.kucoin.com/docs-new/3470069w0 (Orderbook L5)
 * - https://www.kucoin.com/docs-new/3470071w0 (Klines)
 * - https://www.kucoin.com/docs-new/3470072w0 (Trades)
 * - https://www.kucoin.com/docs-new/3470078w0 (Cross Margin Position)
 * - https://www.kucoin.com/docs-new/3470079w0 (Isolated Margin Position)
 *
 * Regra 6 - SEM MOCKS: Conexão real com KuCoin Spot/Margin API
 * Regra 8 - TypeScript strict, zero any
 * Regra 16 - Resiliência com reconnect automático
 *
 * Autor: Fillipe Guerra
 * Data: 02 de Fevereiro de 2026
 */

import WebSocket from 'ws';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createLogger } from '@alice/logger';
import { getKucoinAuthHeaders } from './kucoinRequest.js';

const logger = createLogger('kucoin-spot-websocket');

// ============================================================================
// CONFIGURAÇÃO (via variáveis de ambiente - Regra 6: sem hardcoded)
// ============================================================================
const KUCOIN_SPOT_BASE_URL = process.env.KUCOIN_SPOT_BASE_URL || 'https://api.kucoin.com';
const KUCOIN_PRO_API_KEY = process.env.KUCOIN_PRO_API_KEY;
const KUCOIN_PRO_API_SECRET = process.env.KUCOIN_PRO_API_SECRET;
const KUCOIN_PRO_API_PASSPHRASE = process.env.KUCOIN_PRO_API_PASSPHRASE;

// ============================================================================
// TIPOS (TypeScript strict - Regra 8)
// ============================================================================
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

/** Update de ordem Spot/Margin privada */
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

/** Update de balance Spot/Margin privada */
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

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface KucoinSpotWSEvents {
  'ticker': (data: SpotTickerData, topic: string) => void;
  'orderbook': (data: SpotOrderBookData, topic: string) => void;
  'kline': (data: SpotKlineData & { interval?: string }, topic: string) => void;
  'trade': (data: SpotTradeData, topic: string) => void;
  'marginPosition': (data: MarginPositionData, topic: string) => void;
  'order': (data: SpotOrderUpdateData, topic: string) => void;
  'balance': (data: SpotBalanceUpdateData, topic: string) => void;
  'connected': () => void;
  'disconnected': (reason: string) => void;
  'error': (error: Error) => void;
  'stateChange': (state: ConnectionState) => void;
}

// ============================================================================
// HELPERS
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

function extractIntervalFromTopic(topic: string): string | undefined {
  const parts = topic.split('_');
  if (parts.length < 2) return undefined;
  return parts[1];
}

// ============================================================================
// CLASSE PRINCIPAL: KuCoin Spot/Margin WebSocket Client
// ============================================================================
export class KucoinSpotWebSocketClient extends EventEmitter {
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
  private maxReconnectAttempts: number = 10;
  private isPrivate: boolean = false;

  constructor() {
    super();
  }

  private async getToken(isPrivate: boolean): Promise<BulletResponse> {
    const endpoint = isPrivate ? '/api/v1/bullet-private' : '/api/v1/bullet-public';
    const url = `${KUCOIN_SPOT_BASE_URL}${endpoint}`;
    const headers: Record<string, string> = isPrivate
      ? await getKucoinAuthHeaders({
          baseUrl: KUCOIN_SPOT_BASE_URL,
          method: 'POST',
          endpoint,
        })
      : { 'Content-Type': 'application/json' };

    logger.debug({ isPrivate, endpoint }, 'Obtendo token WebSocket Spot/Margin');

    const response = await fetch(url, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, body: errorBody }, 'Erro ao obter token WebSocket Spot/Margin');
      throw new Error(`Falha ao obter token WS Spot/Margin: ${response.status} - ${errorBody}`);
    }

    const data = await response.json() as BulletResponse;
    if (data.code !== '200000') {
      throw new Error(`Erro na API KuCoin (Spot/Margin): ${data.code}`);
    }
    return data;
  }

  async connect(isPrivate: boolean): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') return;
    this.isPrivate = isPrivate;
    this.setState('connecting');

    try {
      const bulletData = await this.getToken(isPrivate);
      if (!bulletData.data.instanceServers?.length) {
        throw new Error('Nenhum servidor WS disponível (Spot/Margin)');
      }
      this.token = bulletData.data.token;
      const instance = bulletData.data.instanceServers[0];
      this.endpoint = instance.endpoint;
      this.pingInterval = instance.pingInterval;
      this.pingTimeout = instance.pingTimeout;
      this.connectId = `alice-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

      const wsUrl = `${this.endpoint}?token=${this.token}&connectId=${this.connectId}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.setState('connected');
        this.reconnectAttempts = 0;
        this.emit('connected');
        this.startPing();
        this.scheduleTokenRefresh();
        this.resubscribeAll();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', (code, reason) => {
        const message = `Conexão WS Spot/Margin encerrada: ${code} - ${reason.toString()}`;
        logger.warn(message);
        this.emit('disconnected', message);
        this.cleanupConnection();
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        this.handleConnectionError(err);
      });
    } catch (error) {
      this.setState('disconnected');
      throw error;
    }
  }

  disconnect(): void {
    this.cleanupConnection();
    this.setState('disconnected');
  }

  isConnected(): boolean {
    return this.state === 'connected';
  }

  getState(): ConnectionState {
    return this.state;
  }

  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }

  subscribeTicker(symbol: string): string {
    const topic = buildSpotMarketTopic({ channel: 'ticker', symbol });
    this.sendSubscribe(topic, false);
    return topic;
  }

  subscribeOrderBook(symbol: string, depth: 5 | 50): string {
    const topic = buildSpotMarketTopic({ channel: 'orderbook', symbol, depth });
    this.sendSubscribe(topic, false);
    return topic;
  }

  subscribeKlines(symbol: string, interval: string): string {
    const topic = buildSpotMarketTopic({ channel: 'klines', symbol, interval });
    this.sendSubscribe(topic, false);
    return topic;
  }

  subscribeTrades(symbol: string): string {
    const topic = buildSpotMarketTopic({ channel: 'trades', symbol });
    this.sendSubscribe(topic, false);
    return topic;
  }

  subscribeMarginPosition(mode: 'cross' | 'isolated', symbol?: string): string {
    const topic = mode === 'cross'
      ? '/margin/position'
      : `/margin/isolatedPosition:${(symbol ?? '').toUpperCase()}`;
    this.sendSubscribe(topic, true);
    return topic;
  }

  /**
   * Subscreve a updates de ordens Spot/Margin (privado)
   * Canal: /spotMarket/tradeOrders
   */
  subscribeOrders(): string {
    const topic = '/spotMarket/tradeOrders';
    this.sendSubscribe(topic, true);
    return topic;
  }

  /**
   * Subscreve a updates de ordens Spot/Margin por símbolo (privado)
   * Canal: /spotMarket/tradeOrdersV2
   */
  subscribeOrdersV2(): string {
    const topic = '/spotMarket/tradeOrdersV2';
    this.sendSubscribe(topic, true);
    return topic;
  }

  /**
   * Subscreve a updates de balance Spot/Margin (privado)
   * Canal: /account/balance
   */
  subscribeBalance(): string {
    const topic = '/account/balance';
    this.sendSubscribe(topic, true);
    return topic;
  }

  /**
   * Subscreve a updates de debt ratio (margin cross) (privado)
   * Canal: /margin/fundingBook
   * Entrega notificações de mudança no debt ratio
   */
  subscribeDebtRatio(): string {
    const topic = '/margin/fundingBook';
    this.sendSubscribe(topic, true);
    return topic;
  }

  unsubscribe(topic: string, isPrivate: boolean): void {
    this.sendUnsubscribe(topic, isPrivate);
  }

  // ============================================================================
  // ORDENS VIA WEBSOCKET (baixa latência - Spot/Margin)
  // ============================================================================

  /**
   * Cria ordem Spot via WebSocket (baixa latência)
   * Envia mensagem tipo 'openTrade' diretamente pelo WS
   * Ref: KuCoin Spot WebSocket Trade API
   */
  wsPlaceOrder(params: {
    clientOid: string;
    side: 'buy' | 'sell';
    symbol: string;
    type?: 'limit' | 'market';
    price?: string;
    size?: string;
    funds?: string;
    timeInForce?: string;
    postOnly?: boolean;
    hidden?: boolean;
    iceberg?: boolean;
    visibleSize?: string;
    cancelAfter?: number;
  }): void {
    if (!this.ws || this.state !== 'connected') {
      logger.warn('WebSocket Spot não conectado - wsPlaceOrder bloqueado');
      return;
    }
    const id = `ws-spot-order-${Date.now()}`;
    const msg = {
      id,
      type: 'openTrade',
      topic: '/spotMarket/tradeOrders',
      data: params,
      response: true,
      privateChannel: true,
    };
    this.ws.send(JSON.stringify(msg));
    logger.info({ id, clientOid: params.clientOid, symbol: params.symbol, side: params.side }, 'Ordem Spot WS enviada');
  }

  /**
   * Cancela ordem Spot via WebSocket (baixa latência)
   * Envia mensagem tipo 'cancelTrade' diretamente pelo WS
   * Ref: KuCoin Spot WebSocket Trade API
   */
  wsCancelOrder(orderId: string): void {
    if (!this.ws || this.state !== 'connected') {
      logger.warn('WebSocket Spot não conectado - wsCancelOrder bloqueado');
      return;
    }
    const id = `ws-spot-cancel-${Date.now()}`;
    const msg = {
      id,
      type: 'cancelTrade',
      topic: '/spotMarket/tradeOrders',
      data: { orderId },
      response: true,
      privateChannel: true,
    };
    this.ws.send(JSON.stringify(msg));
    logger.info({ id, orderId }, 'Cancelamento Spot WS enviado');
  }

  /**
   * Cancela ordem Spot por clientOid via WebSocket (baixa latência)
   * Ref: KuCoin Spot WebSocket Trade API
   */
  wsCancelOrderByClientOid(clientOid: string, symbol: string): void {
    if (!this.ws || this.state !== 'connected') {
      logger.warn('WebSocket Spot não conectado - wsCancelOrderByClientOid bloqueado');
      return;
    }
    const id = `ws-spot-cancel-coid-${Date.now()}`;
    const msg = {
      id,
      type: 'cancelTrade',
      topic: '/spotMarket/tradeOrders',
      data: { clientOid, symbol },
      response: true,
      privateChannel: true,
    };
    this.ws.send(JSON.stringify(msg));
    logger.info({ id, clientOid, symbol }, 'Cancelamento Spot WS por clientOid enviado');
  }

  private handleMessage(raw: WebSocket.RawData): void {
    try {
      const message = JSON.parse(raw.toString()) as KucoinWSMessage;
      if (message.type === 'welcome') return;
      if (message.type === 'ack') return;
      if (message.type === 'pong') {
        this.clearPongTimer();
        return;
      }
      if (message.type !== 'message' || !message.topic) return;
      this.handleDataMessage(message);
    } catch (error) {
      logger.error({ error }, 'Erro ao processar mensagem WS Spot/Margin');
    }
  }

  private handleDataMessage(message: KucoinWSMessage): void {
    const topic = message.topic ?? '';
    const data = message.data;
    if (!data) return;

    if (topic.startsWith('/market/ticker:')) {
      if (isSpotTickerData(data)) {
        this.emit('ticker', data, topic);
      } else {
        logger.warn({ topic }, 'Payload inválido de ticker Spot/Margin');
      }
      return;
    }
    if (topic.startsWith('/spotMarket/level2Depth')) {
      if (isSpotOrderBookData(data)) {
        this.emit('orderbook', data, topic);
      } else {
        logger.warn({ topic }, 'Payload inválido de orderbook Spot/Margin');
      }
      return;
    }
    if (topic.startsWith('/market/candles:')) {
      const interval = extractIntervalFromTopic(topic);
      if (isSpotKlineData(data)) {
        this.emit('kline', { ...data, interval }, topic);
      } else {
        logger.warn({ topic }, 'Payload inválido de kline Spot/Margin');
      }
      return;
    }
    if (topic.startsWith('/market/match:')) {
      if (isSpotTradeData(data)) {
        this.emit('trade', data, topic);
      } else {
        logger.warn({ topic }, 'Payload inválido de trade Spot/Margin');
      }
      return;
    }
    if (topic.startsWith('/margin/position') || topic.startsWith('/margin/isolatedPosition')) {
      if (isRecord(data)) {
        this.emit('marginPosition', data as MarginPositionData, topic);
      } else {
        logger.warn({ topic }, 'Payload inválido de posição Margin');
      }
      return;
    }

    // Ordens Spot/Margin: /spotMarket/tradeOrders ou /spotMarket/tradeOrdersV2
    if (topic.startsWith('/spotMarket/tradeOrders')) {
      if (isRecord(data)) {
        this.emit('order', data as unknown as SpotOrderUpdateData, topic);
      } else {
        logger.warn({ topic }, 'Payload inválido de ordem Spot/Margin');
      }
      return;
    }

    // Balance Spot/Margin: /account/balance
    if (topic === '/account/balance') {
      if (isRecord(data)) {
        this.emit('balance', data as unknown as SpotBalanceUpdateData, topic);
      } else {
        logger.warn({ topic }, 'Payload inválido de balance Spot/Margin');
      }
      return;
    }

    logger.debug({ topic }, 'Tópico WS Spot/Margin não mapeado');
  }

  private sendSubscribe(topic: string, isPrivate: boolean, isResubscribe: boolean = false): void {
    if (!this.ws || this.state !== 'connected') return;
    if (!isResubscribe && this.subscriptions.has(topic)) return;

    if (!isResubscribe) {
      this.subscriptions.add(topic);
    }
    const payload = {
      id: Date.now().toString(),
      type: 'subscribe',
      topic,
      response: true,
      privateChannel: isPrivate,
    };
    this.ws.send(JSON.stringify(payload));
  }

  private sendUnsubscribe(topic: string, isPrivate: boolean): void {
    if (!this.ws || this.state !== 'connected') return;
    if (!this.subscriptions.has(topic)) return;

    this.subscriptions.delete(topic);
    const payload = {
      id: Date.now().toString(),
      type: 'unsubscribe',
      topic,
      response: true,
      privateChannel: isPrivate,
    };
    this.ws.send(JSON.stringify(payload));
  }

  private resubscribeAll(): void {
    this.subscriptions.forEach((topic) => {
      const isPrivateChannel = topic.startsWith('/margin/') ||
        topic.startsWith('/spotMarket/tradeOrders') ||
        topic === '/account/balance';
      this.sendSubscribe(topic, isPrivateChannel, true);
    });
  }

  private startPing(): void {
    this.clearPingTimer();
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.state !== 'connected') return;
      this.ws.send(JSON.stringify({ id: Date.now().toString(), type: 'ping' }));
      this.startPongTimer();
    }, this.pingInterval);
  }

  private startPongTimer(): void {
    this.clearPongTimer();
    this.pongTimer = setTimeout(() => {
      logger.warn('Pong timeout Spot/Margin - reconectando');
      this.cleanupConnection();
      this.scheduleReconnect();
    }, this.pingTimeout);
  }

  private clearPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearPongTimer(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Máximo de reconexões WS Spot/Margin atingido');
      return;
    }
    this.reconnectAttempts += 1;
    this.setState('reconnecting');
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    this.reconnectTimer = setTimeout(() => {
      void this.connect(this.isPrivate).catch((error) => {
        logger.error({ error }, 'Falha ao reconectar WS Spot/Margin');
      });
    }, delay);
  }

  private handleConnectionError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Erro WebSocket Spot/Margin');
    this.emit('error', error instanceof Error ? error : new Error(message));
    this.cleanupConnection();
    this.scheduleReconnect();
  }

  private scheduleTokenRefresh(): void {
    if (this.tokenRefreshTimer) clearTimeout(this.tokenRefreshTimer);
    this.tokenRefreshTimer = setTimeout(() => {
      void this.connect(this.isPrivate).catch((error) => {
        logger.error({ error }, 'Falha ao renovar token WS Spot/Margin');
      });
    }, 23 * 60 * 60 * 1000);
  }

  private cleanupConnection(): void {
    this.clearPingTimer();
    this.clearPongTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.token = null;
    this.endpoint = null;
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit('stateChange', state);
  }
}

let spotPublicClient: KucoinSpotWebSocketClient | null = null;
let spotPrivateClient: KucoinSpotWebSocketClient | null = null;

export function getSpotPublicWebSocketClient(): KucoinSpotWebSocketClient {
  if (!spotPublicClient) {
    spotPublicClient = new KucoinSpotWebSocketClient();
  }
  return spotPublicClient;
}

export function getSpotPrivateWebSocketClient(): KucoinSpotWebSocketClient {
  if (!spotPrivateClient) {
    spotPrivateClient = new KucoinSpotWebSocketClient();
  }
  return spotPrivateClient;
}

export function isSpotWebSocketConfigured(): boolean {
  return !!(KUCOIN_PRO_API_KEY && KUCOIN_PRO_API_SECRET && KUCOIN_PRO_API_PASSPHRASE);
}

export async function initializeSpotWebSocketClients(): Promise<void> {
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
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Erro ao inicializar WS Spot/Margin');
    throw error;
  }
}

export function closeSpotWebSocketClients(): void {
  logger.info('Encerrando clientes WebSocket KuCoin Spot/Margin');
  if (spotPublicClient) {
    spotPublicClient.disconnect();
    spotPublicClient = null;
  }
  if (spotPrivateClient) {
    spotPrivateClient.disconnect();
    spotPrivateClient = null;
  }
}

export default {
  KucoinSpotWebSocketClient,
  buildSpotMarketTopic,
  getSpotPublicWebSocketClient,
  getSpotPrivateWebSocketClient,
  isSpotWebSocketConfigured,
  initializeSpotWebSocketClients,
  closeSpotWebSocketClients,
};
