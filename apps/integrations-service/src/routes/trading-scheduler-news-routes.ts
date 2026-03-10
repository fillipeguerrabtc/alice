import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, asc, desc, eq, not } from '@alice/database';
import { getDatabase, schema } from '@alice/database';
import { extractAuthContext, requirePermission } from '@alice/shared-utils';
import {
  tradingIntervalEnum,
  TradingArbitrageConfigSchema,
  TradingEnsembleConfigSchema,
  TradingProfileNewsConfigSchema,
  TradingTechniqueSchema,
} from '@alice/shared';
import type {
  TradingArbitrageConfig,
  TradingEnsembleConfig,
  TradingProfileNewsConfig,
  TradingTechnique,
} from '@alice/shared';
import { z } from 'zod';

type TradingMarketType = 'futures' | 'spot' | 'margin';
type TradingMarginMode = 'cross' | 'isolated';
type TradingProfileKind = 'analysis' | 'signal';
type TradingIntervalValue = typeof tradingIntervalEnum.enumValues[number];

interface TradingAuthContext {
  tenantId: string;
  userId: string;
}

interface TradingProfileNormalized {
  timeframes: string[];
  indicators: string[];
  dataSources: Record<string, unknown>;
  techniques: TradingTechnique[];
  ensembleConfig: TradingEnsembleConfig;
  arbitrageConfig?: TradingArbitrageConfig;
  modelConfig: Record<string, unknown>;
  newsConfig: TradingProfileNewsConfig;
  consensus: Record<string, unknown>;
}

interface RegisterTradingSchedulerNewsRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  defaultTradingTechniques: TradingTechnique[];
  defaultTradingEnsembleConfig: TradingEnsembleConfig;
  resolveMarketTypeParam: (params: {
    marketType?: TradingMarketType;
    type?: TradingMarketType;
  }) => TradingMarketType | undefined;
  normalizeTradingNewsConfig: (raw?: TradingProfileNewsConfig | null) => TradingProfileNewsConfig;
  normalizeSignalSymbols: (rawSymbols: string[]) => string[];
  assertArbitrageConfigForTechniques: (params: {
    techniques: TradingTechnique[];
    arbitrageConfig?: TradingArbitrageConfig;
    timeframes: TradingIntervalValue[];
    context: string;
  }) => void;
  getOrCreateTradingProfile: (tenantId: string, kind: TradingProfileKind) => Promise<schema.TradingAnalysisProfile>;
  normalizeTradingProfile: (row?: schema.TradingAnalysisProfile | null) => TradingProfileNormalized;
  resolveTradingSymbolStrict: (
    authContext: TradingAuthContext,
    symbol: string,
    marketType: TradingMarketType,
    marginMode?: TradingMarginMode,
  ) => Promise<string>;
  respondKucoinNotConfigured: (res: Response) => void;
  isKucoinConfigured: () => boolean;
  isSpotConfigured: () => boolean;
  isMarginConfigured: () => boolean;
  isTradingConfigError: (error: unknown) => boolean;
}

const TRADING_INTERVAL_VALUES = [...tradingIntervalEnum.enumValues] as [
  typeof tradingIntervalEnum.enumValues[number],
  ...Array<typeof tradingIntervalEnum.enumValues[number]>,
];
const TRADING_INTERVAL_ZOD = z.enum(TRADING_INTERVAL_VALUES);

const schedulerQuerySchema = z.object({
  marketType: z.enum(['futures', 'spot', 'margin']).optional(),
  type: z.enum(['futures', 'spot', 'margin']).optional(),
});

const newsPresetCreateSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional().nullable(),
  config: TradingProfileNewsConfigSchema,
  isDefault: z.boolean().optional(),
});

const newsPresetUpdateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).optional().nullable(),
  config: TradingProfileNewsConfigSchema.optional(),
  isDefault: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Nenhuma alteração enviada',
});

const newsPresetApplySchema = z.object({
  presetId: z.string().uuid(),
  kind: z.enum(['analysis', 'signal']),
});

const signalSchedulerUpsertSchema = z.object({
  marketType: z.enum(['futures', 'spot', 'margin']),
  marginMode: z.enum(['cross', 'isolated']).optional(),
  intervalMinutes: z.number().int().min(1).max(1440),
  interval: TRADING_INTERVAL_ZOD,
  symbols: z.array(z.string().min(2).max(30)).max(50).optional(),
  enabled: z.boolean(),
  maxSignalsPerRun: z.number().int().min(1).max(20).optional(),
  agentId: z.string().uuid().optional(),
  techniques: z.array(TradingTechniqueSchema).min(1).optional(),
  ensembleConfig: TradingEnsembleConfigSchema.optional(),
  arbitrageConfig: TradingArbitrageConfigSchema.optional().nullable(),
});

const analysisSchedulerUpsertSchema = z.object({
  marketType: z.enum(['futures', 'spot', 'margin']),
  marginMode: z.enum(['cross', 'isolated']).optional(),
  intervalMinutes: z.number().int().min(1).max(1440),
  interval: TRADING_INTERVAL_ZOD,
  symbols: z.array(z.string().min(2).max(30)).max(50).optional(),
  enabled: z.boolean(),
  maxSymbolsPerRun: z.number().int().min(1).max(50).optional(),
  techniques: z.array(TradingTechniqueSchema).min(1).optional(),
  ensembleConfig: TradingEnsembleConfigSchema.optional(),
  arbitrageConfig: TradingArbitrageConfigSchema.optional().nullable(),
});

function getTradingAuthContext(req: Request): TradingAuthContext | null {
  const authContext = extractAuthContext(req);
  if (!authContext?.tenantId || !authContext?.userId) {
    return null;
  }
  return { tenantId: authContext.tenantId, userId: authContext.userId };
}

export function registerTradingSchedulerNewsRoutes(
  app: Express,
  deps: RegisterTradingSchedulerNewsRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  app.get('/api/integrations/trading/signal-scheduler', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const parsed = schedulerQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
        return;
      }

      const marketType = deps.resolveMarketTypeParam(parsed.data) ?? 'futures';
      const db = getDatabase();
      const schedulers = await db
        .select()
        .from(schema.tradingSignalSchedulers)
        .where(and(
          eq(schema.tradingSignalSchedulers.tenantId, authContext.tenantId),
          eq(schema.tradingSignalSchedulers.marketType, marketType),
        ))
        .orderBy(desc(schema.tradingSignalSchedulers.criadoEm));

      let data: typeof schedulers;
      if (schedulers.length > 0) {
        const now = new Date();
        const updatedEntries = await Promise.allSettled(schedulers.map(async (scheduler) => {
          if (scheduler.enabled && !scheduler.nextRunAt) {
            const nextRunAt = new Date(now.getTime() + (scheduler.intervalMinutes ?? 15) * 60 * 1000);
            await db.update(schema.tradingSignalSchedulers)
              .set({ nextRunAt, atualizadoEm: now })
              .where(eq(schema.tradingSignalSchedulers.id, scheduler.id));
            return { ...scheduler, nextRunAt };
          }
          return scheduler;
        }));
        data = updatedEntries.map((entry, index) => {
          if (entry.status === 'fulfilled') {
            return entry.value;
          }
          logger.warn({ error: entry.reason, schedulerId: schedulers[index]?.id }, 'Falha ao atualizar nextRunAt do scheduler');
          return schedulers[index]!;
        });
      } else {
        data = [{
          id: '',
          tenantId: authContext.tenantId,
          agentId: null,
          namespaceId: null,
          marketType,
          marginMode: 'cross',
          intervalMinutes: 15,
          interval: '5m',
          symbols: [],
          maxSignalsPerRun: 1,
          techniques: deps.defaultTradingTechniques,
          ensembleConfig: deps.defaultTradingEnsembleConfig,
          arbitrageConfig: null,
          enabled: false,
          lastRunAt: null,
          nextRunAt: null,
          lastSuccessAt: null,
          lastSignalId: null,
          lastDurationMs: null,
          lastError: null,
          criadoEm: null,
          atualizadoEm: null,
        }];
      }

      res.json({ success: true, data });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar scheduler de sinais');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/news-presets', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const presets = await getDatabase().query.tradingNewsPresets.findMany({
        where: eq(schema.tradingNewsPresets.tenantId, authContext.tenantId),
        orderBy: [desc(schema.tradingNewsPresets.isDefault), asc(schema.tradingNewsPresets.name)],
      });

      res.json({ success: true, data: presets });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao listar presets de notícias');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/news-presets', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const parsed = newsPresetCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
        return;
      }

      const name = parsed.data.name.trim();
      if (!name) {
        res.status(400).json({ error: 'Nome do preset é obrigatório' });
        return;
      }

      const existing = await getDatabase().query.tradingNewsPresets.findFirst({
        where: and(
          eq(schema.tradingNewsPresets.tenantId, authContext.tenantId),
          eq(schema.tradingNewsPresets.name, name),
        ),
      });
      if (existing) {
        res.status(409).json({ error: 'Já existe um preset com esse nome' });
        return;
      }

      const normalizedConfig = deps.normalizeTradingNewsConfig(parsed.data.config);
      const createdRows = await getDatabase()
        .insert(schema.tradingNewsPresets)
        .values({
          tenantId: authContext.tenantId,
          name,
          description: parsed.data.description?.trim() || null,
          config: normalizedConfig,
          isDefault: parsed.data.isDefault ?? false,
          createdBy: authContext.userId,
        })
        .returning();
      const created = createdRows[0];

      if (created?.isDefault) {
        await getDatabase()
          .update(schema.tradingNewsPresets)
          .set({ isDefault: false, atualizadoEm: new Date() })
          .where(and(
            eq(schema.tradingNewsPresets.tenantId, authContext.tenantId),
            not(eq(schema.tradingNewsPresets.id, created.id)),
          ));
      }

      res.status(201).json({ success: true, data: created });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao criar preset de notícias');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.put('/api/integrations/trading/news-presets/:id', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const parsed = newsPresetUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
        return;
      }

      const preset = await getDatabase().query.tradingNewsPresets.findFirst({
        where: and(
          eq(schema.tradingNewsPresets.id, req.params.id),
          eq(schema.tradingNewsPresets.tenantId, authContext.tenantId),
        ),
      });
      if (!preset) {
        res.status(404).json({ error: 'Preset não encontrado' });
        return;
      }

      let name: string | undefined;
      if (parsed.data.name !== undefined) {
        name = parsed.data.name.trim();
        if (!name) {
          res.status(400).json({ error: 'Nome do preset é obrigatório' });
          return;
        }
        if (name !== preset.name) {
          const existing = await getDatabase().query.tradingNewsPresets.findFirst({
            where: and(
              eq(schema.tradingNewsPresets.tenantId, authContext.tenantId),
              eq(schema.tradingNewsPresets.name, name),
              not(eq(schema.tradingNewsPresets.id, preset.id)),
            ),
          });
          if (existing) {
            res.status(409).json({ error: 'Já existe um preset com esse nome' });
            return;
          }
        }
      }

      const updatePayload: Partial<typeof schema.tradingNewsPresets.$inferInsert> = {
        atualizadoEm: new Date(),
      };
      if (name !== undefined) {
        updatePayload.name = name;
      }
      if (parsed.data.description !== undefined) {
        updatePayload.description = parsed.data.description?.trim() || null;
      }
      if (parsed.data.config !== undefined) {
        updatePayload.config = deps.normalizeTradingNewsConfig(parsed.data.config);
      }
      if (parsed.data.isDefault !== undefined) {
        updatePayload.isDefault = parsed.data.isDefault;
      }

      const updatedRows = await getDatabase()
        .update(schema.tradingNewsPresets)
        .set(updatePayload)
        .where(eq(schema.tradingNewsPresets.id, preset.id))
        .returning();
      const updated = updatedRows[0];
      if (!updated) {
        const refreshed = await getDatabase().query.tradingNewsPresets.findFirst({
          where: and(
            eq(schema.tradingNewsPresets.id, preset.id),
            eq(schema.tradingNewsPresets.tenantId, authContext.tenantId),
          ),
        });
        if (!refreshed) {
          res.status(404).json({ error: 'Preset não encontrado' });
          return;
        }
        res.status(409).json({ error: 'Preset não pôde ser atualizado (conflito de concorrência)' });
        return;
      }

      if (updated.isDefault) {
        await getDatabase()
          .update(schema.tradingNewsPresets)
          .set({ isDefault: false, atualizadoEm: new Date() })
          .where(and(
            eq(schema.tradingNewsPresets.tenantId, authContext.tenantId),
            not(eq(schema.tradingNewsPresets.id, updated.id)),
          ));
      }

      res.json({ success: true, data: updated });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao atualizar preset de notícias');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.delete('/api/integrations/trading/news-presets/:id', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const preset = await getDatabase().query.tradingNewsPresets.findFirst({
        where: and(
          eq(schema.tradingNewsPresets.id, req.params.id),
          eq(schema.tradingNewsPresets.tenantId, authContext.tenantId),
        ),
      });
      if (!preset) {
        res.status(404).json({ error: 'Preset não encontrado' });
        return;
      }

      await getDatabase()
        .delete(schema.tradingNewsPresets)
        .where(eq(schema.tradingNewsPresets.id, preset.id));

      res.json({ success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao remover preset de notícias');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.post('/api/integrations/trading/news-presets/apply', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const parsed = newsPresetApplySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
        return;
      }

      const preset = await getDatabase().query.tradingNewsPresets.findFirst({
        where: and(
          eq(schema.tradingNewsPresets.id, parsed.data.presetId),
          eq(schema.tradingNewsPresets.tenantId, authContext.tenantId),
        ),
      });
      if (!preset) {
        res.status(404).json({ error: 'Preset não encontrado' });
        return;
      }

      const profileRow = await deps.getOrCreateTradingProfile(authContext.tenantId, parsed.data.kind);
      const updated = await getDatabase()
        .update(schema.tradingAnalysisProfiles)
        .set({
          newsConfig: preset.config,
          atualizadoEm: new Date(),
        })
        .where(eq(schema.tradingAnalysisProfiles.id, profileRow.id))
        .returning();

      const updatedRow = updated[0] ?? profileRow;
      const profile = deps.normalizeTradingProfile(updatedRow);

      res.json({
        success: true,
        data: {
          preset,
          profile: {
            id: updatedRow.id,
            kind: updatedRow.kind,
            name: updatedRow.name,
            timeframes: profile.timeframes,
            indicators: profile.indicators,
            dataSources: profile.dataSources,
            modelConfig: profile.modelConfig,
            newsConfig: profile.newsConfig,
            consensus: profile.consensus,
          },
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao aplicar preset de notícias');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.put('/api/integrations/trading/signal-scheduler', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const parsed = signalSchedulerUpsertSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
        return;
      }

      const normalizedSymbols = deps.normalizeSignalSymbols(parsed.data.symbols ?? []);
      if (parsed.data.enabled && normalizedSymbols.length === 0) {
        res.status(400).json({ error: 'Informe ao menos um símbolo para habilitar o scheduler.' });
        return;
      }

      if (parsed.data.marketType === 'spot' && !deps.isSpotConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }
      if (parsed.data.marketType === 'margin' && !deps.isMarginConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }
      if (parsed.data.marketType === 'futures' && !deps.isKucoinConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }

      const resolvedTechniques = parsed.data.techniques ?? [];
      if (resolvedTechniques.includes('arbitrage_triangular') && parsed.data.marketType === 'futures') {
        res.status(400).json({ error: 'Arbitragem triangular não é suportada em mercado futures.' });
        return;
      }
      if (resolvedTechniques.includes('arbitrage_triangular') && !parsed.data.arbitrageConfig) {
        res.status(400).json({ error: 'Configuração de arbitragem é obrigatória quando a técnica está habilitada.' });
        return;
      }
      if (resolvedTechniques.length > 0) {
        deps.assertArbitrageConfigForTechniques({
          techniques: resolvedTechniques,
          arbitrageConfig: parsed.data.arbitrageConfig ?? undefined,
          timeframes: [parsed.data.interval],
          context: 'scheduler de sinais',
        });
      }

      const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };
      for (const symbol of normalizedSymbols) {
        await deps.resolveTradingSymbolStrict(
          tradingAuth,
          symbol,
          parsed.data.marketType,
          parsed.data.marginMode,
        );
      }

      let namespaceId: string | null = null;
      if (parsed.data.agentId) {
        const agent = await getDatabase().query.agents.findFirst({
          where: and(
            eq(schema.agents.id, parsed.data.agentId),
            eq(schema.agents.tenantId, authContext.tenantId),
            eq(schema.agents.status, 'active'),
          ),
        });
        if (!agent) {
          res.status(400).json({ error: 'Agente informado não encontrado ou inativo.' });
          return;
        }
        namespaceId = agent.namespaceId ?? null;
      }

      const now = new Date();
      const nextRunAt = parsed.data.enabled
        ? new Date(now.getTime() + parsed.data.intervalMinutes * 60 * 1000)
        : null;
      const resolvedMaxSignalsPerRun = parsed.data.maxSignalsPerRun
        ?? Math.min(20, Math.max(1, normalizedSymbols.length));
      const techniques = parsed.data.techniques ?? null;
      const ensembleConfig = parsed.data.ensembleConfig ?? null;
      const arbitrageConfig = parsed.data.arbitrageConfig ?? null;

      const db = getDatabase();
      const [saved] = await db
        .insert(schema.tradingSignalSchedulers)
        .values({
          tenantId: authContext.tenantId,
          agentId: parsed.data.agentId ?? null,
          namespaceId,
          marketType: parsed.data.marketType,
          marginMode: parsed.data.marginMode ?? null,
          intervalMinutes: parsed.data.intervalMinutes,
          interval: parsed.data.interval,
          symbols: normalizedSymbols,
          enabled: parsed.data.enabled,
          maxSignalsPerRun: resolvedMaxSignalsPerRun,
          techniques,
          ensembleConfig,
          arbitrageConfig,
          nextRunAt,
          atualizadoEm: now,
        })
        .onConflictDoUpdate({
          target: [schema.tradingSignalSchedulers.tenantId, schema.tradingSignalSchedulers.marketType],
          set: {
            agentId: parsed.data.agentId ?? null,
            namespaceId,
            marginMode: parsed.data.marginMode ?? null,
            intervalMinutes: parsed.data.intervalMinutes,
            interval: parsed.data.interval,
            symbols: normalizedSymbols,
            enabled: parsed.data.enabled,
            maxSignalsPerRun: resolvedMaxSignalsPerRun,
            techniques,
            ensembleConfig,
            arbitrageConfig,
            nextRunAt,
            atualizadoEm: now,
          },
        })
        .returning();

      res.json({ success: true, data: saved });
    } catch (error) {
      if (deps.isTradingConfigError(error)) {
        res.status(400).json({ error: (error as Error).message });
        return;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao atualizar scheduler de sinais');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/analysis-scheduler', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const parsed = schedulerQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Query inválida', details: parsed.error.flatten() });
        return;
      }

      const marketType = deps.resolveMarketTypeParam(parsed.data) ?? 'futures';
      const db = getDatabase();
      const schedulers = await db
        .select()
        .from(schema.tradingAnalysisSchedulers)
        .where(and(
          eq(schema.tradingAnalysisSchedulers.tenantId, authContext.tenantId),
          eq(schema.tradingAnalysisSchedulers.marketType, marketType),
        ))
        .orderBy(desc(schema.tradingAnalysisSchedulers.criadoEm));

      const data = schedulers.length > 0
        ? schedulers
        : [{
          tenantId: authContext.tenantId,
          marketType,
          marginMode: 'cross',
          intervalMinutes: 15,
          interval: '5m',
          symbols: [],
          maxSymbolsPerRun: 1,
          techniques: deps.defaultTradingTechniques,
          ensembleConfig: deps.defaultTradingEnsembleConfig,
          arbitrageConfig: null,
          enabled: false,
          lastRunAt: null,
          nextRunAt: null,
          lastSuccessAt: null,
          lastIndicatorId: null,
          lastDurationMs: null,
          lastError: null,
        }];

      res.json({ success: true, data });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao buscar scheduler de análise');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.put('/api/integrations/trading/analysis-scheduler', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const parsed = analysisSchedulerUpsertSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
        return;
      }

      const normalizedSymbols = deps.normalizeSignalSymbols(parsed.data.symbols ?? []);
      if (parsed.data.enabled && normalizedSymbols.length === 0) {
        res.status(400).json({ error: 'Informe ao menos um símbolo para habilitar o scheduler.' });
        return;
      }

      if (parsed.data.marketType === 'spot' && !deps.isSpotConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }
      if (parsed.data.marketType === 'margin' && !deps.isMarginConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }
      if (parsed.data.marketType === 'futures' && !deps.isKucoinConfigured()) {
        deps.respondKucoinNotConfigured(res);
        return;
      }

      const resolvedTechniques = parsed.data.techniques ?? [];
      if (resolvedTechniques.includes('arbitrage_triangular') && parsed.data.marketType === 'futures') {
        res.status(400).json({ error: 'Arbitragem triangular não é suportada em mercado futures.' });
        return;
      }
      if (resolvedTechniques.includes('arbitrage_triangular') && !parsed.data.arbitrageConfig) {
        res.status(400).json({ error: 'Configuração de arbitragem é obrigatória quando a técnica está habilitada.' });
        return;
      }
      if (resolvedTechniques.length > 0) {
        deps.assertArbitrageConfigForTechniques({
          techniques: resolvedTechniques,
          arbitrageConfig: parsed.data.arbitrageConfig ?? undefined,
          timeframes: [parsed.data.interval],
          context: 'scheduler de análise',
        });
      }

      const tradingAuth = { tenantId: authContext.tenantId, userId: authContext.userId };
      for (const symbol of normalizedSymbols) {
        await deps.resolveTradingSymbolStrict(
          tradingAuth,
          symbol,
          parsed.data.marketType,
          parsed.data.marginMode,
        );
      }

      const now = new Date();
      const nextRunAt = parsed.data.enabled
        ? new Date(now.getTime() + parsed.data.intervalMinutes * 60 * 1000)
        : null;
      const techniques = parsed.data.techniques ?? null;
      const ensembleConfig = parsed.data.ensembleConfig ?? null;
      const arbitrageConfig = parsed.data.arbitrageConfig ?? null;

      const db = getDatabase();
      const [saved] = await db
        .insert(schema.tradingAnalysisSchedulers)
        .values({
          tenantId: authContext.tenantId,
          marketType: parsed.data.marketType,
          marginMode: parsed.data.marginMode ?? null,
          intervalMinutes: parsed.data.intervalMinutes,
          interval: parsed.data.interval,
          symbols: normalizedSymbols,
          enabled: parsed.data.enabled,
          maxSymbolsPerRun: parsed.data.maxSymbolsPerRun ?? 1,
          techniques,
          ensembleConfig,
          arbitrageConfig,
          nextRunAt,
          atualizadoEm: now,
        })
        .onConflictDoUpdate({
          target: [schema.tradingAnalysisSchedulers.tenantId, schema.tradingAnalysisSchedulers.marketType],
          set: {
            marginMode: parsed.data.marginMode ?? null,
            intervalMinutes: parsed.data.intervalMinutes,
            interval: parsed.data.interval,
            symbols: normalizedSymbols,
            enabled: parsed.data.enabled,
            maxSymbolsPerRun: parsed.data.maxSymbolsPerRun ?? 1,
            techniques,
            ensembleConfig,
            arbitrageConfig,
            nextRunAt,
            atualizadoEm: now,
          },
        })
        .returning();

      res.json({ success: true, data: saved });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao atualizar scheduler de análise');
      res.status(500).json({ error: errorMessage });
    }
  });
}
