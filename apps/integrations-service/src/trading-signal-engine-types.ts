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
  TradingTechniqueCapability,
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

export type TradingSignalGenerationSource = 'on_demand' | 'scheduler' | 'chat' | 'auto';

export type TradingIntervalValue =
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

export type TradingSignalResponse = {
  signal: schema.TradingSignal;
  validationId: string;
  validationStatus: 'pending' | 'validated' | 'failed';
};

export type TradingSignalProfileNormalized = {
  timeframes: TradingIntervalValue[];
  indicators: TradingIndicatorKey[];
  dataSources: TradingProfileDataSources;
  consensus: TradingProfileConsensus;
  techniques: TradingTechnique[];
  ensembleConfig: TradingEnsembleConfig;
  arbitrageConfig?: TradingArbitrageConfig;
  newsConfig?: TradingProfileNewsConfig;
};

export type TradingSignalTradePlanBase = {
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

export type TradingSignalGenerationRequest = {
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
};

export type TradingAgentContext<TAgent, TNamespace> = {
  agent: TAgent;
  namespace: TNamespace;
  llmConfig: { model: string; temperature?: number; maxTokens?: number };
};

export type TradingSignalRuntimeContext<
  TAgent extends { id: string; namespaceId?: string | null; modeloBase?: string | null },
  TNamespace extends { id: string } | null,
> = {
  agentContext: TradingAgentContext<TAgent, TNamespace>;
  timeframes: TradingIntervalValue[];
  indicators: TradingIndicatorKey[];
  effectiveDataSources: TradingProfileDataSources;
  consensusConfig: TradingProfileConsensus;
  techniques: TradingTechnique[];
  ensembleConfig: TradingEnsembleConfig;
  arbitrageConfig?: TradingArbitrageConfig;
  profileNewsConfig?: TradingProfileNewsConfig;
  resolvedNamespaceId?: string;
};

export type TradingSignalFeatureExtractionStageResult = {
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
  techniqueCapabilities: TradingTechniqueCapability[];
  techniqueScores: TradingTechniqueScore[];
  ensembleResult: TradingEnsembleResult;
  arbitrageSnapshot: TriangularArbitrageResult | null;
  arbitrageSnapshots: TriangularArbitrageResult[];
};

export type TradingSignalCandidateGenerationStageResult<TTradePlan extends TradingSignalTradePlanBase> = {
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
};

export type TradingSignalLlmArbitrationStageResult = {
  llmSignalPartialResult: LlmSignalParseResult;
  initialLlmSignal: TradingLlmSignalNormalized;
  requestedReasoningMode: ReasoningMode;
  resolvedReasoningMode: EffectiveReasoningMode;
  reasonResolution: string;
  promptBudget: {
    rawAnalysisPrompt: string;
    analysisPrompt: string;
    promptTokens: number;
    maxCompletionTokens: number;
    originalNewsCount: number;
    usedNewsCount: number;
  };
};

export type TradingSignalRiskShapingStageResult = {
  llmSignal: TradingLlmSignalNormalized;
  deterministicOverride: TradingSignalDeterministicOverride | null;
  durationLabel: string;
};

export type TradingSignalPersistenceStageResult = {
  createdSignal: schema.TradingSignal;
};

export type TradingSignalEnginePipelineDeps<
  TProfileRow,
  TAgent extends { id: string; namespaceId?: string | null; modeloBase?: string | null },
  TNamespace extends { id: string } | null,
  TTradePlan extends TradingSignalTradePlanBase,
> = {
  logger: {
    warn: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
  };
  TradingConfigErrorCtor: new (message: string) => Error;
  maxValidationDeviation: number;
  resolveTradingAgentContext: (params: {
    tenantId: string;
    agentId?: string;
  }) => Promise<TradingAgentContext<TAgent, TNamespace>>;
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
    dataSources?: TradingProfileDataSources;
    arbitrageConfig?: TradingArbitrageConfig;
  }) => Promise<TradingSignalFeatureExtractionStageResult>;
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
  }) => Promise<TradingSignalCandidateGenerationStageResult<TTradePlan>>;
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
    techniqueCapabilities: TradingTechniqueCapability[];
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
};

export type TradingSignalGenerationServiceDeps<
  TProfileRow,
  TAgent extends { id: string; namespaceId?: string | null; modeloBase?: string | null },
  TNamespace extends { id: string } | null,
  TTradePlan extends TradingSignalTradePlanBase,
> = TradingSignalEnginePipelineDeps<TProfileRow, TAgent, TNamespace, TTradePlan> & {
  isLegacyInstitutionalFlowEnabled: () => boolean;
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
};
