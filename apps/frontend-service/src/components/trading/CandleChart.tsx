/**
 * CandleChart - Gráfico de Candlestick para Trading
 * 
 * Componente enterprise-grade para visualização de preços em tempo real.
 * Usa recharts para renderização performática e responsiva.
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

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
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
  currentPrice?: number;
  isLoading?: boolean;
  onIntervalChange?: (interval: string) => void;
  onRefresh?: () => void;
  height?: number;
  showVolume?: boolean;
  showSMA?: boolean;
  smaLength?: number;
}

interface ChartDataPoint {
  time: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  color: string;
  // Para renderizar candlestick como bar chart
  body: [number, number];
  wick: [number, number];
  sma?: number;
}

// ============================================================================
// CONSTANTES
// ============================================================================

const INTERVALS = [
  { value: '1', label: '1m' },
  { value: '3', label: '3m' },
  { value: '5', label: '5m' },
  { value: '15', label: '15m' },
  { value: '30', label: '30m' },
  { value: '60', label: '1h' },
  { value: '240', label: '4h' },
  { value: '1440', label: '1D' },
];

const COLORS = {
  bullish: '#22c55e',  // Verde para alta
  bearish: '#ef4444',  // Vermelho para baixa
  volume: '#6b7280',   // Cinza para volume
  grid: '#374151',     // Grid lines
  text: '#9ca3af',     // Texto
  sma: '#3b82f6',      // Azul para SMA
};

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Calcula SMA (Simple Moving Average)
 */
function calculateSMA(data: number[], period: number): (number | undefined)[] {
  const result: (number | undefined)[] = [];
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(undefined);
    } else {
      const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
  }
  
  return result;
}

/**
 * Formata timestamp para exibição
 */
function formatTime(timestamp: number, interval: string): string {
  const date = new Date(timestamp);
  const intervalNum = parseInt(interval);
  
  if (intervalNum >= 1440) {
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  } else if (intervalNum >= 60) {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Formata valor monetário
 */
function formatPrice(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formata volume
 */
function formatVolume(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toFixed(0);
}

// ============================================================================
// COMPONENTE CUSTOM TOOLTIP
// ============================================================================

interface TooltipPayload {
  payload: ChartDataPoint;
}

function CustomTooltip({ 
  active, 
  payload,
}: { 
  active?: boolean; 
  payload?: TooltipPayload[];
}) {
  if (!active || !payload || !payload[0]) return null;
  
  const data = payload[0].payload;
  const isUp = data.close >= data.open;
  
  return (
    <div className="bg-background/95 border border-border rounded-lg p-3 shadow-lg">
      <p className="text-xs text-muted-foreground mb-2">{data.time}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <span className="text-muted-foreground">Open:</span>
        <span className="font-mono">${formatPrice(data.open)}</span>
        <span className="text-muted-foreground">High:</span>
        <span className="font-mono text-green-500">${formatPrice(data.high)}</span>
        <span className="text-muted-foreground">Low:</span>
        <span className="font-mono text-red-500">${formatPrice(data.low)}</span>
        <span className="text-muted-foreground">Close:</span>
        <span className={`font-mono ${isUp ? 'text-green-500' : 'text-red-500'}`}>
          ${formatPrice(data.close)}
        </span>
        <span className="text-muted-foreground">Volume:</span>
        <span className="font-mono">{formatVolume(data.volume)}</span>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export function CandleChart({
  data,
  symbol,
  interval,
  currentPrice,
  isLoading = false,
  onIntervalChange,
  onRefresh,
  height = 400,
  showVolume = true,
  showSMA = false,
  smaLength = 20,
}: CandleChartProps) {
  const { t } = useTranslation();
  const [selectedInterval, setSelectedInterval] = useState(interval);
  
  // Processar dados para o gráfico
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    const closes = data.map(d => parseFloat(d.close));
    const smaValues = showSMA ? calculateSMA(closes, smaLength) : [];
    
    return data.map((kline, index) => {
      const open = parseFloat(kline.open);
      const close = parseFloat(kline.close);
      const high = parseFloat(kline.high);
      const low = parseFloat(kline.low);
      const volume = parseFloat(kline.volume);
      const isUp = close >= open;
      
      return {
        time: formatTime(kline.time, interval),
        timestamp: kline.time,
        open,
        high,
        low,
        close,
        volume,
        color: isUp ? COLORS.bullish : COLORS.bearish,
        // Body do candle (parte sólida)
        body: isUp ? [open, close] : [close, open],
        // Wick (sombras)
        wick: [low, high],
        sma: smaValues[index],
      } as ChartDataPoint;
    });
  }, [data, interval, showSMA, smaLength]);
  
  // Calcular domínio do eixo Y
  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 100];
    
    const prices = chartData.flatMap(d => [d.high, d.low]);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const padding = (max - min) * 0.05;
    
    return [min - padding, max + padding];
  }, [chartData]);
  
  // Calcular mudança percentual
  const priceChange = useMemo(() => {
    if (chartData.length < 2) return { value: 0, percent: 0 };
    
    const first = chartData[0].open;
    const last = chartData[chartData.length - 1].close;
    const change = last - first;
    const percent = (change / first) * 100;
    
    return { value: change, percent };
  }, [chartData]);
  
  const handleIntervalChange = (newInterval: string) => {
    setSelectedInterval(newInterval);
    onIntervalChange?.(newInterval);
  };
  
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
  if (chartData.length === 0) {
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
            
            {currentPrice && (
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold font-mono">
                  ${formatPrice(currentPrice)}
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
          
          <div className="flex items-center gap-2 flex-wrap">
            {/* Interval selector */}
            <div className="flex gap-1">
              {INTERVALS.map((int) => (
                <Button
                  key={int.value}
                  variant={selectedInterval === int.value ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => handleIntervalChange(int.value)}
                >
                  {int.label}
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
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
            >
              <CartesianGrid 
                strokeDasharray="3 3" 
                stroke={COLORS.grid}
                opacity={0.3}
              />
              
              <XAxis
                dataKey="time"
                tick={{ fill: COLORS.text, fontSize: 11 }}
                tickLine={{ stroke: COLORS.grid }}
                axisLine={{ stroke: COLORS.grid }}
                interval="preserveStartEnd"
                minTickGap={50}
              />
              
              <YAxis
                yAxisId="price"
                domain={yDomain}
                tick={{ fill: COLORS.text, fontSize: 11 }}
                tickLine={{ stroke: COLORS.grid }}
                axisLine={{ stroke: COLORS.grid }}
                tickFormatter={(value) => `$${formatPrice(value)}`}
                orientation="right"
                width={80}
              />
              
              {showVolume && (
                <YAxis
                  yAxisId="volume"
                  orientation="left"
                  tick={{ fill: COLORS.text, fontSize: 11 }}
                  tickLine={{ stroke: COLORS.grid }}
                  axisLine={{ stroke: COLORS.grid }}
                  tickFormatter={formatVolume}
                  width={50}
                />
              )}
              
              <Tooltip content={<CustomTooltip />} />
              
              {/* Current price reference line */}
              {currentPrice && (
                <ReferenceLine
                  yAxisId="price"
                  y={currentPrice}
                  stroke="#3b82f6"
                  strokeDasharray="5 5"
                  strokeWidth={1}
                />
              )}
              
              {/* Volume bars */}
              {showVolume && (
                <Bar
                  yAxisId="volume"
                  dataKey="volume"
                  fill={COLORS.volume}
                  opacity={0.3}
                  barSize={8}
                />
              )}
              
              {/* Candle wicks (sombras - linha fina mostrando high/low) */}
              <Bar
                yAxisId="price"
                dataKey="wick"
                barSize={1}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`wick-${index}`} fill={entry.color} />
                ))}
              </Bar>
              
              {/* Candle bodies (parte sólida open/close) */}
              <Bar
                yAxisId="price"
                dataKey="body"
                barSize={6}
              >
                {chartData.map((entry, index) => (
                  <Cell key={`body-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
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
              <div className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.volume }} />
              <span>{t('trading.chart.volume')}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default CandleChart;
