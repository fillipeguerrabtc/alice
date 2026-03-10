/**
 * Trading Components - Barrel Export
 * 
 * Exporta todos os componentes de trading para uso no frontend.
 * 
 * Autor: Fillipe Guerra
 * Data: 21 de Dezembro de 2025
 */

export { CandleChart } from './CandleChart';
export type { CandleChartProps, KlineData } from './CandleChart';

export { OrderBookViz } from './OrderBookViz';
export type { OrderBookVizProps, OrderBookData, OrderBookEntry } from './OrderBookViz';

export { HandoverPanel } from './HandoverPanel';
export type { HandoverPanelProps, TradingControlMode, ControlHistoryEntry } from './HandoverPanel';

export { TechnicalAnalysisPanel } from './TechnicalAnalysisPanel';
export type { 
  TechnicalAnalysisPanelProps,
  TechnicalAnalysisResult,
  RSIResult,
  MACDResult,
  MovingAverageResult,
  BollingerResult,
  ATRResult,
  StochasticResult,
  ADXResult,
  SupportResistanceResult,
  VolumeAnalysisResult,
} from './TechnicalAnalysisPanel';

export { SignalApprovalPanel } from './SignalApprovalPanel';
export type { SignalApprovalPanelProps } from './SignalApprovalPanel';

export { NewsConfigEditor, DEFAULT_TRADING_NEWS_CONFIG, normalizeTradingNewsConfigForm } from './NewsConfigEditor';
export type { TradingNewsConfigForm, TradingNewsPresetOption } from './NewsConfigEditor';

export { MultiSelectDropdown } from './MultiSelectDropdown';

export { OcoOrderForm } from './OcoOrderForm';
export type { OcoOrderFormProps, MarketType } from './OcoOrderForm';

export { MarginDebitPanel } from './MarginDebitPanel';
export type { MarginDebitPanelProps } from './MarginDebitPanel';

export { PositionActions, PositionHistoryButton } from './PositionActions';
export type { PositionActionsProps, FuturesPosition, PositionHistoryButtonProps } from './PositionActions';

export { AccountOverview } from './AccountOverview';
export type { AccountOverviewProps } from './AccountOverview';

export { DepositWithdraw } from './DepositWithdraw';
export type { DepositWithdrawProps } from './DepositWithdraw';

export { TransferPanel } from './TransferPanel';
export type { TransferPanelProps } from './TransferPanel';

export { SubAccountsPanel } from './SubAccountsPanel';
export type { SubAccountsPanelProps } from './SubAccountsPanel';

export { LedgerHistory } from './LedgerHistory';
export type { LedgerHistoryProps } from './LedgerHistory';

export { TradeFees } from './TradeFees';
export type { TradeFeesProps } from './TradeFees';

export { TradingOrdersTabContent } from './TradingOrdersTabContent';

export { TradingPortfolioAutoTabContent } from './TradingPortfolioAutoTabContent';

export { TradingSignalsAutoTabContent } from './TradingSignalsAutoTabContent';

export { TradingLabTabContent } from './TradingLabTabContent';

export { TradingControlTabContent } from './TradingControlTabContent';

export { TradingAccountTabContent } from './TradingAccountTabContent';

export { TradingPositionsTabContent } from './TradingPositionsTabContent';

export { TradingHistoryTabContent } from './TradingHistoryTabContent';

export { TradingPostMortemsTabContent } from './TradingPostMortemsTabContent';

export { TradingAnalysisTabContent } from './TradingAnalysisTabContent';

export { TradingChartTabContent } from './TradingChartTabContent';

export { TradingDialogsSection } from './TradingDialogsSection';

export { TradingOrderBookTabContent } from './TradingOrderBookTabContent';

export { TradingOperationalTabsSection } from './TradingOperationalTabsSection';

export { TradingOperationalAlerts } from './TradingOperationalAlerts';

export { TradingPrimaryTabsSection } from './TradingPrimaryTabsSection';

export { TradingOverviewTabContent } from './TradingOverviewTabContent';

export { TradingHeaderSection } from './TradingHeaderSection';

export { TradingStatsPrimaryRow, TradingStatsSecondaryRow } from './TradingStatsRows';
export { TradingPageSections } from './TradingPageSections';

export { TradingTabsShell } from './TradingTabsShell';
export {
  TradingAuthRequiredScreen,
  TradingForbiddenScreen,
  TradingLoadingScreen,
  resolveTradingLoadingMessage,
} from './TradingAccessStates';
export {
  TradingContentLoadingState,
  TradingNotConfiguredState,
  TradingStatusErrorState,
  TradingStatusUnavailableState,
  TradingTenantRequiredState,
} from './TradingServiceStates';
export { resolveTradingStatusGate } from './TradingStatusGate';

export { TradingSignalsResultsSection } from './TradingSignalsResultsSection';

export { TradingSignalsTabContent } from './TradingSignalsTabContent';

export { TradingSignalsSchedulerSection } from './TradingSignalsSchedulerSection';

export { TradingSignalsProfileConfigurationSection } from './TradingSignalsProfileConfigurationSection';

export { TradingSignalsNewsAndActionsSection } from './TradingSignalsNewsAndActionsSection';

export { TradingNewSignalDialog } from './TradingNewSignalDialog';

export { TradingPostmortemTrainingDialog } from './TradingPostmortemTrainingDialog';

export { TradingReviewOrderDialog } from './TradingReviewOrderDialog';

export { TradingRiskConfigDialog } from './TradingRiskConfigDialog';

export { TradingNewOrderDialog } from './TradingNewOrderDialog';

export { SIGNAL_TYPES, SignalTypeBadge, OrderStatusBadge, formatDecisionSummary } from './TradingDisplayUtils';
export type { TradingSignalTypeOption } from './TradingDisplayUtils';
export { buildTradingSignalProfilePayload, isTradingSignalProfilePayloadComplete } from './TradingSignalProfilePayload';

export {
  SIGNAL_INDICATOR_OPTIONS,
  TRADING_TECHNIQUE_OPTIONS,
  AUTO_SIGNAL_MODE_OPTIONS,
  AUTO_SIGNAL_ALL_MODES,
  DEFAULT_SIGNAL_TECHNIQUES,
  DEFAULT_ENSEMBLE_CONFIG,
  DEFAULT_ARBITRAGE_CONFIG,
  FALLBACK_INTERVAL_MINUTES,
  MAX_ARBITRAGE_ASSETS,
  AUTO_SAVE_DEBOUNCE_MS,
} from './TradingSignalConfig';

export {
  TRADING_TAB_DESCRIPTORS,
  TRADING_WORKSPACE_TABS,
  TRADING_WORKSPACE_LABELS,
  findWorkspaceForTradingTab,
} from './TradingNavigationConfig';
export type { TradingTabKey, TradingWorkspaceKey, TradingTabDescriptor } from './TradingNavigationConfig';

export { getQuoteCurrencyFromSymbol, getBaseCurrencyFromSymbol, formatDurationMinutes } from './TradingPageUtils';

export {
  isFuturesAccountOverview,
  isFuturesPositionArray,
  isMarginCrossAccount,
  isMarginCrossOverview,
  isMarginIsolatedAccount,
  isMarginIsolatedOverview,
  isSpotAccountArray,
  containerVariants,
  itemVariants,
} from './TradingDomainTypes';
export type {
  TradingStatus,
  KucoinWsStatus,
  TradingSymbolsResponse,
  OrderBookResponse,
  RiskConfig,
  MarketData,
  FuturesAccountOverview,
  SpotAccount,
  MarginCrossAccountEntry,
  MarginCrossAccount,
  MarginIsolatedAssetDetail,
  MarginIsolatedAsset,
  MarginIsolatedAccount,
  TradingAccountOverview,
  PositionsResponse,
  Position,
  TradingOperationType,
  TradingSignal,
  TradingOrder,
  TradingPostMortem,
  NamespaceOption,
  TradingProfileForm,
  SignalProfilePayload,
} from './TradingDomainTypes';

export {
  createDefaultReviewOrderForm,
  createReviewOrderFormFromOrder,
  createDefaultSchedulerForm,
  createSchedulerFormFromConfig,
  createDefaultOrderForm,
  createDefaultRiskForm,
  createRiskFormFromConfig,
  createDefaultSignalForm,
  createDefaultSignalProfileForm,
} from './TradingFormDefaults';
export type {
  TradingReviewOrderForm,
  TradingSchedulerForm,
  TradingOrderForm,
  TradingRiskForm,
  TradingSignalForm,
} from './TradingFormDefaults';

export { useTradingSignalProfileState } from './useTradingSignalProfileState';
export { useTradingLocalState } from './useTradingLocalState';
export { useTradingNavigationPresentation } from './useTradingNavigationPresentation';
export { useTradingRealtimeConnectionState } from './useTradingRealtimeConnectionState';
export { useTradingRealtimeEventHandlers } from './useTradingRealtimeEventHandlers';
export { useTradingFuturesQuoteSubscription } from './useTradingFuturesQuoteSubscription';
export { useTradingDerivedPayloadState } from './useTradingDerivedPayloadState';
export { useTradingSchedulerFormSync } from './useTradingSchedulerFormSync';
export { useTradingOperationalPresentationWrappers } from './useTradingOperationalPresentationWrappers';
export { useTradingKlineInvalidation } from './useTradingKlineInvalidation';
export { useTradingAuthRedirect } from './useTradingAuthRedirect';
export { useTradingAccountInvalidation } from './useTradingAccountInvalidation';
export { useTradingSignalPresentationState } from './useTradingSignalPresentationState';
export { useTradingSymbolCandidateViewState } from './useTradingSymbolCandidateViewState';
export { useTradingRiskReviewState } from './useTradingRiskReviewState';
export { useTradingMarketOrderBookState } from './useTradingMarketOrderBookState';
export { useTradingKlineSeriesState } from './useTradingKlineSeriesState';
export { useTradingBootstrapStateSync } from './useTradingBootstrapStateSync';
export { useTradingOrderSizing, resolveTradingCurrentPrice } from './useTradingOrderSizing';
export { useTradingNewsPresets } from './useTradingNewsPresets';
export { useTradingOrderHistory } from './useTradingOrderHistory';
export { useTradingWorkspaceNavigation } from './useTradingWorkspaceNavigation';
export { useTradingControlOrderMutations } from './useTradingControlOrderMutations';
export { useTradingOrderExecutionMutations } from './useTradingOrderExecutionMutations';
export { useTradingRiskControlActions } from './useTradingRiskControlActions';
export { useTradingProfilePostmortemMutations } from './useTradingProfilePostmortemMutations';
export { useTradingSignalMutations } from './useTradingSignalMutations';
export { useTradingPipelineActions } from './useTradingPipelineActions';
export { useTradingSymbolPreferences } from './useTradingSymbolPreferences';
export { useTradingPageInteractionHandlers } from './useTradingPageInteractionHandlers';
export { useTradingReviewOrderHandlers } from './useTradingReviewOrderHandlers';
export { useTradingPostmortemTrainingHandlers } from './useTradingPostmortemTrainingHandlers';
export { useTradingPostmortemTrainingQueries } from './useTradingPostmortemTrainingQueries';
export { useTradingDialogFormHandlers } from './useTradingDialogFormHandlers';
export { useTradingSchedulerFormHandlers } from './useTradingSchedulerFormHandlers';
export { useTradingMutationActionHandlers } from './useTradingMutationActionHandlers';
export { useTradingSignalProfileActionHandlers } from './useTradingSignalProfileActionHandlers';
export { useTradingCompositeActionHandlers } from './useTradingCompositeActionHandlers';
export { useTradingSignalProfileAutoSave } from './useTradingSignalProfileAutoSave';
export { useTradingSignalSchedulerQueries } from './useTradingSignalSchedulerQueries';
export { useTradingWorkspaceActionHandlers } from './useTradingWorkspaceActionHandlers';
export { useTradingControlOrderActionSuite } from './useTradingControlOrderActionSuite';
export type {
  NotifyFn as TradingNotifyFn,
  RefetchFn as TradingRefetchFn,
  UseTradingControlOrderMutationsOptions,
  ReviewOrderUpdates,
} from './trading-control-order-types';
export { useTradingAccountPositionState } from './useTradingAccountPositionState';
export {
  buildTradingDialogsSectionProps,
  buildTradingLayoutSectionProps,
  buildTradingPrimaryTabsSectionProps,
  buildTradingOperationalTabsSectionProps,
} from './TradingSectionPropsBuilders';
export { buildTradingPageSectionProps } from './TradingPageSectionProps';
export { useTradingMarketAccountQueries } from './useTradingMarketAccountQueries';
export { useTradingMarketRealtimeQueries } from './useTradingMarketRealtimeQueries';
export { useTradingOperationalQueries } from './useTradingOperationalQueries';
export { useTradingPermissionsQuery } from './useTradingPermissionsQuery';
export { useTradingSetupQueries } from './useTradingSetupQueries';
export { useTradingSymbolAssetQueries } from './useTradingSymbolAssetQueries';
export { buildTradingOrderSummary } from './TradingOrderSummary';
export type { TradingOrderSummary, TradingOrderPnlEstimate } from './TradingOrderSummary';
export {
  buildTradingAccountSummaries,
  resolveTradingOpenPositionsCount,
  resolveTradingPriceChange,
} from './TradingDerivedMetrics';
