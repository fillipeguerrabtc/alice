import { useCallback, useMemo } from 'react';
import { ApiError } from '@/lib/queryClient';
import { OrderStatusBadge, SignalTypeBadge } from './TradingDisplayUtils';

type UseTradingOperationalPresentationWrappersOptions = {
  errors: unknown[];
  wsConnected: boolean;
  wsEnabled: boolean;
  wsError: string | null;
};

export function useTradingOperationalPresentationWrappers({
  errors,
  wsConnected,
  wsEnabled,
  wsError,
}: UseTradingOperationalPresentationWrappersOptions) {
  const criticalApiError = useMemo(
    () => errors.find((error): error is ApiError => error instanceof ApiError) ?? null,
    [errors],
  );

  const renderOrderStatusBadge = useCallback(
    (status: string) => <OrderStatusBadge status={status} />,
    [],
  );

  const renderSignalTypeBadge = useCallback(
    (signalType: string) => <SignalTypeBadge type={signalType} />,
    [],
  );

  const wsHealthy = wsEnabled && wsConnected && !wsError;

  return {
    criticalApiError,
    renderOrderStatusBadge,
    renderSignalTypeBadge,
    wsHealthy,
  };
}
