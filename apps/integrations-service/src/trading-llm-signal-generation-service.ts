import type { schema } from '@alice/database';
import type {
  TradingArbitrageConfig,
  TradingEnsembleConfig,
  TradingEnsembleResult,
  TradingIndicatorKey,
  TradingProfileConsensus,
  TradingProfileDataSources,
  TradingProfileModelConfig,
  TradingProfileNewsConfig,
  TradingTechnique,
  TradingTechniqueScore,
} from '@alice/shared';
import type { EffectiveReasoningMode, ReasoningMode } from '@alice/shared-utils';
import type { LlmSignalParseResult } from './trading-llm-signal-parser.js';
import type {
  TradingLlmSignalNormalized,
  TradingSignalDeterministicOverride,
} from './trading-llm-signal-post-processing-service.js';
import type { TriangularArbitrageResult } from './trading-arbitrage-service.js';
import type { TechnicalAnalysisResult } from './technical-indicators.js';
import type { TradingMarginMode, TradingMarketType } from './tradingTypes.js';

type TradingSignalGenerationSource = 'on_demand' | 'scheduler' | 'chat' | 'auto';

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

type TradingSignalResponse = {
  signal: schema.TradingSignal;
  validationId: string;
  validationStatus: 'pending' | 'validated' | 'failed';
};

type TradingSignalProfileNormalized = {
  timeframes: TradingIntervalValue[];
  indicators: TradingIndicatorKey[];
  dataSources: TradingProfileDataSources;
  consensus: TradingProfileConsensus;
  techniques: TradingTechnique[];
  ensembleConfig: TradingEnsembleConfig;
  arbitrageConfig?: TradingArbitrageConfig;
  newsConfig?: TradingProfileNewsConfig;
};

type TradingSignalTradePlanBase = {
  operationType: string;
  expectedDurationMinutes: number;
  motivators: string[];
  invalidationReasons: string[];
  tradeSummary: string;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
};

export function createTradingLlmSignalGenerationService<
  TProfileRow,
  TAgent extends { id: string; namespaceId?: string | null; modeloBase?: string | null },
  TNamespace extends { id: string } | null,
  TTradePlan extends TradingSignalTradePlanBase,
>(deps: {
  logger: {
    warn: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
  };
  TradingConfigErrorCtor: new (message: string) => Error;
  isLegacyInstitutionalFlowEnabled: () => boolean;
  maxValidationDeviation: number;
  getAgenticSettingsOrDefault: (tenantId: string) => Promise<{ tradingEnabled: boolean }>;
  generateLegacyInstitutionalSignal: (params: {
    tenantId: string;
    userId: string;
    symbol: string;
    source: TradingSignalGenerationSource;
    marketType?: TradingMarketType;
    marginMode?: TradingMarginMode;
    legacyFlowEnabled: boolean;
  }) => Promise<TradingSignalResponse | null>;
  resolveTradingAgentContext: (params: {
    tenantId: string;
    agentId?: string;
  }) => Promise<{
    agent: TAgent;
    namespace: TNamespace;
    llmConfig: { model: string; temperature?: number; maxTokens?: number };
  }>;
  getOrCreateTradingProfile: (tenantId: string, kind: 'analysis' | 'signal') => Promise<TProfileRow | null | undefined>;
  normalizeTradingProfile: (profileRow: TProfileRow | null | undefined) => TradingSignalProfileNormalized;
  assertArbitrageConfigForTechniques: (params: {
    techniques: TradingTechnique[];
    arbitrageConfig?: TradingArbitrageConfig;
    timeframes: TradingIntervalValue[];
    context: string;
  }) => void;
  buildTradingSignalAnalysisContext: (params: {
    tenantId: string;
    userId: string;
    symbol: string;
    marketType?: TradingMarketType;
    marginMode?: TradingMarginMode;
    timeframes: TradingIntervalValue[];
    enabledIndicators: TradingIndicatorKey[];
    techniques: TradingTechnique[];
    ensembleConfig: TradingEnsembleConfig;
    consensusConfig: TradingProfileConsensus;
    arbitrageConfig?: TradingArbitrageConfig;
  }) => Promise<{
    analysisMatrix: Array<{
      interval: TradingIntervalValue;
      analysis: TechnicalAnalysisResult;
      indicatorId: string;
      resolvedSymbol: string;
    }>;
    primaryAnalysis: {
      interval: TradingIntervalValue;
      analysis: TechnicalAnalysisResult;
      indicatorId: string;
      resolvedSymbol: string;
    };
    consensus: {
      overallSignal: TechnicalAnalysisResult['overallSignal'];
      confidence: number;
      alignedTimeframes: TradingIntervalValue[];
      misalignedTimeframes: TradingIntervalValue[];
      agreementRatio: number;
      requiredAgree: number;
      isMajorityReached: boolean;
    };
    techniqueScores: TradingTechniqueScore[];
    ensembleResult: TradingEnsembleResult;
    arbitrageSnapshot: TriangularArbitrageResult | null;
    arbitrageSnapshots: TriangularArbitrageResult[];
  }>;
  buildTradingSignalOperationalContext: (params: {
    tenantId: string;
    userId: string;
    symbol: string;
    marketType?: TradingMarketType;
    marginMode?: TradingMarginMode;
    namespaceId?: string | null;
    effectiveDataSources: TradingProfileDataSources;
    profileNewsConfig?: TradingProfileNewsConfig;
    consensus: { overallSignal: TechnicalAnalysisResult['overallSignal']; confidence: number };
    primaryAnalysis: {
      analysis: TechnicalAnalysisResult;
      interval: TradingIntervalValue;
    };
    timeframes: TradingIntervalValue[];
  }) => Promise<{
    ragContext: { context: string } | null;
    orderBookSnapshot: {
      bestBid: number | null;
      bestAsk: number | null;
      spreadAbs: number | null;
      spreadPct: number | null;
    } | null;
    newsSummary: { query: string; results: Array<{ title: string; url: string; score?: number }> } | null;
    trainingSummary: {
      totalApproved: number;
      samples: Array<{ prompt: string; response: string; actionType: string; createdAt: string }>;
    };
    tradePlan: TTradePlan;
  }>;
  buildTradingSignalSystemPrompt: (params: {
    marketType: TradingMarketType;
    marginMode?: TradingMarginMode;
    agent: TAgent;
    namespace: TNamespace;
    ragContext?: string;
  }) => string;
  buildTradingSignalPromptBudget: (params: {
    matrix: Array<{ interval: string; analysis: unknown }>;
    consensus: {
      overallSignal: TechnicalAnalysisResult['overallSignal'];
      agreementRatio: number;
      alignedTimeframes: string[];
      misalignedTimeframes: string[];
    };
    indicators: TradingIndicatorKey[];
    dataSources: TradingProfileDataSources;
    orderBook: { bestBid: number | null; bestAsk: number | null; spreadAbs: number | null; spreadPct: number | null } | null;
    news: { query: string; results: Array<{ title: string; url: string }> } | null;
    trainingData: { totalApproved: number; samples: Array<{ prompt: string; response: string; actionType: string }> } | null;
    techniques: TradingTechnique[];
    techniqueScores: TradingTechniqueScore[];
    ensembleResult: TradingEnsembleResult;
    arbitrageSnapshot: TriangularArbitrageResult | null;
    arbitrageSnapshots?: TriangularArbitrageResult[];
    systemPrompt: string;
    requestedMaxTokens: number;
  }) => {
    rawAnalysisPrompt: string;
    analysisPrompt: string;
    promptTokens: number;
    maxCompletionTokens: number;
    originalNewsCount: number;
    usedNewsCount: number;
  };
  requestTradingSignalCompletion: (params: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    tenantId: string;
    userId: string;
    symbol: string;
    marketType?: TradingMarketType;
    namespaceId?: string;
    agentId?: string;
    baseModel: string;
    temperature: number;
    maxCompletionTokens: number;
    hasArbitrageTechnique: boolean;
    reasoningMode?: ReasoningMode;
  }) => Promise<{
    llmContent: string;
    requestedReasoningMode: ReasoningMode;
    resolvedReasoningMode: EffectiveReasoningMode;
    reasonResolution: string;
  }>;
  parseLlmSignalResponse: (content: string) => LlmSignalParseResult;
  buildLlmSignalFromPartial: (params: {
    partial: LlmSignalParseResult['data'];
    analysis: TechnicalAnalysisResult;
    tradePlan: TTradePlan;
  }) => TradingLlmSignalNormalized;
  applyDeterministicSignalOverride: (params: {
    llmSignal: TradingLlmSignalNormalized;
    consensusOverallSignal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
    consensusConfidence: number;
    consensusMajorityReached: boolean;
    ensembleOverallSignal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
    tradePlanOperationType: string;
  }) => {
    llmSignal: TradingLlmSignalNormalized;
    deterministicOverride: TradingSignalDeterministicOverride | null;
  };
  formatDurationLabel: (minutes: number) => string;
  persistTradingLlmSignal: (params: {
    authContext: { tenantId: string; userId: string };
    llmSignal: TradingLlmSignalNormalized;
    resolvedSymbol: string;
    marketType?: TradingMarketType;
    marginMode?: TradingMarginMode;
    sourceModel: string;
    modelVersion: string;
    techniques: TradingTechnique[];
    ensembleConfig: TradingEnsembleConfig;
    techniqueScores: TradingTechniqueScore[];
    ensembleResult: TradingEnsembleResult;
    arbitrageSnapshot: TriangularArbitrageResult | null;
    arbitrageSnapshots: TriangularArbitrageResult[];
    agentId?: string;
    namespaceId?: string;
    generationSource: TradingSignalGenerationSource;
    schedulerId?: string;
    timeframes: string[];
    enabledIndicators: TradingIndicatorKey[];
    dataSources: TradingProfileDataSources;
    news?: Record<string, unknown>;
    consensusConfig: TradingProfileConsensus;
    consensus: {
      overallSignal: string;
      requiredAgree: number;
      agreementRatio: number;
      alignedTimeframes: string[];
      misalignedTimeframes: string[];
      isMajorityReached: boolean;
    };
    deterministicOverride: TradingSignalDeterministicOverride | null;
    analysisMatrix: Array<{ interval: string; analysis: TechnicalAnalysisResult }>;
    durationLabel: string;
    requestedReasoningMode: ReasoningMode;
    resolvedReasoningMode: EffectiveReasoningMode;
    reasonResolution: string;
  }) => Promise<schema.TradingSignal>;
  finalizeTradingSignalValidation: (params: {
    tenantId: string;
    createdSignal: schema.TradingSignal;
    llmReasoning: string;
    citedValues: Record<string, unknown>;
    analysisMatrix: Array<{ interval: string; indicatorId: string; analysis: TechnicalAnalysisResult }>;
    primaryAnalysis: { interval: string; indicatorId: string; analysis: TechnicalAnalysisResult };
    alignedTimeframes: string[];
    requestedValidationTimeframe?: string;
    extractionSource: 'llm_payload' | 'regex';
    maxAllowedDeviation: number;
  }) => Promise<TradingSignalResponse>;
}) {
  async function generateTradingSignalFromLlm(params: {
    tenantId: string;
    userId: string;
    symbol: string;
    interval: string;
    marketType?: TradingMarketType;
    marginMode?: TradingMarginMode;
    source: TradingSignalGenerationSource;
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
    reasoningMode?: ReasoningMode;
  }): Promise<TradingSignalResponse> {
    const agenticSettings = await deps.getAgenticSettingsOrDefault(params.tenantId);
    if (!agenticSettings.tradingEnabled) {
      deps.logger.warn({ tenantId: params.tenantId }, 'Agentic Trading desabilitado - gerando sinal sem execução automática');
    }

    const legacySignalResult = await deps.generateLegacyInstitutionalSignal({
      tenantId: params.tenantId,
      userId: params.userId,
      symbol: params.symbol,
      source: params.source,
      marketType: params.marketType,
      marginMode: params.marginMode,
      legacyFlowEnabled: deps.isLegacyInstitutionalFlowEnabled(),
    });
    if (legacySignalResult) {
      return legacySignalResult;
    }

    const agentContext = await deps.resolveTradingAgentContext({
      tenantId: params.tenantId,
      agentId: params.agentId,
    });

    const profileRow = await deps.getOrCreateTradingProfile(params.tenantId, 'signal');
    const profile = deps.normalizeTradingProfile(profileRow);
    const timeframes = params.timeframes?.length ? params.timeframes : profile.timeframes;
    const indicators = params.indicators?.length ? params.indicators : profile.indicators;
    const dataSources = params.dataSources ?? profile.dataSources;
    const effectiveDataSources: TradingProfileDataSources = {
      ...dataSources,
      trainingData: true,
    };
    const consensusConfig = params.consensus ?? profile.consensus;
    const techniques = params.techniques?.length ? params.techniques : profile.techniques;
    const ensembleConfig = params.ensembleConfig ?? profile.ensembleConfig;
    const arbitrageConfig = params.arbitrageConfig ?? profile.arbitrageConfig;

    deps.assertArbitrageConfigForTechniques({
      techniques,
      arbitrageConfig,
      timeframes,
      context: 'geração de sinais IA',
    });
    if (techniques.includes('arbitrage_triangular') && (params.marketType ?? 'futures') === 'futures') {
      throw new deps.TradingConfigErrorCtor('Arbitragem triangular não é suportada em mercado futures.');
    }

    const {
      analysisMatrix,
      primaryAnalysis,
      consensus,
      techniqueScores,
      ensembleResult,
      arbitrageSnapshot,
      arbitrageSnapshots,
    } = await deps.buildTradingSignalAnalysisContext({
      tenantId: params.tenantId,
      userId: params.userId,
      symbol: params.symbol,
      marketType: params.marketType,
      marginMode: params.marginMode,
      timeframes,
      enabledIndicators: indicators,
      techniques,
      ensembleConfig,
      consensusConfig,
      arbitrageConfig,
    });

    const {
      ragContext,
      orderBookSnapshot,
      newsSummary,
      trainingSummary,
      tradePlan,
    } = await deps.buildTradingSignalOperationalContext({
      tenantId: params.tenantId,
      userId: params.userId,
      symbol: params.symbol,
      marketType: params.marketType,
      marginMode: params.marginMode,
      namespaceId: agentContext.agent.namespaceId ?? agentContext.namespace?.id,
      effectiveDataSources,
      profileNewsConfig: profile.newsConfig,
      consensus: {
        overallSignal: consensus.overallSignal,
        confidence: consensus.confidence,
      },
      primaryAnalysis: {
        analysis: primaryAnalysis.analysis,
        interval: primaryAnalysis.interval,
      },
      timeframes,
    });
    const systemPrompt = deps.buildTradingSignalSystemPrompt({
      marketType: params.marketType ?? 'futures',
      marginMode: params.marginMode,
      agent: agentContext.agent,
      namespace: agentContext.namespace,
      ragContext: ragContext?.context,
    });
    const requestedMaxTokens = params.modelConfig?.maxTokens ?? agentContext.llmConfig.maxTokens ?? 2048;
    const promptBudget = deps.buildTradingSignalPromptBudget({
      matrix: analysisMatrix,
      consensus,
      indicators,
      dataSources: effectiveDataSources,
      orderBook: orderBookSnapshot,
      news: newsSummary,
      trainingData: trainingSummary,
      techniques,
      techniqueScores,
      ensembleResult,
      arbitrageSnapshot,
      arbitrageSnapshots,
      systemPrompt,
      requestedMaxTokens,
    });

    if (promptBudget.usedNewsCount !== promptBudget.originalNewsCount) {
      deps.logger.warn({
        tenantId: params.tenantId,
        symbol: params.symbol,
        originalNewsCount: promptBudget.originalNewsCount,
        usedNewsCount: promptBudget.usedNewsCount,
        promptTokens: promptBudget.promptTokens,
      }, 'Notícias reduzidas para respeitar orçamento de tokens');
    }

    if (promptBudget.analysisPrompt !== promptBudget.rawAnalysisPrompt) {
      deps.logger.warn({
        tenantId: params.tenantId,
        symbol: params.symbol,
        requestedMaxTokens,
        promptTokens: promptBudget.promptTokens,
        maxCompletionTokens: promptBudget.maxCompletionTokens,
      }, 'Prompt de sinal LLM truncado para respeitar o limite de contexto.');
    }
    deps.logger.info({
      tenantId: params.tenantId,
      symbol: params.symbol,
      promptTokens: promptBudget.promptTokens,
      maxCompletionTokens: promptBudget.maxCompletionTokens,
      analysisPromptChars: promptBudget.analysisPrompt.length,
      newsResults: newsSummary?.results?.length ?? 0,
    }, 'Orçamento de tokens calculado para sinal LLM');

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: promptBudget.analysisPrompt },
    ];
    const {
      llmContent,
      requestedReasoningMode,
      resolvedReasoningMode,
      reasonResolution,
    } = await deps.requestTradingSignalCompletion({
      messages,
      tenantId: params.tenantId,
      userId: params.userId,
      symbol: params.symbol,
      marketType: params.marketType,
      namespaceId: agentContext.agent.namespaceId ?? agentContext.namespace?.id ?? undefined,
      agentId: agentContext.agent.id ?? undefined,
      baseModel: agentContext.llmConfig.model,
      temperature: params.modelConfig?.temperature ?? agentContext.llmConfig.temperature ?? 0.7,
      maxCompletionTokens: promptBudget.maxCompletionTokens,
      hasArbitrageTechnique: techniques.includes('arbitrage_triangular'),
      reasoningMode: params.reasoningMode,
    });

    const llmSignalPartialResult = deps.parseLlmSignalResponse(llmContent);
    deps.logger.info({
      parseMethod: llmSignalPartialResult.parseMethod,
      citedValuesSource: llmSignalPartialResult.citedValuesSource,
      symbol: params.symbol,
      marketType: params.marketType,
    }, 'Sinal de trading LLM parseado - método de parse utilizado');
    const initialLlmSignal = deps.buildLlmSignalFromPartial({
      partial: llmSignalPartialResult.data,
      analysis: primaryAnalysis.analysis,
      tradePlan,
    });
    const {
      llmSignal,
      deterministicOverride,
    } = deps.applyDeterministicSignalOverride({
      llmSignal: initialLlmSignal,
      consensusOverallSignal: consensus.overallSignal,
      consensusConfidence: consensus.confidence,
      consensusMajorityReached: consensus.isMajorityReached,
      ensembleOverallSignal: ensembleResult.overallSignal,
      tradePlanOperationType: tradePlan.operationType,
    });
    const durationLabel = deps.formatDurationLabel(llmSignal.expectedDurationMinutes);
    const createdSignal = await deps.persistTradingLlmSignal({
      authContext: { tenantId: params.tenantId, userId: params.userId },
      llmSignal,
      resolvedSymbol: primaryAnalysis.resolvedSymbol,
      marketType: params.marketType,
      marginMode: params.marginMode,
      sourceModel: agentContext.agent.modeloBase ?? 'Qwen2.5-7B-Instruct-AWQ',
      modelVersion: agentContext.llmConfig.model,
      techniques,
      ensembleConfig,
      techniqueScores,
      ensembleResult,
      arbitrageSnapshot,
      arbitrageSnapshots,
      agentId: agentContext.agent.id,
      namespaceId: agentContext.agent.namespaceId ?? agentContext.namespace?.id ?? undefined,
      generationSource: params.source,
      schedulerId: params.schedulerId,
      timeframes,
      enabledIndicators: indicators,
      dataSources: effectiveDataSources,
      news: newsSummary ?? undefined,
      consensusConfig,
      consensus: {
        overallSignal: consensus.overallSignal,
        requiredAgree: consensus.requiredAgree,
        agreementRatio: consensus.agreementRatio,
        alignedTimeframes: consensus.alignedTimeframes,
        misalignedTimeframes: consensus.misalignedTimeframes,
        isMajorityReached: consensus.isMajorityReached,
      },
      deterministicOverride,
      analysisMatrix: analysisMatrix.map((entry) => ({
        interval: entry.interval,
        analysis: entry.analysis,
      })),
      durationLabel,
      requestedReasoningMode,
      resolvedReasoningMode,
      reasonResolution,
    });

    return deps.finalizeTradingSignalValidation({
      tenantId: params.tenantId,
      createdSignal,
      llmReasoning: llmSignal.reasoning,
      citedValues: llmSignal.citedValues ?? {},
      analysisMatrix: analysisMatrix.map((entry) => ({
        interval: entry.interval,
        indicatorId: entry.indicatorId,
        analysis: entry.analysis,
      })),
      primaryAnalysis: {
        interval: primaryAnalysis.interval,
        indicatorId: primaryAnalysis.indicatorId,
        analysis: primaryAnalysis.analysis,
      },
      alignedTimeframes: consensus.alignedTimeframes,
      requestedValidationTimeframe: llmSignal.timeframeUsed,
      extractionSource: llmSignalPartialResult.citedValuesSource,
      maxAllowedDeviation: deps.maxValidationDeviation,
    });
  }

  return {
    generateTradingSignalFromLlm,
  };
}
