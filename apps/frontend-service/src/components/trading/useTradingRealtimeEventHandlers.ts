import { useCallback } from 'react';
import { queryClient } from '@/lib/queryClient';
import { frontendLogger } from '@/lib/logger';

type TickerPayload = {
  price: number | string;
  symbol?: string | null;
};

type UseTradingRealtimeEventHandlersOptions = {
  isFuturesMarket: boolean;
  setPositionLiveQuotes: (updater: (previous: Record<string, number>) => Record<string, number>) => void;
};

export function useTradingRealtimeEventHandlers({
  isFuturesMarket,
  setPositionLiveQuotes,
}: UseTradingRealtimeEventHandlersOptions) {
  const handleWebsocketError = useCallback((error: unknown) => {
    frontendLogger.warn('WebSocket KuCoin indisponível - fallback REST ativo', { error });
  }, []);

  const handleTickerUpdate = useCallback((data: TickerPayload) => {
    if (!isFuturesMarket) return;
    const next = Number(data.price);
    if (!Number.isFinite(next) || next <= 0) return;
    const symbolKey = (data.symbol ?? '').toUpperCase();
    if (!symbolKey) return;
    setPositionLiveQuotes((previous) => {
      if (previous[symbolKey] === next) return previous;
      return { ...previous, [symbolKey]: next };
    });
  }, [isFuturesMarket, setPositionLiveQuotes]);

  const handleOrderUpdate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/orders'] });
    void queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/account'] });
  }, []);

  const handlePositionUpdate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/positions'] });
    void queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/account'] });
  }, []);

  const handleBalanceUpdate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/account'] });
  }, []);

  return {
    handleBalanceUpdate,
    handleOrderUpdate,
    handlePositionUpdate,
    handleTickerUpdate,
    handleWebsocketError,
  };
}
