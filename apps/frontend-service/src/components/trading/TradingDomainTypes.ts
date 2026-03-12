import type { OrderBookData } from './OrderBookViz';
import type { TradingNewsConfigForm } from './NewsConfigEditor';

export interface TradingStatus {
  isConfigured: boolean;
  missingKeys?: string[];
  circuitBreaker: {
    state: string;
    failures: number;
    successes: number;
  };
  riskConfig: RiskConfig | null;
  activeSignals: number;
  pendingOrders: number;
  requiresTenant?: boolean;
  defaultSymbol?: string;
  featureFlags?: {
    tradingWorkspaceV2Enabled?: boolean;
    [key: string]: unknown;
  };
}

export interface KucoinWsStatus {
  configured: boolean;
  allowedSymbols?: string[];
  defaultSymbol?: string;
  supportedMarkets?: Array<'futures' | 'spot' | 'margin'>;
  public: { state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' };
  private: { enabled: boolean; state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' };
}

export interface TradingSymbolsResponse {
  symbols: string[];
  defaultSymbol: string;
  favorites?: string[];
  featured?: string[];
  topSymbols?: string[];
}

export interface OrderBookResponse {
  success: boolean;
  data: OrderBookData;
  depth: number;
}

export interface RiskConfig {
  id: string;
  tenantId: string;
  maxPositionSize: string;
  maxDailyLoss: string;
  maxOrderValue: string;
  maxLeverage: number;
  maxOpenPositions: number;
  defaultLeverage: number;
  defaultSymbol: string | null;
  defaultMarketType: 'futures' | 'spot' | 'margin';
  marginMode: 'cross' | 'isolated';
  defaultStopLoss: string | null;
  defaultTakeProfit: string | null;
  tradingEnabled: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

export interface MarketData {
  ticker: {
    symbol: string;
    price: string;
    bestBidPrice: string;
    bestAskPrice: string;
    bestBidSize: number;
    bestAskSize: number;
    ts: number;
    changePrice?: string;
    changeRate?: string;
  };
  contract: {
    symbol: string;
    baseCurrency: string;
    quoteCurrency: string;
    maxLeverage: number;
    markPrice: number;
    indexPrice: number;
    lastTradePrice: number;
    volumeOf24h: number;
    turnoverOf24h: number;
    openInterest: string;
    priceChgPct: number;
    priceChg: number;
    highPrice: number;
    lowPrice: number;
    fundingFeeRate: number;
    nextFundingRateTime: number;
    multiplier: number;
  };
}

export interface FuturesAccountOverview {
  accountEquity: number;
  unrealisedPNL: number;
  marginBalance: number;
  positionMargin: number;
  orderMargin: number;
  frozenFunds: number;
  availableBalance: number;
  currency: string;
}

export interface SpotAccount {
  id: string;
  currency: string;
  type: string;
  balance: string;
  available: string;
  holds: string;
}

export interface MarginCrossAccountEntry {
  currency: string;
  total: string;
  available: string;
  hold: string;
  liability: string;
  liabilityPrincipal: string;
  liabilityInterest: string;
  maxBorrowSize: string;
  borrowEnabled: boolean;
  transferInEnabled: boolean;
}

export interface MarginCrossAccount {
  totalAssetOfQuoteCurrency: string;
  totalLiabilityOfQuoteCurrency: string;
  debtRatio: string;
  status: string;
  accounts: MarginCrossAccountEntry[];
}

export interface MarginIsolatedAssetDetail {
  currency: string;
  borrowEnabled: boolean;
  transferInEnabled: boolean;
  liability: string;
  liabilityPrincipal: string;
  liabilityInterest: string;
  total: string;
  available: string;
  hold: string;
  maxBorrowSize: string;
}

export interface MarginIsolatedAsset {
  symbol: string;
  status: string;
  debtRatio: string;
  baseAsset: MarginIsolatedAssetDetail;
  quoteAsset: MarginIsolatedAssetDetail;
}

export interface MarginIsolatedAccount {
  totalAssetOfQuoteCurrency: string;
  totalLiabilityOfQuoteCurrency: string;
  timestamp: number;
  assets: MarginIsolatedAsset[];
}

export type TradingAccountOverview = FuturesAccountOverview | SpotAccount[] | MarginCrossAccount | MarginIsolatedAccount | null;

export type PositionsResponse = Position[] | SpotAccount[] | MarginCrossAccount | MarginIsolatedAccount;

export interface Position {
  id: string;
  symbol: string;
  currentQty: number;
  currentCost: number;
  avgEntryPrice: number;
  markPrice: number;
  markValue: number;
  unrealisedPnl: number;
  unrealisedPnlPcnt: number;
  unrealisedRoePcnt: number;
  realLeverage: number;
  liquidationPrice: number;
  maintMargin: number;
  posMargin: number;
  isOpen: boolean;
  settleCurrency: string;
}

export type TradingOperationType = 'scalping' | 'swing' | 'position' | 'cash_and_carry' | 'arbitrage' | 'hedge' | 'neutral';

export interface TradingSignal {
  id: string;
  tenantId: string;
  signalType: 'entry_long' | 'entry_short' | 'exit' | 'adjust_sl' | 'adjust_tp' | 'hold' | 'neutral';
  symbol: string;
  marketType: 'futures' | 'spot' | 'margin';
  suggestedPrice?: number | null;
  suggestedStopLoss?: number | null;
  suggestedTakeProfit?: number | null;
  suggestedSize?: number | null;
  confidence: number;
  reasoning: string | null;
  sourceModel: string | null;
  metadata: {
    validationStatus?: 'pending' | 'validated' | 'failed';
    validationId?: string;
    generationSource?: 'on_demand' | 'scheduler' | 'chat';
    agentId?: string;
    namespaceId?: string;
    modelVersion?: string;
    approvalStatus?: 'pending' | 'approved' | 'rejected';
    approvalReason?: string;
    operationType?: TradingOperationType;
    expectedDurationMinutes?: number;
    expectedDurationLabel?: string;
    entryPrice?: number;
    takeProfit?: number;
    stopLoss?: number;
    riskReward?: number;
    motivators?: string[];
    invalidationReasons?: string[];
    tradeSummary?: string;
    dataSources?: {
      orderBook?: boolean;
      news?: boolean;
      trainingData?: boolean;
    };
    news?: {
      query: string;
      results: Array<{ title: string; url: string; score?: number }>;
    };
    [key: string]: unknown;
  };
  isActive: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

export interface TradingOrder {
  id: string;
  tenantId: string;
  signalId: string | null;
  kucoinOrderId: string;
  clientOid: string;
  symbol: string;
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market' | 'stop_limit' | 'stop_market' | 'take_profit';
  status: 'pending_review' | 'review_rejected' | 'pending' | 'submitted' | 'open' | 'filled' | 'cancelled' | 'rejected' | 'expired' | 'error';
  price: string;
  size: string;
  filledSize: string | null;
  avgFilledPrice: string | null;
  leverage: number;
  stopLoss: string | null;
  takeProfit: string | null;
  metadata: Record<string, unknown>;
  criadoEm: string;
  atualizadoEm: string;
}

export interface TradingPostMortem {
  id: string;
  positionId: string | null;
  symbol?: string | null;
  marketType?: 'futures' | 'spot' | 'margin' | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  confidenceScore?: number | null;
  qualityScore?: number | null;
  summary?: string | null;
  recommendation?: string | null;
  motivators?: string[] | null;
  successFactors?: string[] | null;
  failureFactors?: string[] | null;
  lessons?: string[] | null;
  criadoEm: string;
  atualizadoEm: string;
}

export interface NamespaceOption {
  id: string;
  nome: string;
  slug: string;
  ativo?: boolean;
}

export interface TradingProfileForm {
  kind: 'analysis' | 'signal';
  timeframes: string[];
  indicators: string[];
  techniques: string[];
  dataSources: {
    orderBook: boolean;
    news: boolean;
    trainingData: boolean;
  };
  newsConfig: TradingNewsConfigForm;
  ensembleConfig?: {
    mode?: 'ensemble_top3';
    topN?: number;
  };
  arbitrageConfig?: {
    exchanges: string[];
    intermediateAssets: string[];
    feePct: number;
    maxSlippagePct: number;
    minEdgePct: number;
    maxIntervalMinutes: number;
  } | null;
  modelConfig?: {
    temperature?: number;
    maxTokens?: number;
  };
  consensus?: {
    rule?: 'majority';
    minAgree?: number;
  };
}

export type SignalProfilePayload = {
  kind: 'signal';
  marketType: 'futures' | 'spot' | 'margin';
  symbol?: string;
  timeframes: string[];
  indicators: string[];
  dataSources: TradingProfileForm['dataSources'];
  newsConfig: TradingNewsConfigForm;
  techniques: string[];
  ensembleConfig?: TradingProfileForm['ensembleConfig'];
  arbitrageConfig?: TradingProfileForm['arbitrageConfig'];
  modelConfig?: TradingProfileForm['modelConfig'];
  consensus?: TradingProfileForm['consensus'];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

export function isFuturesPositionArray(value: PositionsResponse | null | undefined): value is Position[] {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => (
    isRecord(entry)
    && typeof entry.symbol === 'string'
    && typeof entry.currentQty === 'number'
    && typeof entry.isOpen === 'boolean'
  ));
}

export function isSpotAccountArray(
  value: TradingAccountOverview | PositionsResponse | null | undefined
): value is SpotAccount[] {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => (
    isRecord(entry)
    && typeof entry.currency === 'string'
    && typeof entry.type === 'string'
    && typeof entry.balance === 'string'
    && typeof entry.available === 'string'
    && typeof entry.holds === 'string'
  ));
}

export function isFuturesAccountOverview(value: TradingAccountOverview | null | undefined): value is FuturesAccountOverview {
  return (
    isRecord(value)
    && !Array.isArray(value)
    && typeof value.accountEquity === 'number'
    && typeof value.availableBalance === 'number'
    && typeof value.currency === 'string'
  );
}

export function isMarginCrossOverview(value: TradingAccountOverview | null | undefined): value is MarginCrossAccount {
  return Boolean(
    isRecord(value)
    && !Array.isArray(value)
    && Array.isArray((value as { accounts?: unknown }).accounts)
  );
}

export function isMarginIsolatedOverview(value: TradingAccountOverview | null | undefined): value is MarginIsolatedAccount {
  return Boolean(
    isRecord(value)
    && !Array.isArray(value)
    && Array.isArray((value as { assets?: unknown }).assets)
  );
}

export function isMarginCrossAccount(value: PositionsResponse | null | undefined): value is MarginCrossAccount {
  return Boolean(
    isRecord(value)
    && !Array.isArray(value)
    && Array.isArray((value as { accounts?: unknown }).accounts)
  );
}

export function isMarginIsolatedAccount(value: PositionsResponse | null | undefined): value is MarginIsolatedAccount {
  return Boolean(
    isRecord(value)
    && !Array.isArray(value)
    && Array.isArray((value as { assets?: unknown }).assets)
  );
}

export const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
} as const;

export const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 100, damping: 15 },
  },
} as const;
