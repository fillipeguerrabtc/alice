type TradingSignalTypeLike =
  | 'entry_long'
  | 'entry_short'
  | 'exit'
  | 'adjust_sl'
  | 'adjust_tp'
  | 'hold'
  | 'neutral';
type TradingOverallSignalLike = 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';

export type TradingLlmSignalNormalized = {
  signalType: TradingSignalTypeLike;
  operationType: string;
  confidence: number;
  expectedDurationMinutes: number;
  suggestedSize?: number | null;
  suggestedPrice?: number | null;
  suggestedStopLoss?: number | null;
  suggestedTakeProfit?: number | null;
  marketCondition?: string;
  riskScore?: number | null;
  riskReward?: number | null;
  motivators?: string[];
  invalidationReasons?: string[];
  timeframeUsed?: string;
  citedValues?: Record<string, unknown>;
  tradeSummary: string;
  reasoning: string;
};

export type TradingSignalDeterministicOverride = {
  previousSignalType: TradingSignalTypeLike;
  overriddenSignalType: TradingSignalTypeLike;
  reason: string;
};

export function createTradingLlmSignalPostProcessingService() {
  function applyDeterministicSignalOverride(params: {
    llmSignal: TradingLlmSignalNormalized;
    consensusOverallSignal: TradingOverallSignalLike;
    consensusConfidence: number;
    consensusMajorityReached: boolean;
    ensembleOverallSignal: TradingOverallSignalLike;
    tradePlanOperationType: string;
  }): {
    llmSignal: TradingLlmSignalNormalized;
    deterministicOverride: TradingSignalDeterministicOverride | null;
  } {
    const consensusDirectionalSignal: TradingSignalTypeLike | null = (
      params.consensusOverallSignal === 'strong_buy' || params.consensusOverallSignal === 'buy'
    )
      ? 'entry_long'
      : (params.consensusOverallSignal === 'strong_sell' || params.consensusOverallSignal === 'sell')
        ? 'entry_short'
        : null;
    const llmNeutralOrHold = params.llmSignal.signalType === 'neutral' || params.llmSignal.signalType === 'hold';
    const shouldPromoteDirectional = Boolean(
      llmNeutralOrHold
      && consensusDirectionalSignal
      && params.consensusMajorityReached
      && params.consensusConfidence >= 0.58
      && params.ensembleOverallSignal !== 'neutral'
    );

    if (!shouldPromoteDirectional || !consensusDirectionalSignal) {
      return { llmSignal: params.llmSignal, deterministicOverride: null };
    }

    const deterministicOverride: TradingSignalDeterministicOverride = {
      previousSignalType: params.llmSignal.signalType,
      overriddenSignalType: consensusDirectionalSignal,
      reason: `Consensus multi-timeframe ${params.consensusOverallSignal} com ${(params.consensusConfidence * 100).toFixed(0)}% de confiança`,
    };

    return {
      llmSignal: {
        ...params.llmSignal,
        signalType: consensusDirectionalSignal,
        operationType: params.llmSignal.operationType === 'neutral'
          ? params.tradePlanOperationType
          : params.llmSignal.operationType,
        suggestedSize: params.llmSignal.suggestedSize ?? 1,
        tradeSummary: `${params.llmSignal.tradeSummary} Ajuste institucional aplicado para evitar over-neutralização.`,
        reasoning: `${params.llmSignal.reasoning} Ajuste institucional: ${deterministicOverride.reason}.`,
      },
      deterministicOverride,
    };
  }

  return {
    applyDeterministicSignalOverride,
  };
}
