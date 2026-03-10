import type {
  TradingArbitrageConfig,
  TradingArbitrageExchange,
  TradingEnsembleConfig,
  TradingEnsembleResult,
  TradingIndicatorKey,
  TradingProfileConsensus,
  TradingTechnique,
  TradingTechniqueScore,
} from '@alice/shared';
import type { TriangularArbitrageResult } from './trading-arbitrage-service.js';
import type { TechnicalAnalysisResult } from './technical-indicators.js';
import type { TradingMarginMode, TradingMarketType } from './tradingTypes.js';

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

type TradingAnalysisMatrixEntry = {
  interval: TradingIntervalValue;
  analysis: TechnicalAnalysisResult;
  indicatorId: string;
  resolvedSymbol: string;
};

type TradingConsensusResult = {
  overallSignal: TechnicalAnalysisResult['overallSignal'];
  confidence: number;
  alignedTimeframes: TradingIntervalValue[];
  misalignedTimeframes: TradingIntervalValue[];
  agreementRatio: number;
  requiredAgree: number;
  totalTimeframes: number;
  isMajorityReached: boolean;
};

export function createTradingSignalAnalysisOrchestrationService(deps: {
  calculateAndPersistTechnicalAnalysis: (params: {
    tenantId: string;
    userId: string;
    symbol: string;
    interval: TradingIntervalValue;
    marketType?: TradingMarketType;
    marginMode?: TradingMarginMode;
    enabledIndicators?: TradingIndicatorKey[];
    techniques?: TradingTechnique[];
    ensembleConfig?: TradingEnsembleConfig;
  }) => Promise<{
    analysis: TechnicalAnalysisResult;
    indicatorId: string;
    resolvedSymbol: string;
  }>;
  buildMajorityConsensus: (
    matrix: Array<{
      interval: TradingIntervalValue;
      analysis: TechnicalAnalysisResult;
      indicatorId: string;
      resolvedSymbol?: string;
    }>,
    consensusConfig?: TradingProfileConsensus
  ) => TradingConsensusResult;
  aggregateTechniqueScores: (
    matrix: Array<{
      interval: TradingIntervalValue;
      analysis: TechnicalAnalysisResult;
      indicatorId: string;
      resolvedSymbol?: string;
    }>,
    techniques: TradingTechnique[]
  ) => TradingTechniqueScore[];
  buildEnsembleResult: (
    scores: TradingTechniqueScore[],
    config: TradingEnsembleConfig
  ) => TradingEnsembleResult;
  splitSymbolPair: (symbol: string) => { base: string; quote: string };
  resolveArbitrageFeePctForExchanges: (params: {
    exchanges: TradingArbitrageExchange[];
    symbol: string;
    marketType: TradingMarketType;
    tenantId: string;
  }) => Promise<{
    feePctByExchange: Record<TradingArbitrageExchange, number>;
    effectiveFeePct: number;
  }>;
  resolveNetworkFeesForTenant: (tenantId: string) => Promise<Record<string, number>>;
  calculateTriangularArbitrage: (params: {
    auth: { tenantId: string; userId: string };
    startAsset: string;
    quoteAsset: string;
    intermediateAssets: string[];
    marketType?: TradingMarketType;
    marginMode?: TradingMarginMode;
    feePct: number;
    exchanges: TradingArbitrageExchange[];
    feePctByExchange?: Record<TradingArbitrageExchange, number>;
    networkFeesByAsset?: Record<string, number>;
    maxSlippagePct: number;
  }) => Promise<TriangularArbitrageResult[]>;
}) {
  async function buildTradingSignalAnalysisContext(params: {
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
  }): Promise<{
    analysisMatrix: TradingAnalysisMatrixEntry[];
    primaryAnalysis: TradingAnalysisMatrixEntry;
    consensus: TradingConsensusResult;
    techniqueScores: TradingTechniqueScore[];
    ensembleResult: TradingEnsembleResult;
    arbitrageSnapshot: TriangularArbitrageResult | null;
    arbitrageSnapshots: TriangularArbitrageResult[];
  }> {
    const analysisMatrix = await Promise.all(
      params.timeframes.map(async (frame) => {
        const result = await deps.calculateAndPersistTechnicalAnalysis({
          tenantId: params.tenantId,
          userId: params.userId,
          symbol: params.symbol,
          interval: frame,
          marketType: params.marketType,
          marginMode: params.marginMode,
          enabledIndicators: params.enabledIndicators,
          techniques: params.techniques,
          ensembleConfig: params.ensembleConfig,
        });
        return {
          interval: frame,
          analysis: result.analysis,
          indicatorId: result.indicatorId,
          resolvedSymbol: result.resolvedSymbol,
        } as TradingAnalysisMatrixEntry;
      })
    );

    const primaryAnalysis = analysisMatrix[0];
    const consensus = deps.buildMajorityConsensus(analysisMatrix, params.consensusConfig);
    let techniqueScores = deps.aggregateTechniqueScores(analysisMatrix, params.techniques);
    let arbitrageSnapshot: TriangularArbitrageResult | null = null;
    let arbitrageSnapshots: TriangularArbitrageResult[] = [];

    if (params.techniques.includes('arbitrage_triangular') && params.arbitrageConfig) {
      const resolvedSymbol = primaryAnalysis.resolvedSymbol ?? params.symbol;
      const { base, quote } = deps.splitSymbolPair(resolvedSymbol);
      const { feePctByExchange, effectiveFeePct } = await deps.resolveArbitrageFeePctForExchanges({
        exchanges: params.arbitrageConfig.exchanges,
        symbol: resolvedSymbol,
        marketType: params.marketType ?? 'spot',
        tenantId: params.tenantId,
      });
      const networkFeesByAsset = params.arbitrageConfig.exchanges.length > 1
        ? await deps.resolveNetworkFeesForTenant(params.tenantId)
        : undefined;
      arbitrageSnapshots = await deps.calculateTriangularArbitrage({
        auth: { tenantId: params.tenantId, userId: params.userId },
        startAsset: base,
        quoteAsset: quote,
        intermediateAssets: params.arbitrageConfig.intermediateAssets,
        marketType: params.marketType,
        marginMode: params.marginMode,
        feePct: effectiveFeePct,
        exchanges: params.arbitrageConfig.exchanges,
        feePctByExchange,
        networkFeesByAsset,
        maxSlippagePct: params.arbitrageConfig.maxSlippagePct,
      });
      arbitrageSnapshot = arbitrageSnapshots[0] ?? null;
      if (arbitrageSnapshot) {
        const edgePct = arbitrageSnapshot.edgePct;
        const minEdge = params.arbitrageConfig.minEdgePct;
        const confidence = Math.min(edgePct / Math.max(minEdge, 0.01), 1);
        const signal = edgePct >= minEdge * 2
          ? 'strong_buy'
          : edgePct >= minEdge
            ? 'buy'
            : 'neutral';
        techniqueScores = techniqueScores.concat([{
          technique: 'arbitrage_triangular',
          signal,
          confidence: Math.round(confidence * 100) / 100,
          rationale: `Edge ${edgePct.toFixed(2)}% (mín ${minEdge.toFixed(2)}%)`,
        }]);
      } else {
        techniqueScores = techniqueScores.concat([{
          technique: 'arbitrage_triangular',
          signal: 'neutral',
          confidence: 0,
          rationale: 'Sem rota triangular válida com liquidez suficiente.',
        }]);
      }
    }

    const ensembleResult = deps.buildEnsembleResult(techniqueScores, params.ensembleConfig);

    return {
      analysisMatrix,
      primaryAnalysis,
      consensus,
      techniqueScores,
      ensembleResult,
      arbitrageSnapshot,
      arbitrageSnapshots,
    };
  }

  return {
    buildTradingSignalAnalysisContext,
  };
}
