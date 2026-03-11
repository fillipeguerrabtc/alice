import type {
  AccountTabProps,
  ChartTabProps,
  ControlTabProps,
  HistoryTabProps,
  OperationalTabsSectionProps,
  OrderBookTabProps,
  PostMortemsTabProps,
} from './TradingSectionPropsBuilderTypes';

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

