import { TRADING_LLM_SIGNAL_SCHEMA } from '@alice/shared-utils';
import type { TradingLlmSignal, TradingLlmSignalPartial } from '@alice/shared-utils';
import type { ExtractedLLMValues } from './llm-validation.js';
import type * as technicalIndicators from './technical-indicators.js';
import {
  buildAnalysisMotivators,
  buildTradePlanFromAnalysis,
  resolveSignalTypeFromAnalysis,
} from './trading-signal-plan-service.js';

type TradingLlmSignalNormalizerLogger = {
  warn: (...args: unknown[]) => void;
};

export function createTradingLlmSignalNormalizerService(deps: {
  logger: TradingLlmSignalNormalizerLogger;
  extractValuesFromLLMResponse: (reasoning: string) => ExtractedLLMValues;
}) {
  function normalizeNullableNumber(value?: number | string | null): number | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const parsed = Number(trimmed.replace(',', '.'));
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  function normalizeCitedValues(values?: Record<string, unknown>): ExtractedLLMValues | null {
    if (!values || typeof values !== 'object') return null;
    const normalized: ExtractedLLMValues = {};
    for (const [key, rawValue] of Object.entries(values)) {
      const numeric = normalizeNullableNumber(rawValue as number | string | null);
      if (numeric !== undefined) {
        (normalized as Record<string, number>)[key] = numeric;
      }
    }
    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  function buildLlmSignalFromPartial(params: {
    partial: TradingLlmSignalPartial;
    analysis: technicalIndicators.TechnicalAnalysisResult;
    tradePlan: ReturnType<typeof buildTradePlanFromAnalysis>;
  }): TradingLlmSignal {
    const baseConfidence = typeof params.partial.confidence === 'number'
      ? params.partial.confidence
      : params.analysis.confidence;
    const confidence = Math.min(Math.max(baseConfidence, 0), 1);
    const motivators = Array.isArray(params.partial.motivators) && params.partial.motivators.length > 0
      ? params.partial.motivators
      : params.tradePlan.motivators;
    const invalidationReasons = Array.isArray(params.partial.invalidationReasons) && params.partial.invalidationReasons.length > 0
      ? params.partial.invalidationReasons
      : params.tradePlan.invalidationReasons;
    const reasoning = typeof params.partial.reasoning === 'string' && params.partial.reasoning.trim().length >= 10
      ? params.partial.reasoning
      : buildAnalysisMotivators(params.analysis).join('; ');
    let suggestedPrice = normalizeNullableNumber(params.partial.suggestedPrice) ?? params.tradePlan.entryPrice;

    const currentPrice = params.analysis.currentPrice;
    if (suggestedPrice && currentPrice && currentPrice > 0) {
      const priceDeviation = Math.abs(suggestedPrice - currentPrice) / currentPrice;
      if (priceDeviation > 0.05) {
        deps.logger.warn(
          { suggestedPrice, currentPrice, deviation: priceDeviation },
          'Preço sugerido pelo LLM desvia >5% do mercado - usando preço atual'
        );
        suggestedPrice = currentPrice;
      }
    }

    const suggestedStopLoss = normalizeNullableNumber(params.partial.suggestedStopLoss) ?? params.tradePlan.stopLoss ?? undefined;
    const suggestedTakeProfit = normalizeNullableNumber(params.partial.suggestedTakeProfit) ?? params.tradePlan.takeProfit ?? undefined;
    const riskReward = normalizeNullableNumber(params.partial.riskReward) ?? params.tradePlan.riskReward ?? undefined;
    const resolvedSignalType = params.partial.signalType ?? resolveSignalTypeFromAnalysis(params.analysis);
    const suggestedSize = normalizeNullableNumber(params.partial.suggestedSize)
      ?? (resolvedSignalType === 'entry_long' || resolvedSignalType === 'entry_short' || resolvedSignalType === 'adjust_sl' || resolvedSignalType === 'adjust_tp'
        ? 1
        : undefined);
    const riskScore = normalizeNullableNumber(params.partial.riskScore)
      ?? Math.round(confidence * 100);
    const citedValues = normalizeCitedValues(params.partial.citedValues as Record<string, unknown> | undefined);
    const resolvedCitedValues = citedValues ?? deps.extractValuesFromLLMResponse(reasoning);
    const marketCondition = params.partial.marketCondition
      ?? (params.analysis.movingAverages?.trend ? `Tendência ${params.analysis.movingAverages.trend}` : undefined);

    const isNeutralOrHold = resolvedSignalType === 'neutral' || resolvedSignalType === 'hold';
    const rawDuration = params.partial.expectedDurationMinutes;
    const resolvedDuration = rawDuration != null
      ? rawDuration
      : (isNeutralOrHold ? 0 : params.tradePlan.expectedDurationMinutes);

    const rawSummary = params.partial.tradeSummary;
    const resolvedSummary = (rawSummary && rawSummary.trim().length > 0)
      ? rawSummary
      : (params.tradePlan.tradeSummary || `Sinal ${resolvedSignalType} — sem operação recomendada no momento`);

    const draft: TradingLlmSignal = {
      signalType: resolvedSignalType,
      operationType: params.partial.operationType ?? params.tradePlan.operationType,
      expectedDurationMinutes: resolvedDuration,
      confidence,
      tradeSummary: resolvedSummary,
      motivators,
      invalidationReasons,
      reasoning,
      timeframeUsed: params.partial.timeframeUsed,
      citedValues: resolvedCitedValues,
      suggestedPrice,
      suggestedStopLoss,
      suggestedTakeProfit,
      suggestedSize,
      riskReward,
      marketCondition,
      riskScore,
    };

    const validated = TRADING_LLM_SIGNAL_SCHEMA.safeParse(draft);
    if (!validated.success) {
      throw new Error(`Resposta LLM inválida após normalização: ${validated.error.message}`);
    }
    return validated.data;
  }

  return {
    normalizeNullableNumber,
    normalizeCitedValues,
    buildLlmSignalFromPartial,
  };
}
