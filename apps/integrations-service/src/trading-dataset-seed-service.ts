import { schema } from '@alice/database';
import type {
  TradingEnsembleResult,
  TradingIndicatorKey,
  TradingProfileDataSources,
  TradingSignalMetadata,
  TradingTechnique,
  TradingTechniqueScore,
} from '@alice/shared';
import type { AnalysisMatrixEntry } from './trading-analysis-consensus-service.js';
import type { TradingConsensusSummary, TradingPromptMatrixEntry } from './trading-llm-prompt-service.js';
import type { TradingMarketType } from './tradingTypes.js';
import type { TechnicalAnalysisResult } from './technical-indicators.js';

type TradingIntervalValue = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '8h' | '12h' | '1d' | '1w';

export function createTradingDatasetSeedService(deps: {
  resolveTradingIntervalFromUnknown: (value: unknown) => TradingIntervalValue | null;
  buildMarketContextFromSignal: (params: {
    auth: { tenantId: string; userId: string };
    symbol: string;
    interval: TradingIntervalValue;
    marketType: TradingMarketType;
    marginMode?: undefined;
    analysis?: TechnicalAnalysisResult;
  }) => Promise<schema.TradingDataset['marketContext']>;
  buildMultiTimeframePrompt: (params: {
    matrix: TradingPromptMatrixEntry[];
    consensus: TradingConsensusSummary;
    indicators: TradingIndicatorKey[];
    dataSources: TradingProfileDataSources;
    orderBook: null;
    news: null;
    trainingData: null;
    techniques: TradingTechnique[];
    techniqueScores: TradingTechniqueScore[];
    ensembleResult: TradingEnsembleResult;
    arbitrageSnapshot: null;
    arbitrageSnapshots: [];
  }) => string;
  buildMajorityConsensus: (matrix: AnalysisMatrixEntry[]) => TradingConsensusSummary;
}) {
  async function buildTradingDatasetSeedFromSignal(params: {
    authContext: { tenantId: string; userId: string };
    signal: schema.TradingSignal;
  }): Promise<{
    marketContext: schema.TradingDataset['marketContext'];
    prompt: string;
    responsePayload: Record<string, unknown>;
    interval: TradingIntervalValue;
    analysis: TechnicalAnalysisResult | undefined;
  }> {
    const metadata = (params.signal.metadata ?? {}) as Record<string, unknown>;
    const analysisMatrixRaw = Array.isArray(metadata.analysisMatrix) ? metadata.analysisMatrix : [];
    const matrix = analysisMatrixRaw
      .map((entry) => {
        const entryRecord = entry as Record<string, unknown>;
        const interval = deps.resolveTradingIntervalFromUnknown(entryRecord.interval) ?? '5m';
        const analysis = (entryRecord.analysis ?? undefined) as TechnicalAnalysisResult | undefined;
        return { interval, analysis };
      })
      .filter((entry): entry is { interval: TradingIntervalValue; analysis: TechnicalAnalysisResult } =>
        Boolean(entry.analysis),
      );

    const analysis = matrix[0]?.analysis;
    const interval = matrix[0]?.interval ?? '5m';

    const marketContext = await deps.buildMarketContextFromSignal({
      auth: params.authContext,
      symbol: params.signal.symbol,
      interval,
      marketType: params.signal.marketType as TradingMarketType,
      marginMode: undefined,
      analysis,
    });

    const techniques = Array.isArray(metadata.techniques)
      ? (metadata.techniques as TradingTechnique[])
      : [];
    const techniqueScores = Array.isArray(metadata.techniqueScores)
      ? (metadata.techniqueScores as TradingTechniqueScore[])
      : [];
    const ensembleResult = (metadata.ensembleResult as TradingEnsembleResult | undefined) ?? {
      overallSignal: 'neutral',
      confidence: 0,
      topTechniques: [],
    };

    const prompt = matrix.length > 0
      ? deps.buildMultiTimeframePrompt({
        matrix: matrix.map((entry) => ({
          interval: entry.interval,
          analysis: entry.analysis,
          indicatorId: '',
        })),
        consensus: deps.buildMajorityConsensus(matrix.map((entry) => ({
          interval: entry.interval,
          analysis: entry.analysis,
          indicatorId: '',
        }))),
        indicators: Array.isArray(metadata.enabledIndicators) ? (metadata.enabledIndicators as TradingIndicatorKey[]) : [],
        dataSources: (metadata.dataSources as TradingProfileDataSources) ?? { orderBook: false, news: false, trainingData: false },
        orderBook: null,
        news: null,
        trainingData: null,
        techniques,
        techniqueScores,
        ensembleResult,
        arbitrageSnapshot: null,
        arbitrageSnapshots: [],
      })
      : (params.signal.metadata as TradingSignalMetadata)?.reasoning ?? 'Sinal gerado sem contexto detalhado.';

    const responsePayload = {
      actionType: params.signal.signalType,
      suggestedPrice: params.signal.suggestedPrice,
      suggestedStopLoss: params.signal.suggestedStopLoss,
      suggestedTakeProfit: params.signal.suggestedTakeProfit,
      suggestedSize: params.signal.suggestedSize,
      confidence: params.signal.confidence,
      reasoning: (params.signal.metadata as TradingSignalMetadata)?.reasoning ?? null,
    };

    return { marketContext, prompt, responsePayload, interval, analysis };
  }

  return {
    buildTradingDatasetSeedFromSignal,
  };
}
