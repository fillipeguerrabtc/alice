import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from '@alice/database';
import { getDatabase, schema } from '@alice/database';
import { extractAuthContext, requirePermission } from '@alice/shared-utils';
import { z } from 'zod';

type TradingMarketType = 'futures' | 'spot' | 'margin';
type TradingMarginMode = 'cross' | 'isolated';

interface TradingAuthContext {
  tenantId: string;
  userId: string;
}

interface RegisterTradingSignalHistoryRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  sendKucoinErrorResponse: (res: Response, error: unknown) => boolean;
  isAdminUser: (authContext: TradingAuthContext) => Promise<boolean>;
  resolveMarketTypeParam: (params: {
    marketType?: TradingMarketType;
    type?: TradingMarketType;
  }) => TradingMarketType | undefined;
  resolveTradingSymbolOrRespond: (
    res: Response,
    authContext: TradingAuthContext,
    symbol?: string,
    options?: { required?: boolean; marketType?: TradingMarketType; marginMode?: TradingMarginMode }
  ) => Promise<string | undefined>;
  getActiveSignals: (
    authContext: TradingAuthContext,
    limit: number,
    marketType?: TradingMarketType,
  ) => Promise<schema.TradingSignal[]>;
}

const activeSignalsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  marketType: z.enum(['futures', 'spot', 'margin']).optional(),
  type: z.enum(['futures', 'spot', 'margin']).optional(),
});

const historySignalsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  orderDirection: z.enum(['asc', 'desc']).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  symbol: z.string().optional(),
  marketType: z.enum(['futures', 'spot', 'margin']).optional(),
  signalType: z.enum(['entry_long', 'entry_short', 'exit', 'adjust_sl', 'adjust_tp', 'hold', 'neutral']).optional(),
  validationStatus: z.enum(['pending', 'validated', 'failed']).optional(),
  approvalStatus: z.enum(['pending', 'approved', 'rejected']).optional(),
  includeDeleted: z.coerce.boolean().optional(),
});

const historyDeleteBodySchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
  all: z.boolean().optional(),
  scope: z.enum(['self', 'tenant']).optional(),
});

function getTradingAuthContext(req: Request): TradingAuthContext | null {
  const authContext = extractAuthContext(req);
  if (!authContext?.tenantId || !authContext?.userId) {
    return null;
  }
  return { tenantId: authContext.tenantId, userId: authContext.userId };
}

function mapTradingSignalForApi(signal: schema.TradingSignal) {
  const metadata = (signal.metadata ?? {}) as Record<string, unknown>;
  return {
    ...signal,
    reasoning: typeof metadata.reasoning === 'string' ? metadata.reasoning : null,
    sourceModel: typeof metadata.modelVersion === 'string' ? metadata.modelVersion : null,
    metadata,
  };
}

function parseHistoryDateParam(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function buildNotDeletedSignalMetadataCondition() {
  return sql<boolean>`COALESCE((${schema.tradingSignals.metadata} ->> 'isDeleted')::boolean, false) = false`;
}

function buildSignalOwnerMetadataCondition(userId: string) {
  return sql<boolean>`(${schema.tradingSignals.metadata} ->> 'createdByUserId') = ${userId}`;
}

function buildSignalSoftDeleteMetadataUpdate(deletedAt: string, deletedByUserId: string) {
  return sql`
    jsonb_set(
      jsonb_set(
        jsonb_set(coalesce(${schema.tradingSignals.metadata}, '{}'::jsonb), '{isDeleted}', 'true'::jsonb, true),
        '{deletedAt}', to_jsonb(${deletedAt}), true
      ),
      '{deletedByUserId}', to_jsonb(${deletedByUserId}), true
    )
  `;
}

export function registerTradingSignalHistoryRoutes(
  app: Express,
  deps: RegisterTradingSignalHistoryRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  app.get('/api/integrations/trading/signals', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const queryResult = activeSignalsQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
        return;
      }

      const limit = queryResult.data.limit ?? 10;
      const marketType = deps.resolveMarketTypeParam(queryResult.data);
      const signals = await deps.getActiveSignals(authContext, limit, marketType);

      res.json({
        success: true,
        data: signals.map(mapTradingSignalForApi),
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter sinais');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/signals/history', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const queryResult = historySignalsQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
        return;
      }

      const limit = queryResult.data.limit ?? 50;
      const cursorDate = queryResult.data.cursor ? new Date(queryResult.data.cursor) : null;
      const usePaging = queryResult.data.page !== undefined || queryResult.data.pageSize !== undefined;
      const page = queryResult.data.page ?? 1;
      const pageSize = queryResult.data.pageSize ?? limit;
      const orderDirection = queryResult.data.orderDirection ?? 'desc';
      const marketType = queryResult.data.marketType ?? undefined;
      const signalType = queryResult.data.signalType ?? undefined;
      const validationStatus = queryResult.data.validationStatus ?? undefined;
      const approvalStatus = queryResult.data.approvalStatus ?? undefined;
      const includeDeleted = queryResult.data.includeDeleted ?? false;
      const dateFrom = parseHistoryDateParam(queryResult.data.dateFrom);
      const dateTo = parseHistoryDateParam(queryResult.data.dateTo);
      if (queryResult.data.dateFrom && !dateFrom) {
        res.status(400).json({ error: 'Data inicial inválida.' });
        return;
      }
      if (queryResult.data.dateTo && !dateTo) {
        res.status(400).json({ error: 'Data final inválida.' });
        return;
      }

      const symbolParam = queryResult.data.symbol;
      const resolvedSymbol = symbolParam
        ? await deps.resolveTradingSymbolOrRespond(res, authContext, symbolParam, { required: true, marketType })
        : undefined;
      if (symbolParam && !resolvedSymbol) return;

      const conditions = [eq(schema.tradingSignals.tenantId, authContext.tenantId)];
      if (resolvedSymbol) conditions.push(eq(schema.tradingSignals.symbol, resolvedSymbol));
      if (marketType) conditions.push(eq(schema.tradingSignals.marketType, marketType));
      if (signalType) conditions.push(eq(schema.tradingSignals.signalType, signalType));
      if (dateFrom) conditions.push(gte(schema.tradingSignals.criadoEm, dateFrom));
      if (dateTo) conditions.push(lte(schema.tradingSignals.criadoEm, dateTo));
      if (!usePaging && cursorDate) conditions.push(lt(schema.tradingSignals.criadoEm, cursorDate));
      if (validationStatus) {
        conditions.push(sql`(${schema.tradingSignals.metadata} ->> 'validationStatus') = ${validationStatus}`);
      }
      if (approvalStatus) {
        conditions.push(sql`(${schema.tradingSignals.metadata} ->> 'approvalStatus') = ${approvalStatus}`);
      }
      if (!includeDeleted) {
        conditions.push(buildNotDeletedSignalMetadataCondition());
      }

      const db = getDatabase();
      const orderByClause = orderDirection === 'asc'
        ? asc(schema.tradingSignals.criadoEm)
        : desc(schema.tradingSignals.criadoEm);

      if (usePaging) {
        const [totalRow] = await db
          .select({ total: sql<number>`count(*)` })
          .from(schema.tradingSignals)
          .where(and(...conditions));
        const total = Number(totalRow?.total ?? 0);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const offset = Math.max(0, (page - 1) * pageSize);
        const history = await db
          .select()
          .from(schema.tradingSignals)
          .where(and(...conditions))
          .orderBy(orderByClause)
          .limit(pageSize)
          .offset(offset);

        res.json({
          success: true,
          data: history.map(mapTradingSignalForApi),
          page,
          pageSize,
          total,
          totalPages,
          orderDirection,
        });
        return;
      }

      const history = await db
        .select()
        .from(schema.tradingSignals)
        .where(and(...conditions))
        .orderBy(orderByClause)
        .limit(limit);

      const nextCursor = history.length > 0
        ? history[history.length - 1]?.criadoEm?.toISOString() ?? null
        : null;

      res.json({
        success: true,
        data: history.map(mapTradingSignalForApi),
        nextCursor,
        orderDirection,
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter histórico de sinais');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/signals/history/stats', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const db = getDatabase();
      const notDeleted = buildNotDeletedSignalMetadataCondition();

      const [stats] = await db
        .select({
          total: sql<number>`count(*)`,
          validated: sql<number>`count(*) filter (where coalesce(${schema.tradingSignals.metadata} ->> 'validationStatus', 'pending') = 'validated')`,
          failed: sql<number>`count(*) filter (where coalesce(${schema.tradingSignals.metadata} ->> 'validationStatus', 'pending') = 'failed')`,
          pendingValidation: sql<number>`count(*) filter (where coalesce(${schema.tradingSignals.metadata} ->> 'validationStatus', 'pending') = 'pending')`,
          approved: sql<number>`count(*) filter (where coalesce(${schema.tradingSignals.metadata} ->> 'approvalStatus', 'pending') = 'approved')`,
          rejected: sql<number>`count(*) filter (where coalesce(${schema.tradingSignals.metadata} ->> 'approvalStatus', 'pending') = 'rejected')`,
          pendingApproval: sql<number>`count(*) filter (where coalesce(${schema.tradingSignals.metadata} ->> 'approvalStatus', 'pending') = 'pending')`,
        })
        .from(schema.tradingSignals)
        .where(and(eq(schema.tradingSignals.tenantId, authContext.tenantId), notDeleted));

      res.json({
        success: true,
        data: {
          total: Number(stats?.total ?? 0),
          validation: {
            validated: Number(stats?.validated ?? 0),
            failed: Number(stats?.failed ?? 0),
            pending: Number(stats?.pendingValidation ?? 0),
          },
          approval: {
            approved: Number(stats?.approved ?? 0),
            rejected: Number(stats?.rejected ?? 0),
            pending: Number(stats?.pendingApproval ?? 0),
          },
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter estatísticas de sinais');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/signals/history/delete', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
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

      const conditions = [eq(schema.tradingSignals.tenantId, authContext.tenantId)];
      if (effectiveScope === 'self') {
        conditions.push(buildSignalOwnerMetadataCondition(authContext.userId));
      }
      if (ids?.length) {
        conditions.push(inArray(schema.tradingSignals.id, ids));
      }

      const deletedAt = new Date().toISOString();
      const db = getDatabase();
      const updateResult = await db
        .update(schema.tradingSignals)
        .set({
          metadata: buildSignalSoftDeleteMetadataUpdate(deletedAt, authContext.userId),
        })
        .where(and(...conditions));

      res.json({
        success: true,
        data: { deletedAt, scope: effectiveScope },
        updated: updateResult.rowCount ?? 0,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao excluir histórico de sinais');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/signals/history/purge', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const tenantId = authContext.tenantId;
      const userId = authContext.userId;
      const isAdmin = await deps.isAdminUser(authContext);
      if (!isAdmin) {
        res.status(403).json({ error: 'Apenas administradores podem excluir definitivamente o histórico.' });
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

      const effectiveScope = scope ?? 'self';
      const baseConditions = [eq(schema.tradingSignals.tenantId, tenantId)];
      if (effectiveScope === 'self') {
        baseConditions.push(buildSignalOwnerMetadataCondition(userId));
      }
      if (ids?.length) {
        baseConditions.push(inArray(schema.tradingSignals.id, ids));
      }

      const db = getDatabase();
      const signalIdsQuery = db
        .select({ id: schema.tradingSignals.id })
        .from(schema.tradingSignals)
        .where(and(...baseConditions));

      const result = await db.transaction(async (tx) => {
        await tx
          .update(schema.tradingSignalSchedulers)
          .set({ lastSignalId: null })
          .where(and(
            eq(schema.tradingSignalSchedulers.tenantId, tenantId),
            inArray(schema.tradingSignalSchedulers.lastSignalId, signalIdsQuery),
          ));

        await tx
          .update(schema.tradingOrders)
          .set({ signalId: null })
          .where(and(
            eq(schema.tradingOrders.tenantId, tenantId),
            inArray(schema.tradingOrders.signalId, signalIdsQuery),
          ));

        const validationDelete = await tx
          .delete(schema.tradingLlmValidations)
          .where(and(
            eq(schema.tradingLlmValidations.tenantId, tenantId),
            inArray(schema.tradingLlmValidations.signalId, signalIdsQuery),
          ));

        const deleteResult = await tx
          .delete(schema.tradingSignals)
          .where(and(...baseConditions));

        return {
          deletedSignals: deleteResult.rowCount ?? 0,
          deletedValidations: validationDelete.rowCount ?? 0,
        };
      });

      res.json({
        success: true,
        data: {
          scope: effectiveScope,
          deletedSignals: result.deletedSignals,
          deletedValidations: result.deletedValidations,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao excluir definitivamente histórico de sinais');
      res.status(500).json({ error: errorMessage });
    }
  });
}
