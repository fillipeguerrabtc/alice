/**
 * Technical Analysis Panel - Painel de Análise Técnica Enterprise
 * 
 * Exibe indicadores técnicos CALCULADOS POR CÓDIGO (não LLM).
 * Parte da arquitetura anti-alucinação para trading enterprise.
 * 
 * ARQUITETURA:
 * 1. API calcula indicadores deterministicamente (código)
 * 2. Este componente EXIBE os valores reais
 * 3. LLM recebe estes mesmos valores para INTERPRETAR
 * 4. Validação cruzada verifica se LLM citou corretamente
 * 
 * Autor: Fillipe Guerra
 * Data: 21 de Dezembro de 2025
 * Regra 6: Dados reais, sem mocks
 * Regra 8: TypeScript strict
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  BarChart3,
  LineChart,
  Target,
  Gauge,
  Volume2,
  RefreshCw,
  CheckCircle,
  Brain,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
// NOTA: Tooltip removido - não utilizado neste componente (21/12/2025)
import { apiRequest } from '@/lib/queryClient';

// ============================================================================
// TIPOS
// ============================================================================

export interface RSIResult {
  value: number;
  interpretation: 'oversold' | 'neutral' | 'overbought';
  period: number;
}

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
  // BUG FIX 21/12/2025: Usar 'sideways' ao invés de 'neutral' para compatibilidade com trendEnum do PostgreSQL
  interpretation: 'bullish' | 'bearish' | 'sideways';
  crossover: 'bullish_cross' | 'bearish_cross' | 'none';
}

export interface MovingAverageResult {
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  sma20: number;
  sma50: number;
  sma200: number;
  trend: 'bullish' | 'bearish' | 'sideways';
}

export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
  width: number;
  percentB: number;
  interpretation: 'oversold' | 'neutral' | 'overbought';
}

export interface ATRResult {
  value: number;
  percentage: number;
  volatility: 'low' | 'medium' | 'high';
}

export interface StochasticResult {
  k: number;
  d: number;
  interpretation: 'oversold' | 'neutral' | 'overbought';
}

export interface ADXResult {
  adx: number;
  plusDI: number;
  minusDI: number;
  trendStrength: 'weak' | 'moderate' | 'strong' | 'very_strong';
}

export interface SupportResistanceResult {
  pivot: number;
  resistance1: number;
  resistance2: number;
  resistance3: number;
  support1: number;
  support2: number;
  support3: number;
}

export interface VolumeAnalysisResult {
  currentVolume: number;
  averageVolume: number;
  volumeRatio: number;
  obv: number;
  interpretation: 'low' | 'normal' | 'high' | 'very_high';
}

export interface TechnicalAnalysisResult {
  timestamp: number;
  symbol: string;
  interval: string;
  currentPrice: number;
  rsi: RSIResult;
  macd: MACDResult;
  movingAverages: MovingAverageResult;
  bollinger: BollingerResult;
  atr: ATRResult;
  stochastic: StochasticResult;
  adx: ADXResult;
  supportResistance: SupportResistanceResult;
  volume: VolumeAnalysisResult;
  overallSignal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  confidence: number;
}

export interface TechnicalAnalysisPanelProps {
  symbol: string;
  defaultInterval?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

const INTERVALS = [
  { value: '1m', label: '1 min' },
  { value: '3m', label: '3 min' },
  { value: '5m', label: '5 min' },
  { value: '15m', label: '15 min' },
  { value: '30m', label: '30 min' },
  { value: '1h', label: '1 hora' },
  { value: '4h', label: '4 horas' },
  { value: '1d', label: '1 dia' },
];

const getSignalColor = (signal: TechnicalAnalysisResult['overallSignal']) => {
  switch (signal) {
    case 'strong_buy': return 'bg-green-500';
    case 'buy': return 'bg-green-400';
    case 'neutral': return 'bg-gray-400';
    case 'sell': return 'bg-red-400';
    case 'strong_sell': return 'bg-red-500';
  }
};

const getSignalIcon = (signal: TechnicalAnalysisResult['overallSignal']) => {
  switch (signal) {
    case 'strong_buy':
    case 'buy':
      return TrendingUp;
    case 'neutral':
      return Minus;
    case 'sell':
    case 'strong_sell':
      return TrendingDown;
  }
};

const getSignalLabel = (signal: TechnicalAnalysisResult['overallSignal']) => {
  switch (signal) {
    case 'strong_buy': return 'COMPRA FORTE';
    case 'buy': return 'COMPRA';
    case 'neutral': return 'NEUTRO';
    case 'sell': return 'VENDA';
    case 'strong_sell': return 'VENDA FORTE';
  }
};

const getInterpretationBadge = (interpretation: 'oversold' | 'neutral' | 'overbought') => {
  switch (interpretation) {
    case 'oversold':
      return <Badge variant="outline" className="text-green-500 border-green-500">Sobrevendido</Badge>;
    case 'overbought':
      return <Badge variant="outline" className="text-red-500 border-red-500">Sobrecomprado</Badge>;
    default:
      return <Badge variant="outline">Neutro</Badge>;
  }
};

const getTrendBadge = (trend: 'bullish' | 'bearish' | 'sideways') => {
  switch (trend) {
    case 'bullish':
      return <Badge className="bg-green-500"><TrendingUp className="h-3 w-3 mr-1" />Alta</Badge>;
    case 'bearish':
      return <Badge className="bg-red-500"><TrendingDown className="h-3 w-3 mr-1" />Baixa</Badge>;
    default:
      return <Badge variant="secondary"><Minus className="h-3 w-3 mr-1" />Lateral</Badge>;
  }
};

const formatPrice = (price: number) => {
  return price.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' });
};

// ============================================================================
// COMPONENTE
// ============================================================================

export function TechnicalAnalysisPanel({
  symbol,
  defaultInterval = '5m',
}: TechnicalAnalysisPanelProps) {
  const [interval, setInterval] = useState(defaultInterval);

  // Buscar análise técnica
  const {
    data: analysisResponse,
    isLoading,
    isFetching,
    refetch,
    error,
  } = useQuery<{
    success: boolean;
    data: TechnicalAnalysisResult;
    indicatorId: string;
    llmPrompt: string;
  }>({
    queryKey: ['trading-analysis', symbol, interval],
    queryFn: async () => {
      const response = await apiRequest(
        'GET',
        `/api/integrations/trading/analysis/${symbol}?interval=${interval}`
      );
      return response.json();
    },
    refetchInterval: 30000, // Atualizar a cada 30 segundos
    retry: 2,
  });

  const analysis = analysisResponse?.data;
  const SignalIcon = analysis ? getSignalIcon(analysis.overallSignal) : Activity;

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="text-red-700 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Erro na Análise Técnica
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-red-600 text-sm">
            {error instanceof Error ? error.message : 'Erro desconhecido'}
          </p>
          <Button onClick={() => refetch()} variant="outline" className="mt-4">
            <RefreshCw className="h-4 w-4 mr-2" />
            Tentar Novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              Análise Técnica
              <Badge variant="outline" className="ml-2 text-xs">
                CÓDIGO (Determinístico)
              </Badge>
            </CardTitle>
            <CardDescription>
              Indicadores calculados por código, não LLM - {symbol}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={interval} onValueChange={setInterval}>
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVALS.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
            </div>
          </div>
        ) : analysis ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            {/* Sinal Geral */}
            <div className={`rounded-lg p-6 ${getSignalColor(analysis.overallSignal)} text-white`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <SignalIcon className="h-12 w-12" />
                  <div>
                    <p className="text-sm opacity-80">Sinal Geral</p>
                    <p className="text-2xl font-bold">{getSignalLabel(analysis.overallSignal)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm opacity-80">Confiança</p>
                  <p className="text-3xl font-bold">{Math.round(analysis.confidence * 100)}%</p>
                </div>
              </div>
              <div className="mt-4">
                <Progress
                  value={analysis.confidence * 100}
                  className="h-2 bg-white/20"
                />
              </div>
              <div className="mt-4 flex justify-between text-sm opacity-80">
                <span>Preço: {formatPrice(analysis.currentPrice)}</span>
                <span>Última atualização: {new Date(analysis.timestamp).toLocaleTimeString('pt-BR')}</span>
              </div>
            </div>

            {/* Grid de Indicadores */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* RSI */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Gauge className="h-4 w-4" />
                    RSI ({analysis.rsi.period})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-bold">{analysis.rsi.value.toFixed(2)}</span>
                    {getInterpretationBadge(analysis.rsi.interpretation)}
                  </div>
                  <Progress value={analysis.rsi.value} className="mt-2 h-2" />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>0</span>
                    <span>30</span>
                    <span>70</span>
                    <span>100</span>
                  </div>
                </CardContent>
              </Card>

              {/* MACD */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <LineChart className="h-4 w-4" />
                    MACD
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">MACD</span>
                      <span className="font-mono">{analysis.macd.macd.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Signal</span>
                      <span className="font-mono">{analysis.macd.signal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Histograma</span>
                      <span className={`font-mono ${analysis.macd.histogram > 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {analysis.macd.histogram.toFixed(2)}
                      </span>
                    </div>
                    {analysis.macd.crossover !== 'none' && (
                      <Badge
                        className={analysis.macd.crossover === 'bullish_cross' ? 'bg-green-500' : 'bg-red-500'}
                      >
                        {analysis.macd.crossover === 'bullish_cross' ? 'Cruzamento Alta' : 'Cruzamento Baixa'}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Médias Móveis */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Médias Móveis
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">EMA 9</span>
                      <span className="font-mono text-sm">{formatPrice(analysis.movingAverages.ema9)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">EMA 21</span>
                      <span className="font-mono text-sm">{formatPrice(analysis.movingAverages.ema21)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">EMA 200</span>
                      <span className="font-mono text-sm">{formatPrice(analysis.movingAverages.ema200)}</span>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex justify-center">
                      {getTrendBadge(analysis.movingAverages.trend)}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Bollinger Bands */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Bollinger Bands
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">Superior</span>
                      <span className="font-mono text-sm">{formatPrice(analysis.bollinger.upper)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">Média</span>
                      <span className="font-mono text-sm">{formatPrice(analysis.bollinger.middle)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">Inferior</span>
                      <span className="font-mono text-sm">{formatPrice(analysis.bollinger.lower)}</span>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex justify-between items-center">
                      <span className="text-xs">%B: {(analysis.bollinger.percentB * 100).toFixed(0)}%</span>
                      {getInterpretationBadge(analysis.bollinger.interpretation)}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Stochastic */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Gauge className="h-4 w-4" />
                    Stochastic
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">%K</span>
                      <span className="font-mono">{analysis.stochastic.k.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">%D</span>
                      <span className="font-mono">{analysis.stochastic.d.toFixed(2)}</span>
                    </div>
                    <Progress value={analysis.stochastic.k} className="h-2" />
                    <div className="flex justify-center">
                      {getInterpretationBadge(analysis.stochastic.interpretation)}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* ADX */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    ADX (Força da Tendência)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-2xl font-bold">{analysis.adx.adx.toFixed(2)}</span>
                      <Badge
                        variant={analysis.adx.trendStrength === 'strong' || analysis.adx.trendStrength === 'very_strong'
                          ? 'default' : 'secondary'}
                      >
                        {analysis.adx.trendStrength === 'weak' && 'Fraca'}
                        {analysis.adx.trendStrength === 'moderate' && 'Moderada'}
                        {analysis.adx.trendStrength === 'strong' && 'Forte'}
                        {analysis.adx.trendStrength === 'very_strong' && 'Muito Forte'}
                      </Badge>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <span className="text-green-500">+DI: {analysis.adx.plusDI.toFixed(2)}</span>
                      <span className="text-red-500">-DI: {analysis.adx.minusDI.toFixed(2)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Suporte e Resistência */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Níveis de Suporte e Resistência (Pivot Points)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-7 gap-2 text-center text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">S3</p>
                    <p className="font-mono text-green-600">{formatPrice(analysis.supportResistance.support3)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">S2</p>
                    <p className="font-mono text-green-500">{formatPrice(analysis.supportResistance.support2)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">S1</p>
                    <p className="font-mono text-green-400">{formatPrice(analysis.supportResistance.support1)}</p>
                  </div>
                  <div className="bg-muted rounded-lg p-2">
                    <p className="text-muted-foreground text-xs">Pivot</p>
                    <p className="font-mono font-bold">{formatPrice(analysis.supportResistance.pivot)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">R1</p>
                    <p className="font-mono text-red-400">{formatPrice(analysis.supportResistance.resistance1)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">R2</p>
                    <p className="font-mono text-red-500">{formatPrice(analysis.supportResistance.resistance2)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">R3</p>
                    <p className="font-mono text-red-600">{formatPrice(analysis.supportResistance.resistance3)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Volume e ATR */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Volume */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Volume2 className="h-4 w-4" />
                    Análise de Volume
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Volume Atual</span>
                      <span className="font-mono">{analysis.volume.currentVolume.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Média (20)</span>
                      <span className="font-mono">{analysis.volume.averageVolume.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Ratio</span>
                      <Badge
                        variant={analysis.volume.interpretation === 'high' || analysis.volume.interpretation === 'very_high'
                          ? 'default' : 'secondary'}
                      >
                        {analysis.volume.volumeRatio.toFixed(2)}x
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* ATR */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    ATR (Volatilidade)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-2xl font-bold">{formatPrice(analysis.atr.value)}</span>
                      <Badge
                        variant={analysis.atr.volatility === 'high' ? 'destructive' : 'secondary'}
                      >
                        {analysis.atr.volatility === 'low' && 'Baixa'}
                        {analysis.atr.volatility === 'medium' && 'Média'}
                        {analysis.atr.volatility === 'high' && 'Alta'}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {analysis.atr.percentage.toFixed(2)}% do preço atual
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Nota sobre Determinismo */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>
                Todos os indicadores são calculados por <strong>código determinístico</strong>, não por LLM.
                Valores são verificados por validação cruzada quando usados em análises de IA.
              </span>
            </div>
          </motion.div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default TechnicalAnalysisPanel;

