import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { extractAuthContext, requirePermission } from '@alice/shared-utils';
import { z } from 'zod';

type TradingMarketType = 'futures' | 'spot' | 'margin';
type TradingMarginMode = 'cross' | 'isolated';

interface TradingAuthContext {
  tenantId: string;
  userId: string;
}

interface TradingSymbolsResult {
  symbols: string[];
}

interface TradingSymbolPreferencesResult {
  favorites: string[];
  featured: string[];
}

interface RegisterTradingSymbolRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isSpotConfigured: () => boolean;
  isMarginConfigured: () => boolean;
  isKucoinConfigured: () => boolean;
  getTradingSymbols: (
    authContext: TradingAuthContext,
    marketType?: TradingMarketType,
    marginMode?: TradingMarginMode,
  ) => Promise<TradingSymbolsResult>;
  resolveTradingSymbol: (
    authContext: TradingAuthContext,
    symbol?: string,
    marketType?: TradingMarketType,
    marginMode?: TradingMarginMode,
  ) => Promise<string>;
  getTopSymbolsByMarket: (
    authContext: TradingAuthContext,
    marketType?: TradingMarketType,
    marginMode?: TradingMarginMode,
    limit?: number,
  ) => Promise<string[]>;
  fetchTradingSymbolPreferences: (
    tenantId: string,
    userId: string,
    marketType: TradingMarketType,
    marginMode: TradingMarginMode,
  ) => Promise<TradingSymbolPreferencesResult | null>;
  normalizeSymbolList: (rawSymbols: string[], availableSymbols: string[]) => string[];
  upsertTradingSymbolPreferences: (params: {
    tenantId: string;
    userId: string;
    marketType: TradingMarketType;
    marginMode: TradingMarginMode;
    favorites?: string[];
    featured?: string[];
  }) => Promise<unknown>;
  respondKucoinNotConfigured: (res: Response) => void;
  sendKucoinErrorResponse: (res: Response, error: unknown) => boolean;
}

const marketQuerySchema = z.object({
  marketType: z.enum(['futures', 'spot', 'margin']).optional(),
  marginMode: z.enum(['cross', 'isolated']).optional(),
});

const preferenceQuerySchema = z.object({
  marketType: z.enum(['futures', 'spot', 'margin']).optional().default('futures'),
  marginMode: z.enum(['cross', 'isolated']).optional().default('cross'),
});

const preferenceBodySchema = z.object({
  marketType: z.enum(['futures', 'spot', 'margin']).optional().default('futures'),
  marginMode: z.enum(['cross', 'isolated']).optional().default('cross'),
  favorites: z.array(z.string().min(1).max(20)).optional(),
  featured: z.array(z.string().min(1).max(20)).optional(),
});

export function registerTradingSymbolRoutes(
  app: Express,
  deps: RegisterTradingSymbolRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  app.get('/api/integrations/trading/symbols', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = extractAuthContext(req);
      if (!authContext?.tenantId || !authContext?.userId) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const queryResult = marketQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
        return;
      }

      const { marketType, marginMode } = queryResult.data;
      if (marketType === 'spot' && !deps.isSpotConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }
      if (marketType === 'margin' && !deps.isMarginConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }
      if (!marketType || marketType === 'futures') {
        if (!deps.isKucoinConfigured()) {
          deps.respondKucoinNotConfigured(res);
          return;
        }
      }

      const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };
      const { symbols } = await deps.getTradingSymbols(tradingAuth, marketType, marginMode);
      const sortedSymbols = [...symbols].sort((a, b) => a.localeCompare(b));
      const defaultSymbol = await deps.resolveTradingSymbol(tradingAuth, undefined, marketType, marginMode);
      const topSymbols = await deps.getTopSymbolsByMarket(tradingAuth, marketType, marginMode, 12);
      const preferences = await deps.fetchTradingSymbolPreferences(
        authContext.tenantId,
        authContext.userId,
        marketType ?? 'futures',
        marketType === 'margin' ? marginMode ?? 'cross' : 'cross',
      );
      const favorites = deps.normalizeSymbolList(preferences?.favorites ?? [], symbols);
      const featured = deps.normalizeSymbolList(preferences?.featured ?? [], symbols);

      res.json({
        success: true,
        data: {
          symbols: sortedSymbols,
          defaultSymbol,
          favorites,
          featured,
          topSymbols,
        },
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao listar símbolos de trading');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/symbol-preferences', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = extractAuthContext(req);
      if (!authContext?.tenantId || !authContext?.userId) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const parsedQuery = preferenceQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({ error: 'Query inválida', details: parsedQuery.error.flatten() });
        return;
      }

      const { marketType, marginMode } = parsedQuery.data;
      const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };
      const { symbols } = await deps.getTradingSymbols(tradingAuth, marketType, marginMode);
      const topSymbols = await deps.getTopSymbolsByMarket(tradingAuth, marketType, marginMode, 12);
      const preferences = await deps.fetchTradingSymbolPreferences(authContext.tenantId, authContext.userId, marketType, marginMode);
      const favorites = deps.normalizeSymbolList(preferences?.favorites ?? [], symbols);
      const featured = deps.normalizeSymbolList(preferences?.featured ?? [], symbols);

      res.json({
        success: true,
        data: {
          marketType,
          marginMode,
          favorites,
          featured,
          topSymbols,
        },
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao carregar preferências de símbolos');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.put('/api/integrations/trading/symbol-preferences', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = extractAuthContext(req);
      if (!authContext?.tenantId || !authContext?.userId) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const parsedBody = preferenceBodySchema.safeParse(req.body);
      if (!parsedBody.success) {
        res.status(400).json({ error: 'Dados inválidos', details: parsedBody.error.flatten() });
        return;
      }

      const { marketType, marginMode, favorites: favoritesRaw, featured: featuredRaw } = parsedBody.data;
      const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };
      const { symbols } = await deps.getTradingSymbols(tradingAuth, marketType, marginMode);
      const favorites = favoritesRaw ? deps.normalizeSymbolList(favoritesRaw, symbols) : undefined;
      const featured = featuredRaw ? deps.normalizeSymbolList(featuredRaw, symbols) : undefined;

      const data = await deps.upsertTradingSymbolPreferences({
        tenantId: authContext.tenantId,
        userId: authContext.userId,
        marketType,
        marginMode,
        favorites,
        featured,
      });

      res.json({ success: true, data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao atualizar preferências de símbolos');
      res.status(500).json({ error: errorMessage });
    }
  });
}
