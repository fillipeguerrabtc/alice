import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { eq, getDatabase, schema } from '@alice/database';
import { extractAuthContext, requirePermission } from '@alice/shared-utils';
import {
  TradingArbitrageConfigSchema,
  TradingArbitrageExchangeSchema,
  TradingEnsembleConfigSchema,
  tradingIntervalEnum,
} from '@alice/shared';
import type {
  TradingArbitrageConfig,
  TradingArbitrageExchange,
  TradingEnsembleConfig,
  TradingEnsembleResult,
  TradingIndicatorKey,
  TradingOverallSignal,
  TradingProfileConsensus,
  TradingProfileDataSources,
  TradingProfileModelConfig,
  TradingRiskConfig,
  TradingTechnique,
  TradingTechniqueScore,
} from '@alice/shared';
import { z } from 'zod';
import type * as technicalIndicators from '../technical-indicators.js';
import {
  applyCapabilityToTechniqueScore,
  buildUnsupportedTechniqueScores,
  filterSupportedTradingTechniques,
  mapTechniqueCapabilitiesByTechnique,
  resolveTradingTechniqueCapabilities,
} from '../trading-technique-capability-service.js';

type TradingMarketType = 'futures' | 'spot' | 'margin';
type TradingMarginMode = 'cross' | 'isolated';
type TradingProfileKind = 'analysis' | 'signal';
type TradingIntervalValue = typeof tradingIntervalEnum.enumValues[number];

interface TradingAuthContext {
  tenantId: string;
  userId: string;
}

type TradingNewsConfigResolved = {
  engines: string[];
  categories: string;
  language: string;
  safesearch: string;
  timeRange: 'last_hour' | 'last_24_hours' | 'custom' | 'day' | 'week' | 'month' | 'year';
  dateFrom?: string;
  dateTo?: string;
  queryTemplates: string[];
  extraTerms: string[];
  maxResults: number;
};

interface TradingProfileNormalized {
  timeframes: TradingIntervalValue[];
  indicators: TradingIndicatorKey[];
  dataSources: TradingProfileDataSources;
  techniques: TradingTechnique[];
  ensembleConfig: TradingEnsembleConfig;
  arbitrageConfig?: TradingArbitrageConfig;
  modelConfig: TradingProfileModelConfig;
  consensus: TradingProfileConsensus;
  newsConfig: TradingNewsConfigResolved;
}

type AnalysisMatrixEntry = {
  interval: TradingIntervalValue;
  analysis: technicalIndicators.TechnicalAnalysisResult;
  indicatorId: string;
  resolvedSymbol?: string;
  techniqueScores?: TradingTechniqueScore[];
  ensembleResult?: TradingEnsembleResult;
};

type TriangularArbitrageResult = {
  intermediateAsset: string;
  startAsset: string;
  endAsset: string;
  edgePct: number;
  finalAmount: number;
  networkFeeTotal: number;
  networkFeesApplied: Array<{
    asset: string;
    amount: number;
    fromExchange: TradingArbitrageExchange;
    toExchange: TradingArbitrageExchange;
  }>;
  legs: Array<{
    from: string;
    to: string;
    symbol: string;
    exchange: TradingArbitrageExchange;
    side: 'sell' | 'buy';
    rate: number;
    bestBid: number | null;
    bestAsk: number | null;
  }>;
};

interface RegisterTradingAnalysisRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  tradingIntervalZod: z.ZodType<TradingIntervalValue>;
  tradingIndicatorZod: z.ZodType<TradingIndicatorKey>;
  tradingTechniqueZod: z.ZodType<TradingTechnique>;
  getOrCreateTradingProfile: (tenantId: string, kind: TradingProfileKind) => Promise<schema.TradingAnalysisProfile>;
  normalizeTradingProfile: (row?: schema.TradingAnalysisProfile | null) => TradingProfileNormalized;
  normalizeTradingTechniques: (raw?: TradingTechnique[] | null) => TradingTechnique[];
  normalizeTradingEnsembleConfig: (raw?: TradingEnsembleConfig | null) => TradingEnsembleConfig;
  normalizeTradingArbitrageConfig: (raw?: TradingArbitrageConfig | null) => TradingArbitrageConfig | undefined;
  assertArbitrageConfigForTechniques: (params: {
    techniques: TradingTechnique[];
    arbitrageConfig?: TradingArbitrageConfig;
    timeframes: TradingIntervalValue[];
    context: string;
  }) => void;
  resolveDefaultSymbolForMarketType: (params: {
    auth: TradingAuthContext;
    marketType: TradingMarketType;
  }) => Promise<string>;
  resolveArbitrageFeePctForExchanges: (params: {
    exchanges: TradingArbitrageExchange[];
    symbol: string;
    marketType: TradingMarketType;
    tenantId: string;
  }) => Promise<{
    feePctByExchange: Record<TradingArbitrageExchange, number>;
    effectiveFeePct: number;
  }>;
  deriveIntermediateAssetsFromSymbols: (symbols: string[]) => string[];
  resolveNetworkFeesForTenant: (tenantId: string) => Promise<Record<string, number>>;
  listSpotSymbols: () => Promise<Array<{ symbol: string }>>;
  parseListParam: (input?: string | string[]) => string[];
  parseTimeframesParam: (input?: string | string[]) => TradingIntervalValue[];
  parseIndicatorsParam: (input?: string | string[]) => TradingIndicatorKey[];
  parseTechniquesParam: (input?: string | string[]) => TradingTechnique[];
  resolveMarketTypeParam: (params: {
    marketType?: TradingMarketType;
    type?: TradingMarketType;
  }) => TradingMarketType | undefined;
  isKucoinConfigured: () => boolean;
  isSpotConfigured: () => boolean;
  isMarginConfigured: () => boolean;
  respondKucoinNotConfigured: (res: Response) => void;
  sendKucoinErrorResponse: (res: Response, error: unknown) => boolean;
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
  }) => Promise<{
    analysis: technicalIndicators.TechnicalAnalysisResult;
    indicatorId: string;
    resolvedSymbol: string;
    techniqueScores: TradingTechniqueScore[];
    ensembleResult: TradingEnsembleResult;
  }>;
  buildMajorityConsensus: (
    matrix: AnalysisMatrixEntry[],
    consensusConfig?: TradingProfileConsensus,
  ) => {
    overallSignal: technicalIndicators.TechnicalAnalysisResult['overallSignal'];
    confidence: number;
    alignedTimeframes: TradingIntervalValue[];
    misalignedTimeframes: TradingIntervalValue[];
    agreementRatio: number;
    requiredAgree: number;
    totalTimeframes: number;
    isMajorityReached: boolean;
  };
  aggregateTechniqueScores: (matrix: AnalysisMatrixEntry[], techniques: TradingTechnique[]) => TradingTechniqueScore[];
  buildEnsembleResult: (scores: TradingTechniqueScore[], config: TradingEnsembleConfig) => TradingEnsembleResult;
  splitSymbolPair: (symbol: string) => { base: string; quote: string };
  calculateTriangularArbitrage: (params: {
    auth: TradingAuthContext;
    startAsset: string;
    quoteAsset: string;
    intermediateAssets: string[];
    marketType?: TradingMarketType;
    marginMode?: TradingMarginMode;
    feePct: number;
    exchanges: TradingArbitrageExchange[];
    feePctByExchange: Record<TradingArbitrageExchange, number>;
    networkFeesByAsset?: Record<string, number>;
    maxSlippagePct: number;
  }) => Promise<TriangularArbitrageResult[]>;
  getOrderBookSnapshot: (
    auth: TradingAuthContext,
    symbol: string,
    marketType?: TradingMarketType,
    marginMode?: TradingMarginMode,
    exchange?: TradingArbitrageExchange,
  ) => Promise<unknown>;
  fetchNewsSummary: (
    auth: TradingAuthContext,
    symbol: string,
    marketType?: TradingMarketType,
    newsConfig?: TradingNewsConfigResolved,
  ) => Promise<unknown>;
  resolveTradingNamespaceId: (tenantId: string) => Promise<string | null>;
  fetchTradingDatasetSummary: (tenantId: string, namespaceId: string) => Promise<{ totalApproved: number; [key: string]: unknown }>;
  getRiskConfig: (authContext: TradingAuthContext) => Promise<TradingRiskConfig | null>;
  buildTradePlanFromAnalysis: (params: {
    analysis: technicalIndicators.TechnicalAnalysisResult;
    interval: string;
    timeframes: string[];
    marketType: TradingMarketType;
    marginMode?: TradingMarginMode;
    riskConfig: TradingRiskConfig | null;
  }) => unknown;
  formatAnalysisForLlm: (analysis: technicalIndicators.TechnicalAnalysisResult) => string;
  isTradingConfigError: (error: unknown) => boolean;
  tradingConfigErrorMessage: string;
  arbitrageExchangeLabels: Record<TradingArbitrageExchange, string>;
}

function getTradingAuthContext(req: Request): TradingAuthContext | null {
  const authContext = extractAuthContext(req);
  if (!authContext?.tenantId || !authContext?.userId) {
    return null;
  }
  return { tenantId: authContext.tenantId, userId: authContext.userId };
}

export function registerTradingAnalysisRoutes(
  app: Express,
  deps: RegisterTradingAnalysisRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  app.get('/api/integrations/trading/analysis-profile', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const querySchema = z.object({
        kind: z.enum(['analysis', 'signal']).optional().default('analysis'),
        marketType: z.enum(['futures', 'spot', 'margin']).optional().default('futures'),
      });
      const parsedQuery = querySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({ error: 'Query inválida', details: parsedQuery.error.flatten() });
        return;
      }

      const profileRow = await deps.getOrCreateTradingProfile(authContext.tenantId, parsedQuery.data.kind);
      const profile = deps.normalizeTradingProfile(profileRow);
      const techniqueCapabilities = resolveTradingTechniqueCapabilities({
        techniques: profile.techniques,
        marketType: parsedQuery.data.marketType,
        dataSources: profile.dataSources,
        hasArbitrageConfig: Boolean(profile.arbitrageConfig),
      });

      res.json({
        success: true,
        data: {
          id: profileRow.id,
          kind: profileRow.kind,
          name: profileRow.name,
          timeframes: profile.timeframes,
          indicators: profile.indicators,
          dataSources: profile.dataSources,
          techniques: profile.techniques,
          techniqueCapabilities,
          ensembleConfig: profile.ensembleConfig,
          arbitrageConfig: profile.arbitrageConfig,
          modelConfig: profile.modelConfig,
          newsConfig: profile.newsConfig,
          consensus: profile.consensus,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter perfil de análise/sinal');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/arbitrage/catalog', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const querySchema = z.object({
        marketType: z.enum(['spot', 'margin', 'futures']).optional().default('spot'),
        symbol: z.string().min(1).optional(),
        exchanges: z.string().optional(),
      });
      const parsedQuery = querySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({ error: 'Query inválida', details: parsedQuery.error.flatten() });
        return;
      }

      const marketType = parsedQuery.data.marketType;
      if (marketType === 'futures') {
        res.status(400).json({ error: 'Arbitragem triangular não suporta mercado Futures.' });
        return;
      }

      const requestedExchanges = deps.parseListParam(parsedQuery.data.exchanges);
      const parsedExchanges = requestedExchanges.length > 0
        ? requestedExchanges.map((value) => TradingArbitrageExchangeSchema.parse(value))
        : (['kucoin'] as TradingArbitrageExchange[]);

      const spotSymbols = await deps.listSpotSymbols();
      const symbolList = spotSymbols.map((item) => item.symbol).filter(Boolean);
      const resolvedSymbol = parsedQuery.data.symbol
        ? parsedQuery.data.symbol.trim().toUpperCase()
        : (symbolList[0] ?? '');
      if (!resolvedSymbol) {
        res.status(500).json({ error: 'Não foi possível determinar um símbolo para calcular taxa de trade.' });
        return;
      }

      const intermediateAssets = deps.deriveIntermediateAssetsFromSymbols(symbolList);
      const { feePctByExchange, effectiveFeePct } = await deps.resolveArbitrageFeePctForExchanges({
        exchanges: parsedExchanges,
        symbol: resolvedSymbol,
        marketType,
        tenantId: authContext.tenantId,
      });
      const networkFeesByAsset = await deps.resolveNetworkFeesForTenant(authContext.tenantId);

      res.json({
        success: true,
        data: {
          exchanges: parsedExchanges.map((exchange) => ({
            id: exchange,
            label: deps.arbitrageExchangeLabels[exchange] ?? exchange,
          })),
          intermediateAssets,
          feePctByExchange,
          effectiveFeePct,
          networkFeesByAsset,
          updatedAt: new Date().toISOString(),
          sources: {
            feePct: 'kucoin_api',
            networkFees: 'kucoin_api',
          },
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao obter catálogo de arbitragem');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.put('/api/integrations/trading/analysis-profile', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const bodySchema = z.object({
        kind: z.enum(['analysis', 'signal']).optional().default('analysis'),
        marketType: z.enum(['spot', 'margin', 'futures']).optional(),
        symbol: z.string().min(3).optional(),
        name: z.string().min(1).max(100).optional(),
        timeframes: z.array(deps.tradingIntervalZod).min(1).optional(),
        indicators: z.array(deps.tradingIndicatorZod).min(1).optional(),
        dataSources: z.object({
          orderBook: z.boolean().optional(),
          news: z.boolean().optional(),
          trainingData: z.boolean().optional(),
        }).optional(),
        techniques: z.array(deps.tradingTechniqueZod).min(1).optional(),
        ensembleConfig: TradingEnsembleConfigSchema.optional(),
        arbitrageConfig: TradingArbitrageConfigSchema.optional().nullable(),
        newsConfig: z.object({
          engines: z.array(z.string().min(1)).optional(),
          categories: z.string().min(1).optional(),
          language: z.string().min(2).optional(),
          safesearch: z.string().min(1).optional(),
          timeRange: z.enum(['last_hour', 'last_24_hours', 'custom', 'day', 'week', 'month', 'year']).optional(),
          dateFrom: z.string().min(10).optional(),
          dateTo: z.string().min(10).optional(),
          queryTemplates: z.array(z.string().min(3)).optional(),
          extraTerms: z.array(z.string().min(1)).optional(),
          maxResults: z.number().int().min(1).max(10).optional(),
        }).optional(),
        modelConfig: z.object({
          temperature: z.number().min(0).max(2).optional(),
          maxTokens: z.number().min(256).max(4096).optional(),
        }).optional(),
        consensus: z.object({
          rule: z.literal('majority').optional(),
          minAgree: z.number().min(1).optional().nullable(),
        }).optional(),
      });
      const parsedBody = bodySchema.safeParse(req.body);
      if (!parsedBody.success) {
        logger.warn({ zodErrors: parsedBody.error.flatten(), bodyKeys: Object.keys(req.body ?? {}) }, 'Validação Zod falhou no perfil de análise/sinal');
        res.status(400).json({ error: 'Dados inválidos', details: parsedBody.error.flatten() });
        return;
      }

      const profileRow = await deps.getOrCreateTradingProfile(authContext.tenantId, parsedBody.data.kind);
      const profileBase = deps.normalizeTradingProfile(profileRow);
      const consensusUpdate = parsedBody.data.consensus
        ? { rule: 'majority' as const, minAgree: parsedBody.data.consensus.minAgree ?? undefined }
        : undefined;
      const resolvedTimeframes = (parsedBody.data.timeframes ?? profileBase.timeframes) as TradingIntervalValue[];
      const resolvedDataSources = parsedBody.data.dataSources ?? profileBase.dataSources;
      const resolvedTechniques = deps.normalizeTradingTechniques(parsedBody.data.techniques ?? profileBase.techniques);
      const resolvedEnsemble = deps.normalizeTradingEnsembleConfig(parsedBody.data.ensembleConfig ?? profileBase.ensembleConfig);
      const resolvedArbitrage = deps.normalizeTradingArbitrageConfig(parsedBody.data.arbitrageConfig ?? profileBase.arbitrageConfig);
      const marketTypeForFees = parsedBody.data.marketType ?? 'spot';

      deps.assertArbitrageConfigForTechniques({
        techniques: resolvedTechniques,
        arbitrageConfig: resolvedArbitrage,
        timeframes: resolvedTimeframes,
        context: 'perfil de análise/sinal',
      });
      if (resolvedTechniques.includes('arbitrage_triangular') && resolvedArbitrage && marketTypeForFees === 'futures') {
        res.status(400).json({ error: 'Arbitragem triangular não é suportada em mercado futures.' });
        return;
      }

      let arbitrageConfigToPersist = resolvedArbitrage;
      if (resolvedArbitrage) {
        const feeSymbol = parsedBody.data.symbol
          ? parsedBody.data.symbol.trim().toUpperCase()
          : await deps.resolveDefaultSymbolForMarketType({
              auth: authContext,
              marketType: marketTypeForFees,
            });
        const { effectiveFeePct } = await deps.resolveArbitrageFeePctForExchanges({
          exchanges: resolvedArbitrage.exchanges,
          symbol: feeSymbol,
          marketType: marketTypeForFees,
          tenantId: authContext.tenantId,
        });
        arbitrageConfigToPersist = {
          ...resolvedArbitrage,
          feePct: effectiveFeePct,
        };
      }

      const updated = await getDatabase()
        .update(schema.tradingAnalysisProfiles)
        .set({
          name: parsedBody.data.name ?? profileRow.name,
          timeframes: resolvedTimeframes,
          indicators: parsedBody.data.indicators ?? profileBase.indicators,
          dataSources: resolvedDataSources,
          techniques: resolvedTechniques,
          ensembleConfig: resolvedEnsemble,
          arbitrageConfig: arbitrageConfigToPersist ?? null,
          modelConfig: parsedBody.data.modelConfig ?? profileBase.modelConfig,
          newsConfig: parsedBody.data.newsConfig ?? profileBase.newsConfig,
          consensus: consensusUpdate ?? profileBase.consensus,
          atualizadoEm: new Date(),
        })
        .where(eq(schema.tradingAnalysisProfiles.id, profileRow.id))
        .returning();

      const updatedRow = updated[0] ?? profileRow;
      const profile = deps.normalizeTradingProfile(updatedRow);
      const techniqueCapabilities = resolveTradingTechniqueCapabilities({
        techniques: profile.techniques,
        marketType: marketTypeForFees,
        dataSources: profile.dataSources,
        hasArbitrageConfig: Boolean(profile.arbitrageConfig),
      });

      res.json({
        success: true,
        data: {
          id: updatedRow.id,
          kind: updatedRow.kind,
          name: updatedRow.name,
          timeframes: profile.timeframes,
          indicators: profile.indicators,
          dataSources: profile.dataSources,
          techniques: profile.techniques,
          techniqueCapabilities,
          ensembleConfig: profile.ensembleConfig,
          arbitrageConfig: profile.arbitrageConfig,
          modelConfig: profile.modelConfig,
          newsConfig: profile.newsConfig,
          consensus: profile.consensus,
        },
      });
    } catch (error) {
      if (deps.isTradingConfigError(error)) {
        res.status(400).json({ error: error instanceof Error ? error.message : deps.tradingConfigErrorMessage });
        return;
      }
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao atualizar perfil de análise/sinal');
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/integrations/trading/analysis/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    try {
      const authContext = getTradingAuthContext(req);
      if (!authContext) {
        res.status(401).json({ error: 'Autenticação necessária' });
        return;
      }

      const tenantId = authContext.tenantId;
      const userId = authContext.userId;
      const { symbol } = req.params;
      if (symbol === 'history') {
        res.status(404).json({ error: 'Rota inválida' });
        return;
      }

      const querySchema = z.object({
        interval: z.string().optional(),
        timeframes: z.union([z.string(), z.array(z.string())]).optional(),
        indicators: z.union([z.string(), z.array(z.string())]).optional(),
        techniques: z.union([z.string(), z.array(z.string())]).optional(),
        orderBook: z.union([z.string(), z.boolean()]).optional(),
        news: z.union([z.string(), z.boolean()]).optional(),
        trainingData: z.union([z.string(), z.boolean()]).optional(),
        marketType: z.enum(['futures', 'spot', 'margin']).optional(),
        type: z.enum(['futures', 'spot', 'margin']).optional(),
        marginMode: z.enum(['cross', 'isolated']).optional(),
      });
      const parsedQuery = querySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({ error: 'Query inválida', details: parsedQuery.error.flatten() });
        return;
      }

      const marketType = deps.resolveMarketTypeParam(parsedQuery.data);
      const marginMode = parsedQuery.data.marginMode;
      const profileRow = await deps.getOrCreateTradingProfile(tenantId, 'analysis');
      const profile = deps.normalizeTradingProfile(profileRow);
      const requestedTimeframes = deps.parseTimeframesParam(parsedQuery.data.timeframes);
      const requestedIndicators = deps.parseIndicatorsParam(parsedQuery.data.indicators);
      const requestedTechniques = deps.parseTechniquesParam(parsedQuery.data.techniques);
      const timeframes = parsedQuery.data.interval
        ? [deps.tradingIntervalZod.parse(parsedQuery.data.interval)]
        : (requestedTimeframes.length > 0 ? requestedTimeframes : profile.timeframes);
      const indicators = requestedIndicators.length > 0 ? requestedIndicators : profile.indicators;
      const techniques = requestedTechniques.length > 0 ? requestedTechniques : profile.techniques;
      const ensembleConfig = profile.ensembleConfig;
      const arbitrageConfig = profile.arbitrageConfig;
      const dataSources: TradingProfileDataSources = {
        orderBook: typeof parsedQuery.data.orderBook === 'boolean'
          ? parsedQuery.data.orderBook
          : parsedQuery.data.orderBook === 'true'
            ? true
            : profile.dataSources.orderBook,
        news: typeof parsedQuery.data.news === 'boolean'
          ? parsedQuery.data.news
          : parsedQuery.data.news === 'true'
            ? true
            : profile.dataSources.news,
        trainingData: typeof parsedQuery.data.trainingData === 'boolean'
          ? parsedQuery.data.trainingData
          : parsedQuery.data.trainingData === 'true'
            ? true
            : profile.dataSources.trainingData,
      };
      const effectiveDataSources: TradingProfileDataSources = {
        ...dataSources,
        trainingData: true,
      };

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

      const techniqueCapabilities = resolveTradingTechniqueCapabilities({
        techniques,
        marketType: marketType ?? 'futures',
        dataSources: effectiveDataSources,
        hasArbitrageConfig: Boolean(arbitrageConfig),
      });
      const capabilityByTechnique = mapTechniqueCapabilitiesByTechnique(techniqueCapabilities);
      const supportedTechniques = filterSupportedTradingTechniques(techniqueCapabilities);
      const deterministicTechniques = supportedTechniques.filter((technique) => technique !== 'arbitrage_triangular');
      const unsupportedTechniqueScores = buildUnsupportedTechniqueScores(techniqueCapabilities);
      const arbitrageCapability = capabilityByTechnique.get('arbitrage_triangular');
      if (arbitrageCapability?.supportLevel === 'supported') {
        deps.assertArbitrageConfigForTechniques({
          techniques: ['arbitrage_triangular'],
          arbitrageConfig,
          timeframes,
          context: 'análise determinística',
        });
      }

      const analysisResults = await Promise.all(
        timeframes.map(async (frame) => {
          const result = await deps.calculateAndPersistTechnicalAnalysis({
            tenantId,
            userId,
            symbol,
            interval: frame,
            marketType,
            marginMode,
            enabledIndicators: indicators,
            techniques: deterministicTechniques,
            ensembleConfig,
          });
          return {
            interval: frame,
            analysis: result.analysis,
            indicatorId: result.indicatorId,
            resolvedSymbol: result.resolvedSymbol,
            techniqueScores: result.techniqueScores,
            ensembleResult: result.ensembleResult,
          };
        }),
      );

      const primaryResult = analysisResults[0];
      if (!primaryResult) {
        res.status(500).json({ error: 'Falha ao obter análise primária.' });
        return;
      }

      const consensus = deps.buildMajorityConsensus(analysisResults, profile.consensus);
      let supportedTechniqueScores = deps
        .aggregateTechniqueScores(analysisResults, deterministicTechniques)
        .map((score) => applyCapabilityToTechniqueScore(score, capabilityByTechnique.get(score.technique)));
      let arbitrageSnapshot: TriangularArbitrageResult | null = null;
      let arbitrageSnapshots: TriangularArbitrageResult[] = [];
      if (supportedTechniques.includes('arbitrage_triangular') && arbitrageConfig) {
        const resolvedSymbol = primaryResult.resolvedSymbol ?? symbol;
        const { base, quote } = deps.splitSymbolPair(resolvedSymbol);
        const { feePctByExchange, effectiveFeePct } = await deps.resolveArbitrageFeePctForExchanges({
          exchanges: arbitrageConfig.exchanges,
          symbol: resolvedSymbol,
          marketType: marketType ?? 'spot',
          tenantId,
        });
        const networkFeesByAsset = arbitrageConfig.exchanges.length > 1
          ? await deps.resolveNetworkFeesForTenant(tenantId)
          : undefined;

        arbitrageSnapshots = await deps.calculateTriangularArbitrage({
          auth: { tenantId, userId },
          startAsset: base,
          quoteAsset: quote,
          intermediateAssets: arbitrageConfig.intermediateAssets,
          marketType,
          marginMode,
          feePct: effectiveFeePct,
          exchanges: arbitrageConfig.exchanges,
          feePctByExchange,
          networkFeesByAsset,
          maxSlippagePct: arbitrageConfig.maxSlippagePct,
        });
        arbitrageSnapshot = arbitrageSnapshots[0] ?? null;
        if (arbitrageSnapshot) {
          const edgePct = arbitrageSnapshot.edgePct;
          const minEdge = arbitrageConfig.minEdgePct;
          const confidence = Math.min(edgePct / Math.max(minEdge, 0.01), 1);
          const signal: TradingOverallSignal = edgePct >= minEdge * 2
            ? 'strong_buy'
            : edgePct >= minEdge
              ? 'buy'
              : 'neutral';
          supportedTechniqueScores = supportedTechniqueScores.concat([
            applyCapabilityToTechniqueScore({
              technique: 'arbitrage_triangular',
              signal,
              confidence: Math.round(confidence * 100) / 100,
              rationale: `Edge ${edgePct.toFixed(2)}% (mín ${minEdge.toFixed(2)}%)`,
            }, capabilityByTechnique.get('arbitrage_triangular')),
          ]);
        } else {
          supportedTechniqueScores = supportedTechniqueScores.concat([
            applyCapabilityToTechniqueScore({
              technique: 'arbitrage_triangular',
              signal: 'neutral',
              confidence: 0,
              rationale: 'Sem rota triangular válida com liquidez suficiente.',
            }, capabilityByTechnique.get('arbitrage_triangular')),
          ]);
        }
      }

      const supportedScoresByTechnique = new Map(
        supportedTechniqueScores.map((score) => [score.technique, score]),
      );
      const unsupportedScoresByTechnique = new Map(
        unsupportedTechniqueScores.map((score) => [score.technique, score]),
      );
      const techniqueScores = techniques
        .map((technique) => supportedScoresByTechnique.get(technique) ?? unsupportedScoresByTechnique.get(technique))
        .filter((score): score is TradingTechniqueScore => Boolean(score));

      const ensembleResult = deps.buildEnsembleResult(techniqueScores, ensembleConfig);
      const orderBook = effectiveDataSources.orderBook
        ? await deps.getOrderBookSnapshot({ tenantId, userId }, symbol, marketType, marginMode)
        : null;
      const news = effectiveDataSources.news
        ? await deps.fetchNewsSummary({ tenantId, userId }, symbol, marketType, profile.newsConfig)
        : null;
      const tradingNamespaceId = await deps.resolveTradingNamespaceId(tenantId);
      if (!tradingNamespaceId) {
        throw new Error('TRADING_SCOPE_REQUIRED: Namespace Trading obrigatório e ativo para análises.');
      }
      const trainingData = await deps.fetchTradingDatasetSummary(tenantId, tradingNamespaceId);
      if (trainingData.totalApproved <= 0) {
        throw new Error('TRADING_SCOPE_REQUIRED: Dataset aprovado de Trading é obrigatório para análises.');
      }
      const riskConfig = await deps.getRiskConfig({ tenantId, userId });
      const tradePlan = deps.buildTradePlanFromAnalysis({
        analysis: primaryResult.analysis,
        interval: primaryResult.interval,
        timeframes,
        marketType: marketType ?? 'futures',
        marginMode,
        riskConfig,
      });

      logger.info({
        tenantId,
        symbol: primaryResult.resolvedSymbol,
        interval: primaryResult.interval,
        overallSignal: consensus.overallSignal,
        confidence: consensus.confidence,
        indicatorId: primaryResult.indicatorId,
      }, 'Análise técnica calculada e persistida');

      res.json({
        success: true,
        data: primaryResult.analysis,
        indicatorId: primaryResult.indicatorId,
        llmPrompt: deps.formatAnalysisForLlm(primaryResult.analysis),
        matrix: analysisResults.map((item) => ({
          interval: item.interval,
          analysis: item.analysis,
          indicatorId: item.indicatorId,
        })),
        consensus,
        techniqueCapabilities,
        techniqueScores,
        ensembleResult,
        arbitrageSnapshot,
        arbitrageSnapshots,
        profile: {
          kind: profileRow.kind,
          timeframes,
          indicators,
          dataSources: effectiveDataSources,
          newsConfig: profile.newsConfig,
          techniques,
          techniqueCapabilities,
          ensembleConfig,
          arbitrageConfig,
        },
        tradePlan,
        sources: {
          orderBook,
          news,
          trainingData,
        },
      });
    } catch (error) {
      if (deps.sendKucoinErrorResponse(res, error)) return;
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      logger.error({ error: errorMessage }, 'Erro ao calcular análise técnica');
      res.status(500).json({ error: errorMessage });
    }
  });
}
