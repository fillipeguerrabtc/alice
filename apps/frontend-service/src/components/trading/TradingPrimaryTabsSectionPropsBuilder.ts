import type {
  AnalysisTabProps,
  LabTabProps,
  OrdersTabProps,
  OverviewTabProps,
  PortfolioAutoTabProps,
  PositionsTabProps,
  PrimaryTabsSectionProps,
  SignalsAutoTabProps,
  SignalsTabProps,
} from './TradingSectionPropsBuilderTypes';

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
  canOverrideReasoningMode: SignalsTabProps['canOverrideReasoningMode'];
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
  onReasoningModeChange: SignalsTabProps['onReasoningModeChange'];
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
  reasoningMode: SignalsTabProps['reasoningMode'];
  reasoningModeOptions: SignalsTabProps['reasoningModeOptions'];
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
  canOverrideReasoningMode,
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
  onReasoningModeChange,
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
  reasoningMode,
  reasoningModeOptions,
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
    canOverrideReasoningMode,
    formatDecisionSummary,
    hasAutoSignalAssetsError,
    isLoadingAutoSignalAssets,
    locale,
    onAllowedModesChange,
    onAutoMixChange,
    onAutoSelectAllAssetsChange,
    onAutoSelectedAssetKeysChange,
    onAutoUniverseScopeChange,
    onReasoningModeChange,
    onOpenGeneratedSignal,
    onOpenSignalsPanel,
    onRunAutoNow,
    onSelectAutoRun,
    reasoningMode,
    reasoningModeOptions,
    signalAutoRunPending,
    signalAutoRuns,
    signals,
    t,
    timeZone,
    topTradingCandidates,
  };
  const signalsTabProps: SignalsTabProps = {
    availableSignalArbitrageAssets,
    availableSignalArbitrageExchanges,
    canCreatePreset,
    canOverrideReasoningMode,
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
    reasoningMode,
    reasoningModeOptions,
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
    onReasoningModeChange,
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
