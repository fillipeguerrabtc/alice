import { and, eq, getDatabase, lte, schema } from '@alice/database';
import type {
  TradingArbitrageConfig,
  TradingEnsembleConfig,
  TradingProfileConsensus,
  TradingProfileDataSources,
  TradingProfileModelConfig,
  TradingTechnique,
} from '@alice/shared';
import type { TradingMarginMode, TradingMarketType } from './tradingTypes.js';

type TradingProfileKind = 'analysis' | 'signal';
type TradingIntervalValue = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '8h' | '12h' | '1d' | '1w';
type TradingIndicatorKey = 'rsi' | 'macd' | 'moving_averages' | 'bollinger' | 'atr' | 'stochastic' | 'adx' | 'support_resistance' | 'volume';

type SchedulerLogger = {
  info: (obj: Record<string, unknown>, message: string) => void;
  warn: (obj: Record<string, unknown>, message: string) => void;
  error: (obj: Record<string, unknown>, message: string) => void;
};

type NormalizedTradingProfile = {
  timeframes: TradingIntervalValue[];
  indicators: TradingIndicatorKey[];
  techniques: TradingTechnique[];
  ensembleConfig: TradingEnsembleConfig;
  arbitrageConfig?: TradingArbitrageConfig;
  dataSources?: TradingProfileDataSources;
  modelConfig?: TradingProfileModelConfig;
  consensus?: TradingProfileConsensus;
};

export function createTradingSchedulerRuntimeService(deps: {
  logger: SchedulerLogger;
  normalizeSignalSymbols: (symbols: string[]) => string[];
  getOrCreateTradingProfile: (tenantId: string, kind: TradingProfileKind) => Promise<schema.TradingAnalysisProfile>;
  normalizeTradingProfile: (profile: schema.TradingAnalysisProfile) => NormalizedTradingProfile;
  resolveSchedulerUserId: (tenantId: string) => Promise<string>;
  generateTradingSignalFromLlm: (params: {
    tenantId: string;
    userId: string;
    symbol: string;
    interval: string;
    marketType?: TradingMarketType;
    marginMode?: TradingMarginMode;
    source: 'scheduler';
    agentId?: string;
    schedulerId?: string;
    timeframes?: TradingIntervalValue[];
    indicators?: TradingIndicatorKey[];
    dataSources?: TradingProfileDataSources;
    modelConfig?: TradingProfileModelConfig;
    consensus?: TradingProfileConsensus;
    techniques?: TradingTechnique[];
    ensembleConfig?: TradingEnsembleConfig;
    arbitrageConfig?: TradingArbitrageConfig;
  }) => Promise<{ signal: { id: string } }>;
  calculateAndPersistTechnicalAnalysis: (params: {
    tenantId: string;
    userId: string;
    symbol: string;
    interval: string;
    marketType?: TradingMarketType;
    marginMode?: TradingMarginMode;
    enabledIndicators?: TradingIndicatorKey[];
    techniques?: TradingTechnique[];
    ensembleConfig?: TradingEnsembleConfig;
  }) => Promise<{ indicatorId: string }>;
  assertArbitrageConfigForTechniques: (params: {
    techniques: TradingTechnique[];
    arbitrageConfig?: TradingArbitrageConfig;
    timeframes: TradingIntervalValue[];
    context: string;
  }) => void;
  parseTradingInterval: (interval: string) => TradingIntervalValue;
  signalSchedulerPollIntervalMs?: number;
  analysisSchedulerPollIntervalMs?: number;
}) {
  const signalSchedulerPollIntervalMs = deps.signalSchedulerPollIntervalMs ?? 30000;
  const analysisSchedulerPollIntervalMs = deps.analysisSchedulerPollIntervalMs ?? 30000;

  let signalSchedulerInterval: NodeJS.Timeout | null = null;
  let analysisSchedulerInterval: NodeJS.Timeout | null = null;

  async function runDueSignalSchedulers(): Promise<void> {
    const db = getDatabase();
    const now = new Date();

    const schedulers = await db
      .select()
      .from(schema.tradingSignalSchedulers)
      .where(
        and(
          eq(schema.tradingSignalSchedulers.enabled, true),
          lte(schema.tradingSignalSchedulers.nextRunAt, now),
        ),
      );

    if (schedulers.length === 0) {
      return;
    }

    for (const scheduler of schedulers) {
      const locked = await db
        .update(schema.tradingSignalSchedulers)
        .set({
          lastRunAt: now,
          nextRunAt: new Date(now.getTime() + (scheduler.intervalMinutes ?? 15) * 60 * 1000),
          atualizadoEm: now,
          lastError: null,
        })
        .where(
          and(
            eq(schema.tradingSignalSchedulers.id, scheduler.id),
            lte(schema.tradingSignalSchedulers.nextRunAt, now),
          ),
        )
        .returning();

      if (locked.length === 0) {
        continue;
      }

      const startTime = Date.now();
      try {
        const symbols = deps.normalizeSignalSymbols((scheduler.symbols ?? []) as string[]);
        if (symbols.length === 0) {
          throw new Error('Scheduler sem símbolos configurados.');
        }

        const profileRow = await deps.getOrCreateTradingProfile(scheduler.tenantId, 'signal');
        const profile = deps.normalizeTradingProfile(profileRow);
        const techniques = (scheduler.techniques?.length
          ? scheduler.techniques
          : profile.techniques) as TradingTechnique[];
        const ensembleConfig = (scheduler.ensembleConfig ?? profile.ensembleConfig) as TradingEnsembleConfig;
        const arbitrageConfig = (scheduler.arbitrageConfig ?? profile.arbitrageConfig) as TradingArbitrageConfig | undefined;

        const maxSignals = Math.max(1, Math.min(symbols.length, scheduler.maxSignalsPerRun ?? symbols.length));
        const selectedSymbols = symbols.slice(0, maxSignals);
        let lastSignalId: string | null = null;
        const schedulerUserId = await deps.resolveSchedulerUserId(scheduler.tenantId);

        for (const symbol of selectedSymbols) {
          const result = await deps.generateTradingSignalFromLlm({
            tenantId: scheduler.tenantId,
            userId: schedulerUserId,
            symbol,
            interval: scheduler.interval || '5m',
            marketType: scheduler.marketType as TradingMarketType,
            marginMode: (scheduler.marginMode ?? undefined) as TradingMarginMode | undefined,
            source: 'scheduler',
            agentId: scheduler.agentId ?? undefined,
            schedulerId: scheduler.id,
            timeframes: profile.timeframes,
            indicators: profile.indicators,
            dataSources: profile.dataSources,
            techniques,
            ensembleConfig,
            arbitrageConfig,
            modelConfig: profile.modelConfig,
            consensus: profile.consensus,
          });
          lastSignalId = result.signal.id;
        }

        const durationMs = Date.now() - startTime;
        await db.update(schema.tradingSignalSchedulers)
          .set({
            lastSuccessAt: new Date(),
            lastDurationMs: durationMs,
            lastSignalId,
            lastError: null,
            atualizadoEm: new Date(),
          })
          .where(eq(schema.tradingSignalSchedulers.id, scheduler.id));
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        await db.update(schema.tradingSignalSchedulers)
          .set({
            lastError: errorMessage,
            lastDurationMs: durationMs,
            atualizadoEm: new Date(),
          })
          .where(eq(schema.tradingSignalSchedulers.id, scheduler.id));
        deps.logger.error({ error: errorMessage, schedulerId: scheduler.id }, 'Falha ao executar scheduler de sinais');
      }
    }
  }

  function startTradingSignalScheduler(): void {
    void runDueSignalSchedulers().catch((error) => {
      deps.logger.warn({ error }, 'Falha no scheduler de sinais (startup)');
    });
    signalSchedulerInterval = setInterval(() => {
      void runDueSignalSchedulers().catch((error) => {
        deps.logger.warn({ error }, 'Falha no scheduler de sinais');
      });
    }, signalSchedulerPollIntervalMs);
    deps.logger.info({ intervalMs: signalSchedulerPollIntervalMs }, 'Scheduler de sinais LLM iniciado');
  }

  function stopTradingSignalScheduler(): void {
    if (signalSchedulerInterval) {
      clearInterval(signalSchedulerInterval);
      signalSchedulerInterval = null;
    }
  }

  async function runDueAnalysisSchedulers(): Promise<void> {
    const db = getDatabase();
    const now = new Date();

    const schedulers = await db
      .select()
      .from(schema.tradingAnalysisSchedulers)
      .where(
        and(
          eq(schema.tradingAnalysisSchedulers.enabled, true),
          lte(schema.tradingAnalysisSchedulers.nextRunAt, now),
        ),
      );

    if (schedulers.length === 0) {
      return;
    }

    for (const scheduler of schedulers) {
      const locked = await db
        .update(schema.tradingAnalysisSchedulers)
        .set({
          lastRunAt: now,
          nextRunAt: new Date(now.getTime() + (scheduler.intervalMinutes ?? 15) * 60 * 1000),
          atualizadoEm: now,
          lastError: null,
        })
        .where(
          and(
            eq(schema.tradingAnalysisSchedulers.id, scheduler.id),
            lte(schema.tradingAnalysisSchedulers.nextRunAt, now),
          ),
        )
        .returning();

      if (locked.length === 0) {
        continue;
      }

      const startTime = Date.now();
      try {
        const symbols = deps.normalizeSignalSymbols((scheduler.symbols ?? []) as string[]);
        if (symbols.length === 0) {
          throw new Error('Scheduler de análise sem símbolos configurados.');
        }

        const profileRow = await deps.getOrCreateTradingProfile(scheduler.tenantId, 'analysis');
        const profile = deps.normalizeTradingProfile(profileRow);
        const techniques = (scheduler.techniques?.length
          ? scheduler.techniques
          : profile.techniques) as TradingTechnique[];
        const ensembleConfig = (scheduler.ensembleConfig ?? profile.ensembleConfig) as TradingEnsembleConfig;
        const arbitrageConfig = (scheduler.arbitrageConfig ?? profile.arbitrageConfig) as TradingArbitrageConfig | undefined;
        const timeframes: TradingIntervalValue[] = profile.timeframes?.length
          ? profile.timeframes
          : [deps.parseTradingInterval(scheduler.interval ?? '5m')];
        const enabledIndicators = profile.indicators?.length ? profile.indicators : undefined;

        deps.assertArbitrageConfigForTechniques({
          techniques,
          arbitrageConfig,
          timeframes,
          context: 'scheduler de análise',
        });

        const maxSymbols = Math.max(1, scheduler.maxSymbolsPerRun ?? 1);
        const selectedSymbols = symbols.slice(0, maxSymbols);
        let lastIndicatorId: string | null = null;
        const schedulerUserId = await deps.resolveSchedulerUserId(scheduler.tenantId);

        for (const symbol of selectedSymbols) {
          for (const timeframe of timeframes) {
            const result = await deps.calculateAndPersistTechnicalAnalysis({
              tenantId: scheduler.tenantId,
              userId: schedulerUserId,
              symbol,
              interval: timeframe,
              marketType: scheduler.marketType as TradingMarketType,
              marginMode: (scheduler.marginMode ?? undefined) as TradingMarginMode | undefined,
              enabledIndicators,
              techniques,
              ensembleConfig,
            });
            lastIndicatorId = result.indicatorId;
          }
        }

        const durationMs = Date.now() - startTime;
        await db.update(schema.tradingAnalysisSchedulers)
          .set({
            lastSuccessAt: new Date(),
            lastDurationMs: durationMs,
            lastIndicatorId,
            lastError: null,
            atualizadoEm: new Date(),
          })
          .where(eq(schema.tradingAnalysisSchedulers.id, scheduler.id));
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        await db.update(schema.tradingAnalysisSchedulers)
          .set({
            lastError: errorMessage,
            lastDurationMs: durationMs,
            atualizadoEm: new Date(),
          })
          .where(eq(schema.tradingAnalysisSchedulers.id, scheduler.id));
        deps.logger.error({ error: errorMessage, schedulerId: scheduler.id }, 'Falha ao executar scheduler de análise');
      }
    }
  }

  function startTradingAnalysisScheduler(): void {
    void runDueAnalysisSchedulers().catch((error) => {
      deps.logger.warn({ error }, 'Falha no scheduler de análise (startup)');
    });
    analysisSchedulerInterval = setInterval(() => {
      void runDueAnalysisSchedulers().catch((error) => {
        deps.logger.warn({ error }, 'Falha no scheduler de análise');
      });
    }, analysisSchedulerPollIntervalMs);
    deps.logger.info({ intervalMs: analysisSchedulerPollIntervalMs }, 'Scheduler de análise determinística iniciado');
  }

  function stopTradingAnalysisScheduler(): void {
    if (analysisSchedulerInterval) {
      clearInterval(analysisSchedulerInterval);
      analysisSchedulerInterval = null;
    }
  }

  return {
    runDueSignalSchedulers,
    startTradingSignalScheduler,
    stopTradingSignalScheduler,
    runDueAnalysisSchedulers,
    startTradingAnalysisScheduler,
    stopTradingAnalysisScheduler,
  };
}
