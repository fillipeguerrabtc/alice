/**
 * useKucoinWebSocket - Hook para Dados de Trading em Tempo Real
 * 
 * Hook enterprise-grade para consumir dados de trading via WebSocket.
 * Conecta ao chat-service que faz bridge com KuCoin WebSocket.
 * 
 * Features:
 * - Subscription para ticker, orderbook, klines
 * - Reconexão automática com backoff exponencial
 * - Cache local de dados
 * - Callbacks para atualizações
 * - Cleanup automático ao desmontar
 * 
 * Regra 6 - SEM MOCKS: Conexão real com backend
 * Regra 8 - TypeScript strict
 * 
 * Autor: Fillipe Guerra
 * Data: 17 de Dezembro de 2025
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { frontendLogger } from '@/lib/logger';

// ============================================================================
// TIPOS
// ============================================================================

export interface TickerData {
  symbol: string;
  price: string;
  size: string;
  bestBid: string;
  bestBidSize: string;
  bestAsk: string;
  bestAskSize: string;
  timestamp: number;
}

export interface OrderBookData {
  symbol: string;
  sequence: number;
  bids: Array<{ price: string; size: string; sequence: number }>;
  asks: Array<{ price: string; size: string; sequence: number }>;
  timestamp: number;
}

export interface KlineData {
  symbol: string;
  interval?: string;
  time: number;
  open: string;
  close: string;
  high: string;
  low: string;
  volume: string;
  turnover: string;
}

export interface TradeData {
  symbol: string;
  price: string;
  size: number;
  side: string;
  tradeId: string;
  ts: number;
}

export interface BalanceData {
  availableBalance: string;
  holdBalance: string;
  currency: string;
  timestamp: number;
}

export interface TradingCommandResult {
  type: string;
  command?: unknown;
  description?: string;
  status?: string;
  error?: string;
  reason?: string;
  hint?: string;
}

export interface PositionUpdateData {
  [key: string]: unknown;
}

export interface OrderUpdateData {
  [key: string]: unknown;
}

type MarketType = 'futures' | 'spot' | 'margin';
type MarginMode = 'cross' | 'isolated';

export interface WebSocketState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  lastPing: number | null;
}

export interface UseKucoinWebSocketOptions {
  symbol?: string;
  channels?: ('ticker' | 'orderbook' | 'klines' | 'trades' | 'balance' | 'positions' | 'orders')[];
  interval?: string;
  marketType?: MarketType;
  marginMode?: MarginMode;
  orderBookDepth?: 5 | 50;
  autoConnect?: boolean;
  onTicker?: (data: TickerData) => void;
  onOrderBook?: (data: OrderBookData) => void;
  onKline?: (data: KlineData) => void;
  onTrade?: (data: TradeData) => void;
  onBalance?: (data: BalanceData) => void;
  onPositionUpdate?: (data: PositionUpdateData) => void;
  onOrderUpdate?: (data: OrderUpdateData) => void;
  onCommandResult?: (result: TradingCommandResult) => void;
  onError?: (error: string) => void;
}

export interface UseKucoinWebSocketReturn {
  state: WebSocketState;
  ticker: TickerData | null;
  orderBook: OrderBookData | null;
  klines: KlineData[];
  lastTrade: TradeData | null;
  balance: BalanceData | null;
  positionUpdate: PositionUpdateData | null;
  orderUpdate: OrderUpdateData | null;
  connect: () => void;
  disconnect: () => void;
  subscribe: (
    channel: string,
    symbol?: string,
    interval?: string,
    marketType?: MarketType,
    marginMode?: MarginMode,
    orderBookDepth?: 5 | 50
  ) => void;
  unsubscribe: (
    channel: string,
    symbol?: string,
    interval?: string,
    marketType?: MarketType,
    marginMode?: MarginMode,
    orderBookDepth?: 5 | 50
  ) => void;
  sendCommand: (content: string) => void;
}

// ============================================================================
// CONSTANTES
// ============================================================================

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];
const MAX_RECONNECT_ATTEMPTS = 8;
const RECONNECT_JITTER_FACTOR = 0.2;
const MAX_KLINES_CACHE = 500;
const PING_INTERVAL = 25000;

// ============================================================================
// HOOK PRINCIPAL
// ============================================================================

export function useKucoinWebSocket(
  options: UseKucoinWebSocketOptions = {}
): UseKucoinWebSocketReturn {
  const {
    symbol = '',
    channels = ['ticker'],
    interval = '',
    marketType = 'futures',
    marginMode = 'cross',
    orderBookDepth,
    autoConnect = true,
    onTicker,
    onOrderBook,
    onKline,
    onTrade,
    onBalance,
    onPositionUpdate,
    onOrderUpdate,
    onCommandResult,
    onError,
  } = options;

  // State
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    connecting: false,
    error: null,
    lastPing: null,
  });
  const [ticker, setTicker] = useState<TickerData | null>(null);
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [lastTrade, setLastTrade] = useState<TradeData | null>(null);
  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [positionUpdate, setPositionUpdate] = useState<PositionUpdateData | null>(null);
  const [orderUpdate, setOrderUpdate] = useState<OrderUpdateData | null>(null);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subscriptionsRef = useRef<Set<string>>(new Set());
  const lastOrderBookSequenceRef = useRef<number | null>(null);
  const lastTickerSignatureRef = useRef<string>('');
  // CORREÇÃO 17/12/2025: Flag para evitar subscriptions duplicadas na conexão inicial
  // Bug: onopen envia subscriptions E o useEffect[state.connected] dispara novamente
  // quando connected=true, enviando subscriptions duplicadas porque subscriptionsRef está vazio
  const initialSubscriptionSentRef = useRef(false);
  const previousSymbolRef = useRef<string>(symbol);
  // CORREÇÃO 17/12/2025: Flag para suprimir auto-reconnect quando disconnect() é chamado explicitamente
  // Bug: clearReconnect() roda ANTES de ws.close(), mas onclose dispara ASSINCRONAMENTE
  // e cria um NOVO timeout que não é limpo, causando reconexão indesejada e memory leaks
  const isIntentionalDisconnectRef = useRef(false);
  // CORREÇÃO 17/12/2025: Connection ID para invalidar callbacks de WebSockets antigos
  // Bug: Quando symbol muda rápido, disconnect()->connect() deixa o onclose antigo com flag=false
  // O WebSocket órfão continua recebendo dados via handleMessage, corrompendo estado
  const connectionIdRef = useRef(0);

  const buildSubscriptionKey = useCallback((data: {
    channel: string;
    symbol: string;
    interval?: string;
    marketType?: MarketType;
    marginMode?: MarginMode;
  }): string => {
    const normalizedSymbol = data.symbol.toUpperCase();
    const resolvedMarketType = data.marketType ?? 'futures';
    // Futures não distingue margem para broadcast de market data.
    // Normalizar evita mismatch com backend (sempre cross em futures).
    const resolvedMarginMode = resolvedMarketType === 'futures' ? 'cross' : (data.marginMode ?? 'cross');
    if (data.channel === 'klines') {
      return `${data.channel}:${resolvedMarketType}:${resolvedMarginMode}:${normalizedSymbol}:${data.interval ?? ''}`;
    }
    return `${data.channel}:${resolvedMarketType}:${resolvedMarginMode}:${normalizedSymbol}`;
  }, []);

  // Get WebSocket URL
  const getWsUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws/chat`;
  }, []);

  // Clear reconnect timeout
  const clearReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  // Clear ping interval
  const clearPing = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  }, []);

  // Handle incoming messages
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'pong':
          setState(prev => ({ ...prev, lastPing: Date.now() }));
          break;

        case 'trading:subscribed': {
          const key = buildSubscriptionKey({
            channel: data.channel,
            symbol: data.symbol,
            interval: data.interval,
            marketType: data.marketType,
            marginMode: data.marginMode,
          });
          subscriptionsRef.current.add(key);
          frontendLogger.info('Trading WS subscribed', {
            key,
            totalSubscriptions: subscriptionsRef.current.size,
          });
          break;
        }

        case 'trading:unsubscribed': {
          const key = buildSubscriptionKey({
            channel: data.channel,
            symbol: data.symbol,
            interval: data.interval,
            marketType: data.marketType,
            marginMode: data.marginMode,
          });
          subscriptionsRef.current.delete(key);
          frontendLogger.info('Trading WS unsubscribed', {
            key,
            totalSubscriptions: subscriptionsRef.current.size,
          });
          break;
        }

        case 'trading:ticker':
          if (data.marketType && data.marketType !== marketType) break;
          if (data?.data) {
            const signature = [
              data.data.symbol,
              data.data.price,
              data.data.bestBid,
              data.data.bestAsk,
              data.data.size,
            ].join('|');
            if (lastTickerSignatureRef.current === signature) break;
            lastTickerSignatureRef.current = signature;
          }
          setTicker(data.data);
          onTicker?.(data.data);
          break;

        case 'trading:orderbook':
          if (data.marketType && data.marketType !== marketType) break;
          if (data?.data?.sequence !== undefined && data?.data?.sequence !== null) {
            const lastSequence = lastOrderBookSequenceRef.current;
            if (lastSequence !== null && data.data.sequence <= lastSequence) break;
            lastOrderBookSequenceRef.current = data.data.sequence;
          }
          setOrderBook(data.data);
          onOrderBook?.(data.data);
          break;

        case 'trading:klines': {
          if (data.marketType && data.marketType !== marketType) break;
          if (data.data?.interval && interval && data.data.interval !== interval) {
            break;
          }
          const incomingKline = data.data as KlineData;
          setKlines(prev => {
            // Normalizar timestamps para comparação (segundo)
            const incomingTime = incomingKline.time > 10_000_000_000
              ? Math.floor(incomingKline.time / 1000)
              : incomingKline.time;

            // Se o último candle tem o mesmo timestamp, ATUALIZAR (não duplicar)
            // Isso acontece quando o WS envia updates do candle atual em tempo real
            if (prev.length > 0) {
              const lastTime = prev[prev.length - 1].time > 10_000_000_000
                ? Math.floor(prev[prev.length - 1].time / 1000)
                : prev[prev.length - 1].time;

              if (lastTime === incomingTime) {
                const updated = [...prev];
                updated[updated.length - 1] = incomingKline;
                return updated;
              }
            }

            // Candle novo — append e manter limite de cache
            const newKlines = [...prev, incomingKline];
            if (newKlines.length > MAX_KLINES_CACHE) {
              return newKlines.slice(-MAX_KLINES_CACHE);
            }
            return newKlines;
          });
          onKline?.(incomingKline);
          break;
        }

        case 'trading:trades':
          if (data.marketType && data.marketType !== marketType) break;
          setLastTrade(data.data);
          onTrade?.(data.data);
          break;

        case 'trading:balance':
          if (data.marketType && data.marketType !== marketType) break;
          setBalance(data.data);
          onBalance?.(data.data);
          break;

        case 'trading:positions':
          setPositionUpdate(data.data);
          onPositionUpdate?.(data.data);
          break;

        case 'trading:orders':
          setOrderUpdate(data.data);
          onOrderUpdate?.(data.data);
          break;

        case 'trading:command_received':
        case 'trading:error':
        case 'trading:blocked':
          onCommandResult?.(data);
          break;

        case 'error':
          setState(prev => ({ ...prev, error: data.error }));
          onError?.(data.error);
          break;
      }
    } catch (err) {
      // CORREÇÃO AUDITORIA 17/12/2025: Usar frontendLogger ao invés de console.error (Regra 8)
      frontendLogger.error('Erro ao processar mensagem WebSocket', { error: err instanceof Error ? err.message : String(err) });
    }
  }, [buildSubscriptionKey, interval, marketType, onTicker, onOrderBook, onKline, onTrade, onBalance, onPositionUpdate, onOrderUpdate, onCommandResult, onError]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    // CORREÇÃO 17/12/2025: Verificar CONNECTING além de OPEN para evitar conexões duplicadas
    // Bug: Quando symbol muda rápido, connect() era chamado enquanto WebSocket ainda estava CONNECTING
    // Isso criava múltiplas conexões simultâneas, todas atualizando o mesmo estado
    if (wsRef.current?.readyState === WebSocket.OPEN || 
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    // CORREÇÃO 17/12/2025: Resetar flag de disconnect intencional ao iniciar nova conexão
    // Isso permite que auto-reconnect funcione corretamente em conexões subsequentes
    isIntentionalDisconnectRef.current = false;

    // CORREÇÃO 17/12/2025: Incrementar connection ID para invalidar callbacks de WebSockets antigos
    // Cada nova conexão tem um ID único; callbacks verificam se o ID ainda é válido
    const currentConnectionId = ++connectionIdRef.current;

    clearReconnect();
    setState(prev => ({ ...prev, connecting: true, error: null }));

    try {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        // CORREÇÃO 17/12/2025: Ignorar se este WebSocket já foi substituído por uma nova conexão
        if (connectionIdRef.current !== currentConnectionId) {
          ws.close();
          return;
        }
        setState({
          connected: true,
          connecting: false,
          error: null,
          lastPing: Date.now(),
        });
        frontendLogger.info('Trading WS connected', {
          symbol: symbol.toUpperCase(),
          marketType,
        });
        reconnectAttemptRef.current = 0;

        // Setup ping interval
        clearPing();
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, PING_INTERVAL);

        // Auto-subscribe aos canais configurados
        if (!symbol) {
          frontendLogger.warn('Auto-subscribe ignorado - símbolo não definido');
        } else {
          const normalizedSymbol = symbol.toUpperCase();
          const normalizedMarginMode = marketType === 'futures' ? 'cross' : marginMode;
          channels.forEach(channel => {
            ws.send(JSON.stringify({
              type: 'trading:subscribe',
              channel,
              symbol: normalizedSymbol,
              interval: channel === 'klines' ? interval : undefined,
              marketType,
              marginMode: normalizedMarginMode,
              depth: channel === 'orderbook' ? orderBookDepth : undefined,
            }));
          });
        }

        // CORREÇÃO 17/12/2025: Marcar que subscriptions iniciais foram enviadas
        // Isso evita que o useEffect[state.connected] envie subscriptions duplicadas
        initialSubscriptionSentRef.current = true;
        previousSymbolRef.current = symbol;
      };

      ws.onmessage = (event: MessageEvent) => {
        // CORREÇÃO 17/12/2025: Ignorar mensagens de WebSockets antigos/órfãos
        // Bug: WebSocket órfão continua recebendo dados e atualizando estado compartilhado
        // via handleMessage, causando dados inconsistentes de ticker/orderbook
        if (connectionIdRef.current !== currentConnectionId) {
          return;
        }
        handleMessage(event);
      };

      ws.onerror = () => {
        // CORREÇÃO 17/12/2025: Ignorar erros de WebSockets antigos
        if (connectionIdRef.current !== currentConnectionId) {
          return;
        }
        setState(prev => ({
          ...prev,
          error: 'Erro na conexão WebSocket',
        }));
      };

      ws.onclose = () => {
        // CORREÇÃO 17/12/2025: Ignorar onclose de WebSockets antigos/órfãos
        // Bug: Quando symbol muda rápido, disconnect()->connect() deixa o onclose antigo pendente
        // O onclose antigo vê isIntentionalDisconnectRef=false (já resetado pelo novo connect)
        // e agenda um reconnect duplicado, criando conexões órfãs que corrompem estado
        if (connectionIdRef.current !== currentConnectionId) {
          return;
        }

        setState(prev => ({
          ...prev,
          connected: false,
          connecting: false,
        }));
        clearPing();

        // Auto-reconnect com backoff exponencial
        // CORREÇÃO 17/12/2025: NÃO reconectar se disconnect() foi chamado explicitamente
        // Bug: onclose dispara ASSINCRONAMENTE após ws.close(), então clearReconnect()
        // já rodou quando chegamos aqui. Se não verificarmos a flag, criamos um NOVO
        // timeout que causa reconexão indesejada e memory leaks em componentes desmontados
        if (autoConnect && !isIntentionalDisconnectRef.current) {
          if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
            const degradedMessage = 'WebSocket em estado degradado após múltiplas falhas de reconexão';
            setState(prev => ({
              ...prev,
              connected: false,
              connecting: false,
              error: degradedMessage,
            }));
            onError?.(degradedMessage);
            frontendLogger.warn('Trading WS em estado degradado', {
              reconnectAttempts: reconnectAttemptRef.current,
              maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
            });
            return;
          }
          const baseDelay = RECONNECT_DELAYS[
            Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS.length - 1)
          ];
          const jitter = Math.round(baseDelay * Math.random() * RECONNECT_JITTER_FACTOR);
          const delay = baseDelay + jitter;
          reconnectAttemptRef.current++;

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };
    } catch (err) {
      setState({
        connected: false,
        connecting: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido',
        lastPing: null,
      });
    }
  }, [getWsUrl, handleMessage, clearReconnect, clearPing, channels, symbol, interval, marketType, marginMode, orderBookDepth, autoConnect]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    // CORREÇÃO 17/12/2025: Setar flag ANTES de fechar para suprimir auto-reconnect no onclose
    // Bug: clearReconnect() roda antes de ws.close(), mas onclose dispara ASSINCRONAMENTE
    // e cria um NOVO timeout se autoConnect=true, causando reconexão indesejada
    isIntentionalDisconnectRef.current = true;

    clearReconnect();
    clearPing();

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setState({
      connected: false,
      connecting: false,
      error: null,
      lastPing: null,
    });
    subscriptionsRef.current.clear();
    // CORREÇÃO 17/12/2025: Resetar flag para que a próxima conexão funcione corretamente
    initialSubscriptionSentRef.current = false;
  }, [clearReconnect, clearPing]);

  const connectRef = useRef(connect);
  const disconnectRef = useRef(disconnect);

  useEffect(() => {
    connectRef.current = connect;
    disconnectRef.current = disconnect;
  }, [connect, disconnect]);

  // Subscribe to a channel
  const subscribe = useCallback((
    channel: string,
    channelSymbol?: string,
    channelInterval?: string,
    channelMarketType?: MarketType,
    channelMarginMode?: MarginMode,
    channelOrderBookDepth?: 5 | 50
  ) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const targetSymbol = (channelSymbol || symbol)?.toUpperCase();
      if (!targetSymbol) {
        frontendLogger.warn('Assinatura ignorada - símbolo não definido', { channel });
        return;
      }
      const resolvedMarketType = channelMarketType ?? marketType;
      const resolvedMarginMode = resolvedMarketType === 'futures' ? 'cross' : (channelMarginMode ?? marginMode);
      wsRef.current.send(JSON.stringify({
        type: 'trading:subscribe',
        channel,
        symbol: targetSymbol,
        interval: channelInterval || interval,
        marketType: resolvedMarketType,
        marginMode: resolvedMarginMode,
        depth: channel === 'orderbook' ? (channelOrderBookDepth ?? orderBookDepth) : undefined,
      }));
    }
  }, [symbol, interval, marketType, marginMode, orderBookDepth]);

  // Unsubscribe from a channel
  const unsubscribe = useCallback((
    channel: string,
    channelSymbol?: string,
    channelInterval?: string,
    channelMarketType?: MarketType,
    channelMarginMode?: MarginMode,
    channelOrderBookDepth?: 5 | 50
  ) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const targetSymbol = (channelSymbol || symbol)?.toUpperCase();
      if (!targetSymbol) return;
      const resolvedMarketType = channelMarketType ?? marketType;
      const resolvedMarginMode = resolvedMarketType === 'futures' ? 'cross' : (channelMarginMode ?? marginMode);
      wsRef.current.send(JSON.stringify({
        type: 'trading:unsubscribe',
        channel,
        symbol: targetSymbol,
        interval: channelInterval || interval,
        marketType: resolvedMarketType,
        marginMode: resolvedMarginMode,
        depth: channel === 'orderbook' ? (channelOrderBookDepth ?? orderBookDepth) : undefined,
      }));
    }
  }, [symbol, interval, marketType, marginMode, orderBookDepth]);

  // Send trading command
  const sendCommand = useCallback((content: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'trading:command',
        content,
      }));
    }
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connectRef.current();
    }

    return () => {
      disconnectRef.current();
    };
  }, [autoConnect]);

  const previousSubscriptionKeyRef = useRef<string | null>(null);

  // Limpar dados quando símbolo, mercado ou intervalo mudam
  // Evita mostrar dados antigos de outro par/mercado/timeframe
  useEffect(() => {
    setKlines([]);
    setTicker(null);
    setOrderBook(null);
    setLastTrade(null);
    lastTickerSignatureRef.current = '';
    lastOrderBookSequenceRef.current = null;
  }, [symbol, interval, marketType, marginMode]);

  // Resubscribe when symbol/interval changes
  useEffect(() => {
    if (state.connected && symbol) {
      const subscriptionKey = `${symbol}:${interval}:${marketType}:${marginMode}`;
      // CORREÇÃO 17/12/2025: Evitar subscriptions duplicadas na conexão inicial
      // Bug: onopen já envia subscriptions, mas este useEffect dispara novamente quando
      // state.connected muda para true, enviando subscriptions duplicadas
      // Solução: Verificar se é conexão inicial (flag true E símbolo não mudou)
      const isInitialConnection = initialSubscriptionSentRef.current
        && previousSubscriptionKeyRef.current === subscriptionKey;
      
      if (isInitialConnection) {
        // Conexão inicial - subscriptions já foram enviadas no onopen
        // Apenas resetar a flag e não fazer nada
        initialSubscriptionSentRef.current = false;
        previousSubscriptionKeyRef.current = subscriptionKey;
        return;
      }

      // Mudança de símbolo ou reconexão - fazer resubscribe normalmente
      // Unsubscribe from old channels
      // CORREÇÃO 17/12/2025: Extrair oldSymbol da subscription para enviar unsubscribe correto
      // Bug anterior: unsubscribe(channel) usava o novo símbolo via closure, deixando subscriptions órfãs
      subscriptionsRef.current.forEach(sub => {
        const [channel, oldMarketType, oldMarginMode, oldSymbol, oldInterval] = sub.split(':');
        const intervalValue = channel === 'klines' ? oldInterval : undefined;
        const marketTypeValue = (oldMarketType as MarketType | undefined) ?? marketType;
        const marginModeValue = (oldMarginMode as MarginMode | undefined) ?? marginMode;
        const depthValue = channel === 'orderbook' ? orderBookDepth : undefined;
        unsubscribe(channel, oldSymbol, intervalValue, marketTypeValue, marginModeValue, depthValue);
      });

      // Subscribe to new channels
      channels.forEach(channel => {
        subscribe(channel, symbol, channel === 'klines' ? interval : undefined, marketType, marginMode, orderBookDepth);
      });

      // Atualizar referência do símbolo/intervalo
      previousSymbolRef.current = symbol;
      previousSubscriptionKeyRef.current = subscriptionKey;
    }
  }, [symbol, state.connected, channels, interval, marketType, marginMode, orderBookDepth, subscribe, unsubscribe]);

  return {
    state,
    ticker,
    orderBook,
    klines,
    lastTrade,
    balance,
    positionUpdate,
    orderUpdate,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    sendCommand,
  };
}

export default useKucoinWebSocket;
