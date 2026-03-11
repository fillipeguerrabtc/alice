import type { schema } from '@alice/database';
import type {
  TradingEnsembleConfig,
  TradingEnsembleResult,
  TradingIndicatorKey,
  TradingProfileConsensus,
  TradingProfileDataSources,
  TradingTechnique,
  TradingTechniqueScore,
} from '@alice/shared';
import type { TradingLlmSignalNormalized, TradingSignalDeterministicOverride } from './trading-llm-signal-post-processing-service.js';
import type { TriangularArbitrageResult } from './trading-arbitrage-service.js';
import type { TechnicalAnalysisResult } from './technical-indicators.js';
import type { EffectiveReasoningMode, ReasoningMode } from '@alice/shared-utils';

export function createTradingLlmSignalPersistenceService(deps: {
  createSignal: (
    authContext: { tenantId: string; userId: string },
    payload: {
      signalType: schema.TradingSignal['signalType'];
      symbol: string;
      marketType?: 'futures' | 'spot' | 'margin';
      marginMode?: 'cross' | 'isolated';
      confidence: number;
      reasoning: string;
      sourceModel: string;
      suggestedPrice?: number;
      suggestedStopLoss?: number;
      suggestedTakeProfit?: number;
      suggestedSize?: number;
      metadata: Record<string, unknown>;
    },
  ) => Promise<{ success: boolean; data?: schema.TradingSignal; error?: string }>;
}) {
  async function persistTradingLlmSignal(params: {
    authContext: { tenantId: string; userId: string };
    llmSignal: TradingLlmSignalNormalized;
    resolvedSymbol: string;
    marketType?: 'futures' | 'spot' | 'margin';
    marginMode?: 'cross' | 'isolated';
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
    generationSource: 'on_demand' | 'scheduler' | 'chat' | 'auto';
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
  }): Promise<schema.TradingSignal> {
    const createResult = await deps.createSignal(
      params.authContext,
      {
        signalType: params.llmSignal.signalType as schema.TradingSignal['signalType'],
        symbol: params.resolvedSymbol,
        marketType: params.marketType,
        marginMode: params.marginMode,
        confidence: params.llmSignal.confidence,
        reasoning: params.llmSignal.reasoning,
        sourceModel: params.sourceModel,
        suggestedPrice: params.llmSignal.suggestedPrice ?? undefined,
        suggestedStopLoss: params.llmSignal.suggestedStopLoss ?? undefined,
        suggestedTakeProfit: params.llmSignal.suggestedTakeProfit ?? undefined,
        suggestedSize: params.llmSignal.suggestedSize ?? undefined,
        metadata: {
          confidence: params.llmSignal.confidence,
          reasoning: params.llmSignal.reasoning,
          marketCondition: params.llmSignal.marketCondition,
          riskScore: params.llmSignal.riskScore,
          modelVersion: params.modelVersion,
          operationType: params.llmSignal.operationType,
          expectedDurationMinutes: params.llmSignal.expectedDurationMinutes,
          expectedDurationLabel: params.durationLabel,
          entryPrice: params.llmSignal.suggestedPrice,
          takeProfit: params.llmSignal.suggestedTakeProfit,
          stopLoss: params.llmSignal.suggestedStopLoss,
          riskReward: params.llmSignal.riskReward,
          techniques: params.techniques,
          ensemble: params.ensembleConfig,
          techniqueScores: params.techniqueScores,
          ensembleResult: params.ensembleResult,
          arbitrageSnapshot: params.arbitrageSnapshot,
          arbitrageSnapshots: params.arbitrageSnapshots,
          motivators: params.llmSignal.motivators,
          invalidationReasons: params.llmSignal.invalidationReasons,
          tradeSummary: params.llmSignal.tradeSummary,
          agentId: params.agentId,
          namespaceId: params.namespaceId,
          generationSource: params.generationSource,
          schedulerId: params.schedulerId,
          validationStatus: 'pending',
          createdByUserId: params.authContext.userId,
          timeframes: params.timeframes,
          enabledIndicators: params.enabledIndicators,
          dataSources: params.dataSources,
          news: params.news ?? undefined,
          consensus: {
            rule: params.consensusConfig.rule ?? 'majority',
            overallSignal: params.consensus.overallSignal,
            requiredAgree: params.consensus.requiredAgree,
            agreementRatio: params.consensus.agreementRatio,
            alignedTimeframes: params.consensus.alignedTimeframes,
            misalignedTimeframes: params.consensus.misalignedTimeframes,
            isMajorityReached: params.consensus.isMajorityReached,
          },
          requestedReasoningMode: params.requestedReasoningMode,
          resolvedReasoningMode: params.resolvedReasoningMode,
          reasonResolution: params.reasonResolution,
          deterministicOverride: params.deterministicOverride,
          analysisMatrix: params.analysisMatrix,
        },
      },
    );

    if (!createResult.success || !createResult.data) {
      throw new Error(createResult.error || 'Falha ao persistir sinal LLM.');
    }

    return createResult.data as schema.TradingSignal;
  }

  return {
    persistTradingLlmSignal,
  };
}
