import type {
  HeaderSectionProps,
  OperationalAlertsSectionProps,
  StatsPrimarySectionProps,
  StatsSecondarySectionProps,
  TabsShellSectionProps,
} from './TradingSectionPropsBuilderTypes';

type BuildTradingLayoutSectionPropsOptions = {
  accountMode: StatsPrimarySectionProps['accountMode'];
  activeSignals: StatsSecondarySectionProps['activeSignals'];
  activeTab: TabsShellSectionProps['activeTab'];
  activeWorkspace: TabsShellSectionProps['activeWorkspace'];
  circuitBreakerFailures: StatsSecondarySectionProps['circuitBreakerFailures'];
  circuitBreakerState: StatsSecondarySectionProps['circuitBreakerState'];
  criticalApiError: OperationalAlertsSectionProps['criticalApiError'];
  currentPrice: StatsPrimarySectionProps['currentPrice'];
  favoriteSymbols: HeaderSectionProps['favoriteSymbols'];
  featuredOverride: HeaderSectionProps['featuredOverride'];
  featuredSymbols: HeaderSectionProps['featuredSymbols'];
  fundingRate: StatsSecondarySectionProps['fundingRate'];
  futuresAvailableBalance: StatsPrimarySectionProps['futuresAvailableBalance'];
  futuresCurrency: StatsPrimarySectionProps['futuresCurrency'];
  futuresUnrealisedPnl: StatsPrimarySectionProps['futuresUnrealisedPnl'];
  isFuturesMarket: StatsSecondarySectionProps['isFuturesMarket'];
  isLoadingAccount: StatsPrimarySectionProps['isLoadingAccount'];
  isLoadingMarket: StatsPrimarySectionProps['isLoadingMarket'];
  isLoadingSymbols: HeaderSectionProps['isLoadingSymbols'];
  isTradingEnabled: HeaderSectionProps['isTradingEnabled'];
  isUpdatingSymbolPrefs: HeaderSectionProps['isUpdatingSymbolPrefs'];
  locale: StatsPrimarySectionProps['locale'];
  marginTotalAsset: StatsPrimarySectionProps['marginTotalAsset'];
  marginTotalLiability: StatsPrimarySectionProps['marginTotalLiability'];
  marketHighPrice: StatsPrimarySectionProps['marketHighPrice'];
  marketLowPrice: StatsPrimarySectionProps['marketLowPrice'];
  marketVolumeOf24h: StatsPrimarySectionProps['marketVolumeOf24h'];
  maxLeverage: StatsSecondarySectionProps['maxLeverage'];
  onMarketTypeChange: HeaderSectionProps['onMarketTypeChange'];
  onMarginModeChange: HeaderSectionProps['onMarginModeChange'];
  onOpenRiskConfigDialog: HeaderSectionProps['onOpenRiskConfigDialog'];
  onSelectFeaturedSymbol: HeaderSectionProps['onSelectFeaturedSymbol'];
  onSymbolChange: HeaderSectionProps['onSymbolChange'];
  onTabChange: TabsShellSectionProps['onTabChange'];
  onToggleFavorite: HeaderSectionProps['onToggleFavorite'];
  onToggleFeatured: HeaderSectionProps['onToggleFeatured'];
  onWorkspaceChange: TabsShellSectionProps['onWorkspaceChange'];
  openPositionsCount: StatsSecondarySectionProps['openPositionsCount'];
  pendingOrders: StatsSecondarySectionProps['pendingOrders'];
  priceChange: StatsPrimarySectionProps['priceChange'];
  priceChangePercent: StatsPrimarySectionProps['priceChangePercent'];
  quoteCurrency: StatsPrimarySectionProps['quoteCurrency'];
  selectedMarginMode: HeaderSectionProps['selectedMarginMode'];
  selectedMarketType: HeaderSectionProps['selectedMarketType'];
  selectedSymbol: HeaderSectionProps['selectedSymbol'];
  spotAssetsWithBalance: StatsPrimarySectionProps['spotAssetsWithBalance'];
  spotQuoteAvailable: StatsPrimarySectionProps['spotQuoteAvailable'];
  symbolOptionsLength: HeaderSectionProps['symbolOptionsLength'];
  symbolSelectItems: HeaderSectionProps['symbolSelectItems'];
  t: HeaderSectionProps['t'];
  tabs: TabsShellSectionProps['tabs'];
  workspaceOptions: TabsShellSectionProps['workspaceOptions'];
  wsConfigured: StatsPrimarySectionProps['wsConfigured'];
  wsConnecting: HeaderSectionProps['wsConnecting'];
  wsEnabled: HeaderSectionProps['wsEnabled'];
  wsHealthy: HeaderSectionProps['wsHealthy'];
  wsPrivateEnabled: StatsPrimarySectionProps['wsPrivateEnabled'];
  wsPrivateState: StatsPrimarySectionProps['wsPrivateState'];
  wsPublicState: StatsPrimarySectionProps['wsPublicState'];
};

export function buildTradingLayoutSectionProps({
  accountMode,
  activeSignals,
  activeTab,
  activeWorkspace,
  circuitBreakerFailures,
  circuitBreakerState,
  criticalApiError,
  currentPrice,
  favoriteSymbols,
  featuredOverride,
  featuredSymbols,
  fundingRate,
  futuresAvailableBalance,
  futuresCurrency,
  futuresUnrealisedPnl,
  isFuturesMarket,
  isLoadingAccount,
  isLoadingMarket,
  isLoadingSymbols,
  isTradingEnabled,
  isUpdatingSymbolPrefs,
  locale,
  marginTotalAsset,
  marginTotalLiability,
  marketHighPrice,
  marketLowPrice,
  marketVolumeOf24h,
  maxLeverage,
  onMarketTypeChange,
  onMarginModeChange,
  onOpenRiskConfigDialog,
  onSelectFeaturedSymbol,
  onSymbolChange,
  onTabChange,
  onToggleFavorite,
  onToggleFeatured,
  onWorkspaceChange,
  openPositionsCount,
  pendingOrders,
  priceChange,
  priceChangePercent,
  quoteCurrency,
  selectedMarginMode,
  selectedMarketType,
  selectedSymbol,
  spotAssetsWithBalance,
  spotQuoteAvailable,
  symbolOptionsLength,
  symbolSelectItems,
  t,
  tabs,
  workspaceOptions,
  wsConfigured,
  wsConnecting,
  wsEnabled,
  wsHealthy,
  wsPrivateEnabled,
  wsPrivateState,
  wsPublicState,
}: BuildTradingLayoutSectionPropsOptions): {
  operationalAlertsSectionProps: OperationalAlertsSectionProps;
  headerSectionProps: HeaderSectionProps;
  statsPrimarySectionProps: StatsPrimarySectionProps;
  statsSecondarySectionProps: StatsSecondarySectionProps;
  tabsShellSectionProps: TabsShellSectionProps;
} {
  const operationalAlertsSectionProps: OperationalAlertsSectionProps = {
    criticalApiError,
    isTradingEnabled,
    onOpenRiskConfigDialog,
    t,
  };
  const headerSectionProps: HeaderSectionProps = {
    favoriteSymbols,
    featuredOverride,
    featuredSymbols,
    isLoadingSymbols,
    isTradingEnabled,
    isUpdatingSymbolPrefs,
    onMarketTypeChange,
    onMarginModeChange,
    onOpenRiskConfigDialog,
    onSelectFeaturedSymbol,
    onSymbolChange,
    onToggleFavorite,
    onToggleFeatured,
    selectedMarginMode,
    selectedMarketType,
    selectedSymbol,
    symbolOptionsLength,
    symbolSelectItems,
    t,
    wsConnecting,
    wsEnabled,
    wsHealthy,
  };
  const statsPrimarySectionProps: StatsPrimarySectionProps = {
    accountMode,
    currentPrice,
    futuresAvailableBalance,
    futuresCurrency,
    futuresUnrealisedPnl,
    isLoadingAccount,
    isLoadingMarket,
    locale,
    marginTotalAsset,
    marginTotalLiability,
    marketHighPrice,
    marketLowPrice,
    marketVolumeOf24h,
    priceChange,
    priceChangePercent,
    quoteCurrency,
    selectedSymbol,
    spotAssetsWithBalance,
    spotQuoteAvailable,
    t,
    wsConfigured,
    wsHealthy,
    wsPrivateEnabled,
    wsPrivateState,
    wsPublicState,
  };
  const statsSecondarySectionProps: StatsSecondarySectionProps = {
    activeSignals,
    circuitBreakerFailures,
    circuitBreakerState,
    fundingRate,
    isFuturesMarket,
    locale,
    maxLeverage,
    openPositionsCount,
    pendingOrders,
    t,
  };
  const tabsShellSectionProps: TabsShellSectionProps = {
    activeTab,
    activeWorkspace,
    onTabChange,
    onWorkspaceChange,
    tabs,
    workspaceOptions,
  };

  return {
    operationalAlertsSectionProps,
    headerSectionProps,
    statsPrimarySectionProps,
    statsSecondarySectionProps,
    tabsShellSectionProps,
  };
}
