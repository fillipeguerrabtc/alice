import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, asc, desc, eq, inArray, lt, sql } from '@alice/database';
import { getDatabase, schema } from '@alice/database';
import { extractAuthContext, requirePermission, verifyImmutableAuditChain } from '@alice/shared-utils';
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
  auditLogId?: string;
}

interface OrdersSyncResult {
  filledOrders: schema.TradingOrder[];
  [key: string]: unknown;
}

interface RegisterTradingOrderGovernanceRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  sendKucoinErrorResponse: (res: Response, error: unknown) => boolean;
  respondKucoinNotConfigured: (res: Response) => void;
  isKucoinConfigured: () => boolean;
  isSpotConfigured: () => boolean;
  isMarginConfigured: () => boolean;
  resolveTradingSymbolOrRespond: (
    res: Response,
    authContext: TradingAuthContext,
    symbol?: string,
    options?: { required?: boolean; marketType?: TradingMarketType; marginMode?: TradingMarginMode },
  ) => Promise<string | undefined>;
  resolveTradingSymbol: (
    authContext: TradingAuthContext,
    symbol?: string,
    marketType?: TradingMarketType,
    marginMode?: TradingMarginMode,
  ) => Promise<string>;
  getOrders: (
    authContext: TradingAuthContext,
    params: {
      status?: 'pending_review' | 'review_rejected' | 'pending' | 'submitted' | 'open' | 'filled' | 'cancelled' | 'rejected' | 'expired' | 'error';
      limit?: number;
      marketType?: TradingMarketType;
    },
  ) => Promise<schema.TradingOrder[]>;
  updatePendingOrder: (
    authContext: TradingAuthContext,
    orderId: string,
    payload: {
      price?: number;
      size?: number;
      leverage?: number;
      orderType?: 'limit' | 'market' | 'stop_limit' | 'stop_market' | 'take_profit';
      stopLoss?: number;
      takeProfit?: number;
    },
  ) => Promise<TradingOperationResult<schema.TradingOrder>>;
  approvePendingOrder: (
    authContext: TradingAuthContext,
    orderId: string,
  ) => Promise<TradingOperationResult<schema.TradingOrder>>;
  rejectPendingOrder: (
    authContext: TradingAuthContext,
    orderId: string,
    reason?: string,
  ) => Promise<TradingOperationResult<schema.TradingOrder>>;
  createOrderFromSignal: (
    authContext: TradingAuthContext,
    payload: {
      signalId: string;
      symbol?: string;
      side: 'buy' | 'sell';
      orderType: 'limit' | 'market';
      size?: number;
      funds?: number;
      price?: number;
      leverage?: number;
      marketType?: TradingMarketType;
      marginMode?: TradingMarginMode;
    },
  ) => Promise<TradingOperationResult<schema.TradingOrder>>;
  createManualOrder: (
    authContext: TradingAuthContext,
    payload: {
      symbol?: string;
      side: 'buy' | 'sell';
      orderType: 'limit' | 'market';
      size?: number;
      funds?: number;
      price?: number;
      leverage?: number;
      marketType?: TradingMarketType;
      marginMode?: TradingMarginMode;
    },
  ) => Promise<TradingOperationResult<schema.TradingOrder>>;
  cancelOrder: (
    authContext: TradingAuthContext,
    orderId: string,
  ) => Promise<TradingOperationResult<schema.TradingOrder>>;
  syncOrdersStatus: (authContext: TradingAuthContext) => Promise<OrdersSyncResult>;
  createTradingDatasetFromOrder: (params: {
    authContext: TradingAuthContext;
    order: schema.TradingOrder;
  }) => Promise<unknown>;
  createStopOrder: (
    authContext: TradingAuthContext,
    payload: {
      symbol: string;
      side: 'buy' | 'sell';
      size: number;
      stopLoss?: number;
      takeProfit?: number;
      leverage?: number;
      orderType?: 'limit' | 'market';
      price?: number;
      stopPriceType?: 'TP' | 'MP';
      marketType?: TradingMarketType;
      marginMode?: TradingMarginMode;
    },
  ) => Promise<TradingOperationResult<unknown>>;
  isAdminUser: (authContext: TradingAuthContext) => Promise<boolean>;
}

function getTradingAuthContext(req: Request): TradingAuthContext | null {
  const authContext = extractAuthContext(req);
  if (!authContext?.tenantId || !authContext?.userId) {
    return null;
  }
  return { tenantId: authContext.tenantId, userId: authContext.userId };
}

const tradingUuidParamSchema = z.object({
  id: z.string().uuid('ID deve ser UUID válido'),
});

const ordersListQuerySchema = z.object({
  status: z.enum([
    'pending_review',
    'review_rejected',
    'pending',
    'submitted',
    'open',
    'filled',
    'cancelled',
    'rejected',
    'expired',
    'error',
  ]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  marketType: z.enum(['futures', 'spot', 'margin']).optional(),
});

const reviewOrderBodySchema = z.object({
  price: z.number().positive().optional(),
  size: z.number().positive().optional(),
  leverage: z.number().min(1).max(100).optional(),
  orderType: z.enum(['limit', 'market', 'stop_limit', 'stop_market', 'take_profit']).optional(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
});

const rejectPendingOrderBodySchema = z.object({
  reason: z.string().min(3).max(500).optional(),
});

const auditParamsSchema = z.object({
  entityType: z.enum(['signal', 'order', 'risk_config', 'position']),
  id: z.string().uuid(),
});

const baseOrderSchema = z.object({
  symbol: z.string().optional(),
  side: z.enum(['buy', 'sell']),
  orderType: z.enum(['limit', 'market']),
  size: z.number().positive().optional(),
  funds: z.number().positive().optional(),
  price: z.number().positive().optional(),
  leverage: z.number().min(1).max(100).optional(),
  marketType: z.enum(['futures', 'spot', 'margin']).optional(),
  marginMode: z.enum(['cross', 'isolated']).optional(),
}).strict();

const orderFromSignalSchema = baseOrderSchema
  .extend({ signalId: z.string().uuid() })
  .superRefine((data, ctx) => {
    if (data.orderType === 'limit' && data.price === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Preço é obrigatório para ordens do tipo "limit".',
        path: ['price'],
      });
    }
    const marketType = data.marketType ?? 'futures';
    if (marketType === 'futures' && (!data.size || !Number.isInteger(data.size))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Quantidade deve ser inteira (contratos) para Futures.',
        path: ['size'],
      });
    }
    if (marketType !== 'futures' && data.orderType === 'market' && data.side === 'buy' && !data.size && !data.funds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe size ou funds para ordens market de compra.',
        path: ['size'],
      });
    }
    if (marketType !== 'futures' && data.orderType === 'limit' && !data.size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Quantidade é obrigatória para ordens limit em Spot/Margin.',
        path: ['size'],
      });
    }
    if (marketType !== 'futures' && data.orderType === 'market' && data.side !== 'buy' && !data.size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Quantidade é obrigatória para ordens market de venda em Spot/Margin.',
        path: ['size'],
      });
    }
  });

const manualOrderSchema = baseOrderSchema.superRefine((data, ctx) => {
  if (data.orderType === 'limit' && data.price === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Preço é obrigatório para ordens do tipo "limit".',
      path: ['price'],
    });
  }
  const marketType = data.marketType ?? 'futures';
  if (marketType === 'futures' && (!data.size || !Number.isInteger(data.size))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Quantidade deve ser inteira (contratos) para Futures.',
      path: ['size'],
    });
  }
  if (marketType !== 'futures' && data.orderType === 'market' && data.side === 'buy' && !data.size && !data.funds) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Informe size ou funds para ordens market de compra.',
      path: ['size'],
    });
  }
  if (marketType !== 'futures' && data.orderType === 'limit' && !data.size) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Quantidade é obrigatória para ordens limit em Spot/Margin.',
      path: ['size'],
    });
  }
  if (marketType !== 'futures' && data.orderType === 'market' && data.side !== 'buy' && !data.size) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Quantidade é obrigatória para ordens market de venda em Spot/Margin.',
      path: ['size'],
    });
  }
});

const stopOrderSchema = z.object({
  symbol: z.string().optional(),
  side: z.enum(['buy', 'sell']),
  size: z.number().positive(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  leverage: z.number().int().min(1).max(100).optional(),
  orderType: z.enum(['limit', 'market']).optional(),
  price: z.number().positive().optional(),
  stopPriceType: z.enum(['TP', 'MP']).optional(),
  marketType: z.enum(['futures', 'spot', 'margin']).optional(),
  marginMode: z.enum(['cross', 'isolated']).optional(),
})
  .refine((data) => data.stopLoss || data.takeProfit, {
    message: 'Pelo menos stopLoss ou takeProfit deve ser definido',
  })
  .superRefine((data, ctx) => {
    const marketType = data.marketType ?? 'futures';
    if (data.orderType === 'limit' && data.price === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Preço é obrigatório quando orderType="limit".',
        path: ['price'],
      });
    }
    if ((data.stopLoss !== undefined || data.takeProfit !== undefined) && !data.stopPriceType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'stopPriceType é obrigatório quando stopLoss ou takeProfit são informados.',
        path: ['stopPriceType'],
      });
    }
    if (marketType === 'futures' && !Number.isInteger(data.size)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Quantidade deve ser inteira (contratos) para Futures.',
        path: ['size'],
      });
    }
  });

const ordersHistoryQuerySchema = z.object({
  symbol: z.string().optional(),
  marketType: z.enum(['futures', 'spot', 'margin']).optional(),
  status: z.enum([
    'pending_review',
    'review_rejected',
    'pending',
    'submitted',
    'open',
    'filled',
    'cancelled',
    'rejected',
    'expired',
    'error',
  ]).optional(),
  side: z.enum(['buy', 'sell']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().datetime().optional(),
});

const historyDeleteBodySchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
  all: z.boolean().optional(),
  scope: z.enum(['self', 'tenant']).optional(),
});

function buildNotDeletedOrderMetadataCondition() {
  return sql<boolean>`COALESCE((${schema.tradingOrders.metadata} ->> 'isDeleted')::boolean, false) = false`;
}

function buildOwnerOrderMetadataCondition(userId: string) {
  return sql<boolean>`(${schema.tradingOrders.metadata} ->> 'createdByUserId') = ${userId}`;
}

function buildOrderSoftDeleteMetadataUpdate(deletedAt: string, deletedByUserId: string) {
  return sql`
    jsonb_set(
      jsonb_set(
        jsonb_set(coalesce(${schema.tradingOrders.metadata}, '{}'::jsonb), '{isDeleted}', 'true'::jsonb, true),
        '{deletedAt}', to_jsonb(${deletedAt}), true
      ),
      '{deletedByUserId}', to_jsonb(${deletedByUserId}), true
    )
  `;
}

export function registerTradingOrderGovernanceRoutes(
  app: Express,
  deps: RegisterTradingOrderGovernanceRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  app.get('/api/integrations/trading/orders', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const queryResult = ordersListQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
        return;
      }

      const orders = await deps.getOrders(authContext, {
        status: queryResult.data.status,
        limit: queryResult.data.limit ?? 50,
        marketType: queryResult.data.marketType,
      });

      res.json({ success: true, data: orders });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter ordens');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/orders/history', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const queryResult = ordersHistoryQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
        return;
      }

      const symbolParam = queryResult.data.symbol;
      const resolvedSymbol = symbolParam
        ? await deps.resolveTradingSymbolOrRespond(res, authContext, symbolParam, { required: true })
        : undefined;
      if (symbolParam && !resolvedSymbol) return;

      const limit = queryResult.data.limit ?? 50;
      const cursorDate = queryResult.data.cursor ? new Date(queryResult.data.cursor) : null;
      const marketType = queryResult.data.marketType ?? undefined;
      const status = queryResult.data.status ?? undefined;
      const side = queryResult.data.side ?? undefined;

      const conditions = [eq(schema.tradingOrders.tenantId, authContext.tenantId)];
      if (resolvedSymbol) conditions.push(eq(schema.tradingOrders.symbol, resolvedSymbol));
      if (marketType) conditions.push(eq(schema.tradingOrders.marketType, marketType));
      if (status) conditions.push(eq(schema.tradingOrders.status, status));
      if (side) conditions.push(eq(schema.tradingOrders.side, side));
      if (cursorDate) conditions.push(lt(schema.tradingOrders.criadoEm, cursorDate));
      conditions.push(buildNotDeletedOrderMetadataCondition());

      const db = getDatabase();
      const history = await db
        .select()
        .from(schema.tradingOrders)
        .where(and(...conditions))
        .orderBy(desc(schema.tradingOrders.criadoEm))
        .limit(limit);

      const nextCursor = history.length > 0
        ? history[history.length - 1]?.criadoEm?.toISOString() ?? null
        : null;

      res.json({
        success: true,
        data: history,
        nextCursor,
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter histórico de ordens');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/orders/history/delete', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const bodyResult = historyDeleteBodySchema.safeParse(req.body ?? {});
      if (!bodyResult.success) {
        res.status(400).json({ error: 'Dados inválidos', details: bodyResult.error.flatten() });
        return;
      }

      const { ids, all, scope } = bodyResult.data;
      if (!ids?.length && !all) {
        res.status(400).json({ error: 'Informe ids ou use all=true para excluir.' });
        return;
      }

      const isAdmin = await deps.isAdminUser(authContext);
      const effectiveScope = scope === 'tenant' && isAdmin ? 'tenant' : 'self';
      if (scope === 'tenant' && !isAdmin) {
        res.status(403).json({ error: 'Apenas administradores podem excluir histórico de todo o tenant.' });
        return;
      }

      const conditions = [eq(schema.tradingOrders.tenantId, authContext.tenantId)];
      if (effectiveScope === 'self') {
        conditions.push(buildOwnerOrderMetadataCondition(authContext.userId));
      }
      if (ids?.length) {
        conditions.push(inArray(schema.tradingOrders.id, ids));
      }

      const deletedAt = new Date().toISOString();
      const db = getDatabase();
      const updateResult = await db
        .update(schema.tradingOrders)
        .set({
          metadata: buildOrderSoftDeleteMetadataUpdate(deletedAt, authContext.userId),
        })
        .where(and(...conditions));

      res.json({
        success: true,
        data: { deletedAt, scope: effectiveScope },
        updated: updateResult.rowCount ?? 0,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao excluir histórico de ordens');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.patch('/api/integrations/trading/orders/:id/review', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const paramResult = tradingUuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
        return;
      }
      const parsed = reviewOrderBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
        return;
      }

      const result = await deps.updatePendingOrder(authContext, paramResult.data.id, parsed.data);
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({ success: true, data: result.data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao atualizar ordem pendente');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/orders/:id/approve', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const paramResult = tradingUuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
        return;
      }

      const result = await deps.approvePendingOrder(authContext, paramResult.data.id);
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({ success: true, data: result.data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao aprovar ordem pendente');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/orders/:id/reject', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const paramResult = tradingUuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
        return;
      }
      const bodyResult = rejectPendingOrderBodySchema.safeParse(req.body ?? {});
      if (!bodyResult.success) {
        res.status(400).json({ error: 'Dados inválidos', details: bodyResult.error.flatten() });
        return;
      }

      const result = await deps.rejectPendingOrder(authContext, paramResult.data.id, bodyResult.data.reason);
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({ success: true, data: result.data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao rejeitar ordem pendente');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/audit/:entityType/:id', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const paramsResult = auditParamsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        res.status(400).json({ error: 'Parâmetros inválidos', details: paramsResult.error.flatten() });
        return;
      }

      const db = getDatabase();
      const { entityType, id } = paramsResult.data;
      const events = await db.query.tradingAuditLog.findMany({
        where: and(
          eq(schema.tradingAuditLog.tenantId, authContext.tenantId),
          eq(schema.tradingAuditLog.entityType, entityType),
          eq(schema.tradingAuditLog.entityId, id),
        ),
        orderBy: [desc(schema.tradingAuditLog.criadoEm)],
        limit: 200,
      });

      const immutableStreamKey = `${entityType}:${id}`;
      const immutableEvents = await db.query.immutableAuditEvents.findMany({
        where: and(
          eq(schema.immutableAuditEvents.tenantId, authContext.tenantId),
          eq(schema.immutableAuditEvents.stream, 'trading_operations'),
          eq(schema.immutableAuditEvents.streamKey, immutableStreamKey),
        ),
        orderBy: [asc(schema.immutableAuditEvents.chainPosition)],
        limit: 500,
      });

      const immutableIntegrity = verifyImmutableAuditChain(
        immutableEvents.map((event) => ({
          chainPosition: event.chainPosition,
          prevEventHash: event.prevEventHash,
          eventHash: event.eventHash,
        })),
      );

      res.json({
        success: true,
        entityType,
        entityId: id,
        events,
        immutableAudit: {
          stream: 'trading_operations',
          streamKey: immutableStreamKey,
          integrity: immutableIntegrity,
          events: immutableEvents.map((event) => ({
            id: event.id,
            chainPosition: event.chainPosition,
            eventType: event.eventType,
            resourceType: event.resourceType,
            resourceId: event.resourceId,
            payload: event.payload,
            prevEventHash: event.prevEventHash,
            eventHash: event.eventHash,
            occurredAt: event.occurredAt,
            createdAt: event.createdAt,
          })),
        },
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao consultar trilha de auditoria de trading');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/orders', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      if (!deps.isKucoinConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }

      const parsed = z.union([orderFromSignalSchema, manualOrderSchema]).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
        return;
      }

      const symbolParam = parsed.data.symbol;
      const marketType = parsed.data.marketType;
      const marginMode = parsed.data.marginMode;
      const resolvedSymbol = symbolParam
        ? await deps.resolveTradingSymbolOrRespond(res, authContext, symbolParam, { required: true, marketType, marginMode })
        : undefined;
      if (symbolParam && !resolvedSymbol) return;

      const result = 'signalId' in parsed.data
        ? await deps.createOrderFromSignal(authContext, { ...parsed.data, symbol: resolvedSymbol })
        : await deps.createManualOrder(authContext, { ...parsed.data, symbol: resolvedSymbol });

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.status(201).json({
        success: true,
        data: result.data,
        auditLogId: result.auditLogId,
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao criar ordem');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.delete('/api/integrations/trading/orders/:id', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      if (!deps.isKucoinConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }
      const paramResult = tradingUuidParamSchema.safeParse(req.params);
      if (!paramResult.success) {
        res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
        return;
      }

      const result = await deps.cancelOrder(authContext, paramResult.data.id);
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({ success: true, data: result.data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao cancelar ordem');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/orders/sync', requirePermission('integrations:trading:manage'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      if (!deps.isKucoinConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }

      const result = await deps.syncOrdersStatus(authContext);
      if (result.filledOrders.length > 0) {
        for (const order of result.filledOrders) {
          try {
            await deps.createTradingDatasetFromOrder({
              authContext,
              order,
            });
          } catch (datasetError) {
            logger.warn({
              orderId: order.id,
              error: datasetError instanceof Error ? datasetError.message : String(datasetError),
            }, 'Falha ao gerar dataset de trading a partir de ordem executada');
          }
        }
      }

      res.json({ success: true, data: result });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao sincronizar ordens');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/stop-orders', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const parsed = stopOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
        return;
      }

      const marketType = parsed.data.marketType;
      const marginMode = parsed.data.marginMode;
      if (marketType === 'spot' && !deps.isSpotConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }
      if (marketType === 'margin' && !deps.isMarginConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }
      if ((!marketType || marketType === 'futures') && !deps.isKucoinConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }

      const resolvedSymbol = parsed.data.symbol
        ? await deps.resolveTradingSymbolOrRespond(res, authContext, parsed.data.symbol, { required: true, marketType, marginMode })
        : await deps.resolveTradingSymbol(authContext, undefined, marketType, marginMode);
      if (!resolvedSymbol) return;

      const result = await deps.createStopOrder(authContext, { ...parsed.data, symbol: resolvedSymbol });
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.status(201).json({ success: true, data: result.data });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao criar ordem stop');
      res.status(500).json({ error: errorMessage });
    }
  });
}
