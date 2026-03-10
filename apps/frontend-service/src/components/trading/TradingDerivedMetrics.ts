import type {
  FuturesAccountOverview,
  MarginCrossAccount,
  MarginIsolatedAccount,
  MarginIsolatedAsset,
  MarketData,
  SpotAccount,
} from './TradingDomainTypes';

type ResolveOpenPositionsCountOptions = {
  isFuturesMarket: boolean;
  isMarginMarket: boolean;
  isSpotMarket: boolean;
  marginCrossPositions: MarginCrossAccount | null;
  marginIsolatedPositions: MarginIsolatedAccount | null;
  openFuturesPositions: Array<unknown>;
  spotPositions: SpotAccount[];
};

type BuildTradingAccountSummariesOptions = {
  account: unknown;
  baseCurrency: string | null;
  marginCrossAccount: MarginCrossAccount | null;
  marginIsolatedAccount: MarginIsolatedAccount | null;
  marginIsolatedAsset: MarginIsolatedAsset | undefined;
  quoteCurrency: string | null;
  spotAccounts: SpotAccount[];
  spotBaseAccount: SpotAccount | undefined;
  spotQuoteAccount: SpotAccount | undefined;
};

type ResolveTradingPriceChangeOptions = {
  isFuturesMarket: boolean;
  market: MarketData | undefined;
};

export function resolveTradingOpenPositionsCount(options: ResolveOpenPositionsCountOptions): number {
  const {
    isFuturesMarket,
    isMarginMarket,
    isSpotMarket,
    marginCrossPositions,
    marginIsolatedPositions,
    openFuturesPositions,
    spotPositions,
  } = options;

  if (isFuturesMarket) return openFuturesPositions.length;
  if (isSpotMarket) return spotPositions.filter((entry) => Number(entry.balance) > 0).length;
  if (!isMarginMarket) return 0;
  if (marginCrossPositions) return marginCrossPositions.accounts.filter((entry) => Number(entry.total) > 0).length;
  if (marginIsolatedPositions) return marginIsolatedPositions.assets.length;
  return 0;
}

export function buildTradingAccountSummaries(options: BuildTradingAccountSummariesOptions) {
  const {
    account,
    baseCurrency,
    marginCrossAccount,
    marginIsolatedAccount,
    marginIsolatedAsset,
    quoteCurrency,
    spotAccounts,
    spotBaseAccount,
    spotQuoteAccount,
  } = options;

  const futuresAccountSummary = {
    equity: (account as FuturesAccountOverview | null)?.accountEquity ?? 0,
    marginBalance: (account as FuturesAccountOverview | null)?.marginBalance ?? 0,
    positionMargin: (account as FuturesAccountOverview | null)?.positionMargin ?? 0,
    orderMargin: (account as FuturesAccountOverview | null)?.orderMargin ?? 0,
    frozenFunds: (account as FuturesAccountOverview | null)?.frozenFunds ?? 0,
  };

  const spotAccountSummary = {
    baseCurrency: spotBaseAccount?.currency ?? baseCurrency ?? '',
    baseAvailable: Number(spotBaseAccount?.available ?? 0),
    baseBalance: Number(spotBaseAccount?.balance ?? 0),
    quoteCurrency: spotQuoteAccount?.currency ?? quoteCurrency ?? '',
    quoteAvailable: Number(spotQuoteAccount?.available ?? 0),
    quoteBalance: Number(spotQuoteAccount?.balance ?? 0),
    assetsWithBalance: spotAccounts.filter((entry) => Number(entry.balance) > 0).length,
  };

  const marginAccountSummary = {
    totalAsset: Number(
      marginCrossAccount?.totalAssetOfQuoteCurrency ??
      marginIsolatedAccount?.totalAssetOfQuoteCurrency ??
      0
    ),
    totalLiability: Number(
      marginCrossAccount?.totalLiabilityOfQuoteCurrency ??
      marginIsolatedAccount?.totalLiabilityOfQuoteCurrency ??
      0
    ),
    debtRatio: Number(
      marginCrossAccount?.debtRatio ??
      marginIsolatedAsset?.debtRatio ??
      0
    ),
  };

  return {
    futuresAccountSummary,
    marginAccountSummary,
    spotAccountSummary,
  };
}

export function resolveTradingPriceChange(options: ResolveTradingPriceChangeOptions) {
  const { isFuturesMarket, market } = options;

  const priceChange = isFuturesMarket
    ? (market?.contract?.priceChg || 0)
    : (market?.ticker?.changePrice ? Number(market.ticker.changePrice) : 0);

  const priceChangePercent = isFuturesMarket
    ? (market?.contract?.priceChgPct || 0)
    : (market?.ticker?.changeRate ? Number(market.ticker.changeRate) * 100 : 0);

  return {
    priceChange,
    priceChangePercent,
  };
}
