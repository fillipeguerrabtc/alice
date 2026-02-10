/**
 * Trading Broadcast - Alice Enterprise Platform
 * 
 * Sistema de broadcast para dados de trading em tempo real via Redis Pub/Sub.
 * Permite que o chat-service receba updates e repasse para clientes WebSocket.
 * 
 * Canais Redis:
 * - trading:ticker - Updates de preço em tempo real
 * - trading:orderbook - Updates de order book
 * - trading:klines - Updates de candles
 * - trading:orders - Updates de status de ordens (privado)
 * - trading:positions - Updates de posições (privado)
 * - trading:control - Mudanças de controle (handover/takeover)
 * 
 * Regra 6 - SEM MOCKS: Redis real obrigatório em produção
 * Regra 8 - TypeScript strict, zero any
 * Regra 16 - Resiliência com reconnect automático
 * 
 * Autor: Fillipe Guerra
 * Data: 17 de Dezembro de 2025
 */

import { createClient, RedisClientType } from 'redis';
import { createLogger } from '@alice/logger';
import { TRADING_CHANNELS } from '@alice/shared-utils';
import type { OrderUpdateData, PositionUpdateData, BalanceUpdateData } from './kucoinUnifiedWebSocket.js';
import type {
  TradingMarketType,
  TradingMarginMode,
  NormalizedTickerData,
  NormalizedOrderBookData,
  NormalizedKlineData,
  NormalizedTradeData,
} from './tradingTypes.js';

const logger = createLogger('trading-broadcast');

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

const REDIS_URL = process.env.REDIS_URL;

// SSOT de canais (compartilhado entre serviços)
const CHANNELS = TRADING_CHANNELS;

// ============================================================================
// TIPOS
// ============================================================================

/** Tipos de mensagem de broadcast */
export type BroadcastMessageType = 
  | 'ticker'
  | 'orderbook'
  | 'klines'
  | 'trades'
  | 'orders'
  | 'positions'
  | 'balance'
  | 'control';

/** Mensagem genérica de broadcast */
export interface BroadcastMessage<T = unknown> {
  type: BroadcastMessageType;
  symbol?: string;
  marketType?: TradingMarketType;
  marginMode?: TradingMarginMode;
  tenantId?: string;
  data: T;
  timestamp: number;
}

/** Mensagem de controle (handover/takeover) */
export interface ControlMessage {
  action: 'takeover' | 'handback';
  tenantId: string;
  userId: string;
  previousMode: 'alice' | 'manual';
  newMode: 'alice' | 'manual';
  reason?: string;
}

/** Callback para receber mensagens */
export type MessageCallback<T> = (message: BroadcastMessage<T>) => void;

// ============================================================================
// CLASSE PRINCIPAL: Trading Broadcast Publisher
// ============================================================================

class TradingBroadcastPublisher {
  private client: RedisClientType | null = null;
  private isConnected: boolean = false;

  /**
   * Inicializa conexão com Redis
   */
  async connect(): Promise<boolean> {
    if (!REDIS_URL) {
      if (process.env.NODE_ENV === 'production') {
        logger.fatal('REDIS_URL não configurado em produção (Regra 6 - fail-fast)');
        throw new Error('REDIS_URL é obrigatório em produção para broadcast');
      }
      logger.warn('REDIS_URL não configurado - broadcast desabilitado (dev/test)');
      return false;
    }

    try {
      this.client = createClient({
        url: REDIS_URL,
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: (retries) => {
            if (retries > 5) {
              logger.error('Máximo de tentativas de reconexão Redis atingido');
              return new Error('Max retries reached');
            }
            return Math.min(retries * 100, 3000);
          },
        },
      });

      this.client.on('error', (err) => {
        logger.error({ error: err.message }, 'Erro Redis Publisher');
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        logger.info('Redis Publisher conectado');
        this.isConnected = true;
      });

      this.client.on('reconnecting', () => {
        logger.info('Redis Publisher reconectando...');
        this.isConnected = false;
      });

      await this.client.connect();
      return true;
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Falha ao conectar Redis Publisher');
      if (process.env.NODE_ENV === 'production') {
        throw error;
      }
      return false;
    }
  }

  /**
   * Publica mensagem em um canal
   */
  private async publish<T>(channel: string, message: BroadcastMessage<T>): Promise<void> {
    if (!this.client || !this.isConnected) {
      logger.debug({ channel }, 'Redis não conectado - mensagem descartada');
      return;
    }

    try {
      await this.client.publish(channel, JSON.stringify(message));
      logger.debug({ channel, type: message.type }, 'Mensagem publicada');
    } catch (error) {
      logger.error({ error: (error as Error).message, channel }, 'Erro ao publicar mensagem');
    }
  }

  /**
   * Publica update de ticker
   */
  async publishTicker(
    symbol: string,
    data: NormalizedTickerData,
    marketType?: TradingMarketType,
    marginMode?: TradingMarginMode
  ): Promise<void> {
    await this.publish(CHANNELS.TICKER, {
      type: 'ticker',
      symbol,
      marketType,
      marginMode,
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Publica update de order book
   */
  async publishOrderBook(
    symbol: string,
    data: NormalizedOrderBookData,
    marketType?: TradingMarketType,
    marginMode?: TradingMarginMode
  ): Promise<void> {
    await this.publish(CHANNELS.ORDERBOOK, {
      type: 'orderbook',
      symbol,
      marketType,
      marginMode,
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Publica update de klines
   */
  async publishKlines(
    symbol: string,
    data: NormalizedKlineData,
    marketType?: TradingMarketType,
    marginMode?: TradingMarginMode
  ): Promise<void> {
    await this.publish(CHANNELS.KLINES, {
      type: 'klines',
      symbol,
      marketType,
      marginMode,
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Publica update de trades
   */
  async publishTrades(
    symbol: string,
    data: NormalizedTradeData,
    marketType?: TradingMarketType,
    marginMode?: TradingMarginMode
  ): Promise<void> {
    await this.publish(CHANNELS.TRADES, {
      type: 'trades',
      symbol,
      marketType,
      marginMode,
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Publica update de ordem (privado - inclui tenantId)
   */
  async publishOrderUpdate(tenantId: string, data: OrderUpdateData): Promise<void> {
    await this.publish(CHANNELS.ORDERS, {
      type: 'orders',
      tenantId,
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Publica update de posição (privado - inclui tenantId)
   */
  async publishPositionUpdate(tenantId: string, data: PositionUpdateData): Promise<void> {
    await this.publish(CHANNELS.POSITIONS, {
      type: 'positions',
      tenantId,
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Publica update de balance (privado - inclui tenantId)
   */
  async publishBalanceUpdate(tenantId: string, data: BalanceUpdateData): Promise<void> {
    await this.publish(CHANNELS.BALANCE, {
      type: 'balance',
      tenantId,
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Publica mudança de controle (handover/takeover)
   */
  async publishControlChange(message: ControlMessage): Promise<void> {
    await this.publish(CHANNELS.CONTROL, {
      type: 'control',
      tenantId: message.tenantId,
      data: message,
      timestamp: Date.now(),
    });
  }

  /**
   * Verifica se está conectado
   */
  isPublisherConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Encerra conexão
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
      logger.info('Redis Publisher desconectado');
    }
  }
}

// ============================================================================
// CLASSE: Trading Broadcast Subscriber
// ============================================================================

class TradingBroadcastSubscriber {
  private client: RedisClientType | null = null;
  private isConnected: boolean = false;
  private callbacks: Map<string, MessageCallback<unknown>[]> = new Map();

  /**
   * Inicializa conexão com Redis para subscription
   */
  async connect(): Promise<boolean> {
    if (!REDIS_URL) {
      if (process.env.NODE_ENV === 'production') {
        logger.fatal('REDIS_URL não configurado em produção (Regra 6 - fail-fast)');
        throw new Error('REDIS_URL é obrigatório em produção para subscription');
      }
      logger.warn('REDIS_URL não configurado - subscription desabilitado (dev/test)');
      return false;
    }

    try {
      this.client = createClient({
        url: REDIS_URL,
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: (retries) => {
            if (retries > 5) {
              return new Error('Max retries reached');
            }
            return Math.min(retries * 100, 3000);
          },
        },
      });

      this.client.on('error', (err) => {
        logger.error({ error: err.message }, 'Erro Redis Subscriber');
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        logger.info('Redis Subscriber conectado');
        this.isConnected = true;
      });

      await this.client.connect();
      return true;
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Falha ao conectar Redis Subscriber');
      if (process.env.NODE_ENV === 'production') {
        throw error;
      }
      return false;
    }
  }

  /**
   * Inscreve-se em um canal
   */
  async subscribe<T>(channel: string, callback: MessageCallback<T>): Promise<void> {
    if (!this.client || !this.isConnected) {
      logger.warn({ channel }, 'Redis não conectado - subscription pendente');
      return;
    }

    // Armazenar callback
    const callbacks = this.callbacks.get(channel) || [];
    callbacks.push(callback as MessageCallback<unknown>);
    this.callbacks.set(channel, callbacks);

    // Inscrever no canal
    await this.client.subscribe(channel, (message) => {
      try {
        const parsed = JSON.parse(message) as BroadcastMessage<T>;
        const channelCallbacks = this.callbacks.get(channel) || [];
        for (const cb of channelCallbacks) {
          cb(parsed as BroadcastMessage<unknown>);
        }
      } catch (error) {
        logger.error({ error: (error as Error).message, channel }, 'Erro ao processar mensagem');
      }
    });

    logger.info({ channel }, 'Inscrito no canal Redis');
  }

  /**
   * Atalho para inscrever em ticker
   */
  async subscribeTicker(callback: MessageCallback<NormalizedTickerData>): Promise<void> {
    await this.subscribe(CHANNELS.TICKER, callback);
  }

  /**
   * Atalho para inscrever em order book
   */
  async subscribeOrderBook(callback: MessageCallback<NormalizedOrderBookData>): Promise<void> {
    await this.subscribe(CHANNELS.ORDERBOOK, callback);
  }

  /**
   * Atalho para inscrever em klines
   */
  async subscribeKlines(callback: MessageCallback<NormalizedKlineData>): Promise<void> {
    await this.subscribe(CHANNELS.KLINES, callback);
  }

  /**
   * Atalho para inscrever em trades
   */
  async subscribeTrades(callback: MessageCallback<NormalizedTradeData>): Promise<void> {
    await this.subscribe(CHANNELS.TRADES, callback);
  }

  /**
   * Atalho para inscrever em orders
   */
  async subscribeOrders(callback: MessageCallback<OrderUpdateData>): Promise<void> {
    await this.subscribe(CHANNELS.ORDERS, callback);
  }

  /**
   * Atalho para inscrever em positions
   */
  async subscribePositions(callback: MessageCallback<PositionUpdateData>): Promise<void> {
    await this.subscribe(CHANNELS.POSITIONS, callback);
  }

  /**
   * Atalho para inscrever em balance
   */
  async subscribeBalance(callback: MessageCallback<BalanceUpdateData>): Promise<void> {
    await this.subscribe(CHANNELS.BALANCE, callback);
  }

  /**
   * Atalho para inscrever em control changes
   */
  async subscribeControl(callback: MessageCallback<ControlMessage>): Promise<void> {
    await this.subscribe(CHANNELS.CONTROL, callback);
  }

  /**
   * Cancela inscrição em um canal
   */
  async unsubscribe(channel: string): Promise<void> {
    if (!this.client) return;

    await this.client.unsubscribe(channel);
    this.callbacks.delete(channel);
    logger.info({ channel }, 'Desincrito do canal Redis');
  }

  /**
   * Verifica se está conectado
   */
  isSubscriberConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Encerra conexão
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
      this.callbacks.clear();
      logger.info('Redis Subscriber desconectado');
    }
  }
}

// ============================================================================
// SINGLETON INSTANCES
// ============================================================================

let publisher: TradingBroadcastPublisher | null = null;
let subscriber: TradingBroadcastSubscriber | null = null;

/**
 * Obtém instância do publisher (singleton)
 */
export function getPublisher(): TradingBroadcastPublisher {
  if (!publisher) {
    publisher = new TradingBroadcastPublisher();
  }
  return publisher;
}

/**
 * Obtém instância do subscriber (singleton)
 */
export function getSubscriber(): TradingBroadcastSubscriber {
  if (!subscriber) {
    subscriber = new TradingBroadcastSubscriber();
  }
  return subscriber;
}

/**
 * Inicializa o sistema de broadcast
 */
export async function initializeBroadcast(): Promise<{
  publisher: boolean;
  subscriber: boolean;
}> {
  logger.info('Inicializando sistema de broadcast de trading');

  const pub = getPublisher();
  const sub = getSubscriber();

  const [pubConnected, subConnected] = await Promise.all([
    pub.connect(),
    sub.connect(),
  ]);

  return {
    publisher: pubConnected,
    subscriber: subConnected,
  };
}

/**
 * Encerra o sistema de broadcast
 */
export async function closeBroadcast(): Promise<void> {
  logger.info('Encerrando sistema de broadcast de trading');

  await Promise.all([
    publisher?.disconnect(),
    subscriber?.disconnect(),
  ]);

  publisher = null;
  subscriber = null;
}

// Exportar canais para uso externo
export { CHANNELS };

export default {
  getPublisher,
  getSubscriber,
  initializeBroadcast,
  closeBroadcast,
  CHANNELS,
};
