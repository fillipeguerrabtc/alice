import type {
  TradingProfileDataSources,
  TradingProfileNewsConfig,
  TradingRiskConfig,
} from '@alice/shared';
import type { RAGTradingContext } from './trading-rag-client.js';
import type { TechnicalAnalysisResult } from './technical-indicators.js';
import type { buildTradePlanFromAnalysis } from './trading-signal-plan-service.js';
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

type TradingOrderBookSnapshot = {
  symbol: string;
  bestBid: number | null;
  bestAsk: number | null;
  spreadAbs: number | null;
  spreadPct: number | null;
  depth: number;
};

type TradingNewsSummary = {
  query: string;
  results: Array<{ title: string; url: string; score?: number }>;
};

type TradingDatasetSummary = {
  totalApproved: number;
  samples: Array<{ prompt: string; response: string; actionType: string; createdAt: string }>;
};

type TradingConsensusContext = {
  overallSignal: string;
  confidence: number;
};

type TradingTradePlan = ReturnType<typeof buildTradePlanFromAnalysis>;

export function createTradingSignalContextService(deps: {
  TradingConfigErrorCtor: new (message: string) => Error;
  queryTradingRagContext: (params: {
    tenantId: string;
    userId: string;
    namespaceId?: string | null;
    symbol: string;
    marketType: string;
    additionalContext?: string;
  }) => Promise<RAGTradingContext | null>;
  getOrderBookSnapshot: (
    auth: { tenantId: string; userId: string },
    symbol: string,
    marketType?: TradingMarketType,
    marginMode?: TradingMarginMode
  ) => Promise<TradingOrderBookSnapshot>;
  fetchNewsSummary: (
    auth: { tenantId: string; userId: string },
    symbol: string,
    marketType?: TradingMarketType,
    newsConfig?: TradingProfileNewsConfig
  ) => Promise<TradingNewsSummary>;
  fetchTradingDatasetSummary: (tenantId: string, namespaceId: string) => Promise<TradingDatasetSummary>;
  getRiskConfig: (auth: { tenantId: string; userId: string }) => Promise<TradingRiskConfig | null>;
  buildTradePlanFromAnalysis: (params: {
    analysis: TechnicalAnalysisResult;
    interval: string;
    timeframes: string[];
    marketType: TradingMarketType;
    marginMode?: TradingMarginMode;
    riskConfig: TradingRiskConfig | null;
  }) => TradingTradePlan;
}) {
  async function buildTradingSignalOperationalContext(params: {
    tenantId: string;
    userId: string;
    symbol: string;
    marketType?: TradingMarketType;
    marginMode?: TradingMarginMode;
    namespaceId?: string | null;
    effectiveDataSources: TradingProfileDataSources;
    profileNewsConfig?: TradingProfileNewsConfig;
    consensus: TradingConsensusContext;
    primaryAnalysis: {
      analysis: TechnicalAnalysisResult;
      interval: TradingIntervalValue;
    };
    timeframes: TradingIntervalValue[];
  }): Promise<{
    ragContext: RAGTradingContext | null;
    orderBookSnapshot: TradingOrderBookSnapshot | null;
    newsSummary: TradingNewsSummary | null;
    trainingSummary: TradingDatasetSummary;
    tradePlan: TradingTradePlan;
  }> {
    const ragContext = await deps.queryTradingRagContext({
      tenantId: params.tenantId,
      userId: params.userId,
      namespaceId: params.namespaceId,
      symbol: params.symbol,
      marketType: params.marketType ?? 'futures',
      additionalContext: params.consensus.overallSignal !== 'neutral'
        ? `Sinal ${params.consensus.overallSignal} com confiança ${(params.consensus.confidence * 100).toFixed(0)}%`
        : undefined,
    });

    const orderBookSnapshot = params.effectiveDataSources.orderBook
      ? await deps.getOrderBookSnapshot(
          { tenantId: params.tenantId, userId: params.userId },
          params.symbol,
          params.marketType,
          params.marginMode
        )
      : null;

    const newsSummary = params.effectiveDataSources.news
      ? await deps.fetchNewsSummary(
          { tenantId: params.tenantId, userId: params.userId },
          params.symbol,
          params.marketType,
          params.profileNewsConfig
        )
      : null;

    if (!params.namespaceId) {
      throw new deps.TradingConfigErrorCtor('TRADING_SCOPE_REQUIRED: Namespace Trading não resolvido para busca de dataset.');
    }

    const trainingSummary = await deps.fetchTradingDatasetSummary(params.tenantId, params.namespaceId);
    if (trainingSummary.totalApproved <= 0) {
      throw new deps.TradingConfigErrorCtor('TRADING_SCOPE_REQUIRED: Dataset aprovado de Trading é obrigatório para gerar sinais.');
    }

    const riskConfig = await deps.getRiskConfig({ tenantId: params.tenantId, userId: params.userId });
    const tradePlan = deps.buildTradePlanFromAnalysis({
      analysis: params.primaryAnalysis.analysis,
      interval: params.primaryAnalysis.interval,
      timeframes: params.timeframes,
      marketType: params.marketType ?? 'futures',
      marginMode: params.marginMode,
      riskConfig,
    });

    return {
      ragContext,
      orderBookSnapshot,
      newsSummary,
      trainingSummary,
      tradePlan,
    };
  }

  return {
    buildTradingSignalOperationalContext,
  };
}
