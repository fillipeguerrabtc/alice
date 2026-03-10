import {
  TradingArbitrageConfigSchema,
  TradingEnsembleConfigSchema,
} from '@alice/shared';
import type {
  TradingArbitrageConfig,
  TradingEnsembleConfig,
  TradingIndicatorKey,
  TradingProfileConsensus,
  TradingProfileDataSources,
  TradingProfileModelConfig,
  TradingProfileNewsConfig,
  TradingTechnique,
} from '@alice/shared';
import type { TradingNewsConfigResolved } from './trading-news-service.js';
import { z } from 'zod';

type TradingIntervalValue =
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '8h'
  | '12h'
  | '1d'
  | '1w';

type TradingAnalysisProfileRow = {
  timeframes?: string[] | null;
  indicators?: TradingIndicatorKey[] | null;
  dataSources?: Partial<TradingProfileDataSources> | null;
  techniques?: TradingTechnique[] | null;
  ensembleConfig?: TradingEnsembleConfig | null;
  arbitrageConfig?: TradingArbitrageConfig | null;
  modelConfig?: TradingProfileModelConfig | null;
  newsConfig?: TradingProfileNewsConfig | null;
  consensus?: Partial<TradingProfileConsensus> | null;
};

export class TradingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TradingConfigError';
  }
}

export function createTradingProfileConfigService(deps: {
  tradingIntervalZod: z.ZodType<TradingIntervalValue>;
  tradingIndicatorZod: z.ZodType<TradingIndicatorKey>;
  tradingTechniqueZod: z.ZodType<TradingTechnique>;
  tradingIndicatorKeys: readonly TradingIndicatorKey[];
  tradingIntervalGranularity: Record<TradingIntervalValue, number>;
  defaultTradingTechniques: readonly TradingTechnique[];
  defaultTradingEnsembleConfig: TradingEnsembleConfig;
  maxArbitrageIntermediateAssets: number;
  normalizeTradingNewsConfig: (raw?: TradingProfileNewsConfig | null) => TradingNewsConfigResolved;
}) {
  function parseListParam(input?: string | string[]): string[] {
    if (!input) return [];
    const rawList = Array.isArray(input) ? input : input.split(',');
    return rawList.map((item) => item.trim()).filter(Boolean);
  }

  function parseTimeframesParam(input?: string | string[]): TradingIntervalValue[] {
    const list = parseListParam(input);
    if (list.length === 0) return [];
    return list.map((value) => deps.tradingIntervalZod.parse(value));
  }

  function parseIndicatorsParam(input?: string | string[]): TradingIndicatorKey[] {
    const list = parseListParam(input);
    if (list.length === 0) return [];
    return list.map((value) => deps.tradingIndicatorZod.parse(value)) as TradingIndicatorKey[];
  }

  function parseTechniquesParam(input?: string | string[]): TradingTechnique[] {
    const list = parseListParam(input);
    if (list.length === 0) return [];
    return list.map((value) => deps.tradingTechniqueZod.parse(value)) as TradingTechnique[];
  }

  function normalizeTradingTechniques(raw?: TradingTechnique[] | null): TradingTechnique[] {
    if (!Array.isArray(raw) || raw.length === 0) {
      return [...deps.defaultTradingTechniques];
    }
    const parsed = raw.map((value) => deps.tradingTechniqueZod.parse(value));
    const unique = Array.from(new Set(parsed));
    return unique.length > 0 ? unique : [...deps.defaultTradingTechniques];
  }

  function normalizeTradingEnsembleConfig(raw?: TradingEnsembleConfig | null): TradingEnsembleConfig {
    const parsed = TradingEnsembleConfigSchema.safeParse(raw ?? deps.defaultTradingEnsembleConfig);
    if (parsed.success) return parsed.data;
    return { ...deps.defaultTradingEnsembleConfig };
  }

  function normalizeTradingArbitrageConfig(raw?: TradingArbitrageConfig | null): TradingArbitrageConfig | undefined {
    if (!raw) return undefined;
    const parsed = TradingArbitrageConfigSchema.safeParse(raw);
    if (!parsed.success) {
      throw new TradingConfigError('Configuração de arbitragem inválida');
    }
    const normalizedExchanges = Array.from(new Set(parsed.data.exchanges));
    const normalizedAssets = Array.from(
      new Set(parsed.data.intermediateAssets.map((asset) => asset.trim().toUpperCase()).filter(Boolean))
    );
    if (normalizedAssets.length > deps.maxArbitrageIntermediateAssets) {
      throw new TradingConfigError(`Máximo de ${deps.maxArbitrageIntermediateAssets} ativos intermediários permitido.`);
    }
    return {
      ...parsed.data,
      exchanges: normalizedExchanges,
      intermediateAssets: normalizedAssets,
    };
  }

  function resolveIntervalMinutes(interval: TradingIntervalValue): number {
    return deps.tradingIntervalGranularity[interval];
  }

  function assertArbitrageConfigForTechniques(params: {
    techniques: TradingTechnique[];
    arbitrageConfig?: TradingArbitrageConfig;
    timeframes: TradingIntervalValue[];
    context: string;
  }): void {
    if (!params.techniques.includes('arbitrage_triangular')) return;
    if (!params.arbitrageConfig) {
      throw new TradingConfigError(`Configuração de arbitragem obrigatória para ${params.context}`);
    }
    const maxMinutes = params.arbitrageConfig.maxIntervalMinutes;
    const invalidFrames = params.timeframes.filter((frame) => resolveIntervalMinutes(frame) > maxMinutes);
    if (invalidFrames.length > 0) {
      throw new TradingConfigError(`Arbitragem triangular exige timeframes <= ${maxMinutes} minutos. Ajuste: ${invalidFrames.join(', ')}`);
    }
  }

  function normalizeTradingProfile(row?: TradingAnalysisProfileRow | null): {
    timeframes: TradingIntervalValue[];
    indicators: TradingIndicatorKey[];
    dataSources: TradingProfileDataSources;
    techniques: TradingTechnique[];
    ensembleConfig: TradingEnsembleConfig;
    arbitrageConfig?: TradingArbitrageConfig;
    modelConfig: TradingProfileModelConfig;
    consensus: TradingProfileConsensus;
    newsConfig: TradingNewsConfigResolved;
  } {
    const timeframes = row?.timeframes?.length
      ? row.timeframes.map((value) => deps.tradingIntervalZod.parse(value))
      : (['5m'] as TradingIntervalValue[]);
    const indicators = Array.isArray(row?.indicators) && row.indicators.length > 0
      ? row.indicators as TradingIndicatorKey[]
      : [...deps.tradingIndicatorKeys];
    const dataSourcesRaw = row?.dataSources ?? {};
    const dataSources: TradingProfileDataSources = {
      orderBook: Boolean(dataSourcesRaw?.orderBook),
      news: Boolean(dataSourcesRaw?.news),
      trainingData: Boolean(dataSourcesRaw?.trainingData),
    };
    const techniques = normalizeTradingTechniques(row?.techniques as TradingTechnique[] | null);
    const ensembleConfig = normalizeTradingEnsembleConfig(row?.ensembleConfig as TradingEnsembleConfig | null);
    const arbitrageConfig = normalizeTradingArbitrageConfig(row?.arbitrageConfig as TradingArbitrageConfig | null);
    const modelConfigRaw = row?.modelConfig ?? {};
    const modelConfig: TradingProfileModelConfig = {
      temperature: modelConfigRaw?.temperature ?? undefined,
      maxTokens: modelConfigRaw?.maxTokens ?? undefined,
    };
    const newsConfig = deps.normalizeTradingNewsConfig(row?.newsConfig ?? null);
    const consensusRaw = row?.consensus as Partial<TradingProfileConsensus> | undefined;
    const consensus: TradingProfileConsensus = {
      rule: consensusRaw?.rule === 'majority' ? 'majority' : 'majority',
      minAgree: consensusRaw?.minAgree ?? undefined,
    };

    return {
      timeframes,
      indicators,
      dataSources,
      techniques,
      ensembleConfig,
      arbitrageConfig,
      modelConfig,
      consensus,
      newsConfig,
    };
  }

  return {
    parseListParam,
    parseTimeframesParam,
    parseIndicatorsParam,
    parseTechniquesParam,
    normalizeTradingTechniques,
    normalizeTradingEnsembleConfig,
    normalizeTradingArbitrageConfig,
    assertArbitrageConfigForTechniques,
    normalizeTradingProfile,
  };
}
