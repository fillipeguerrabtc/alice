import { WebSocketServer, WebSocket } from 'ws';
import { createClient } from 'redis';
import {
  TRADING_CHANNEL_PREFIX,
  TRADING_CHANNELS,
  type Role,
  RUNTIME_ANNOUNCEMENTS_CHANNEL,
  runtimeAnnouncementSchema,
  type RuntimeAnnouncement,
} from '@alice/shared-utils';

export interface WebSocketAuthResult {
  authenticated: boolean;
  userId?: string;
  tenantId?: string;
  role?: string;
  error?: string;
}

export interface WsTokenPayload {
  userId: string;
  tenantId: string;
  role: string;
  nonce: string;
  exp: number;
  aud: 'ws' | 'ws-agent';
}

export interface ExtendedWebSocket extends WebSocket {
  isAlive?: boolean;
  userId?: string;
  tenantId?: string;
  role?: Role;
  clientKey?: string;
  customRoleId?: string;
  tradingSubscriptions?: Set<string>;
  __activeSessionCounted?: boolean;
}

interface ChatWebSocketLogger {
  info: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
  debug: (obj: object | string, msg?: string) => void;
}

interface WsTokenNonceValidationCounter {
  inc: (labels: { result: string }) => void;
}

interface CreatePendingAuthStoreParams {
  logger: ChatWebSocketLogger;
}

interface CreateMainWebSocketServerParams {
  logger: ChatWebSocketLogger;
  pendingAuthResults: Map<string, WebSocketAuthResult>;
  authenticateWebSocketConnection: (
    cookies: string | undefined,
    origin: string | undefined
  ) => Promise<WebSocketAuthResult>;
  verifyWsToken: (token: string, expectedAud?: 'ws' | 'ws-agent') => WsTokenPayload | null;
  consumeWsTokenNonce: (payload: WsTokenPayload) => Promise<{ accepted: boolean; result: string }>;
  wsTokenNonceValidationTotal: WsTokenNonceValidationCounter;
}

export interface TradingBroadcastMessage {
  type: TradingBroadcastMessageType;
  symbol?: string;
  marketType?: 'futures' | 'spot' | 'margin';
  marginMode?: 'cross' | 'isolated';
  tenantId?: string;
  data: unknown;
  timestamp: number;
}

export type TradingBroadcastMessageType =
  | 'ticker'
  | 'orderbook'
  | 'klines'
  | 'trades'
  | 'orders'
  | 'positions'
  | 'balance'
  | 'control';

interface CreateTradingBroadcastRuntimeParams {
  logger: ChatWebSocketLogger;
  wss: WebSocketServer;
  nodeEnv: string | undefined;
  redisUrl: string | undefined;
}

interface TradingBroadcastRuntime {
  initializeTradingBroadcastSubscriber: () => Promise<void>;
  closeTradingBroadcastSubscriber: () => Promise<void>;
}

interface CreateRuntimeAnnouncementRuntimeParams {
  logger: ChatWebSocketLogger;
  wss: WebSocketServer;
  nodeEnv: string | undefined;
  redisUrl: string | undefined;
  onAnnouncement?: (announcement: RuntimeAnnouncement) => void;
}

interface RuntimeAnnouncementRuntime {
  initializeRuntimeAnnouncementSubscriber: () => Promise<void>;
  closeRuntimeAnnouncementSubscriber: () => Promise<void>;
}

const PENDING_AUTH_TTL = 5000;
const HEARTBEAT_INTERVAL = 30000;

export function createPendingAuthStore(
  params: CreatePendingAuthStoreParams,
): { pendingAuthResults: Map<string, WebSocketAuthResult>; authCleanupInterval: NodeJS.Timeout } {
  const { logger } = params;

  const pendingAuthResults = new Map<string, WebSocketAuthResult>();

  const authCleanupInterval = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;

    for (const [key] of pendingAuthResults) {
      const timestamp = parseInt(key.split(':').pop() || '0', 10);
      if (now - timestamp > PENDING_AUTH_TTL) {
        pendingAuthResults.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug({ cleaned, remaining: pendingAuthResults.size }, 'Limpeza de auth results pendentes');
    }
  }, 30000);

  return { pendingAuthResults, authCleanupInterval };
}

export function createMainWebSocketServer(
  params: CreateMainWebSocketServerParams,
): { wss: WebSocketServer; heartbeatInterval: NodeJS.Timeout } {
  const {
    logger,
    pendingAuthResults,
    authenticateWebSocketConnection,
    verifyWsToken,
    consumeWsTokenNonce,
    wsTokenNonceValidationTotal,
  } = params;

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 10 * 1024 * 1024,
    verifyClient: async (info, callback) => {
      const origin = info.origin || info.req.headers.origin;
      const cookies = info.req.headers.cookie;

      const url = new URL(info.req.url ?? '/', `http://${info.req.headers.host ?? 'localhost'}`);
      const wsToken = url.searchParams.get('token');

      if (wsToken) {
        const tokenPayload = verifyWsToken(wsToken, 'ws');
        if (tokenPayload) {
          const nonceValidation = await consumeWsTokenNonce(tokenPayload);
          wsTokenNonceValidationTotal.inc({ result: nonceValidation.result });
          if (!nonceValidation.accepted) {
            logger.warn(
              {
                ip: info.req.socket?.remoteAddress,
                result: nonceValidation.result,
                aud: tokenPayload.aud,
                tenantId: tokenPayload.tenantId,
              },
              'WebSocket: token efemero rejeitado por one-time-use',
            );
            callback(false, 401, 'Unauthorized');
            return;
          }

          const authResult: WebSocketAuthResult = {
            authenticated: true,
            userId: tokenPayload.userId,
            tenantId: tokenPayload.tenantId,
            role: tokenPayload.role,
          };
          const tempKey = `${info.req.socket?.remoteAddress}:${Date.now()}`;
          pendingAuthResults.set(tempKey, authResult);
          (info.req as unknown as { __authKey: string }).__authKey = tempKey;
          callback(true);
          return;
        }

        logger.warn({ ip: info.req.socket?.remoteAddress }, 'WebSocket: token efemero invalido ou expirado');
        callback(false, 401, 'Unauthorized');
        return;
      }

      const authResult = await authenticateWebSocketConnection(cookies, origin);

      if (!authResult.authenticated) {
        logger.warn(
          {
            origin,
            error: authResult.error,
            ip: info.req.socket?.remoteAddress,
            hadToken: !!wsToken,
          },
          'WebSocket: Conexão rejeitada - autenticação falhou',
        );
        callback(false, 401, authResult.error || 'Unauthorized');
        return;
      }

      const tempKey = `${info.req.socket?.remoteAddress}:${Date.now()}`;
      pendingAuthResults.set(tempKey, authResult);
      (info.req as unknown as { __authKey: string }).__authKey = tempKey;

      callback(true);
    },
  });

  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const extWs = ws as ExtendedWebSocket;
      if (extWs.isAlive === false) {
        logger.info({ userId: extWs.userId, tenantId: extWs.tenantId }, 'Terminando conexão WebSocket inativa (heartbeat timeout)');
        extWs.terminate();
        return;
      }
      extWs.isAlive = false;
      extWs.ping();
    });
  }, HEARTBEAT_INTERVAL);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return { wss, heartbeatInterval };
}

function extractTradingSymbol(message: TradingBroadcastMessage): string | null {
  if (message.symbol) return message.symbol.toUpperCase();
  if (message.data && typeof message.data === 'object' && 'symbol' in message.data) {
    const value = (message.data as { symbol?: unknown }).symbol;
    if (typeof value === 'string' && value.trim()) {
      return value.trim().toUpperCase();
    }
  }
  return null;
}

function extractTradingInterval(message: TradingBroadcastMessage): string | null {
  if (message.data && typeof message.data === 'object' && 'interval' in message.data) {
    const value = (message.data as { interval?: unknown }).interval;
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function extractTradingMarketType(message: TradingBroadcastMessage): 'futures' | 'spot' | 'margin' | null {
  if (message.marketType) return message.marketType;
  if (message.data && typeof message.data === 'object' && 'marketType' in message.data) {
    const value = (message.data as { marketType?: unknown }).marketType;
    if (value === 'futures' || value === 'spot' || value === 'margin') {
      return value;
    }
  }
  return null;
}

function extractTradingMarginMode(message: TradingBroadcastMessage): 'cross' | 'isolated' | null {
  if (message.marginMode) return message.marginMode;
  if (message.data && typeof message.data === 'object' && 'marginMode' in message.data) {
    const value = (message.data as { marginMode?: unknown }).marginMode;
    if (value === 'cross' || value === 'isolated') {
      return value;
    }
  }
  return null;
}

export function buildTradingSubscriptionKey(params: {
  channel: TradingBroadcastMessageType;
  symbol: string;
  interval?: string | null;
  marketType?: 'futures' | 'spot' | 'margin' | null;
  marginMode?: 'cross' | 'isolated' | null;
}): string {
  const normalizedSymbol = params.symbol.toUpperCase();
  const marketType = params.marketType ?? 'futures';
  const marginMode = marketType === 'futures' ? 'cross' : (params.marginMode ?? 'cross');
  if (params.channel === 'klines') {
    const interval = params.interval ?? '';
    return `${params.channel}:${marketType}:${marginMode}:${normalizedSymbol}:${interval}`;
  }
  return `${params.channel}:${marketType}:${marginMode}:${normalizedSymbol}`;
}

function shouldDeliverTradingMessage(
  extWs: ExtendedWebSocket,
  message: TradingBroadcastMessage,
  symbol: string | null,
): boolean {
  if (message.tenantId && extWs.tenantId && message.tenantId !== extWs.tenantId) {
    return false;
  }
  if (message.type === 'control') {
    return true;
  }
  if (!symbol || !extWs.tradingSubscriptions || extWs.tradingSubscriptions.size === 0) {
    return false;
  }
  const marketType = extractTradingMarketType(message) ?? 'futures';
  const marginMode = extractTradingMarginMode(message) ?? 'cross';
  if (message.type === 'klines') {
    const interval = extractTradingInterval(message);
    if (!interval) return false;
    return extWs.tradingSubscriptions.has(
      buildTradingSubscriptionKey({ channel: message.type, symbol, interval, marketType, marginMode }),
    );
  }
  return extWs.tradingSubscriptions.has(
    buildTradingSubscriptionKey({ channel: message.type, symbol, marketType, marginMode }),
  );
}

export function createTradingBroadcastRuntime(
  params: CreateTradingBroadcastRuntimeParams,
): TradingBroadcastRuntime {
  const {
    logger,
    wss,
    nodeEnv,
    redisUrl,
  } = params;

  let tradingSubscriber: ReturnType<typeof createClient> | null = null;
  let tradingBroadcastMessageCounter = 0;

  function broadcastTradingMessage(message: TradingBroadcastMessage): void {
    const symbol = extractTradingSymbol(message);
    const marketType = extractTradingMarketType(message);
    const marginMode = extractTradingMarginMode(message);
    const payload = {
      type: `trading:${message.type}`,
      symbol: symbol ?? message.symbol,
      marketType,
      marginMode,
      data: message.data,
      timestamp: message.timestamp,
    };

    let openClients = 0;
    let clientsWithSubscriptions = 0;
    let deliveredClients = 0;

    wss.clients.forEach((client) => {
      const wsClient = client as ExtendedWebSocket;
      if (client.readyState !== WebSocket.OPEN) return;
      openClients++;
      if (wsClient.tradingSubscriptions && wsClient.tradingSubscriptions.size > 0) {
        clientsWithSubscriptions++;
      }
      if (!shouldDeliverTradingMessage(wsClient, message, symbol)) return;
      client.send(JSON.stringify(payload));
      deliveredClients++;
    });

    tradingBroadcastMessageCounter++;
    if (tradingBroadcastMessageCounter === 1 || tradingBroadcastMessageCounter % 100 === 0) {
      logger.info(
        {
          messageType: message.type,
          symbol,
          marketType: marketType ?? null,
          marginMode: marginMode ?? null,
          openClients,
          clientsWithSubscriptions,
          deliveredClients,
          totalMessagesProcessed: tradingBroadcastMessageCounter,
        },
        'Broadcast de trading processado',
      );
    }
  }

  async function initializeTradingBroadcastSubscriber(): Promise<void> {
    if (!redisUrl) {
      if (nodeEnv === 'production') {
        throw new Error('REDIS_URL é obrigatório em produção para broadcast de trading');
      }
      logger.warn('REDIS_URL não configurado - broadcast de trading desabilitado (dev/test)');
      return;
    }

    tradingSubscriber = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 10000,
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            if (nodeEnv === 'production') {
              throw new Error('Redis obrigatório em produção para broadcast de trading - max retries reached');
            }
            return new Error('Max retries reached');
          }
          return Math.min(retries * 500, 10000);
        },
      },
    });

    tradingSubscriber.on('error', (error) => {
      logger.error({ error }, 'Erro no Redis subscriber de trading');
    });

    await tradingSubscriber.connect();

    await tradingSubscriber.pSubscribe(`${TRADING_CHANNEL_PREFIX}:*`, (message) => {
      try {
        const parsed = JSON.parse(message) as TradingBroadcastMessage;
        if (!parsed.type || !parsed.timestamp) {
          logger.warn({ message }, 'Mensagem de trading inválida recebida via Redis');
          return;
        }
        broadcastTradingMessage(parsed);
      } catch (error) {
        logger.error({ error, message }, 'Falha ao processar mensagem de trading');
      }
    });

    logger.info(
      { channels: Object.values(TRADING_CHANNELS).length },
      'Redis subscriber de trading inicializado',
    );
  }

  async function closeTradingBroadcastSubscriber(): Promise<void> {
    if (!tradingSubscriber) return;
    logger.info('Encerrando Redis subscriber de trading...');
    await tradingSubscriber.quit();
    tradingSubscriber = null;
    logger.info('Redis subscriber de trading encerrado');
  }

  return {
    initializeTradingBroadcastSubscriber,
    closeTradingBroadcastSubscriber,
  };
}

export function createRuntimeAnnouncementRuntime(
  params: CreateRuntimeAnnouncementRuntimeParams,
): RuntimeAnnouncementRuntime {
  const {
    logger,
    wss,
    nodeEnv,
    redisUrl,
    onAnnouncement,
  } = params;

  let runtimeAnnouncementSubscriber: ReturnType<typeof createClient> | null = null;
  let runtimeAnnouncementCounter = 0;

  function broadcastRuntimeNotice(announcement: RuntimeAnnouncement): void {
    const payload = JSON.stringify({
      type: 'runtime_notice',
      notice: {
        code: announcement.code,
        occurredAt: announcement.occurredAt,
      },
    });

    let openClients = 0;
    let deliveredClients = 0;

    wss.clients.forEach((client) => {
      if (client.readyState !== WebSocket.OPEN) return;
      openClients += 1;
      client.send(payload);
      deliveredClients += 1;
    });

    runtimeAnnouncementCounter += 1;
    if (runtimeAnnouncementCounter === 1 || runtimeAnnouncementCounter % 25 === 0) {
      logger.info(
        {
          code: announcement.code,
          openClients,
          deliveredClients,
          totalAnnouncementsProcessed: runtimeAnnouncementCounter,
        },
        'Broadcast de aviso de runtime processado',
      );
    }
  }

  async function initializeRuntimeAnnouncementSubscriber(): Promise<void> {
    if (!redisUrl) {
      if (nodeEnv === 'production') {
        throw new Error('REDIS_URL é obrigatório em produção para anúncios de runtime');
      }
      logger.warn('REDIS_URL não configurado - anúncios de runtime desabilitados (dev/test)');
      return;
    }

    runtimeAnnouncementSubscriber = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 10000,
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            if (nodeEnv === 'production') {
              throw new Error('Redis obrigatório em produção para anúncios de runtime - max retries reached');
            }
            return new Error('Max retries reached');
          }
          return Math.min(retries * 500, 10000);
        },
      },
    });

    runtimeAnnouncementSubscriber.on('error', (error) => {
      logger.error({ error }, 'Erro no Redis subscriber de anúncios de runtime');
    });

    await runtimeAnnouncementSubscriber.connect();

    await runtimeAnnouncementSubscriber.subscribe(RUNTIME_ANNOUNCEMENTS_CHANNEL, (message) => {
      try {
        const rawParsed = JSON.parse(message) as unknown;
        const parsed = runtimeAnnouncementSchema.safeParse(rawParsed);
        if (!parsed.success) {
          logger.warn(
            {
              issues: parsed.error.issues,
              message,
            },
            'Mensagem de anúncio de runtime inválida recebida via Redis',
          );
          return;
        }

        broadcastRuntimeNotice(parsed.data);

        if (onAnnouncement) {
          onAnnouncement(parsed.data);
        }
      } catch (error) {
        logger.error({ error, message }, 'Falha ao processar anúncio de runtime');
      }
    });

    logger.info(
      { channel: RUNTIME_ANNOUNCEMENTS_CHANNEL },
      'Redis subscriber de anúncios de runtime inicializado',
    );
  }

  async function closeRuntimeAnnouncementSubscriber(): Promise<void> {
    if (!runtimeAnnouncementSubscriber) return;
    logger.info('Encerrando Redis subscriber de anúncios de runtime...');
    await runtimeAnnouncementSubscriber.quit();
    runtimeAnnouncementSubscriber = null;
    logger.info('Redis subscriber de anúncios de runtime encerrado');
  }

  return {
    initializeRuntimeAnnouncementSubscriber,
    closeRuntimeAnnouncementSubscriber,
  };
}
