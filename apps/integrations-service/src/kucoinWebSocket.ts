/**
 * KuCoin Futures WebSocket Client - Alice Enterprise Platform
 * 
 * Cliente WebSocket enterprise-grade para dados de mercado em tempo real.
 * Baseado na documentação oficial: https://www.kucoin.com/docs/websocket/futures-trading
 * 
 * Funcionalidades:
 * - Obtenção automática de token via /api/v1/bullet-private e /api/v1/bullet-public
 * - Conexão WebSocket com reconnect automático
 * - Ping/Pong heartbeat (interval 18s, timeout 10s)
 * - Renovação de token antes de expirar (24h)
 * - Circuit breaker para resiliência
 * - Canais públicos: tickerV2, orderbook, klines (limitCandle), trades
 * - Canais privados: orders, positions, balances
 * 
 * Regra 6 - SEM MOCKS: Conexão real com KuCoin Futures API
 * Regra 8 - TypeScript strict, zero any
 * Regra 16 - Circuit breaker, health checks
 * 
 * Autor: Fillipe Guerra
 * Data: 17 de Dezembro de 2025
 */

import WebSocket from 'ws';
import crypto from 'node:crypto';
import { createLogger } from '@alice/logger';
import { EventEmitter } from 'node:events';
import { getKucoinAuthHeaders } from './kucoinRequest.js';

const logger = createLogger('kucoin-websocket');
const KUCOIN_WS_MAX_TOPICS = 400;

// ============================================================================
// CONFIGURAÇÃO (via variáveis de ambiente - Regra 6: sem hardcoded)
// ============================================================================

const KUCOIN_FUTURES_BASE_URL = process.env.KUCOIN_PRO_BASE_URL || 'https://api-futures.kucoin.com';
const KUCOIN_PRO_API_KEY = process.env.KUCOIN_PRO_API_KEY;
const KUCOIN_PRO_API_SECRET = process.env.KUCOIN_PRO_API_SECRET;
const KUCOIN_PRO_API_PASSPHRASE = process.env.KUCOIN_PRO_API_PASSPHRASE;
// ============================================================================
// TIPOS (TypeScript strict - Regra 8)
// ============================================================================

/** Resposta do endpoint bullet para obter token WebSocket */
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

/** Mensagem genérica do WebSocket KuCoin */
export interface KucoinWSMessage {
  type: string;
  topic?: string;
  subject?: string;
  data?: unknown;
  id?: string;
  code?: number;
}

/** Dados de ticker em tempo real */
export interface TickerData {
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

/** Dados de order book */
export interface OrderBookEntry {
  price: string;
  size: string;
  sequence: number;
}

export interface OrderBookData {
  symbol: string;
  sequence: number;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  timestamp: number;
}

interface RawOrderBookData {
  sequence: number;
  asks: Array<[string | number, string | number]>;
  bids: Array<[string | number, string | number]>;
  ts: number;
}

/** Dados de candle/kline */
export interface KlineData {
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

/** Dados de trade */
export interface TradeData {
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

/** Update de ordem privada */
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

/** Update de posição privada */
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

/** Update de balance privado */
export interface BalanceUpdateData {
  availableBalance: string;
  holdBalance: string;
  currency: string;
  timestamp: number;
}

/** Update de stop order privado (advanced orders) */
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

/** Dados de funding rate */
export interface FundingRateData {
  symbol: string;
  granularity: number;
  fundingRate: number;
  timestamp: number;
}

/** Update de cross-margin leverage (privado) */
export interface CrossLeverageUpdateData {
  symbol: string;
  currentLeverage: number;
  previousLeverage?: number;
  timestamp: number;
}

/** Aviso de liquidação (privado) */
export interface LiquidationWarningData {
  symbol: string;
  positionSide: string;
  markPrice: string;
  liquidationPrice: string;
  unrealisedPnl: string;
  maintenanceMargin: string;
  timestamp: number;
}

/** Dados de execution privada (fills pessoais) */
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

/** Estado da conexão WebSocket */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** Eventos emitidos pelo cliente WebSocket */
export interface KucoinWSEvents {
  'ticker': (data: TickerData) => void;
  'orderbook': (data: OrderBookData, symbol: string) => void;
  'kline': (data: KlineData) => void;
  'trade': (data: TradeData) => void;
  'order': (data: OrderUpdateData) => void;
  'position': (data: PositionUpdateData) => void;
  'balance': (data: BalanceUpdateData) => void;
  'stopOrder': (data: StopOrderUpdateData) => void;
  'fundingRate': (data: FundingRateData) => void;
  'crossLeverage': (data: CrossLeverageUpdateData) => void;
  'liquidationWarning': (data: LiquidationWarningData) => void;
  'execution': (data: ExecutionData) => void;
  'connected': () => void;
  'disconnected': (reason: string) => void;
  'error': (error: Error) => void;
  'stateChange': (state: ConnectionState) => void;
}

// ============================================================================
// CLASSE PRINCIPAL: KuCoin WebSocket Client
// ============================================================================

export class KucoinWebSocketClient extends EventEmitter {
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

  /**
   * Obtém token para conexão WebSocket
   * @param isPrivate - Se true, obtém token para canais privados (requer auth)
   */
  private async getToken(isPrivate: boolean): Promise<BulletResponse> {
    const baseUrl = KUCOIN_FUTURES_BASE_URL;
    const endpoint = isPrivate ? '/api/v1/bullet-private' : '/api/v1/bullet-public';
    const url = `${baseUrl}${endpoint}`;

    const headers: Record<string, string> = isPrivate
      ? await getKucoinAuthHeaders({
          baseUrl,
          method: 'POST',
          endpoint,
        })
      : { 'Content-Type': 'application/json' };

    logger.debug({ isPrivate, endpoint }, 'Obtendo token WebSocket');

    // CORREÇÃO AUDITORIA 17/12/2025: Adicionar timeout de 30s conforme best practices
    // Bug: fetch sem timeout pode travar indefinidamente se servidor não responder
    const response = await fetch(url, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(30000), // 30 segundos
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error({ status: response.status, body: errorBody }, 'Erro ao obter token WebSocket');
      throw new Error(`Falha ao obter token WebSocket: ${response.status} - ${errorBody}`);
    }

    const data = await response.json() as BulletResponse;

    if (data.code !== '200000') {
      throw new Error(`Erro na API KuCoin: ${data.code}`);
    }

    return data;
  }

  /**
   * Conecta ao WebSocket KuCoin
   * @param isPrivate - Se true, conecta a canais privados
   */
  async connect(isPrivate: boolean = false): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      logger.warn('WebSocket já está conectado ou conectando');
      return;
    }

    this.isPrivate = isPrivate;
    this.setState('connecting');

    try {
      // Obter token
      const bulletData = await this.getToken(isPrivate);
      this.token = bulletData.data.token;
      
      // CORREÇÃO AUDITORIA 17/12/2025: Validar instanceServers antes de acessar
      // Bug: Se array estiver vazio, server será undefined e causará erro ao acessar .endpoint
      if (!bulletData.data.instanceServers || bulletData.data.instanceServers.length === 0) {
        throw new Error('KuCoin WebSocket: Nenhum servidor disponível no bullet response');
      }
      const server = bulletData.data.instanceServers[0];
      this.endpoint = server.endpoint;
      this.pingInterval = server.pingInterval;
      this.pingTimeout = server.pingTimeout;

      // Gerar connect ID único
      this.connectId = `alice-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

      // Conectar ao WebSocket
      const wsUrl = `${this.endpoint}?token=${this.token}&connectId=${this.connectId}`;
      
      logger.info({ endpoint: this.endpoint, isPrivate }, 'Conectando ao WebSocket KuCoin');

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.onOpen();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.onMessage(data);
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        this.onClose(code, reason.toString());
      });

      this.ws.on('error', (error: Error) => {
        this.onError(error);
      });

      // Configurar refresh de token (24h - 1h de margem)
      this.scheduleTokenRefresh();

    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Erro ao conectar WebSocket');
      this.setState('disconnected');
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Handler para conexão aberta
   */
  private onOpen(): void {
    logger.info({ connectId: this.connectId }, 'WebSocket KuCoin conectado');
    this.setState('connected');
    this.reconnectAttempts = 0;
    this.startPing();
    this.emit('connected');

    // Resubscrever após reconexão
    if (this.subscriptions.size > 0) {
      logger.info({ count: this.subscriptions.size }, 'Resubscrevendo canais após reconexão');
      for (const topic of this.subscriptions) {
        this.sendSubscribe(topic, true);
      }
    }
  }

  /**
   * Handler para mensagens recebidas
   */
  private onMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString()) as KucoinWSMessage;

      // Pong recebido
      if (message.type === 'pong') {
        this.onPong();
        return;
      }

      // Welcome message
      if (message.type === 'welcome') {
        logger.debug({ id: message.id }, 'Welcome message recebida');
        return;
      }

      // Ack de subscription
      if (message.type === 'ack') {
        logger.debug({ id: message.id }, 'Subscription acknowledged');
        return;
      }

      // Mensagem de dados
      if (message.type === 'message' && message.topic && message.data) {
        this.handleDataMessage(message);
      }

    } catch (error) {
      logger.error({ error: (error as Error).message, data: data.toString() }, 'Erro ao processar mensagem');
    }
  }

  /**
   * Processa mensagens de dados
   */
  private handleDataMessage(message: KucoinWSMessage): void {
    const topic = message.topic || '';
    const subject = message.subject || '';
    const data = message.data;

    // Ticker: /contractMarket/tickerV2:{symbol}
    if (topic.startsWith('/contractMarket/tickerV2:')) {
      this.emit('ticker', data as TickerData);
      return;
    }

    // Order Book: /contractMarket/level2Depth50:{symbol}
    if (topic.startsWith('/contractMarket/level2Depth50:') || topic.startsWith('/contractMarket/level2Depth5:')) {
      const symbol = topic.split(':')[1];
      const raw = data as RawOrderBookData;
      const normalizeEntry = ([price, size]: [string | number, string | number]): OrderBookEntry => ({
        price: String(price),
        size: String(size),
        sequence: raw.sequence,
      });
      const normalized: OrderBookData = {
        symbol,
        sequence: raw.sequence,
        bids: Array.isArray(raw.bids) ? raw.bids.map(normalizeEntry) : [],
        asks: Array.isArray(raw.asks) ? raw.asks.map(normalizeEntry) : [],
        timestamp: raw.ts,
      };
      this.emit('orderbook', normalized, symbol);
      return;
    }

    // Kline: /contractMarket/limitCandle:{symbol}_{interval}
    if (topic.startsWith('/contractMarket/limitCandle:')) {
      const rawTopic = topic.split(':')[1] || '';
      const [symbolFromTopic, intervalFromTopic] = rawTopic.split('_');
      const payload = data as KlineData;
      const enriched: KlineData = {
        ...payload,
        symbol: payload.symbol || symbolFromTopic,
        interval: payload.interval || intervalFromTopic,
      };
      this.emit('kline', enriched);
      return;
    }

    // Trade: /contractMarket/execution:{symbol}
    if (topic.startsWith('/contractMarket/execution:')) {
      this.emit('trade', data as TradeData);
      return;
    }

    // Ordens privadas: /contractMarket/tradeOrders (all) ou /contractMarket/tradeOrders:{symbol}
    if (
      topic.startsWith('/contractMarket/tradeOrders') &&
      (subject === 'orderChange' || subject === 'symbolOrderChange')
    ) {
      this.emit('order', data as OrderUpdateData);
      return;
    }

    // Posições privadas: /contract/position:{symbol}
    if (topic.startsWith('/contract/position:')) {
      this.emit('position', data as PositionUpdateData);
      return;
    }

    // Posições privadas: /contract/positionAll
    if (topic === '/contract/positionAll') {
      this.emit('position', data as PositionUpdateData);
      return;
    }

    // Balance: /contractAccount/wallet
    if (topic === '/contractAccount/wallet') {
      this.emit('balance', data as BalanceUpdateData);
      return;
    }

    // Stop Orders (Advanced Orders): /contractMarket/advancedOrders
    if (topic === '/contractMarket/advancedOrders') {
      this.emit('stopOrder', data as StopOrderUpdateData);
      return;
    }

    // Funding Rate: /contract/funding:{symbol}
    if (topic.startsWith('/contract/funding:')) {
      this.emit('fundingRate', data as FundingRateData);
      return;
    }

    // Cross Leverage Change: /contract/crossLeverage (privado)
    if (topic === '/contract/crossLeverage') {
      this.emit('crossLeverage', data as CrossLeverageUpdateData);
      return;
    }

    // Aviso de Liquidação: /contract/positionMarginEvent (privado)
    if (topic === '/contract/positionMarginEvent') {
      this.emit('liquidationWarning', data as LiquidationWarningData);
      return;
    }

    // Execution privada (fills pessoais): /contractMarket/tradeOrders/v2 (privado)
    // Canal que entrega fills individuais do usuário autenticado
    if (topic.startsWith('/contractMarket/tradeOrders/v2') && subject === 'match') {
      this.emit('execution', data as unknown as ExecutionData);
      return;
    }

    logger.debug({ topic, subject }, 'Mensagem de tópico não mapeado');
  }

  /**
   * Handler para conexão fechada
   */
  private onClose(code: number, reason: string): void {
    logger.warn({ code, reason }, 'WebSocket KuCoin desconectado');
    this.cleanup();
    this.emit('disconnected', reason);

    // Reconnect automático
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    } else {
      logger.error('Máximo de tentativas de reconexão atingido');
      this.setState('disconnected');
    }
  }

  /**
   * Handler para erros
   */
  private onError(error: Error): void {
    logger.error({ error: error.message }, 'Erro no WebSocket KuCoin');
    this.emit('error', error);
  }

  /**
   * Inicia ping periódico
   * 
   * CORREÇÃO AUDITORIA 17/12/2025: Verifica se pingTimer já existe antes de criar novo
   * Bug: Se startPing() for chamado múltiplas vezes (ex: em refatoração), cria múltiplos
   * intervalos e apenas o último é referenciado, causando memory leak e ping duplicados
   */
  private startPing(): void {
    // Limpar interval existente para evitar duplicatas
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const pingId = `ping-${Date.now()}`;
        this.ws.send(JSON.stringify({ id: pingId, type: 'ping' }));

        // Timeout para pong
        this.pongTimer = setTimeout(() => {
          logger.warn('Pong timeout - reconectando');
          this.ws?.close();
        }, this.pingTimeout);
      }
    }, this.pingInterval);
  }

  /**
   * Handler para pong recebido
   */
  private onPong(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  /**
   * Agenda refresh do token
   */
  private scheduleTokenRefresh(): void {
    // Refresh 1 hora antes de expirar (23 horas)
    const refreshInterval = 23 * 60 * 60 * 1000;
    this.tokenRefreshTimer = setTimeout(async () => {
      logger.info('Renovando token WebSocket');
      try {
        const bulletData = await this.getToken(this.isPrivate);
        this.token = bulletData.data.token;
        logger.info('Token WebSocket renovado com sucesso');
        this.scheduleTokenRefresh();
      } catch (error) {
        logger.error({ error: (error as Error).message }, 'Erro ao renovar token - reconectando');
        this.ws?.close();
      }
    }, refreshInterval);
  }

  /**
   * Agenda reconexão
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    logger.info({ attempt: this.reconnectAttempts, delay }, 'Agendando reconexão');
    this.setState('reconnecting');

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect(this.isPrivate);
      } catch (error) {
        logger.error({ error: (error as Error).message }, 'Falha na reconexão');
      }
    }, delay);
  }

  /**
   * Atualiza estado da conexão
   */
  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.emit('stateChange', state);
      logger.debug({ state }, 'Estado da conexão alterado');
    }
  }

  /**
   * Limpa recursos
   */
  private cleanup(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws = null;
  }

  /**
   * Envia mensagem de subscribe
   */
  private sendSubscribe(topic: string, isResubscribe: boolean = false): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn({ topic }, 'WebSocket não conectado - subscribe pendente');
      return;
    }

    if (!isResubscribe && this.subscriptions.has(topic)) {
      logger.debug({ topic }, 'Subscribe ignorado - tópico já inscrito');
      return;
    }

    if (!isResubscribe && this.subscriptions.size >= KUCOIN_WS_MAX_TOPICS) {
      logger.warn({
        topic,
        total: this.subscriptions.size,
        limit: KUCOIN_WS_MAX_TOPICS,
      }, 'Limite de tópicos WS atingido - subscribe bloqueado');
      return;
    }

    const message = {
      id: `sub-${Date.now()}`,
      type: 'subscribe',
      topic,
      privateChannel: this.isPrivate,
      response: true,
    };

    this.ws.send(JSON.stringify(message));
    
    if (!isResubscribe) {
      this.subscriptions.add(topic);
    }
    
    logger.debug({ topic }, 'Subscribe enviado');
  }

  /**
   * Envia mensagem de unsubscribe
   */
  private sendUnsubscribe(topic: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = {
      id: `unsub-${Date.now()}`,
      type: 'unsubscribe',
      topic,
      privateChannel: this.isPrivate,
      response: true,
    };

    this.ws.send(JSON.stringify(message));
    this.subscriptions.delete(topic);
    logger.debug({ topic }, 'Unsubscribe enviado');
  }

  // ============================================================================
  // MÉTODOS PÚBLICOS DE SUBSCRIPTION
  // ============================================================================

  /**
   * Subscreve ao ticker de um símbolo
   */
  subscribeTicker(symbol: string): void {
    this.sendSubscribe(`/contractMarket/tickerV2:${symbol}`);
  }

  /**
   * Subscreve ao order book de um símbolo
   * @param symbol - Símbolo (ex: SYMBOL)
   * @param depth - Profundidade (5 ou 50)
   */
  subscribeOrderBook(symbol: string, depth: 5 | 50): void {
    this.sendSubscribe(`/contractMarket/level2Depth${depth}:${symbol}`);
  }

  /**
   * Subscreve a candles/klines de um símbolo
   * @param symbol - Símbolo (ex: SYMBOL)
   * @param interval - Intervalo (1min, 3min, 5min, 15min, 30min, 1hour, 2hour, 4hour, 8hour, 12hour, 1day, 1week)
   */
  subscribeKlines(symbol: string, interval: string): void {
    this.sendSubscribe(`/contractMarket/limitCandle:${symbol}_${interval}`);
  }

  /**
   * Subscreve a trades de um símbolo
   */
  subscribeTrades(symbol: string): void {
    this.sendSubscribe(`/contractMarket/execution:${symbol}`);
  }

  /**
   * Subscreve a updates de ordens (privado)
   */
  subscribeOrders(): void {
    if (!this.isPrivate) {
      logger.warn('Tentativa de subscription privada em conexão pública');
      return;
    }
    this.sendSubscribe('/contractMarket/tradeOrders');
  }

  /**
   * Subscreve a updates de posição (privado)
   */
  subscribePosition(symbol: string): void {
    if (!this.isPrivate) {
      logger.warn('Tentativa de subscription privada em conexão pública');
      return;
    }
    this.sendSubscribe(`/contract/position:${symbol}`);
  }

  /**
   * Subscreve a updates de posição de todos os símbolos (privado)
   */
  subscribePositionAll(): void {
    if (!this.isPrivate) {
      logger.warn('Tentativa de subscription privada em conexão pública');
      return;
    }
    this.sendSubscribe('/contract/positionAll');
  }

  /**
   * Subscreve a updates de balance (privado)
   */
  subscribeBalance(): void {
    if (!this.isPrivate) {
      logger.warn('Tentativa de subscription privada em conexão pública');
      return;
    }
    this.sendSubscribe('/contractAccount/wallet');
  }

  /**
   * Subscreve a updates de stop orders / advanced orders (privado)
   * Recebe notificações de lifecycle de stop orders (criação, trigger, cancelamento)
   */
  subscribeStopOrders(): void {
    if (!this.isPrivate) {
      logger.warn('Tentativa de subscription privada em conexão pública');
      return;
    }
    this.sendSubscribe('/contractMarket/advancedOrders');
  }

  /**
   * Subscreve a funding rate de um símbolo (público)
   * Recebe notificações de taxa de financiamento a cada 8 horas
   */
  subscribeFundingRate(symbol: string): void {
    this.sendSubscribe(`/contract/funding:${symbol}`);
  }

  /**
   * Subscreve a mudanças de cross leverage (privado)
   * Canal: /contract/crossLeverage
   */
  subscribeCrossLeverage(): void {
    this.sendSubscribe('/contract/crossLeverage', true);
  }

  /**
   * Subscreve a avisos de liquidação / margin events (privado)
   * Canal: /contract/positionMarginEvent
   */
  subscribeLiquidationWarning(): void {
    this.sendSubscribe('/contract/positionMarginEvent', true);
  }

  /**
   * Subscreve a execution privada (fills pessoais) (privado)
   * Canal: /contractMarket/tradeOrders/v2
   * Entrega fills individuais do usuário autenticado em tempo real
   */
  subscribeExecution(): void {
    if (!this.isPrivate) {
      logger.warn('Tentativa de subscription privada em conexão pública');
      return;
    }
    this.sendSubscribe('/contractMarket/tradeOrders/v2');
  }

  /**
   * Cancela subscription de execution privada
   */
  unsubscribeExecution(): void {
    this.sendUnsubscribe('/contractMarket/tradeOrders/v2');
  }

  // ============================================================================
  // ORDENS VIA WEBSOCKET (baixa latência)
  // ============================================================================

  /**
   * Cria ordem Futures via WebSocket (baixa latência)
   * Envia mensagem tipo 'openTrade' diretamente pelo WS
   * Ref: KuCoin Futures WebSocket Trade API
   */
  wsPlaceOrder(params: {
    clientOid: string;
    side: 'buy' | 'sell';
    symbol: string;
    leverage: number;
    type?: 'limit' | 'market';
    price?: string;
    size?: number;
    timeInForce?: string;
    postOnly?: boolean;
    hidden?: boolean;
    iceberg?: boolean;
    visibleSize?: number;
    reduceOnly?: boolean;
    closeOrder?: boolean;
    forceHold?: boolean;
    marginMode?: string;
  }): void {
    if (!this.isPrivate) {
      logger.warn('wsPlaceOrder requer conexão privada');
      return;
    }
    if (!this.isConnected()) {
      logger.warn('WebSocket não conectado - wsPlaceOrder bloqueado');
      return;
    }
    const id = `ws-order-${Date.now()}`;
    const msg = {
      id,
      type: 'openTrade',
      topic: '/contractMarket/tradeOrders',
      data: params,
      response: true,
    };
    this.ws!.send(JSON.stringify(msg));
    logger.info({ id, clientOid: params.clientOid, symbol: params.symbol, side: params.side }, 'Ordem WS enviada');
  }

  /**
   * Cancela ordem Futures via WebSocket (baixa latência)
   * Envia mensagem tipo 'cancelTrade' diretamente pelo WS
   * Ref: KuCoin Futures WebSocket Trade API
   */
  wsCancelOrder(orderId: string): void {
    if (!this.isPrivate) {
      logger.warn('wsCancelOrder requer conexão privada');
      return;
    }
    if (!this.isConnected()) {
      logger.warn('WebSocket não conectado - wsCancelOrder bloqueado');
      return;
    }
    const id = `ws-cancel-${Date.now()}`;
    const msg = {
      id,
      type: 'cancelTrade',
      topic: '/contractMarket/tradeOrders',
      data: { orderId },
      response: true,
    };
    this.ws!.send(JSON.stringify(msg));
    logger.info({ id, orderId }, 'Cancelamento WS enviado');
  }

  /**
   * Cancela ordem por clientOid via WebSocket (baixa latência)
   * Ref: KuCoin Futures WebSocket Trade API
   */
  wsCancelOrderByClientOid(clientOid: string, symbol: string): void {
    if (!this.isPrivate) {
      logger.warn('wsCancelOrderByClientOid requer conexão privada');
      return;
    }
    if (!this.isConnected()) {
      logger.warn('WebSocket não conectado - wsCancelOrderByClientOid bloqueado');
      return;
    }
    const id = `ws-cancel-coid-${Date.now()}`;
    const msg = {
      id,
      type: 'cancelTrade',
      topic: '/contractMarket/tradeOrders',
      data: { clientOid, symbol },
      response: true,
    };
    this.ws!.send(JSON.stringify(msg));
    logger.info({ id, clientOid, symbol }, 'Cancelamento WS por clientOid enviado');
  }

  /**
   * Cancela subscription de ticker
   */
  unsubscribeTicker(symbol: string): void {
    this.sendUnsubscribe(`/contractMarket/tickerV2:${symbol}`);
  }

  /**
   * Cancela subscription de order book
   */
  unsubscribeOrderBook(symbol: string, depth: 5 | 50): void {
    this.sendUnsubscribe(`/contractMarket/level2Depth${depth}:${symbol}`);
  }

  /**
   * Cancela subscription de klines
   */
  unsubscribeKlines(symbol: string, interval: string): void {
    this.sendUnsubscribe(`/contractMarket/limitCandle:${symbol}_${interval}`);
  }

  /**
   * Cancela subscription de trades
   */
  unsubscribeTrades(symbol: string): void {
    this.sendUnsubscribe(`/contractMarket/execution:${symbol}`);
  }

  /**
   * Cancela subscription de posição específica
   */
  unsubscribePosition(symbol: string): void {
    this.sendUnsubscribe(`/contract/position:${symbol}`);
  }

  /**
   * Cancela subscription de posição de todos os símbolos
   */
  unsubscribePositionAll(): void {
    this.sendUnsubscribe('/contract/positionAll');
  }

  /**
   * Obtém estado atual da conexão
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Verifica se está conectado
   */
  isConnected(): boolean {
    return this.state === 'connected' && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Obtém lista de subscriptions ativas
   */
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }

  /**
   * Desconecta do WebSocket
   */
  disconnect(): void {
    logger.info('Desconectando WebSocket KuCoin');
    
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
    }

    this.cleanup();
    this.subscriptions.clear();
    this.setState('disconnected');
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let publicClient: KucoinWebSocketClient | null = null;
let privateClient: KucoinWebSocketClient | null = null;

/**
 * Obtém cliente WebSocket público (singleton)
 */
export function getPublicWebSocketClient(): KucoinWebSocketClient {
  if (!publicClient) {
    publicClient = new KucoinWebSocketClient();
  }
  return publicClient;
}

/**
 * Obtém cliente WebSocket privado (singleton)
 */
export function getPrivateWebSocketClient(): KucoinWebSocketClient {
  if (!privateClient) {
    privateClient = new KucoinWebSocketClient();
  }
  return privateClient;
}

/**
 * Verifica se WebSocket está configurado (credenciais disponíveis)
 */
export function isWebSocketConfigured(): boolean {
  return !!(KUCOIN_PRO_API_KEY && KUCOIN_PRO_API_SECRET && KUCOIN_PRO_API_PASSPHRASE);
}

/**
 * Inicializa ambos os clientes WebSocket
 */
export async function initializeWebSocketClients(): Promise<void> {
  logger.info('Inicializando clientes WebSocket KuCoin');

  try {
    // Sempre inicializar cliente público (não requer auth)
    const publicWs = getPublicWebSocketClient();
    await publicWs.connect(false);
    logger.info('Cliente WebSocket público conectado');

    // Inicializar cliente privado apenas se credenciais disponíveis
    if (isWebSocketConfigured()) {
      const privateWs = getPrivateWebSocketClient();
      await privateWs.connect(true);
      logger.info('Cliente WebSocket privado conectado');
    } else {
      logger.warn('Credenciais KuCoin não configuradas - cliente privado não inicializado');
    }
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Erro ao inicializar WebSocket');
    throw error;
  }
}

/**
 * Encerra ambos os clientes WebSocket
 */
export function closeWebSocketClients(): void {
  logger.info('Encerrando clientes WebSocket KuCoin');
  
  if (publicClient) {
    publicClient.disconnect();
    publicClient = null;
  }
  
  if (privateClient) {
    privateClient.disconnect();
    privateClient = null;
  }
}

export default {
  KucoinWebSocketClient,
  getPublicWebSocketClient,
  getPrivateWebSocketClient,
  isWebSocketConfigured,
  initializeWebSocketClients,
  closeWebSocketClients,
};
