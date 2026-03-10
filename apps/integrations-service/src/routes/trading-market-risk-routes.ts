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

interface TradingOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface RegisterTradingMarketRiskRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isSpotConfigured: () => boolean;
  isMarginConfigured: () => boolean;
  isKucoinConfigured: () => boolean;
  respondKucoinNotConfigured: (res: Response) => void;
  sendKucoinErrorResponse: (res: Response, error: unknown) => boolean;
  resolveMarketTypeParam: (params: {
    marketType?: TradingMarketType;
    type?: TradingMarketType;
  }) => TradingMarketType | undefined;
  resolveSymbolFromQuery: (req: Request) => string | undefined;
  resolveTradingSymbolOrRespond: (
    res: Response,
    authContext: TradingAuthContext,
    symbol?: string,
    options?: { required?: boolean; marketType?: TradingMarketType; marginMode?: TradingMarginMode },
  ) => Promise<string | undefined>;
  getMarketData: (
    authContext: TradingAuthContext,
    symbol: string,
    marketType?: TradingMarketType,
    marginMode?: TradingMarginMode,
  ) => Promise<unknown>;
  getAccountOverview: (marketType?: TradingMarketType, marginMode?: TradingMarginMode) => Promise<unknown>;
  getKucoinPositions: (marketType?: TradingMarketType, marginMode?: TradingMarginMode) => Promise<unknown>;
  closePositions: (authContext: TradingAuthContext, symbol?: string) => Promise<TradingOperationResult>;
  createStopOrder: (
    authContext: TradingAuthContext,
    payload: {
      symbol: string;
      side: 'buy' | 'sell';
      size: number;
      stopLoss?: number;
      takeProfit?: number;
      orderType?: 'limit' | 'market';
      price?: number;
      stopPriceType?: 'TP' | 'MP';
      marketType?: TradingMarketType;
      marginMode?: TradingMarginMode;
    },
  ) => Promise<TradingOperationResult>;
  getRiskConfig: (authContext: TradingAuthContext) => Promise<unknown>;
  upsertRiskConfig: (authContext: TradingAuthContext, payload: Record<string, unknown>) => Promise<TradingOperationResult>;
}

const marketQuerySchema = z.object({
  marketType: z.enum(['futures', 'spot', 'margin']).optional(),
  type: z.enum(['futures', 'spot', 'margin']).optional(),
  marginMode: z.enum(['cross', 'isolated']).optional(),
});

const accountQuerySchema = z.object({
  marketType: z.enum(['futures', 'spot', 'margin']).optional(),
  marginMode: z.enum(['cross', 'isolated']).optional(),
});

const positionsQuerySchema = z.object({
  marketType: z.enum(['futures', 'spot', 'margin']).optional(),
  marginMode: z.enum(['cross', 'isolated']).optional(),
});

const closePositionParamSchema = z.object({
  symbol: z.string().min(1),
});

const closePositionQuerySchema = z.object({
  marketType: z.enum(['futures', 'spot', 'margin']).optional(),
});

const stopPositionParamSchema = z.object({
  symbol: z.string().min(1),
});

const stopPositionBodySchema = z.object({
  side: z.enum(['buy', 'sell']),
  size: z.number().positive(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  orderType: z.enum(['limit', 'market']).optional(),
  price: z.number().positive().optional(),
  stopPriceType: z.enum(['TP', 'MP']).optional(),
  marketType: z.enum(['futures', 'spot', 'margin']).optional(),
  marginMode: z.enum(['cross', 'isolated']).optional(),
});

const closeAllPositionsBodySchema = z.object({
  symbol: z.string().optional(),
  marketType: z.enum(['futures', 'spot', 'margin']).optional(),
  marginMode: z.enum(['cross', 'isolated']).optional(),
}).strict();

const riskConfigSchema = z.object({
  maxPositionSize: z.string().optional(),
  maxDailyLoss: z.string().optional(),
  maxOrderValue: z.string().optional(),
  maxLeverage: z.number().optional(),
  maxOpenPositions: z.number().optional(),
  defaultLeverage: z.number().optional(),
  defaultStopLoss: z.string().optional(),
  defaultTakeProfit: z.string().optional(),
  defaultSymbol: z.string().optional(),
  defaultMarketType: z.enum(['futures', 'spot', 'margin']).optional(),
  marginMode: z.enum(['cross', 'isolated']).optional(),
  tradingEnabled: z.boolean().optional(),
});

function getTradingAuthContext(req: Request): TradingAuthContext | null {
  const authContext = extractAuthContext(req);
  if (!authContext?.tenantId || !authContext?.userId) {
    return null;
  }
  return { tenantId: authContext.tenantId, userId: authContext.userId };
}

function ensureMarketConnectivity(
  res: Response,
  deps: RegisterTradingMarketRiskRoutesDeps,
  marketType?: TradingMarketType,
): boolean {
  if (marketType === 'spot' && !deps.isSpotConfigured()) {
    deps.respondKucoinNotConfigured(res);
    return false;
  }
  if (marketType === 'margin' && !deps.isMarginConfigured()) {
    deps.respondKucoinNotConfigured(res);
    return false;
  }
  if ((!marketType || marketType === 'futures') && !deps.isKucoinConfigured()) {
    deps.respondKucoinNotConfigured(res);
    return false;
  }
  return true;
}

export function registerTradingMarketRiskRoutes(
  app: Express,
  deps: RegisterTradingMarketRiskRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  async function handleTradingMarketRequest(
    req: Request,
    res: Response,
    symbol: string | undefined,
    required = true,
  ): Promise<void> {
    try {
      const tradingAuth = getTradingAuthContext(req);
      if (!tradingAuth) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const queryResult = marketQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
        return;
      }

      const marketType = deps.resolveMarketTypeParam(queryResult.data);
      const marginMode = queryResult.data.marginMode;

      if (!ensureMarketConnectivity(res, deps, marketType)) {
        return;
      }

      const resolvedSymbol = await deps.resolveTradingSymbolOrRespond(
        res,
        tradingAuth,
        symbol,
        { required, marketType, marginMode },
      );
      if (!resolvedSymbol) return;

      const marketData = await deps.getMarketData(tradingAuth, resolvedSymbol, marketType, marginMode);

      res.json({
        success: true,
        data: marketData,
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter dados de mercado');
      res.status(500).json({ error: errorMessage });
    }
  }

  app.get('/api/integrations/trading/market/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    await handleTradingMarketRequest(req, res, req.params.symbol, true);
  });

  app.get('/api/integrations/trading/market', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    const symbol = deps.resolveSymbolFromQuery(req);
    await handleTradingMarketRequest(req, res, symbol, false);
  });

  app.get('/api/integrations/trading/account', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const queryResult = accountQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
        return;
      }

      const { marketType, marginMode } = queryResult.data;
      if (!ensureMarketConnectivity(res, deps, marketType)) {
        return;
      }

      const account = await deps.getAccountOverview(marketType, marginMode);

      res.json({
        success: true,
        data: account,
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter dados da conta');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/positions', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const queryResult = positionsQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
        return;
      }

      const { marketType, marginMode } = queryResult.data;
      if (!ensureMarketConnectivity(res, deps, marketType)) {
        return;
      }

      if (marketType === 'spot' || marketType === 'margin') {
        res.json({
          success: true,
          data: [],
          marketType,
          marginMode,
          message: 'Posições são suportadas apenas para Futures. Use /account para saldos.',
        });
        return;
      }

      const positions = await deps.getKucoinPositions(marketType, marginMode);
      res.json({
        success: true,
        data: positions,
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter posições');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/positions/:symbol/close', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const tradingAuth = getTradingAuthContext(req);
      if (!tradingAuth) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const paramResult = closePositionParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'Símbolo inválido', details: paramResult.error.flatten() });
        return;
      }

      const queryResult = closePositionQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
        return;
      }

      if (queryResult.data.marketType && queryResult.data.marketType !== 'futures') {
        res.status(400).json({ error: 'Fechamento de posição via API disponível apenas para Futures.' });
        return;
      }

      const result = await deps.closePositions(tradingAuth, paramResult.data.symbol);
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
      logger.error({ error: errorMessage }, 'Erro ao fechar posição');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/positions/:symbol/stop', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const tradingAuth = getTradingAuthContext(req);
      if (!tradingAuth) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const paramResult = stopPositionParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'Símbolo inválido', details: paramResult.error.flatten() });
        return;
      }

      const bodyResult = stopPositionBodySchema.safeParse(req.body ?? {});
      if (!bodyResult.success) {
        res.status(400).json({ error: 'Dados inválidos', details: bodyResult.error.flatten() });
        return;
      }

      const result = await deps.createStopOrder(tradingAuth, {
        symbol: paramResult.data.symbol,
        side: bodyResult.data.side,
        size: bodyResult.data.size,
        stopLoss: bodyResult.data.stopLoss,
        takeProfit: bodyResult.data.takeProfit,
        orderType: bodyResult.data.orderType,
        price: bodyResult.data.price,
        stopPriceType: bodyResult.data.stopPriceType,
        marketType: bodyResult.data.marketType,
        marginMode: bodyResult.data.marginMode,
      });

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
      logger.error({ error: errorMessage }, 'Erro ao criar ordem stop');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.delete('/api/integrations/trading/positions', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const tradingAuth = getTradingAuthContext(req);
      if (!tradingAuth) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const parsed = closeAllPositionsBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
        return;
      }

      const marketType = parsed.data.marketType ?? 'futures';
      if (marketType !== 'futures') {
        res.status(400).json({ error: 'Fechamento de posições é suportado apenas em Futures.' });
        return;
      }
      if (!deps.isKucoinConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }

      const result = await deps.closePositions(tradingAuth, parsed.data.symbol);
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
      logger.error({ error: errorMessage }, 'Erro ao fechar posições');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/risk-config', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const tradingAuth = getTradingAuthContext(req);
      if (!tradingAuth) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const config = await deps.getRiskConfig(tradingAuth);
      res.json({
        success: true,
        data: config,
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter configuração de risco');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.put('/api/integrations/trading/risk-config', requirePermission('integrations:trading:manage'), async (req: Request, res: Response) => {
    try {
      const tradingAuth = getTradingAuthContext(req);
      if (!tradingAuth) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const validatedResult = riskConfigSchema.safeParse(req.body);
      if (!validatedResult.success) {
        res.status(400).json({ error: 'Dados inválidos', details: validatedResult.error.flatten() });
        return;
      }
      const validated = validatedResult.data;

      const defaultSymbolParam = validated.defaultSymbol;
      const resolvedDefaultSymbol = defaultSymbolParam
        ? await deps.resolveTradingSymbolOrRespond(res, tradingAuth, defaultSymbolParam, {
          required: true,
          marketType: validated.defaultMarketType,
          marginMode: validated.marginMode,
        })
        : undefined;
      if (defaultSymbolParam && !resolvedDefaultSymbol) return;

      const configForDb: Record<string, unknown> = {
        maxPositionSize: validated.maxPositionSize ? Number(validated.maxPositionSize) : undefined,
        maxDailyLoss: validated.maxDailyLoss ? Number(validated.maxDailyLoss) : undefined,
        maxOrderValue: validated.maxOrderValue ? Number(validated.maxOrderValue) : undefined,
        maxLeverage: validated.maxLeverage,
        maxOpenPositions: validated.maxOpenPositions,
        defaultLeverage: validated.defaultLeverage,
        defaultSymbol: resolvedDefaultSymbol,
        defaultStopLoss: validated.defaultStopLoss ? Number(validated.defaultStopLoss) : undefined,
        defaultTakeProfit: validated.defaultTakeProfit ? Number(validated.defaultTakeProfit) : undefined,
        defaultMarketType: validated.defaultMarketType,
        marginMode: validated.marginMode,
        tradingEnabled: validated.tradingEnabled,
        autoExecuteSignals: false,
        minConfidenceToExecute: undefined,
      };

      const result = await deps.upsertRiskConfig(tradingAuth, configForDb);
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
      logger.error({ error: errorMessage }, 'Erro ao atualizar configuração de risco');
      res.status(500).json({ error: errorMessage });
    }
  });
}
