/**
 * CandleChart - Gráfico de Candlestick para Trading
 *
 * Componente enterprise-grade para visualização de preços em tempo real.
 * Usa lightweight-charts para renderização performática e profissional.
 *
 * Features:
 * - Candlesticks com cores verde/vermelho
 * - Volume no eixo secundário
 * - Múltiplos timeframes (1m, 3m, 5m, 15m, 1h, 4h, 1d)
 * - Atualização INCREMENTAL em tempo real via .update() (sem resetar zoom)
 * - Responsivo e touch-friendly
 * - Não desmonta chart ao trocar timeframe (corrige bug de gráfico sumindo)
 *
 * Regra 6 - SEM MOCKS: Dados reais da API KuCoin
 * Regra 8 - TypeScript strict
 * Regra 13 - i18n PT-BR/EN
 *
 * Autor: Fillipe Guerra
 * Data: 10 de Fevereiro de 2026
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createChart,
  CandlestickSeries,
  CrosshairMode,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type HistogramData,
  type CandlestickData,
  type PriceLineOptions,
} from 'lightweight-charts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatNumber } from '@/lib/utils';
import { TIMEZONE } from '@/lib/i18n';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Loader2,
} from 'lucide-react';

// ============================================================================
// TIPOS
// ============================================================================

export interface KlineData {
  time: number;
  open: string;
  close: string;
  high: string;
  low: string;
  volume: string;
  turnover: string;
}

export interface CandleChartProps {
  data: KlineData[];
  symbol: string;
  interval: string;
  intervalOptions?: Array<{ value: string; label: string }>;
  symbolOptions?: string[];
  onSymbolChange?: (symbol: string) => void;
  currentPrice?: number;
  isLoading?: boolean;
  onIntervalChange?: (interval: string) => void;
  onRefresh?: () => void;
  height?: number;
  showVolume?: boolean;
  locale?: string;
  timeZone?: string;
}

// ============================================================================
// CONSTANTES
// ============================================================================

const COLORS = {
  bullish: '#22c55e',
  bearish: '#ef4444',
  volumeUp: 'rgba(34, 197, 94, 0.35)',
  volumeDown: 'rgba(239, 68, 68, 0.35)',
  grid: '#1f2937',
  text: '#9ca3af',
  background: '#0b0f17',
  border: '#273244',
  currentPrice: '#3b82f6',
};

// ============================================================================
// HELPERS
// ============================================================================

function resolveLocale(locale?: string): string {
  return locale?.trim() || 'pt-BR';
}

function resolveTimeZone(timeZone?: string): string {
  if (!timeZone) return TIMEZONE;
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return TIMEZONE;
  }
}

function resolveTimestamp(raw: number): UTCTimestamp {
  if (raw > 10_000_000_000) {
    return Math.floor(raw / 1000) as UTCTimestamp;
  }
  return raw as UTCTimestamp;
}

function formatPrice(value: number, locale: string): string {
  return formatNumber(value, locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export function CandleChart({
  data,
  symbol,
  interval,
  intervalOptions = [],
  symbolOptions = [],
  onSymbolChange,
  currentPrice,
  isLoading = false,
  onIntervalChange,
  onRefresh,
  height = 400,
  showVolume = true,
  locale,
  timeZone,
}: CandleChartProps) {
  const { t } = useTranslation();
  const [selectedInterval, setSelectedInterval] = useState(interval);
  const resolvedLocale = resolveLocale(locale);
  const resolvedTimeZone = resolveTimeZone(timeZone);

  // Refs do chart
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLineRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  // Refs para controle de updates incrementais
  const prevDataLengthRef = useRef<number>(0);
  const prevIntervalRef = useRef<string>(interval);
  const initialFitDoneRef = useRef<boolean>(false);

  // Sincronizar selectedInterval com prop
  useEffect(() => {
    setSelectedInterval(interval);
  }, [interval]);

  // Processar dados de candle
  const candleData = useMemo((): CandlestickData[] => {
    if (!data || data.length === 0) return [];
    const sorted = [...data].sort((a, b) => a.time - b.time);
    return sorted.map((kline) => ({
      time: resolveTimestamp(kline.time),
      open: parseFloat(kline.open),
      high: parseFloat(kline.high),
      low: parseFloat(kline.low),
      close: parseFloat(kline.close),
    }));
  }, [data]);

  // Processar dados de volume
  const volumeData = useMemo((): HistogramData[] => {
    if (!data || data.length === 0) return [];
    const sorted = [...data].sort((a, b) => a.time - b.time);
    return sorted.map((kline) => {
      const open = parseFloat(kline.open);
      const close = parseFloat(kline.close);
      return {
        time: resolveTimestamp(kline.time),
        value: parseFloat(kline.volume),
        color: close >= open ? COLORS.volumeUp : COLORS.volumeDown,
      };
    });
  }, [data]);

  // Calcular mudança percentual
  const priceChange = useMemo(() => {
    if (candleData.length < 2) return { value: 0, percent: 0 };
    const first = candleData[0].open;
    const last = candleData[candleData.length - 1].close;
    const change = last - first;
    const percent = first !== 0 ? (change / first) * 100 : 0;
    return { value: change, percent };
  }, [candleData]);

  const handleIntervalChange = useCallback((newInterval: string) => {
    setSelectedInterval(newInterval);
    onIntervalChange?.(newInterval);
  }, [onIntervalChange]);

  // ============================================================================
  // CRIAÇÃO DO CHART — executado na montagem e quando layout muda
  // ============================================================================
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { color: COLORS.background },
        textColor: COLORS.text,
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: COLORS.grid, style: 0 },
        horzLines: { color: COLORS.grid, style: 0 },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: COLORS.border,
      },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 10,
        minBarSpacing: 4,
      },
      localization: {
        locale: resolvedLocale,
        priceFormatter: (value: number) => `$${formatPrice(value, resolvedLocale)}`,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.bullish,
      downColor: COLORS.bearish,
      borderVisible: false,
      wickUpColor: COLORS.bullish,
      wickDownColor: COLORS.bearish,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    if (showVolume) {
      volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
    }

    // Tooltip para crosshair
    const tooltip = document.createElement('div');
    tooltip.className = 'pointer-events-none absolute z-10 rounded-lg border border-border bg-background/95 p-3 text-xs shadow-lg';
    tooltip.style.display = 'none';
    tooltip.style.left = '12px';
    tooltip.style.top = '12px';
    container.appendChild(tooltip);
    tooltipRef.current = tooltip;

    chart.subscribeCrosshairMove((param) => {
      if (!tooltipRef.current || !param.time || !candleSeriesRef.current) {
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
        return;
      }
      const seriesData = param.seriesData.get(candleSeriesRef.current) as CandlestickData | undefined;
      if (!seriesData) {
        tooltipRef.current.style.display = 'none';
        return;
      }
      const time = new Date(Number(seriesData.time) * 1000);
      const timeLabel = time.toLocaleString(resolvedLocale, {
        timeZone: resolvedTimeZone,
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
      });
      const isUp = seriesData.close >= seriesData.open;
      tooltipRef.current.innerHTML = `
        <div class="text-muted-foreground mb-2">${timeLabel}</div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <span class="text-muted-foreground">Open:</span>
          <span class="font-mono">$${formatPrice(seriesData.open, resolvedLocale)}</span>
          <span class="text-muted-foreground">High:</span>
          <span class="font-mono text-green-500">$${formatPrice(seriesData.high, resolvedLocale)}</span>
          <span class="text-muted-foreground">Low:</span>
          <span class="font-mono text-red-500">$${formatPrice(seriesData.low, resolvedLocale)}</span>
          <span class="text-muted-foreground">Close:</span>
          <span class="font-mono ${isUp ? 'text-green-500' : 'text-red-500'}">$${formatPrice(seriesData.close, resolvedLocale)}</span>
        </div>
      `;
      tooltipRef.current.style.display = 'block';
    });

    // Resize observer
    const observer = new ResizeObserver(() => {
      if (chartRef.current) {
        chartRef.current.applyOptions({ width: container.clientWidth, height });
      }
    });
    observer.observe(container);

    // Reset controles de update incremental
    prevDataLengthRef.current = 0;
    initialFitDoneRef.current = false;

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      priceLineRef.current = null;
      prevDataLengthRef.current = 0;
      initialFitDoneRef.current = false;
    };
  }, [height, resolvedLocale, resolvedTimeZone, showVolume]);

  // ============================================================================
  // ATUALIZAÇÃO DE DADOS — incremental para real-time, full para mudança de interval
  // ============================================================================
  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current) return;
    if (candleData.length === 0) {
      // Limpar série quando não há dados (ex: durante troca de interval)
      candleSeriesRef.current.setData([]);
      if (showVolume && volumeSeriesRef.current) {
        volumeSeriesRef.current.setData([]);
      }
      prevDataLengthRef.current = 0;
      return;
    }

    const prevLength = prevDataLengthRef.current;
    const currentLength = candleData.length;
    const intervalChanged = prevIntervalRef.current !== interval;

    // CASO 1: Mudança de interval ou primeira carga → setData completo + fitContent
    if (intervalChanged || prevLength === 0) {
      candleSeriesRef.current.setData(candleData);
      if (showVolume && volumeSeriesRef.current) {
        volumeSeriesRef.current.setData(volumeData);
      }
      chartRef.current.timeScale().fitContent();
      prevDataLengthRef.current = currentLength;
      prevIntervalRef.current = interval;
      initialFitDoneRef.current = true;
      return;
    }

    // CASO 2: Último candle atualizado (mesmo timestamp) → .update() incremental
    // Isso acontece quando WS envia update do candle atual — NÃO reseta zoom
    if (currentLength === prevLength && currentLength > 0) {
      const lastCandle = candleData[currentLength - 1];
      candleSeriesRef.current.update(lastCandle);
      if (showVolume && volumeSeriesRef.current && volumeData.length > 0) {
        volumeSeriesRef.current.update(volumeData[volumeData.length - 1]);
      }
      return;
    }

    // CASO 3: Novo candle adicionado (ex: novo período abriu) → .update() + sem fitContent
    if (currentLength > prevLength) {
      // Atualizar o penúltimo candle (pode ter sido atualizado) e adicionar o novo
      const newCandles = candleData.slice(Math.max(0, prevLength - 1));
      for (const candle of newCandles) {
        candleSeriesRef.current.update(candle);
      }
      if (showVolume && volumeSeriesRef.current) {
        const newVolumes = volumeData.slice(Math.max(0, prevLength - 1));
        for (const vol of newVolumes) {
          volumeSeriesRef.current.update(vol);
        }
      }
      prevDataLengthRef.current = currentLength;
      return;
    }

    // CASO 4: Dados menores (fallback raro) → setData completo
    candleSeriesRef.current.setData(candleData);
    if (showVolume && volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(volumeData);
    }
    prevDataLengthRef.current = currentLength;
  }, [candleData, volumeData, showVolume, interval]);

  // ============================================================================
  // LINHA DE PREÇO ATUAL
  // ============================================================================
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    // Remover linha anterior
    if (priceLineRef.current) {
      try {
        candleSeriesRef.current.removePriceLine(priceLineRef.current);
      } catch {
        // Linha já foi removida (ex: chart recriado)
      }
      priceLineRef.current = null;
    }

    if (currentPrice && currentPrice > 0) {
      const lineOptions: PriceLineOptions = {
        price: currentPrice,
        color: COLORS.currentPrice,
        lineWidth: 1,
        lineStyle: 2,
        lineVisible: true,
        axisLabelVisible: true,
        axisLabelColor: COLORS.currentPrice,
        axisLabelTextColor: '#0b0f17',
        title: '',
      };
      priceLineRef.current = candleSeriesRef.current.createPriceLine(lineOptions);
    }
  }, [currentPrice]);

  // ============================================================================
  // RENDER — o chart container é SEMPRE renderizado (nunca desmontado)
  // ============================================================================

  // Loading state (apenas skeleton, sem desmontar chart)
  if (isLoading && candleData.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              {symbol}
            </CardTitle>

            {symbolOptions.length > 0 && onSymbolChange ? (
              <Select value={symbol} onValueChange={onSymbolChange}>
                <SelectTrigger className="h-8 w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-60 overflow-y-auto">
                  {symbolOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            {currentPrice ? (
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold font-mono">
                  ${formatPrice(currentPrice, resolvedLocale)}
                </span>
                <Badge
                  variant={priceChange.percent >= 0 ? 'default' : 'destructive'}
                  className="flex items-center gap-1"
                >
                  {priceChange.percent >= 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {priceChange.percent >= 0 ? '+' : ''}{priceChange.percent.toFixed(2)}%
                </Badge>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2 flex-wrap max-w-full">
            {/* Seletor de interval */}
            <div className="flex flex-wrap gap-1 max-w-full">
              {intervalOptions.map((option) => (
                <Button
                  key={option.value}
                  variant={selectedInterval === option.value ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => handleIntervalChange(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>

            {onRefresh && (
              <Button variant="outline" size="sm" onClick={onRefresh}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div style={{ height }} className="relative overflow-hidden">
          {/* Container do chart — SEMPRE montado */}
          <div ref={containerRef} className="h-full w-full" />

          {/* Overlay de loading — exibido sobre o chart quando está carregando */}
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[1px] z-10">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">{t('trading.chart.loading', 'Carregando...')}</span>
              </div>
            </div>
          )}

          {/* Overlay de "sem dados" — exibido sobre o chart quando não há dados e não está carregando */}
          {!isLoading && candleData.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <p className="text-muted-foreground text-sm">{t('trading.chart.noData')}</p>
            </div>
          )}
        </div>

        {/* Legenda */}
        <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.bullish }} />
            <span>{t('trading.chart.bullish')}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.bearish }} />
            <span>{t('trading.chart.bearish')}</span>
          </div>
          {showVolume && (
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.volumeUp }} />
              <span>{t('trading.chart.volume')}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default CandleChart;
