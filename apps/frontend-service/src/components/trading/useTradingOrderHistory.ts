import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { TradingOrder } from './TradingDomainTypes';

type TradingMarketType = 'futures' | 'spot' | 'margin';

type NotifyFn = (params: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

type UseTradingOrderHistoryOptions = {
  activeTab: string;
  selectedMarketType: TradingMarketType;
  t: (key: string) => string;
  notify: NotifyFn;
};

type UseTradingOrderHistoryResult = {
  orderHistoryItems: TradingOrder[];
  orderHistoryHasMore: boolean;
  orderHistoryLoading: boolean;
  orderHistorySelectedIds: Set<string>;
  allOrderHistorySelected: boolean;
  hasOrderHistorySelection: boolean;
  isDeletingOrderHistory: boolean;
  fetchOrderHistory: (options?: { reset?: boolean }) => Promise<void>;
  deleteOrderHistory: (payload: { ids?: string[]; all?: boolean; scope?: 'self' | 'tenant' }) => void;
  toggleOrderHistorySelection: (orderId: string, checked: boolean) => void;
  toggleOrderHistorySelectAll: (checked: boolean) => void;
};

export function useTradingOrderHistory(options: UseTradingOrderHistoryOptions): UseTradingOrderHistoryResult {
  const { activeTab, selectedMarketType, t, notify } = options;
  const [orderHistoryItems, setOrderHistoryItems] = useState<TradingOrder[]>([]);
  const [orderHistoryCursor, setOrderHistoryCursor] = useState<string | null>(null);
  const [orderHistoryHasMore, setOrderHistoryHasMore] = useState(false);
  const [orderHistoryLoading, setOrderHistoryLoading] = useState(false);
  const [orderHistorySelectedIds, setOrderHistorySelectedIds] = useState<Set<string>>(new Set());
  const orderHistoryMarketRef = useRef<string | null>(null);
  const orderHistoryLoadingRef = useRef(false);

  const fetchOrderHistory = useCallback(
    async (optionsArg: { reset?: boolean } = {}) => {
      if (orderHistoryLoadingRef.current) return;
      const reset = optionsArg.reset ?? false;
      orderHistoryLoadingRef.current = true;
      setOrderHistoryLoading(true);
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (!reset && orderHistoryCursor) {
        params.set('cursor', orderHistoryCursor);
      }
      if (selectedMarketType) {
        params.set('marketType', selectedMarketType);
      }
      try {
        const res = await apiRequest('GET', `/api/integrations/trading/orders/history?${params.toString()}`);
        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload.error || t('trading.errors.historyFailed'));
        }
        const nextCursor = payload.nextCursor as string | null;
        const items = payload.data as TradingOrder[];
        setOrderHistoryItems((prev) => (reset ? items : [...prev, ...items]));
        setOrderHistoryCursor(nextCursor ?? null);
        setOrderHistoryHasMore(Boolean(nextCursor));
        if (reset) {
          setOrderHistorySelectedIds(new Set());
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : t('errors.generic');
        notify({
          title: t('trading.errors.historyFailed'),
          description: message,
          variant: 'destructive',
        });
      } finally {
        setOrderHistoryLoading(false);
        orderHistoryLoadingRef.current = false;
      }
    },
    [notify, orderHistoryCursor, selectedMarketType, t],
  );

  useEffect(() => {
    if (activeTab !== 'history') return;
    const marketChanged = orderHistoryMarketRef.current !== selectedMarketType;
    const shouldReset = marketChanged || orderHistoryItems.length === 0;
    if (!shouldReset) return;
    orderHistoryMarketRef.current = selectedMarketType;
    void fetchOrderHistory({ reset: true });
  }, [activeTab, fetchOrderHistory, orderHistoryItems.length, selectedMarketType]);

  const deleteOrderHistoryMutation = useMutation({
    mutationFn: async ({ ids, all, scope }: { ids?: string[]; all?: boolean; scope?: 'self' | 'tenant' }) => {
      const res = await apiRequest('POST', '/api/integrations/trading/orders/history/delete', {
        ids,
        all,
        scope,
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || t('trading.errors.historyDeleteFailed'));
      }
      return payload;
    },
    onSuccess: () => {
      notify({ title: t('trading.success.historyDeleted') });
      void fetchOrderHistory({ reset: true });
    },
    onError: (error: Error) => {
      notify({
        title: t('trading.errors.historyDeleteFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const toggleOrderHistorySelection = useCallback((orderId: string, checked: boolean) => {
    setOrderHistorySelectedIds((prev) => {
      const updated = new Set(prev);
      if (checked) {
        updated.add(orderId);
      } else {
        updated.delete(orderId);
      }
      return updated;
    });
  }, []);

  const toggleOrderHistorySelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setOrderHistorySelectedIds(new Set(orderHistoryItems.map((item) => item.id)));
        return;
      }
      setOrderHistorySelectedIds(new Set());
    },
    [orderHistoryItems],
  );

  const allOrderHistorySelected =
    orderHistoryItems.length > 0 && orderHistorySelectedIds.size === orderHistoryItems.length;
  const hasOrderHistorySelection = orderHistorySelectedIds.size > 0;

  return {
    orderHistoryItems,
    orderHistoryHasMore,
    orderHistoryLoading,
    orderHistorySelectedIds,
    allOrderHistorySelected,
    hasOrderHistorySelection,
    isDeletingOrderHistory: deleteOrderHistoryMutation.isPending,
    fetchOrderHistory,
    deleteOrderHistory: deleteOrderHistoryMutation.mutate,
    toggleOrderHistorySelection,
    toggleOrderHistorySelectAll,
  };
}
