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

interface RegisterTradingStopOrderRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isKucoinConfigured: () => boolean;
  isSpotConfigured: () => boolean;
  isMarginConfigured: () => boolean;
  respondKucoinNotConfigured: (res: Response) => void;
  sendKucoinErrorResponse: (res: Response, error: unknown) => boolean;
  resolveTradingSymbolOrRespond: (
    res: Response,
    authContext: TradingAuthContext,
    symbol: string | undefined,
    options: { required?: boolean; marketType?: TradingMarketType; marginMode?: TradingMarginMode },
  ) => Promise<string | null | undefined>;
  getOpenStopOrders: (
    authContext: TradingAuthContext,
    symbol: string,
    marketType?: TradingMarketType,
    marginMode?: TradingMarginMode,
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  cancelStopOrder: (
    authContext: TradingAuthContext,
    orderId: string,
    marketType?: TradingMarketType,
    marginMode?: TradingMarginMode,
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  resolveTradingSymbol: (
    authContext: TradingAuthContext,
    symbol?: string,
    marketType?: TradingMarketType,
    marginMode?: TradingMarginMode,
  ) => Promise<string | null | undefined>;
}

export function registerTradingStopOrderRoutes(
  app: Express,
  deps: RegisterTradingStopOrderRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  app.get('/api/integrations/trading/stop-orders', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = extractAuthContext(req);
      if (!authContext?.tenantId || !authContext?.userId) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };

      const querySchema = z.object({
        symbol: z.string().optional(),
        marketType: z.enum(['futures', 'spot', 'margin']).optional(),
        marginMode: z.enum(['cross', 'isolated']).optional(),
      });
      const queryResult = querySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
        return;
      }

      const { symbol: symbolParam, marketType, marginMode } = queryResult.data;
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

      const resolvedSymbol = symbolParam
        ? await deps.resolveTradingSymbolOrRespond(res, tradingAuth, symbolParam, { required: true, marketType, marginMode })
        : await deps.resolveTradingSymbol(tradingAuth, undefined, marketType, marginMode);
      if (!resolvedSymbol) return;

      const result = await deps.getOpenStopOrders(tradingAuth, resolvedSymbol, marketType, marginMode);
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({
        success: true,
        data: result.data,
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao listar ordens stop');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.delete('/api/integrations/trading/stop-orders/:id', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = extractAuthContext(req);
      if (!authContext?.tenantId || !authContext?.userId) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const orderIdSchema = z.object({ id: z.string().min(1) });
      const paramResult = orderIdSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'ID de ordem inválido' });
        return;
      }

      const querySchema = z.object({
        marketType: z.enum(['futures', 'spot', 'margin']).optional(),
        marginMode: z.enum(['cross', 'isolated']).optional(),
      });
      const queryResult = querySchema.safeParse(req.query);
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

      const result = await deps.cancelStopOrder(
        { tenantId: authContext.tenantId, userId: authContext.userId },
        paramResult.data.id,
        marketType,
        marginMode,
      );
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({
        success: true,
        data: result.data,
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao cancelar ordem stop');
      res.status(500).json({ error: errorMessage });
    }
  });
}
