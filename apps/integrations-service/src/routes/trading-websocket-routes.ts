import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { extractAuthContext, requirePermission } from '@alice/shared-utils';
import { z } from 'zod';

type TradingMarketType = 'futures' | 'spot' | 'margin';
type TradingMarginMode = 'cross' | 'isolated';
type TradingChannel = 'ticker' | 'orderbook' | 'klines' | 'trades';
type SpotMarginMarketType = 'spot' | 'margin';

interface TradingAuthContext {
  tenantId: string;
  userId: string;
}

interface KucoinConfigStatus {
  isConfigured: boolean;
  missingKeys: string[];
}

interface KucoinStateClient {
  getState: () => string;
}

interface KucoinPublicWsClient extends KucoinStateClient {
  isConnected: () => boolean;
  connect: (privateChannel: boolean) => Promise<void>;
  subscribeTicker: (symbol: string) => void;
  subscribeOrderBook: (symbol: string, depth: 5 | 50) => void;
  subscribeTrades: (symbol: string) => void;
  subscribeKlines: (symbol: string, interval: string) => void;
  unsubscribeTicker: (symbol: string) => void;
  unsubscribeOrderBook: (symbol: string, depth: 5 | 50) => void;
  unsubscribeTrades: (symbol: string) => void;
  unsubscribeKlines: (symbol: string, interval: string) => void;
}

interface KucoinSpotPublicWsClient extends KucoinStateClient {
  isConnected: () => boolean;
  connect: (privateChannel: boolean) => Promise<void>;
  subscribeTicker: (symbol: string) => string;
  subscribeOrderBook: (symbol: string, depth: 5 | 50) => string;
  subscribeTrades: (symbol: string) => string;
  subscribeKlines: (symbol: string, interval: string) => string;
  unsubscribe: (topic: string) => void;
}

interface KucoinWsSubscriptionsCounter {
  inc: (labels: { action: string; channel: string; status: string }, value?: number) => void;
}

interface RegisterTradingWebsocketRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  getKucoinConfigStatus: () => KucoinConfigStatus;
  getKucoinCircuitBreakerStatus: () => unknown;
  isKucoinConfigured: () => boolean;
  getTradingServiceStatus: (authContext: TradingAuthContext) => Promise<unknown>;
  getAllowedSymbols: () => Promise<string[]>;
  resolveTradingSymbolForStatus: (authContext?: TradingAuthContext) => Promise<string>;
  getPublicWebSocketClient: () => KucoinPublicWsClient;
  isKucoinWebSocketConfigured: () => boolean;
  getPrivateWebSocketClient: () => KucoinStateClient;
  getSpotPublicWebSocketClient: () => KucoinSpotPublicWsClient;
  isSpotWebSocketConfigured: () => boolean;
  getSpotPrivateWebSocketClient: () => KucoinStateClient;
  resolveTradingIntervals: () => unknown;
  kucoinWsSubscriptionsTotal: KucoinWsSubscriptionsCounter;
  resolveTradingSymbolOrRespond: (
    res: Response,
    authContext: TradingAuthContext,
    symbol?: string,
    options?: { required?: boolean; marketType?: TradingMarketType; marginMode?: TradingMarginMode }
  ) => Promise<string | undefined>;
  resolveKucoinWsOrderBookDepth: () => 5 | 50;
  isValidKucoinWsInterval: (interval: string) => boolean;
  kucoinWsOrderBookDepths: readonly (5 | 50)[];
  registerSpotWsMarketType: (topic: string, marketType: SpotMarginMarketType, marginMode?: TradingMarginMode) => void;
  unregisterSpotWsMarketType: (topic: string, marketType: SpotMarginMarketType, marginMode?: TradingMarginMode) => boolean;
  buildSpotMarketTopic: (params: { channel: TradingChannel; symbol: string; interval?: string; depth?: 5 | 50 }) => string;
  respondKucoinNotConfigured: (res: Response) => void;
  sendKucoinErrorResponse: (res: Response, error: unknown) => boolean;
}

const wsSubscriptionSchema = z.object({
  channel: z.enum(['ticker', 'orderbook', 'klines', 'trades']),
  symbol: z.string().min(1).max(20),
  interval: z.string().max(10).optional(),
  depth: z.coerce.number().int().optional(),
  marketType: z.enum(['futures', 'spot', 'margin']),
  marginMode: z.enum(['cross', 'isolated']).optional(),
});

export function registerTradingWebsocketRoutes(
  app: Express,
  deps: RegisterTradingWebsocketRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  app.get('/api/integrations/trading/status', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = extractAuthContext(req);
      const configStatus = deps.getKucoinConfigStatus();
      const circuitBreakerStatus = deps.getKucoinCircuitBreakerStatus();

      if (!authContext?.tenantId || !authContext?.userId) {
        res.json({
          success: true,
          data: {
            isConfigured: configStatus.isConfigured,
            missingKeys: configStatus.missingKeys,
            circuitBreaker: circuitBreakerStatus,
            riskConfig: null,
            activeSignals: 0,
            pendingOrders: 0,
            requiresTenant: true,
          },
        });
        return;
      }

      const status = await deps.getTradingServiceStatus({
        tenantId: authContext.tenantId,
        userId: authContext.userId,
      });

      res.json({
        success: true,
        data: status,
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter status do trading');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/ws/status', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const configured = deps.isKucoinConfigured();
      if (!configured) {
        res.json({
          success: true,
          data: {
            configured: false,
            supportedMarkets: ['futures', 'spot', 'margin'],
            public: { state: 'disconnected' },
            private: { enabled: false, state: 'disconnected' },
            spot: { public: { state: 'disconnected' }, private: { enabled: false, state: 'disconnected' } },
          },
        });
        return;
      }

      const publicWs = deps.getPublicWebSocketClient();
      const privateEnabled = deps.isKucoinWebSocketConfigured();
      const privateWs = privateEnabled ? deps.getPrivateWebSocketClient() : null;
      const spotPublicWs = deps.getSpotPublicWebSocketClient();
      const spotPrivateEnabled = deps.isSpotWebSocketConfigured();
      const spotPrivateWs = spotPrivateEnabled ? deps.getSpotPrivateWebSocketClient() : null;

      const authContext = extractAuthContext(req);
      const allowedSymbols = await deps.getAllowedSymbols();
      const defaultSymbol = authContext?.tenantId && authContext?.userId
        ? await deps.resolveTradingSymbolForStatus({
          tenantId: authContext.tenantId,
          userId: authContext.userId,
        })
        : await deps.resolveTradingSymbolForStatus();

      res.json({
        success: true,
        data: {
          configured: true,
          allowedSymbols,
          defaultSymbol,
          supportedMarkets: ['futures', 'spot', 'margin'],
          public: { state: publicWs.getState() },
          private: { enabled: privateEnabled, state: privateWs?.getState() ?? 'disconnected' },
          spot: {
            public: { state: spotPublicWs.getState() },
            private: { enabled: spotPrivateEnabled, state: spotPrivateWs?.getState() ?? 'disconnected' },
          },
        },
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter status do WebSocket KuCoin');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/intervals', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
    try {
      const intervals = deps.resolveTradingIntervals();
      res.json({
        success: true,
        data: intervals,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao resolver intervalos de trading');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/ws/subscribe', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = extractAuthContext(req);
      if (!authContext?.tenantId || !authContext?.userId) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const parsed = wsSubscriptionSchema.safeParse(req.body);
      if (!parsed.success) {
        deps.kucoinWsSubscriptionsTotal.inc({ action: 'subscribe', channel: 'unknown', status: 'validation_error' }, 1);
        res.status(400).json({ error: 'Payload inválido', details: parsed.error.flatten() });
        return;
      }

      if (!deps.isKucoinConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }

      const { channel, symbol, interval, depth, marketType, marginMode } = parsed.data;

      if (channel === 'klines') {
        if (!interval) {
          deps.kucoinWsSubscriptionsTotal.inc({ action: 'subscribe', channel, status: 'interval_required' }, 1);
          res.status(400).json({ error: 'Intervalo é obrigatório para klines' });
          return;
        }
        if (!deps.isValidKucoinWsInterval(interval)) {
          deps.kucoinWsSubscriptionsTotal.inc({ action: 'subscribe', channel, status: 'interval_invalid' }, 1);
          res.status(400).json({ error: `Intervalo WS inválido: ${interval}` });
          return;
        }
      }

      if (channel === 'orderbook' && depth !== undefined) {
        if (!deps.kucoinWsOrderBookDepths.includes(depth as (typeof deps.kucoinWsOrderBookDepths)[number])) {
          deps.kucoinWsSubscriptionsTotal.inc({ action: 'subscribe', channel, status: 'depth_invalid' }, 1);
          res.status(400).json({ error: 'depth inválido. Valores permitidos: 5, 50.' });
          return;
        }
      }

      const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };
      const resolvedSymbol = await deps.resolveTradingSymbolOrRespond(res, tradingAuth, symbol, { required: true, marketType, marginMode });
      if (!resolvedSymbol) return;

      const orderBookDepth = (depth ?? deps.resolveKucoinWsOrderBookDepth()) as 5 | 50;

      if (marketType === 'futures') {
        const publicWs = deps.getPublicWebSocketClient();
        if (!publicWs.isConnected()) {
          await publicWs.connect(false);
        }

        if (channel === 'ticker') {
          publicWs.subscribeTicker(resolvedSymbol);
        } else if (channel === 'orderbook') {
          publicWs.subscribeOrderBook(resolvedSymbol, orderBookDepth);
        } else if (channel === 'trades') {
          publicWs.subscribeTrades(resolvedSymbol);
        } else if (channel === 'klines' && interval) {
          publicWs.subscribeKlines(resolvedSymbol, interval);
        }

        deps.kucoinWsSubscriptionsTotal.inc({ action: 'subscribe', channel, status: 'success' }, 1);

        res.json({
          success: true,
          data: {
            channel,
            symbol: resolvedSymbol,
            interval: channel === 'klines' ? interval : undefined,
            depth: channel === 'orderbook' ? orderBookDepth : undefined,
            marketType,
            marginMode,
            state: publicWs.getState(),
          },
        });
        return;
      }

      if (marketType === 'spot' || marketType === 'margin') {
        const publicWs = deps.getSpotPublicWebSocketClient();
        if (!publicWs.isConnected()) {
          await publicWs.connect(false);
        }

        let topic = '';
        if (channel === 'ticker') {
          topic = publicWs.subscribeTicker(resolvedSymbol);
        } else if (channel === 'orderbook') {
          topic = publicWs.subscribeOrderBook(resolvedSymbol, orderBookDepth);
        } else if (channel === 'trades') {
          topic = publicWs.subscribeTrades(resolvedSymbol);
        } else if (channel === 'klines' && interval) {
          topic = publicWs.subscribeKlines(resolvedSymbol, interval);
        }

        if (topic) {
          deps.registerSpotWsMarketType(topic, marketType, marginMode);
        }

        deps.kucoinWsSubscriptionsTotal.inc({ action: 'subscribe', channel, status: 'success' }, 1);

        res.json({
          success: true,
          data: {
            channel,
            symbol: resolvedSymbol,
            interval: channel === 'klines' ? interval : undefined,
            depth: channel === 'orderbook' ? orderBookDepth : undefined,
            marketType,
            marginMode,
            state: publicWs.getState(),
            topic,
          },
        });
        return;
      }

      deps.kucoinWsSubscriptionsTotal.inc({ action: 'subscribe', channel, status: 'unsupported_market' }, 1);
      res.json({
        success: true,
        data: {
          supported: false,
          message: 'MarketType não suportado no WebSocket.',
        },
      });
    } catch (error) {
      const failureChannel = typeof req.body?.channel === 'string' ? req.body.channel : 'unknown';
      deps.kucoinWsSubscriptionsTotal.inc({ action: 'subscribe', channel: failureChannel, status: 'error' }, 1);
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao registrar subscription WS KuCoin');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/ws/unsubscribe', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = extractAuthContext(req);
      if (!authContext?.tenantId || !authContext?.userId) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const parsed = wsSubscriptionSchema.safeParse(req.body);
      if (!parsed.success) {
        deps.kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel: 'unknown', status: 'validation_error' }, 1);
        res.status(400).json({ error: 'Payload inválido', details: parsed.error.flatten() });
        return;
      }

      if (!deps.isKucoinConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }

      const { channel, symbol, interval, depth, marketType, marginMode } = parsed.data;

      if (channel === 'klines') {
        if (!interval) {
          deps.kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel, status: 'interval_required' }, 1);
          res.status(400).json({ error: 'Intervalo é obrigatório para klines' });
          return;
        }
        if (!deps.isValidKucoinWsInterval(interval)) {
          deps.kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel, status: 'interval_invalid' }, 1);
          res.status(400).json({ error: `Intervalo WS inválido: ${interval}` });
          return;
        }
      }

      if (channel === 'orderbook' && depth !== undefined) {
        if (!deps.kucoinWsOrderBookDepths.includes(depth as (typeof deps.kucoinWsOrderBookDepths)[number])) {
          deps.kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel, status: 'depth_invalid' }, 1);
          res.status(400).json({ error: 'depth inválido. Valores permitidos: 5, 50.' });
          return;
        }
      }

      const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };
      const resolvedSymbol = await deps.resolveTradingSymbolOrRespond(res, tradingAuth, symbol, { required: true, marketType, marginMode });
      if (!resolvedSymbol) return;

      const orderBookDepth = (depth ?? deps.resolveKucoinWsOrderBookDepth()) as 5 | 50;

      if (marketType === 'futures') {
        const publicWs = deps.getPublicWebSocketClient();
        if (!publicWs.isConnected()) {
          deps.kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel, status: 'ws_disconnected' }, 1);
          res.status(409).json({ error: 'WebSocket KuCoin não está conectado' });
          return;
        }

        if (channel === 'ticker') {
          publicWs.unsubscribeTicker(resolvedSymbol);
        } else if (channel === 'orderbook') {
          publicWs.unsubscribeOrderBook(resolvedSymbol, orderBookDepth);
        } else if (channel === 'trades') {
          publicWs.unsubscribeTrades(resolvedSymbol);
        } else if (channel === 'klines' && interval) {
          publicWs.unsubscribeKlines(resolvedSymbol, interval);
        }

        deps.kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel, status: 'success' }, 1);

        res.json({
          success: true,
          data: {
            channel,
            symbol: resolvedSymbol,
            interval: channel === 'klines' ? interval : undefined,
            depth: channel === 'orderbook' ? orderBookDepth : undefined,
            marketType,
            marginMode,
            state: publicWs.getState(),
          },
        });
        return;
      }

      if (marketType === 'spot' || marketType === 'margin') {
        const publicWs = deps.getSpotPublicWebSocketClient();
        if (!publicWs.isConnected()) {
          deps.kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel, status: 'ws_disconnected' }, 1);
          res.status(409).json({ error: 'WebSocket KuCoin Spot/Margin não está conectado' });
          return;
        }

        let topic = '';
        if (channel === 'ticker') {
          topic = deps.buildSpotMarketTopic({ channel, symbol: resolvedSymbol });
        } else if (channel === 'orderbook') {
          topic = deps.buildSpotMarketTopic({ channel, symbol: resolvedSymbol, depth: orderBookDepth });
        } else if (channel === 'trades') {
          topic = deps.buildSpotMarketTopic({ channel, symbol: resolvedSymbol });
        } else if (channel === 'klines' && interval) {
          topic = deps.buildSpotMarketTopic({ channel, symbol: resolvedSymbol, interval });
        }

        if (topic) {
          const shouldUnsubscribe = deps.unregisterSpotWsMarketType(topic, marketType, marginMode);
          if (shouldUnsubscribe) {
            publicWs.unsubscribe(topic);
          }
        }

        deps.kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel, status: 'success' }, 1);

        res.json({
          success: true,
          data: {
            channel,
            symbol: resolvedSymbol,
            interval: channel === 'klines' ? interval : undefined,
            depth: channel === 'orderbook' ? orderBookDepth : undefined,
            marketType,
            marginMode,
            state: publicWs.getState(),
            topic,
          },
        });
        return;
      }

      deps.kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel, status: 'unsupported_market' }, 1);
      res.json({
        success: true,
        data: {
          supported: false,
          message: 'MarketType não suportado no WebSocket.',
        },
      });
    } catch (error) {
      const failureChannel = typeof req.body?.channel === 'string' ? req.body.channel : 'unknown';
      deps.kucoinWsSubscriptionsTotal.inc({ action: 'unsubscribe', channel: failureChannel, status: 'error' }, 1);
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao cancelar subscription WS KuCoin');
      res.status(500).json({ error: errorMessage });
    }
  });
}
