import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, asc, desc, eq, inArray } from '@alice/database';
import { getDatabase, schema } from '@alice/database';
import {
  REASONING_MODE_VALUES,
  TRADING_STREAMS,
  buildTradingIdempotencyKey,
  extractAuthContext,
  generateInternalAuthHeaders,
  requirePermission,
  tradingBacktestEnqueueSchema,
  tradingCalibrationEnqueueSchema,
  tradingModelRiskEnqueueSchema,
  tradingRebalanceEnqueueSchema,
  tradingUniverseEnqueueSchema,
} from '@alice/shared-utils';
import type { Role } from '@alice/shared-utils';
import { z } from 'zod';
import { listTenantPortfolios } from '../trading/core/portfolio-api.js';

type TradingMarketType = 'futures' | 'spot' | 'margin';
type TradingAutoAssetMarketType = TradingMarketType;
type TradingAutoAssetMarginMode = 'cross' | 'isolated';

interface TradingAuthContext {
  tenantId: string;
  userId: string;
  role: Role;
}

interface TradingAutoSignalAssetSelection {
  venue: string;
  symbol: string;
  marketType: TradingAutoAssetMarketType;
  marginMode?: TradingAutoAssetMarginMode;
}

interface TradingAutoRunErrorsCounter {
  inc: (
    labels: { run_type: 'signal_auto' | 'portfolio_auto'; stage: 'enqueue' | 'handler' },
    value?: number,
  ) => void;
}

interface RegisterTradingAutomationRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  trainingServiceUrl: string;
  tradingTechniqueKeys: readonly [string, ...string[]];
  tradingAutoRunErrorsTotal: TradingAutoRunErrorsCounter;
  sendKucoinErrorResponse: (res: Response, error: unknown) => boolean;
  resolveConnectedTradingVenues: (tenantId: string) => Promise<string[]>;
  loadTradingAutoAssetsForVenue: (params: {
    venue: string;
    tradingAuth: TradingAuthContext;
  }) => Promise<TradingAutoSignalAssetSelection[]>;
}

function getTradingAuthContext(req: Request): TradingAuthContext | null {
  const authContext = extractAuthContext(req);
  if (!authContext?.tenantId || !authContext?.userId || !authContext.role) {
    return null;
  }
  return { tenantId: authContext.tenantId, userId: authContext.userId, role: authContext.role };
}

const REASONING_OVERRIDE_ALLOWED_ROLES = new Set<Role>(['admin', 'super_admin']);

function canOverrideReasoningMode(role: Role): boolean {
  return REASONING_OVERRIDE_ALLOWED_ROLES.has(role);
}

function buildTradingAutoAssetKey(input: {
  venue: string;
  symbol: string;
  marketType: TradingAutoAssetMarketType;
  marginMode?: TradingAutoAssetMarginMode;
}): string {
  const normalizedVenue = input.venue.trim().toLowerCase();
  const normalizedSymbol = input.symbol.trim().toUpperCase();
  const normalizedMarket = input.marketType;
  const normalizedMargin = input.marketType === 'margin'
    ? (input.marginMode ?? 'cross')
    : 'none';
  return `${normalizedVenue}:${normalizedMarket}:${normalizedMargin}:${normalizedSymbol}`;
}

function buildTradingAutoAssetLabel(input: {
  venue: string;
  symbol: string;
  marketType: TradingAutoAssetMarketType;
  marginMode?: TradingAutoAssetMarginMode;
}): string {
  const venueLabel = input.venue.trim().toUpperCase();
  if (input.marketType === 'margin') {
    return `${venueLabel} · Margin/${input.marginMode ?? 'cross'} · ${input.symbol}`;
  }
  return `${venueLabel} · ${input.marketType} · ${input.symbol}`;
}

async function enqueueTradingJob(params: {
  trainingServiceUrl: string;
  tenantId: string;
  userId: string;
  path:
    | '/internal/trading/enqueue/universe-scan'
    | '/internal/trading/enqueue/backtest'
    | '/internal/trading/enqueue/calibration'
    | '/internal/trading/enqueue/portfolio-rebalance'
    | '/internal/trading/enqueue/model-risk';
  payload: Record<string, unknown>;
}): Promise<{ queued: boolean; queue: string; idempotencyKey: string }> {
  const internalHeaders = generateInternalAuthHeaders({
    userId: params.userId,
    tenantId: params.tenantId,
    role: 'operator',
  });
  const response = await fetch(`${params.trainingServiceUrl}${params.path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...internalHeaders,
    },
    body: JSON.stringify(params.payload),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Falha ao enfileirar job Trading: ${response.status} ${errorText}`);
  }
  const result = await response.json() as { queued: boolean; queue: string; idempotencyKey: string };
  return result;
}

export function registerTradingAutomationRoutes(
  app: Express,
  deps: RegisterTradingAutomationRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const tradingTechniqueZod = z.enum(deps.tradingTechniqueKeys);
  const reasoningModeZod = z.enum(REASONING_MODE_VALUES);

  const candidatesQuerySchema = z.object({
    marketType: z.enum(['futures', 'spot', 'margin']).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  });

  const rebalancesQuerySchema = z.object({
    portfolioId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  });

  const tradingAutoPortfolioRunSchema = z.object({
    portfolioId: z.string().uuid(),
    marketType: z.enum(['spot', 'futures', 'margin']).optional(),
    constraints: z.record(z.unknown()).optional(),
    namespaceId: z.string().uuid().optional(),
  });

  const tradingAutoSignalRunSchema = z.object({
    symbol: z.string().min(1).max(50).optional(),
    universeScope: z.enum(['spot', 'futures', 'margin', 'all']).optional(),
    marketType: z.enum(['spot', 'futures', 'margin']).optional(),
    allowedModes: z.array(tradingTechniqueZod).optional(),
    autoMix: z.boolean().optional().default(true),
    selectedAssets: z.array(z.object({
      venue: z.string().min(1).max(32).transform((value) => value.trim().toLowerCase()),
      symbol: z.string().min(1).max(64).transform((value) => value.trim().toUpperCase()),
      marketType: z.enum(['spot', 'futures', 'margin']),
      marginMode: z.enum(['cross', 'isolated']).optional(),
    })).max(2_000).optional(),
    selectAllAssets: z.boolean().optional().default(false),
    namespaceId: z.string().uuid().optional(),
    reasoningMode: reasoningModeZod.optional(),
  }).superRefine((data, ctx) => {
    for (const [index, asset] of (data.selectedAssets ?? []).entries()) {
      if (asset.marginMode && asset.marketType !== 'margin') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'marginMode é permitido apenas para marketType=margin.',
          path: ['selectedAssets', index, 'marginMode'],
        });
      }
    }
  });

  const tradingAutoRunsQuerySchema = z.object({
    type: z.enum(['signal_auto', 'portfolio_auto']).optional(),
    status: z.enum(['queued', 'running', 'succeeded', 'no_trade', 'blocked', 'failed', 'cancelled']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  });

  app.get('/api/trading/portfolios', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const portfolios = await listTenantPortfolios(authContext.tenantId);
      res.json({ success: true, data: portfolios });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao listar portfolios trading');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/trading/candidates', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const queryResult = candidatesQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
        return;
      }
      const db = getDatabase();
      const candidateFilters = [eq(schema.tradingUniverseCandidates.tenantId, authContext.tenantId)];
      if (queryResult.data.marketType) {
        candidateFilters.push(eq(schema.tradingUniverseCandidates.marketType, queryResult.data.marketType));
      }
      const candidates = await db.query.tradingUniverseCandidates.findMany({
        where: and(...candidateFilters),
        orderBy: [desc(schema.tradingUniverseCandidates.createdAt)],
        limit: queryResult.data.limit ?? 50,
      });
      res.json({ success: true, data: candidates });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao listar candidates trading');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/trading/rebalances', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const queryResult = rebalancesQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
        return;
      }
      const db = getDatabase();
      const rebalanceFilters = [eq(schema.tradingPortfolioRebalances.tenantId, authContext.tenantId)];
      if (queryResult.data.portfolioId) {
        rebalanceFilters.push(eq(schema.tradingPortfolioRebalances.portfolioId, queryResult.data.portfolioId));
      }
      const rebalances = await db.query.tradingPortfolioRebalances.findMany({
        where: and(...rebalanceFilters),
        orderBy: [desc(schema.tradingPortfolioRebalances.createdAt)],
        limit: queryResult.data.limit ?? 20,
      });
      const executionReports = await db.query.tradingExecutionReports.findMany({
        where: eq(schema.tradingExecutionReports.tenantId, authContext.tenantId),
        orderBy: [desc(schema.tradingExecutionReports.createdAt)],
        limit: 50,
      });
      res.json({ success: true, data: { rebalances, executionReports } });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao listar rebalances trading');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/internal/trading/enqueue/universe-scan', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    const authContext = getTradingAuthContext(req);
    if (!authContext) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const parsed = tradingUniverseEnqueueSchema.parse(req.body);
    const idempotencyKey = buildTradingIdempotencyKey(TRADING_STREAMS.universeScan, parsed);
    const result = await enqueueTradingJob({
      trainingServiceUrl: deps.trainingServiceUrl,
      tenantId: authContext.tenantId,
      userId: authContext.userId,
      path: '/internal/trading/enqueue/universe-scan',
      payload: { ...parsed, idempotencyKey },
    });
    res.status(202).json({ success: true, data: result });
  });

  app.post('/internal/trading/enqueue/backtest', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    const authContext = getTradingAuthContext(req);
    if (!authContext) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const parsed = tradingBacktestEnqueueSchema.parse(req.body);
    const idempotencyKey = buildTradingIdempotencyKey(TRADING_STREAMS.backtest, parsed);
    const result = await enqueueTradingJob({
      trainingServiceUrl: deps.trainingServiceUrl,
      tenantId: authContext.tenantId,
      userId: authContext.userId,
      path: '/internal/trading/enqueue/backtest',
      payload: { ...parsed, idempotencyKey },
    });
    res.status(202).json({ success: true, data: result });
  });

  app.post('/internal/trading/enqueue/calibration', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    const authContext = getTradingAuthContext(req);
    if (!authContext) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const parsed = tradingCalibrationEnqueueSchema.parse(req.body);
    const idempotencyKey = buildTradingIdempotencyKey(TRADING_STREAMS.calibration, parsed);
    const result = await enqueueTradingJob({
      trainingServiceUrl: deps.trainingServiceUrl,
      tenantId: authContext.tenantId,
      userId: authContext.userId,
      path: '/internal/trading/enqueue/calibration',
      payload: { ...parsed, idempotencyKey },
    });
    res.status(202).json({ success: true, data: result });
  });

  app.post('/internal/trading/enqueue/portfolio-rebalance', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    const authContext = getTradingAuthContext(req);
    if (!authContext) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const parsed = tradingRebalanceEnqueueSchema.parse(req.body);
    const idempotencyKey = buildTradingIdempotencyKey(TRADING_STREAMS.portfolioRebalance, parsed);
    const result = await enqueueTradingJob({
      trainingServiceUrl: deps.trainingServiceUrl,
      tenantId: authContext.tenantId,
      userId: authContext.userId,
      path: '/internal/trading/enqueue/portfolio-rebalance',
      payload: { ...parsed, idempotencyKey },
    });
    res.status(202).json({ success: true, data: result });
  });

  app.post('/internal/trading/enqueue/model-risk', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    const authContext = getTradingAuthContext(req);
    if (!authContext) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }
    const parsed = tradingModelRiskEnqueueSchema.parse(req.body);
    const idempotencyKey = buildTradingIdempotencyKey(TRADING_STREAMS.modelRisk, parsed);
    const result = await enqueueTradingJob({
      trainingServiceUrl: deps.trainingServiceUrl,
      tenantId: authContext.tenantId,
      userId: authContext.userId,
      path: '/internal/trading/enqueue/model-risk',
      payload: { ...parsed, idempotencyKey },
    });
    res.status(202).json({ success: true, data: result });
  });

  app.get('/api/trading/auto/assets', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const tradingAuth = {
        tenantId: authContext.tenantId,
        userId: authContext.userId,
        role: authContext.role,
      };
      const venues = await deps.resolveConnectedTradingVenues(authContext.tenantId);
      if (venues.length === 0) {
        res.json({
          success: true,
          data: {
            assets: [],
            venues: [],
            markets: [],
            total: 0,
            generatedAt: new Date().toISOString(),
          },
        });
        return;
      }

      const venueAssets = await Promise.all(
        venues.map((venue) => deps.loadTradingAutoAssetsForVenue({ venue, tradingAuth })),
      );

      const deduped = new Map<string, {
        key: string;
        venue: string;
        symbol: string;
        marketType: TradingAutoAssetMarketType;
        marginMode?: TradingAutoAssetMarginMode;
        label: string;
      }>();
      for (const assets of venueAssets) {
        for (const asset of assets) {
          const key = buildTradingAutoAssetKey(asset);
          deduped.set(key, {
            key,
            venue: asset.venue,
            symbol: asset.symbol,
            marketType: asset.marketType,
            marginMode: asset.marginMode,
            label: buildTradingAutoAssetLabel(asset),
          });
        }
      }

      const catalog = Array.from(deduped.values()).sort((a, b) => {
        if (a.venue !== b.venue) return a.venue.localeCompare(b.venue);
        if (a.marketType !== b.marketType) return a.marketType.localeCompare(b.marketType);
        if ((a.marginMode ?? '') !== (b.marginMode ?? '')) return (a.marginMode ?? '').localeCompare(b.marginMode ?? '');
        return a.symbol.localeCompare(b.symbol);
      });
      const markets = Array.from(new Set(catalog.map((item) => item.marketType)));
      const resolvedVenues = Array.from(new Set(catalog.map((item) => item.venue)));

      res.json({
        success: true,
        data: {
          assets: catalog,
          venues: resolvedVenues,
          markets,
          total: catalog.length,
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter catálogo de ativos do signal auto');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/trading/auto/portfolio/run', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    let correlationId: string | null = null;
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const parsed = tradingAutoPortfolioRunSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Payload inválido', details: parsed.error.flatten() });
        return;
      }
      correlationId = crypto.randomUUID();
      const db = getDatabase();

      const [run] = await db.insert(schema.tradingAutoRuns).values({
        tenantId: authContext.tenantId,
        userId: authContext.userId,
        runType: 'portfolio_auto',
        status: 'queued',
        payload: parsed.data as Record<string, unknown>,
        correlationId,
        namespaceId: parsed.data.namespaceId ?? null,
      }).returning();

      const portfolioSteps: Array<typeof schema.tradingAutoStepNameEnum.enumValues[number]> = [
        'universe-scan', 'backtest', 'calibration', 'model-risk', 'rebalance',
      ];
      await db.insert(schema.tradingAutoRunSteps).values(
        portfolioSteps.map((stepName) => ({
          runId: run.id,
          stepName,
          status: 'pending' as const,
        })),
      );

      const internalHeaders = generateInternalAuthHeaders({
        userId: authContext.userId,
        tenantId: authContext.tenantId,
        role: 'operator',
      });
      const enqueueResponse = await fetch(`${deps.trainingServiceUrl}/internal/trading/auto/portfolio-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...internalHeaders },
        body: JSON.stringify({ runId: run.id, ...parsed.data, correlationId }),
      });
      if (!enqueueResponse.ok) {
        const errorText = await enqueueResponse.text();
        deps.tradingAutoRunErrorsTotal.inc({ run_type: 'portfolio_auto', stage: 'enqueue' });
        logger.error({ runId: run.id, status: enqueueResponse.status, errorText, correlationId }, 'Falha ao enfileirar portfolio-auto-run');
        await db.update(schema.tradingAutoRuns).set({ status: 'failed', error: `Falha ao enfileirar: ${enqueueResponse.status}` }).where(eq(schema.tradingAutoRuns.id, run.id));
        res.status(502).json({ error: 'Falha ao enfileirar job de portfólio automático' });
        return;
      }

      logger.info({ runId: run.id, correlationId, tenantId: authContext.tenantId }, 'Portfolio auto run criado e enfileirado');
      res.status(202).json({ success: true, data: { runId: run.id } });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      deps.tradingAutoRunErrorsTotal.inc({ run_type: 'portfolio_auto', stage: 'handler' });
      logger.error({ error: errorMessage, correlationId }, 'Erro ao criar portfolio auto run');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/trading/auto/signal/run', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    let correlationId: string | null = null;
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const parsed = tradingAutoSignalRunSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Payload inválido', details: parsed.error.flatten() });
        return;
      }
      if (
        parsed.data.reasoningMode
        && parsed.data.reasoningMode !== 'auto'
        && !canOverrideReasoningMode(authContext.role)
      ) {
        res.status(403).json({ error: 'Apenas admin/superadmin podem definir reasoningMode manual.' });
        return;
      }
      const normalizedPayload = parsed.data.autoMix
        ? {
          ...parsed.data,
          universeScope: 'all' as const,
          marketType: undefined,
          allowedModes: [...deps.tradingTechniqueKeys],
          selectAllAssets: true,
        }
        : parsed.data;
      correlationId = crypto.randomUUID();
      const db = getDatabase();

      const [run] = await db.insert(schema.tradingAutoRuns).values({
        tenantId: authContext.tenantId,
        userId: authContext.userId,
        runType: 'signal_auto',
        status: 'queued',
        payload: normalizedPayload as Record<string, unknown>,
        correlationId,
        namespaceId: normalizedPayload.namespaceId ?? null,
      }).returning();

      await db.insert(schema.tradingAutoRunSteps).values([
        { runId: run.id, stepName: 'signal-decision', status: 'pending' },
        { runId: run.id, stepName: 'signal-llm', status: 'pending' },
        { runId: run.id, stepName: 'signal-persist', status: 'pending' },
      ]);

      const internalHeaders = generateInternalAuthHeaders({
        userId: authContext.userId,
        tenantId: authContext.tenantId,
        role: 'operator',
      });
      const enqueueResponse = await fetch(`${deps.trainingServiceUrl}/internal/trading/auto/signal-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...internalHeaders },
        body: JSON.stringify({ runId: run.id, ...normalizedPayload, correlationId }),
      });
      if (!enqueueResponse.ok) {
        const errorText = await enqueueResponse.text();
        deps.tradingAutoRunErrorsTotal.inc({ run_type: 'signal_auto', stage: 'enqueue' });
        logger.error({ runId: run.id, status: enqueueResponse.status, errorText, correlationId }, 'Falha ao enfileirar signal-auto-run');
        await db.update(schema.tradingAutoRuns).set({ status: 'failed', error: `Falha ao enfileirar: ${enqueueResponse.status}` }).where(eq(schema.tradingAutoRuns.id, run.id));
        res.status(502).json({ error: 'Falha ao enfileirar job de sinal automático' });
        return;
      }

      logger.info({ runId: run.id, correlationId, tenantId: authContext.tenantId }, 'Signal auto run criado e enfileirado');
      res.status(202).json({ success: true, data: { runId: run.id } });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      deps.tradingAutoRunErrorsTotal.inc({ run_type: 'signal_auto', stage: 'handler' });
      logger.error({ error: errorMessage, correlationId }, 'Erro ao criar signal auto run');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/trading/auto/runs', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const queryResult = tradingAutoRunsQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
        return;
      }
      const db = getDatabase();
      const filters = [eq(schema.tradingAutoRuns.tenantId, authContext.tenantId)];
      if (queryResult.data.type) {
        filters.push(eq(schema.tradingAutoRuns.runType, queryResult.data.type));
      }
      if (queryResult.data.status) {
        filters.push(eq(schema.tradingAutoRuns.status, queryResult.data.status));
      }
      const runs = await db.query.tradingAutoRuns.findMany({
        where: and(...filters),
        orderBy: [desc(schema.tradingAutoRuns.createdAt)],
        limit: queryResult.data.limit ?? 20,
      });
      const runIds = runs.map((run) => run.id);
      const decisions = runIds.length > 0
        ? await db.query.tradingAutoDecisions.findMany({
          where: inArray(schema.tradingAutoDecisions.runId, runIds),
        })
        : [];
      const decisionByRunId = new Map(decisions.map((decision) => [decision.runId, decision]));
      const enrichedRuns = runs.map((run) => {
        const decision = decisionByRunId.get(run.id);
        return {
          ...run,
          approved: decision?.approved ?? null,
          tradingSignalId: decision?.tradingSignalId ?? null,
        };
      });
      res.json({ success: true, data: enrichedRuns });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao listar auto runs');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/trading/auto/runs/:id', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }
      const idResult = z.string().uuid().safeParse(req.params.id);
      if (!idResult.success) {
        res.status(400).json({ error: 'ID inválido' });
        return;
      }
      const db = getDatabase();
      const run = await db.query.tradingAutoRuns.findFirst({
        where: and(eq(schema.tradingAutoRuns.id, idResult.data), eq(schema.tradingAutoRuns.tenantId, authContext.tenantId)),
      });
      if (!run) {
        res.status(404).json({ error: 'Run não encontrado' });
        return;
      }
      const steps = await db.query.tradingAutoRunSteps.findMany({
        where: eq(schema.tradingAutoRunSteps.runId, run.id),
        orderBy: [asc(schema.tradingAutoRunSteps.createdAt)],
      });
      const decisions = await db.query.tradingAutoDecisions.findMany({
        where: eq(schema.tradingAutoDecisions.runId, run.id),
      });
      res.json({ success: true, data: { run, steps, decisions } });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar auto run');
      res.status(500).json({ error: errorMessage });
    }
  });
}
