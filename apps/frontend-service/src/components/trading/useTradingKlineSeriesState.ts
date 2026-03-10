import { useEffect, useMemo, useRef, useState } from 'react';
import type { KlineData as WsKlineData } from '@/hooks/useKucoinWebSocket';
import type { KlineData as ChartKlineData } from './CandleChart';

type UseTradingKlineSeriesStateOptions = {
  klinesData?: { success: boolean; data: ChartKlineData[] };
  normalizedSymbol: string;
  selectedMarginMode: 'cross' | 'isolated';
  selectedMarketType: 'futures' | 'spot' | 'margin';
  wsEnabled: boolean;
  wsInterval?: string;
  wsKlines: WsKlineData[];
};

export function useTradingKlineSeriesState({
  klinesData,
  normalizedSymbol,
  selectedMarginMode,
  selectedMarketType,
  wsEnabled,
  wsInterval,
  wsKlines,
}: UseTradingKlineSeriesStateOptions) {
  const [lastKlines, setLastKlines] = useState<ChartKlineData[]>([]);
  const lastKlinesSignatureRef = useRef<string>('');

  const wsKlinesForChart = useMemo<ChartKlineData[]>(() => {
    if (!wsEnabled) return [];

    return wsKlines
      .filter((kline) => kline.symbol?.toUpperCase() === normalizedSymbol)
      .filter((kline) => !wsInterval || kline.interval === wsInterval)
      .map(({ time, open, close, high, low, volume, turnover }) => ({
        time,
        open,
        close,
        high,
        low,
        volume,
        turnover,
      }));
  }, [normalizedSymbol, wsEnabled, wsInterval, wsKlines]);

  // CORREÇÃO 11/02/2026: NÃO limpar ao trocar wsInterval para preservar UX
  // de exchanges; limpar apenas quando contexto de mercado/símbolo muda.
  useEffect(() => {
    setLastKlines([]);
    lastKlinesSignatureRef.current = '';
  }, [normalizedSymbol, selectedMarketType, selectedMarginMode]);

  useEffect(() => {
    const source = wsKlinesForChart.length > 0
      ? wsKlinesForChart
      : (klinesData?.data ?? []);
    if (source.length === 0) return;

    const last = source[source.length - 1];
    const signature = [
      wsKlinesForChart.length > 0 ? 'ws' : 'rest',
      normalizedSymbol,
      wsInterval ?? '',
      selectedMarketType,
      selectedMarginMode,
      String(source.length),
      String(last?.time ?? ''),
    ].join('|');

    if (lastKlinesSignatureRef.current === signature) return;

    lastKlinesSignatureRef.current = signature;
    setLastKlines(source);
  }, [
    klinesData?.data,
    normalizedSymbol,
    selectedMarketType,
    selectedMarginMode,
    wsInterval,
    wsKlinesForChart,
  ]);

  const klines = wsKlinesForChart.length > 0
    ? wsKlinesForChart
    : (klinesData?.data && klinesData.data.length > 0 ? klinesData.data : lastKlines);

  return {
    klines,
  };
}
