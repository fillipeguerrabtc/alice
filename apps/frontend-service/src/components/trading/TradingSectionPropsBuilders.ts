import type { ComponentProps } from 'react';
import { OcoOrderForm } from './OcoOrderForm';
import { TradingAccountTabContent } from './TradingAccountTabContent';
import { TradingAnalysisTabContent } from './TradingAnalysisTabContent';
import { TradingChartTabContent } from './TradingChartTabContent';
import { TradingControlTabContent } from './TradingControlTabContent';
import { TradingDialogsSection } from './TradingDialogsSection';
import { TradingHistoryTabContent } from './TradingHistoryTabContent';
import { TradingLabTabContent } from './TradingLabTabContent';
import { TradingNewOrderDialog } from './TradingNewOrderDialog';
import { TradingNewSignalDialog } from './TradingNewSignalDialog';
import { TradingHeaderSection } from './TradingHeaderSection';
import { TradingOperationalAlerts } from './TradingOperationalAlerts';
import { TradingOperationalTabsSection } from './TradingOperationalTabsSection';
import { TradingOrdersTabContent } from './TradingOrdersTabContent';
import { TradingOverviewTabContent } from './TradingOverviewTabContent';
import { TradingOrderBookTabContent } from './TradingOrderBookTabContent';
import { TradingPostmortemTrainingDialog } from './TradingPostmortemTrainingDialog';
import { TradingPostMortemsTabContent } from './TradingPostMortemsTabContent';
import { TradingPortfolioAutoTabContent } from './TradingPortfolioAutoTabContent';
import { TradingPositionsTabContent } from './TradingPositionsTabContent';
import { TradingPrimaryTabsSection } from './TradingPrimaryTabsSection';
import { TradingReviewOrderDialog } from './TradingReviewOrderDialog';
import { TradingRiskConfigDialog } from './TradingRiskConfigDialog';
import { TradingSignalsAutoTabContent } from './TradingSignalsAutoTabContent';
import { TradingSignalsTabContent } from './TradingSignalsTabContent';
import { TradingStatsPrimaryRow, TradingStatsSecondaryRow } from './TradingStatsRows';
import { TradingTabsShell } from './TradingTabsShell';

type AccountTabProps = ComponentProps<typeof TradingAccountTabContent>;
type AnalysisTabProps = ComponentProps<typeof TradingAnalysisTabContent>;
type ChartTabProps = ComponentProps<typeof TradingChartTabContent>;
type ControlTabProps = ComponentProps<typeof TradingControlTabContent>;
type LabTabProps = ComponentProps<typeof TradingLabTabContent>;
type HistoryTabProps = ComponentProps<typeof TradingHistoryTabContent>;
type OrdersTabProps = ComponentProps<typeof TradingOrdersTabContent>;
type OrderBookTabProps = ComponentProps<typeof TradingOrderBookTabContent>;
type OverviewTabProps = ComponentProps<typeof TradingOverviewTabContent>;
type PostMortemsTabProps = ComponentProps<typeof TradingPostMortemsTabContent>;
type PortfolioAutoTabProps = ComponentProps<typeof TradingPortfolioAutoTabContent>;
type PositionsTabProps = ComponentProps<typeof TradingPositionsTabContent>;
type PrimaryTabsSectionProps = ComponentProps<typeof TradingPrimaryTabsSection>;
type SignalsAutoTabProps = ComponentProps<typeof TradingSignalsAutoTabContent>;
type SignalsTabProps = ComponentProps<typeof TradingSignalsTabContent>;
type HeaderSectionProps = ComponentProps<typeof TradingHeaderSection>;
type OperationalAlertsSectionProps = ComponentProps<typeof TradingOperationalAlerts>;
type OperationalTabsSectionProps = ComponentProps<typeof TradingOperationalTabsSection>;
type StatsPrimarySectionProps = ComponentProps<typeof TradingStatsPrimaryRow>;
type StatsSecondarySectionProps = ComponentProps<typeof TradingStatsSecondaryRow>;
type TabsShellSectionProps = Omit<ComponentProps<typeof TradingTabsShell>, 'children'>;

type NewOrderDialogProps = ComponentProps<typeof TradingNewOrderDialog>;
type OcoOrderDialogProps = ComponentProps<typeof OcoOrderForm>;
type ReviewOrderDialogProps = ComponentProps<typeof TradingReviewOrderDialog>;
type RiskConfigDialogProps = ComponentProps<typeof TradingRiskConfigDialog>;
type PostmortemTrainingDialogProps = ComponentProps<typeof TradingPostmortemTrainingDialog>;
type NewSignalDialogProps = ComponentProps<typeof TradingNewSignalDialog>;
type DialogsSectionProps = ComponentProps<typeof TradingDialogsSection>;

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

type BuildTradingPrimaryTabsSectionPropsOptions = {
  accountMode: OverviewTabProps['accountMode'];
  activeAutoRunDetail: PortfolioAutoTabProps['activeAutoRunDetail'];
  activeAutoRunId: SignalsAutoTabProps['activeAutoRunId'];
  allowedModes: SignalsAutoTabProps['allowedModes'];
  autoMix: SignalsAutoTabProps['autoMix'];
  autoModeOptions: SignalsAutoTabProps['autoModeOptions'];
  autoSelectAllAssets: SignalsAutoTabProps['autoSelectAllAssets'];
  autoSelectedAssetKeys: SignalsAutoTabProps['autoSelectedAssetKeys'];
  autoSignalAssetOptions: SignalsAutoTabProps['autoSignalAssetOptions'];
  autoUniverseScope: SignalsAutoTabProps['autoUniverseScope'];
  availableSignalArbitrageAssets: SignalsTabProps['availableSignalArbitrageAssets'];
  availableSignalArbitrageExchanges: SignalsTabProps['availableSignalArbitrageExchanges'];
  bestAskPrice: OverviewTabProps['bestAskPrice'];
  bestBidPrice: OverviewTabProps['bestBidPrice'];
  canCreatePreset: SignalsTabProps['canCreatePreset'];
  canUpdatePreset: SignalsTabProps['canUpdatePreset'];
  defaultArbitrageMaxIntervalMinutes: SignalsTabProps['defaultArbitrageMaxIntervalMinutes'];
  defaultEnsembleTopN: SignalsTabProps['defaultEnsembleTopN'];
  defaultSymbol: PositionsTabProps['defaultSymbol'];
  enqueuePending: LabTabProps['enqueuePending'];
  formatDecisionSummary: PortfolioAutoTabProps['formatDecisionSummary'];
  formatDurationMinutes: SignalsTabProps['formatDurationMinutes'];
  futuresSummary: OverviewTabProps['futuresSummary'];
  hasAutoSignalAssetsError: SignalsAutoTabProps['hasAutoSignalAssetsError'];
  hasSignalArbitrage: SignalsTabProps['hasSignalArbitrage'];
  indicatorOptions: SignalsTabProps['indicatorOptions'];
  analysisIntervalOptions: AnalysisTabProps['intervalOptions'];
  isCreatePresetPending: SignalsTabProps['isCreatePresetPending'];
  isFuturesMarket: PositionsTabProps['isFuturesMarket'];
  isGeneratePending: SignalsTabProps['isGeneratePending'];
  isLoadingAccount: OverviewTabProps['isLoadingAccount'];
  isLoadingAutoSignalAssets: SignalsAutoTabProps['isLoadingAutoSignalAssets'];
  isLoadingOrders: OrdersTabProps['isLoadingOrders'];
  isLoadingPositions: PositionsTabProps['isLoadingPositions'];
  isLoadingScheduler: SignalsTabProps['isLoadingScheduler'];
  isLoadingSignals: OverviewTabProps['isLoadingSignals'];
  isManualSavePending: SignalsTabProps['isManualSavePending'];
  isSavingScheduler: SignalsTabProps['isSavingScheduler'];
  isSignalArbitrageCatalogLoading: SignalsTabProps['isSignalArbitrageCatalogLoading'];
  isSpotMarket: PositionsTabProps['isSpotMarket'];
  isSyncingOrders: OrdersTabProps['isSyncingOrders'];
  isUpdatePresetPending: SignalsTabProps['isUpdatePresetPending'];
  locale: OrdersTabProps['locale'];
  marginCrossPositions: PositionsTabProps['marginCrossPositions'];
  marginIsolatedPositions: PositionsTabProps['marginIsolatedPositions'];
  marginSummary: OverviewTabProps['marginSummary'];
  marketType: SignalsTabProps['marketType'];
  maxArbitrageAssets: SignalsTabProps['maxArbitrageAssets'];
  newsConfig: SignalsTabProps['newsConfig'];
  newsPresetDescription: SignalsTabProps['newsPresetDescription'];
  newsPresetName: SignalsTabProps['newsPresetName'];
  onAllowedModesChange: SignalsAutoTabProps['onAllowedModesChange'];
  onApplyPreset: SignalsTabProps['onApplyPreset'];
  onArbitrageAssetsChange: SignalsTabProps['onArbitrageAssetsChange'];
  onArbitrageConfigChange: SignalsTabProps['onArbitrageConfigChange'];
  onArbitrageExchangesChange: SignalsTabProps['onArbitrageExchangesChange'];
  onApproveReviewOrder: OrdersTabProps['onApproveReviewOrder'];
  onAutoMixChange: SignalsAutoTabProps['onAutoMixChange'];
  onAutoSelectAllAssetsChange: SignalsAutoTabProps['onAutoSelectAllAssetsChange'];
  onAutoSelectedAssetKeysChange: SignalsAutoTabProps['onAutoSelectedAssetKeysChange'];
  onAutoUniverseScopeChange: SignalsAutoTabProps['onAutoUniverseScopeChange'];
  onCancelOrder: OrdersTabProps['onCancelOrder'];
  onChangeNewsConfig: SignalsTabProps['onChangeNewsConfig'];
  onCreatePreset: SignalsTabProps['onCreatePreset'];
  onDeactivateSignal: OverviewTabProps['onDeactivateSignal'];
  onDeletePreset: SignalsTabProps['onDeletePreset'];
  onEnabledChange: SignalsTabProps['onEnabledChange'];
  onEnqueueTrading: LabTabProps['onEnqueueTrading'];
  onEnsembleTopNChange: SignalsTabProps['onEnsembleTopNChange'];
  onGenerateNow: SignalsTabProps['onGenerateNow'];
  onIndicatorsChange: SignalsTabProps['onIndicatorsChange'];
  onIntervalMinutesChange: SignalsTabProps['onIntervalMinutesChange'];
  onMaxSignalsPerRunChange: SignalsTabProps['onMaxSignalsPerRunChange'];
  onNewsPresetDescriptionChange: SignalsTabProps['onNewsPresetDescriptionChange'];
  onNewsPresetNameChange: SignalsTabProps['onNewsPresetNameChange'];
  onOpenGeneratedSignal: SignalsAutoTabProps['onOpenGeneratedSignal'];
  onOpenLab: PortfolioAutoTabProps['onOpenLab'];
  onOpenManualAnalysis: LabTabProps['onOpenManualAnalysis'];
  onOpenNewOrderDialog: OrdersTabProps['onOpenNewOrderDialog'];
  onOpenNewSignalDialog: OverviewTabProps['onOpenNewSignalDialog'];
  onOpenOcoOrderDialog: OrdersTabProps['onOpenOcoOrderDialog'];
  onOpenReviewDialog: OrdersTabProps['onOpenReviewDialog'];
  onOpenReviewDialogById: OverviewTabProps['onOpenReviewDialog'];
  onOpenSignalsPanel: SignalsAutoTabProps['onOpenSignalsPanel'];
  onPrefillSellOrderFromAsset: PositionsTabProps['onPrefillSellOrderFromAsset'];
  onQuickOrder: OverviewTabProps['onQuickOrder'];
  onRefreshPositions: PositionsTabProps['onRefreshPositions'];
  onRejectReviewOrder: OrdersTabProps['onRejectReviewOrder'];
  onRunAutoNow: SignalsAutoTabProps['onRunAutoNow'];
  onRunPipeline: PortfolioAutoTabProps['onRunPipeline'];
  onSaveProfile: SignalsTabProps['onSaveProfile'];
  onSaveScheduler: SignalsTabProps['onSaveScheduler'];
  onSelectAutoRun: SignalsAutoTabProps['onSelectAutoRun'];
  onSelectPresetId: SignalsTabProps['onSelectPresetId'];
  onSelectSignal: SignalsTabProps['onSelectSignal'];
  onSelectedPortfolioChange: PortfolioAutoTabProps['onSelectedPortfolioChange'];
  onSourcesChange: SignalsTabProps['onSourcesChange'];
  onSymbolsChange: SignalsTabProps['onSymbolsChange'];
  onSyncOrders: OrdersTabProps['onSyncOrders'];
  onTechniquesChange: SignalsTabProps['onTechniquesChange'];
  onTimeframesChange: SignalsTabProps['onTimeframesChange'];
  onUpdatePreset: SignalsTabProps['onUpdatePreset'];
  openFuturesPositions: PositionsTabProps['openFuturesPositions'];
  orders: OrdersTabProps['orders'];
  positionLiveQuotes: PositionsTabProps['positionLiveQuotes'];
  presets: SignalsTabProps['presets'];
  renderOrderStatusBadge: OrdersTabProps['renderOrderStatusBadge'];
  renderSignalTypeBadge: OverviewTabProps['renderSignalTypeBadge'];
  schedulerConfig: SignalsTabProps['schedulerConfig'];
  schedulerForm: SignalsTabProps['schedulerForm'];
  schedulerHasError: SignalsTabProps['schedulerHasError'];
  showArbitrageError: SignalsTabProps['showArbitrageError'];
  selectedInterval: AnalysisTabProps['selectedInterval'];
  selectedMarginMode: AnalysisTabProps['selectedMarginMode'];
  selectedMarketType: AnalysisTabProps['selectedMarketType'];
  selectedPortfolioId: PortfolioAutoTabProps['selectedPortfolioId'];
  selectedPresetId: SignalsTabProps['selectedPresetId'];
  selectedSignal: SignalsTabProps['selectedSignal'];
  selectedSignalId: SignalsTabProps['selectedSignalId'];
  selectedSignalSources: SignalsTabProps['selectedSignalSources'];
  selectedSymbol: AnalysisTabProps['selectedSymbol'];
  signalAutoRunPending: SignalsAutoTabProps['signalAutoRunPending'];
  signalAutoRuns: SignalsAutoTabProps['signalAutoRuns'];
  signalIntervalOptions: SignalsTabProps['intervalOptions'];
  signalProfileForm: SignalsTabProps['signalProfileForm'];
  signalProfileInvalid: SignalsTabProps['signalProfileInvalid'];
  signals: SignalsTabProps['signals'];
  sourceOptions: SignalsTabProps['sourceOptions'];
  spotPositions: PositionsTabProps['spotPositions'];
  spotSummary: OverviewTabProps['spotSummary'];
  t: AnalysisTabProps['t'];
  techniqueOptions: SignalsTabProps['techniqueOptions'];
  timeZone: OrdersTabProps['timeZone'];
  topTradingCandidates: SignalsAutoTabProps['topTradingCandidates'];
  tradingEnabled: OrdersTabProps['tradingEnabled'];
  tradingExecutionReports: PortfolioAutoTabProps['tradingExecutionReports'];
  tradingJobStatus: PortfolioAutoTabProps['tradingJobStatus'];
  tradingPortfolios: PortfolioAutoTabProps['tradingPortfolios'];
  tradingRebalances: PortfolioAutoTabProps['tradingRebalances'];
  validationErrorMessage: SignalsTabProps['validationErrorMessage'];
};

export function buildTradingPrimaryTabsSectionProps({
  accountMode,
  activeAutoRunDetail,
  activeAutoRunId,
  allowedModes,
  autoMix,
  autoModeOptions,
  autoSelectAllAssets,
  autoSelectedAssetKeys,
  autoSignalAssetOptions,
  autoUniverseScope,
  availableSignalArbitrageAssets,
  availableSignalArbitrageExchanges,
  bestAskPrice,
  bestBidPrice,
  canCreatePreset,
  canUpdatePreset,
  defaultArbitrageMaxIntervalMinutes,
  defaultEnsembleTopN,
  defaultSymbol,
  enqueuePending,
  formatDecisionSummary,
  formatDurationMinutes,
  futuresSummary,
  hasAutoSignalAssetsError,
  hasSignalArbitrage,
  indicatorOptions,
  analysisIntervalOptions,
  isCreatePresetPending,
  isFuturesMarket,
  isGeneratePending,
  isLoadingAccount,
  isLoadingAutoSignalAssets,
  isLoadingOrders,
  isLoadingPositions,
  isLoadingScheduler,
  isLoadingSignals,
  isManualSavePending,
  isSavingScheduler,
  isSignalArbitrageCatalogLoading,
  isSpotMarket,
  isSyncingOrders,
  isUpdatePresetPending,
  locale,
  marginCrossPositions,
  marginIsolatedPositions,
  marginSummary,
  marketType,
  maxArbitrageAssets,
  newsConfig,
  newsPresetDescription,
  newsPresetName,
  onAllowedModesChange,
  onApplyPreset,
  onArbitrageAssetsChange,
  onArbitrageConfigChange,
  onArbitrageExchangesChange,
  onApproveReviewOrder,
  onAutoMixChange,
  onAutoSelectAllAssetsChange,
  onAutoSelectedAssetKeysChange,
  onAutoUniverseScopeChange,
  onCancelOrder,
  onChangeNewsConfig,
  onCreatePreset,
  onDeactivateSignal,
  onDeletePreset,
  onEnabledChange,
  onEnqueueTrading,
  onEnsembleTopNChange,
  onGenerateNow,
  onIndicatorsChange,
  onIntervalMinutesChange,
  onMaxSignalsPerRunChange,
  onNewsPresetDescriptionChange,
  onNewsPresetNameChange,
  onOpenGeneratedSignal,
  onOpenLab,
  onOpenManualAnalysis,
  onOpenNewOrderDialog,
  onOpenNewSignalDialog,
  onOpenOcoOrderDialog,
  onOpenReviewDialog,
  onOpenReviewDialogById,
  onOpenSignalsPanel,
  onPrefillSellOrderFromAsset,
  onQuickOrder,
  onRefreshPositions,
  onRejectReviewOrder,
  onRunAutoNow,
  onRunPipeline,
  onSaveProfile,
  onSaveScheduler,
  onSelectAutoRun,
  onSelectPresetId,
  onSelectSignal,
  onSelectedPortfolioChange,
  onSourcesChange,
  onSymbolsChange,
  onSyncOrders,
  onTechniquesChange,
  onTimeframesChange,
  onUpdatePreset,
  openFuturesPositions,
  orders,
  positionLiveQuotes,
  presets,
  renderOrderStatusBadge,
  renderSignalTypeBadge,
  schedulerConfig,
  schedulerForm,
  schedulerHasError,
  showArbitrageError,
  selectedInterval,
  selectedMarginMode,
  selectedMarketType,
  selectedPortfolioId,
  selectedPresetId,
  selectedSignal,
  selectedSignalId,
  selectedSignalSources,
  selectedSymbol,
  signalAutoRunPending,
  signalAutoRuns,
  signalIntervalOptions,
  signalProfileForm,
  signalProfileInvalid,
  signals,
  sourceOptions,
  spotPositions,
  spotSummary,
  t,
  techniqueOptions,
  timeZone,
  topTradingCandidates,
  tradingEnabled,
  tradingExecutionReports,
  tradingJobStatus,
  tradingPortfolios,
  tradingRebalances,
  validationErrorMessage,
}: BuildTradingPrimaryTabsSectionPropsOptions): { primaryTabsSectionProps: PrimaryTabsSectionProps } {
  const analysisTabProps: AnalysisTabProps = {
    intervalOptions: analysisIntervalOptions,
    selectedInterval,
    selectedMarginMode,
    selectedMarketType,
    selectedSymbol,
    t,
  };
  const labTabProps: LabTabProps = {
    enqueuePending,
    onEnqueueTrading,
    onOpenManualAnalysis,
  };
  const ordersTabProps: OrdersTabProps = {
    isLoadingOrders,
    isSyncingOrders,
    locale,
    onApproveReviewOrder,
    onCancelOrder,
    onOpenNewOrderDialog,
    onOpenOcoOrderDialog,
    onOpenReviewDialog,
    onRejectReviewOrder,
    onSyncOrders,
    orders,
    renderOrderStatusBadge,
    t,
    timeZone,
    tradingEnabled,
  };
  const overviewTabProps: OverviewTabProps = {
    accountMode,
    bestAskPrice,
    bestBidPrice,
    futuresSummary,
    isLoadingAccount,
    isLoadingOrders,
    isLoadingSignals,
    isSyncingOrders,
    locale,
    marginSummary,
    onApproveReviewOrder,
    onCancelOrder,
    onDeactivateSignal,
    onOpenNewOrderDialog,
    onOpenNewSignalDialog,
    onOpenReviewDialog: onOpenReviewDialogById,
    onQuickOrder,
    onRejectReviewOrder,
    onSyncOrders,
    orders,
    renderOrderStatusBadge,
    renderSignalTypeBadge,
    signals,
    spotSummary,
    t,
    tradingEnabled,
  };
  const portfolioAutoTabProps: PortfolioAutoTabProps = {
    activeAutoRunDetail,
    enqueuePending,
    formatDecisionSummary,
    locale,
    onEnqueueTrading,
    onOpenLab,
    onRunPipeline,
    onSelectedPortfolioChange,
    selectedPortfolioId,
    timeZone,
    topTradingCandidates,
    tradingExecutionReports,
    tradingJobStatus,
    tradingPortfolios,
    tradingRebalances,
  };
  const positionsTabProps: PositionsTabProps = {
    defaultSymbol,
    isFuturesMarket,
    isLoadingPositions,
    isSpotMarket,
    locale,
    marginCrossPositions,
    marginIsolatedPositions,
    onPrefillSellOrderFromAsset,
    onRefreshPositions,
    openFuturesPositions,
    positionLiveQuotes,
    selectedMarketType,
    selectedSymbol,
    spotPositions,
    t,
  };
  const signalsAutoTabProps: SignalsAutoTabProps = {
    activeAutoRunDetail,
    activeAutoRunId,
    allowedModes,
    autoMix,
    autoModeOptions,
    autoSelectAllAssets,
    autoSelectedAssetKeys,
    autoSignalAssetOptions,
    autoUniverseScope,
    formatDecisionSummary,
    hasAutoSignalAssetsError,
    isLoadingAutoSignalAssets,
    locale,
    onAllowedModesChange,
    onAutoMixChange,
    onAutoSelectAllAssetsChange,
    onAutoSelectedAssetKeysChange,
    onAutoUniverseScopeChange,
    onOpenGeneratedSignal,
    onOpenSignalsPanel,
    onRunAutoNow,
    onSelectAutoRun,
    signalAutoRunPending,
    signalAutoRuns,
    signals,
    timeZone,
    topTradingCandidates,
  };
  const signalsTabProps: SignalsTabProps = {
    availableSignalArbitrageAssets,
    availableSignalArbitrageExchanges,
    canCreatePreset,
    canUpdatePreset,
    defaultArbitrageMaxIntervalMinutes,
    defaultEnsembleTopN,
    formatDurationMinutes,
    hasSignalArbitrage,
    indicatorOptions,
    intervalOptions: signalIntervalOptions,
    isCreatePresetPending,
    isGeneratePending,
    isLoadingScheduler,
    isLoadingSignals,
    isManualSavePending,
    isSavingScheduler,
    isSignalArbitrageCatalogLoading,
    isUpdatePresetPending,
    locale,
    marketType,
    maxArbitrageAssets,
    newsConfig,
    newsPresetDescription,
    newsPresetName,
    onApplyPreset,
    onArbitrageAssetsChange,
    onArbitrageConfigChange,
    onArbitrageExchangesChange,
    onChangeNewsConfig,
    onCreatePreset,
    onDeactivateSignal,
    onDeletePreset,
    onEnabledChange,
    onEnsembleTopNChange,
    onGenerateNow,
    onIndicatorsChange,
    onIntervalMinutesChange,
    onMaxSignalsPerRunChange,
    onNewsPresetDescriptionChange,
    onNewsPresetNameChange,
    onOpenNewSignalDialog,
    onSaveProfile,
    onSaveScheduler,
    onSelectPresetId,
    onSelectSignal,
    onSourcesChange,
    onSymbolsChange,
    onTechniquesChange,
    onTimeframesChange,
    onUpdatePreset,
    presets,
    schedulerConfig,
    schedulerForm,
    schedulerHasError,
    selectedPresetId,
    selectedSignal,
    selectedSignalId,
    selectedSignalSources,
    showArbitrageError,
    signalProfileForm,
    signalProfileInvalid,
    signals,
    sourceOptions,
    t,
    techniqueOptions,
    timeZone,
    validationErrorMessage,
    renderSignalTypeBadge,
  };

  return {
    primaryTabsSectionProps: {
      analysisTabProps,
      labTabProps,
      ordersTabProps,
      overviewTabProps,
      portfolioAutoTabProps,
      positionsTabProps,
      signalsAutoTabProps,
      signalsTabProps,
    },
  };
}

type BuildTradingOperationalTabsSectionPropsOptions = {
  allOrderHistorySelected: HistoryTabProps['allOrderHistorySelected'];
  circuitBreakerOpen: ControlTabProps['circuitBreakerOpen'];
  controlHistory: ControlTabProps['controlHistory'];
  controlMode: ControlTabProps['controlMode'];
  currentPrice: OrderBookTabProps['currentPrice'];
  defaultFuturesSymbol: AccountTabProps['defaultFuturesSymbol'];
  deleteOrderHistoryPending: HistoryTabProps['deleteOrderHistoryPending'];
  hasOrderHistorySelection: HistoryTabProps['hasOrderHistorySelection'];
  intervalOptions: ChartTabProps['intervalOptions'];
  isAdminRole: HistoryTabProps['isAdminRole'];
  isLoadingControlHistory: ControlTabProps['isLoadingControlHistory'];
  isLoadingKlines: ChartTabProps['isLoadingKlines'];
  isLoadingOrderBook: OrderBookTabProps['isLoadingOrderBook'];
  isLoadingPostmortems: PostMortemsTabProps['isLoadingPostmortems'];
  klines: ChartTabProps['klines'];
  locale: HistoryTabProps['locale'];
  onDeleteAllMine: HistoryTabProps['onDeleteAllMine'];
  onDeleteAllTenant: HistoryTabProps['onDeleteAllTenant'];
  onFetchOrderHistory: HistoryTabProps['onFetchOrderHistory'];
  onModeChange: ControlTabProps['onModeChange'];
  onOpenSendToTraining: PostMortemsTabProps['onOpenSendToTraining'];
  onRefreshAccount: AccountTabProps['onRefreshAccount'];
  onRefreshKlines: ChartTabProps['onRefresh'];
  onRefreshPostmortems: PostMortemsTabProps['onRefreshPostmortems'];
  onToggleOrderHistorySelectAll: HistoryTabProps['onToggleOrderHistorySelectAll'];
  onToggleOrderHistorySelection: HistoryTabProps['onToggleOrderHistorySelection'];
  onTradingToggle: ControlTabProps['onTradingToggle'];
  onDeleteSelected: HistoryTabProps['onDeleteSelected'];
  onSymbolChange: ChartTabProps['onSymbolChange'];
  onIntervalChange: ChartTabProps['onIntervalChange'];
  orderBookData: OrderBookTabProps['orderBookData'];
  orderBookDepth: OrderBookTabProps['orderBookDepth'];
  orderBookPrecision: OrderBookTabProps['orderBookPrecision'];
  orderHistoryHasMore: HistoryTabProps['orderHistoryHasMore'];
  orderHistoryItems: HistoryTabProps['orderHistoryItems'];
  orderHistoryLoading: HistoryTabProps['orderHistoryLoading'];
  orderHistorySelectedIds: HistoryTabProps['orderHistorySelectedIds'];
  postmortemIdsSentToTraining: PostMortemsTabProps['postmortemIdsSentToTraining'];
  postmortems: PostMortemsTabProps['postmortems'];
  renderOrderStatusBadge: HistoryTabProps['renderOrderStatusBadge'];
  selectedInterval: ChartTabProps['selectedInterval'];
  selectedSymbol: ChartTabProps['selectedSymbol'];
  sendPostMortemToTrainingPending: PostMortemsTabProps['sendPostMortemToTrainingPending'];
  symbolOptions: ChartTabProps['symbolOptions'];
  t: HistoryTabProps['t'];
  timeZone: HistoryTabProps['timeZone'];
  tradingEnabled: ControlTabProps['tradingEnabled'];
};

export function buildTradingOperationalTabsSectionProps({
  allOrderHistorySelected,
  circuitBreakerOpen,
  controlHistory,
  controlMode,
  currentPrice,
  defaultFuturesSymbol,
  deleteOrderHistoryPending,
  hasOrderHistorySelection,
  intervalOptions,
  isAdminRole,
  isLoadingControlHistory,
  isLoadingKlines,
  isLoadingOrderBook,
  isLoadingPostmortems,
  klines,
  locale,
  onDeleteAllMine,
  onDeleteAllTenant,
  onDeleteSelected,
  onFetchOrderHistory,
  onIntervalChange,
  onModeChange,
  onOpenSendToTraining,
  onRefreshAccount,
  onRefreshKlines,
  onRefreshPostmortems,
  onSymbolChange,
  onToggleOrderHistorySelectAll,
  onToggleOrderHistorySelection,
  onTradingToggle,
  orderBookData,
  orderBookDepth,
  orderBookPrecision,
  orderHistoryHasMore,
  orderHistoryItems,
  orderHistoryLoading,
  orderHistorySelectedIds,
  postmortemIdsSentToTraining,
  postmortems,
  renderOrderStatusBadge,
  selectedInterval,
  selectedSymbol,
  sendPostMortemToTrainingPending,
  symbolOptions,
  t,
  timeZone,
  tradingEnabled,
}: BuildTradingOperationalTabsSectionPropsOptions): { operationalTabsSectionProps: OperationalTabsSectionProps } {
  const accountTabProps: AccountTabProps = {
    defaultFuturesSymbol,
    onRefreshAccount,
  };
  const chartTabProps: ChartTabProps = {
    currentPrice,
    intervalOptions,
    isLoadingKlines,
    klines,
    locale,
    onIntervalChange,
    onRefresh: onRefreshKlines,
    onSymbolChange,
    selectedInterval,
    selectedSymbol,
    symbolOptions,
    timeZone,
  };
  const controlTabProps: ControlTabProps = {
    circuitBreakerOpen,
    controlMode,
    controlHistory,
    isLoadingControlHistory,
    onModeChange,
    onTradingToggle,
    tradingEnabled,
  };
  const historyTabProps: HistoryTabProps = {
    allOrderHistorySelected,
    deleteOrderHistoryPending,
    hasOrderHistorySelection,
    isAdminRole,
    locale,
    onDeleteAllMine,
    onDeleteAllTenant,
    onDeleteSelected,
    onFetchOrderHistory,
    onToggleOrderHistorySelectAll,
    onToggleOrderHistorySelection,
    orderHistoryHasMore,
    orderHistoryItems,
    orderHistoryLoading,
    orderHistorySelectedIds,
    renderOrderStatusBadge,
    t,
    timeZone,
  };
  const orderBookTabProps: OrderBookTabProps = {
    currentPrice,
    isLoadingOrderBook,
    locale,
    orderBookData,
    orderBookDepth,
    orderBookPrecision,
    selectedSymbol,
  };
  const postMortemsTabProps: PostMortemsTabProps = {
    isLoadingPostmortems,
    locale,
    onOpenSendToTraining,
    onRefreshPostmortems,
    postmortemIdsSentToTraining,
    postmortems,
    sendPostMortemToTrainingPending,
    t,
    timeZone,
  };

  return {
    operationalTabsSectionProps: {
      accountTabProps,
      chartTabProps,
      controlTabProps,
      historyTabProps,
      orderBookTabProps,
      postMortemsTabProps,
    },
  };
}

type BuildTradingDialogsSectionPropsOptions = {
  availableNamespaces: PostmortemTrainingDialogProps['availableNamespaces'];
  canSubmitPostmortemTraining: PostmortemTrainingDialogProps['canSubmit'];
  canSubmitOrder: NewOrderDialogProps['canSubmitOrder'];
  currentPrice: NewOrderDialogProps['currentPrice'];
  defaultSymbol: NewOrderDialogProps['defaultSymbol'];
  highPrice: NewOrderDialogProps['highPrice'];
  isFuturesMarket: NewOrderDialogProps['isFuturesMarket'];
  isSubmittingNewOrder: NewOrderDialogProps['isSubmitting'];
  isSubmittingNewSignal: NewSignalDialogProps['isSubmitting'];
  isSubmittingPostmortemTraining: PostmortemTrainingDialogProps['isSubmitting'];
  isSubmittingRiskConfig: RiskConfigDialogProps['isSubmitting'];
  isApprovingReviewOrder: ReviewOrderDialogProps['isApproving'];
  isUpdatingReviewOrder: ReviewOrderDialogProps['isUpdating'];
  locale: NewOrderDialogProps['locale'];
  lowPrice: NewOrderDialogProps['lowPrice'];
  marginMode: OcoOrderDialogProps['marginMode'];
  marketType: OcoOrderDialogProps['marketType'];
  onCancelNewOrder: NewOrderDialogProps['onCancel'];
  onCancelPostmortemTraining: PostmortemTrainingDialogProps['onCancel'];
  onCancelRiskConfig: RiskConfigDialogProps['onCancel'];
  onCloseReviewOrder: ReviewOrderDialogProps['onClose'];
  onApproveAndExecuteReviewOrder: ReviewOrderDialogProps['onApproveAndExecute'];
  onConfidenceChange: NewSignalDialogProps['onConfidenceChange'];
  onNamespaceChange: PostmortemTrainingDialogProps['onNamespaceChange'];
  onOpenChangeNewOrder: NewOrderDialogProps['onOpenChange'];
  onOpenChangeNewSignal: NewSignalDialogProps['onOpenChange'];
  onOpenChangeOco: OcoOrderDialogProps['onOpenChange'];
  onOpenChangePostmortemTraining: PostmortemTrainingDialogProps['onOpenChange'];
  onOpenChangeReviewOrder: ReviewOrderDialogProps['onOpenChange'];
  onOpenChangeRiskConfig: RiskConfigDialogProps['onOpenChange'];
  onPatchOrderForm: NewOrderDialogProps['onPatchOrderForm'];
  onPatchRiskForm: RiskConfigDialogProps['onPatchForm'];
  onReasoningChange: NewSignalDialogProps['onReasoningChange'];
  onSaveAdjustmentsReviewOrder: ReviewOrderDialogProps['onSaveAdjustments'];
  onSignalTypeChange: NewSignalDialogProps['onSignalTypeChange'];
  onSizeChangeNewOrder: NewOrderDialogProps['onSizeChange'];
  onSubmitNewOrder: NewOrderDialogProps['onSubmit'];
  onSubmitNewSignal: NewSignalDialogProps['onSubmit'];
  onSubmitPostmortemTraining: PostmortemTrainingDialogProps['onSubmit'];
  onSubmitRiskConfig: RiskConfigDialogProps['onSubmit'];
  onUpdateFieldReviewOrder: ReviewOrderDialogProps['onUpdateField'];
  onUsdtChangeNewOrder: NewOrderDialogProps['onUsdtChange'];
  openNewOrderDialog: NewOrderDialogProps['open'];
  openNewSignalDialog: NewSignalDialogProps['open'];
  openOcoOrderDialog: OcoOrderDialogProps['open'];
  openPostmortemTrainingDialog: PostmortemTrainingDialogProps['open'];
  openReviewOrderDialog: ReviewOrderDialogProps['open'];
  openRiskConfigDialog: RiskConfigDialogProps['open'];
  orderEffectivePrice: NewOrderDialogProps['orderEffectivePrice'];
  orderForm: NewOrderDialogProps['orderForm'];
  orderLeverageValue: NewOrderDialogProps['orderLeverageValue'];
  orderStopLossEstimate: NewOrderDialogProps['orderStopLossEstimate'];
  orderStopLossValue: NewOrderDialogProps['orderStopLossValue'];
  orderTakeProfitEstimate: NewOrderDialogProps['orderTakeProfitEstimate'];
  orderTakeProfitValue: NewOrderDialogProps['orderTakeProfitValue'];
  priceChange: NewOrderDialogProps['priceChange'];
  priceChangePercent: NewOrderDialogProps['priceChangePercent'];
  reviewOrderForm: ReviewOrderDialogProps['form'];
  reviewOrderHasTarget: ReviewOrderDialogProps['hasTarget'];
  riskForm: RiskConfigDialogProps['riskForm'];
  riskMaxLeverage: NewOrderDialogProps['riskMaxLeverage'];
  selectedMarketType: NewOrderDialogProps['selectedMarketType'];
  selectedNamespaceId: PostmortemTrainingDialogProps['selectedNamespaceId'];
  selectedSymbol: NewOrderDialogProps['selectedSymbol'];
  signalForm: NewSignalDialogProps['signalForm'];
  signalTypeOptions: NewSignalDialogProps['signalTypeOptions'];
  symbolForOcoDialog: OcoOrderDialogProps['symbol'];
  symbolOptions: RiskConfigDialogProps['symbolOptions'];
  t: NewOrderDialogProps['t'];
  volumeOf24h: NewOrderDialogProps['volumeOf24h'];
  wsEnabled: NewOrderDialogProps['wsEnabled'];
};

export function buildTradingDialogsSectionProps({
  availableNamespaces,
  canSubmitPostmortemTraining,
  canSubmitOrder,
  currentPrice,
  defaultSymbol,
  highPrice,
  isApprovingReviewOrder,
  isFuturesMarket,
  isSubmittingNewOrder,
  isSubmittingNewSignal,
  isSubmittingPostmortemTraining,
  isSubmittingRiskConfig,
  isUpdatingReviewOrder,
  locale,
  lowPrice,
  marginMode,
  marketType,
  onCancelNewOrder,
  onCancelPostmortemTraining,
  onCancelRiskConfig,
  onCloseReviewOrder,
  onApproveAndExecuteReviewOrder,
  onConfidenceChange,
  onNamespaceChange,
  onOpenChangeNewOrder,
  onOpenChangeNewSignal,
  onOpenChangeOco,
  onOpenChangePostmortemTraining,
  onOpenChangeReviewOrder,
  onOpenChangeRiskConfig,
  onPatchOrderForm,
  onPatchRiskForm,
  onReasoningChange,
  onSaveAdjustmentsReviewOrder,
  onSignalTypeChange,
  onSizeChangeNewOrder,
  onSubmitNewOrder,
  onSubmitNewSignal,
  onSubmitPostmortemTraining,
  onSubmitRiskConfig,
  onUpdateFieldReviewOrder,
  onUsdtChangeNewOrder,
  openNewOrderDialog,
  openNewSignalDialog,
  openOcoOrderDialog,
  openPostmortemTrainingDialog,
  openReviewOrderDialog,
  openRiskConfigDialog,
  orderEffectivePrice,
  orderForm,
  orderLeverageValue,
  orderStopLossEstimate,
  orderStopLossValue,
  orderTakeProfitEstimate,
  orderTakeProfitValue,
  priceChange,
  priceChangePercent,
  reviewOrderForm,
  reviewOrderHasTarget,
  riskForm,
  riskMaxLeverage,
  selectedMarketType,
  selectedNamespaceId,
  selectedSymbol,
  signalForm,
  signalTypeOptions,
  symbolForOcoDialog,
  symbolOptions,
  t,
  volumeOf24h,
  wsEnabled,
}: BuildTradingDialogsSectionPropsOptions): { dialogsSectionProps: DialogsSectionProps } {
  const newOrderDialogProps: NewOrderDialogProps = {
    canSubmitOrder,
    currentPrice,
    defaultSymbol,
    highPrice,
    isFuturesMarket,
    isSubmitting: isSubmittingNewOrder,
    locale,
    lowPrice,
    onCancel: onCancelNewOrder,
    onOpenChange: onOpenChangeNewOrder,
    onPatchOrderForm,
    onSizeChange: onSizeChangeNewOrder,
    onSubmit: onSubmitNewOrder,
    onUsdtChange: onUsdtChangeNewOrder,
    open: openNewOrderDialog,
    orderEffectivePrice,
    orderForm,
    orderLeverageValue,
    orderStopLossEstimate,
    orderStopLossValue,
    orderTakeProfitEstimate,
    orderTakeProfitValue,
    priceChange,
    priceChangePercent,
    riskMaxLeverage,
    selectedMarketType,
    selectedSymbol,
    t,
    volumeOf24h,
    wsEnabled,
  };
  const ocoOrderDialogProps: OcoOrderDialogProps = {
    currentPrice,
    marginMode,
    marketType,
    onOpenChange: onOpenChangeOco,
    open: openOcoOrderDialog,
    symbol: symbolForOcoDialog,
  };
  const reviewOrderDialogProps: ReviewOrderDialogProps = {
    form: reviewOrderForm,
    hasTarget: reviewOrderHasTarget,
    isApproving: isApprovingReviewOrder,
    isUpdating: isUpdatingReviewOrder,
    onApproveAndExecute: onApproveAndExecuteReviewOrder,
    onClose: onCloseReviewOrder,
    onOpenChange: onOpenChangeReviewOrder,
    onSaveAdjustments: onSaveAdjustmentsReviewOrder,
    onUpdateField: onUpdateFieldReviewOrder,
    open: openReviewOrderDialog,
  };
  const riskConfigDialogProps: RiskConfigDialogProps = {
    isSubmitting: isSubmittingRiskConfig,
    onCancel: onCancelRiskConfig,
    onOpenChange: onOpenChangeRiskConfig,
    onPatchForm: onPatchRiskForm,
    onSubmit: onSubmitRiskConfig,
    open: openRiskConfigDialog,
    riskForm,
    symbolOptions,
    t,
  };
  const postmortemTrainingDialogProps: PostmortemTrainingDialogProps = {
    availableNamespaces,
    canSubmit: canSubmitPostmortemTraining,
    isSubmitting: isSubmittingPostmortemTraining,
    onCancel: onCancelPostmortemTraining,
    onNamespaceChange,
    onOpenChange: onOpenChangePostmortemTraining,
    onSubmit: onSubmitPostmortemTraining,
    open: openPostmortemTrainingDialog,
    selectedNamespaceId,
    t,
  };
  const newSignalDialogProps: NewSignalDialogProps = {
    isSubmitting: isSubmittingNewSignal,
    onConfidenceChange,
    onOpenChange: onOpenChangeNewSignal,
    onReasoningChange,
    onSignalTypeChange,
    onSubmit: onSubmitNewSignal,
    open: openNewSignalDialog,
    signalForm,
    signalTypeOptions,
    t,
  };

  return {
    dialogsSectionProps: {
      newOrderDialogProps,
      newSignalDialogProps,
      ocoOrderDialogProps,
      postmortemTrainingDialogProps,
      reviewOrderDialogProps,
      riskConfigDialogProps,
    },
  };
}
