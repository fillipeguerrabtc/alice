/**
 * Conteúdo principal do workspace de Trading.
 * Centraliza composição de estado, consultas, realtime e ações para renderizar TradingPageSections.
 *
 * Author: Fillipe Guerra
 * Data: 10 de Março de 2026
 */

import { useEffect, useMemo, useRef } from 'react';
import { Activity, Brain, FileCheck2, Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/use-auth';
import { TIMEZONE } from '@/lib/i18n';
import { isManualReasoningMode, type ReasoningMode } from '@/lib/reasoning-mode';
import { Tabs } from '@/components/ui/tabs';
import {
  classifySignalGenerationFailure,
  emitTradingTelemetry,
} from '@/lib/tradingTelemetry';
import { ErrorBoundary } from '@/components/error-boundary'; // ✅ CORREÇÃO: Import ErrorBoundary para graceful degradation
import { useToast } from '@/hooks/use-toast';
import { useKucoinWebSocket } from '@/hooks/useKucoinWebSocket';
import {
  TradingWorkspaceAiSignalsCockpitMode,
  TradingWorkspaceCompactOrderTicket,
  TradingWorkspaceOperateMode,
  TradingWorkspaceOperateStatusCard,
  TradingWorkspaceShell,
  type TradingWorkspacePrimaryMode,
  type TradingWorkspacePrimaryModeOption,
} from '@/components/trading-v2';
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
  TradingChartTabContent,
  TradingOrdersTabContent,
  TradingPositionsTabContent,
  TradingAccountTabContent,
  TradingControlTabContent,
  TradingHeaderSection,
  TradingOperationalAlerts,
  TradingOperationalTabsSection,
  TradingOrderBookTabContent,
  TradingPrimaryTabsSection,
  TradingStatsPrimaryRow,
  TradingStatsSecondaryRow,
  resolveTradingStatusGate,
  isFuturesPositionArray,
  type TradingTabKey,
  type TradingWorkspaceKey,
} from '@/components/trading';

/** Intervalo de atualização do status geral do trading (30s) */
const STATUS_REFETCH_INTERVAL = 30_000;

/** Intervalo de atualização da lista de símbolos (10 min - muda raramente) */
const SYMBOLS_REFETCH_INTERVAL = 600_000;

/** Intervalo de atualização dos sinais de trading (30s) */
const SIGNALS_REFETCH_INTERVAL = 30_000;

/** Intervalo de atualização de conta/posições/ordens (20s) */
const ACCOUNT_REFETCH_INTERVAL = 20_000;

/** Intervalo de atualização dos runs automáticos (15s) */
const AUTO_RUNS_REFETCH_INTERVAL = 15_000;

/**
 * ARQUITETURA REAL-TIME (10/02/2026):
 * - Ticker, OrderBook, Klines, Trades: WebSocket é fonte ÚNICA. REST apenas para carga inicial.
 * - Sem polling fallback (Regra 6 - PROIBIDO workarounds).
 * - Se WS cair: indicador visual + auto-reconnect com backoff exponencial.
 * - Posições/Ordens/Conta: polling periódico mantido (dados operacionais, não real-time market data).
 */

/** Intervalo padrão de candles */
const DEFAULT_INTERVAL = '5m';

const TRADING_V2_MODE_OPTIONS: TradingWorkspacePrimaryModeOption[] = [
  {
    value: 'operate',
    label: 'Operar',
    description: 'Execução manual, ordens e posições.',
    icon: Activity,
  },
  {
    value: 'ai-signals',
    label: 'Sinais IA',
    description: 'Geração de sinais, análise e validação.',
    icon: Brain,
  },
  {
    value: 'portfolio-auto',
    label: 'Portfólio Auto',
    description: 'Auto-run e coordenação de portfólios.',
    icon: Wallet,
  },
  {
    value: 'post-trade',
    label: 'Pós-trade',
    description: 'Histórico operacional e auditoria.',
    icon: FileCheck2,
  },
];

const TRADING_V2_MODE_TAB_TARGETS: Record<TradingWorkspacePrimaryMode, TradingTabKey[]> = {
  operate: ['overview', 'orders', 'positions'],
  'ai-signals': ['signals-auto', 'signals', 'analysis'],
  'portfolio-auto': ['portfolio-auto'],
  'post-trade': ['history'],
};

const TRADING_V2_TAB_TO_MODE: Partial<Record<TradingTabKey, TradingWorkspacePrimaryMode>> = {
  overview: 'operate',
  orders: 'operate',
  positions: 'operate',
  'signals-auto': 'ai-signals',
  signals: 'ai-signals',
  analysis: 'ai-signals',
  'portfolio-auto': 'portfolio-auto',
  history: 'post-trade',
  chart: 'operate',
  orderbook: 'operate',
  postmortems: 'post-trade',
  account: 'post-trade',
  control: 'post-trade',
  lab: 'ai-signals',
};

function resolveTradingV2PrimaryMode(tab: TradingTabKey): TradingWorkspacePrimaryMode {
  return TRADING_V2_TAB_TO_MODE[tab] ?? 'operate';
}

/**
 * Núcleo de composição do Trading.
 * Mantém a regra de hooks estável: todos os hooks são chamados sempre na mesma ordem.
 * O gate de autenticação fica no wrapper externo (`Trading.tsx`), e este módulo assume
 * execução já autenticada para evitar regressões de render condicional.
 */
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

  // Derivados de posições — calculados aqui (antes dos early returns) para que o
  // useEffect abaixo não viole a Regra de Hooks do React.
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

  // Subscrição de quotes de posições abertas (futures) para PnL em tempo real.
  // DEVE ficar antes dos early returns para não violar a Regra de Hooks do React.
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
  // `wsStatusData` já é o payload `{ success, data: KucoinWsStatus }`.
  // O accessor extra `.data` fazia `wsStatus` ficar sempre undefined e o badge nunca renderizar.
  const wsStatus = wsStatusData?.data;
  useEffect(() => {
    if (!activeAutoRunDetail?.run) {
      return;
    }
    const run = activeAutoRunDetail.run;
    const isTerminal = run.status === 'succeeded'
      || run.status === 'no_trade'
      || run.status === 'blocked'
      || run.status === 'failed'
      || run.status === 'cancelled';
    if (!isTerminal) {
      return;
    }
    const eventKey = `${run.id}:${run.status}`;
    if (emittedTerminalAutoRunsRef.current.has(eventKey)) {
      return;
    }

    const payloadRecord = run.payload && typeof run.payload === 'object' && !Array.isArray(run.payload)
      ? run.payload as Record<string, unknown>
      : {};
    const decision = Array.isArray(activeAutoRunDetail.decisions) ? activeAutoRunDetail.decisions[0] : undefined;
    const entryPayload = decision?.entryPayload && typeof decision.entryPayload === 'object' && !Array.isArray(decision.entryPayload)
      ? decision.entryPayload as Record<string, unknown>
      : null;
    const noTradeReasonCode = entryPayload && typeof entryPayload.noTradeReasonCode === 'string'
      ? entryPayload.noTradeReasonCode
      : null;
    const terminalReasonCode = typeof run.terminalReasonCode === 'string' && run.terminalReasonCode.length > 0
      ? run.terminalReasonCode
      : noTradeReasonCode;
    const payloadMarketType = typeof payloadRecord.marketType === 'string' ? payloadRecord.marketType : null;
    const payloadUniverseScope = typeof payloadRecord.universeScope === 'string' ? payloadRecord.universeScope : null;
    const payloadSymbol = typeof payloadRecord.symbol === 'string' ? payloadRecord.symbol : null;

    const outcome = run.status === 'succeeded'
      ? (run.runType === 'signal_auto' && (decision?.approved === false || Boolean(noTradeReasonCode)) ? 'no_trade' : 'succeeded')
      : run.status;

    emitTradingTelemetry(
      run.status === 'succeeded' ? 'trading.autorun.completed' : 'trading.autorun.terminal',
      {
        runType: run.runType,
        runId: run.id,
        outcome,
        status: run.status,
        terminalReasonCode,
        marketType: payloadMarketType,
        universeScope: payloadUniverseScope,
        symbol: payloadSymbol,
        noTradeReasonCode,
        error: run.error,
      },
      run.status === 'failed' ? 'error' : (run.status === 'cancelled' || run.status === 'blocked') ? 'warn' : 'info',
    );

    if (run.runType === 'signal_auto') {
      if (run.status === 'succeeded') {
        emitTradingTelemetry(
          outcome === 'no_trade'
            ? 'trading.signal.generation.no_trade'
            : 'trading.signal.generation.succeeded',
          {
            source: 'auto_run',
            runId: run.id,
            marketType: payloadMarketType,
            symbol: payloadSymbol,
            noTradeReasonCode,
          },
        );
      } else if (run.status === 'no_trade') {
        emitTradingTelemetry(
          'trading.signal.generation.no_trade',
          {
            source: 'auto_run',
            runId: run.id,
            marketType: payloadMarketType,
            symbol: payloadSymbol,
            noTradeReasonCode: terminalReasonCode,
          },
        );
      } else if (run.status === 'blocked') {
        emitTradingTelemetry(
          'trading.signal.generation.blocked',
          {
            source: 'auto_run',
            runId: run.id,
            marketType: payloadMarketType,
            symbol: payloadSymbol,
            reasonCode: terminalReasonCode,
            error: run.error,
          },
          'warn',
        );
      } else if (run.status === 'failed') {
        const failureClass = classifySignalGenerationFailure(new Error(run.error ?? 'Signal auto run falhou'));
        emitTradingTelemetry(
          failureClass === 'blocked'
            ? 'trading.signal.generation.blocked'
            : 'trading.signal.generation.failed',
          {
            source: 'auto_run',
            runId: run.id,
            marketType: payloadMarketType,
            symbol: payloadSymbol,
            error: run.error,
          },
          failureClass === 'blocked' ? 'warn' : 'error',
        );
      }
    }

    emittedTerminalAutoRunsRef.current.add(eventKey);
  }, [activeAutoRunDetail]);

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
    techniqueOptions: signalTechniqueOptions,
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
  const tradingWorkspaceV2Enabled = Boolean(status.featureFlags?.tradingWorkspaceV2Enabled);
  const activePrimaryMode = resolveTradingV2PrimaryMode(activeTab);
  const isOperateMode = activePrimaryMode === 'operate';
  const isAiSignalsMode = activePrimaryMode === 'ai-signals';
  const engineHealth: 'healthy' | 'degraded' | 'offline' = !isTradingEnabled
    ? 'offline'
    : (criticalApiError || status.circuitBreaker.state.toLowerCase() === 'open')
      ? 'degraded'
      : 'healthy';
  const riskModeLabel = `${controlMode} • ${selectedMarketType}${selectedMarketType === 'margin' ? `/${selectedMarginMode}` : ''}`;

  const visibleTabValues = useMemo(
    () => new Set(visibleTabOptions.map((tab) => tab.value as TradingTabKey)),
    [visibleTabOptions],
  );

  const handlePrimaryModeChange = (mode: TradingWorkspacePrimaryMode) => {
    const targetTab = TRADING_V2_MODE_TAB_TARGETS[mode].find((tab) => visibleTabValues.has(tab))
      ?? TRADING_V2_MODE_TAB_TARGETS[mode][0]
      ?? visibleTabOptions[0]?.value;
    if (!targetTab) {
      return;
    }
    handleTabChange(targetTab);
  };

  const handleWorkspaceChangeV2 = (workspace: string) => {
    handleWorkspaceChange(workspace as TradingWorkspaceKey);
  };

  const v2SidebarSections = useMemo(
    () => [
      {
        id: 'risk-account',
        title: 'Risk & Account',
        description: 'Controles de risco e governança de conta fora da navegação principal.',
        actions: [
          {
            id: 'risk-account-open',
            label: 'Conta e risco',
            description: 'Acessar limites, saldos e regras operacionais.',
            onSelect: () => handleTabChange('account'),
          },
        ],
      },
      {
        id: 'research-governance',
        title: 'Research & Governance',
        description: 'Capacidades avançadas acessadas por progressive disclosure.',
        actions: [
          {
            id: 'research-open',
            label: 'Lab / Research',
            description: 'Explorar hipóteses e validações de pesquisa.',
            onSelect: () => handleTabChange('lab'),
          },
          {
            id: 'governance-open',
            label: 'Governança operacional',
            description: 'Abrir histórico de controles e handoff.',
            onSelect: () => handleTabChange('control'),
          },
        ],
      },
    ],
    [handleTabChange],
  );

  const v2BottomTraySections = useMemo(
    () => [
      {
        id: 'advanced-market',
        title: 'Mercado avançado',
        description: 'Ferramentas de profundidade e contexto de execução.',
        actions: [
          {
            id: 'advanced-order-book',
            label: 'Advanced order book',
            description: 'Abrir profundidade detalhada de livro de ofertas.',
            onSelect: () => handleTabChange('orderbook'),
          },
          {
            id: 'chart-open',
            label: 'Chart avançado',
            description: 'Abrir chart operacional completo.',
            onSelect: () => handleTabChange('chart'),
          },
        ],
      },
      {
        id: 'post-trade',
        title: 'Pós-trade avançado',
        description: 'Auditoria detalhada sem poluir o fluxo principal.',
        actions: [
          {
            id: 'postmortem-detail-open',
            label: 'Postmortem detail',
            description: 'Abrir post-mortems detalhados para revisão.',
            onSelect: () => handleTabChange('postmortems'),
          },
          {
            id: 'history-open',
            label: 'Histórico completo',
            description: 'Acessar histórico de ordens e decisões.',
            onSelect: () => handleTabChange('history'),
          },
        ],
      },
    ],
    [handleTabChange],
  );

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
            {showOperationalAlerts ? (
              <TradingOperationalAlerts {...operationalAlertsSectionProps} />
            ) : null}
            <TradingHeaderSection {...headerSectionProps} />

            <TradingWorkspaceShell
              activeMode={activePrimaryMode}
              activeWorkspace={activeWorkspace}
              bottomTraySections={v2BottomTraySections}
              environmentMode="real"
              modeOptions={TRADING_V2_MODE_OPTIONS}
              onModeChange={handlePrimaryModeChange}
              onWorkspaceChange={handleWorkspaceChangeV2}
              sidebarSections={v2SidebarSections}
              workspaceOptions={tradingWorkspaceOptions}
            >
              {isOperateMode ? (
                <TradingWorkspaceOperateMode
                  chartArea={(
                    <div className="[&>div]:mt-0">
                      <TradingChartTabContent {...operationalTabsSectionProps.chartTabProps} />
                    </div>
                  )}
                  orderTicket={(
                    <TradingWorkspaceCompactOrderTicket
                      bestAskPrice={primaryTabsSectionProps.overviewTabProps.bestAskPrice}
                      bestBidPrice={primaryTabsSectionProps.overviewTabProps.bestBidPrice}
                      onOpenNewOrderDialog={primaryTabsSectionProps.overviewTabProps.onOpenNewOrderDialog}
                      onOpenOcoOrderDialog={primaryTabsSectionProps.ordersTabProps.onOpenOcoOrderDialog}
                      onQuickOrder={primaryTabsSectionProps.overviewTabProps.onQuickOrder}
                      selectedSymbol={headerSectionProps.selectedSymbol}
                      tradingEnabled={primaryTabsSectionProps.overviewTabProps.tradingEnabled}
                    />
                  )}
                  statusCard={(
                    <TradingWorkspaceOperateStatusCard
                      circuitBreakerFailures={statsSecondarySectionProps.circuitBreakerFailures}
                      circuitBreakerState={statsSecondarySectionProps.circuitBreakerState}
                      engineHealth={engineHealth}
                      riskMode={riskModeLabel}
                      wsConnecting={headerSectionProps.wsConnecting}
                      wsEnabled={headerSectionProps.wsEnabled}
                      wsHealthy={headerSectionProps.wsHealthy}
                    />
                  )}
                  openPositionsPanel={(
                    <div className="[&>div]:mt-0">
                      <TradingPositionsTabContent {...primaryTabsSectionProps.positionsTabProps} />
                    </div>
                  )}
                  openOrdersPanel={(
                    <div className="[&>div]:mt-0">
                      <TradingOrdersTabContent {...primaryTabsSectionProps.ordersTabProps} />
                    </div>
                  )}
                  advancedDisclosure={(
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        <div className="[&>div]:mt-0">
                          <TradingAccountTabContent {...operationalTabsSectionProps.accountTabProps} />
                        </div>
                        <div className="[&>div]:mt-0">
                          <TradingControlTabContent {...operationalTabsSectionProps.controlTabProps} />
                        </div>
                      </div>
                      <div className="[&>div]:mt-0">
                        <TradingOrderBookTabContent {...operationalTabsSectionProps.orderBookTabProps} />
                      </div>
                    </div>
                  )}
                />
              ) : isAiSignalsMode ? (
                <TradingWorkspaceAiSignalsCockpitMode
                  activeAutoRunDetail={primaryTabsSectionProps.signalsAutoTabProps.activeAutoRunDetail}
                  activeAutoRunId={primaryTabsSectionProps.signalsAutoTabProps.activeAutoRunId}
                  allowedModes={primaryTabsSectionProps.signalsAutoTabProps.allowedModes}
                  autoMix={primaryTabsSectionProps.signalsAutoTabProps.autoMix}
                  autoModeOptions={primaryTabsSectionProps.signalsAutoTabProps.autoModeOptions}
                  autoSelectAllAssets={primaryTabsSectionProps.signalsAutoTabProps.autoSelectAllAssets}
                  autoSelectedAssetKeys={primaryTabsSectionProps.signalsAutoTabProps.autoSelectedAssetKeys}
                  autoSignalAssetOptions={primaryTabsSectionProps.signalsAutoTabProps.autoSignalAssetOptions}
                  autoUniverseScope={primaryTabsSectionProps.signalsAutoTabProps.autoUniverseScope}
                  canOverrideReasoningMode={primaryTabsSectionProps.signalsAutoTabProps.canOverrideReasoningMode}
                  environmentMode="real"
                  hasAutoSignalAssetsError={primaryTabsSectionProps.signalsAutoTabProps.hasAutoSignalAssetsError}
                  isLoadingAutoSignalAssets={primaryTabsSectionProps.signalsAutoTabProps.isLoadingAutoSignalAssets}
                  isLoadingSignals={primaryTabsSectionProps.signalsTabProps.isLoadingSignals}
                  locale={primaryTabsSectionProps.signalsAutoTabProps.locale}
                  marketType={primaryTabsSectionProps.signalsTabProps.marketType}
                  onAllowedModesChange={primaryTabsSectionProps.signalsAutoTabProps.onAllowedModesChange}
                  onAutoMixChange={primaryTabsSectionProps.signalsAutoTabProps.onAutoMixChange}
                  onAutoSelectAllAssetsChange={primaryTabsSectionProps.signalsAutoTabProps.onAutoSelectAllAssetsChange}
                  onAutoSelectedAssetKeysChange={primaryTabsSectionProps.signalsAutoTabProps.onAutoSelectedAssetKeysChange}
                  onAutoUniverseScopeChange={primaryTabsSectionProps.signalsAutoTabProps.onAutoUniverseScopeChange}
                  onOpenGeneratedSignal={primaryTabsSectionProps.signalsAutoTabProps.onOpenGeneratedSignal}
                  onOpenSignalsPanel={primaryTabsSectionProps.signalsAutoTabProps.onOpenSignalsPanel}
                  onReasoningModeChange={primaryTabsSectionProps.signalsAutoTabProps.onReasoningModeChange}
                  onRunAutoNow={primaryTabsSectionProps.signalsAutoTabProps.onRunAutoNow}
                  onSelectAutoRun={primaryTabsSectionProps.signalsAutoTabProps.onSelectAutoRun}
                  reasoningMode={primaryTabsSectionProps.signalsAutoTabProps.reasoningMode}
                  reasoningModeOptions={primaryTabsSectionProps.signalsAutoTabProps.reasoningModeOptions}
                  renderSignalTypeBadge={primaryTabsSectionProps.signalsTabProps.renderSignalTypeBadge}
                  selectedSignal={primaryTabsSectionProps.signalsTabProps.selectedSignal}
                  signalAutoRunPending={primaryTabsSectionProps.signalsAutoTabProps.signalAutoRunPending}
                  signalAutoRuns={primaryTabsSectionProps.signalsAutoTabProps.signalAutoRuns}
                  signals={primaryTabsSectionProps.signalsTabProps.signals}
                  t={primaryTabsSectionProps.signalsAutoTabProps.t}
                  timeZone={primaryTabsSectionProps.signalsAutoTabProps.timeZone}
                  topTradingCandidates={primaryTabsSectionProps.signalsAutoTabProps.topTradingCandidates}
                />
              ) : (
                <>
                  <TradingStatsPrimaryRow {...statsPrimarySectionProps} />
                  <TradingStatsSecondaryRow {...statsSecondarySectionProps} />

                  <Tabs value={activeTab} onValueChange={handleTabChange}>
                    <TradingPrimaryTabsSection {...primaryTabsSectionProps} />
                    <TradingOperationalTabsSection {...operationalTabsSectionProps} />
                  </Tabs>
                </>
              )}
            </TradingWorkspaceShell>
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
