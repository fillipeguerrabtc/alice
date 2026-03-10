import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, asc, desc, eq, getDatabase, gte, inArray, lt, lte, schema, sql } from '@alice/database';
import { extractAuthContext, requirePermission } from '@alice/shared-utils';
import { z } from 'zod';

type TradingMarketType = 'futures' | 'spot' | 'margin';
type TradingMarginMode = 'cross' | 'isolated';

interface TradingAuthContext {
  tenantId: string;
  userId: string;
}

interface RegisterTradingAnalysisHistoryRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  isAdminUser: (authContext: TradingAuthContext) => Promise<boolean>;
  resolveMarketTypeParam: (params: {
    marketType?: TradingMarketType;
    type?: TradingMarketType;
  }) => TradingMarketType | undefined;
  resolveTradingSymbolOrRespond: (
    res: Response,
    authContext: TradingAuthContext,
    symbol: string | undefined,
    options: { required?: boolean; marketType?: TradingMarketType; marginMode?: TradingMarginMode },
  ) => Promise<string | undefined | null>;
  resolveTradingSymbol: (
    authContext: TradingAuthContext,
    symbol?: string,
    marketType?: TradingMarketType,
    marginMode?: TradingMarginMode,
  ) => Promise<string | undefined | null>;
}

const analysisHistoryQuerySchema = z.object({
  symbol: z.string().optional(),
  interval: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  orderDirection: z.enum(['asc', 'desc']).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  overallSignal: z.enum(['strong_buy', 'buy', 'neutral', 'sell', 'strong_sell']).optional(),
  technique: z.string().optional(),
  includeDeleted: z.coerce.boolean().optional(),
  marketType: z.enum(['futures', 'spot', 'margin']).optional(),
  type: z.enum(['futures', 'spot', 'margin']).optional(),
  marginMode: z.enum(['cross', 'isolated']).optional(),
});

const historyMutationBodySchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
  all: z.boolean().optional(),
  scope: z.enum(['self', 'tenant']).optional(),
});

const VALID_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '1w'] as const;

function parseHistoryDateParam(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function buildNotDeletedIndicatorMetadataCondition() {
  return sql<boolean>`COALESCE((${schema.tradingTechnicalIndicators.metadata} ->> 'isDeleted')::boolean, false) = false`;
}

function buildOwnerIndicatorMetadataCondition(userId: string) {
  return sql<boolean>`(${schema.tradingTechnicalIndicators.metadata} ->> 'createdByUserId') = ${userId}`;
}

function buildIndicatorSoftDeleteMetadataUpdate(deletedAt: string, deletedByUserId: string) {
  return sql`
    jsonb_set(
      jsonb_set(
        jsonb_set(coalesce(${schema.tradingTechnicalIndicators.metadata}, '{}'::jsonb), '{isDeleted}', 'true'::jsonb, true),
        '{deletedAt}', to_jsonb(${deletedAt}), true
      ),
      '{deletedByUserId}', to_jsonb(${deletedByUserId}), true
    )
  `;
}

export function registerTradingAnalysisHistoryRoutes(
  app: Express,
  deps: RegisterTradingAnalysisHistoryRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  app.get('/api/integrations/trading/analysis/history', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = extractAuthContext(req);
      if (!authContext?.tenantId || !authContext?.userId) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };

      const queryResult = analysisHistoryQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
        return;
      }

      const marketType = deps.resolveMarketTypeParam(queryResult.data);
      const marginMode = queryResult.data.marginMode;
      const symbolParam = queryResult.data.symbol;
      const resolvedSymbol = symbolParam
        ? await deps.resolveTradingSymbolOrRespond(res, tradingAuth, symbolParam, { required: true, marketType, marginMode })
        : await deps.resolveTradingSymbol(tradingAuth, undefined, marketType, marginMode);
      if (!resolvedSymbol) return;

      const intervalParam = queryResult.data.interval || '5m';
      const limit = queryResult.data.limit ?? 50;
      const cursorParam = queryResult.data.cursor;
      const cursorDate = cursorParam ? new Date(cursorParam) : null;
      const usePaging = queryResult.data.page !== undefined || queryResult.data.pageSize !== undefined;
      const page = queryResult.data.page ?? 1;
      const pageSize = queryResult.data.pageSize ?? limit;
      const orderDirection = queryResult.data.orderDirection ?? 'desc';
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

      const overallSignal = queryResult.data.overallSignal ?? undefined;
      const technique = queryResult.data.technique?.trim();
      const includeDeleted = queryResult.data.includeDeleted ?? false;

      if (!VALID_INTERVALS.includes(intervalParam as (typeof VALID_INTERVALS)[number])) {
        res.status(400).json({ error: `Intervalo inválido: ${intervalParam}. Use: ${VALID_INTERVALS.join(', ')}` });
        return;
      }
      const interval = intervalParam as (typeof VALID_INTERVALS)[number];

      const db = getDatabase();
      const conditions = [
        eq(schema.tradingTechnicalIndicators.tenantId, authContext.tenantId),
        eq(schema.tradingTechnicalIndicators.symbol, resolvedSymbol),
        eq(schema.tradingTechnicalIndicators.interval, interval),
      ];
      if (!includeDeleted) {
        conditions.push(buildNotDeletedIndicatorMetadataCondition());
      }
      if (overallSignal) {
        conditions.push(eq(schema.tradingTechnicalIndicators.overallSignal, overallSignal));
      }
      if (technique) {
        conditions.push(sql`(${schema.tradingTechnicalIndicators.metadata} -> 'techniques') ? ${technique}`);
      }
      if (dateFrom) conditions.push(gte(schema.tradingTechnicalIndicators.calculatedAt, dateFrom));
      if (dateTo) conditions.push(lte(schema.tradingTechnicalIndicators.calculatedAt, dateTo));
      if (!usePaging && cursorDate && !Number.isNaN(cursorDate.getTime())) {
        conditions.push(lt(schema.tradingTechnicalIndicators.calculatedAt, cursorDate));
      }

      const history = await db
        .select()
        .from(schema.tradingTechnicalIndicators)
        .where(and(...conditions))
        .orderBy(orderDirection === 'asc'
          ? asc(schema.tradingTechnicalIndicators.calculatedAt)
          : desc(schema.tradingTechnicalIndicators.calculatedAt))
        .limit(usePaging ? pageSize : limit)
        .offset(usePaging ? Math.max(0, (page - 1) * pageSize) : 0);

      if (usePaging) {
        const [totalRow] = await db
          .select({ total: sql<number>`count(*)` })
          .from(schema.tradingTechnicalIndicators)
          .where(and(...conditions));
        const total = Number(totalRow?.total ?? 0);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        res.json({
          success: true,
          data: history,
          count: history.length,
          symbol: resolvedSymbol,
          page,
          pageSize,
          total,
          totalPages,
          orderDirection,
        });
        return;
      }

      res.json({
        success: true,
        data: history,
        count: history.length,
        symbol: resolvedSymbol,
        nextCursor: history.length > 0
          ? history[history.length - 1]?.calculatedAt?.toISOString() ?? null
          : null,
        orderDirection,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter histórico de análises');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/analysis/history/delete', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = extractAuthContext(req);
      if (!authContext?.tenantId || !authContext?.userId) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const bodyResult = historyMutationBodySchema.safeParse(req.body ?? {});
      if (!bodyResult.success) {
        res.status(400).json({ error: 'Dados inválidos', details: bodyResult.error.flatten() });
        return;
      }
      const { ids, all, scope } = bodyResult.data;
      if (!ids?.length && !all) {
        res.status(400).json({ error: 'Informe ids ou use all=true para excluir.' });
        return;
      }

      const isAdmin = await deps.isAdminUser({ tenantId: authContext.tenantId, userId: authContext.userId });
      const effectiveScope = scope === 'tenant' && isAdmin ? 'tenant' : 'self';
      if (scope === 'tenant' && !isAdmin) {
        res.status(403).json({ error: 'Apenas administradores podem excluir histórico de todo o tenant.' });
        return;
      }

      const conditions = [eq(schema.tradingTechnicalIndicators.tenantId, authContext.tenantId)];
      if (effectiveScope === 'self') {
        conditions.push(buildOwnerIndicatorMetadataCondition(authContext.userId));
      }
      if (ids?.length) {
        conditions.push(inArray(schema.tradingTechnicalIndicators.id, ids));
      }

      const deletedAt = new Date().toISOString();
      const db = getDatabase();
      const updateResult = await db
        .update(schema.tradingTechnicalIndicators)
        .set({
          metadata: buildIndicatorSoftDeleteMetadataUpdate(deletedAt, authContext.userId),
        })
        .where(and(...conditions));

      res.json({
        success: true,
        data: { deletedAt, scope: effectiveScope },
        updated: updateResult.rowCount ?? 0,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao excluir histórico de análises');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/analysis/history/purge', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = extractAuthContext(req);
      if (!authContext?.tenantId || !authContext?.userId) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const tenantId = authContext.tenantId;
      const userId = authContext.userId;
      const isAdmin = await deps.isAdminUser({ tenantId: authContext.tenantId, userId: authContext.userId });
      if (!isAdmin) {
        res.status(403).json({ error: 'Apenas administradores podem excluir definitivamente o histórico.' });
        return;
      }

      const bodyResult = historyMutationBodySchema.safeParse(req.body ?? {});
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
      const baseConditions = [eq(schema.tradingTechnicalIndicators.tenantId, tenantId)];
      if (effectiveScope === 'self') {
        baseConditions.push(buildOwnerIndicatorMetadataCondition(userId));
      }
      if (ids?.length) {
        baseConditions.push(inArray(schema.tradingTechnicalIndicators.id, ids));
      }

      const db = getDatabase();
      const indicatorIdsQuery = db
        .select({ id: schema.tradingTechnicalIndicators.id })
        .from(schema.tradingTechnicalIndicators)
        .where(and(...baseConditions));

      const result = await db.transaction(async (tx) => {
        await tx
          .update(schema.tradingAnalysisSchedulers)
          .set({ lastIndicatorId: null })
          .where(and(
            eq(schema.tradingAnalysisSchedulers.tenantId, tenantId),
            inArray(schema.tradingAnalysisSchedulers.lastIndicatorId, indicatorIdsQuery),
          ));

        const validationDelete = await tx
          .delete(schema.tradingLlmValidations)
          .where(and(
            eq(schema.tradingLlmValidations.tenantId, tenantId),
            inArray(schema.tradingLlmValidations.indicatorSnapshotId, indicatorIdsQuery),
          ));

        const deleteResult = await tx
          .delete(schema.tradingTechnicalIndicators)
          .where(and(...baseConditions));

        return {
          deletedIndicators: deleteResult.rowCount ?? 0,
          deletedValidations: validationDelete.rowCount ?? 0,
        };
      });

      res.json({
        success: true,
        data: {
          scope: effectiveScope,
          deletedIndicators: result.deletedIndicators,
          deletedValidations: result.deletedValidations,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao excluir definitivamente histórico de análises');
      res.status(500).json({ error: errorMessage });
    }
  });
}
