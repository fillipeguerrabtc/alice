import { eq, getDatabase, schema } from '@alice/database';
import type { TradingSignalMetadata } from '@alice/shared';
import { validateAndPersist } from './llm-validation.js';
import type { TechnicalAnalysisResult } from './technical-indicators.js';

type ValidationSnapshotEntry = {
  interval: string;
  indicatorId: string;
  analysis: TechnicalAnalysisResult;
};

export function createTradingLlmValidationFinalizeService() {
  async function finalizeTradingSignalValidation(params: {
    tenantId: string;
    createdSignal: schema.TradingSignal;
    llmReasoning: string;
    citedValues: Record<string, unknown>;
    analysisMatrix: ValidationSnapshotEntry[];
    primaryAnalysis: ValidationSnapshotEntry;
    alignedTimeframes: string[];
    requestedValidationTimeframe?: string;
    extractionSource: 'llm_payload' | 'regex' | undefined;
    maxAllowedDeviation: number;
  }): Promise<{
    signal: schema.TradingSignal;
    validationId: string;
    validationStatus: 'pending' | 'validated' | 'failed';
  }> {
    const validationSnapshot = params.requestedValidationTimeframe
      ? (params.analysisMatrix.find((entry) => entry.interval === params.requestedValidationTimeframe) ?? params.primaryAnalysis)
      : (params.analysisMatrix.find((entry) => params.alignedTimeframes.includes(entry.interval)) ?? params.primaryAnalysis);

    const validation = await validateAndPersist({
      tenantId: params.tenantId,
      llmResponse: params.llmReasoning,
      citedValues: params.citedValues,
      indicatorSnapshot: validationSnapshot.analysis,
      indicatorSnapshotId: validationSnapshot.indicatorId,
      signalId: params.createdSignal.id,
      extractionSource: params.extractionSource,
      timeframeUsed: params.requestedValidationTimeframe ?? validationSnapshot.interval,
      maxAllowedDeviation: params.maxAllowedDeviation,
    });

    const validationStatus: TradingSignalMetadata['validationStatus'] = validation.actionTaken === 'approved'
      ? 'validated'
      : validation.actionTaken === 'rejected'
        ? 'failed'
        : 'pending';

    const db = getDatabase();
    const updatedMetadata: TradingSignalMetadata = {
      ...(params.createdSignal.metadata as Record<string, unknown>),
      validationStatus,
      validationId: validation.validationId,
      validationSummary: {
        reasonCode: validation.result.failureReason,
        failedFields: Object.keys(validation.result.discrepancies ?? {}),
        noValuesExtracted: validation.result.noValuesExtracted,
        accuracy: validation.result.overallAccuracy,
        extractionSource: validation.result.extractionSource,
        timeframeUsed: params.requestedValidationTimeframe ?? validationSnapshot.interval,
        allowedDeviationByField: validation.result.allowedDeviationByField,
        maxAllowedDeviationPercent: params.maxAllowedDeviation,
        maxDeviationFound: validation.result.maxDeviationFound,
      },
    };

    const [updatedSignal] = await db
      .update(schema.tradingSignals)
      .set({ metadata: updatedMetadata })
      .where(eq(schema.tradingSignals.id, params.createdSignal.id))
      .returning();

    return {
      signal: (updatedSignal ?? params.createdSignal) as schema.TradingSignal,
      validationId: validation.validationId,
      validationStatus,
    };
  }

  return {
    finalizeTradingSignalValidation,
  };
}
