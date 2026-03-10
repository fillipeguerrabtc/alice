import { useCallback, type Dispatch, type SetStateAction } from 'react';

type TradingMarketType = 'futures' | 'spot' | 'margin';

type RefetchFn = () => Promise<unknown> | unknown;

type UseTradingWorkspaceActionHandlersOptions = {
  deleteOrderHistory: (payload: { ids?: string[]; all?: boolean; scope?: 'self' | 'tenant' }) => void;
  fetchOrderHistory: (options?: { reset?: boolean }) => Promise<void>;
  invalidateAccountQueries: () => void;
  orderHistorySelectedIds: Set<string>;
  refetchKlines: RefetchFn;
  refetchPositions: RefetchFn;
  refetchPostmortems: RefetchFn;
  runAutoSignalNow: () => void;
  setSelectedMarketType: Dispatch<SetStateAction<TradingMarketType>>;
  setSelectedSymbol: Dispatch<SetStateAction<string>>;
  setShowOcoOrderDialog: Dispatch<SetStateAction<boolean>>;
  setShowReviewOrderDialog: Dispatch<SetStateAction<boolean>>;
  setShowRiskConfigDialog: Dispatch<SetStateAction<boolean>>;
};

export function useTradingWorkspaceActionHandlers(options: UseTradingWorkspaceActionHandlersOptions) {
  const {
    deleteOrderHistory,
    fetchOrderHistory,
    invalidateAccountQueries,
    orderHistorySelectedIds,
    refetchKlines,
    refetchPositions,
    refetchPostmortems,
    runAutoSignalNow,
    setSelectedMarketType,
    setSelectedSymbol,
    setShowOcoOrderDialog,
    setShowReviewOrderDialog,
    setShowRiskConfigDialog,
  } = options;

  const handleOpenRiskConfigDialog = useCallback(() => {
    setShowRiskConfigDialog(true);
  }, [setShowRiskConfigDialog]);

  const handleCancelRiskConfigDialog = useCallback(() => {
    setShowRiskConfigDialog(false);
  }, [setShowRiskConfigDialog]);

  const handleMarketTypeChange = useCallback((value: TradingMarketType) => {
    // Reset do símbolo ao trocar mercado evita queries downstream com contexto antigo.
    setSelectedSymbol('');
    setSelectedMarketType(value);
  }, [setSelectedMarketType, setSelectedSymbol]);

  const handleOpenOcoOrderDialog = useCallback(() => {
    setShowOcoOrderDialog(true);
  }, [setShowOcoOrderDialog]);

  const handleCloseReviewOrderDialog = useCallback(() => {
    setShowReviewOrderDialog(false);
  }, [setShowReviewOrderDialog]);

  const handleRefreshPositions = useCallback(() => {
    void refetchPositions();
  }, [refetchPositions]);

  const handleRunAutoNow = useCallback(() => {
    runAutoSignalNow();
  }, [runAutoSignalNow]);

  const handleRefreshAccount = useCallback(() => {
    invalidateAccountQueries();
  }, [invalidateAccountQueries]);

  const handleRefreshKlines = useCallback(() => {
    void refetchKlines();
  }, [refetchKlines]);

  const handleDeleteAllMineHistory = useCallback(() => {
    deleteOrderHistory({ all: true, scope: 'self' });
  }, [deleteOrderHistory]);

  const handleDeleteAllTenantHistory = useCallback(() => {
    deleteOrderHistory({ all: true, scope: 'tenant' });
  }, [deleteOrderHistory]);

  const handleDeleteSelectedHistory = useCallback(() => {
    deleteOrderHistory({ ids: Array.from(orderHistorySelectedIds), scope: 'self' });
  }, [deleteOrderHistory, orderHistorySelectedIds]);

  const handleFetchOrderHistory = useCallback(() => {
    void fetchOrderHistory();
  }, [fetchOrderHistory]);

  const handleRefreshPostmortems = useCallback(() => {
    void refetchPostmortems();
  }, [refetchPostmortems]);

  return {
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
  };
}
