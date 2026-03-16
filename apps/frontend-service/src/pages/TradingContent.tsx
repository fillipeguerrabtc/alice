import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/use-auth';
import { TIMEZONE } from '@/lib/i18n';
import { isManualReasoningMode, type ReasoningMode } from '@/lib/reasoning-mode';
import { ErrorBoundary } from '@/components/error-boundary';
import { useToast } from '@/hooks/use-toast';
import { useKucoinWebSocket } from '@/hooks/useKucoinWebSocket';
import { isTradingWorkspaceV2Enabled } from '@/components/trading-v2';
import {
  SIGNAL_TYPES,
  formatDecisionSummary,
  containerVariants,
  formatDurationMinutes,
  AUTO_SIGNAL_ALL_MODES,
  DEFAULT_ENSEMBLE_CONFIG,
  DEFAULT_ARBITRAGE_CONFIG,
  FALLBACK_INTERVAL_MINUTES,
  MAX_ARBITRAGE_ASSETS,
  AUTO_SAVE_DEBOUNCE_MS,
  useTradingLocalState,
  useTradingNavigationPresentation,
  useTradingRealtimeConnectionState,
  useTradingRealtimeEventHandlers,
  useTradingFuturesQuoteSubscription,
  useTradingDerivedPayloadState,
  useTradingSchedulerFormSync,
  useTradingOperationalPresentationWrappers,
  useTradingKlineInvalidation,
  useTradingSignalProfileState,
  useTradingSignalPresentationState,
  useTradingSymbolCandidateViewState,
  useTradingMarketOrderBookState,
  useTradingKlineSeriesState,
  useTradingBootstrapStateSync,
  useTradingRiskReviewState,
  useTradingOrderSizing,
  useTradingNewsPresets,
  useTradingOrderHistory,
  useTradingControlOrderActionSuite,
  useTradingMarketAccountQueries,
  useTradingMarketRealtimeQueries,
  useTradingProfilePostmortemMutations,
  useTradingPipelineActions,
  useTradingSignalMutations,
  useTradingSymbolPreferences,
  useTradingCompositeActionHandlers,
  useTradingPostmortemTrainingQueries,
  useTradingSignalProfileAutoSave,
  useTradingSignalSchedulerQueries,
  useTradingAccountPositionState,
  buildTradingPageSectionProps,
  useTradingOperationalQueries,
  useTradingSetupQueries,
  useTradingSymbolAssetQueries,
  useTradingWorkspaceNavigation,
  buildTradingOrderSummary,
  resolveTradingPriceChange,
  TradingPageSections,
  TradingDialogsSection,
  resolveTradingStatusGate,
  isFuturesPositionArray,
} from '@/components/trading';
import { TradingV2WorkspaceView } from './TradingV2WorkspaceView';
import { useTradingTerminalAutoRunTelemetry } from './useTradingTerminalAutoRunTelemetry';

const STATUS_REFETCH_INTERVAL = 30_000;
const SYMBOLS_REFETCH_INTERVAL = 600_000;
const SIGNALS_REFETCH_INTERVAL = 30_000;
const ACCOUNT_REFETCH_INTERVAL = 20_000;
const AUTO_RUNS_REFETCH_INTERVAL = 15_000;
const DEFAULT_INTERVAL = '5m';
export function TradingContent() {
  const { t } = useTranslation();
  const { user, csrfReady } = useAuth();
  const locale = user?.idioma ?? 'pt-BR';
  const timeZone = user?.timezone ?? TIMEZONE;
  const userRoles = user?.roles ?? (user?.role ? [user.role] : []);
  const isAdminRole = userRoles.includes('admin') || userRoles.includes('super_admin');
  const { toast } = useToast();
  const emittedTerminalAutoRunsRef = useRef<Set<string>>(new Set());
  const {
    activeTab,
    activeWorkspace,
    handleTabChange,
    handleWorkspaceChange,
    setActiveTab,
  } = useTradingWorkspaceNavigation();
  const {
    activeAutoRunId,
    allowedModes,
    autoMix,
    autoSaveSignalContextRef,
    autoSaveSignalEnabledRef,
    autoSaveSignalLastPayloadRef,
    autoSaveSignalTimerRef,
    autoSelectAllAssets,
    autoSelectedAssetKeys,
    autoUniverseScope,
    controlMode,
    isManualSignalSavePending,
    marketDefaultsInitialized,
    orderForm,
    positionLiveQuotes,
    reviewOrderForm,
    reviewOrderTarget,
    riskForm,
    schedulerForm,
    selectedInterval,
    selectedMarginMode,
    selectedMarketType,
    selectedPortfolioAutoId,
    selectedPostmortemForTraining,
    signalReasoningMode,
    selectedSignalId,
    selectedSignalNewsPresetId,
    selectedSymbol,
    selectedTrainingNamespaceId,
    setActiveAutoRunId,
    setAllowedModes,
    setAutoMix,
    setAutoSelectAllAssets,
    setAutoSelectedAssetKeys,
    setAutoUniverseScope,
    setControlMode,
    setIsManualSignalSavePending,
    setMarketDefaultsInitialized,
    setOrderForm,
    setPositionLiveQuotes,
    setReviewOrderForm,
    setReviewOrderTarget,
    setRiskForm,
    setSchedulerForm,
    setSelectedInterval,
    setSelectedMarginMode,
    setSelectedMarketType,
    setSelectedPortfolioAutoId,
    setSelectedPostmortemForTraining,
    setSignalReasoningMode,
    setSelectedSignalId,
    setSelectedSignalNewsPresetId,
    setSelectedSymbol,
    setSelectedTrainingNamespaceId,
    setShowNewOrderDialog,
    setShowNewSignalDialog,
    setShowOcoOrderDialog,
    setShowPostmortemTrainingDialog,
    setShowReviewOrderDialog,
    setShowRiskConfigDialog,
    setSignalForm,
    setSignalNewsPresetDescription,
    setSignalNewsPresetName,
    setSymbolReady,
    setTradingJobStatus,
    showNewOrderDialog,
    showNewSignalDialog,
    showOcoOrderDialog,
    showPostmortemTrainingDialog,
    showReviewOrderDialog,
    showRiskConfigDialog,
    signalForm,
    signalNewsPresetDescription,
    signalNewsPresetName,
    symbolReady,
    tradingJobStatus,
  } = useTradingLocalState();
  // ✅ CORREÇÃO: Flag para evitar race condition
  const sanitizedSymbol = selectedSymbol.trim();
  const {
    signalProfileForm,
    setSignalProfileForm,
    updateSignalTimeframes,
    updateSignalIndicators,
    updateSignalTechniques,
    updateSignalArbitrageConfig,
    updateSignalArbitrageExchanges,
    updateSignalArbitrageAssets,
    updateSignalSources,
  } = useTradingSignalProfileState({
    selectedInterval,
    defaultInterval: DEFAULT_INTERVAL,
  });
  
  const {
    autoModeOptions,
    handleWorkspaceSelectionChange,
    signalIndicatorOptions,
    signalTechniqueOptions,
    tradingWorkspaceOptions,
    visibleTabOptions,
  } = useTradingNavigationPresentation({
    activeWorkspace,
    handleWorkspaceChange,
    t,
  });
  const signalTechniqueOptionsWithSupport = useMemo(() => {
    const capabilityByTechnique = new Map(
      (signalProfileForm.techniqueCapabilities ?? []).map((capability) => [capability.technique, capability]),
    );
    return signalTechniqueOptions.map((option) => {
      const capability = capabilityByTechnique.get(option.value);
      if (!capability || capability.supportLevel === 'supported') {
        return option;
      }
      const supportLabel = capability.supportLevel === 'blocked'
        ? 'bloqueada'
        : 'não suportada';
      return {
        ...option,
        label: `${option.label} (${supportLabel})`,
      };
    });
  }, [signalProfileForm.techniqueCapabilities, signalTechniqueOptions]);
  const {
    activeAutoRunDetail,
    intervalsData,
    intervalsError,
    isLoadingStatus,
    isSignalArbitrageCatalogLoading,
    refetchSignalAutoRuns,
    refetchSignalProfile,
    refetchStatus,
    refetchTradingCandidates,
    refetchTradingPortfolios,
    refetchTradingRebalances,
    signalArbitrageCatalogResponse,
    signalAutoRuns,
    signalProfileResponse,
    statusData,
    statusError,
    statusIsConfigured,
    statusRequiresTenant,
    tradingCandidates,
    tradingPortfolios,
    tradingRebalancesPayload,
  } = useTradingSetupQueries({
    activeAutoRunId,
    csrfReady,
    selectedMarketType,
    selectedPortfolioAutoId,
    selectedSymbol,
    signalAutoRunsRefetchInterval: AUTO_RUNS_REFETCH_INTERVAL,
    signalProfileForm,
    statusRefetchInterval: STATUS_REFETCH_INTERVAL,
    userId: user?.id,
  });
  const {
    availableSignalArbitrageAssets,
    availableSignalArbitrageExchanges,
    granularityValue,
    intervalOptions,
    isSignalArbitrageInvalid,
    restOrderBookDepth,
    selectedSignalSources,
    signalArbitrageErrorMessage,
    signalIntervalOptions,
    signalSourceOptions,
    wsInterval,
    wsOrderBookDepth,
  } = useTradingSignalPresentationState({
    defaultArbitrageMaxIntervalMinutes: DEFAULT_ARBITRAGE_CONFIG.maxIntervalMinutes,
    fallbackIntervalMinutes: FALLBACK_INTERVAL_MINUTES,
    intervalsData,
    selectedInterval,
    signalArbitrageCatalogResponse,
    signalProfileForm,
    t,
  });
  const tradingRebalances = tradingRebalancesPayload.rebalances;
  const tradingExecutionReports = tradingRebalancesPayload.executionReports;
  const {
    isSignalProfilePayloadComplete,
    signalProfilePayload,
    topTradingCandidates,
  } = useTradingDerivedPayloadState({
    selectedMarketType,
    selectedSymbol,
    signalProfileForm,
    tradingCandidates,
  });
  const {
    enqueueTrading,
    enqueueTradingMutation,
    runPortfolioAutoPipeline,
  } = useTradingPipelineActions({
    refetchTradingCandidates,
    refetchTradingPortfolios,
    refetchTradingRebalances,
    selectedMarketType,
    selectedPortfolioAutoId,
    setActiveAutoRunId,
    setTradingJobStatus,
    t,
    topTradingCandidates,
    userId: user?.id,
    userTenantId: user?.tenantId,
  });
  const {
    newsPresets,
    selectedPreset: selectedSignalNewsPreset,
    normalizedPresetName: normalizedSignalNewsPresetName,
    canCreatePreset: canCreateSignalNewsPreset,
    canUpdatePreset: canUpdateSignalNewsPreset,
    isCreatePresetPending,
    isUpdatePresetPending,
    createPreset: createNewsPreset,
    updatePreset: updateNewsPreset,
    deletePreset: deleteNewsPreset,
  } = useTradingNewsPresets({
    selectedPresetId: selectedSignalNewsPresetId,
    setSelectedPresetId: setSelectedSignalNewsPresetId,
    presetName: signalNewsPresetName,
  });
  const {
    autoSignalAssetMap,
    autoSignalAssetOptions,
    autoSignalAssetsError,
    availableSymbols,
    favoriteSymbols,
    featuredOverride,
    featuredSymbols,
    isLoadingAutoSignalAssets,
    isLoadingSymbols,
    symbolsData,
    symbolsError,
  } = useTradingSymbolAssetQueries({
    selectedMarginMode,
    selectedMarketType,
    statusIsConfigured,
    statusRequiresTenant,
    symbolsRefetchInterval: SYMBOLS_REFETCH_INTERVAL,
  });
  const {
    isFuturesMarket,
    isSymbolValidForMarket,
    requestSymbol,
    wsChannels,
    wsEnabled,
  } = useTradingRealtimeConnectionState({
    availableSymbols,
    selectedMarketType,
    selectedSymbol,
    statusIsConfigured,
    statusRequiresTenant,
    wsInterval,
  });
  const { symbolOptions, symbolSelectItems } = useTradingSymbolCandidateViewState({
    availableSymbols,
    favoriteSymbols,
    featuredSymbols,
    t,
  });
  const {
    toggleFavorite,
    toggleFeatured,
    updateSymbolPrefsMutation,
  } = useTradingSymbolPreferences({
    favoriteSymbols,
    featuredOverride,
    selectedMarginMode,
    selectedMarketType,
  });
  const {
    accountData,
    accountError,
    isLoadingAccount,
    isLoadingMarket,
    isLoadingOrders,
    isLoadingPositions,
    marketData,
    marketError,
    marketQueryString,
    ordersData,
    ordersError,
    positionsData,
    positionsError,
    refetchAccount,
    refetchOrders,
    refetchPositions,
  } = useTradingMarketAccountQueries({
    accountRefetchInterval: ACCOUNT_REFETCH_INTERVAL,
    requestSymbol,
    selectedMarginMode,
    selectedMarketType,
    statusIsConfigured,
    statusRequiresTenant,
    symbolReady,
    isSymbolValidForMarket,
  });
  const {
    isLoadingScheduler,
    isLoadingSignals,
    refetchScheduler,
    refetchSignals,
    schedulerConfig,
    schedulerError,
    selectedSignal,
    signals,
    signalsError,
  } = useTradingSignalSchedulerQueries({
    defaultInterval: DEFAULT_INTERVAL,
    selectedMarketType,
    selectedSignalId,
    setSelectedSignalId,
    signalRefetchInterval: SIGNALS_REFETCH_INTERVAL,
    statusIsConfigured,
    statusRequiresTenant,
  });
  useTradingSchedulerFormSync({
    schedulerConfig,
    setSchedulerForm,
  });
  const {
    availableNamespaces,
    isLoadingPostmortems,
    postmortemIdsSentToTraining,
    postmortems,
    refetchPostmortems,
  } = useTradingPostmortemTrainingQueries({
    activeTab,
    selectedMarketType,
    showPostmortemTrainingDialog,
    statusIsConfigured,
    statusRequiresTenant,
  });
  const {
    controlHistoryData,
    controlHistoryError,
    isLoadingControlHistory,
    refetchControlHistory,
    refetchRiskConfig,
    riskConfigData,
    riskConfigError,
    wsStatusData,
  } = useTradingOperationalQueries({
    statusIsConfigured,
    statusRefetchInterval: STATUS_REFETCH_INTERVAL,
    statusRequiresTenant,
  });
  useTradingBootstrapStateSync({
    autoMix,
    autoSelectAllAssets,
    autoSignalAllModes: AUTO_SIGNAL_ALL_MODES,
    autoSignalAssetMap,
    autoUniverseScope,
    intervalsData,
    sanitizedSymbol,
    selectedInterval,
    selectedPortfolioAutoId,
    setAllowedModes,
    setAutoSelectAllAssets,
    setAutoSelectedAssetKeys,
    setAutoUniverseScope,
    setSelectedInterval,
    setSelectedPortfolioAutoId,
    setSelectedSymbol,
    setSymbolReady,
    signalArbitrageCatalogResponse,
    signalProfileForm,
    statusData,
    symbolsData,
    tradingPortfolios,
    updateSignalArbitrageConfig,
  });
  const {
    orderHistoryItems,
    orderHistoryHasMore,
    orderHistoryLoading,
    orderHistorySelectedIds,
    allOrderHistorySelected,
    hasOrderHistorySelection,
    isDeletingOrderHistory,
    fetchOrderHistory,
    deleteOrderHistory,
    toggleOrderHistorySelection,
    toggleOrderHistorySelectAll,
  } = useTradingOrderHistory({
    activeTab,
    selectedMarketType,
    t,
    notify: toast,
  });
  const {
    handleBalanceUpdate,
    handleOrderUpdate,
    handlePositionUpdate,
    handleTickerUpdate,
    handleWebsocketError,
  } = useTradingRealtimeEventHandlers({
    isFuturesMarket,
    setPositionLiveQuotes,
  });
  const {
    state: wsState,
    ticker: wsTicker,
    orderBook: wsOrderBook,
    klines: wsKlines,
    subscribe: subscribePositionQuotes,
    unsubscribe: unsubscribePositionQuotes,
  } = useKucoinWebSocket({
    symbol: wsEnabled ? requestSymbol : '',
    channels: wsChannels,
    interval: wsInterval,
    autoConnect: wsEnabled,
    marketType: selectedMarketType,
    marginMode: selectedMarginMode,
    orderBookDepth: wsOrderBookDepth ?? undefined,
    onError: handleWebsocketError,
    onTicker: handleTickerUpdate,
    onOrderUpdate: handleOrderUpdate,
    onPositionUpdate: handlePositionUpdate,
    onBalance: handleBalanceUpdate,
  });
  const {
    klinesData,
    klinesError,
    isLoadingKlines,
    isLoadingOrderBook,
    orderBookError,
    orderBookResponse,
    refetchKlines,
  } = useTradingMarketRealtimeQueries({
    granularityValue,
    isSymbolValidForMarket,
    marketQueryString,
    requestSymbol,
    restOrderBookDepth,
    selectedInterval,
    selectedMarginMode,
    selectedMarketType,
    statusIsConfigured,
    symbolReady,
  });
  const invalidateKlines = useTradingKlineInvalidation();
  const { market, normalizedSymbol, orderBookData, orderBookPrecision } = useTradingMarketOrderBookState({
    granularityValue,
    isSymbolValidForMarket,
    marketData,
    onInvalidateKlines: invalidateKlines,
    orderBookResponse,
    requestSymbol,
    selectedInterval,
    selectedMarginMode,
    selectedMarketType,
    statusIsConfigured,
    wsEnabled,
    wsOrderBook,
    wsTicker,
  });
  const { openReviewDialog } = useTradingRiskReviewState({
    marketDefaultsInitialized,
    riskConfigData,
    setControlMode,
    setMarketDefaultsInitialized,
    setReviewOrderForm,
    setReviewOrderTarget,
    setRiskForm,
    setSelectedMarginMode,
    setSelectedMarketType,
    setShowReviewOrderDialog,
  });
  const { sendPostMortemToTrainingMutation, updateSignalProfileMutation } = useTradingProfilePostmortemMutations({
    autoSaveSignalContextRef,
    autoSaveSignalLastPayloadRef,
    notify: toast,
    refetchSignalProfile,
    setSelectedPostmortemForTraining,
    setSelectedTrainingNamespaceId,
    setShowPostmortemTrainingDialog,
    setSignalProfileForm,
    t,
  });
  useTradingSignalProfileAutoSave({
    autoSaveDebounceMs: AUTO_SAVE_DEBOUNCE_MS,
    autoSaveSignalContextRef,
    autoSaveSignalEnabledRef,
    autoSaveSignalLastPayloadRef,
    autoSaveSignalTimerRef,
    isSignalProfilePayloadComplete,
    selectedMarketType,
    selectedSymbol,
    setSignalProfileForm,
    signalProfilePayload,
    signalProfileResponse,
    updateSignalProfile: updateSignalProfileMutation.mutate,
  });
  const {
    createSignalMutation,
    deactivateSignalMutation,
    generateSignalMutation,
    signalAutoRunMutation,
    updateSignalSchedulerMutation,
  } = useTradingSignalMutations({
    allowedModes,
    autoMix,
    autoSelectAllAssets,
    autoSelectedAssetKeys,
    autoSignalAllModes: AUTO_SIGNAL_ALL_MODES,
    autoSignalAssetMap,
    autoUniverseScope,
    availableNamespaces,
    defaultInterval: DEFAULT_INTERVAL,
    notify: toast,
    requestSymbol,
    refetchScheduler,
    refetchSignalAutoRuns,
    refetchSignals,
    reasoningMode: signalReasoningMode,
    schedulerForm,
    selectedInterval,
    selectedMarginMode,
    selectedMarketType,
    selectedSymbol,
    setActiveAutoRunId,
    setShowNewSignalDialog,
    setSignalForm,
    signalProfileForm,
    t,
  });
  const {
    approveReviewOrderMutation,
    createOrderMutation,
    handleApproveReviewOrder,
    handleApproveReviewOrderById,
    handleCancelOrderById,
    handleDeactivateSignalById,
    handleModeChange,
    handleOpenAnalysisPanel,
    handleOpenGeneratedSignal,
    handleOpenLabPanel,
    handleOpenSignalsPanel,
    handleRejectReviewOrderById,
    handleReviewOrderFieldUpdate,
    handleSaveReviewOrderAdjustments,
    handleSyncOrdersNow,
    handleTradingToggle,
    syncOrdersMutation,
    updateReviewOrderMutation,
    updateRiskConfigMutation,
  } = useTradingControlOrderActionSuite({
    controlOrderMutationOptions: {
      notify: toast,
      refetchAccount,
      refetchControlHistory,
      refetchOrders,
      refetchPositions,
      refetchRiskConfig,
      refetchStatus,
      selectedMarginMode,
      selectedMarketType,
      selectedSymbol,
      setControlMode,
      setOrderForm,
      setReviewOrderTarget,
      setShowNewOrderDialog,
      setShowReviewOrderDialog,
      setShowRiskConfigDialog,
      t,
    },
    reviewOrderHandlersOptions: {
      reviewOrderForm,
      reviewOrderTarget,
      setReviewOrderForm,
    },
    mutationActionHandlersOptions: {
      deactivateSignal: deactivateSignalMutation.mutate,
      refetchSignals,
      setActiveTab,
      setSelectedSignalId,
    },
  });
  const {
    currentPrice,
    contractMultiplier,
    handleOrderSizeChange,
    handleOrderUsdtChange,
  } = useTradingOrderSizing({
    market,
    wsEnabled,
    wsTicker,
    normalizedSymbol,
    isFuturesMarket,
    setOrderForm,
  });
  const { klines } = useTradingKlineSeriesState({
    klinesData,
    normalizedSymbol,
    selectedMarginMode,
    selectedMarketType,
    wsEnabled,
    wsInterval,
    wsKlines,
  });

  const positionsPayload = positionsData?.data ?? null;
  const futuresPositions = selectedMarketType === 'futures' && isFuturesPositionArray(positionsPayload)
    ? positionsPayload
    : [];
  const openFuturesPositions = futuresPositions.filter((position) => position.isOpen);
  const account = accountData?.data;
  const {
    accountMode,
    futuresAccount,
    futuresAccountSummary,
    isSpotMarket,
    marginAccountSummary,
    marginCrossPositions,
    marginIsolatedPositions,
    openPositionsCount,
    quoteCurrency,
    spotAccountSummary,
    spotPositions,
  } = useTradingAccountPositionState({
    account,
    isFuturesMarket,
    openFuturesPositions,
    positionsPayload,
    selectedMarketType,
    selectedSymbol,
  });

  useTradingFuturesQuoteSubscription({
    isFuturesMarket,
    openFuturesPositions,
    subscribePositionQuotes,
    unsubscribePositionQuotes,
    wsConnected: wsState.connected,
  });
  const {
    canSubmitOrder,
    orderEffectivePrice,
    orderLeverageValue,
    orderStopLossValue,
    orderTakeProfitValue,
    orderStopLossEstimate,
    orderTakeProfitEstimate,
  } = buildTradingOrderSummary({
    orderForm,
    isFuturesMarket,
    currentPrice,
    contractMultiplier,
  });
  const orders = ordersData?.data || [];
  const hasSignalArbitrage = signalProfileForm.techniques.includes('arbitrage_triangular');
  const {
    handleIntervalChange,
    openReviewDialogById,
    prefillSellOrderFromAsset,
    handleCancelPostmortemTrainingDialog,
    handleOpenPostmortemTrainingDialog,
    handlePostmortemTrainingDialogOpenChange,
    handleSubmitPostmortemTraining,
    handleCloseNewOrderDialog,
    handleNewOrderSizeChange,
    handleOpenNewOrderDialog,
    handleOpenNewSignalDialog,
    handlePatchOrderForm,
    handlePatchRiskForm,
    handleQuickOrder,
    handleSignalConfidenceChange,
    handleSignalReasoningChange,
    handleSignalTypeChange,
    handleSubmitNewOrder,
    handleSubmitRiskConfig,
    handleSubmitSignal,
    handleSchedulerEnabledChange,
    handleSchedulerIntervalMinutesChange,
    handleSchedulerMaxSignalsPerRunChange,
    handleSchedulerSymbolsChange,
    handleApplyNewsPreset,
    handleChangeNewsConfig,
    handleCreateNewsPreset,
    handleDeleteNewsPreset,
    handleEnsembleTopNChange,
    handleGenerateSignalNow,
    handleSaveSignalProfile,
    handleSaveSignalScheduler,
    handleUpdateNewsPreset,
    handleCancelRiskConfigDialog,
    handleCloseReviewOrderDialog,
    handleDeleteAllMineHistory,
    handleDeleteAllTenantHistory,
    handleDeleteSelectedHistory,
    handleFetchOrderHistory,
    handleMarketTypeChange,
    handleOpenOcoOrderDialog,
    handleOpenRiskConfigDialog,
    handleRefreshAccount,
    handleRefreshKlines,
    handleRefreshPositions,
    handleRefreshPostmortems,
    handleRunAutoNow,
  } = useTradingCompositeActionHandlers({
    pageInteractionOptions: {
      availableSymbols,
      openReviewDialog,
      orders,
      setActiveTab,
      setOrderForm,
      setSelectedInterval,
      setSelectedMarketType,
      setSelectedSymbol,
    },
    postmortemTrainingOptions: {
      notify: toast,
      selectedPostmortemForTraining,
      selectedTrainingNamespaceId,
      setSelectedPostmortemForTraining,
      setSelectedTrainingNamespaceId,
      setShowPostmortemTrainingDialog,
      submitPostmortemForTraining: sendPostMortemToTrainingMutation.mutate,
    },
    dialogFormOptions: {
      createOrder: createOrderMutation.mutate,
      createSignal: createSignalMutation.mutate,
      handleOrderSizeChange,
      isFuturesMarket,
      orderForm,
      riskForm,
      setOrderForm,
      setRiskForm,
      setShowNewOrderDialog,
      setShowNewSignalDialog,
      setSignalForm,
      signalForm,
      updateRiskConfig: updateRiskConfigMutation.mutate,
    },
    schedulerFormOptions: {
      schedulerForm,
      setSchedulerForm,
    },
    signalProfileActionOptions: {
      createNewsPreset,
      defaultEnsembleConfig: DEFAULT_ENSEMBLE_CONFIG,
      deleteNewsPreset,
      generateSignal: generateSignalMutation.mutate,
      isManualSignalSavePending,
      isSignalArbitrageInvalid,
      normalizedSignalNewsPresetName,
      notify: toast,
      saveSignalProfile: updateSignalProfileMutation.mutate,
      saveSignalScheduler: updateSignalSchedulerMutation.mutate,
      selectedSignalNewsPreset,
      setIsManualSignalSavePending,
      setSignalProfileForm,
      signalArbitrageErrorMessage,
      signalNewsPresetDescription,
      signalProfileForm,
      signalProfilePayload,
      t,
      updateNewsPreset,
    },
    workspaceActionOptions: {
      deleteOrderHistory,
      fetchOrderHistory,
      orderHistorySelectedIds,
      refetchKlines,
      refetchPositions,
      refetchPostmortems,
      runAutoSignalNow: signalAutoRunMutation.mutate,
      setSelectedMarketType,
      setSelectedSymbol,
      setShowOcoOrderDialog,
      setShowReviewOrderDialog,
      setShowRiskConfigDialog,
    },
  });
  const riskConfig = riskConfigData?.data;
  const isTradingEnabled = Boolean(riskConfig?.tradingEnabled);
  const reasoningModeOptions: Array<{ label: string; value: ReasoningMode }> = isAdminRole
    ? [
      { value: 'auto', label: t('trading.signals.reasoning.auto') },
      { value: 'thinking', label: t('trading.signals.reasoning.thinking') },
      { value: 'non_thinking', label: t('trading.signals.reasoning.nonThinking') },
    ]
    : [{ value: 'auto', label: t('trading.signals.reasoning.auto') }];
  const handleSignalReasoningModeChange = (value: ReasoningMode) => {
    if (!isAdminRole && isManualReasoningMode(value)) {
      return;
    }
    setSignalReasoningMode(value);
  };
  const orderBookDepth = orderBookResponse?.depth ?? restOrderBookDepth ?? null;
  const controlHistory = controlHistoryData?.data || [];
  const wsStatus = wsStatusData?.data;
  useTradingTerminalAutoRunTelemetry({
    activeAutoRunDetail,
    emittedTerminalAutoRunsRef,
  });
  const {
    criticalApiError,
    renderOrderStatusBadge,
    renderSignalTypeBadge,
    wsHealthy,
  } = useTradingOperationalPresentationWrappers({
    errors: [
      statusError,
      symbolsError,
      marketError,
      accountError,
      positionsError,
      signalsError,
      ordersError,
      riskConfigError,
      intervalsError,
      klinesError,
      orderBookError,
      controlHistoryError,
    ],
    wsConnected: wsState.connected,
    wsEnabled,
    wsError: wsState.error,
  });
  const statusGuardNode = resolveTradingStatusGate({
    isLoadingStatus,
    refetchStatus,
    statusData,
    statusError,
    t,
  });
  if (statusGuardNode) {
    return statusGuardNode;
  }
  const status = statusData?.data;
  if (!status) {
    return null;
  }
  const defaultSymbol = symbolsData?.data?.defaultSymbol || status.defaultSymbol || '';

  // Variação de preço: usar dados de contrato (Futures) ou ticker (Spot/Margin)
  const { priceChange, priceChangePercent } = resolveTradingPriceChange({
    isFuturesMarket,
    market,
  });
  const sharedLocaleContext = { locale, t };
  const sharedLocaleTimeContext = { ...sharedLocaleContext, timeZone };
  const sharedMarketSelectionContext = {
    selectedMarginMode,
    selectedMarketType,
    selectedSymbol,
  };
  const primaryTabsOptions = {
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
    bestAskPrice: market?.ticker?.bestAskPrice || '',
    bestBidPrice: market?.ticker?.bestBidPrice || '',
    canCreatePreset: canCreateSignalNewsPreset,
    canOverrideReasoningMode: isAdminRole,
    canUpdatePreset: canUpdateSignalNewsPreset,
    defaultArbitrageMaxIntervalMinutes: DEFAULT_ARBITRAGE_CONFIG.maxIntervalMinutes,
    defaultEnsembleTopN: DEFAULT_ENSEMBLE_CONFIG.topN,
    defaultSymbol,
    enqueuePending: enqueueTradingMutation.isPending,
    formatDecisionSummary,
    formatDurationMinutes,
    futuresSummary: futuresAccountSummary,
    hasAutoSignalAssetsError: Boolean(autoSignalAssetsError),
    hasSignalArbitrage,
    indicatorOptions: signalIndicatorOptions,
    analysisIntervalOptions: intervalOptions,
    isCreatePresetPending,
    isFuturesMarket,
    isGeneratePending: generateSignalMutation.isPending,
    isLoadingAccount,
    isLoadingAutoSignalAssets,
    isLoadingOrders,
    isLoadingPositions,
    isLoadingScheduler,
    isLoadingSignals,
    isManualSavePending: isManualSignalSavePending,
    isSavingScheduler: updateSignalSchedulerMutation.isPending,
    isSignalArbitrageCatalogLoading,
    isSpotMarket,
    isSyncingOrders: syncOrdersMutation.isPending,
    isUpdatePresetPending,
    ...sharedLocaleTimeContext,
    marginCrossPositions,
    marginIsolatedPositions,
    marginSummary: marginAccountSummary,
    marketType: selectedMarketType,
    maxArbitrageAssets: MAX_ARBITRAGE_ASSETS,
    newsConfig: signalProfileForm.newsConfig,
    newsPresetDescription: signalNewsPresetDescription,
    newsPresetName: signalNewsPresetName,
    onAllowedModesChange: setAllowedModes,
    onApplyPreset: handleApplyNewsPreset,
    onArbitrageAssetsChange: updateSignalArbitrageAssets,
    onArbitrageConfigChange: updateSignalArbitrageConfig,
    onArbitrageExchangesChange: updateSignalArbitrageExchanges,
    onApproveReviewOrder: handleApproveReviewOrderById,
    onAutoMixChange: setAutoMix,
    onAutoSelectAllAssetsChange: setAutoSelectAllAssets,
    onAutoSelectedAssetKeysChange: setAutoSelectedAssetKeys,
    onAutoUniverseScopeChange: setAutoUniverseScope,
    onCancelOrder: handleCancelOrderById,
    onChangeNewsConfig: handleChangeNewsConfig,
    onCreatePreset: handleCreateNewsPreset,
    onDeactivateSignal: handleDeactivateSignalById,
    onDeletePreset: handleDeleteNewsPreset,
    onEnabledChange: handleSchedulerEnabledChange,
    onEnqueueTrading: enqueueTrading,
    onEnsembleTopNChange: handleEnsembleTopNChange,
    onGenerateNow: handleGenerateSignalNow,
    onIndicatorsChange: updateSignalIndicators,
    onIntervalMinutesChange: handleSchedulerIntervalMinutesChange,
    onMaxSignalsPerRunChange: handleSchedulerMaxSignalsPerRunChange,
    onNewsPresetDescriptionChange: setSignalNewsPresetDescription,
    onNewsPresetNameChange: setSignalNewsPresetName,
    onOpenGeneratedSignal: handleOpenGeneratedSignal,
    onOpenLab: handleOpenLabPanel,
    onOpenManualAnalysis: handleOpenAnalysisPanel,
    onOpenNewOrderDialog: handleOpenNewOrderDialog,
    onOpenNewSignalDialog: handleOpenNewSignalDialog,
    onOpenOcoOrderDialog: handleOpenOcoOrderDialog,
    onOpenReviewDialog: openReviewDialog,
    onOpenReviewDialogById: openReviewDialogById,
    onOpenSignalsPanel: handleOpenSignalsPanel,
    onPrefillSellOrderFromAsset: prefillSellOrderFromAsset,
    onQuickOrder: handleQuickOrder,
    onRefreshPositions: handleRefreshPositions,
    onReasoningModeChange: handleSignalReasoningModeChange,
    onRejectReviewOrder: handleRejectReviewOrderById,
    onRunAutoNow: handleRunAutoNow,
    onRunPipeline: runPortfolioAutoPipeline,
    onSaveProfile: handleSaveSignalProfile,
    onSaveScheduler: handleSaveSignalScheduler,
    onSelectAutoRun: setActiveAutoRunId,
    onSelectPresetId: setSelectedSignalNewsPresetId,
    onSelectSignal: setSelectedSignalId,
    onSelectedPortfolioChange: setSelectedPortfolioAutoId,
    onSourcesChange: updateSignalSources,
    onSymbolsChange: handleSchedulerSymbolsChange,
    onSyncOrders: handleSyncOrdersNow,
    onTechniquesChange: updateSignalTechniques,
    onTimeframesChange: updateSignalTimeframes,
    onUpdatePreset: handleUpdateNewsPreset,
    openFuturesPositions,
    orders,
    positionLiveQuotes,
    presets: newsPresets,
    reasoningMode: signalReasoningMode,
    reasoningModeOptions,
    renderOrderStatusBadge,
    renderSignalTypeBadge,
    schedulerConfig,
    schedulerForm,
    schedulerHasError: Boolean(schedulerError),
    showArbitrageError: isSignalArbitrageInvalid,
    selectedInterval,
    ...sharedMarketSelectionContext,
    selectedPortfolioId: selectedPortfolioAutoId,
    selectedPresetId: selectedSignalNewsPresetId,
    selectedSignal,
    selectedSignalId,
    selectedSignalSources,
    signalAutoRunPending: signalAutoRunMutation.isPending,
    signalAutoRuns,
    signalIntervalOptions,
    signalProfileForm,
    signalProfileInvalid: isSignalArbitrageInvalid || !isSignalProfilePayloadComplete,
    signals,
    sourceOptions: signalSourceOptions,
    spotPositions,
    spotSummary: spotAccountSummary,
    techniqueOptions: signalTechniqueOptionsWithSupport,
    topTradingCandidates,
    tradingEnabled: isTradingEnabled,
    tradingExecutionReports,
    tradingJobStatus,
    tradingPortfolios,
    tradingRebalances,
    validationErrorMessage: signalArbitrageErrorMessage,
  };
  const operationalTabsOptions = {
    allOrderHistorySelected,
    circuitBreakerOpen: status.circuitBreaker.state === 'open',
    controlHistory,
    controlMode,
    currentPrice,
    defaultFuturesSymbol: selectedSymbol,
    deleteOrderHistoryPending: isDeletingOrderHistory,
    hasOrderHistorySelection,
    intervalOptions,
    isAdminRole,
    isLoadingControlHistory,
    isLoadingKlines,
    isLoadingOrderBook,
    isLoadingPostmortems,
    klines,
    ...sharedLocaleTimeContext,
    onDeleteAllMine: handleDeleteAllMineHistory,
    onDeleteAllTenant: handleDeleteAllTenantHistory,
    onDeleteSelected: handleDeleteSelectedHistory,
    onFetchOrderHistory: handleFetchOrderHistory,
    onIntervalChange: handleIntervalChange,
    onModeChange: handleModeChange,
    onOpenSendToTraining: handleOpenPostmortemTrainingDialog,
    onRefreshAccount: handleRefreshAccount,
    onRefreshKlines: handleRefreshKlines,
    onRefreshPostmortems: handleRefreshPostmortems,
    onSymbolChange: setSelectedSymbol,
    onToggleOrderHistorySelectAll: toggleOrderHistorySelectAll,
    onToggleOrderHistorySelection: toggleOrderHistorySelection,
    onTradingToggle: handleTradingToggle,
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
    sendPostMortemToTrainingPending: sendPostMortemToTrainingMutation.isPending,
    symbolOptions,
    tradingEnabled: riskConfig?.tradingEnabled || false,
  };
  const dialogsOptions = {
    availableNamespaces,
    canSubmitOrder,
    canSubmitPostmortemTraining: Boolean(selectedPostmortemForTraining && selectedTrainingNamespaceId),
    currentPrice,
    defaultSymbol,
    highPrice: market?.contract?.highPrice || 0,
    isApprovingReviewOrder: approveReviewOrderMutation.isPending,
    isFuturesMarket,
    isSubmittingNewOrder: createOrderMutation.isPending,
    isSubmittingNewSignal: createSignalMutation.isPending,
    isSubmittingPostmortemTraining: sendPostMortemToTrainingMutation.isPending,
    isSubmittingRiskConfig: updateRiskConfigMutation.isPending,
    isUpdatingReviewOrder: updateReviewOrderMutation.isPending,
    ...sharedLocaleContext,
    lowPrice: market?.contract?.lowPrice || 0,
    marginMode: selectedMarginMode,
    marketType: selectedMarketType,
    onApproveAndExecuteReviewOrder: handleApproveReviewOrder,
    onCancelNewOrder: handleCloseNewOrderDialog,
    onCancelPostmortemTraining: handleCancelPostmortemTrainingDialog,
    onCancelRiskConfig: handleCancelRiskConfigDialog,
    onCloseReviewOrder: handleCloseReviewOrderDialog,
    onConfidenceChange: handleSignalConfidenceChange,
    onNamespaceChange: setSelectedTrainingNamespaceId,
    onOpenChangeNewOrder: setShowNewOrderDialog,
    onOpenChangeNewSignal: setShowNewSignalDialog,
    onOpenChangeOco: setShowOcoOrderDialog,
    onOpenChangePostmortemTraining: handlePostmortemTrainingDialogOpenChange,
    onOpenChangeReviewOrder: setShowReviewOrderDialog,
    onOpenChangeRiskConfig: setShowRiskConfigDialog,
    onPatchOrderForm: handlePatchOrderForm,
    onPatchRiskForm: handlePatchRiskForm,
    onReasoningChange: handleSignalReasoningChange,
    onSaveAdjustmentsReviewOrder: handleSaveReviewOrderAdjustments,
    onSignalTypeChange: handleSignalTypeChange,
    onSizeChangeNewOrder: handleNewOrderSizeChange,
    onSubmitNewOrder: handleSubmitNewOrder,
    onSubmitNewSignal: handleSubmitSignal,
    onSubmitPostmortemTraining: handleSubmitPostmortemTraining,
    onSubmitRiskConfig: handleSubmitRiskConfig,
    onUpdateFieldReviewOrder: handleReviewOrderFieldUpdate,
    onUsdtChangeNewOrder: handleOrderUsdtChange,
    openNewOrderDialog: showNewOrderDialog,
    openNewSignalDialog: showNewSignalDialog,
    openOcoOrderDialog: showOcoOrderDialog,
    openPostmortemTrainingDialog: showPostmortemTrainingDialog,
    openReviewOrderDialog: showReviewOrderDialog,
    openRiskConfigDialog: showRiskConfigDialog,
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
    reviewOrderHasTarget: Boolean(reviewOrderTarget),
    riskForm,
    riskMaxLeverage: riskConfig?.maxLeverage || 20,
    selectedMarketType,
    selectedNamespaceId: selectedTrainingNamespaceId,
    selectedSymbol,
    signalForm,
    signalTypeOptions: SIGNAL_TYPES,
    symbolForOcoDialog: selectedSymbol || defaultSymbol,
    symbolOptions,
    volumeOf24h: market?.contract?.volumeOf24h || 0,
    wsEnabled,
  };
  const layoutOptions = {
    accountMode,
    activeSignals: status.activeSignals,
    activeTab,
    activeWorkspace,
    circuitBreakerFailures: status.circuitBreaker.failures,
    circuitBreakerState: status.circuitBreaker.state,
    criticalApiError,
    currentPrice,
    favoriteSymbols,
    featuredOverride,
    featuredSymbols,
    fundingRate: market?.contract?.fundingFeeRate || 0,
    futuresAvailableBalance: futuresAccount?.availableBalance ?? 0,
    futuresCurrency: futuresAccount?.currency,
    futuresUnrealisedPnl: futuresAccount?.unrealisedPNL ?? 0,
    isFuturesMarket,
    isLoadingAccount,
    isLoadingMarket,
    isLoadingSymbols,
    isTradingEnabled,
    isUpdatingSymbolPrefs: updateSymbolPrefsMutation.isPending,
    ...sharedLocaleContext,
    marginTotalAsset: marginAccountSummary.totalAsset,
    marginTotalLiability: marginAccountSummary.totalLiability,
    marketHighPrice: market?.contract?.highPrice ?? 0,
    marketLowPrice: market?.contract?.lowPrice ?? 0,
    marketVolumeOf24h: market?.contract?.volumeOf24h ?? 0,
    maxLeverage: riskConfig?.maxLeverage || 20,
    onMarketTypeChange: handleMarketTypeChange,
    onMarginModeChange: setSelectedMarginMode,
    onOpenRiskConfigDialog: handleOpenRiskConfigDialog,
    onSelectFeaturedSymbol: setSelectedSymbol,
    onSymbolChange: setSelectedSymbol,
    onTabChange: handleTabChange,
    onToggleFavorite: toggleFavorite,
    onToggleFeatured: toggleFeatured,
    onWorkspaceChange: handleWorkspaceSelectionChange,
    openPositionsCount,
    pendingOrders: status.pendingOrders,
    priceChange,
    priceChangePercent,
    quoteCurrency,
    ...sharedMarketSelectionContext,
    spotAssetsWithBalance: spotAccountSummary.assetsWithBalance,
    spotQuoteAvailable: spotAccountSummary.quoteAvailable,
    symbolOptionsLength: symbolOptions.length,
    symbolSelectItems,
    tabs: visibleTabOptions,
    workspaceOptions: tradingWorkspaceOptions,
    wsConfigured: Boolean(wsStatus?.configured),
    wsConnecting: wsState.connecting,
    wsEnabled,
    wsHealthy,
    wsPrivateEnabled: Boolean(wsStatus?.private?.enabled),
    wsPrivateState: wsStatus?.private?.state ?? 'disconnected',
    wsPublicState: wsStatus?.public?.state ?? 'disconnected',
  };
  const {
    dialogsSectionProps,
    headerSectionProps,
    operationalAlertsSectionProps,
    operationalTabsSectionProps,
    primaryTabsSectionProps,
    statsPrimarySectionProps,
    statsSecondarySectionProps,
    tabsShellSectionProps,
  } = buildTradingPageSectionProps({
    dialogsOptions,
    layoutOptions,
    operationalTabsOptions,
    primaryTabsOptions,
  });
  const showOperationalAlerts = Boolean(criticalApiError || !riskConfig?.tradingEnabled);
  const tradingWorkspaceV2Enabled = isTradingWorkspaceV2Enabled(status.featureFlags);
  const engineHealth: 'healthy' | 'degraded' | 'offline' = !isTradingEnabled
    ? 'offline'
    : (criticalApiError || status.circuitBreaker.state.toLowerCase() === 'open')
      ? 'degraded'
      : 'healthy';
  const riskModeLabel = `${controlMode} • ${selectedMarketType}${selectedMarketType === 'margin' ? `/${selectedMarginMode}` : ''}`;

  return (
    <ErrorBoundary>
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="p-3 md:p-6 space-y-4 md:space-y-6"
      >
        {tradingWorkspaceV2Enabled ? (
          <>
            <TradingV2WorkspaceView
              activeTab={activeTab}
              activeWorkspace={activeWorkspace}
              engineHealth={engineHealth}
              headerSectionProps={headerSectionProps}
              onTabChange={handleTabChange}
              onWorkspaceChange={handleWorkspaceChange}
              operationalAlertsSectionProps={operationalAlertsSectionProps}
              operationalTabsSectionProps={operationalTabsSectionProps}
              primaryTabsSectionProps={primaryTabsSectionProps}
              riskModeLabel={riskModeLabel}
              showOperationalAlerts={showOperationalAlerts}
              statsSecondarySectionProps={statsSecondarySectionProps}
              visibleTabOptions={visibleTabOptions}
              workspaceOptions={tradingWorkspaceOptions}
            />
            <TradingDialogsSection {...dialogsSectionProps} />
          </>
        ) : (
          <TradingPageSections
            dialogsSectionProps={dialogsSectionProps}
            headerSectionProps={headerSectionProps}
            operationalAlertsSectionProps={operationalAlertsSectionProps}
            operationalTabsSectionProps={operationalTabsSectionProps}
            primaryTabsSectionProps={primaryTabsSectionProps}
            showOperationalAlerts={showOperationalAlerts}
            statsPrimarySectionProps={statsPrimarySectionProps}
            statsSecondarySectionProps={statsSecondarySectionProps}
            tabsShellSectionProps={tabsShellSectionProps}
          />
        )}
      </motion.div>
    </ErrorBoundary>
  );
}
