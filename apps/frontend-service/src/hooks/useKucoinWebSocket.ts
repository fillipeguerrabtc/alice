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
  time: number;
  open: string;
  close: string;
  high: string;
  low: string;
  volume: string;
  turnover: string;
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

export interface WebSocketState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  lastPing: number | null;
}

export interface UseKucoinWebSocketOptions {
  symbol?: string;
  channels?: ('ticker' | 'orderbook' | 'klines')[];
  interval?: string;
  autoConnect?: boolean;
  onTicker?: (data: TickerData) => void;
  onOrderBook?: (data: OrderBookData) => void;
  onKline?: (data: KlineData) => void;
  onCommandResult?: (result: TradingCommandResult) => void;
  onError?: (error: string) => void;
}

export interface UseKucoinWebSocketReturn {
  state: WebSocketState;
  ticker: TickerData | null;
  orderBook: OrderBookData | null;
  klines: KlineData[];
  connect: () => void;
  disconnect: () => void;
  subscribe: (channel: string, symbol?: string, interval?: string) => void;
  unsubscribe: (channel: string, symbol?: string) => void;
  sendCommand: (content: string) => void;
}

// ============================================================================
// CONSTANTES
// ============================================================================

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];
const MAX_KLINES_CACHE = 500;
const PING_INTERVAL = 25000;

// ============================================================================
// HOOK PRINCIPAL
// ============================================================================

export function useKucoinWebSocket(
  options: UseKucoinWebSocketOptions = {}
): UseKucoinWebSocketReturn {
  const {
    symbol = 'XBTUSDTM',
    channels = ['ticker'],
    interval = '1',
    autoConnect = true,
    onTicker,
    onOrderBook,
    onKline,
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

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subscriptionsRef = useRef<Set<string>>(new Set());
  // CORREÇÃO 17/12/2025: Flag para evitar subscriptions duplicadas na conexão inicial
  // Bug: onopen envia subscriptions E o useEffect[state.connected] dispara novamente
  // quando connected=true, enviando subscriptions duplicadas porque subscriptionsRef está vazio
  const initialSubscriptionSentRef = useRef(false);
  const previousSymbolRef = useRef<string>(symbol);

  // Get WebSocket URL
  const getWsUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws`;
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

        case 'trading:subscribed':
          subscriptionsRef.current.add(`${data.channel}:${data.symbol}`);
          break;

        case 'trading:unsubscribed':
          subscriptionsRef.current.delete(`${data.channel}:${data.symbol}`);
          break;

        case 'trading:ticker':
          setTicker(data.data);
          onTicker?.(data.data);
          break;

        case 'trading:orderbook':
          setOrderBook(data.data);
          onOrderBook?.(data.data);
          break;

        case 'trading:kline':
          setKlines(prev => {
            const newKlines = [...prev, data.data];
            // Manter apenas os últimos MAX_KLINES_CACHE
            if (newKlines.length > MAX_KLINES_CACHE) {
              return newKlines.slice(-MAX_KLINES_CACHE);
            }
            return newKlines;
          });
          onKline?.(data.data);
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
      console.error('Erro ao processar mensagem WebSocket:', err);
    }
  }, [onTicker, onOrderBook, onKline, onCommandResult, onError]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    clearReconnect();
    setState(prev => ({ ...prev, connecting: true, error: null }));

    try {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setState({
          connected: true,
          connecting: false,
          error: null,
          lastPing: Date.now(),
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
        channels.forEach(channel => {
          ws.send(JSON.stringify({
            type: 'trading:subscribe',
            channel,
            symbol,
            interval: channel === 'klines' ? interval : undefined,
          }));
        });

        // CORREÇÃO 17/12/2025: Marcar que subscriptions iniciais foram enviadas
        // Isso evita que o useEffect[state.connected] envie subscriptions duplicadas
        initialSubscriptionSentRef.current = true;
        previousSymbolRef.current = symbol;
      };

      ws.onmessage = handleMessage;

      ws.onerror = () => {
        setState(prev => ({
          ...prev,
          error: 'Erro na conexão WebSocket',
        }));
      };

      ws.onclose = () => {
        setState(prev => ({
          ...prev,
          connected: false,
          connecting: false,
        }));
        clearPing();

        // Auto-reconnect com backoff exponencial
        if (autoConnect) {
          const delay = RECONNECT_DELAYS[
            Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS.length - 1)
          ];
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
  }, [getWsUrl, handleMessage, clearReconnect, clearPing, channels, symbol, interval, autoConnect]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
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

  // Subscribe to a channel
  const subscribe = useCallback((channel: string, channelSymbol?: string, channelInterval?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'trading:subscribe',
        channel,
        symbol: channelSymbol || symbol,
        interval: channelInterval || interval,
      }));
    }
  }, [symbol, interval]);

  // Unsubscribe from a channel
  const unsubscribe = useCallback((channel: string, channelSymbol?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'trading:unsubscribe',
        channel,
        symbol: channelSymbol || symbol,
      }));
    }
  }, [symbol]);

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
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  // Resubscribe when symbol changes
  useEffect(() => {
    if (state.connected) {
      // CORREÇÃO 17/12/2025: Evitar subscriptions duplicadas na conexão inicial
      // Bug: onopen já envia subscriptions, mas este useEffect dispara novamente quando
      // state.connected muda para true, enviando subscriptions duplicadas
      // Solução: Verificar se é conexão inicial (flag true E símbolo não mudou)
      const isInitialConnection = initialSubscriptionSentRef.current && previousSymbolRef.current === symbol;
      
      if (isInitialConnection) {
        // Conexão inicial - subscriptions já foram enviadas no onopen
        // Apenas resetar a flag e não fazer nada
        initialSubscriptionSentRef.current = false;
        return;
      }

      // Mudança de símbolo ou reconexão - fazer resubscribe normalmente
      // Unsubscribe from old channels
      // CORREÇÃO 17/12/2025: Extrair oldSymbol da subscription para enviar unsubscribe correto
      // Bug anterior: unsubscribe(channel) usava o novo símbolo via closure, deixando subscriptions órfãs
      subscriptionsRef.current.forEach(sub => {
        const [channel, oldSymbol] = sub.split(':');
        unsubscribe(channel, oldSymbol);
      });

      // Subscribe to new channels
      channels.forEach(channel => {
        subscribe(channel, symbol, channel === 'klines' ? interval : undefined);
      });

      // Atualizar referência do símbolo
      previousSymbolRef.current = symbol;
    }
  }, [symbol, state.connected, channels, interval, subscribe, unsubscribe]);

  return {
    state,
    ticker,
    orderBook,
    klines,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    sendCommand,
  };
}

export default useKucoinWebSocket;
