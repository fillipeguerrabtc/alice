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
 * - Indicadores: SMA, EMA (opcionais)
 * - Atualização em tempo real via WebSocket
 * - Responsivo e touch-friendly
 * 
 * Regra 6 - SEM MOCKS: Dados reais da API KuCoin
 * Regra 8 - TypeScript strict
 * Regra 13 - i18n PT-BR/EN
 * 
 * Autor: Fillipe Guerra
 * Data: 17 de Dezembro de 2025
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  RefreshCw,
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
  if (!timeZone) return 'UTC';
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function resolveTimestamp(raw: number): UTCTimestamp {
  if (raw > 10_000_000_000) {
    return Math.floor(raw / 1000) as UTCTimestamp;
  }
  return raw as UTCTimestamp;
}

/**
 * Formata valor monetário
 */
function formatPrice(value: number, locale: string): string {
  return formatNumber(value, locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formata volume
 */
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLineRef = useRef<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']> | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  
  // BUG FIX 17/12/2025: Sincronizar selectedInterval quando prop interval mudar externamente
  // Cenário: pai muda interval via prop mas selectedInterval local ficava dessincronizado
  // Isso causava botão errado destacado enquanto gráfico mostrava dados corretos
  useEffect(() => {
    setSelectedInterval(interval);
  }, [interval]);
  
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
    const percent = (change / first) * 100;
    
    return { value: change, percent };
  }, [candleData]);
  
  const handleIntervalChange = (newInterval: string) => {
    setSelectedInterval(newInterval);
    onIntervalChange?.(newInterval);
  };

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

    const observer = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height });
      chart.timeScale().fitContent();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [height, resolvedLocale, resolvedTimeZone, showVolume]);

  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current) return;
    candleSeriesRef.current.setData(candleData);
    if (showVolume && volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(volumeData);
    }
    chartRef.current.timeScale().fitContent();
  }, [candleData, volumeData, showVolume]);

  useEffect(() => {
    if (!candleSeriesRef.current) return;
    if (priceLineRef.current) {
      candleSeriesRef.current.removePriceLine(priceLineRef.current);
      priceLineRef.current = null;
    }
    if (currentPrice) {
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
  
  // Loading state
  if (isLoading) {
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
  
  // Empty state
  if (candleData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            {t('trading.chart.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[400px]">
          <p className="text-muted-foreground">{t('trading.chart.noData')}</p>
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
            
            {currentPrice && (
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
            )}
          </div>
          
          <div className="flex items-center gap-2 flex-wrap max-w-full">
            {/* Interval selector */}
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
          <div ref={containerRef} className="h-full w-full" />
        </div>
        
        {/* Legend */}
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
