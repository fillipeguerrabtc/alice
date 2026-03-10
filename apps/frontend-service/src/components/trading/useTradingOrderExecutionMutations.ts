import { useMutation } from '@tanstack/react-query';
import { parseLocaleNumberInput } from '@/lib/utils';
import { apiRequest } from '@/lib/queryClient';
import { createDefaultOrderForm } from './TradingFormDefaults';
import type { TradingOrderForm } from './TradingFormDefaults';
import type { TradingOrderExecutionMutationOptions } from './trading-control-order-types';

export function useTradingOrderExecutionMutations(options: TradingOrderExecutionMutationOptions) {
  const {
    notify,
    refetchAccount,
    refetchOrders,
    selectedMarginMode,
    selectedMarketType,
    selectedSymbol,
    setOrderForm,
    setShowNewOrderDialog,
    t,
  } = options;

  const createOrderMutation = useMutation({
    mutationFn: async (data: TradingOrderForm) => {
      const isFuturesOrder = selectedMarketType === 'futures';
      const sizeValue = data.size ? parseLocaleNumberInput(data.size) ?? NaN : NaN;
      const fundsValue = data.funds ? parseLocaleNumberInput(data.funds) ?? NaN : NaN;
      const priceValue = data.orderType === 'limit' ? parseLocaleNumberInput(data.price) : null;
      const stopLossValue = data.stopLoss ? parseLocaleNumberInput(data.stopLoss) : null;
      const takeProfitValue = data.takeProfit ? parseLocaleNumberInput(data.takeProfit) : null;
      const hasSize = Number.isFinite(sizeValue) && sizeValue > 0;
      const hasFunds = Number.isFinite(fundsValue) && fundsValue > 0;
      const isMarketBuy = data.orderType === 'market' && data.side === 'buy';

      if (isFuturesOrder) {
        if (!hasSize) {
          throw new Error('Quantidade inválida. Use um número positivo.');
        }
        if (!Number.isInteger(sizeValue)) {
          throw new Error('Quantidade deve ser um número inteiro de contratos.');
        }
      } else if (isMarketBuy) {
        if (!hasSize && !hasFunds) {
          throw new Error('Informe quantidade ou funds para ordem a mercado.');
        }
      } else if (!hasSize) {
        throw new Error('Quantidade inválida. Use um número positivo.');
      }

      let leverageValue: number | undefined;
      if (isFuturesOrder) {
        leverageValue = parseLocaleNumberInput(data.leverage) ?? NaN;
        if (!Number.isFinite(leverageValue) || leverageValue <= 0) {
          throw new Error('Alavancagem inválida.');
        }
      }

      if (data.orderType === 'limit' && (!priceValue || !Number.isFinite(priceValue) || priceValue <= 0)) {
        throw new Error('Preço inválido. Use um número positivo.');
      }

      const res = await apiRequest('POST', '/api/integrations/trading/orders', {
        symbol: selectedSymbol || undefined,
        side: data.side,
        orderType: data.orderType,
        size: hasSize ? sizeValue : undefined,
        funds: hasFunds ? fundsValue : undefined,
        price: data.orderType === 'limit' ? priceValue ?? undefined : undefined,
        leverage: leverageValue,
        marketType: selectedMarketType,
        marginMode: selectedMarketType === 'margin' ? selectedMarginMode : undefined,
      });
      const payload = await res.json();
      let stopOrderError: string | null = null;

      if (data.stopLoss || data.takeProfit) {
        if (!hasSize) {
          stopOrderError = t('trading.errors.stopOrderRequiresSize');
          return {
            ...payload,
            stopOrderError,
          };
        }
        const stopSide = data.side === 'buy' ? 'sell' : 'buy';
        const stopRes = await apiRequest('POST', '/api/integrations/trading/stop-orders', {
          symbol: selectedSymbol || undefined,
          side: stopSide,
          size: sizeValue,
          stopLoss: stopLossValue ?? undefined,
          takeProfit: takeProfitValue ?? undefined,
          leverage: leverageValue,
          orderType: 'market',
          stopPriceType: 'MP',
          marketType: selectedMarketType,
          marginMode: selectedMarketType === 'margin' ? selectedMarginMode : undefined,
        });
        if (!stopRes.ok) {
          stopOrderError = await stopRes.text();
        }
      }

      return {
        ...payload,
        stopOrderError,
      };
    },
    onSuccess: (data) => {
      notify({
        title: t('trading.success.orderCreated'),
        description: t('trading.success.orderCreatedDesc'),
      });
      if (data?.stopOrderError) {
        notify({
          title: t('trading.errors.stopOrderFailed'),
          description: data.stopOrderError,
          variant: 'destructive',
        });
      }
      setShowNewOrderDialog(false);
      setOrderForm(() => createDefaultOrderForm());
      refetchOrders();
      refetchAccount();
    },
    onError: (error: Error) => {
      notify({
        title: t('trading.errors.orderFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const cancelOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await apiRequest('DELETE', `/api/integrations/trading/orders/${orderId}`);
      return res.json();
    },
    onSuccess: () => {
      notify({
        title: t('trading.success.orderCancelled'),
      });
      refetchOrders();
    },
    onError: (error: Error) => {
      notify({
        title: t('trading.errors.cancelFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const syncOrdersMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/integrations/trading/orders/sync');
      return res.json();
    },
    onSuccess: (data) => {
      notify({
        title: t('trading.success.ordersSynced'),
        description: t('trading.success.ordersSyncedDesc', {
          synced: data.data?.synced || 0,
          errors: data.data?.errors || 0,
        }),
      });
      refetchOrders();
    },
    onError: (error: Error) => {
      notify({
        title: t('trading.errors.syncFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    cancelOrderMutation,
    createOrderMutation,
    syncOrdersMutation,
  };
}
