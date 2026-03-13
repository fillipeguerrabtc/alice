import { DEFAULT_PUBLIC_LLM_MODEL_NAME } from '@alice/shared-utils';
import type {
  TradingSignalCandidateGenerationStageResult,
  TradingSignalEnginePipelineDeps,
  TradingSignalFeatureExtractionStageResult,
  TradingSignalGenerationRequest,
  TradingSignalLlmArbitrationStageResult,
  TradingSignalPersistenceStageResult,
  TradingSignalRiskShapingStageResult,
  TradingSignalRuntimeContext,
  TradingSignalTradePlanBase,
} from './trading-signal-engine-types.js';

export type TradingSignalPipelineCandidateSummary = {
  candidateCount: number;
  directionalBias: 'long' | 'short' | 'neutral';
  expectedState: 'signal_generated' | 'no_trade';
  reasonCode: 'NO_EDGE' | 'NO_CANDIDATES' | null;
  reasonHuman: string | null;
};

const SIGNAL_REASON_HUMAN_BY_CODE: Record<Exclude<TradingSignalPipelineCandidateSummary['reasonCode'], null>, string> = {
  NO_EDGE: 'Sem edge direcional líquido após consenso/ensemble.',
  NO_CANDIDATES: 'Sem candidatos elegíveis após filtros determinísticos.',
};

function resolveDirectionalBias(params: {
  consensusSignal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  ensembleSignal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
}): TradingSignalPipelineCandidateSummary['directionalBias'] {
  const hasShort = params.consensusSignal === 'sell'
    || params.consensusSignal === 'strong_sell'
    || params.ensembleSignal === 'sell'
    || params.ensembleSignal === 'strong_sell';
  if (hasShort) {
    return 'short';
  }
  const hasLong = params.consensusSignal === 'buy'
    || params.consensusSignal === 'strong_buy'
    || params.ensembleSignal === 'buy'
    || params.ensembleSignal === 'strong_buy';
  if (hasLong) {
    return 'long';
  }
  return 'neutral';
}

export function buildSignalCandidateSummary(params: {
  consensus: TradingSignalFeatureExtractionStageResult['consensus'];
  ensembleResult: TradingSignalFeatureExtractionStageResult['ensembleResult'];
  techniqueScores: TradingSignalFeatureExtractionStageResult['techniqueScores'];
}): TradingSignalPipelineCandidateSummary {
  const directionalBias = resolveDirectionalBias({
    consensusSignal: params.consensus.overallSignal,
    ensembleSignal: params.ensembleResult.overallSignal,
  });
  const candidateCount = params.techniqueScores.filter((score) => score.signal !== 'neutral').length;

  let reasonCode: TradingSignalPipelineCandidateSummary['reasonCode'] = null;
  if (directionalBias === 'neutral') {
    reasonCode = 'NO_EDGE';
  }
  if (!params.consensus.isMajorityReached && params.consensus.confidence < 0.5) {
    reasonCode = 'NO_CANDIDATES';
  }
  if (candidateCount === 0 && reasonCode === null) {
    reasonCode = 'NO_CANDIDATES';
  }

  return {
    candidateCount,
    directionalBias,
    expectedState: reasonCode ? 'no_trade' : 'signal_generated',
    reasonCode,
    reasonHuman: reasonCode ? SIGNAL_REASON_HUMAN_BY_CODE[reasonCode] : null,
  };
}

export function createTradingSignalEnginePipelineService<
  TProfileRow,
  TAgent extends { id: string; namespaceId?: string | null; modeloBase?: string | null },
  TNamespace extends { id: string } | null,
  TTradePlan extends TradingSignalTradePlanBase,
>(deps: TradingSignalEnginePipelineDeps<TProfileRow, TAgent, TNamespace, TTradePlan>) {
  async function resolveRuntimeContext(
    params: TradingSignalGenerationRequest,
  ): Promise<TradingSignalRuntimeContext<TAgent, TNamespace>> {
    const agentContext = await deps.resolveTradingAgentContext({
      tenantId: params.tenantId,
      agentId: params.agentId,
    });

    const profileRow = await deps.getOrCreateTradingProfile(params.tenantId, 'signal');
    const profile = deps.normalizeTradingProfile(profileRow);
    const timeframes = params.timeframes?.length ? params.timeframes : profile.timeframes;
    const indicators = params.indicators?.length ? params.indicators : profile.indicators;
    const dataSources = params.dataSources ?? profile.dataSources;
    const effectiveDataSources = {
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

    return {
      agentContext,
      timeframes,
      indicators,
      effectiveDataSources,
      consensusConfig,
      techniques,
      ensembleConfig,
      arbitrageConfig,
      profileNewsConfig: profile.newsConfig,
      resolvedNamespaceId: agentContext.agent.namespaceId ?? agentContext.namespace?.id ?? undefined,
    };
  }

  async function runFeatureExtractionStage(params: {
    request: TradingSignalGenerationRequest;
    runtimeContext: TradingSignalRuntimeContext<TAgent, TNamespace>;
  }): Promise<TradingSignalFeatureExtractionStageResult> {
    const stageStartedAt = Date.now();
    const result = await deps.buildTradingSignalAnalysisContext({
      tenantId: params.request.tenantId,
      userId: params.request.userId,
      symbol: params.request.symbol,
      marketType: params.request.marketType,
      marginMode: params.request.marginMode,
      timeframes: params.runtimeContext.timeframes,
      enabledIndicators: params.runtimeContext.indicators,
      techniques: params.runtimeContext.techniques,
      ensembleConfig: params.runtimeContext.ensembleConfig,
      consensusConfig: params.runtimeContext.consensusConfig,
      arbitrageConfig: params.runtimeContext.arbitrageConfig,
    });

    deps.logger.info({
      event: 'trading.signal.pipeline.stage',
      stage: 'feature_extraction',
      durationMs: Date.now() - stageStartedAt,
      symbol: params.request.symbol,
      timeframes: params.runtimeContext.timeframes,
      matrixEntries: result.analysisMatrix.length,
    }, 'Stage do pipeline de sinal finalizado');

    return result;
  }

  async function runCandidateGenerationStage(params: {
    request: TradingSignalGenerationRequest;
    runtimeContext: TradingSignalRuntimeContext<TAgent, TNamespace>;
    featureExtraction: TradingSignalFeatureExtractionStageResult;
  }): Promise<{
    context: TradingSignalCandidateGenerationStageResult<TTradePlan>;
    summary: TradingSignalPipelineCandidateSummary;
  }> {
    const stageStartedAt = Date.now();
    const context = await deps.buildTradingSignalOperationalContext({
      tenantId: params.request.tenantId,
      userId: params.request.userId,
      symbol: params.request.symbol,
      marketType: params.request.marketType,
      marginMode: params.request.marginMode,
      namespaceId: params.runtimeContext.resolvedNamespaceId,
      effectiveDataSources: params.runtimeContext.effectiveDataSources,
      profileNewsConfig: params.runtimeContext.profileNewsConfig,
      consensus: {
        overallSignal: params.featureExtraction.consensus.overallSignal,
        confidence: params.featureExtraction.consensus.confidence,
      },
      primaryAnalysis: {
        analysis: params.featureExtraction.primaryAnalysis.analysis,
        interval: params.featureExtraction.primaryAnalysis.interval,
      },
      timeframes: params.runtimeContext.timeframes,
    });

    const summary = buildSignalCandidateSummary({
      consensus: params.featureExtraction.consensus,
      ensembleResult: params.featureExtraction.ensembleResult,
      techniqueScores: params.featureExtraction.techniqueScores,
    });

    deps.logger.info({
      event: 'trading.signal.pipeline.stage',
      stage: 'candidate_generation',
      durationMs: Date.now() - stageStartedAt,
      symbol: params.request.symbol,
      candidateCount: summary.candidateCount,
      directionalBias: summary.directionalBias,
      expectedState: summary.expectedState,
      reasonCode: summary.reasonCode,
    }, 'Stage do pipeline de sinal finalizado');

    return {
      context,
      summary,
    };
  }

  async function runLlmArbitrationStage(params: {
    request: TradingSignalGenerationRequest;
    runtimeContext: TradingSignalRuntimeContext<TAgent, TNamespace>;
    featureExtraction: TradingSignalFeatureExtractionStageResult;
    candidateGeneration: TradingSignalCandidateGenerationStageResult<TTradePlan>;
  }): Promise<TradingSignalLlmArbitrationStageResult> {
    const stageStartedAt = Date.now();
    const systemPrompt = deps.buildTradingSignalSystemPrompt({
      marketType: params.request.marketType ?? 'futures',
      marginMode: params.request.marginMode,
      agent: params.runtimeContext.agentContext.agent,
      namespace: params.runtimeContext.agentContext.namespace,
      ragContext: params.candidateGeneration.ragContext?.context,
    });

    const requestedMaxTokens = params.request.modelConfig?.maxTokens
      ?? params.runtimeContext.agentContext.llmConfig.maxTokens
      ?? 2048;

    const promptBudget = deps.buildTradingSignalPromptBudget({
      matrix: params.featureExtraction.analysisMatrix,
      consensus: params.featureExtraction.consensus,
      indicators: params.runtimeContext.indicators,
      dataSources: params.runtimeContext.effectiveDataSources,
      orderBook: params.candidateGeneration.orderBookSnapshot,
      news: params.candidateGeneration.newsSummary,
      trainingData: params.candidateGeneration.trainingSummary,
      techniques: params.runtimeContext.techniques,
      techniqueScores: params.featureExtraction.techniqueScores,
      ensembleResult: params.featureExtraction.ensembleResult,
      arbitrageSnapshot: params.featureExtraction.arbitrageSnapshot,
      arbitrageSnapshots: params.featureExtraction.arbitrageSnapshots,
      systemPrompt,
      requestedMaxTokens,
    });

    if (promptBudget.usedNewsCount !== promptBudget.originalNewsCount) {
      deps.logger.warn({
        tenantId: params.request.tenantId,
        symbol: params.request.symbol,
        originalNewsCount: promptBudget.originalNewsCount,
        usedNewsCount: promptBudget.usedNewsCount,
        promptTokens: promptBudget.promptTokens,
      }, 'Notícias reduzidas para respeitar orçamento de tokens');
    }

    if (promptBudget.analysisPrompt !== promptBudget.rawAnalysisPrompt) {
      deps.logger.warn({
        tenantId: params.request.tenantId,
        symbol: params.request.symbol,
        requestedMaxTokens,
        promptTokens: promptBudget.promptTokens,
        maxCompletionTokens: promptBudget.maxCompletionTokens,
      }, 'Prompt de sinal LLM truncado para respeitar o limite de contexto.');
    }

    deps.logger.info({
      tenantId: params.request.tenantId,
      symbol: params.request.symbol,
      promptTokens: promptBudget.promptTokens,
      maxCompletionTokens: promptBudget.maxCompletionTokens,
      analysisPromptChars: promptBudget.analysisPrompt.length,
      newsResults: params.candidateGeneration.newsSummary?.results?.length ?? 0,
    }, 'Orçamento de tokens calculado para sinal LLM');

    const completion = await deps.requestTradingSignalCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: promptBudget.analysisPrompt },
      ],
      tenantId: params.request.tenantId,
      userId: params.request.userId,
      symbol: params.request.symbol,
      marketType: params.request.marketType,
      namespaceId: params.runtimeContext.resolvedNamespaceId,
      agentId: params.runtimeContext.agentContext.agent.id,
      baseModel: params.runtimeContext.agentContext.llmConfig.model,
      temperature: params.request.modelConfig?.temperature ?? params.runtimeContext.agentContext.llmConfig.temperature ?? 0.7,
      maxCompletionTokens: promptBudget.maxCompletionTokens,
      hasArbitrageTechnique: params.runtimeContext.techniques.includes('arbitrage_triangular'),
      reasoningMode: params.request.reasoningMode,
    });

    const llmSignalPartialResult = deps.parseLlmSignalResponse(completion.llmContent);
    deps.logger.info({
      parseMethod: llmSignalPartialResult.parseMethod,
      citedValuesSource: llmSignalPartialResult.citedValuesSource,
      symbol: params.request.symbol,
      marketType: params.request.marketType,
    }, 'Sinal de trading LLM parseado - método de parse utilizado');

    const initialLlmSignal = deps.buildLlmSignalFromPartial({
      partial: llmSignalPartialResult.data,
      analysis: params.featureExtraction.primaryAnalysis.analysis,
      tradePlan: params.candidateGeneration.tradePlan,
    });

    deps.logger.info({
      event: 'trading.signal.pipeline.stage',
      stage: 'llm_arbitration',
      durationMs: Date.now() - stageStartedAt,
      symbol: params.request.symbol,
      parseMethod: llmSignalPartialResult.parseMethod,
      requestedReasoningMode: completion.requestedReasoningMode,
      resolvedReasoningMode: completion.resolvedReasoningMode,
    }, 'Stage do pipeline de sinal finalizado');

    return {
      llmSignalPartialResult,
      initialLlmSignal,
      requestedReasoningMode: completion.requestedReasoningMode,
      resolvedReasoningMode: completion.resolvedReasoningMode,
      reasonResolution: completion.reasonResolution,
      promptBudget,
    };
  }

  function runRiskShapingStage(params: {
    featureExtraction: TradingSignalFeatureExtractionStageResult;
    candidateGeneration: TradingSignalCandidateGenerationStageResult<TTradePlan>;
    llmArbitration: TradingSignalLlmArbitrationStageResult;
  }): TradingSignalRiskShapingStageResult {
    const { llmSignal, deterministicOverride } = deps.applyDeterministicSignalOverride({
      llmSignal: params.llmArbitration.initialLlmSignal,
      consensusOverallSignal: params.featureExtraction.consensus.overallSignal,
      consensusConfidence: params.featureExtraction.consensus.confidence,
      consensusMajorityReached: params.featureExtraction.consensus.isMajorityReached,
      ensembleOverallSignal: params.featureExtraction.ensembleResult.overallSignal,
      tradePlanOperationType: params.candidateGeneration.tradePlan.operationType,
    });

    return {
      llmSignal,
      deterministicOverride,
      durationLabel: deps.formatDurationLabel(llmSignal.expectedDurationMinutes),
    };
  }

  async function runPersistenceStage(params: {
    request: TradingSignalGenerationRequest;
    runtimeContext: TradingSignalRuntimeContext<TAgent, TNamespace>;
    featureExtraction: TradingSignalFeatureExtractionStageResult;
    candidateGeneration: TradingSignalCandidateGenerationStageResult<TTradePlan>;
    llmArbitration: TradingSignalLlmArbitrationStageResult;
    riskShaping: TradingSignalRiskShapingStageResult;
  }): Promise<TradingSignalPersistenceStageResult> {
    const stageStartedAt = Date.now();
    const createdSignal = await deps.persistTradingLlmSignal({
      authContext: { tenantId: params.request.tenantId, userId: params.request.userId },
      llmSignal: params.riskShaping.llmSignal,
      resolvedSymbol: params.featureExtraction.primaryAnalysis.resolvedSymbol,
      marketType: params.request.marketType,
      marginMode: params.request.marginMode,
      sourceModel: params.runtimeContext.agentContext.agent.modeloBase ?? DEFAULT_PUBLIC_LLM_MODEL_NAME,
      modelVersion: params.runtimeContext.agentContext.llmConfig.model,
      techniques: params.runtimeContext.techniques,
      ensembleConfig: params.runtimeContext.ensembleConfig,
      techniqueScores: params.featureExtraction.techniqueScores,
      ensembleResult: params.featureExtraction.ensembleResult,
      arbitrageSnapshot: params.featureExtraction.arbitrageSnapshot,
      arbitrageSnapshots: params.featureExtraction.arbitrageSnapshots,
      agentId: params.runtimeContext.agentContext.agent.id,
      namespaceId: params.runtimeContext.resolvedNamespaceId,
      generationSource: params.request.source,
      schedulerId: params.request.schedulerId,
      timeframes: params.runtimeContext.timeframes,
      enabledIndicators: params.runtimeContext.indicators,
      dataSources: params.runtimeContext.effectiveDataSources,
      news: params.candidateGeneration.newsSummary ?? undefined,
      consensusConfig: params.runtimeContext.consensusConfig,
      consensus: {
        overallSignal: params.featureExtraction.consensus.overallSignal,
        requiredAgree: params.featureExtraction.consensus.requiredAgree,
        agreementRatio: params.featureExtraction.consensus.agreementRatio,
        alignedTimeframes: params.featureExtraction.consensus.alignedTimeframes,
        misalignedTimeframes: params.featureExtraction.consensus.misalignedTimeframes,
        isMajorityReached: params.featureExtraction.consensus.isMajorityReached,
      },
      deterministicOverride: params.riskShaping.deterministicOverride,
      analysisMatrix: params.featureExtraction.analysisMatrix.map((entry) => ({
        interval: entry.interval,
        analysis: entry.analysis,
      })),
      durationLabel: params.riskShaping.durationLabel,
      requestedReasoningMode: params.llmArbitration.requestedReasoningMode,
      resolvedReasoningMode: params.llmArbitration.resolvedReasoningMode,
      reasonResolution: params.llmArbitration.reasonResolution,
    });

    deps.logger.info({
      event: 'trading.signal.pipeline.stage',
      stage: 'persistence',
      durationMs: Date.now() - stageStartedAt,
      symbol: params.request.symbol,
      signalId: createdSignal.id,
    }, 'Stage do pipeline de sinal finalizado');

    return { createdSignal };
  }

  async function runValidationFinalizeStage(params: {
    request: TradingSignalGenerationRequest;
    featureExtraction: TradingSignalFeatureExtractionStageResult;
    llmArbitration: TradingSignalLlmArbitrationStageResult;
    riskShaping: TradingSignalRiskShapingStageResult;
    persistence: TradingSignalPersistenceStageResult;
  }) {
    const stageStartedAt = Date.now();
    const result = await deps.finalizeTradingSignalValidation({
      tenantId: params.request.tenantId,
      createdSignal: params.persistence.createdSignal,
      llmReasoning: params.riskShaping.llmSignal.reasoning,
      citedValues: params.riskShaping.llmSignal.citedValues ?? {},
      analysisMatrix: params.featureExtraction.analysisMatrix.map((entry) => ({
        interval: entry.interval,
        indicatorId: entry.indicatorId,
        analysis: entry.analysis,
      })),
      primaryAnalysis: {
        interval: params.featureExtraction.primaryAnalysis.interval,
        indicatorId: params.featureExtraction.primaryAnalysis.indicatorId,
        analysis: params.featureExtraction.primaryAnalysis.analysis,
      },
      alignedTimeframes: params.featureExtraction.consensus.alignedTimeframes,
      requestedValidationTimeframe: params.riskShaping.llmSignal.timeframeUsed,
      extractionSource: params.llmArbitration.llmSignalPartialResult.citedValuesSource,
      maxAllowedDeviation: deps.maxValidationDeviation,
    });

    deps.logger.info({
      event: 'trading.signal.pipeline.stage',
      stage: 'validation_finalize',
      durationMs: Date.now() - stageStartedAt,
      symbol: params.request.symbol,
      validationStatus: result.validationStatus,
      signalId: result.signal.id,
    }, 'Stage do pipeline de sinal finalizado');

    return result;
  }

  async function executeSignalPipeline(params: TradingSignalGenerationRequest) {
    const pipelineStartedAt = Date.now();
    const runtimeContext = await resolveRuntimeContext(params);
    const featureExtraction = await runFeatureExtractionStage({ request: params, runtimeContext });
    const candidateGeneration = await runCandidateGenerationStage({
      request: params,
      runtimeContext,
      featureExtraction,
    });
    const llmArbitration = await runLlmArbitrationStage({
      request: params,
      runtimeContext,
      featureExtraction,
      candidateGeneration: candidateGeneration.context,
    });
    const riskShaping = runRiskShapingStage({
      featureExtraction,
      candidateGeneration: candidateGeneration.context,
      llmArbitration,
    });
    const persistence = await runPersistenceStage({
      request: params,
      runtimeContext,
      featureExtraction,
      candidateGeneration: candidateGeneration.context,
      llmArbitration,
      riskShaping,
    });
    const result = await runValidationFinalizeStage({
      request: params,
      featureExtraction,
      llmArbitration,
      riskShaping,
      persistence,
    });

    deps.logger.info({
      event: 'trading.signal.pipeline.completed',
      durationMs: Date.now() - pipelineStartedAt,
      symbol: params.symbol,
      marketType: params.marketType,
      signalId: result.signal.id,
      signalType: result.signal.signalType,
      validationStatus: result.validationStatus,
      candidateSummary: candidateGeneration.summary,
    }, 'Pipeline de geração de sinal finalizado');

    return result;
  }

  return {
    resolveRuntimeContext,
    runFeatureExtractionStage,
    runCandidateGenerationStage,
    runLlmArbitrationStage,
    runRiskShapingStage,
    runPersistenceStage,
    runValidationFinalizeStage,
    executeSignalPipeline,
  };
}
