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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
  Trash2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { NewsConfigEditor, DEFAULT_TRADING_NEWS_CONFIG, normalizeTradingNewsConfigForm, type TradingNewsConfigForm, type TradingNewsPresetOption } from './NewsConfigEditor';
import { MultiSelectDropdown } from './MultiSelectDropdown';

// NOTA: Tooltip removido - não utilizado neste componente (21/12/2025)
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { TIMEZONE } from '@/lib/i18n';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/utils';

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
  rsi?: RSIResult;
  macd?: MACDResult;
  movingAverages?: MovingAverageResult;
  bollinger?: BollingerResult;
  atr?: ATRResult;
  stochastic?: StochasticResult;
  adx?: ADXResult;
  supportResistance?: SupportResistanceResult;
  volume?: VolumeAnalysisResult;
  overallSignal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  confidence: number;
}

export interface TradingAnalysisHistoryItem {
  id: string;
  symbol: string;
  interval: string;
  currentPrice: number;
  overallSignal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  signalConfidence: number;
  calculatedAt: string;
  metadata?: {
    techniques?: string[];
  };
}

type TradingAnalysisHistoryDetail = TradingAnalysisHistoryItem & {
  rsiValue?: number | null;
  rsiInterpretation?: string | null;
  rsiPeriod?: number | null;
  macdLine?: number | null;
  macdSignal?: number | null;
  macdHistogram?: number | null;
  macdInterpretation?: string | null;
  macdCrossover?: string | null;
  ema9?: number | null;
  ema21?: number | null;
  ema50?: number | null;
  ema200?: number | null;
  sma20?: number | null;
  sma50?: number | null;
  sma200?: number | null;
  maTrend?: string | null;
  bollingerUpper?: number | null;
  bollingerMiddle?: number | null;
  bollingerLower?: number | null;
  bollingerWidth?: number | null;
  bollingerPercentB?: number | null;
  bollingerInterpretation?: string | null;
  atrValue?: number | null;
  atrPercentage?: number | null;
  atrVolatility?: string | null;
  stochasticK?: number | null;
  stochasticD?: number | null;
  stochasticInterpretation?: string | null;
  adxValue?: number | null;
  adxPlusDI?: number | null;
  adxMinusDI?: number | null;
  adxTrendStrength?: string | null;
  pivotPoint?: number | null;
  resistance1?: number | null;
  resistance2?: number | null;
  resistance3?: number | null;
  support1?: number | null;
  support2?: number | null;
  support3?: number | null;
  currentVolume?: number | null;
  averageVolume?: number | null;
  volumeRatio?: number | null;
  obv?: number | null;
  volumeInterpretation?: string | null;
  metadata?: {
    techniques?: string[];
    techniqueScores?: Array<{ technique: string; signal: string; confidence: number; rationale?: string }>;
    ensembleResult?: {
      overallSignal?: string;
      confidence?: number;
      topTechniques?: Array<{ technique: string; signal: string; confidence: number; rationale?: string }>;
    };
    calculationDurationMs?: number;
    candleCount?: number;
    lastCandleTime?: string;
  } & Record<string, unknown>;
};

export interface IntervalOption {
  value: string;
  label: string;
}

export interface AnalysisMatrixEntry {
  interval: string;
  analysis: TechnicalAnalysisResult;
  indicatorId: string;
}

export interface AnalysisConsensus {
  overallSignal: TechnicalAnalysisResult['overallSignal'];
  confidence: number;
  alignedTimeframes: string[];
  misalignedTimeframes: string[];
  agreementRatio: number;
  requiredAgree: number;
  totalTimeframes: number;
  isMajorityReached: boolean;
}

interface ArbitrageLegSnapshot {
  from: string;
  to: string;
  symbol: string;
  side: string;
  rate: number;
  exchange?: string;
}

interface ArbitrageSnapshot {
  intermediateAsset: string;
  edgePct: number;
  networkFeeTotal?: number;
  networkFeesApplied?: Array<{ asset: string; amount: number; fromExchange: string; toExchange: string }>;
  legs: ArbitrageLegSnapshot[];
}

export type TradingOperationType = 'scalping' | 'swing' | 'position' | 'cash_and_carry' | 'arbitrage' | 'hedge' | 'neutral';

export interface TradePlan {
  operationType: TradingOperationType;
  expectedDurationMinutes: number;
  expectedDurationLabel: string;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  motivators: string[];
  invalidationReasons: string[];
  tradeSummary: string;
  marketType: 'futures' | 'spot' | 'margin';
  marginMode?: 'cross' | 'isolated' | null;
  direction: 'long' | 'short' | 'neutral';
}

export interface AnalysisProfileDataSources {
  orderBook: boolean;
  news: boolean;
  trainingData: boolean;
}

export interface AnalysisProfile {
  kind: 'analysis' | 'signal';
  timeframes: string[];
  indicators: string[];
  techniques: string[];
  dataSources: AnalysisProfileDataSources;
  newsConfig: TradingNewsConfigForm;
  ensembleConfig?: {
    mode?: 'ensemble_top3';
    topN?: number;
  };
  arbitrageConfig?: {
    exchanges: string[];
    intermediateAssets: string[];
    feePct: number;
    maxSlippagePct: number;
    minEdgePct: number;
    maxIntervalMinutes: number;
  } | null;
  modelConfig?: {
    temperature?: number;
    maxTokens?: number;
  };
  consensus?: {
    rule?: 'majority';
    minAgree?: number;
  };
}

type AnalysisProfilePayload = {
  kind: 'analysis';
  marketType?: 'futures' | 'spot' | 'margin';
  symbol: string;
  timeframes: string[];
  indicators: string[];
  dataSources: AnalysisProfileDataSources;
  newsConfig: TradingNewsConfigForm;
  techniques: string[];
  ensembleConfig?: AnalysisProfile['ensembleConfig'];
  arbitrageConfig?: AnalysisProfile['arbitrageConfig'];
  consensus?: AnalysisProfile['consensus'];
};

export interface TechnicalAnalysisPanelProps {
  symbol: string;
  defaultInterval?: string;
  intervalOptions?: IntervalOption[];
  marketType?: 'futures' | 'spot' | 'margin';
  marginMode?: 'cross' | 'isolated';
}

// ============================================================================
// HELPERS
// ============================================================================

const INTERVALS: IntervalOption[] = [
  { value: '1m', label: '1 min' },
  { value: '3m', label: '3 min' },
  { value: '5m', label: '5 min' },
  { value: '15m', label: '15 min' },
  { value: '30m', label: '30 min' },
  { value: '1h', label: '1 hora' },
  { value: '4h', label: '4 horas' },
  { value: '1d', label: '1 dia' },
];

const INDICATOR_OPTIONS = [
  { key: 'rsi', label: 'RSI', description: 'Mede sobrecompra/sobrevenda com base no momentum.' },
  { key: 'macd', label: 'MACD', description: 'Sinal de tendência via cruzamento de médias.' },
  { key: 'moving_averages', label: 'Médias Móveis', description: 'Tendência geral e níveis dinâmicos.' },
  { key: 'bollinger', label: 'Bollinger Bands', description: 'Volatilidade e afastamento do preço.' },
  { key: 'atr', label: 'ATR', description: 'Volatilidade média e risco de variação.' },
  { key: 'stochastic', label: 'Stochastic', description: 'Momentum e possíveis reversões.' },
  { key: 'adx', label: 'ADX', description: 'Força da tendência atual.' },
  { key: 'support_resistance', label: 'Suporte/Resistência', description: 'Níveis técnicos de reversão (pivot points).' },
  { key: 'volume', label: 'Volume', description: 'Força do movimento via fluxo negociado.' },
] as const;

const TRADING_TECHNIQUE_OPTIONS = [
  { key: 'scalping', labelKey: 'trading.techniques.scalping.title', descKey: 'trading.techniques.scalping.desc' },
  { key: 'day_trade', labelKey: 'trading.techniques.day_trade.title', descKey: 'trading.techniques.day_trade.desc' },
  { key: 'swing', labelKey: 'trading.techniques.swing.title', descKey: 'trading.techniques.swing.desc' },
  { key: 'position', labelKey: 'trading.techniques.position.title', descKey: 'trading.techniques.position.desc' },
  { key: 'trend', labelKey: 'trading.techniques.trend.title', descKey: 'trading.techniques.trend.desc' },
  { key: 'mean_reversion', labelKey: 'trading.techniques.mean_reversion.title', descKey: 'trading.techniques.mean_reversion.desc' },
  { key: 'breakout', labelKey: 'trading.techniques.breakout.title', descKey: 'trading.techniques.breakout.desc' },
  { key: 'range', labelKey: 'trading.techniques.range.title', descKey: 'trading.techniques.range.desc' },
  { key: 'momentum', labelKey: 'trading.techniques.momentum.title', descKey: 'trading.techniques.momentum.desc' },
  { key: 'arbitrage_triangular', labelKey: 'trading.techniques.arbitrage_triangular.title', descKey: 'trading.techniques.arbitrage_triangular.desc' },
] as const;

const DEFAULT_TECHNIQUES = TRADING_TECHNIQUE_OPTIONS
  .map((option) => option.key)
  .filter((key) => key !== 'arbitrage_triangular');

const DEFAULT_ENSEMBLE_CONFIG = { mode: 'ensemble_top3' as const, topN: 3 };
const DEFAULT_ARBITRAGE_CONFIG = {
  exchanges: ['kucoin'],
  intermediateAssets: ['ETH'],
  feePct: 0.1,
  maxSlippagePct: 0.05,
  minEdgePct: 0.3,
  maxIntervalMinutes: 5,
};
const MAX_ARBITRAGE_ASSETS = 30;
const AUTO_SAVE_DEBOUNCE_MS = 600;

const ANALYSIS_SIGNAL_OPTIONS = [
  { value: 'strong_buy', label: 'Compra forte' },
  { value: 'buy', label: 'Compra' },
  { value: 'neutral', label: 'Neutro' },
  { value: 'sell', label: 'Venda' },
  { value: 'strong_sell', label: 'Venda forte' },
] as const;

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

const getTechniqueLabel = (technique?: string, t?: (key: string) => string) => {
  if (!technique) return 'N/A';
  const option = TRADING_TECHNIQUE_OPTIONS.find((item) => item.key === technique);
  if (!option) return technique;
  if (!t) return option.key;
  return t(option.labelKey);
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

const formatPrice = (price: number, locale: string) => {
  return formatCurrency(price, 'USD', locale);
};

const formatPlanPrice = (price: number | null, locale: string): string | null => {
  if (!Number.isFinite(price)) return null;
  return formatCurrency(Number(price), 'USD', locale);
};

const buildIndicatorExplanation = (analysis: TechnicalAnalysisResult): Array<{ title: string; detail: string }> => {
  const explanations: Array<{ title: string; detail: string }> = [];
  if (analysis.rsi) {
    explanations.push({
      title: 'RSI',
      detail: `RSI ${analysis.rsi.value} indica ${analysis.rsi.interpretation === 'oversold' ? 'sobrevenda' : analysis.rsi.interpretation === 'overbought' ? 'sobrecompra' : 'zona neutra'}.`,
    });
  }
  if (analysis.macd) {
    explanations.push({
      title: 'MACD',
      detail: `Histograma ${analysis.macd.histogram.toFixed(2)} e crossover ${analysis.macd.crossover} sugerem ${analysis.macd.interpretation}.`,
    });
  }
  if (analysis.movingAverages) {
    explanations.push({
      title: 'Médias Móveis',
      detail: `Tendência ${analysis.movingAverages.trend} com EMA 9/21/200 indicando direção dominante.`,
    });
  }
  if (analysis.bollinger) {
    explanations.push({
      title: 'Bollinger Bands',
      detail: `%B ${(analysis.bollinger.percentB * 100).toFixed(0)}% indica posição relativa do preço entre bandas.`,
    });
  }
  if (analysis.atr) {
    explanations.push({
      title: 'ATR',
      detail: `Volatilidade ${analysis.atr.volatility} com ATR ${analysis.atr.percentage.toFixed(2)}% do preço.`,
    });
  }
  if (analysis.stochastic) {
    explanations.push({
      title: 'Stochastic',
      detail: `%K ${analysis.stochastic.k.toFixed(2)} e %D ${analysis.stochastic.d.toFixed(2)} indicam ${analysis.stochastic.interpretation}.`,
    });
  }
  if (analysis.adx) {
    explanations.push({
      title: 'ADX',
      detail: `ADX ${analysis.adx.adx.toFixed(2)} aponta força ${analysis.adx.trendStrength}.`,
    });
  }
  if (analysis.supportResistance) {
    explanations.push({
      title: 'Suporte/Resistência',
      detail: `Pivot ${analysis.supportResistance.pivot.toFixed(2)} com níveis S1/S2/R1/R2 define zonas de reversão.`,
    });
  }
  if (analysis.volume) {
    explanations.push({
      title: 'Volume',
      detail: `Ratio ${analysis.volume.volumeRatio.toFixed(2)}x indica volume ${analysis.volume.interpretation}.`,
    });
  }
  return explanations;
};

// ============================================================================
// COMPONENTE
// ============================================================================

export function TechnicalAnalysisPanel({
  symbol,
  defaultInterval,
  intervalOptions,
  marketType,
  marginMode,
}: TechnicalAnalysisPanelProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const resolvedIntervalOptions = intervalOptions?.length ? intervalOptions : INTERVALS;
  const resolvedDefaultInterval = defaultInterval ?? resolvedIntervalOptions[0]?.value ?? '5m';
  const [interval, setInterval] = useState(resolvedDefaultInterval);
  const [profileForm, setProfileForm] = useState<AnalysisProfile>({
    kind: 'analysis',
    timeframes: [resolvedDefaultInterval],
    indicators: INDICATOR_OPTIONS.map((option) => option.key),
    techniques: DEFAULT_TECHNIQUES,
    dataSources: {
      orderBook: false,
      news: false,
      trainingData: false,
    },
    newsConfig: DEFAULT_TRADING_NEWS_CONFIG,
    ensembleConfig: DEFAULT_ENSEMBLE_CONFIG,
    arbitrageConfig: null,
    modelConfig: {},
    consensus: { rule: 'majority' },
  });
  const [selectedNewsPresetId, setSelectedNewsPresetId] = useState<string | null>(null);
  const [newsPresetName, setNewsPresetName] = useState('');
  const [newsPresetDescription, setNewsPresetDescription] = useState('');
  const [analysisSchedulerForm, setAnalysisSchedulerForm] = useState({
    enabled: false,
    intervalMinutes: '15',
    symbols: '',
    maxSymbolsPerRun: '1',
  });
  const locale = user?.idioma ?? 'pt-BR';
  const timeZone = user?.timezone ?? TIMEZONE;
  const userRoles = user?.roles ?? (user?.role ? [user.role] : []);
  const isAdminRole = userRoles.includes('admin') || userRoles.includes('super_admin');
  const [analysisHistoryItems, setAnalysisHistoryItems] = useState<TradingAnalysisHistoryDetail[]>([]);
  const [analysisHistoryPage, setAnalysisHistoryPage] = useState(1);
  const [analysisHistoryPageSize, setAnalysisHistoryPageSize] = useState(25);
  const [analysisHistoryTotal, setAnalysisHistoryTotal] = useState(0);
  const [analysisHistoryTotalPages, setAnalysisHistoryTotalPages] = useState(1);
  const [analysisHistoryLoading, setAnalysisHistoryLoading] = useState(false);
  const [analysisHistorySelectedIds, setAnalysisHistorySelectedIds] = useState<Set<string>>(new Set());
  const [analysisHistoryOrder, setAnalysisHistoryOrder] = useState<'asc' | 'desc'>('desc');
  const [analysisHistoryDateFrom, setAnalysisHistoryDateFrom] = useState('');
  const [analysisHistoryDateTo, setAnalysisHistoryDateTo] = useState('');
  const [analysisHistorySignalFilter, setAnalysisHistorySignalFilter] = useState('');
  const [analysisHistoryTechniqueFilter, setAnalysisHistoryTechniqueFilter] = useState('');
  const [analysisHistoryDetail, setAnalysisHistoryDetail] = useState<TradingAnalysisHistoryDetail | null>(null);
  const autoSaveEnabledRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveLastPayloadRef = useRef<string>('');
  const autoSaveContextRef = useRef(false);

  const updateTimeframes = (next: string[]) => {
    setProfileForm((prev) => ({
      ...prev,
      timeframes: next,
    }));
  };

  const updateIndicators = (next: string[]) => {
    setProfileForm((prev) => ({
      ...prev,
      indicators: next,
    }));
  };

  const updateTechniques = (next: string[]) => {
    setProfileForm((prev) => ({
      ...prev,
      techniques: next,
    }));
  };

  const updateArbitrageConfig = (updates: Partial<NonNullable<AnalysisProfile['arbitrageConfig']>>) => {
    setProfileForm((prev) => ({
      ...prev,
      arbitrageConfig: {
        ...(prev.arbitrageConfig ?? DEFAULT_ARBITRAGE_CONFIG),
        ...updates,
      },
    }));
  };

  const updateArbitrageExchanges = (next: string[]) => {
    const unique = Array.from(new Set(next.map((value) => value.trim()).filter(Boolean)));
    updateArbitrageConfig({ exchanges: unique });
  };

  const updateArbitrageAssets = (next: string[]) => {
    const normalized = Array.from(new Set(next.map((value) => value.trim().toUpperCase()).filter(Boolean)));
    updateArbitrageConfig({ intermediateAssets: normalized.slice(0, MAX_ARBITRAGE_ASSETS) });
  };

  const updateAnalysisSources = (next: string[]) => {
    const selected = new Set(next);
    setProfileForm((prev) => ({
      ...prev,
      dataSources: {
        orderBook: selected.has('orderBook'),
        news: selected.has('news'),
        trainingData: selected.has('trainingData'),
      },
    }));
  };

  useEffect(() => {
    const hasArbitrage = profileForm.techniques.includes('arbitrage_triangular');
    setProfileForm((prev) => {
      if (hasArbitrage && !prev.arbitrageConfig) {
        return { ...prev, arbitrageConfig: DEFAULT_ARBITRAGE_CONFIG };
      }
      if (!hasArbitrage && prev.arbitrageConfig) {
        return { ...prev, arbitrageConfig: null };
      }
      return prev;
    });
  }, [profileForm.techniques]);

  const {
    data: profileResponse,
    refetch: refetchProfile,
  } = useQuery<{ success: boolean; data: AnalysisProfile }>({
    queryKey: ['/api/integrations/trading/analysis-profile', marketType],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('kind', 'analysis');
      if (marketType) params.set('marketType', marketType);
      const response = await apiRequest('GET', `/api/integrations/trading/analysis-profile?${params.toString()}`);
      return response.json();
    },
    enabled: Boolean(symbol),
  });

  const {
    data: arbitrageCatalogResponse,
    isLoading: arbitrageCatalogLoading,
  } = useQuery<{
    success: boolean;
    data: {
      exchanges: Array<{ id: string; label: string }>;
      intermediateAssets: string[];
      feePctByExchange: Record<string, number>;
      effectiveFeePct: number;
      networkFeesByAsset: Record<string, number>;
      updatedAt: string;
    };
  }>({
    queryKey: [
      '/api/integrations/trading/arbitrage/catalog',
      marketType,
      symbol,
      profileForm.arbitrageConfig?.exchanges,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (marketType) params.set('marketType', marketType);
      if (symbol) params.set('symbol', symbol);
      const exchanges = profileForm.arbitrageConfig?.exchanges ?? [];
      if (exchanges.length > 0) {
        params.set('exchanges', exchanges.join(','));
      }
      const response = await apiRequest('GET', `/api/integrations/trading/arbitrage/catalog?${params.toString()}`);
      return response.json();
    },
    enabled: Boolean(profileForm.arbitrageConfig && profileForm.techniques.includes('arbitrage_triangular')),
  });

  useEffect(() => {
    if (!profileForm.arbitrageConfig || !arbitrageCatalogResponse?.success) return;
    const effectiveFee = arbitrageCatalogResponse.data.effectiveFeePct;
    if (Number.isFinite(effectiveFee) && effectiveFee !== profileForm.arbitrageConfig.feePct) {
      updateArbitrageConfig({ feePct: effectiveFee });
    }
  }, [arbitrageCatalogResponse, profileForm.arbitrageConfig, updateArbitrageConfig]);

  const {
    data: newsPresetsResponse,
  } = useQuery<{ success: boolean; data: TradingNewsPresetOption[] }>({
    queryKey: ['/api/integrations/trading/news-presets'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/integrations/trading/news-presets');
      return response.json();
    },
  });
  const newsPresets = newsPresetsResponse?.data ?? [];
  const selectedNewsPreset = newsPresets.find((preset) => preset.id === selectedNewsPresetId);
  const normalizedNewsPresetName = newsPresetName.trim();
  const canCreateNewsPreset = normalizedNewsPresetName.length >= 2;
  const canUpdateNewsPreset = Boolean(selectedNewsPreset && normalizedNewsPresetName.length >= 2);

  const createNewsPresetMutation = useMutation({
    mutationFn: async (payload: { name: string; description?: string | null; config: TradingNewsConfigForm }) => {
      const response = await apiRequest('POST', '/api/integrations/trading/news-presets', payload);
      return response.json();
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/news-presets'] });
      if (response?.data?.id) {
        setSelectedNewsPresetId(response.data.id);
      }
    },
  });

  const updateNewsPresetMutation = useMutation({
    mutationFn: async (payload: { id: string; name: string; description?: string | null; config: TradingNewsConfigForm }) => {
      const { id, ...body } = payload;
      const response = await apiRequest('PUT', `/api/integrations/trading/news-presets/${id}`, body);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/news-presets'] });
    },
  });

  const deleteNewsPresetMutation = useMutation({
    mutationFn: async (presetId: string) => {
      const response = await apiRequest('DELETE', `/api/integrations/trading/news-presets/${presetId}`);
      return response.json();
    },
    onSuccess: (_response, presetId) => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/news-presets'] });
      if (selectedNewsPresetId === presetId) {
        setSelectedNewsPresetId(null);
      }
    },
  });

  const {
    data: analysisSchedulerData,
    isLoading: isLoadingAnalysisScheduler,
    error: analysisSchedulerError,
    refetch: refetchAnalysisScheduler,
  } = useQuery<{ success: boolean; data: Array<Record<string, unknown>> }>({
    queryKey: ['/api/integrations/trading/analysis-scheduler', marketType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (marketType) {
        params.set('marketType', marketType);
      }
      const response = await apiRequest('GET', `/api/integrations/trading/analysis-scheduler${params.toString() ? `?${params}` : ''}`);
      return response.json();
    },
    enabled: Boolean(symbol),
  });

  const analysisSchedulerConfig = useMemo(() => {
    const config = analysisSchedulerData?.data?.[0] as Record<string, unknown> | undefined;
    if (!config) return null;
    return {
      enabled: Boolean(config.enabled),
      intervalMinutes: Number(config.intervalMinutes ?? 15),
      interval: String(config.interval ?? '5m'),
      symbols: Array.isArray(config.symbols) ? (config.symbols as string[]) : [],
      maxSymbolsPerRun: Number(config.maxSymbolsPerRun ?? 1),
      nextRunAt: config.nextRunAt as string | null,
      lastRunAt: config.lastRunAt as string | null,
      lastSuccessAt: config.lastSuccessAt as string | null,
      lastError: config.lastError as string | null,
      lastDurationMs: config.lastDurationMs as number | null,
    };
  }, [analysisSchedulerData]);

  useEffect(() => {
    if (!analysisSchedulerConfig) return;
    setAnalysisSchedulerForm({
      enabled: analysisSchedulerConfig.enabled,
      intervalMinutes: String(analysisSchedulerConfig.intervalMinutes || 15),
      symbols: analysisSchedulerConfig.symbols.join(', '),
      maxSymbolsPerRun: String(analysisSchedulerConfig.maxSymbolsPerRun || 1),
    });
  }, [analysisSchedulerConfig]);

  // Buscar análise técnica
  const {
    data: analysisResponse,
    isLoading,
    refetch,
    error,
  } = useQuery<{
    success: boolean;
    data: TechnicalAnalysisResult;
    indicatorId: string;
    llmPrompt: string;
    matrix: AnalysisMatrixEntry[];
    consensus: AnalysisConsensus;
    techniqueScores: Array<{ technique: string; signal: string; confidence: number; rationale?: string }>;
    ensembleResult: { overallSignal: string; confidence: number; topTechniques: Array<{ technique: string; signal: string; confidence: number; rationale?: string }> };
    arbitrageSnapshot?: ArbitrageSnapshot | null;
    arbitrageSnapshots?: ArbitrageSnapshot[];
    profile: AnalysisProfile;
    tradePlan?: TradePlan;
    sources: {
      orderBook: { symbol: string; bestBid: number | null; bestAsk: number | null; spreadAbs: number | null; spreadPct: number | null; depth: number } | null;
      news: { query: string; results: Array<{ title: string; url: string; score?: number }> } | null;
      trainingData: { totalApproved: number; samples: Array<{ prompt: string; response: string; actionType: string; createdAt: string }> } | null;
    };
  }>({
    queryKey: [
      'trading-analysis',
      symbol,
      profileForm.timeframes,
      profileForm.indicators,
      profileForm.techniques,
      profileForm.ensembleConfig,
      profileForm.arbitrageConfig,
      profileForm.dataSources,
      marketType,
      marginMode,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (profileForm.timeframes?.length) {
        params.set('timeframes', profileForm.timeframes.join(','));
      } else {
        params.set('interval', interval);
      }
      if (profileForm.indicators?.length) {
        params.set('indicators', profileForm.indicators.join(','));
      }
      if (profileForm.techniques?.length) {
        params.set('techniques', profileForm.techniques.join(','));
      }
      params.set('orderBook', String(profileForm.dataSources.orderBook));
      params.set('news', String(profileForm.dataSources.news));
      params.set('trainingData', String(profileForm.dataSources.trainingData));
      if (marketType) {
        params.set('marketType', marketType);
      }
      if (marketType === 'margin' && marginMode) {
        params.set('marginMode', marginMode);
      }
      const response = await apiRequest('GET', `/api/integrations/trading/analysis/${symbol}?${params.toString()}`);
      return response.json();
    },
    retry: 2,
    enabled: false,
  });

  const analysis = analysisResponse?.data;
  const SignalIcon = analysis ? getSignalIcon(analysis.overallSignal) : Activity;
  const primaryInterval = profileForm.timeframes?.[0] ?? interval;
  const arbitrageCatalog = arbitrageCatalogResponse?.success ? arbitrageCatalogResponse.data : undefined;
  const availableArbitrageExchanges = arbitrageCatalog?.exchanges?.length
    ? arbitrageCatalog.exchanges
    : [{ id: 'kucoin', label: 'KuCoin' }];
  const availableArbitrageAssets = arbitrageCatalog?.intermediateAssets?.length
    ? arbitrageCatalog.intermediateAssets
    : (profileForm.arbitrageConfig?.intermediateAssets ?? []);
  const analysisSourceOptions = [
    {
      value: 'orderBook',
      label: t('trading.analysis.profile.sourcesOrderBookTitle'),
      description: t('trading.analysis.profile.sourcesOrderBookDesc'),
    },
    {
      value: 'news',
      label: t('trading.analysis.profile.sourcesNewsTitle'),
      description: t('trading.analysis.profile.sourcesNewsDesc'),
    },
    {
      value: 'trainingData',
      label: t('trading.analysis.profile.sourcesTrainingTitle'),
      description: t('trading.analysis.profile.sourcesTrainingDesc'),
    },
  ];
  const selectedAnalysisSources = Object.entries(profileForm.dataSources)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);

  const buildHistoryIndicatorSummary = useCallback((item: TradingAnalysisHistoryDetail) => {
    const summary: string[] = [];
    const formatValue = (value: number) => formatNumber(value, locale, { maximumFractionDigits: 4 });
    const addNumber = (label: string, value?: number | null, suffix?: string) => {
      if (value === undefined || value === null || Number.isNaN(value)) return;
      summary.push(`${label} ${formatValue(value)}${suffix ?? ''}`);
    };
    if (item.rsiValue !== undefined && item.rsiValue !== null) {
      const interpretation = item.rsiInterpretation ?? 'neutral';
      summary.push(`RSI ${formatValue(item.rsiValue)} (${interpretation})`);
    }
    addNumber('MACD', item.macdHistogram, item.macdInterpretation ? ` (${item.macdInterpretation})` : undefined);
    if (item.maTrend) summary.push(`Médias móveis: tendência ${item.maTrend}`);
    addNumber('Bollinger %B', item.bollingerPercentB, item.bollingerInterpretation ? ` (${item.bollingerInterpretation})` : undefined);
    addNumber('ATR %', item.atrPercentage, item.atrVolatility ? ` (${item.atrVolatility})` : undefined);
    if (item.stochasticK !== undefined && item.stochasticK !== null && item.stochasticD !== undefined && item.stochasticD !== null) {
      const interpretation = item.stochasticInterpretation ?? 'neutral';
      summary.push(`Stochastic %K ${formatValue(item.stochasticK)} / %D ${formatValue(item.stochasticD)} (${interpretation})`);
    }
    addNumber('ADX', item.adxValue, item.adxTrendStrength ? ` (${item.adxTrendStrength})` : undefined);
    addNumber('Pivot', item.pivotPoint);
    addNumber('Volume ratio', item.volumeRatio, item.volumeInterpretation ? ` (${item.volumeInterpretation})` : undefined);
    return summary;
  }, [locale]);
  const allAnalysisHistorySelected = analysisHistoryItems.length > 0 && analysisHistorySelectedIds.size === analysisHistoryItems.length;
  const hasAnalysisHistorySelection = analysisHistorySelectedIds.size > 0;
  const analysisHistoryLoadingRef = useRef(analysisHistoryLoading);

  useEffect(() => {
    analysisHistoryLoadingRef.current = analysisHistoryLoading;
  }, [analysisHistoryLoading]);

  const fetchAnalysisHistory = useCallback(async (options: { page?: number; resetSelection?: boolean } = {}) => {
    if (!symbol || analysisHistoryLoadingRef.current) return;
    const nextPage = options.page ?? analysisHistoryPage;
    analysisHistoryLoadingRef.current = true;
    setAnalysisHistoryLoading(true);
    const params = new URLSearchParams();
    params.set('symbol', symbol);
    params.set('interval', primaryInterval);
    params.set('page', String(nextPage));
    params.set('pageSize', String(analysisHistoryPageSize));
    params.set('orderDirection', analysisHistoryOrder);
    if (marketType) {
      params.set('marketType', marketType);
    }
    if (marketType === 'margin' && marginMode) {
      params.set('marginMode', marginMode);
    }
    if (analysisHistoryDateFrom) params.set('dateFrom', analysisHistoryDateFrom);
    if (analysisHistoryDateTo) params.set('dateTo', analysisHistoryDateTo);
    if (analysisHistorySignalFilter) params.set('overallSignal', analysisHistorySignalFilter);
    if (analysisHistoryTechniqueFilter) params.set('technique', analysisHistoryTechniqueFilter);
    try {
      const response = await apiRequest('GET', `/api/integrations/trading/analysis/history?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || t('trading.analysis.historyLoadFailed'));
      }
      const items = payload.data as TradingAnalysisHistoryItem[];
      setAnalysisHistoryItems(items);
      const resolvedPage = payload.page ?? nextPage;
      if (resolvedPage !== analysisHistoryPage) {
        setAnalysisHistoryPage(resolvedPage);
      }
      const resolvedPageSize = payload.pageSize ?? analysisHistoryPageSize;
      if (resolvedPageSize !== analysisHistoryPageSize) {
        setAnalysisHistoryPageSize(resolvedPageSize);
      }
      const resolvedTotal = payload.total ?? items.length;
      if (resolvedTotal !== analysisHistoryTotal) {
        setAnalysisHistoryTotal(resolvedTotal);
      }
      const resolvedTotalPages = payload.totalPages ?? 1;
      if (resolvedTotalPages !== analysisHistoryTotalPages) {
        setAnalysisHistoryTotalPages(resolvedTotalPages);
      }
      if (options.resetSelection) {
        setAnalysisHistorySelectedIds(new Set());
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('errors.generic');
      toast({ title: t('trading.analysis.historyLoadFailed'), description: message, variant: 'destructive' });
    } finally {
      setAnalysisHistoryLoading(false);
      analysisHistoryLoadingRef.current = false;
    }
  }, [
    analysisHistoryDateFrom,
    analysisHistoryDateTo,
    analysisHistoryOrder,
    analysisHistoryPage,
    analysisHistoryPageSize,
    analysisHistorySignalFilter,
    analysisHistoryTechniqueFilter,
    analysisHistoryTotal,
    analysisHistoryTotalPages,
    primaryInterval,
    symbol,
    t,
    toast,
  ]);

  const analysisHistoryFilterKey = useMemo(() => JSON.stringify({
    dateFrom: analysisHistoryDateFrom,
    dateTo: analysisHistoryDateTo,
    order: analysisHistoryOrder,
    pageSize: analysisHistoryPageSize,
    signal: analysisHistorySignalFilter,
    technique: analysisHistoryTechniqueFilter,
    interval: primaryInterval,
    symbol,
  }), [
    analysisHistoryDateFrom,
    analysisHistoryDateTo,
    analysisHistoryOrder,
    analysisHistoryPageSize,
    analysisHistorySignalFilter,
    analysisHistoryTechniqueFilter,
    primaryInterval,
    symbol,
  ]);
  const lastAnalysisHistoryFilterRef = useRef(analysisHistoryFilterKey);
  const lastAnalysisHistoryFetchRef = useRef<string>('');

  useEffect(() => {
    if (!symbol) return;
    const filterChanged = lastAnalysisHistoryFilterRef.current !== analysisHistoryFilterKey;
    if (filterChanged) {
      lastAnalysisHistoryFilterRef.current = analysisHistoryFilterKey;
      if (analysisHistoryPage !== 1) {
        setAnalysisHistoryPage(1);
      }
      const fetchKey = `${analysisHistoryFilterKey}:1`;
      if (lastAnalysisHistoryFetchRef.current !== fetchKey) {
        lastAnalysisHistoryFetchRef.current = fetchKey;
        fetchAnalysisHistory({ page: 1, resetSelection: true });
      }
      return;
    }
    const fetchKey = `${analysisHistoryFilterKey}:${analysisHistoryPage}`;
    if (lastAnalysisHistoryFetchRef.current === fetchKey) return;
    lastAnalysisHistoryFetchRef.current = fetchKey;
    fetchAnalysisHistory({ page: analysisHistoryPage, resetSelection: analysisHistoryPage === 1 });
  }, [analysisHistoryFilterKey, analysisHistoryPage, fetchAnalysisHistory, symbol]);

  const deleteAnalysisHistoryMutation = useMutation({
    mutationFn: async ({ ids, all, scope }: { ids?: string[]; all?: boolean; scope?: 'self' | 'tenant' }) => {
      const response = await apiRequest('POST', '/api/integrations/trading/analysis/history/delete', {
        ids,
        all,
        scope,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || t('trading.analysis.historyDeleteFailed'));
      }
      return payload;
    },
    onSuccess: () => {
      toast({ title: t('trading.analysis.historyDeleted') });
      setAnalysisHistoryPage(1);
      fetchAnalysisHistory({ page: 1, resetSelection: true });
    },
    onError: (error: Error) => {
      toast({ title: t('trading.analysis.historyDeleteFailed'), description: error.message, variant: 'destructive' });
    },
  });

  const purgeAnalysisHistoryMutation = useMutation({
    mutationFn: async ({ ids, all, scope }: { ids?: string[]; all?: boolean; scope?: 'self' | 'tenant' }) => {
      const response = await apiRequest('POST', '/api/integrations/trading/analysis/history/purge', {
        ids,
        all,
        scope,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || t('trading.analysis.historyPurgeFailed'));
      }
      return payload;
    },
    onSuccess: () => {
      toast({ title: t('trading.analysis.historyPurged') });
      setAnalysisHistoryPage(1);
      fetchAnalysisHistory({ page: 1, resetSelection: true });
    },
    onError: (error: Error) => {
      toast({ title: t('trading.analysis.historyPurgeFailed'), description: error.message, variant: 'destructive' });
    },
  });

  const toggleAnalysisHistorySelection = (analysisId: string, checked: boolean) => {
    setAnalysisHistorySelectedIds((prev) => {
      const updated = new Set(prev);
      if (checked) {
        updated.add(analysisId);
      } else {
        updated.delete(analysisId);
      }
      return updated;
    });
  };

  const toggleAnalysisHistorySelectAll = (checked: boolean) => {
    if (checked) {
      setAnalysisHistorySelectedIds(new Set(analysisHistoryItems.map((item) => item.id)));
      return;
    }
    setAnalysisHistorySelectedIds(new Set());
  };

  const updateAnalysisSchedulerMutation = useMutation({
    mutationFn: async () => {
      const intervalMinutes = Number.parseInt(analysisSchedulerForm.intervalMinutes, 10);
      const maxSymbolsPerRun = Number.parseInt(analysisSchedulerForm.maxSymbolsPerRun, 10);
      if (Number.isNaN(intervalMinutes) || Number.isNaN(maxSymbolsPerRun)) {
        throw new Error(t('trading.analysis.scheduler.errors.updateFailed'));
      }

      const payload = {
        marketType: marketType ?? 'futures',
        marginMode: marketType === 'margin' ? marginMode : undefined,
        intervalMinutes,
        interval: primaryInterval,
        symbols: analysisSchedulerForm.symbols
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        enabled: analysisSchedulerForm.enabled,
        maxSymbolsPerRun,
        techniques: profileForm.techniques,
        ensembleConfig: profileForm.ensembleConfig,
        arbitrageConfig: profileForm.arbitrageConfig ?? undefined,
      };

      const res = await apiRequest('PUT', '/api/integrations/trading/analysis-scheduler', payload);
      return res.json();
    },
    onSuccess: (data) => {
      if (!data?.success) {
        throw new Error(data?.error || t('trading.analysis.scheduler.errors.updateFailed'));
      }
      toast({
        title: t('trading.analysis.scheduler.success.updated'),
      });
      refetchAnalysisScheduler();
    },
    onError: (err: Error) => {
      toast({
        title: t('trading.analysis.scheduler.errors.updateFailed'),
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const buildProfilePayload = useCallback((form: AnalysisProfile): AnalysisProfilePayload => ({
    kind: 'analysis',
    marketType,
    symbol,
    timeframes: form.timeframes,
    indicators: form.indicators,
    dataSources: form.dataSources,
    newsConfig: form.newsConfig,
    techniques: form.techniques,
    ensembleConfig: form.ensembleConfig,
    arbitrageConfig: form.arbitrageConfig ?? undefined,
    consensus: form.consensus,
  }), [marketType, symbol]);

  const profilePayload = useMemo(
    () => buildProfilePayload(profileForm),
    [buildProfilePayload, profileForm]
  );

  useEffect(() => {
    if (profileResponse?.data) {
      const nextForm: AnalysisProfile = {
        ...profileResponse.data,
        newsConfig: normalizeTradingNewsConfigForm(profileResponse.data.newsConfig),
        techniques: profileResponse.data.techniques?.length
          ? profileResponse.data.techniques
          : DEFAULT_TECHNIQUES,
        ensembleConfig: profileResponse.data.ensembleConfig ?? DEFAULT_ENSEMBLE_CONFIG,
        arbitrageConfig: profileResponse.data.arbitrageConfig ?? null,
      };
      setProfileForm(nextForm);
      autoSaveEnabledRef.current = true;
      autoSaveLastPayloadRef.current = JSON.stringify(buildProfilePayload(nextForm));
      if (profileResponse.data.timeframes?.[0]) {
        setInterval(profileResponse.data.timeframes[0]);
      }
    }
  }, [buildProfilePayload, profileResponse]);

  const updateProfileMutation = useMutation({
    mutationFn: async (payload: AnalysisProfilePayload) => {
      const res = await apiRequest('PUT', '/api/integrations/trading/analysis-profile', payload);
      return res.json();
    },
    onSuccess: (data, variables) => {
      if (!data?.success) {
        throw new Error(data?.error || t('trading.errors.profileUpdateFailed'));
      }
      setProfileForm(data.data as AnalysisProfile);
      autoSaveLastPayloadRef.current = JSON.stringify(variables);
      if (!autoSaveContextRef.current) {
        toast({ title: t('trading.success.profileUpdated') });
      }
      refetchProfile();
    },
    onError: (err: Error) => {
      if (!autoSaveContextRef.current) {
        toast({
          title: t('trading.errors.profileUpdateFailed'),
          description: err.message,
          variant: 'destructive',
        });
      }
    },
    onSettled: () => {
      autoSaveContextRef.current = false;
    },
  });

  useEffect(() => {
    if (!autoSaveEnabledRef.current) return;
    if (!symbol) return;
    // Impede auto-save com arrays obrigatórios vazios (causa 400 no backend - Zod .min(1))
    if (profilePayload.timeframes.length === 0 || profilePayload.indicators.length === 0 || profilePayload.techniques.length === 0) return;
    const payloadKey = JSON.stringify(profilePayload);
    if (payloadKey === autoSaveLastPayloadRef.current) return;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveContextRef.current = true;
      updateProfileMutation.mutate(profilePayload);
    }, AUTO_SAVE_DEBOUNCE_MS);
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [profilePayload, symbol, updateProfileMutation]);

  const executeAnalysisNowMutation = useMutation({
    mutationFn: async () => {
      const normalizedSymbol = symbol.trim();
      if (!normalizedSymbol) {
        throw new Error(t('trading.analysis.scheduler.errors.symbolRequired'));
      }
      const params = new URLSearchParams();
      if (profileForm.timeframes?.length) {
        params.set('timeframes', profileForm.timeframes.join(','));
      } else {
        params.set('interval', interval);
      }
      if (profileForm.indicators?.length) {
        params.set('indicators', profileForm.indicators.join(','));
      }
      if (profileForm.techniques?.length) {
        params.set('techniques', profileForm.techniques.join(','));
      }
      params.set('orderBook', String(profileForm.dataSources.orderBook));
      params.set('news', String(profileForm.dataSources.news));
      params.set('trainingData', String(profileForm.dataSources.trainingData));
      if (marketType) {
        params.set('marketType', marketType);
      }
      if (marketType === 'margin' && marginMode) {
        params.set('marginMode', marginMode);
      }
      const response = await apiRequest('GET', `/api/integrations/trading/analysis/${normalizedSymbol}?${params.toString()}`);
      return response.json();
    },
    onSuccess: (data) => {
      if (!data?.success) {
        throw new Error(data?.error || t('trading.analysis.scheduler.errors.executeFailed'));
      }
      toast({
        title: t('trading.analysis.scheduler.success.executed'),
      });
      refetch();
    },
    onError: (err: Error) => {
      toast({
        title: t('trading.analysis.scheduler.errors.executeFailed'),
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const analysisErrorCard = (
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

  const analysisHistoryDetailSummary = useMemo(() => {
    if (!analysisHistoryDetail) return [];
    return buildHistoryIndicatorSummary(analysisHistoryDetail);
  }, [analysisHistoryDetail, buildHistoryIndicatorSummary]);

  const analysisHistoryMetadata = (analysisHistoryDetail?.metadata ?? {}) as NonNullable<TradingAnalysisHistoryDetail['metadata']>;
  const analysisHistoryTechniques = Array.isArray(analysisHistoryMetadata.techniques)
    ? analysisHistoryMetadata.techniques.filter(Boolean)
    : [];
  const analysisHistoryScores = Array.isArray(analysisHistoryMetadata.techniqueScores)
    ? analysisHistoryMetadata.techniqueScores
    : [];
  const analysisHistoryEnsemble = analysisHistoryMetadata.ensembleResult ?? null;
  const AnalysisHistorySignalIcon = analysisHistoryDetail
    ? getSignalIcon(analysisHistoryDetail.overallSignal)
    : Activity;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('trading.analysis.profile.title')}</CardTitle>
          <CardDescription>{t('trading.analysis.profile.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Label>{t('trading.analysis.profile.timeframes')}</Label>
            <MultiSelectDropdown
              label={t('trading.analysis.profile.timeframes')}
              options={resolvedIntervalOptions.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              selectedValues={profileForm.timeframes}
              onChange={updateTimeframes}
              minSelected={1}
              placeholder={t('trading.common.selectPlaceholder')}
              selectedCountLabel={t('trading.common.selectedCount', { count: profileForm.timeframes.length })}
              maxLabel={t('trading.common.maxSelected', { max: profileForm.timeframes.length })}
              selectAllLabel={t('trading.common.selectAll')}
              clearLabel={t('trading.common.clearSelection')}
              emptyLabel={t('trading.common.noOptions')}
            />
            <p className="text-xs text-muted-foreground">{t('trading.analysis.profile.timeframesHint')}</p>
          </div>

          <div className="space-y-3">
            <Label>{t('trading.analysis.profile.indicators')}</Label>
            <MultiSelectDropdown
              label={t('trading.analysis.profile.indicators')}
              options={INDICATOR_OPTIONS.map((option) => ({
                value: option.key,
                label: option.label,
              }))}
              selectedValues={profileForm.indicators}
              onChange={updateIndicators}
              minSelected={1}
              placeholder={t('trading.common.selectPlaceholder')}
              selectedCountLabel={t('trading.common.selectedCount', { count: profileForm.indicators.length })}
              maxLabel={t('trading.common.maxSelected', { max: profileForm.indicators.length })}
              selectAllLabel={t('trading.common.selectAll')}
              clearLabel={t('trading.common.clearSelection')}
              emptyLabel={t('trading.common.noOptions')}
            />
            <p className="text-xs text-muted-foreground">{t('trading.analysis.profile.indicatorsSupportHint')}</p>
          </div>

        <div className="space-y-3">
          <Label>{t('trading.analysis.profile.techniques')}</Label>
          <MultiSelectDropdown
            label={t('trading.analysis.profile.techniques')}
            options={TRADING_TECHNIQUE_OPTIONS.map((option) => ({
              value: option.key,
              label: t(option.labelKey),
            }))}
            selectedValues={profileForm.techniques}
            onChange={updateTechniques}
            minSelected={1}
            placeholder={t('trading.common.selectPlaceholder')}
            selectedCountLabel={t('trading.common.selectedCount', { count: profileForm.techniques.length })}
            maxLabel={t('trading.common.maxSelected', { max: profileForm.techniques.length })}
            selectAllLabel={t('trading.common.selectAll')}
            clearLabel={t('trading.common.clearSelection')}
            emptyLabel={t('trading.common.noOptions')}
          />
          <p className="text-xs text-muted-foreground">{t('trading.analysis.profile.techniquesHint')}</p>
        </div>

        <div className="space-y-3">
          <Label>{t('trading.analysis.profile.ensemble')}</Label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('trading.analysis.profile.ensembleMode')}</Label>
              <Input value="ensemble_top3" disabled />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('trading.analysis.profile.ensembleTopN')}</Label>
              <Input
                value={String(profileForm.ensembleConfig?.topN ?? DEFAULT_ENSEMBLE_CONFIG.topN)}
                onChange={(event) => setProfileForm((prev) => ({
                  ...prev,
                  ensembleConfig: { ...DEFAULT_ENSEMBLE_CONFIG, ...prev.ensembleConfig, topN: Number(event.target.value) || DEFAULT_ENSEMBLE_CONFIG.topN },
                }))}
              />
            </div>
          </div>
        </div>

        {profileForm.techniques.includes('arbitrage_triangular') && profileForm.arbitrageConfig && (
          <div className="space-y-3">
            <Label>{t('trading.analysis.profile.arbitrage')}</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <MultiSelectDropdown
                  label={t('trading.analysis.profile.arbitrageExchange')}
                  options={availableArbitrageExchanges.map((exchange) => ({
                    value: exchange.id,
                    label: exchange.label,
                  }))}
                  selectedValues={profileForm.arbitrageConfig?.exchanges ?? []}
                  onChange={updateArbitrageExchanges}
                  placeholder={t('trading.common.selectPlaceholder')}
              selectedCountLabel={t('trading.common.selectedCount', { count: profileForm.arbitrageConfig?.exchanges?.length ?? 0 })}
              maxLabel={t('trading.common.maxSelected', { max: profileForm.arbitrageConfig?.exchanges?.length ?? 0 })}
                  selectAllLabel={t('trading.common.selectAll')}
                  clearLabel={t('trading.common.clearSelection')}
                  emptyLabel={arbitrageCatalogLoading ? t('trading.common.loadingOptions') : t('trading.common.noOptions')}
                />
              </div>
              <div className="space-y-2">
                <MultiSelectDropdown
                  label={t('trading.analysis.profile.arbitrageIntermediate')}
                  options={availableArbitrageAssets.map((asset) => ({
                    value: asset.toUpperCase(),
                    label: asset.toUpperCase(),
                  }))}
                  selectedValues={profileForm.arbitrageConfig?.intermediateAssets ?? []}
                  onChange={updateArbitrageAssets}
                  maxSelected={MAX_ARBITRAGE_ASSETS}
                  placeholder={t('trading.common.selectPlaceholder')}
              selectedCountLabel={t('trading.common.selectedCount', { count: profileForm.arbitrageConfig?.intermediateAssets?.length ?? 0 })}
              maxLabel={t('trading.common.maxSelected', { max: MAX_ARBITRAGE_ASSETS })}
                  selectAllLabel={t('trading.common.selectAll')}
                  clearLabel={t('trading.common.clearSelection')}
                  emptyLabel={arbitrageCatalogLoading ? t('trading.common.loadingOptions') : t('trading.common.noOptions')}
                />
                <p className="text-xs text-muted-foreground">
                  Limite de {MAX_ARBITRAGE_ASSETS} ativos para evitar explosão combinatória.
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">{t('trading.analysis.profile.arbitrageFee')}</Label>
                <Input value={String(profileForm.arbitrageConfig.feePct)} readOnly />
                <p className="text-xs text-muted-foreground">
                  Taxa automática (maior entre exchanges selecionadas).
                </p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">{t('trading.analysis.profile.arbitrageSlippage')}</Label>
                <Input
                  value={String(profileForm.arbitrageConfig.maxSlippagePct)}
                  onChange={(event) => updateArbitrageConfig({ maxSlippagePct: Number(event.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">{t('trading.analysis.profile.arbitrageMinEdge')}</Label>
                <Input
                  value={String(profileForm.arbitrageConfig.minEdgePct)}
                  onChange={(event) => updateArbitrageConfig({ minEdgePct: Number(event.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">{t('trading.analysis.profile.arbitrageMaxInterval')}</Label>
                <Input
                  value={String(profileForm.arbitrageConfig.maxIntervalMinutes)}
                  onChange={(event) => updateArbitrageConfig({
                    maxIntervalMinutes: Number(event.target.value) || DEFAULT_ARBITRAGE_CONFIG.maxIntervalMinutes,
                  })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Network fees são aplicadas automaticamente quando a rota cruza exchanges.
            </p>
            <p className="text-xs text-muted-foreground">{t('trading.analysis.profile.arbitrageHint')}</p>
          </div>
        )}

          <div className="space-y-3">
            <Label>{t('trading.analysis.profile.sources')}</Label>
            <MultiSelectDropdown
              label={t('trading.analysis.profile.sources')}
              options={analysisSourceOptions.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              selectedValues={selectedAnalysisSources}
              onChange={updateAnalysisSources}
              placeholder={t('trading.common.selectPlaceholder')}
              selectedCountLabel={t('trading.common.selectedCount', { count: selectedAnalysisSources.length })}
              maxLabel={t('trading.common.maxSelected', { max: selectedAnalysisSources.length })}
              selectAllLabel={t('trading.common.selectAll')}
              clearLabel={t('trading.common.clearSelection')}
              emptyLabel={t('trading.common.noOptions')}
            />
            <div className="text-xs text-muted-foreground space-y-1">
              {analysisSourceOptions.map((option) => (
                <p key={option.value}>
                  <span className="font-medium">{option.label}:</span> {option.description}
                </p>
              ))}
            </div>
          </div>

          <NewsConfigEditor
            value={profileForm.newsConfig}
            onChange={(next) => setProfileForm((prev) => ({
              ...prev,
              newsConfig: next,
            }))}
            title={t('trading.newsConfig.title')}
            description={t('trading.newsConfig.subtitleAnalysis')}
            presets={newsPresets}
            selectedPresetId={selectedNewsPresetId}
            onSelectPresetId={setSelectedNewsPresetId}
            onApplyPreset={(preset) => {
              setProfileForm((prev) => ({
                ...prev,
                newsConfig: normalizeTradingNewsConfigForm(preset.config),
              }));
            }}
            presetName={newsPresetName}
            presetDescription={newsPresetDescription}
            onPresetNameChange={setNewsPresetName}
            onPresetDescriptionChange={setNewsPresetDescription}
            onCreatePreset={(payload) => createNewsPresetMutation.mutate(payload)}
            onUpdatePreset={(payload) => updateNewsPresetMutation.mutate(payload)}
            onDeletePreset={(presetId) => deleteNewsPresetMutation.mutate(presetId)}
          />

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => updateProfileMutation.mutate(profilePayload)}
              disabled={updateProfileMutation.isPending || profilePayload.timeframes.length === 0 || profilePayload.indicators.length === 0 || profilePayload.techniques.length === 0}
            >
              {updateProfileMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('trading.analysis.profile.save')}
            </Button>
            <Button
              variant="outline"
              onClick={() => executeAnalysisNowMutation.mutate()}
              disabled={executeAnalysisNowMutation.isPending || !symbol.trim()}
            >
              {executeAnalysisNowMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('trading.analysis.executeNow')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => selectedNewsPreset && updateNewsPresetMutation.mutate({
                id: selectedNewsPreset.id,
                name: normalizedNewsPresetName,
                description: newsPresetDescription.trim() || null,
                config: profileForm.newsConfig,
              })}
              disabled={!canUpdateNewsPreset || updateNewsPresetMutation.isPending}
            >
              {updateNewsPresetMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('trading.newsConfig.updatePreset')}
            </Button>
            <Button
              type="button"
              onClick={() => createNewsPresetMutation.mutate({
                name: normalizedNewsPresetName,
                description: newsPresetDescription.trim() || null,
                config: profileForm.newsConfig,
              })}
              disabled={!canCreateNewsPreset || createNewsPresetMutation.isPending}
            >
              {createNewsPresetMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('trading.newsConfig.createPreset')}
            </Button>
          </div>

          <Separator className="my-6" />

          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">{t('trading.analysis.scheduler.title')}</h3>
              <p className="text-xs text-muted-foreground">{t('trading.analysis.scheduler.subtitle')}</p>
            </div>

            <div className="space-y-2">
              <Label>{t('trading.analysis.scheduler.timeframesLabel')}</Label>
              <div className="flex flex-wrap gap-2">
                {(profileForm.timeframes ?? []).map((frame) => (
                  <Badge key={frame} variant="outline">
                    {frame}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t('trading.analysis.scheduler.timeframesHint')}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('trading.analysis.scheduler.intervalMinutes')}</Label>
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  value={analysisSchedulerForm.intervalMinutes}
                  onChange={(event) => setAnalysisSchedulerForm({ ...analysisSchedulerForm, intervalMinutes: event.target.value })}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>{t('trading.analysis.scheduler.symbols')}</Label>
                <Input
                  value={analysisSchedulerForm.symbols}
                  onChange={(event) => setAnalysisSchedulerForm({ ...analysisSchedulerForm, symbols: event.target.value })}
                  placeholder={t('trading.analysis.scheduler.symbolsPlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('trading.analysis.scheduler.maxSymbols')}</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={analysisSchedulerForm.maxSymbolsPerRun}
                  onChange={(event) => setAnalysisSchedulerForm({ ...analysisSchedulerForm, maxSymbolsPerRun: event.target.value })}
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={analysisSchedulerForm.enabled}
                  onCheckedChange={(checked) => setAnalysisSchedulerForm({ ...analysisSchedulerForm, enabled: checked })}
                />
                <span className="text-sm">{t('trading.analysis.scheduler.enabled')}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => updateAnalysisSchedulerMutation.mutate()}
                disabled={updateAnalysisSchedulerMutation.isPending}
              >
                {updateAnalysisSchedulerMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t('trading.analysis.scheduler.save')}
              </Button>
            </div>

            <div className="text-xs text-muted-foreground grid gap-1">
              <span>{t('trading.analysis.scheduler.status.nextRun')}: {analysisSchedulerConfig?.nextRunAt ? formatDateTime(String(analysisSchedulerConfig.nextRunAt), { locale, timeZone }) : t('common.notAvailable')}</span>
              <span>{t('trading.analysis.scheduler.status.lastRun')}: {analysisSchedulerConfig?.lastRunAt ? formatDateTime(String(analysisSchedulerConfig.lastRunAt), { locale, timeZone }) : t('common.notAvailable')}</span>
              <span>{t('trading.analysis.scheduler.status.lastSuccess')}: {analysisSchedulerConfig?.lastSuccessAt ? formatDateTime(String(analysisSchedulerConfig.lastSuccessAt), { locale, timeZone }) : t('common.notAvailable')}</span>
              <span>{t('trading.analysis.scheduler.status.lastDuration')}: {analysisSchedulerConfig?.lastDurationMs ? `${analysisSchedulerConfig.lastDurationMs}ms` : t('common.notAvailable')}</span>
              {analysisSchedulerConfig?.lastError && (
                <span className="text-destructive">{t('trading.analysis.scheduler.status.lastError')}: {analysisSchedulerConfig.lastError}</span>
              )}
              {analysisSchedulerError && (
                <span className="text-destructive">{t('trading.analysis.scheduler.status.loadError')}</span>
              )}
              {isLoadingAnalysisScheduler && (
                <span>{t('trading.analysis.scheduler.status.loading')}</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {error ? analysisErrorCard : (
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
          <div className="flex items-center gap-2" />
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
                  <p className="text-3xl font-bold">
                    {formatNumber(analysis.confidence * 100, locale, {
                      maximumFractionDigits: 0,
                    })}
                    %
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <Progress
                  value={analysis.confidence * 100}
                  className="h-2 bg-white/20"
                />
              </div>
              <div className="mt-4 flex justify-between text-sm opacity-80">
                <span>Preço: {formatPrice(analysis.currentPrice, locale)}</span>
                <span>Última atualização: {formatDateTime(analysis.timestamp, { locale, timeZone })}</span>
              </div>
            </div>

            {analysisResponse?.tradePlan && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('trading.analysis.tradePlan.title')}</CardTitle>
                  <CardDescription>{t('trading.analysis.tradePlan.subtitle')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">{t('trading.analysis.tradePlan.operationType')}</span>
                      <div className="text-sm font-medium">
                        {t(`trading.analysis.tradePlan.operationTypeValues.${analysisResponse.tradePlan.operationType}`)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">{t('trading.analysis.tradePlan.duration')}</span>
                      <div className="text-sm font-medium">{analysisResponse.tradePlan.expectedDurationLabel}</div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">{t('trading.analysis.tradePlan.entry')}</span>
                      <div className="text-sm font-medium">
                        {formatPlanPrice(analysisResponse.tradePlan.entryPrice, locale) ?? t('common.notAvailable')}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">{t('trading.analysis.tradePlan.tp')}</span>
                      <div className="text-sm font-medium">
                        {formatPlanPrice(analysisResponse.tradePlan.takeProfit, locale) ?? t('common.notAvailable')}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">{t('trading.analysis.tradePlan.sl')}</span>
                      <div className="text-sm font-medium">
                        {formatPlanPrice(analysisResponse.tradePlan.stopLoss, locale) ?? t('common.notAvailable')}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">{t('trading.analysis.tradePlan.rr')}</span>
                      <div className="text-sm font-medium">
                        {Number.isFinite(analysisResponse.tradePlan.riskReward)
                          ? formatNumber(Number(analysisResponse.tradePlan.riskReward), locale, { maximumFractionDigits: 2 })
                          : t('common.notAvailable')}
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <span className="text-xs text-muted-foreground">{t('trading.analysis.tradePlan.summary')}</span>
                    <p className="text-sm">{analysisResponse.tradePlan.tradeSummary}</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <span className="text-xs text-muted-foreground">{t('trading.analysis.tradePlan.motivators')}</span>
                      <ul className="mt-2 text-sm text-muted-foreground list-disc pl-5 space-y-1">
                        {analysisResponse.tradePlan.motivators.map((item, index) => (
                          <li key={`tradeplan-motivator-${index}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">{t('trading.analysis.tradePlan.invalidations')}</span>
                      <ul className="mt-2 text-sm text-muted-foreground list-disc pl-5 space-y-1">
                        {analysisResponse.tradePlan.invalidationReasons.map((item, index) => (
                          <li key={`tradeplan-invalidation-${index}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {analysisResponse?.ensembleResult && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('trading.analysis.ensemble.title')}</CardTitle>
                  <CardDescription>{t('trading.analysis.ensemble.subtitle')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="outline">
                      {t('trading.analysis.ensemble.overallLabel')} {analysisResponse.ensembleResult.overallSignal.toUpperCase()}
                    </Badge>
                    <Badge variant="outline">
                      {t('trading.analysis.ensemble.confidenceLabel')} {formatNumber(analysisResponse.ensembleResult.confidence * 100, locale, { maximumFractionDigits: 0 })}%
                    </Badge>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {(analysisResponse.ensembleResult.topTechniques ?? []).map((technique) => (
                      <div key={`${technique.technique}-${technique.signal}`} className="rounded-md border p-3">
                        <p className="text-sm font-medium">{t(`trading.techniques.${technique.technique}.title`)}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{t('trading.analysis.ensemble.signalLabel')} {technique.signal.toUpperCase()}</span>
                          <span>•</span>
                          <span>{formatNumber(technique.confidence * 100, locale, { maximumFractionDigits: 0 })}%</span>
                        </div>
                        {technique.rationale && (
                          <p className="text-xs text-muted-foreground mt-2">{technique.rationale}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {(analysisResponse?.arbitrageSnapshots?.length || analysisResponse?.arbitrageSnapshot) && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('trading.analysis.arbitrage.title')}</CardTitle>
                  <CardDescription>{t('trading.analysis.arbitrage.subtitle')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(analysisResponse.arbitrageSnapshots?.length
                    ? analysisResponse.arbitrageSnapshots
                    : analysisResponse.arbitrageSnapshot
                      ? [analysisResponse.arbitrageSnapshot]
                      : []
                  ).map((snapshot, index) => (
                    <div key={`${snapshot.intermediateAsset}-${index}`} className="space-y-2 rounded-md border px-3 py-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <Badge variant="outline"># {index + 1}</Badge>
                        <Badge variant="outline">
                          {t('trading.analysis.arbitrage.assetLabel')} {snapshot.intermediateAsset}
                        </Badge>
                        <Badge variant="outline">
                          {t('trading.analysis.arbitrage.edgeLabel')} {formatNumber(snapshot.edgePct, locale, { maximumFractionDigits: 2 })}%
                        </Badge>
                        {snapshot.networkFeeTotal !== undefined && (
                          <Badge variant="outline">
                            Network fee {formatNumber(snapshot.networkFeeTotal, locale, { maximumFractionDigits: 6 })}
                          </Badge>
                        )}
                      </div>
                      <div className="grid gap-2">
                        {snapshot.legs.map((leg, legIndex) => (
                          <div key={`${leg.symbol}-${legIndex}`} className="text-xs text-muted-foreground">
                            {leg.from} → {leg.to} ({leg.symbol}) • {leg.side.toUpperCase()} • {formatNumber(leg.rate, locale, { maximumFractionDigits: 6 })}
                            {leg.exchange ? ` • ${leg.exchange}` : ''}
                          </div>
                        ))}
                      </div>
                      {snapshot.networkFeesApplied?.length ? (
                        <div className="text-xs text-muted-foreground">
                          Network fees: {snapshot.networkFeesApplied.map((fee) => `${fee.asset} ${fee.amount} (${fee.fromExchange}→${fee.toExchange})`).join(', ')}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {analysisResponse?.consensus && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('trading.analysis.consensus.title')}</CardTitle>
                  <CardDescription>{t('trading.analysis.consensus.subtitle')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-4">
                    <Badge variant="outline">{t('trading.analysis.consensus.signalLabel')} {analysisResponse.consensus.overallSignal.toUpperCase()}</Badge>
                    <Badge variant="outline">
                      {t('trading.analysis.consensus.agreementLabel')} {formatNumber(analysisResponse.consensus.agreementRatio * 100, locale, { maximumFractionDigits: 0 })}%
                    </Badge>
                    <Badge variant="outline">{t('trading.analysis.consensus.requiredLabel')} {analysisResponse.consensus.requiredAgree}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {t('trading.analysis.consensus.alignedLabel')} {analysisResponse.consensus.alignedTimeframes.join(', ') || t('trading.analysis.consensus.none')}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {t('trading.analysis.consensus.misalignedLabel')} {analysisResponse.consensus.misalignedTimeframes.join(', ') || t('trading.analysis.consensus.none')}
                  </div>
                </CardContent>
              </Card>
            )}

            {analysisResponse?.matrix?.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('trading.analysis.matrix.title')}</CardTitle>
                  <CardDescription>{t('trading.analysis.matrix.subtitle')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {analysisResponse.matrix.map((entry) => (
                      <div key={entry.interval} className="border rounded-md p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{entry.interval}</span>
                          <Badge variant="outline">{getSignalLabel(entry.analysis.overallSignal)}</Badge>
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {t('trading.analysis.matrix.confidenceLabel')} {formatNumber(entry.analysis.confidence * 100, locale, { maximumFractionDigits: 0 })}%
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {analysisResponse?.matrix?.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('trading.analysis.explain.title')}</CardTitle>
                  <CardDescription>{t('trading.analysis.explain.subtitle')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {analysisResponse.matrix.map((entry) => (
                    <div key={`explain-${entry.interval}`} className="border rounded-md p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{entry.interval}</span>
                        <Badge variant="outline">{getSignalLabel(entry.analysis.overallSignal)}</Badge>
                      </div>
                      <ul className="mt-2 text-sm text-muted-foreground list-disc pl-5 space-y-1">
                        {buildIndicatorExplanation(entry.analysis).map((item) => (
                          <li key={`${entry.interval}-${item.title}`}>
                            <span className="font-medium text-foreground">{item.title}:</span> {item.detail}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            {analysisResponse?.sources && (analysisResponse.sources.orderBook || analysisResponse.sources.news || analysisResponse.sources.trainingData) && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('trading.analysis.sources.title')}</CardTitle>
                  <CardDescription>{t('trading.analysis.sources.subtitle')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  {analysisResponse.sources.orderBook && (
                    <div>
                      <p className="font-medium text-foreground">{t('trading.analysis.sources.orderBookTitle')}</p>
                      <p>
                        {t('trading.analysis.sources.orderBookLine', {
                          bid: analysisResponse.sources.orderBook.bestBid ?? 'N/A',
                          ask: analysisResponse.sources.orderBook.bestAsk ?? 'N/A',
                          spreadAbs: analysisResponse.sources.orderBook.spreadAbs ?? 'N/A',
                          spreadPct: analysisResponse.sources.orderBook.spreadPct ?? 'N/A',
                        })}
                      </p>
                    </div>
                  )}
                  {analysisResponse.sources.news && (
                    <div>
                      <p className="font-medium text-foreground">{t('trading.analysis.sources.newsTitle')}</p>
                      <p className="text-sm text-muted-foreground">
                        {t('trading.analysis.sources.newsQuery')}: {analysisResponse.sources.news.query}
                      </p>
                      {(analysisResponse.sources.news.results?.length ?? 0) > 0 ? (
                        <ul className="list-disc pl-5">
                          {analysisResponse.sources.news.results.map((item) => (
                            <li key={item.url}>
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-foreground hover:underline"
                              >
                                {item.title}
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground">{t('trading.analysis.sources.newsEmpty')}</p>
                      )}
                    </div>
                  )}
                  {analysisResponse.sources.trainingData && (
                    <div>
                      <p className="font-medium text-foreground">{t('trading.analysis.sources.trainingTitle')}</p>
                      <p>{t('trading.analysis.sources.trainingTotal', { total: analysisResponse.sources.trainingData.totalApproved })}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Grid de Indicadores */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {analysis.rsi && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Gauge className="h-4 w-4" />
                      RSI ({analysis.rsi.period})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-bold">
                        {formatNumber(analysis.rsi.value, locale, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
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
              )}

              {analysis.macd && (
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
                        <span className="font-mono">
                          {formatNumber(analysis.macd.macd, locale, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Signal</span>
                        <span className="font-mono">
                          {formatNumber(analysis.macd.signal, locale, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Histograma</span>
                        <span className={`font-mono ${analysis.macd.histogram > 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {formatNumber(analysis.macd.histogram, locale, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
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
              )}

              {analysis.movingAverages && (
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
                        <span className="font-mono text-sm">{formatPrice(analysis.movingAverages.ema9, locale)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">EMA 21</span>
                        <span className="font-mono text-sm">{formatPrice(analysis.movingAverages.ema21, locale)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">EMA 200</span>
                        <span className="font-mono text-sm">{formatPrice(analysis.movingAverages.ema200, locale)}</span>
                      </div>
                      <Separator className="my-2" />
                      <div className="flex justify-center">
                        {getTrendBadge(analysis.movingAverages.trend)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {analysis.bollinger && (
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
                        <span className="font-mono text-sm">{formatPrice(analysis.bollinger.upper, locale)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Média</span>
                        <span className="font-mono text-sm">{formatPrice(analysis.bollinger.middle, locale)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Inferior</span>
                        <span className="font-mono text-sm">{formatPrice(analysis.bollinger.lower, locale)}</span>
                      </div>
                      <Separator className="my-2" />
                      <div className="flex justify-between items-center">
                        <span className="text-xs">
                          %B:{' '}
                          {formatNumber(analysis.bollinger.percentB * 100, locale, {
                            maximumFractionDigits: 0,
                          })}
                          %
                        </span>
                        {getInterpretationBadge(analysis.bollinger.interpretation)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {analysis.stochastic && (
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
                        <span className="font-mono">
                          {formatNumber(analysis.stochastic.k, locale, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">%D</span>
                        <span className="font-mono">
                          {formatNumber(analysis.stochastic.d, locale, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                      <Progress value={analysis.stochastic.k} className="h-2" />
                      <div className="flex justify-center">
                        {getInterpretationBadge(analysis.stochastic.interpretation)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {analysis.adx && (
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
                        <span className="text-2xl font-bold">
                          {formatNumber(analysis.adx.adx, locale, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
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
                        <span className="text-green-500">
                          +DI:{' '}
                          {formatNumber(analysis.adx.plusDI, locale, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                        <span className="text-red-500">
                          -DI:{' '}
                          {formatNumber(analysis.adx.minusDI, locale, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {analysis.supportResistance && (
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
                      <p className="font-mono text-green-600">
                        {formatPrice(analysis.supportResistance.support3, locale)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">S2</p>
                      <p className="font-mono text-green-500">
                        {formatPrice(analysis.supportResistance.support2, locale)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">S1</p>
                      <p className="font-mono text-green-400">
                        {formatPrice(analysis.supportResistance.support1, locale)}
                      </p>
                    </div>
                    <div className="bg-muted rounded-lg p-2">
                      <p className="text-muted-foreground text-xs">Pivot</p>
                      <p className="font-mono font-bold">
                        {formatPrice(analysis.supportResistance.pivot, locale)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">R1</p>
                      <p className="font-mono text-red-400">
                        {formatPrice(analysis.supportResistance.resistance1, locale)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">R2</p>
                      <p className="font-mono text-red-500">
                        {formatPrice(analysis.supportResistance.resistance2, locale)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">R3</p>
                      <p className="font-mono text-red-600">
                        {formatPrice(analysis.supportResistance.resistance3, locale)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {(analysis.volume || analysis.atr) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {analysis.volume && (
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
                          <span className="font-mono">
                            {formatNumber(analysis.volume.currentVolume, locale)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Média (20)</span>
                          <span className="font-mono">
                            {formatNumber(analysis.volume.averageVolume, locale)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Ratio</span>
                          <Badge
                            variant={analysis.volume.interpretation === 'high' || analysis.volume.interpretation === 'very_high'
                              ? 'default' : 'secondary'}
                          >
                            {formatNumber(analysis.volume.volumeRatio, locale, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                            x
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {analysis.atr && (
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
                          <span className="text-2xl font-bold">{formatPrice(analysis.atr.value, locale)}</span>
                          <Badge
                            variant={analysis.atr.volatility === 'high' ? 'destructive' : 'secondary'}
                          >
                            {analysis.atr.volatility === 'low' && 'Baixa'}
                            {analysis.atr.volatility === 'medium' && 'Média'}
                            {analysis.atr.volatility === 'high' && 'Alta'}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {formatNumber(analysis.atr.percentage, locale, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                          % do preço atual
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

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
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('trading.analysis.history.title')}</CardTitle>
          <CardDescription>{t('trading.analysis.history.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Button
              variant="destructive"
              disabled={!hasAnalysisHistorySelection || deleteAnalysisHistoryMutation.isPending}
              onClick={() => deleteAnalysisHistoryMutation.mutate({ ids: Array.from(analysisHistorySelectedIds), scope: 'self' })}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t('trading.analysis.history.deleteSelected')}
            </Button>
            <Button
              variant="outline"
              disabled={deleteAnalysisHistoryMutation.isPending}
              onClick={() => deleteAnalysisHistoryMutation.mutate({ all: true, scope: 'self' })}
            >
              {t('trading.analysis.history.deleteAllMine')}
            </Button>
            {isAdminRole && (
              <>
                <Button
                  variant="outline"
                  disabled={deleteAnalysisHistoryMutation.isPending}
                  onClick={() => deleteAnalysisHistoryMutation.mutate({ all: true, scope: 'tenant' })}
                >
                  {t('trading.analysis.history.deleteAllTenant')}
                </Button>
                <Button
                  variant="destructive"
                  disabled={!hasAnalysisHistorySelection || purgeAnalysisHistoryMutation.isPending}
                  onClick={() => purgeAnalysisHistoryMutation.mutate({ ids: Array.from(analysisHistorySelectedIds), scope: 'tenant' })}
                >
                  {t('trading.analysis.history.purgeSelected')}
                </Button>
                <Button
                  variant="destructive"
                  disabled={purgeAnalysisHistoryMutation.isPending}
                  onClick={() => purgeAnalysisHistoryMutation.mutate({ all: true, scope: 'tenant' })}
                >
                  {t('trading.analysis.history.purgeAllTenant')}
                </Button>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t('trading.analysis.history.filters.dateFrom')}</Label>
              <Input
                type="date"
                value={analysisHistoryDateFrom}
                onChange={(event) => setAnalysisHistoryDateFrom(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t('trading.analysis.history.filters.dateTo')}</Label>
              <Input
                type="date"
                value={analysisHistoryDateTo}
                onChange={(event) => setAnalysisHistoryDateTo(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t('trading.analysis.history.filters.orderByDate')}</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={analysisHistoryOrder}
                onChange={(event) => setAnalysisHistoryOrder(event.target.value === 'asc' ? 'asc' : 'desc')}
              >
                <option value="desc">{t('trading.analysis.history.filters.orderDesc')}</option>
                <option value="asc">{t('trading.analysis.history.filters.orderAsc')}</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t('trading.analysis.history.filters.signal')}</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={analysisHistorySignalFilter}
                onChange={(event) => setAnalysisHistorySignalFilter(event.target.value)}
              >
                <option value="">{t('trading.analysis.history.filters.all')}</option>
                {ANALYSIS_SIGNAL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t('trading.analysis.history.filters.analysisType')}</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={analysisHistoryTechniqueFilter}
                onChange={(event) => setAnalysisHistoryTechniqueFilter(event.target.value)}
              >
                <option value="">{t('trading.analysis.history.filters.all')}</option>
                {TRADING_TECHNIQUE_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>{t(option.labelKey)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t('trading.analysis.history.filters.pageSize')}</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={analysisHistoryPageSize}
                onChange={(event) => setAnalysisHistoryPageSize(Number(event.target.value) || 25)}
              >
                {[10, 25, 50, 100].map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>
          </div>

          {analysisHistoryLoading ? (
            <Skeleton className="h-64" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allAnalysisHistorySelected}
                      onCheckedChange={(checked) => toggleAnalysisHistorySelectAll(Boolean(checked))}
                    />
                  </TableHead>
                  <TableHead>{t('trading.analysis.history.table.date')}</TableHead>
                  <TableHead>{t('trading.analysis.history.table.symbol')}</TableHead>
                  <TableHead>{t('trading.analysis.history.table.interval')}</TableHead>
                  <TableHead>{t('trading.analysis.history.table.type')}</TableHead>
                  <TableHead>{t('trading.analysis.history.table.signal')}</TableHead>
                  <TableHead>{t('trading.analysis.history.table.confidence')}</TableHead>
                  <TableHead>{t('trading.analysis.history.table.price')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analysisHistoryItems.map((item) => {
                  const openDetail = () => setAnalysisHistoryDetail(item);
                  return (
                    <TableRow
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={openDetail}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openDetail();
                        }
                      }}
                    >
                      <TableCell onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={analysisHistorySelectedIds.has(item.id)}
                        onCheckedChange={(checked) => toggleAnalysisHistorySelection(item.id, Boolean(checked))}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(item.calculatedAt, { locale, timeZone })}
                    </TableCell>
                    <TableCell>{item.symbol}</TableCell>
                    <TableCell>{item.interval}</TableCell>
                    <TableCell>
                      {getTechniqueLabel(item.metadata?.techniques?.[0], t)}
                    </TableCell>
                    <TableCell className="uppercase">{item.overallSignal}</TableCell>
                    <TableCell>
                      {formatNumber(item.signalConfidence, locale, { maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>{formatNumber(item.currentPrice, locale, { maximumFractionDigits: 2 })}</TableCell>
                    </TableRow>
                  );
                })}
                {analysisHistoryItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      {t('trading.analysis.history.empty')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          <div className="flex items-center justify-between mt-4">
            <span className="text-xs text-muted-foreground">
              {t('trading.analysis.history.loadedCount', { count: analysisHistoryItems.length })} •
              {t('trading.analysis.history.pagination.pageOf', { page: analysisHistoryPage, totalPages: analysisHistoryTotalPages })} •
              {t('trading.analysis.history.pagination.total', { total: analysisHistoryTotal })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                disabled={analysisHistoryPage <= 1 || analysisHistoryLoading}
                onClick={() => setAnalysisHistoryPage((prev) => Math.max(1, prev - 1))}
              >
                {t('trading.analysis.history.pagination.prev')}
              </Button>
              <Button
                variant="outline"
                disabled={analysisHistoryPage >= analysisHistoryTotalPages || analysisHistoryLoading}
                onClick={() => setAnalysisHistoryPage((prev) => Math.min(analysisHistoryTotalPages, prev + 1))}
              >
                {analysisHistoryLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {t('trading.analysis.history.pagination.next')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <Dialog
        open={Boolean(analysisHistoryDetail)}
        onOpenChange={(open) => {
          if (!open) setAnalysisHistoryDetail(null);
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('trading.analysis.history.detail.title')}</DialogTitle>
            <DialogDescription>{t('trading.analysis.history.detail.description')}</DialogDescription>
          </DialogHeader>
          {analysisHistoryDetail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t('trading.analysis.history.detail.fields.signal')}</p>
                  <div className="flex items-center gap-2">
                    <AnalysisHistorySignalIcon className="h-4 w-4" />
                    <span className="font-semibold uppercase">{analysisHistoryDetail.overallSignal}</span>
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t('trading.analysis.history.detail.fields.confidence')}</p>
                  <span className="font-semibold">
                    {formatNumber(analysisHistoryDetail.signalConfidence * 100, locale, { maximumFractionDigits: 0 })}%
                  </span>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t('trading.analysis.history.detail.fields.price')}</p>
                  <span className="font-semibold">
                    {formatNumber(analysisHistoryDetail.currentPrice, locale, { maximumFractionDigits: 4 })}
                  </span>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t('trading.analysis.history.detail.fields.interval')}</p>
                  <span className="font-semibold">{analysisHistoryDetail.interval}</span>
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t('trading.analysis.history.detail.fields.date')}</p>
                <span className="font-semibold">
                  {formatDateTime(analysisHistoryDetail.calculatedAt, { locale, timeZone })}
                </span>
              </div>

              {analysisHistoryDetailSummary.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t('trading.analysis.history.detail.indicatorSummary')}</p>
                  <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                    {analysisHistoryDetailSummary.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {analysisHistoryTechniques.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t('trading.analysis.history.detail.techniquesTitle')}</p>
                  <div className="flex flex-wrap gap-2">
                    {analysisHistoryTechniques.map((technique) => (
                      <Badge key={technique} variant="outline">{technique}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {analysisHistoryEnsemble && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t('trading.analysis.history.detail.ensembleTitle')}</p>
                  <div className="text-sm text-muted-foreground space-y-1">
                    {analysisHistoryEnsemble.overallSignal && (
                      <div>
                        {t('trading.analysis.history.detail.ensembleSignal')}: {analysisHistoryEnsemble.overallSignal.toUpperCase()}
                      </div>
                    )}
                    {typeof analysisHistoryEnsemble.confidence === 'number' && (
                      <div>
                        {t('trading.analysis.history.detail.ensembleConfidence')}:{' '}
                        {formatNumber(analysisHistoryEnsemble.confidence * 100, locale, { maximumFractionDigits: 0 })}%
                      </div>
                    )}
                    {(analysisHistoryEnsemble.topTechniques ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {analysisHistoryEnsemble.topTechniques?.map((entry) => (
                          <Badge key={`${entry.technique}-${entry.signal}`} variant="secondary">
                            {entry.technique} ({entry.signal})
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {analysisHistoryScores.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t('trading.analysis.history.detail.scoresTitle')}</p>
                  <div className="grid gap-2">
                    {analysisHistoryScores.map((score) => (
                      <div key={`${score.technique}-${score.signal}`} className="rounded-md border px-3 py-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{score.technique}</span>
                          <Badge variant="outline">{score.signal}</Badge>
                        </div>
                        <div className="text-muted-foreground">
                          {t('trading.analysis.history.detail.scoreConfidence')}:{' '}
                          {formatNumber(score.confidence * 100, locale, { maximumFractionDigits: 0 })}%
                        </div>
                        {score.rationale && (
                          <div className="text-muted-foreground">{score.rationale}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(analysisHistoryMetadata.calculationDurationMs !== undefined
                || analysisHistoryMetadata.candleCount !== undefined
                || analysisHistoryMetadata.lastCandleTime) && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t('trading.analysis.history.detail.metadataTitle')}</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-muted-foreground">
                    {analysisHistoryMetadata.calculationDurationMs !== undefined && (
                      <div>
                        {t('trading.analysis.history.detail.calculationDuration')}:{' '}
                        {formatNumber(Number(analysisHistoryMetadata.calculationDurationMs), locale, { maximumFractionDigits: 0 })} ms
                      </div>
                    )}
                    {analysisHistoryMetadata.candleCount !== undefined && (
                      <div>
                        {t('trading.analysis.history.detail.candleCount')}:{' '}
                        {analysisHistoryMetadata.candleCount}
                      </div>
                    )}
                    {analysisHistoryMetadata.lastCandleTime && (
                      <div>
                        {t('trading.analysis.history.detail.lastCandleTime')}:{' '}
                        {formatDateTime(analysisHistoryMetadata.lastCandleTime, { locale, timeZone })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnalysisHistoryDetail(null)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TechnicalAnalysisPanel;
