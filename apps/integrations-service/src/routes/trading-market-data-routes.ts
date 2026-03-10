import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { extractAuthContext, requirePermission } from '@alice/shared-utils';

type TradingMarketType = 'futures' | 'spot' | 'margin';

interface TradingAuthContext {
  tenantId: string;
  userId: string;
}

interface RegisterTradingMarketDataRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  handleTradingKlinesRequest: (
    req: Request,
    res: Response,
    symbol: string | undefined,
    required: boolean,
  ) => Promise<void>;
  handleTradingOrderBookRequest: (
    req: Request,
    res: Response,
    symbol: string | undefined,
    required: boolean,
  ) => Promise<void>;
  resolveSymbolFromQuery: (req: Request) => string | undefined;
  isKucoinConfigured: () => boolean;
  respondKucoinNotConfigured: (res: Response) => void;
  sendKucoinErrorResponse: (res: Response, error: unknown) => boolean;
  resolveTradingSymbolOrRespond: (
    res: Response,
    authContext: TradingAuthContext,
    symbol: string | undefined,
    options: { required?: boolean; marketType?: TradingMarketType },
  ) => Promise<string | null | undefined>;
  getCurrentFundingRate: (symbol: string) => Promise<unknown>;
  getMarkPrice: (symbol: string) => Promise<unknown>;
  getTradeHistory: (symbol: string) => Promise<unknown>;
  getSpotTrades: (symbol: string) => Promise<unknown>;
}

export function registerTradingMarketDataRoutes(
  app: Express,
  deps: RegisterTradingMarketDataRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  app.get('/api/integrations/trading/klines/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    await deps.handleTradingKlinesRequest(req, res, req.params.symbol, true);
  });

  app.get('/api/integrations/trading/klines', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    const symbol = deps.resolveSymbolFromQuery(req);
    await deps.handleTradingKlinesRequest(req, res, symbol, false);
  });

  app.get('/api/integrations/trading/orderbook/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    await deps.handleTradingOrderBookRequest(req, res, req.params.symbol, true);
  });

  app.get('/api/integrations/trading/orderbook', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    const symbol = deps.resolveSymbolFromQuery(req);
    await deps.handleTradingOrderBookRequest(req, res, symbol, false);
  });

  app.get('/api/integrations/trading/funding-rate/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = extractAuthContext(req);
      if (!authContext?.tenantId || !authContext?.userId) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      if (!deps.isKucoinConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }

      const resolvedSymbol = await deps.resolveTradingSymbolOrRespond(
        res,
        { tenantId: authContext.tenantId, userId: authContext.userId },
        req.params.symbol,
        { required: true },
      );
      if (!resolvedSymbol) return;

      const fundingRate = await deps.getCurrentFundingRate(resolvedSymbol);
      res.json({
        success: true,
        data: fundingRate,
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter funding rate');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/mark-price/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = extractAuthContext(req);
      if (!authContext?.tenantId || !authContext?.userId) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      if (!deps.isKucoinConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }

      const resolvedSymbol = await deps.resolveTradingSymbolOrRespond(
        res,
        { tenantId: authContext.tenantId, userId: authContext.userId },
        req.params.symbol,
        { required: true },
      );
      if (!resolvedSymbol) return;

      const markPrice = await deps.getMarkPrice(resolvedSymbol);
      res.json({
        success: true,
        data: markPrice,
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter mark price');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/trades/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = extractAuthContext(req);
      if (!authContext?.tenantId || !authContext?.userId) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      if (!deps.isKucoinConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }

      const marketType = (req.query.marketType as string) || 'futures';
      const resolvedSymbol = await deps.resolveTradingSymbolOrRespond(
        res,
        { tenantId: authContext.tenantId, userId: authContext.userId },
        req.params.symbol,
        { required: true },
      );
      if (!resolvedSymbol) return;

      const trades = marketType === 'spot' || marketType === 'margin'
        ? await deps.getSpotTrades(resolvedSymbol)
        : await deps.getTradeHistory(resolvedSymbol);

      res.json({
        success: true,
        data: trades,
        symbol: resolvedSymbol,
        marketType,
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter histórico de trades');
      res.status(500).json({ error: errorMessage });
    }
  });
}
