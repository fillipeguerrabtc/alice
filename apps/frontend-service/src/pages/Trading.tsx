/**
 * Trading - Página de Trading KuCoin (Futures, Spot e Margin)
 * 
 * Dashboard enterprise-grade para trading automatizado na KuCoin
 * (Futures, Spot e Margin). Integrado com Alice IA (Gate 2) para sinais
 * autônomos e execução automática de ordens.
 * 
 * Gate 2 (LLM separado + Vision via OpenAI):
 * - LLM (texto): Qwen2.5 7B Instruct (AWQ) via GPU Manager (sinais/decisão)
 * - Vision (análise de imagens/gráficos): OpenAI Responses API (gpt-4.1)
 * 
 * Funcionalidades:
 * - Visualização em tempo real de dados de mercado
 * - Gestão de ordens (criar, cancelar, sincronizar)
 * - Monitoramento de posições abertas
 * - Configuração de gestão de risco
 * - Sinais de trading via LLM (texto)
 * - Análise visual de gráficos via OpenAI Vision
 * - Histórico completo de operações com auditoria
 * - Execução autônoma via Alice (Chat/WhatsApp)
 * 
 * Regra 6 - SEM MOCKS: Apenas dados reais da API KuCoin
 * Regra 10 - Documentação PT-BR
 * Regra 13 - Internacionalização i18next
 * 
 * Autor: Fillipe Guerra
 * Data: 16 de Janeiro de 2026
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  DollarSign,
  Percent,
  Shield,
  AlertTriangle,
  RefreshCw,
  Plus,
  X,
  Play,
  Pause,
  Settings,
  History,
  BarChart3,
  Target,
  Zap,
  FileCheck,
  Star,
  Pin,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Trash2,
  Loader2,
  Pencil,
  // CORREÇÃO 19/12/2025: Remover Eye não utilizado (no-unused-vars)
  Rocket,
  Brain,
  LineChart,
  Layers,
  Hand,
  CandlestickChart,
  Link2,
  Wallet,
  BookOpen,
} from 'lucide-react';
// CORREÇÃO 19/12/2025: Remover CardFooter não utilizado (no-unused-vars)
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/hooks/use-auth';
import { TIMEZONE } from '@/lib/i18n';
import { formatDateTime, formatNumber } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
// CORREÇÃO 19/12/2025: Remover DialogTrigger não utilizado (no-unused-vars)
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useKucoinWebSocket } from '@/hooks/useKucoinWebSocket';
import { apiRequest, ApiError, queryClient } from '@/lib/queryClient';
import { frontendLogger } from '@/lib/logger';
import { 
  CandleChart, 
  OrderBookViz, 
  HandoverPanel, 
  TechnicalAnalysisPanel,
  SignalApprovalPanel,
  MultiSelectDropdown,
  NewsConfigEditor,
  DEFAULT_TRADING_NEWS_CONFIG,
  normalizeTradingNewsConfigForm,
  OcoOrderForm,
  MarginDebitPanel,
  PositionActions,
  PositionHistoryButton,
  AccountOverview,
  DepositWithdraw,
  TransferPanel,
  SubAccountsPanel,
  LedgerHistory,
  TradeFees,
} from '@/components/trading';
import type { KlineData, OrderBookData, TradingControlMode, ControlHistoryEntry, TradingNewsConfigForm, TradingNewsPresetOption } from '@/components/trading';

// ============================================================================
// CONSTANTES DE POLLING (CORREÇÃO M3 - extrair magic numbers)
// ============================================================================

/** Intervalo de atualização do status geral do trading (30s) */
const STATUS_REFETCH_INTERVAL = 30_000;

/** Intervalo de atualização da lista de símbolos (10 min - muda raramente) */
const SYMBOLS_REFETCH_INTERVAL = 600_000;

/** Intervalo de atualização dos sinais de trading (15s) */
const SIGNALS_REFETCH_INTERVAL = 15_000;

/** Intervalo de atualização de conta/posições/ordens (10s) */
const ACCOUNT_REFETCH_INTERVAL = 10_000;

/** Intervalo de atualização do ticker quando WS ativo (15s) vs inativo (5s) */
const TICKER_REFETCH_INTERVAL_WS = 15_000;
const TICKER_REFETCH_INTERVAL_REST = 5_000;

/** Intervalo de atualização de klines quando WS ativo (2 min) vs inativo (1 min) */
const KLINES_REFETCH_INTERVAL_WS = 120_000;
const KLINES_REFETCH_INTERVAL_REST = 60_000;

/** Intervalo de atualização do order book quando WS ativo (20s) vs inativo (5s) */
const ORDERBOOK_REFETCH_INTERVAL_WS = 20_000;
const ORDERBOOK_REFETCH_INTERVAL_REST = 5_000;

/** Intervalo padrão de candles */
const DEFAULT_INTERVAL = '5m';

// ============================================================================
// TIPOS (TypeScript strict - Regra 8)
// ============================================================================

interface TradingStatus {
  isConfigured: boolean;
  missingKeys?: string[];
  circuitBreaker: {
    state: string;
    failures: number;
    successes: number;
  };
  riskConfig: RiskConfig | null;
  activeSignals: number;
  pendingOrders: number;
  requiresTenant?: boolean;
  defaultSymbol?: string;
}

interface KucoinWsStatus {
  configured: boolean;
  allowedSymbols?: string[];
  defaultSymbol?: string;
  supportedMarkets?: Array<'futures' | 'spot' | 'margin'>;
  public: { state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' };
  private: { enabled: boolean; state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' };
}

interface TradingSymbolsResponse {
  symbols: string[];
  defaultSymbol: string;
  favorites?: string[];
  featured?: string[];
  topSymbols?: string[];
}

interface OrderBookResponse {
  success: boolean;
  data: OrderBookData;
  depth: number;
}

interface RiskConfig {
  id: string;
  tenantId: string;
  maxPositionSize: string;
  maxDailyLoss: string;
  maxOrderValue: string;
  maxLeverage: number;
  maxOpenPositions: number;
  defaultLeverage: number;
  defaultSymbol: string | null;
  defaultMarketType: 'futures' | 'spot' | 'margin';
  marginMode: 'cross' | 'isolated';
  defaultStopLoss: string | null;
  defaultTakeProfit: string | null;
  tradingEnabled: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

interface MarketData {
  ticker: {
    symbol: string;
    price: string;
    bestBidPrice: string;
    bestAskPrice: string;
    bestBidSize: number;
    bestAskSize: number;
    ts: number;
  };
  contract: {
    symbol: string;
    baseCurrency: string;
    quoteCurrency: string;
    maxLeverage: number;
    markPrice: number;
    indexPrice: number;
    lastTradePrice: number;
    volumeOf24h: number;
    turnoverOf24h: number;
    openInterest: string;
    priceChgPct: number;
    priceChg: number;
    highPrice: number;
    lowPrice: number;
    fundingFeeRate: number;
    nextFundingRateTime: number;
    multiplier: number;
  };
}

interface FuturesAccountOverview {
  accountEquity: number;
  unrealisedPNL: number;
  marginBalance: number;
  positionMargin: number;
  orderMargin: number;
  frozenFunds: number;
  availableBalance: number;
  currency: string;
}

interface SpotAccount {
  id: string;
  currency: string;
  type: string;
  balance: string;
  available: string;
  holds: string;
}

interface MarginCrossAccountEntry {
  currency: string;
  total: string;
  available: string;
  hold: string;
  liability: string;
  liabilityPrincipal: string;
  liabilityInterest: string;
  maxBorrowSize: string;
  borrowEnabled: boolean;
  transferInEnabled: boolean;
}

interface MarginCrossAccount {
  totalAssetOfQuoteCurrency: string;
  totalLiabilityOfQuoteCurrency: string;
  debtRatio: string;
  status: string;
  accounts: MarginCrossAccountEntry[];
}

interface MarginIsolatedAssetDetail {
  currency: string;
  borrowEnabled: boolean;
  transferInEnabled: boolean;
  liability: string;
  liabilityPrincipal: string;
  liabilityInterest: string;
  total: string;
  available: string;
  hold: string;
  maxBorrowSize: string;
}

interface MarginIsolatedAsset {
  symbol: string;
  status: string;
  debtRatio: string;
  baseAsset: MarginIsolatedAssetDetail;
  quoteAsset: MarginIsolatedAssetDetail;
}

interface MarginIsolatedAccount {
  totalAssetOfQuoteCurrency: string;
  totalLiabilityOfQuoteCurrency: string;
  timestamp: number;
  assets: MarginIsolatedAsset[];
}

type AccountOverview = FuturesAccountOverview | SpotAccount[] | MarginCrossAccount | MarginIsolatedAccount | null;

type PositionsResponse = Position[] | SpotAccount[] | MarginCrossAccount | MarginIsolatedAccount;

function getQuoteCurrencyFromSymbol(symbol: string): string | null {
  if (!symbol) return null;
  const parts = symbol.split('-');
  if (parts.length < 2) return null;
  return parts[1] ?? null;
}

function getBaseCurrencyFromSymbol(symbol: string): string | null {
  if (!symbol) return null;
  const parts = symbol.split('-');
  if (parts.length < 2) return null;
  return parts[0] ?? null;
}

function isMarginCrossAccount(value: PositionsResponse | null | undefined): value is MarginCrossAccount {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as MarginCrossAccount).accounts));
}

function isMarginIsolatedAccount(value: PositionsResponse | null | undefined): value is MarginIsolatedAccount {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as MarginIsolatedAccount).assets));
}

interface Position {
  id: string;
  symbol: string;
  currentQty: number;
  currentCost: number;
  avgEntryPrice: number;
  markPrice: number;
  markValue: number;
  unrealisedPnl: number;
  unrealisedPnlPcnt: number;
  unrealisedRoePcnt: number;
  realLeverage: number;
  liquidationPrice: number;
  maintMargin: number;
  posMargin: number;
  isOpen: boolean;
  settleCurrency: string;
}

type TradingOperationType = 'scalping' | 'swing' | 'position' | 'cash_and_carry' | 'arbitrage' | 'hedge' | 'neutral';

interface TradingSignal {
  id: string;
  tenantId: string;
  // Alinhado ao backend (integrations-service) e ao enum do banco:
  // entry_long, entry_short, exit, adjust_sl, adjust_tp, hold, neutral
  signalType: 'entry_long' | 'entry_short' | 'exit' | 'adjust_sl' | 'adjust_tp' | 'hold' | 'neutral';
  symbol: string;
  marketType: 'futures' | 'spot' | 'margin';
  confidence: number;
  reasoning: string | null;
  sourceModel: string | null;
  metadata: {
    validationStatus?: 'pending' | 'validated' | 'failed';
    validationId?: string;
    generationSource?: 'on_demand' | 'scheduler' | 'chat';
    agentId?: string;
    namespaceId?: string;
    modelVersion?: string;
    approvalStatus?: 'pending' | 'approved' | 'rejected';
    approvalReason?: string;
    operationType?: TradingOperationType;
    expectedDurationMinutes?: number;
    expectedDurationLabel?: string;
    entryPrice?: number;
    takeProfit?: number;
    stopLoss?: number;
    riskReward?: number;
    motivators?: string[];
    invalidationReasons?: string[];
    tradeSummary?: string;
    dataSources?: {
      orderBook?: boolean;
      news?: boolean;
      trainingData?: boolean;
    };
    news?: {
      query: string;
      results: Array<{ title: string; url: string; score?: number }>;
    };
    [key: string]: unknown;
  };
  isActive: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

interface TradingOrder {
  id: string;
  tenantId: string;
  signalId: string | null;
  kucoinOrderId: string;
  clientOid: string;
  symbol: string;
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market' | 'stop_limit' | 'stop_market' | 'take_profit';
  status: 'pending_review' | 'review_rejected' | 'pending' | 'submitted' | 'open' | 'filled' | 'cancelled' | 'rejected' | 'expired' | 'error';
  price: string;
  size: string;
  filledSize: string | null;
  avgFilledPrice: string | null;
  leverage: number;
  stopLoss: string | null;
  takeProfit: string | null;
  metadata: Record<string, unknown>;
  criadoEm: string;
  atualizadoEm: string;
}

interface TradingProfileForm {
  kind: 'analysis' | 'signal';
  timeframes: string[];
  indicators: string[];
  techniques: string[];
  dataSources: {
    orderBook: boolean;
    news: boolean;
    trainingData: boolean;
  };
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

type SignalProfilePayload = {
  kind: 'signal';
  marketType: 'futures' | 'spot' | 'margin';
  symbol?: string;
  timeframes: string[];
  indicators: string[];
  dataSources: TradingProfileForm['dataSources'];
  newsConfig: TradingNewsConfigForm;
  techniques: string[];
  ensembleConfig?: TradingProfileForm['ensembleConfig'];
  arbitrageConfig?: TradingProfileForm['arbitrageConfig'];
  modelConfig?: TradingProfileForm['modelConfig'];
  consensus?: TradingProfileForm['consensus'];
};

// ============================================================================
// CONSTANTES
// ============================================================================

const SIGNAL_TYPES = [
  { value: 'entry_long', label: 'Entrada Long', icon: TrendingUp, color: 'text-green-500' },
  { value: 'entry_short', label: 'Entrada Short', icon: TrendingDown, color: 'text-red-500' },
  { value: 'exit', label: 'Saída/Fechar', icon: XCircle, color: 'text-yellow-500' },
  { value: 'adjust_sl', label: 'Ajustar Stop Loss', icon: Shield, color: 'text-yellow-500' },
  { value: 'adjust_tp', label: 'Ajustar Take Profit', icon: Target, color: 'text-yellow-500' },
  { value: 'hold', label: 'Manter', icon: Pause, color: 'text-gray-500' },
  { value: 'neutral', label: 'Neutro', icon: Hand, color: 'text-muted-foreground' },
];

function formatDurationMinutes(minutes?: number): string | null {
  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  if (minutes < 10080) return `${Math.round(minutes / 1440)}d`;
  return `${Math.round(minutes / 10080)}w`;
}

const SIGNAL_INDICATOR_OPTIONS = [
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

const DEFAULT_SIGNAL_TECHNIQUES = TRADING_TECHNIQUE_OPTIONS
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
const FALLBACK_INTERVAL_MINUTES: Record<string, number> = {
  '1m': 1,
  '3m': 3,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '2h': 120,
  '4h': 240,
  '8h': 480,
  '12h': 720,
  '1d': 1440,
  '1w': 10080,
};
const MAX_ARBITRAGE_ASSETS = 30;
const AUTO_SAVE_DEBOUNCE_MS = 600;

const ORDER_STATUS_BADGES: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof CheckCircle }> = {
  pending: { variant: 'secondary', icon: Clock },
  pending_review: { variant: 'secondary', icon: Clock },
  review_rejected: { variant: 'destructive', icon: XCircle },
  submitted: { variant: 'outline', icon: Activity },
  open: { variant: 'outline', icon: Activity },
  filled: { variant: 'default', icon: CheckCircle },
  cancelled: { variant: 'destructive', icon: XCircle },
  rejected: { variant: 'destructive', icon: AlertCircle },
  expired: { variant: 'secondary', icon: Clock },
  error: { variant: 'destructive', icon: AlertCircle },
};

// Animações Framer Motion
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { type: 'spring' as const, stiffness: 100, damping: 15 },
  },
} as const;

// ============================================================================
// COMPONENTES AUXILIARES
// ============================================================================

function PriceDisplay({
  price,
  change,
  changePercent,
  locale,
}: {
  price: number;
  change: number;
  changePercent: number;
  locale: string;
}) {
  const isPositive = change >= 0;
  
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-3xl font-bold tabular-nums">
        ${formatNumber(price, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <div className={`flex items-center gap-1 text-sm ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
        {isPositive ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
        <span>
          {isPositive ? '+' : ''}
          {formatNumber(change, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <span>
          ({isPositive ? '+' : ''}
          {formatNumber(changePercent * 100, locale, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
          %)
        </span>
      </div>
    </div>
  );
}

function StatCard({ 
  title, 
  value, 
  subtitle, 
  icon: Icon, 
  trend, 
  isLoading,
  className = '',
}: { 
  title: string; 
  value: string | number; 
  subtitle?: string; 
  icon: typeof Activity;
  trend?: 'up' | 'down' | 'neutral';
  isLoading?: boolean;
  className?: string;
}) {
  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="p-4">
          <Skeleton className="h-4 w-20 mb-2" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-3 w-16 mt-1" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{title}</p>
          <Icon className={`h-4 w-4 ${
            trend === 'up' ? 'text-green-500' : 
            trend === 'down' ? 'text-red-500' : 
            'text-muted-foreground'
          }`} />
        </div>
        <p className="text-2xl font-bold mt-1">{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

function SignalTypeBadge({ type }: { type: string }) {
  const config = SIGNAL_TYPES.find(s => s.value === type);
  if (!config) return <Badge variant="outline">{type}</Badge>;
  
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`${config.color} border-current`}>
      <Icon className="h-3 w-3 mr-1" />
      {config.label}
    </Badge>
  );
}

function OrderStatusBadge({ status }: { status: string }) {
  const config = ORDER_STATUS_BADGES[status] || { variant: 'outline' as const, icon: Activity };
  const Icon = config.icon;
  
  return (
    <Badge variant={config.variant}>
      <Icon className="h-3 w-3 mr-1" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function CircuitBreakerStatus({ state, failures }: { state: string; failures: number }) {
  const getColor = () => {
    switch (state.toLowerCase()) {
      case 'closed': return 'bg-green-500';
      case 'open': return 'bg-red-500';
      case 'half_open': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`h-2 w-2 rounded-full ${getColor()}`} />
      <span className="text-sm">{state}</span>
      {failures > 0 && (
        <Badge variant="destructive" className="text-xs">
          {failures} falhas
        </Badge>
      )}
    </div>
  );
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export default function Trading() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const locale = user?.idioma ?? 'pt-BR';
  const timeZone = user?.timezone ?? TIMEZONE;
  const userRoles = user?.roles ?? (user?.role ? [user.role] : []);
  const isAdminRole = userRoles.includes('admin') || userRoles.includes('super_admin');
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedMarketType, setSelectedMarketType] = useState<'futures' | 'spot' | 'margin'>('futures');
  const [selectedMarginMode, setSelectedMarginMode] = useState<'cross' | 'isolated'>('cross');
  const [marketDefaultsInitialized, setMarketDefaultsInitialized] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const sanitizedSymbol = selectedSymbol.trim();
  const [selectedInterval, setSelectedInterval] = useState('');
  const [controlMode, setControlMode] = useState<TradingControlMode>('manual');
  const [showNewOrderDialog, setShowNewOrderDialog] = useState(false);
  const [showOcoOrderDialog, setShowOcoOrderDialog] = useState(false);
  const [showRiskConfigDialog, setShowRiskConfigDialog] = useState(false);
  const [showNewSignalDialog, setShowNewSignalDialog] = useState(false);
  const [showReviewOrderDialog, setShowReviewOrderDialog] = useState(false);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [selectedSignalNewsPresetId, setSelectedSignalNewsPresetId] = useState<string | null>(null);
  const [signalNewsPresetName, setSignalNewsPresetName] = useState('');
  const [signalNewsPresetDescription, setSignalNewsPresetDescription] = useState('');
  const [reviewOrderTarget, setReviewOrderTarget] = useState<TradingOrder | null>(null);
  const [reviewOrderForm, setReviewOrderForm] = useState({
    orderType: 'market' as 'limit' | 'market' | 'stop_limit' | 'stop_market' | 'take_profit',
    size: '',
    price: '',
    leverage: '',
    stopLoss: '',
    takeProfit: '',
  });
  const [schedulerForm, setSchedulerForm] = useState({
    enabled: false,
    intervalMinutes: '15',
    symbols: '',
    maxSignalsPerRun: '1',
  });
  
  // Form state para nova ordem
  const [orderForm, setOrderForm] = useState({
    side: 'buy' as 'buy' | 'sell',
    orderType: 'market' as 'limit' | 'market',
    size: '',
    price: '',
    funds: '',
    usdtAmount: '', // Valor estimado em USDT (conversão automática com contratos)
    leverage: '10',
    stopLoss: '',
    takeProfit: '',
  });
  const [orderHistoryItems, setOrderHistoryItems] = useState<TradingOrder[]>([]);
  const [orderHistoryCursor, setOrderHistoryCursor] = useState<string | null>(null);
  const [orderHistoryHasMore, setOrderHistoryHasMore] = useState(false);
  const [orderHistoryLoading, setOrderHistoryLoading] = useState(false);
  const [orderHistorySelectedIds, setOrderHistorySelectedIds] = useState<Set<string>>(new Set());
  const orderHistoryMarketRef = useRef<string | null>(null);
  const orderHistoryLoadingRef = useRef(false);

  // Form state para configuração de risco
  const [riskForm, setRiskForm] = useState({
    maxPositionSize: '10',
    maxDailyLoss: '5',
    maxOrderValue: '10000',
    maxLeverage: 20,
    maxOpenPositions: 3,
    defaultLeverage: 10,
    defaultSymbol: '',
    defaultMarketType: 'futures' as 'futures' | 'spot' | 'margin',
    marginMode: 'cross' as 'cross' | 'isolated',
    tradingEnabled: false,
  });

  // Form state para novo sinal
  const [signalForm, setSignalForm] = useState({
    signalType: 'entry_long' as TradingSignal['signalType'],
    confidence: '0.85',
    reasoning: '',
  });

  const [signalProfileForm, setSignalProfileForm] = useState<TradingProfileForm>({
    kind: 'signal',
    timeframes: [selectedInterval || DEFAULT_INTERVAL],
    indicators: SIGNAL_INDICATOR_OPTIONS.map((option) => option.key),
    techniques: DEFAULT_SIGNAL_TECHNIQUES,
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
  const autoSaveSignalEnabledRef = useRef(false);
  const autoSaveSignalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveSignalLastPayloadRef = useRef<string>('');
  const autoSaveSignalContextRef = useRef(false);
  const [isManualSignalSavePending, setIsManualSignalSavePending] = useState(false);

  const updateSignalTimeframes = (next: string[]) => {
    setSignalProfileForm((prev) => ({
      ...prev,
      timeframes: next,
    }));
  };

  const updateSignalIndicators = (next: string[]) => {
    setSignalProfileForm((prev) => ({
      ...prev,
      indicators: next,
    }));
  };

  const updateSignalTechniques = (next: string[]) => {
    setSignalProfileForm((prev) => ({
      ...prev,
      techniques: next,
    }));
  };

  const updateSignalArbitrageConfig = (updates: Partial<NonNullable<TradingProfileForm['arbitrageConfig']>>) => {
    setSignalProfileForm((prev) => ({
      ...prev,
      arbitrageConfig: {
        ...(prev.arbitrageConfig ?? DEFAULT_ARBITRAGE_CONFIG),
        ...updates,
      },
    }));
  };

  const updateSignalArbitrageExchanges = (next: string[]) => {
    const unique = Array.from(new Set(next.map((value) => value.trim()).filter(Boolean)));
    updateSignalArbitrageConfig({ exchanges: unique });
  };

  const updateSignalArbitrageAssets = (next: string[]) => {
    const normalized = Array.from(new Set(next.map((value) => value.trim().toUpperCase()).filter(Boolean)));
    updateSignalArbitrageConfig({ intermediateAssets: normalized.slice(0, MAX_ARBITRAGE_ASSETS) });
  };

  const updateSignalSources = (next: string[]) => {
    const selected = new Set(next);
    setSignalProfileForm((prev) => ({
      ...prev,
      dataSources: {
        orderBook: selected.has('orderBook'),
        news: selected.has('news'),
        trainingData: selected.has('trainingData'),
      },
    }));
  };

  useEffect(() => {
    const hasArbitrage = signalProfileForm.techniques.includes('arbitrage_triangular');
    setSignalProfileForm((prev) => {
      if (hasArbitrage && !prev.arbitrageConfig) {
        return { ...prev, arbitrageConfig: DEFAULT_ARBITRAGE_CONFIG };
      }
      if (!hasArbitrage && prev.arbitrageConfig) {
        return { ...prev, arbitrageConfig: null };
      }
      return prev;
    });
  }, [signalProfileForm.techniques]);

  const {
    data: statusData,
    isLoading: isLoadingStatus,
    error: statusError,
    refetch: refetchStatus,
  } = useQuery<{ success: boolean; data: TradingStatus }>({
    queryKey: ['/api/integrations/trading/status'],
    refetchInterval: STATUS_REFETCH_INTERVAL,
  });

  const {
    data: intervalsData,
    error: intervalsError,
  } = useQuery<{
    success: boolean;
    data: {
      intervals: string[];
      granularityMap: Record<string, number>;
      wsIntervalMap: Record<string, string>;
      defaultInterval: string;
      restOrderBookDepth: number;
      restOrderBookDepths: number[];
      wsOrderBookDepth: number;
      wsOrderBookDepths: number[];
    };
  }>({
    queryKey: ['/api/integrations/trading/intervals'],
    enabled: statusData?.data?.isConfigured && !statusData?.data?.requiresTenant,
  });

  const intervalOptions = useMemo(() => {
    const intervals = intervalsData?.data?.intervals ?? [];
    return intervals.map((interval) => ({
      value: interval,
      label: t(`trading.chart.timeframes.${interval}`, { defaultValue: interval }),
    }));
  }, [intervalsData, t]);

  const {
    data: signalProfileResponse,
    refetch: refetchSignalProfile,
  } = useQuery<{ success: boolean; data: TradingProfileForm }>({
    queryKey: ['/api/integrations/trading/analysis-profile', selectedMarketType, 'signal'],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('kind', 'signal');
      const response = await apiRequest('GET', `/api/integrations/trading/analysis-profile?${params.toString()}`);
      return response.json();
    },
    enabled: Boolean(selectedSymbol),
  });

  const {
    data: signalArbitrageCatalogResponse,
    isLoading: isSignalArbitrageCatalogLoading,
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
      selectedMarketType,
      selectedSymbol,
      signalProfileForm.arbitrageConfig?.exchanges,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedMarketType) params.set('marketType', selectedMarketType);
      if (selectedSymbol) params.set('symbol', selectedSymbol);
      const exchanges = signalProfileForm.arbitrageConfig?.exchanges ?? [];
      if (exchanges.length > 0) {
        params.set('exchanges', exchanges.join(','));
      }
      const response = await apiRequest('GET', `/api/integrations/trading/arbitrage/catalog?${params.toString()}`);
      return response.json();
    },
    enabled: Boolean(signalProfileForm.arbitrageConfig && signalProfileForm.techniques.includes('arbitrage_triangular')),
  });

  const signalArbitrageCatalog = signalArbitrageCatalogResponse?.success ? signalArbitrageCatalogResponse.data : undefined;
  const availableSignalArbitrageExchanges = signalArbitrageCatalog?.exchanges?.length
    ? signalArbitrageCatalog.exchanges
    : [{ id: 'kucoin', label: 'KuCoin' }];
  const availableSignalArbitrageAssets = signalArbitrageCatalog?.intermediateAssets?.length
    ? signalArbitrageCatalog.intermediateAssets
    : (signalProfileForm.arbitrageConfig?.intermediateAssets ?? []);
  const signalSourceOptions = [
    {
      value: 'orderBook',
      label: t('trading.signals.profile.sourcesOrderBookTitle'),
      description: t('trading.signals.profile.sourcesOrderBookDesc'),
    },
    {
      value: 'news',
      label: t('trading.signals.profile.sourcesNewsTitle'),
      description: t('trading.signals.profile.sourcesNewsDesc'),
    },
    {
      value: 'trainingData',
      label: t('trading.signals.profile.sourcesTrainingTitle'),
      description: t('trading.signals.profile.sourcesTrainingDesc'),
    },
  ];
  const selectedSignalSources = Object.entries(signalProfileForm.dataSources)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);

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
  const selectedSignalNewsPreset = newsPresets.find((preset) => preset.id === selectedSignalNewsPresetId);
  const normalizedSignalNewsPresetName = signalNewsPresetName.trim();
  const canCreateSignalNewsPreset = normalizedSignalNewsPresetName.length >= 2;
  const canUpdateSignalNewsPreset = Boolean(selectedSignalNewsPreset && normalizedSignalNewsPresetName.length >= 2);

  const createNewsPresetMutation = useMutation({
    mutationFn: async (payload: { name: string; description?: string | null; config: TradingNewsConfigForm }) => {
      const response = await apiRequest('POST', '/api/integrations/trading/news-presets', payload);
      return response.json();
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/news-presets'] });
      if (response?.data?.id) {
        setSelectedSignalNewsPresetId(response.data.id);
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
      if (selectedSignalNewsPresetId === presetId) {
        setSelectedSignalNewsPresetId(null);
      }
    },
  });

  useEffect(() => {
    if (!signalProfileForm.arbitrageConfig || !signalArbitrageCatalogResponse?.success) return;
    const effectiveFee = signalArbitrageCatalogResponse.data.effectiveFeePct;
    if (Number.isFinite(effectiveFee) && effectiveFee !== signalProfileForm.arbitrageConfig.feePct) {
      updateSignalArbitrageConfig({ feePct: effectiveFee });
    }
  }, [signalArbitrageCatalogResponse, signalProfileForm.arbitrageConfig, updateSignalArbitrageConfig]);

  const wsInterval = useMemo(() => {
    if (!selectedInterval) return '';
    const mapped = intervalsData?.data?.wsIntervalMap?.[selectedInterval] ?? '';
    return mapped || selectedInterval;
  }, [intervalsData, selectedInterval]);

  const granularityValue = useMemo(() => {
    if (!selectedInterval) return null;
    return intervalsData?.data?.granularityMap?.[selectedInterval] ?? null;
  }, [intervalsData, selectedInterval]);

  const signalIntervalMinutesMap = useMemo(() => {
    return intervalsData?.data?.granularityMap ?? FALLBACK_INTERVAL_MINUTES;
  }, [intervalsData]);

  const signalArbitrageInvalidFrames = useMemo(() => {
    if (!signalProfileForm.techniques.includes('arbitrage_triangular')) return [];
    const maxMinutes = signalProfileForm.arbitrageConfig?.maxIntervalMinutes ?? DEFAULT_ARBITRAGE_CONFIG.maxIntervalMinutes;
    return signalProfileForm.timeframes.filter((frame) => {
      const minutes = signalIntervalMinutesMap[frame] ?? Infinity;
      return minutes > maxMinutes;
    });
  }, [signalProfileForm.arbitrageConfig?.maxIntervalMinutes, signalProfileForm.techniques, signalProfileForm.timeframes, signalIntervalMinutesMap]);

  const isSignalArbitrageInvalid = signalArbitrageInvalidFrames.length > 0;
  const signalArbitrageErrorMessage = isSignalArbitrageInvalid
    ? t('trading.errors.arbitrageTimeframesInvalid', {
        max: signalProfileForm.arbitrageConfig?.maxIntervalMinutes ?? DEFAULT_ARBITRAGE_CONFIG.maxIntervalMinutes,
        frames: signalArbitrageInvalidFrames.join(', '),
      })
    : '';

  const wsOrderBookDepth = useMemo<5 | 50 | null>(() => {
    const depths = intervalsData?.data?.wsOrderBookDepths ?? [];
    if (!depths.length) return null;
    const resolved = Math.min(...depths);
    return resolved as 5 | 50;
  }, [intervalsData]);

  const restOrderBookDepth = useMemo(() => {
    const depths = intervalsData?.data?.restOrderBookDepths ?? [];
    if (!depths.length) return null;
    return Math.min(...depths);
  }, [intervalsData]);

  // ============================================================================
  // QUERIES
  // ============================================================================

  const marketQuery = new URLSearchParams();
  marketQuery.set('marketType', selectedMarketType);
  if (selectedMarketType === 'margin') {
    marketQuery.set('marginMode', selectedMarginMode);
  }
  const marketQueryString = marketQuery.toString();

  const ordersQuery = new URLSearchParams();
  ordersQuery.set('marketType', selectedMarketType);
  const ordersQueryString = ordersQuery.toString();

  const {
    data: symbolsData,
    isLoading: isLoadingSymbols,
    error: symbolsError,
  } = useQuery<{ success: boolean; data: TradingSymbolsResponse }>({
    queryKey: ['/api/integrations/trading/symbols', selectedMarketType, selectedMarginMode],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('marketType', selectedMarketType);
      if (selectedMarketType === 'margin') {
        params.set('marginMode', selectedMarginMode);
      }
      const res = await apiRequest('GET', `/api/integrations/trading/symbols?${params.toString()}`);
      return res.json();
    },
    refetchInterval: SYMBOLS_REFETCH_INTERVAL,
    enabled: statusData?.data?.isConfigured && !statusData?.data?.requiresTenant,
  });

  const availableSymbols = symbolsData?.data?.symbols ?? [];
  const favoriteSymbols = symbolsData?.data?.favorites ?? [];
  const featuredOverride = symbolsData?.data?.featured ?? [];
  const topSymbols = symbolsData?.data?.topSymbols ?? [];
  const featuredSymbols = featuredOverride.length > 0 ? featuredOverride : topSymbols;
  const isSymbolValidForMarket = Boolean(sanitizedSymbol && availableSymbols.includes(sanitizedSymbol));
  const requestSymbol = isSymbolValidForMarket ? sanitizedSymbol : '';
  const isFuturesMarket = selectedMarketType === 'futures';
  const wsEnabled = isFuturesMarket
    && isSymbolValidForMarket
    && !!statusData?.data?.isConfigured
    && !statusData?.data?.requiresTenant;

  const symbolOptions = useMemo(() => {
    if (availableSymbols.length === 0) return [];
    const alphabetic = [...availableSymbols].sort((a, b) => a.localeCompare(b));
    const featuredSet = new Set(featuredSymbols);
    const favoritesSet = new Set(favoriteSymbols);
    const featuredList = featuredSymbols.filter((symbol) => featuredSet.has(symbol));
    const favoritesList = favoriteSymbols.filter((symbol) => !featuredSet.has(symbol));
    const remaining = alphabetic.filter((symbol) => !featuredSet.has(symbol) && !favoritesSet.has(symbol));
    return [...featuredList, ...favoritesList, ...remaining];
  }, [availableSymbols, favoriteSymbols, featuredSymbols]);

  const symbolSelectItems = useMemo(() => {
    const items: Array<{
      kind: 'label' | 'symbol';
      value: string;
      label?: string;
      isFeatured?: boolean;
      isFavorite?: boolean;
    }> = [];
    const featuredSet = new Set(featuredSymbols);
    const favoritesSet = new Set(favoriteSymbols);
    const featuredList = featuredSymbols.filter((symbol) => featuredSet.has(symbol));
    const favoritesList = favoriteSymbols.filter((symbol) => !featuredSet.has(symbol));
    const remaining = symbolOptions.filter((symbol) => !featuredSet.has(symbol) && !favoritesSet.has(symbol));

    if (featuredList.length > 0) {
      items.push({ kind: 'label', value: '__featured', label: t('trading.symbols.featured') });
      featuredList.forEach((symbol) => items.push({ kind: 'symbol', value: symbol, isFeatured: true }));
    }
    if (favoritesList.length > 0) {
      items.push({ kind: 'label', value: '__favorites', label: t('trading.symbols.favorites') });
      favoritesList.forEach((symbol) => items.push({ kind: 'symbol', value: symbol, isFavorite: true }));
    }
    if (remaining.length > 0) {
      items.push({ kind: 'label', value: '__all', label: t('trading.symbols.all') });
      remaining.forEach((symbol) => items.push({ kind: 'symbol', value: symbol }));
    }
    return items;
  }, [featuredSymbols, favoriteSymbols, symbolOptions, t]);

  const updateSymbolPrefsMutation = useMutation({
    mutationFn: async (payload: {
      marketType: 'futures' | 'spot' | 'margin';
      marginMode?: 'cross' | 'isolated';
      favorites?: string[];
      featured?: string[];
    }) => {
      const response = await apiRequest('PUT', '/api/integrations/trading/symbol-preferences', payload);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/symbols'] });
    },
  });

  const toggleFavorite = (symbol: string) => {
    const next = favoriteSymbols.includes(symbol)
      ? favoriteSymbols.filter((item) => item !== symbol)
      : [...favoriteSymbols, symbol];
    updateSymbolPrefsMutation.mutate({
      marketType: selectedMarketType,
      marginMode: selectedMarginMode,
      favorites: next,
      featured: featuredOverride,
    });
  };

  const toggleFeatured = (symbol: string) => {
    const next = featuredOverride.includes(symbol)
      ? featuredOverride.filter((item) => item !== symbol)
      : [...featuredOverride, symbol];
    updateSymbolPrefsMutation.mutate({
      marketType: selectedMarketType,
      marginMode: selectedMarginMode,
      favorites: favoriteSymbols,
      featured: next,
    });
  };

  const { data: wsStatusData } = useQuery<{ success: boolean; data: KucoinWsStatus }>({
    queryKey: ['/api/integrations/trading/ws/status'],
    refetchInterval: STATUS_REFETCH_INTERVAL,
    enabled: !!statusData?.data?.isConfigured,
  });

  const {
    data: marketData,
    isLoading: isLoadingMarket,
    error: marketError,
    refetch: refetchMarket,
  } = useQuery<{ success: boolean; data: MarketData }>({
    queryKey: ['/api/integrations/trading/market', requestSymbol, selectedMarketType, selectedMarginMode],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/integrations/trading/market/${requestSymbol}?${marketQueryString}`);
      return res.json();
    },
    refetchInterval: wsEnabled ? TICKER_REFETCH_INTERVAL_WS : TICKER_REFETCH_INTERVAL_REST,
    enabled: statusData?.data?.isConfigured && isSymbolValidForMarket,
  });

  const {
    data: accountData,
    isLoading: isLoadingAccount,
    error: accountError,
    refetch: refetchAccount,
  } = useQuery<{ success: boolean; data: AccountOverview }>({
    queryKey: ['/api/integrations/trading/account', selectedMarketType, selectedMarginMode],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/integrations/trading/account?${marketQueryString}`);
      return res.json();
    },
    refetchInterval: ACCOUNT_REFETCH_INTERVAL,
    enabled: statusData?.data?.isConfigured && isSymbolValidForMarket,
  });

  const {
    data: positionsData,
    isLoading: isLoadingPositions,
    error: positionsError,
    refetch: refetchPositions,
  } = useQuery<{ success: boolean; data: PositionsResponse }>({
    queryKey: ['/api/integrations/trading/positions', selectedMarketType, selectedMarginMode],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/integrations/trading/positions?${marketQueryString}`);
      return res.json();
    },
    refetchInterval: ACCOUNT_REFETCH_INTERVAL,
    enabled: statusData?.data?.isConfigured && isSymbolValidForMarket && selectedMarketType === 'futures',
  });

  const {
    data: signalsData,
    isLoading: isLoadingSignals,
    error: signalsError,
    refetch: refetchSignals,
  } = useQuery<{ success: boolean; data: TradingSignal[] }>({
    queryKey: ['/api/integrations/trading/signals', selectedMarketType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedMarketType) {
        params.set('marketType', selectedMarketType);
      }
      const response = await apiRequest('GET', `/api/integrations/trading/signals${params.toString() ? `?${params}` : ''}`);
      return response.json();
    },
    refetchInterval: SIGNALS_REFETCH_INTERVAL,
    enabled: statusData?.data?.isConfigured && !statusData?.data?.requiresTenant,
  });

  const signals = signalsData?.data || [];

  useEffect(() => {
    if (signals.length === 0) {
      setSelectedSignalId(null);
      return;
    }
    if (selectedSignalId && signals.some((signal) => signal.id === selectedSignalId)) {
      return;
    }
    setSelectedSignalId(signals[0]?.id ?? null);
  }, [signals, selectedSignalId]);

  const selectedSignal = useMemo(
    () => (selectedSignalId ? signals.find((signal) => signal.id === selectedSignalId) ?? null : null),
    [signals, selectedSignalId]
  );

  const {
    data: schedulerData,
    isLoading: isLoadingScheduler,
    error: schedulerError,
    refetch: refetchScheduler,
  } = useQuery<{ success: boolean; data: Array<Record<string, unknown>> }>({
    queryKey: ['/api/integrations/trading/signal-scheduler', selectedMarketType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedMarketType) {
        params.set('marketType', selectedMarketType);
      }
      const response = await apiRequest('GET', `/api/integrations/trading/signal-scheduler${params.toString() ? `?${params}` : ''}`);
      return response.json();
    },
    enabled: statusData?.data?.isConfigured && !statusData?.data?.requiresTenant,
  });

  const schedulerConfig = useMemo(() => {
    const config = schedulerData?.data?.[0] as Record<string, unknown> | undefined;
    if (!config) return null;
    return {
      enabled: Boolean(config.enabled),
      intervalMinutes: Number(config.intervalMinutes ?? 15),
      interval: String(config.interval ?? DEFAULT_INTERVAL),
      symbols: Array.isArray(config.symbols) ? (config.symbols as string[]) : [],
      maxSignalsPerRun: Number(config.maxSignalsPerRun ?? 1),
      nextRunAt: config.nextRunAt as string | null,
      lastRunAt: config.lastRunAt as string | null,
      lastSuccessAt: config.lastSuccessAt as string | null,
      lastError: config.lastError as string | null,
      lastDurationMs: config.lastDurationMs as number | null,
    };
  }, [schedulerData]);

  useEffect(() => {
    if (!schedulerConfig) return;
    setSchedulerForm({
      enabled: schedulerConfig.enabled,
      intervalMinutes: String(schedulerConfig.intervalMinutes || 15),
      symbols: schedulerConfig.symbols.join(', '),
      maxSignalsPerRun: String(schedulerConfig.maxSignalsPerRun || 1),
    });
  }, [schedulerConfig]);

  const {
    data: ordersData,
    isLoading: isLoadingOrders,
    error: ordersError,
    refetch: refetchOrders,
  } = useQuery<{ success: boolean; data: TradingOrder[] }>({
    queryKey: ['/api/integrations/trading/orders', selectedMarketType],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/integrations/trading/orders?${ordersQueryString}`);
      return res.json();
    },
    refetchInterval: ACCOUNT_REFETCH_INTERVAL,
    enabled: statusData?.data?.isConfigured && !statusData?.data?.requiresTenant,
  });

  const {
    data: riskConfigData,
    error: riskConfigError,
    refetch: refetchRiskConfig,
  } = useQuery<{ success: boolean; data: RiskConfig | null }>({
    queryKey: ['/api/integrations/trading/risk-config'],
    enabled: statusData?.data?.isConfigured && !statusData?.data?.requiresTenant,
  });

  useEffect(() => {
    const symbols = symbolsData?.data?.symbols ?? [];
    if (symbols.length === 0) return;

    // D4: Fallback seguro - preferir defaultSymbol do endpoint (já filtrado por marketType),
    // depois defaultSymbol do status, e apenas em último caso o primeiro da lista.
    // Sempre validar que o símbolo preferido está na lista de símbolos válidos para o market type atual.
    const apiDefault = symbolsData?.data?.defaultSymbol;
    const statusDefault = statusData?.data?.defaultSymbol;
    const firstAvailable = symbols[0] ?? '';

    // D1: Priorizar símbolo que EXISTA na lista do market type atual
    const preferred = (apiDefault && symbols.includes(apiDefault)) ? apiDefault
      : (statusDefault && symbols.includes(statusDefault)) ? statusDefault
      : firstAvailable;

    if (!preferred) return;
    if (!sanitizedSymbol || !symbols.includes(sanitizedSymbol)) {
      setSelectedSymbol(preferred);
    }
  }, [symbolsData, statusData, sanitizedSymbol]);

  useEffect(() => {
    const intervals = intervalsData?.data?.intervals ?? [];
    if (intervals.length === 0) return;
    if (!selectedInterval || !intervals.includes(selectedInterval)) {
      const fallback = intervalsData?.data?.defaultInterval || intervals[0];
      setSelectedInterval(fallback);
    }
  }, [intervalsData, selectedInterval]);

  const fetchOrderHistory = useCallback(async (options: { reset?: boolean } = {}) => {
    if (orderHistoryLoadingRef.current) return;
    const reset = options.reset ?? false;
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
      toast({ title: t('trading.errors.historyFailed'), description: message, variant: 'destructive' });
    } finally {
      setOrderHistoryLoading(false);
      orderHistoryLoadingRef.current = false;
    }
  }, [orderHistoryCursor, selectedMarketType, t, toast]);

  useEffect(() => {
    if (activeTab !== 'history') return;
    const marketChanged = orderHistoryMarketRef.current !== selectedMarketType;
    const shouldReset = marketChanged || orderHistoryItems.length === 0;
    if (!shouldReset) return;
    orderHistoryMarketRef.current = selectedMarketType;
    fetchOrderHistory({ reset: true });
  }, [activeTab, fetchOrderHistory, orderHistoryItems.length, selectedMarketType]);

  const wsChannels = useMemo(() => {
    if (!wsEnabled) return [];
    const baseChannels: Array<'ticker' | 'orderbook' | 'klines' | 'trades'> = ['ticker', 'orderbook', 'trades'];
    if (wsInterval) {
      baseChannels.push('klines');
    }
    return baseChannels;
  }, [wsEnabled, wsInterval]);

  const {
    ticker: wsTicker,
    orderBook: wsOrderBook,
    klines: wsKlines,
  } = useKucoinWebSocket({
    symbol: wsEnabled ? requestSymbol : '',
    channels: wsChannels,
    interval: wsInterval,
    autoConnect: wsEnabled,
    marketType: selectedMarketType,
    marginMode: selectedMarginMode,
    orderBookDepth: wsOrderBookDepth ?? undefined,
    onError: (error) => {
      frontendLogger.warn('WebSocket KuCoin indisponível - fallback REST ativo', { error });
    },
  });

  // Query para Klines (gráfico de candlesticks)
  const {
    data: klinesData,
    isLoading: isLoadingKlines,
    error: klinesError,
    refetch: refetchKlines,
  } = useQuery<{ success: boolean; data: KlineData[] }>({
    queryKey: ['/api/integrations/trading/klines', requestSymbol, selectedInterval, selectedMarketType, selectedMarginMode],
    queryFn: async () => {
      const params = new URLSearchParams(marketQuery);
      if (!granularityValue) {
        throw new Error('Intervalo inválido para klines');
      }
      params.set('granularity', String(granularityValue));
      const res = await apiRequest('GET', `/api/integrations/trading/klines/${requestSymbol}?${params.toString()}`);
      return res.json();
    },
    refetchInterval: wsEnabled ? KLINES_REFETCH_INTERVAL_WS : KLINES_REFETCH_INTERVAL_REST,
    enabled: statusData?.data?.isConfigured && !!granularityValue && isSymbolValidForMarket,
  });

  useEffect(() => {
    if (!statusData?.data?.isConfigured || !granularityValue || !isSymbolValidForMarket) return;
    queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/klines'] });
  }, [
    granularityValue,
    requestSymbol,
    selectedInterval,
    selectedMarketType,
    selectedMarginMode,
    statusData?.data?.isConfigured,
    isSymbolValidForMarket,
  ]);

  // Query para Order Book
  const {
    data: orderBookResponse,
    isLoading: isLoadingOrderBook,
    error: orderBookError,
  } = useQuery<OrderBookResponse>({
    queryKey: ['/api/integrations/trading/orderbook', requestSymbol, selectedMarketType, selectedMarginMode, restOrderBookDepth],
    queryFn: async () => {
      const params = new URLSearchParams(marketQuery);
      if (restOrderBookDepth) {
        params.set('depth', String(restOrderBookDepth));
      }
      const res = await apiRequest('GET', `/api/integrations/trading/orderbook/${requestSymbol}?${params.toString()}`);
      return res.json();
    },
    refetchInterval: wsEnabled ? ORDERBOOK_REFETCH_INTERVAL_WS : ORDERBOOK_REFETCH_INTERVAL_REST,
    enabled: statusData?.data?.isConfigured && !!restOrderBookDepth && isSymbolValidForMarket,
  });

  // Query para histórico de controle (handover/takeover)
  const {
    data: controlHistoryData,
    isLoading: isLoadingControlHistory,
    error: controlHistoryError,
    refetch: refetchControlHistory,
  } = useQuery<{ success: boolean; data: ControlHistoryEntry[] }>({
    queryKey: ['/api/integrations/trading/control-history'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/integrations/trading/control-history');
      return res.json();
    },
    enabled: statusData?.data?.isConfigured,
  });

  const market = marketData?.data;
  const normalizedSymbol = requestSymbol.toUpperCase();
  const wsOrderBookData = wsEnabled && wsOrderBook?.symbol?.toUpperCase() === normalizedSymbol
    ? wsOrderBook
    : null;
  const orderBookData = wsOrderBookData ?? orderBookResponse?.data ?? null;
  const orderBookPrecision = useMemo(() => {
    const samplePrice =
      orderBookData?.bids?.[0]?.price ||
      orderBookData?.asks?.[0]?.price ||
      wsTicker?.price ||
      market?.ticker?.price;
    if (!samplePrice) return null;
    const [, decimals = ''] = String(samplePrice).split('.');
    return decimals.length;
  }, [orderBookData, wsTicker, market]);

  // Atualizar form de risco quando dados carregarem
  useEffect(() => {
    if (riskConfigData?.data) {
      const config = riskConfigData.data;
      setRiskForm({
        maxPositionSize: config.maxPositionSize !== null && config.maxPositionSize !== undefined
          ? String(config.maxPositionSize)
          : '10',
        maxDailyLoss: config.maxDailyLoss !== null && config.maxDailyLoss !== undefined
          ? String(config.maxDailyLoss)
          : '5',
        maxOrderValue: config.maxOrderValue !== null && config.maxOrderValue !== undefined
          ? String(config.maxOrderValue)
          : '10000',
        maxLeverage: config.maxLeverage ?? 20,
        maxOpenPositions: config.maxOpenPositions ?? 3,
        defaultLeverage: config.defaultLeverage ?? 10,
        defaultSymbol: config.defaultSymbol ?? '',
        defaultMarketType: config.defaultMarketType ?? 'futures',
        marginMode: config.marginMode ?? 'cross',
        tradingEnabled: config.tradingEnabled ?? false,
      });
      setControlMode('manual');

      if (!marketDefaultsInitialized) {
        setSelectedMarketType(config.defaultMarketType ?? 'futures');
        setSelectedMarginMode(config.marginMode ?? 'cross');
        setMarketDefaultsInitialized(true);
      }
    }
  }, [riskConfigData, marketDefaultsInitialized]);

  const openReviewDialog = (order: TradingOrder) => {
    const metadata = (order.metadata ?? {}) as { stopLoss?: number; takeProfit?: number };
    setReviewOrderTarget(order);
    setReviewOrderForm({
      orderType: order.orderType,
      size: String(order.size ?? ''),
      price: order.price ? String(order.price) : '',
      leverage: String(order.leverage ?? ''),
      stopLoss: metadata.stopLoss ? String(metadata.stopLoss) : '',
      takeProfit: metadata.takeProfit ? String(metadata.takeProfit) : '',
    });
    setShowReviewOrderDialog(true);
  };

  // ============================================================================
  // MUTATIONS
  // ============================================================================

  const createOrderMutation = useMutation({
    mutationFn: async (data: typeof orderForm) => {
      const isFuturesOrder = selectedMarketType === 'futures';
      const sizeValue = data.size ? Number(data.size) : NaN;
      const fundsValue = data.funds ? Number(data.funds) : NaN;
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
        leverageValue = Number(data.leverage);
        if (!Number.isFinite(leverageValue) || leverageValue <= 0) {
          throw new Error('Alavancagem inválida.');
        }
      }

      const res = await apiRequest('POST', '/api/integrations/trading/orders', {
        symbol: selectedSymbol || undefined,
        side: data.side,
        orderType: data.orderType,
        size: hasSize ? sizeValue : undefined,
        funds: hasFunds ? fundsValue : undefined,
        price: data.orderType === 'limit' ? parseFloat(data.price) : undefined,
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
          stopLoss: data.stopLoss ? parseFloat(data.stopLoss) : undefined,
          takeProfit: data.takeProfit ? parseFloat(data.takeProfit) : undefined,
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
      toast({
        title: t('trading.success.orderCreated'),
        description: t('trading.success.orderCreatedDesc'),
      });
      if (data?.stopOrderError) {
        toast({
          title: t('trading.errors.stopOrderFailed'),
          description: data.stopOrderError,
          variant: 'destructive',
        });
      }
      setShowNewOrderDialog(false);
      setOrderForm({
        side: 'buy',
        orderType: 'market',
        size: '',
        price: '',
        funds: '',
        usdtAmount: '',
        leverage: '10',
        stopLoss: '',
        takeProfit: '',
      });
      refetchOrders();
      refetchAccount();
    },
    onError: (error: Error) => {
      toast({
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
      toast({
        title: t('trading.success.orderCancelled'),
      });
      refetchOrders();
    },
    onError: (error: Error) => {
      toast({
        title: t('trading.errors.cancelFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const approveReviewOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await apiRequest('POST', `/api/integrations/trading/orders/${orderId}/approve`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Ordem aprovada', description: 'Ordem enviada para execução na KuCoin.' });
      refetchOrders();
      refetchPositions();
    },
    onError: (error: Error) => {
      toast({
        title: 'Falha ao aprovar ordem',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const rejectReviewOrderMutation = useMutation({
    mutationFn: async ({ orderId, reason }: { orderId: string; reason?: string }) => {
      const res = await apiRequest('POST', `/api/integrations/trading/orders/${orderId}/reject`, { reason });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Ordem rejeitada', description: 'Ordem marcada como rejeitada.' });
      refetchOrders();
    },
    onError: (error: Error) => {
      toast({
        title: 'Falha ao rejeitar ordem',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const updateReviewOrderMutation = useMutation({
    mutationFn: async (payload: {
      orderId: string;
      updates: {
        orderType?: TradingOrder['orderType'];
        size?: number;
        price?: number;
        leverage?: number;
        stopLoss?: number;
        takeProfit?: number;
      };
    }) => {
      const res = await apiRequest('PATCH', `/api/integrations/trading/orders/${payload.orderId}/review`, payload.updates);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Ordem atualizada', description: 'Ajustes salvos com sucesso.' });
      setShowReviewOrderDialog(false);
      setReviewOrderTarget(null);
      refetchOrders();
    },
    onError: (error: Error) => {
      toast({
        title: 'Falha ao atualizar ordem',
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
      toast({
        title: t('trading.success.ordersSynced'),
        description: t('trading.success.ordersSyncedDesc', { 
          synced: data.data?.synced || 0, 
          errors: data.data?.errors || 0 
        }),
      });
      refetchOrders();
    },
    onError: (error: Error) => {
      toast({
        title: t('trading.errors.syncFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const updateRiskConfigMutation = useMutation({
    mutationFn: async (data: typeof riskForm) => {
      const normalizeDecimal = (value: string | number): string | undefined => {
        const raw = String(value ?? '').trim();
        if (!raw) return undefined;
        const normalized = raw.replace(',', '.');
        if (!Number.isFinite(Number(normalized))) {
          throw new Error('Valor inválido. Use apenas números e separador decimal.');
        }
        return normalized;
      };

      const res = await apiRequest('PUT', '/api/integrations/trading/risk-config', {
        maxPositionSize: normalizeDecimal(data.maxPositionSize),
        maxDailyLoss: normalizeDecimal(data.maxDailyLoss),
        maxOrderValue: normalizeDecimal(data.maxOrderValue),
        maxLeverage: data.maxLeverage,
        maxOpenPositions: data.maxOpenPositions,
        defaultLeverage: data.defaultLeverage,
        defaultSymbol: data.defaultSymbol || undefined,
        defaultMarketType: data.defaultMarketType,
        marginMode: data.marginMode,
        tradingEnabled: data.tradingEnabled,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: t('trading.success.riskConfigUpdated'),
      });
      setShowRiskConfigDialog(false);
      if (data?.success) {
        queryClient.setQueryData(['/api/integrations/trading/risk-config'], data);
      }
      refetchRiskConfig();
      refetchStatus();
    },
    onError: (error: Error) => {
      toast({
        title: t('trading.errors.riskConfigFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const buildSignalProfilePayload = useCallback((form: TradingProfileForm): SignalProfilePayload => ({
    kind: 'signal',
    marketType: selectedMarketType,
    symbol: selectedSymbol || undefined,
    timeframes: form.timeframes,
    indicators: form.indicators,
    dataSources: form.dataSources,
    newsConfig: form.newsConfig,
    techniques: form.techniques,
    ensembleConfig: form.ensembleConfig,
    arbitrageConfig: form.arbitrageConfig ?? undefined,
    modelConfig: form.modelConfig,
    consensus: form.consensus,
  }), [selectedMarketType, selectedSymbol]);

  const signalProfilePayload = useMemo(
    () => buildSignalProfilePayload(signalProfileForm),
    [buildSignalProfilePayload, signalProfileForm]
  );

  useEffect(() => {
    if (signalProfileResponse?.data) {
      const nextForm: TradingProfileForm = {
        ...signalProfileResponse.data,
        newsConfig: normalizeTradingNewsConfigForm(signalProfileResponse.data.newsConfig),
        techniques: signalProfileResponse.data.techniques?.length
          ? signalProfileResponse.data.techniques
          : DEFAULT_SIGNAL_TECHNIQUES,
        ensembleConfig: signalProfileResponse.data.ensembleConfig ?? DEFAULT_ENSEMBLE_CONFIG,
        arbitrageConfig: signalProfileResponse.data.arbitrageConfig ?? null,
      };
      setSignalProfileForm(nextForm);
      autoSaveSignalEnabledRef.current = true;
      autoSaveSignalLastPayloadRef.current = JSON.stringify(buildSignalProfilePayload(nextForm));
    }
  }, [buildSignalProfilePayload, signalProfileResponse]);

  const updateSignalProfileMutation = useMutation({
    mutationFn: async (payload: SignalProfilePayload) => {
      const res = await apiRequest('PUT', '/api/integrations/trading/analysis-profile', payload);
      return res.json();
    },
    onSuccess: (data, variables) => {
      if (!data?.success) {
        throw new Error(data?.error || t('trading.errors.profileUpdateFailed'));
      }
      setSignalProfileForm(data.data as TradingProfileForm);
      autoSaveSignalLastPayloadRef.current = JSON.stringify(variables);
      if (!autoSaveSignalContextRef.current) {
        toast({ title: t('trading.success.profileUpdated') });
      }
      refetchSignalProfile();
    },
    onError: (error: Error) => {
      if (!autoSaveSignalContextRef.current) {
        toast({
          title: t('trading.errors.profileUpdateFailed'),
          description: error.message,
          variant: 'destructive',
        });
      }
    },
    onSettled: () => {
      autoSaveSignalContextRef.current = false;
    },
  });

  useEffect(() => {
    if (!autoSaveSignalEnabledRef.current) return;
    // Impede auto-save com arrays obrigatórios vazios (causa 400 no backend - Zod .min(1))
    if (signalProfilePayload.timeframes.length === 0 || signalProfilePayload.indicators.length === 0 || signalProfilePayload.techniques.length === 0) return;
    const payloadKey = JSON.stringify(signalProfilePayload);
    if (payloadKey === autoSaveSignalLastPayloadRef.current) return;
    if (autoSaveSignalTimerRef.current) {
      clearTimeout(autoSaveSignalTimerRef.current);
    }
    autoSaveSignalTimerRef.current = setTimeout(() => {
      autoSaveSignalContextRef.current = true;
      updateSignalProfileMutation.mutate(signalProfilePayload);
    }, AUTO_SAVE_DEBOUNCE_MS);
    return () => {
      if (autoSaveSignalTimerRef.current) {
        clearTimeout(autoSaveSignalTimerRef.current);
      }
    };
  }, [signalProfilePayload, updateSignalProfileMutation]);

  const createSignalMutation = useMutation({
    mutationFn: async (data: typeof signalForm) => {
      const res = await apiRequest('POST', '/api/integrations/trading/signals', {
        signalType: data.signalType,
        symbol: selectedSymbol || undefined,
        marketType: selectedMarketType,
        marginMode: selectedMarketType === 'margin' ? selectedMarginMode : undefined,
        confidence: parseFloat(data.confidence),
        reasoning: data.reasoning || undefined,
        sourceModel: 'manual-admin',
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: t('trading.success.signalCreated'),
      });
      setShowNewSignalDialog(false);
      setSignalForm({
        signalType: 'entry_long',
        confidence: '0.85',
        reasoning: '',
      });
      refetchSignals();
    },
    onError: (error: Error) => {
      toast({
        title: t('trading.errors.signalFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const generateSignalMutation = useMutation({
    mutationFn: async () => {
      if (!requestSymbol) {
        throw new Error(t('trading.signals.errors.symbolRequired'));
      }
      const res = await apiRequest('POST', '/api/integrations/trading/signals/generate', {
        symbol: requestSymbol,
        interval: selectedInterval || DEFAULT_INTERVAL,
        timeframes: signalProfileForm.timeframes,
        indicators: signalProfileForm.indicators,
        dataSources: signalProfileForm.dataSources,
        techniques: signalProfileForm.techniques,
        ensembleConfig: signalProfileForm.ensembleConfig,
        arbitrageConfig: signalProfileForm.arbitrageConfig ?? undefined,
        modelConfig: signalProfileForm.modelConfig,
        consensus: signalProfileForm.consensus,
        marketType: selectedMarketType,
        marginMode: selectedMarketType === 'margin' ? selectedMarginMode : undefined,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (!data?.success) {
        throw new Error(data?.error || t('trading.errors.signalGenerateFailed'));
      }
      toast({
        title: t('trading.success.signalGenerated'),
        description: t('trading.success.signalGeneratedDesc'),
      });
      refetchSignals();
      refetchScheduler();
    },
    onError: (error: Error) => {
      toast({
        title: t('trading.errors.signalGenerateFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const updateSignalSchedulerMutation = useMutation({
    mutationFn: async () => {
      const intervalMinutes = Number.parseInt(schedulerForm.intervalMinutes, 10);
      const maxSignalsPerRun = Number.parseInt(schedulerForm.maxSignalsPerRun, 10);
      if (Number.isNaN(intervalMinutes) || Number.isNaN(maxSignalsPerRun)) {
        throw new Error(t('trading.errors.schedulerUpdateFailed'));
      }
      const primaryInterval = signalProfileForm.timeframes?.[0] ?? selectedInterval ?? DEFAULT_INTERVAL;

      const payload = {
        marketType: selectedMarketType,
        marginMode: selectedMarketType === 'margin' ? selectedMarginMode : undefined,
        intervalMinutes,
        interval: primaryInterval,
        symbols: schedulerForm.symbols
          .split(',')
          .map((symbol) => symbol.trim())
          .filter(Boolean),
        enabled: schedulerForm.enabled,
        maxSignalsPerRun,
        techniques: signalProfileForm.techniques,
        ensembleConfig: signalProfileForm.ensembleConfig,
        arbitrageConfig: signalProfileForm.arbitrageConfig ?? undefined,
      };
      const res = await apiRequest('PUT', '/api/integrations/trading/signal-scheduler', payload);
      return res.json();
    },
    onSuccess: (data) => {
      if (!data?.success) {
        throw new Error(data?.error || t('trading.errors.schedulerUpdateFailed'));
      }
      toast({
        title: t('trading.success.schedulerUpdated'),
      });
      refetchScheduler();
    },
    onError: (error: Error) => {
      toast({
        title: t('trading.errors.schedulerUpdateFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const deactivateSignalMutation = useMutation({
    mutationFn: async (signalId: string) => {
      const res = await apiRequest('DELETE', `/api/integrations/trading/signals/${signalId}`);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: t('trading.success.signalDeactivated'),
      });
      refetchSignals();
    },
    onError: (error: Error) => {
      toast({
        title: t('trading.errors.signalDeactivateFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleRefreshAll = () => {
    refetchStatus();
    refetchMarket();
    refetchAccount();
    refetchPositions();
    refetchSignals();
    refetchOrders();
    refetchRiskConfig();
    refetchKlines();
    refetchControlHistory();
  };

  // Handler para mudança de intervalo do gráfico
  const handleIntervalChange = (newInterval: string) => {
    setSelectedInterval(newInterval);
  };

  // Handler para mudança de modo de controle (handover/takeover)
  const handleModeChange = async (mode: TradingControlMode, reason: string) => {
    try {
      const res = await apiRequest('POST', '/api/integrations/trading/control', {
        mode,
        reason,
        source: 'dashboard',
      });
      const data = await res.json();
      if (data.success) {
        setControlMode(mode);
        refetchControlHistory();
        toast({
          title: t('trading.handover.modeChanged'),
        });
      }
    } catch (error) {
      toast({
        title: t('trading.handover.modeChangeError'),
        description: error instanceof Error ? error.message : 'Erro desconhecido',
        variant: 'destructive',
      });
      throw error;
    }
  };

  // Handler para toggle de trading
  const handleTradingToggle = async (enabled: boolean) => {
    try {
      const res = await apiRequest('PUT', '/api/integrations/trading/risk-config', {
        tradingEnabled: enabled,
      });
      const data = await res.json();
      if (data.success) {
        queryClient.setQueryData(['/api/integrations/trading/risk-config'], data);
        refetchRiskConfig();
        toast({
          title: enabled ? t('trading.handover.tradingEnabled') : t('trading.handover.tradingDisabled'),
        });
      }
    } catch (error) {
      toast({
        title: t('trading.handover.tradingToggleError'),
        description: error instanceof Error ? error.message : 'Erro desconhecido',
        variant: 'destructive',
      });
      throw error;
    }
  };

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
      toast({ title: t('trading.success.historyDeleted') });
      fetchOrderHistory({ reset: true });
    },
    onError: (error: Error) => {
      toast({ title: t('trading.errors.historyDeleteFailed'), description: error.message, variant: 'destructive' });
    },
  });

  const wsKlinesForChart = useMemo(() => {
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
  const [lastKlines, setLastKlines] = useState<KlineData[]>([]);
  const lastKlinesSignatureRef = useRef<string>('');

  useEffect(() => {
    setLastKlines([]);
    lastKlinesSignatureRef.current = '';
  }, [normalizedSymbol, wsInterval, selectedMarketType, selectedMarginMode]);

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

  // ============================================================================
  // HOOKS QUE DEPENDEM DE DADOS DE MERCADO
  // CORREÇÃO React error #310: hooks DEVEM ser chamados ANTES de qualquer
  // early return condicional para manter ordem consistente entre renders.
  // REF: CLAUDE.md Regra 7 (Mudanças cirúrgicas), React Rules of Hooks
  // ============================================================================

  const contractMultiplier = market?.contract?.multiplier ?? 0.001;
  const wsTickerPrice = wsEnabled && wsTicker?.symbol?.toUpperCase() === normalizedSymbol
    ? Number(wsTicker.price)
    : NaN;
  const fallbackPrice = isFuturesMarket
    ? market?.contract?.lastTradePrice
    : (market?.ticker?.price ? Number(market.ticker.price) : undefined);
  const fallbackPriceValue = Number.isFinite(fallbackPrice ?? NaN) ? Number(fallbackPrice) : 0;
  const currentPrice = Number.isFinite(wsTickerPrice) ? wsTickerPrice : fallbackPriceValue;

  const handleOrderSizeChange = useCallback((sizeValue: string) => {
    setOrderForm(prev => {
      const sizeNum = parseFloat(sizeValue);
      if (currentPrice > 0 && Number.isFinite(sizeNum) && sizeNum > 0 && isFuturesMarket) {
        const usdtVal = sizeNum * currentPrice * contractMultiplier;
        return { ...prev, size: sizeValue, usdtAmount: usdtVal.toFixed(2) };
      }
      return { ...prev, size: sizeValue, usdtAmount: '' };
    });
  }, [currentPrice, contractMultiplier, isFuturesMarket]);

  const handleOrderUsdtChange = useCallback((usdtValue: string) => {
    setOrderForm(prev => {
      const usdtNum = parseFloat(usdtValue);
      if (currentPrice > 0 && Number.isFinite(usdtNum) && usdtNum > 0 && isFuturesMarket) {
        const qty = usdtNum / (currentPrice * contractMultiplier);
        return { ...prev, usdtAmount: usdtValue, size: qty.toFixed(4) };
      }
      return { ...prev, usdtAmount: usdtValue, size: '' };
    });
  }, [currentPrice, contractMultiplier, isFuturesMarket]);

  // ============================================================================
  // RENDER - Loading State
  // ============================================================================

  if (isLoadingStatus) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  // ============================================================================
  // RENDER - Erro ao carregar status
  // ============================================================================

  if (statusError) {
    const errorMessage = statusError instanceof ApiError
      ? statusError.message
      : statusError instanceof Error
        ? statusError.message
        : 'Erro desconhecido';

    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center space-y-4">
            <AlertTriangle className="h-12 w-12 text-yellow-500" />
            <div>
              <h3 className="text-lg font-medium">Falha ao carregar o status do Trading</h3>
              <p className="text-muted-foreground mt-2 max-w-md">
                {errorMessage}
              </p>
            </div>
            <Button onClick={() => refetchStatus()}>Recarregar status</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!statusData?.data) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center space-y-4">
            <AlertTriangle className="h-12 w-12 text-yellow-500" />
            <div>
              <h3 className="text-lg font-medium">Status do Trading indisponível</h3>
              <p className="text-muted-foreground mt-2 max-w-md">
                Não foi possível obter o status do serviço. Tente novamente em alguns instantes.
              </p>
            </div>
            <Button onClick={() => refetchStatus()}>Recarregar status</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============================================================================
  // RENDER - Not Configured State
  // ============================================================================

  if (!statusData?.data?.isConfigured) {
    const missingKeys = statusData.data.missingKeys?.length
      ? statusData.data.missingKeys
      : ['KUCOIN_PRO_API_KEY', 'KUCOIN_PRO_API_SECRET', 'KUCOIN_PRO_API_PASSPHRASE'];

    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">{t('trading.notConfigured')}</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              {t('trading.notConfiguredDesc')}
            </p>
            <div className="p-4 bg-muted rounded-lg text-sm font-mono space-y-1">
              {missingKeys.map((key) => (
                <p key={key}>{key}</p>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============================================================================
  // RENDER - Tenant obrigatório (multi-tenancy)
  // ============================================================================
  if (statusData?.data?.requiresTenant) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="h-12 w-12 text-yellow-500 mb-4" />
            <h3 className="text-lg font-medium mb-2">Tenant obrigatório</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Seu usuário está autenticado, mas não possui um <strong>tenant</strong> associado. Para operar trading,
              é obrigatório ter um tenant válido (multi-tenancy + RLS).
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============================================================================
  // DADOS EXTRAÍDOS
  // ============================================================================

  const status = statusData.data;
  const defaultSymbol = symbolsData?.data?.defaultSymbol || status.defaultSymbol || '';
  const account = accountData?.data;
  const isSpotMarket = selectedMarketType === 'spot';
  const isMarginMarket = selectedMarketType === 'margin';
  const baseCurrency = getBaseCurrencyFromSymbol(selectedSymbol);
  const quoteCurrency = getQuoteCurrencyFromSymbol(selectedSymbol);
  const spotAccounts = isSpotMarket && Array.isArray(account)
    ? account.filter((entry) => entry.type === 'trade')
    : [];
  const spotBaseAccount = spotAccounts.find((entry) => entry.currency === (baseCurrency ?? entry.currency));
  const spotQuoteAccount = spotAccounts.find((entry) => entry.currency === (quoteCurrency ?? entry.currency));
  const marginCrossAccount = isMarginMarket && account && !Array.isArray(account) && Array.isArray((account as MarginCrossAccount).accounts)
    ? (account as MarginCrossAccount)
    : null;
  const marginIsolatedAccount = isMarginMarket && account && !Array.isArray(account) && Array.isArray((account as MarginIsolatedAccount).assets)
    ? (account as MarginIsolatedAccount)
    : null;
  const marginIsolatedAsset = marginIsolatedAccount?.assets.find((asset) => asset.symbol === selectedSymbol)
    ?? marginIsolatedAccount?.assets[0];
  const positionsPayload = positionsData?.data ?? null;
  const futuresPositions = selectedMarketType === 'futures' && Array.isArray(positionsPayload)
    ? (positionsPayload as Position[])
    : [];
  const marginCrossPositions = selectedMarketType === 'margin' && isMarginCrossAccount(positionsPayload)
    ? positionsPayload
    : null;
  const marginIsolatedPositions = selectedMarketType === 'margin' && isMarginIsolatedAccount(positionsPayload)
    ? positionsPayload
    : null;
  const spotPositions = selectedMarketType === 'spot' && Array.isArray(positionsPayload)
    ? (positionsPayload as SpotAccount[])
    : [];
  const openPositionsCount = isFuturesMarket
    ? futuresPositions.filter((position) => position.isOpen).length
    : isSpotMarket
      ? spotPositions.filter((entry) => Number(entry.balance) > 0).length
      : isMarginMarket
        ? marginCrossPositions
          ? marginCrossPositions.accounts.filter((entry) => Number(entry.total) > 0).length
          : marginIsolatedPositions
            ? marginIsolatedPositions.assets.length
            : 0
        : 0;

  const orderSizeValue = orderForm.size ? Number(orderForm.size) : NaN;
  const orderFundsValue = orderForm.funds ? Number(orderForm.funds) : NaN;
  const hasOrderSize = Number.isFinite(orderSizeValue) && orderSizeValue > 0;
  const hasOrderFunds = Number.isFinite(orderFundsValue) && orderFundsValue > 0;
  const isOrderMarketBuy = orderForm.orderType === 'market' && orderForm.side === 'buy';
  const canSubmitOrder = isFuturesMarket
    ? hasOrderSize
    : isOrderMarketBuy
      ? hasOrderSize || hasOrderFunds
      : hasOrderSize;

  // Conversão USDT ↔ Quantidade para formulário de ordem (padrão exchange)
  const orders = ordersData?.data || [];
  const allOrderHistorySelected = orderHistoryItems.length > 0 && orderHistorySelectedIds.size === orderHistoryItems.length;
  const hasOrderHistorySelection = orderHistorySelectedIds.size > 0;
  const hasSignalArbitrage = signalProfileForm.techniques.includes('arbitrage_triangular');

  const toggleOrderHistorySelection = (orderId: string, checked: boolean) => {
    setOrderHistorySelectedIds((prev) => {
      const updated = new Set(prev);
      if (checked) {
        updated.add(orderId);
      } else {
        updated.delete(orderId);
      }
      return updated;
    });
  };

  const toggleOrderHistorySelectAll = (checked: boolean) => {
    if (checked) {
      setOrderHistorySelectedIds(new Set(orderHistoryItems.map((item) => item.id)));
      return;
    }
    setOrderHistorySelectedIds(new Set());
  };
  const riskConfig = riskConfigData?.data;
  const orderBookDepth = orderBookResponse?.depth ?? restOrderBookDepth ?? null;
  const controlHistory = controlHistoryData?.data || [];
  // `wsStatusData` já é o payload `{ success, data: KucoinWsStatus }`.
  // O accessor extra `.data` fazia `wsStatus` ficar sempre undefined e o badge nunca renderizar.
  const wsStatus = wsStatusData?.data;
  const apiErrors = [
    statusError,
    symbolsError,
    marketError,
    accountError,
    positionsError,
    signalsError,
    ordersError,
    riskConfigError,
    intervalsError,
    klinesError,
    orderBookError,
    controlHistoryError,
  ].filter((e): e is ApiError => e instanceof ApiError);
  const criticalApiError = apiErrors[0] ?? null;

  const priceChange = market?.contract?.priceChg || 0;
  const priceChangePercent = market?.contract?.priceChgPct || 0;

  // Preço efetivo para cálculos no resumo (limit usa preço da ordem, market usa preço atual)
  const orderEffectivePrice = orderForm.orderType === 'limit' && orderForm.price
    ? parseFloat(orderForm.price)
    : currentPrice;

  // ============================================================================
  // RENDER - Main
  // ============================================================================

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="p-3 md:p-6 space-y-4 md:space-y-6"
    >
      {criticalApiError ? (
        <motion.div variants={itemVariants}>
          <Alert variant="destructive" className="mb-2">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Falha ao carregar dados de Trading</AlertTitle>
            <AlertDescription className="space-y-1">
              <p>{criticalApiError.message}</p>
              {criticalApiError.status === 429 ? (
                <p className="text-sm">
                  Rate limit excedido
                  {criticalApiError.retryAfterSeconds ? ` — tente novamente em ~${criticalApiError.retryAfterSeconds}s.` : '.'}
                </p>
              ) : null}
              {criticalApiError.status === 503 ? (
                <p className="text-sm">
                  Serviço upstream indisponível (circuit breaker/credenciais). Verifique status, secrets e o painel de Observability.
                </p>
              ) : null}
            </AlertDescription>
          </Alert>
        </motion.div>
      ) : null}

      {/* Header */}
      <motion.div variants={itemVariants}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-trading-title">
              <LineChart className="h-6 w-6 text-primary" />
              {t('trading.title')}
            </h1>
            <p className="text-muted-foreground">{t('trading.subtitle')}</p>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            {/* Status Badges */}
            {riskConfig?.tradingEnabled ? (
              <Badge variant="default" className="bg-green-500">
                <Play className="h-3 w-3 mr-1" />
                {t('trading.status.enabled')}
              </Badge>
            ) : (
              <Badge variant="secondary">
                <Pause className="h-3 w-3 mr-1" />
                {t('trading.status.disabled')}
              </Badge>
            )}

            {/* Market Type Selector */}
            <Select
              value={selectedMarketType}
              onValueChange={(value: 'futures' | 'spot' | 'margin') => {
                // CORREÇÃO CR5 (07/02/2026): Reset símbolo ao trocar mercado para evitar race condition.
                // Sem reset, queries downstream podem disparar brevemente com símbolo do mercado antigo.
                setSelectedSymbol('');
                setSelectedMarketType(value);
              }}
              data-testid="select-market-type"
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="futures">{t('trading.marketType.futures')}</SelectItem>
                <SelectItem value="spot">{t('trading.marketType.spot')}</SelectItem>
                <SelectItem value="margin">{t('trading.marketType.margin')}</SelectItem>
              </SelectContent>
            </Select>

            {selectedMarketType === 'margin' && (
              <Select
                value={selectedMarginMode}
                onValueChange={(value: 'cross' | 'isolated') => setSelectedMarginMode(value)}
                data-testid="select-margin-mode"
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cross">{t('trading.marginMode.cross')}</SelectItem>
                  <SelectItem value="isolated">{t('trading.marginMode.isolated')}</SelectItem>
                </SelectContent>
              </Select>
            )}

            {/* Symbol Selector */}
            <Select value={selectedSymbol} onValueChange={setSelectedSymbol} disabled={isLoadingSymbols || symbolOptions.length === 0}>
              <SelectTrigger className="w-[180px]" data-testid="select-symbol">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-60 overflow-y-auto">
                {symbolSelectItems.map((item) => {
                  if (item.kind === 'label') {
                    return (
                      <SelectItem
                        key={item.value}
                        value={item.value}
                        disabled
                        className="text-xs uppercase text-muted-foreground"
                      >
                        {item.label}
                      </SelectItem>
                    );
                  }
                  return (
                    <SelectItem key={item.value} value={item.value}>
                      <span className="flex items-center gap-2">
                        {item.isFeatured ? <Pin className="h-3 w-3 text-blue-400" /> : null}
                        {item.isFavorite ? <Star className="h-3 w-3 text-yellow-400" /> : null}
                        {item.value}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="sm"
              onClick={() => toggleFavorite(selectedSymbol)}
              disabled={!selectedSymbol || updateSymbolPrefsMutation.isPending}
            >
              {favoriteSymbols.includes(selectedSymbol) ? (
                <Star className="h-4 w-4 text-yellow-400" />
              ) : (
                <Star className="h-4 w-4" />
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => toggleFeatured(selectedSymbol)}
              disabled={!selectedSymbol || updateSymbolPrefsMutation.isPending}
            >
              {featuredOverride.includes(selectedSymbol) ? (
                <Pin className="h-4 w-4 text-blue-400" />
              ) : (
                <Pin className="h-4 w-4" />
              )}
            </Button>

            {/* Actions */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshAll}
              data-testid="button-refresh-all"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('common.refresh')}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRiskConfigDialog(true)}
              data-testid="button-risk-config"
            >
              <Settings className="h-4 w-4 mr-2" />
              {t('trading.riskConfig.title')}
            </Button>
          </div>

          {featuredSymbols.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {featuredSymbols.map((symbol) => (
                <Button
                  key={symbol}
                  variant={symbol === selectedSymbol ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedSymbol(symbol)}
                  className="h-7 px-2 text-xs"
                >
                  {symbol}
                </Button>
              ))}
            </div>
          )}
        </div>
      </motion.div>

      {/* Alert se trading desabilitado */}
      {!riskConfig?.tradingEnabled && (
        <motion.div variants={itemVariants}>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t('trading.alerts.tradingDisabled')}</AlertTitle>
            <AlertDescription>
              {t('trading.alerts.tradingDisabledDesc')}
              <Button
                variant="link"
                className="p-0 h-auto ml-1"
                onClick={() => setShowRiskConfigDialog(true)}
              >
                {t('trading.alerts.enableNow')}
              </Button>
            </AlertDescription>
          </Alert>
        </motion.div>
      )}

      {/* Stats Cards */}
      <motion.div variants={itemVariants}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Preço Atual */}
          <Card className="md:col-span-2">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground">
                  {selectedSymbol} - {t('trading.market.lastPrice')}
                </p>
                <div className="flex items-center gap-2">
                  {wsStatus?.configured ? (
                    <Badge
                      variant="outline"
                      className="text-xs"
                      title={`KuCoin WS public=${wsStatus.public.state} private=${wsStatus.private.enabled ? wsStatus.private.state : 'disabled'}`}
                    >
                      WS: {wsStatus.public.state}
                    </Badge>
                  ) : null}
                  <Badge variant="outline" className="text-xs">
                    {t('trading.market.live')}
                  </Badge>
                </div>
              </div>
              {isLoadingMarket ? (
                <Skeleton className="h-10 w-64" />
              ) : (
                <PriceDisplay 
                  price={currentPrice} 
                  change={priceChange} 
                  changePercent={priceChangePercent}
                  locale={locale}
                />
              )}
              <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
                <div>
                  <p className="text-muted-foreground">{t('trading.market.high24h')}</p>
                  <p className="font-medium">
                    ${market?.contract?.highPrice ? formatNumber(market.contract.highPrice, locale) : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('trading.market.low24h')}</p>
                  <p className="font-medium">
                    ${market?.contract?.lowPrice ? formatNumber(market.contract.lowPrice, locale) : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('trading.market.volume24h')}</p>
                  <p className="font-medium">
                    {market?.contract?.volumeOf24h ? formatNumber(market.contract.volumeOf24h, locale) : '-'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Saldo Disponível / Total */}
          <StatCard
            title={isMarginMarket ? t('trading.account.totalAsset') : t('trading.account.availableBalance')}
            value={
              isLoadingAccount
                ? '-'
                : `$${formatNumber(
                    isFuturesMarket
                      ? (account as FuturesAccountOverview | null)?.availableBalance ?? 0
                      : isSpotMarket
                        ? Number(spotQuoteAccount?.available ?? 0)
                        : Number(
                            marginCrossAccount?.totalAssetOfQuoteCurrency ??
                              marginIsolatedAccount?.totalAssetOfQuoteCurrency ??
                              0
                          ),
                    locale,
                    { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                  )}`
            }
            subtitle={isFuturesMarket ? (account as FuturesAccountOverview | null)?.currency : (quoteCurrency ?? t('trading.account.multiCurrency'))}
            icon={DollarSign}
            isLoading={isLoadingAccount}
          />

          {/* PnL Não Realizado (Futures) / Resumo (Spot/Margin) */}
          {isFuturesMarket ? (
            <StatCard
              title={t('trading.account.unrealisedPnl')}
              value={
                isLoadingAccount
                  ? '-'
                  : `$${formatNumber((account as FuturesAccountOverview | null)?.unrealisedPNL ?? 0, locale, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`
              }
              subtitle={t('trading.account.allPositions')}
              icon={((account as FuturesAccountOverview | null)?.unrealisedPNL ?? 0) >= 0 ? TrendingUp : TrendingDown}
              trend={((account as FuturesAccountOverview | null)?.unrealisedPNL ?? 0) >= 0 ? 'up' : 'down'}
              isLoading={isLoadingAccount}
            />
          ) : isSpotMarket ? (
            <StatCard
              title={t('trading.account.assetsWithBalance')}
              value={
                isLoadingAccount
                  ? '-'
                  : formatNumber(
                      (Array.isArray(account) ? account : []).filter((entry) => Number(entry.balance) > 0).length,
                      locale
                    )
              }
              subtitle={t('trading.account.assetsSubtitle')}
              icon={Layers}
              isLoading={isLoadingAccount}
            />
          ) : (
            <StatCard
              title={t('trading.account.totalLiability')}
              value={
                isLoadingAccount
                  ? '-'
                  : `$${formatNumber(
                      Number(
                        marginCrossAccount?.totalLiabilityOfQuoteCurrency ??
                          marginIsolatedAccount?.totalLiabilityOfQuoteCurrency ??
                          0
                      ),
                      locale,
                      { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                    )}`
              }
              subtitle={quoteCurrency ?? t('trading.account.multiCurrency')}
              icon={AlertTriangle}
              isLoading={isLoadingAccount}
            />
          )}
        </div>
      </motion.div>

      {/* Stats Row 2 */}
      <motion.div variants={itemVariants}>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <StatCard
            title={t('trading.stats.activeSignals')}
          value={formatNumber(status.activeSignals, locale)}
            icon={Zap}
          />
          <StatCard
            title={t('trading.stats.pendingOrders')}
          value={formatNumber(status.pendingOrders, locale)}
            icon={Clock}
          />
          <StatCard
            title={t('trading.stats.openPositions')}
          value={formatNumber(openPositionsCount, locale)}
            icon={Activity}
          />
          <StatCard
            title={t('trading.stats.fundingRate')}
          value={isFuturesMarket
            ? `${formatNumber((market?.contract?.fundingFeeRate || 0) * 100, locale, {
                minimumFractionDigits: 4,
                maximumFractionDigits: 4,
              })}%`
            : '-'}
            icon={Percent}
          />
          <StatCard
            title={t('trading.stats.maxLeverage')}
          value={isFuturesMarket ? `${formatNumber(riskConfig?.maxLeverage || 20, locale)}x` : '-'}
            icon={Target}
          />
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground mb-1">{t('trading.stats.circuitBreaker')}</p>
              <CircuitBreakerStatus 
                state={status.circuitBreaker.state} 
                failures={status.circuitBreaker.failures} 
              />
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* Main Tabs - Mobile-First: Scroll horizontal em mobile */}
      <motion.div variants={itemVariants}>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          {/* MOBILE-FIRST 12/01/2026: Tabs com scroll horizontal para caber em mobile */}
          <div className="overflow-x-auto pb-2 -mx-2 px-2 md:overflow-visible md:mx-0 md:px-0">
            <TabsList className="grid w-full grid-cols-3 gap-1 sm:grid-cols-5 lg:grid-cols-10">
              <TabsTrigger value="overview" data-testid="tab-overview" className="whitespace-nowrap">
                <BarChart3 className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">{t('trading.tabs.overview')}</span>
              </TabsTrigger>
              <TabsTrigger value="chart" data-testid="tab-chart" className="whitespace-nowrap">
                <CandlestickChart className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">{t('trading.tabs.chart')}</span>
              </TabsTrigger>
              <TabsTrigger value="orderbook" data-testid="tab-orderbook" className="whitespace-nowrap">
                <Layers className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">{t('trading.tabs.orderbook')}</span>
              </TabsTrigger>
              <TabsTrigger value="orders" data-testid="tab-orders" className="whitespace-nowrap">
                <Activity className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">{t('trading.tabs.orders')}</span>
              </TabsTrigger>
              <TabsTrigger value="positions" data-testid="tab-positions" className="whitespace-nowrap">
                <Target className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">{t('trading.tabs.positions')}</span>
              </TabsTrigger>
              <TabsTrigger value="signals" data-testid="tab-signals" className="whitespace-nowrap">
                <Brain className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">{t('trading.tabs.signals')}</span>
              </TabsTrigger>
              <TabsTrigger value="analysis" data-testid="tab-analysis" className="whitespace-nowrap">
                <BarChart3 className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Análise</span>
              </TabsTrigger>
              <TabsTrigger value="history" data-testid="tab-history" className="whitespace-nowrap">
                <History className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">{t('trading.tabs.history')}</span>
              </TabsTrigger>
              <TabsTrigger value="account" data-testid="tab-account" className="whitespace-nowrap">
                <Wallet className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">{t('trading.tabs.account', 'Conta')}</span>
              </TabsTrigger>
              <TabsTrigger value="control" data-testid="tab-control" className="whitespace-nowrap">
                <Hand className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">{t('trading.tabs.control')}</span>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4 mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Quick Trade */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Rocket className="h-5 w-5" />
                    {t('trading.quickTrade.title')}
                  </CardTitle>
                  <CardDescription>{t('trading.quickTrade.subtitle')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      className="h-16 bg-green-600 hover:bg-green-700"
                      onClick={() => {
                        setOrderForm({ ...orderForm, side: 'buy' });
                        setShowNewOrderDialog(true);
                      }}
                      disabled={!riskConfig?.tradingEnabled}
                      data-testid="button-quick-buy"
                    >
                      <div className="flex flex-col items-center">
                        <TrendingUp className="h-5 w-5 mb-1" />
                        <span>{t('trading.quickTrade.buy')}</span>
                      </div>
                    </Button>
                    <Button
                      className="h-16 bg-red-600 hover:bg-red-700"
                      onClick={() => {
                        setOrderForm({ ...orderForm, side: 'sell' });
                        setShowNewOrderDialog(true);
                      }}
                      disabled={!riskConfig?.tradingEnabled}
                      data-testid="button-quick-sell"
                    >
                      <div className="flex flex-col items-center">
                        <TrendingDown className="h-5 w-5 mb-1" />
                        <span>{t('trading.quickTrade.sell')}</span>
                      </div>
                    </Button>
                  </div>
                  
                  <Separator />
                  
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('trading.quickTrade.bestBid')}</span>
                      <span className="text-green-500 font-mono">
                        ${market?.ticker?.bestBidPrice || '-'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('trading.quickTrade.bestAsk')}</span>
                      <span className="text-red-500 font-mono">
                        ${market?.ticker?.bestAskPrice || '-'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('trading.quickTrade.spread')}</span>
                      <span className="font-mono">
                        ${formatNumber(
                          parseFloat(market?.ticker?.bestAskPrice || '0') -
                            parseFloat(market?.ticker?.bestBidPrice || '0'),
                          locale,
                          { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                        )}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Account Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5" />
                    {t('trading.account.title')}
                  </CardTitle>
                  <CardDescription>{t('trading.account.subtitle')}</CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoadingAccount ? (
                    <div className="space-y-3">
                      <Skeleton className="h-6 w-full" />
                      <Skeleton className="h-6 w-full" />
                      <Skeleton className="h-6 w-full" />
                    </div>
                  ) : isFuturesMarket ? (
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('trading.account.equity')}</span>
                        <span className="font-medium">
                          ${formatNumber((account as FuturesAccountOverview | null)?.accountEquity ?? 0, locale)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('trading.account.marginBalance')}</span>
                        <span className="font-medium">
                          ${formatNumber((account as FuturesAccountOverview | null)?.marginBalance ?? 0, locale)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('trading.account.positionMargin')}</span>
                        <span className="font-medium">
                          ${formatNumber((account as FuturesAccountOverview | null)?.positionMargin ?? 0, locale)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('trading.account.orderMargin')}</span>
                        <span className="font-medium">
                          ${formatNumber((account as FuturesAccountOverview | null)?.orderMargin ?? 0, locale)}
                        </span>
                      </div>
                      <Separator />
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('trading.account.frozenFunds')}</span>
                        <span className="font-medium">
                          ${formatNumber((account as FuturesAccountOverview | null)?.frozenFunds ?? 0, locale)}
                        </span>
                      </div>
                    </div>
                  ) : isSpotMarket ? (
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {t('trading.account.availableBalance')} {spotBaseAccount?.currency ?? baseCurrency ?? ''}
                        </span>
                        <span className="font-medium">
                          {formatNumber(Number(spotBaseAccount?.available ?? 0), locale)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {t('trading.account.totalBalance')} {spotBaseAccount?.currency ?? baseCurrency ?? ''}
                        </span>
                        <span className="font-medium">
                          {formatNumber(Number(spotBaseAccount?.balance ?? 0), locale)}
                        </span>
                      </div>
                      <Separator />
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {t('trading.account.availableBalance')} {spotQuoteAccount?.currency ?? quoteCurrency ?? ''}
                        </span>
                        <span className="font-medium">
                          {formatNumber(Number(spotQuoteAccount?.available ?? 0), locale)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {t('trading.account.totalBalance')} {spotQuoteAccount?.currency ?? quoteCurrency ?? ''}
                        </span>
                        <span className="font-medium">
                          {formatNumber(Number(spotQuoteAccount?.balance ?? 0), locale)}
                        </span>
                      </div>
                      <Separator />
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('trading.account.assetsWithBalance')}</span>
                        <span className="font-medium">
                          {formatNumber(spotAccounts.filter((entry) => Number(entry.balance) > 0).length, locale)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('trading.account.totalAsset')}</span>
                        <span className="font-medium">
                          ${formatNumber(
                            Number(
                              marginCrossAccount?.totalAssetOfQuoteCurrency ??
                                marginIsolatedAccount?.totalAssetOfQuoteCurrency ??
                                0
                            ),
                            locale
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('trading.account.totalLiability')}</span>
                        <span className="font-medium">
                          ${formatNumber(
                            Number(
                              marginCrossAccount?.totalLiabilityOfQuoteCurrency ??
                                marginIsolatedAccount?.totalLiabilityOfQuoteCurrency ??
                                0
                            ),
                            locale
                          )}
                        </span>
                      </div>
                      <Separator />
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('trading.account.debtRatio')}</span>
                        <span className="font-medium">
                          {formatNumber(
                            Number(
                              marginCrossAccount?.debtRatio ??
                                marginIsolatedAsset?.debtRatio ??
                                0
                            ) * 100,
                            locale,
                            { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                          )}%
                        </span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Recent Signals & Orders */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Recent Signals */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Brain className="h-4 w-4" />
                      {t('trading.signals.recent')}
                    </CardTitle>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowNewSignalDialog(true)}
                    data-testid="button-new-signal"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    {t('trading.signals.new')}
                  </Button>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[200px]">
                    {isLoadingSignals ? (
                      <div className="space-y-2">
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                      </div>
                    ) : signals.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <Brain className="h-8 w-8 mb-2 opacity-50" />
                        <p className="text-sm">{t('trading.signals.noSignals')}</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {signals.slice(0, 5).map((signal) => (
                          <div
                            key={signal.id}
                            className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                          >
                            <div className="flex items-center gap-2">
                              <SignalTypeBadge type={signal.signalType} />
                              <div>
                                <p className="text-sm font-medium">{signal.symbol}</p>
                                <p className="text-xs text-muted-foreground">
                                  {t('trading.signals.confidence')}: {(Math.max(0, Math.min(1, signal.confidence)) * 100).toFixed(0)}%
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {signal.metadata?.generationSource
                                  ? t(`trading.signals.source.${signal.metadata.generationSource}`)
                                  : (signal.sourceModel || t('common.notAvailable'))}
                              </Badge>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => deactivateSignalMutation.mutate(signal.id)}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Recent Orders */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Activity className="h-4 w-4" />
                      {t('trading.orders.recent')}
                    </CardTitle>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => syncOrdersMutation.mutate()}
                      disabled={syncOrdersMutation.isPending}
                      data-testid="button-sync-orders"
                    >
                      {syncOrdersMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-1" />
                      )}
                      {t('trading.orders.sync')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowNewOrderDialog(true)}
                      disabled={!riskConfig?.tradingEnabled}
                      data-testid="button-new-order"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      {t('trading.orders.new')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[200px]">
                    {isLoadingOrders ? (
                      <div className="space-y-2">
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                      </div>
                    ) : orders.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <Activity className="h-8 w-8 mb-2 opacity-50" />
                        <p className="text-sm">{t('trading.orders.noOrders')}</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {orders.slice(0, 5).map((order) => (
                          <div
                            key={order.id}
                            className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                          >
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className={order.side === 'buy' ? 'text-green-500 border-green-500' : 'text-red-500 border-red-500'}
                              >
                                {order.side === 'buy' ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                                {order.side.toUpperCase()}
                              </Badge>
                              <div>
                                <p className="text-sm font-medium">
                                  {order.size} @ {order.price ? `$${order.price}` : 'Mercado'}
                                </p>
                                <p className="text-xs text-muted-foreground">{order.symbol}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <OrderStatusBadge status={order.status} />
                              {order.status === 'pending_review' && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={() => openReviewDialog(order)}
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 text-green-600"
                                    onClick={() => approveReviewOrderMutation.mutate(order.id)}
                                  >
                                    <CheckCircle className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 text-destructive"
                                    onClick={() => rejectReviewOrderMutation.mutate({ orderId: order.id })}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </>
                              )}
                              {(order.status === 'pending' || order.status === 'open') && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-destructive"
                                  onClick={() => cancelOrderMutation.mutate(order.id)}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Orders Tab */}
          <TabsContent value="orders" className="space-y-4 mt-6">
            <div className="flex justify-between items-center">
              <CardDescription>{t('trading.orders.subtitle')}</CardDescription>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => syncOrdersMutation.mutate()}
                  disabled={syncOrdersMutation.isPending}
                >
                  {syncOrdersMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  {t('trading.orders.sync')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowOcoOrderDialog(true)}
                  disabled={!riskConfig?.tradingEnabled}
                >
                  <Link2 className="h-4 w-4 mr-2" />
                  {t('trading.oco.button')}
                </Button>
                <Button
                  onClick={() => setShowNewOrderDialog(true)}
                  disabled={!riskConfig?.tradingEnabled}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('trading.orders.new')}
                </Button>
              </div>
            </div>

            {isLoadingOrders ? (
              <Skeleton className="h-64" />
            ) : orders.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Activity className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">{t('trading.orders.noOrders')}</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('trading.orders.table.id')}</TableHead>
                      <TableHead>{t('trading.orders.table.symbol')}</TableHead>
                      <TableHead>{t('trading.orders.table.side')}</TableHead>
                      <TableHead>{t('trading.orders.table.type')}</TableHead>
                      <TableHead>{t('trading.orders.table.size')}</TableHead>
                      <TableHead>{t('trading.orders.table.price')}</TableHead>
                      <TableHead>{t('trading.orders.table.filled')}</TableHead>
                      <TableHead>{t('trading.orders.table.status')}</TableHead>
                      <TableHead>{t('trading.orders.table.created')}</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id} data-testid={`row-order-${order.id}`}>
                        <TableCell className="font-mono text-xs">{order.clientOid.slice(-8)}</TableCell>
                        <TableCell>{order.symbol}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={order.side === 'buy' ? 'text-green-500 border-green-500' : 'text-red-500 border-red-500'}
                          >
                            {order.side === 'buy' ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                            {order.side.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="capitalize">{order.orderType}</TableCell>
                        <TableCell>{order.size}</TableCell>
                        <TableCell>
                          {order.price ? `$${formatNumber(parseFloat(order.price), locale)}` : 'Mercado'}
                        </TableCell>
                        <TableCell>
                          {order.filledSize || '0'} / {order.size}
                        </TableCell>
                        <TableCell><OrderStatusBadge status={order.status} /></TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDateTime(order.criadoEm, { locale, timeZone })}
                        </TableCell>
                        <TableCell>
                          {order.status === 'pending_review' && (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openReviewDialog(order)}
                                data-testid={`button-review-order-${order.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => approveReviewOrderMutation.mutate(order.id)}
                                data-testid={`button-approve-order-${order.id}`}
                              >
                                <CheckCircle className="h-4 w-4 text-green-600" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => rejectReviewOrderMutation.mutate({ orderId: order.id })}
                                data-testid={`button-reject-order-${order.id}`}
                              >
                                <X className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          )}
                          {(order.status === 'pending' || order.status === 'open') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => cancelOrderMutation.mutate(order.id)}
                              data-testid={`button-cancel-order-${order.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>

          {/* Positions Tab */}
          <TabsContent value="positions" className="space-y-4 mt-6">
            <div className="flex justify-between items-center">
              <CardDescription>{t('trading.positions.subtitle')}</CardDescription>
              <div className="flex gap-2">
                {isFuturesMarket && (
                  <PositionHistoryButton symbol={selectedSymbol || defaultSymbol} />
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchPositions()}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {t('common.refresh')}
                </Button>
              </div>
            </div>

            {isLoadingPositions ? (
              <Skeleton className="h-64" />
            ) : isFuturesMarket ? (
              futuresPositions.filter(p => p.isOpen).length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Target className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">{t('trading.positions.noPositions')}</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4">
                  {futuresPositions.filter(p => p.isOpen).map((position) => (
                    <Card key={position.id} data-testid={`card-position-${position.id}`}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <Badge
                              variant="outline"
                              className={position.currentQty > 0 ? 'text-green-500 border-green-500' : 'text-red-500 border-red-500'}
                            >
                              {position.currentQty > 0 ? 'LONG' : 'SHORT'}
                            </Badge>
                            <div>
                              <p className="font-medium">{position.symbol}</p>
                              <p className="text-sm text-muted-foreground">
                                {Math.abs(position.currentQty)} {t('trading.positions.contracts')} @ {position.realLeverage.toFixed(1)}x
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className={`text-lg font-bold ${position.unrealisedPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {position.unrealisedPnl >= 0 ? '+' : ''}${position.unrealisedPnl.toFixed(2)}
                            </p>
                            <p className={`text-sm ${position.unrealisedPnlPcnt >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {position.unrealisedPnlPcnt >= 0 ? '+' : ''}{(position.unrealisedPnlPcnt * 100).toFixed(2)}%
                            </p>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">{t('trading.positions.entryPrice')}</p>
                            <p className="font-medium">${formatNumber(position.avgEntryPrice, locale)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">{t('trading.positions.markPrice')}</p>
                            <p className="font-medium">${formatNumber(position.markPrice, locale)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">{t('trading.positions.liquidationPrice')}</p>
                            <p className="font-medium text-red-500">
                              ${formatNumber(position.liquidationPrice, locale)}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">{t('trading.positions.margin')}</p>
                            <p className="font-medium">${position.posMargin.toFixed(2)}</p>
                          </div>
                        </div>

                        {/* Ações de gerenciamento da posição */}
                        <PositionActions
                          position={position}
                          onActionComplete={() => refetchPositions()}
                        />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )
            ) : isSpotMarket ? (
              spotPositions.filter((entry) => Number(entry.balance) > 0).length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Layers className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">{t('trading.positions.noSpotBalance')}</p>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('trading.positions.asset')}</TableHead>
                        <TableHead>{t('trading.positions.balance')}</TableHead>
                        <TableHead>{t('trading.positions.available')}</TableHead>
                        <TableHead>{t('trading.positions.hold')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {spotPositions
                        .filter((entry) => Number(entry.balance) > 0)
                        .map((entry) => (
                          <TableRow key={entry.id}>
                            <TableCell className="font-medium">{entry.currency}</TableCell>
                            <TableCell>{formatNumber(Number(entry.balance), locale)}</TableCell>
                            <TableCell>{formatNumber(Number(entry.available), locale)}</TableCell>
                            <TableCell>{formatNumber(Number(entry.holds), locale)}</TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </Card>
              )
            ) : marginCrossPositions || marginIsolatedPositions ? (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('trading.positions.asset')}</TableHead>
                      <TableHead>{t('trading.positions.balance')}</TableHead>
                      <TableHead>{t('trading.positions.available')}</TableHead>
                      <TableHead>{t('trading.positions.liability')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {marginCrossPositions?.accounts.map((entry) => (
                      <TableRow key={entry.currency}>
                        <TableCell className="font-medium">{entry.currency}</TableCell>
                        <TableCell>{formatNumber(Number(entry.total), locale)}</TableCell>
                        <TableCell>{formatNumber(Number(entry.available), locale)}</TableCell>
                        <TableCell>{formatNumber(Number(entry.liability), locale)}</TableCell>
                      </TableRow>
                    ))}
                    {marginIsolatedPositions?.assets.map((asset) => (
                      <TableRow key={asset.symbol}>
                        <TableCell className="font-medium">{asset.symbol}</TableCell>
                        <TableCell>
                          {formatNumber(Number(asset.baseAsset.total), locale)} {asset.baseAsset.currency} / {formatNumber(Number(asset.quoteAsset.total), locale)} {asset.quoteAsset.currency}
                        </TableCell>
                        <TableCell>
                          {formatNumber(Number(asset.baseAsset.available), locale)} {asset.baseAsset.currency} / {formatNumber(Number(asset.quoteAsset.available), locale)} {asset.quoteAsset.currency}
                        </TableCell>
                        <TableCell>
                          {formatNumber(Number(asset.baseAsset.liability), locale)} {asset.baseAsset.currency} / {formatNumber(Number(asset.quoteAsset.liability), locale)} {asset.quoteAsset.currency}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Target className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">{t('trading.positions.noPositions')}</p>
                </CardContent>
              </Card>
            )}

            {/* Painel de Margin Debit (Borrow/Repay) - somente quando mercado Margin está selecionado */}
            {selectedMarketType === 'margin' && (
              <MarginDebitPanel defaultCurrency="USDT" />
            )}
          </TabsContent>

          {/* Signals Tab */}
          <TabsContent value="signals" className="space-y-4 mt-6">
            <div className="flex justify-between items-center">
              <CardDescription>{t('trading.signals.subtitle')}</CardDescription>
              <Button
                onClick={() => setShowNewSignalDialog(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                {t('trading.signals.new')}
              </Button>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>{t('trading.signals.profile.title')}</CardTitle>
                <CardDescription>{t('trading.signals.profile.subtitle')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <Label>{t('trading.signals.profile.timeframes')}</Label>
                  <MultiSelectDropdown
                    label={t('trading.signals.profile.timeframes')}
                    options={intervalOptions.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                    selectedValues={signalProfileForm.timeframes}
                    onChange={updateSignalTimeframes}
                    minSelected={1}
                    placeholder={t('trading.common.selectPlaceholder')}
                    selectedCountLabel={t('trading.common.selectedCount', { count: signalProfileForm.timeframes.length })}
                    maxLabel={t('trading.common.maxSelected', { max: signalProfileForm.timeframes.length })}
                    selectAllLabel={t('trading.common.selectAll')}
                    clearLabel={t('trading.common.clearSelection')}
                    emptyLabel={t('trading.common.noOptions')}
                  />
                </div>

                <div className="space-y-3">
                  <Label>{t('trading.signals.profile.indicators')}</Label>
                  <MultiSelectDropdown
                    label={t('trading.signals.profile.indicators')}
                    options={SIGNAL_INDICATOR_OPTIONS.map((option) => ({
                      value: option.key,
                      label: option.label,
                    }))}
                    selectedValues={signalProfileForm.indicators}
                    onChange={updateSignalIndicators}
                    minSelected={1}
                    placeholder={t('trading.common.selectPlaceholder')}
                    selectedCountLabel={t('trading.common.selectedCount', { count: signalProfileForm.indicators.length })}
                    maxLabel={t('trading.common.maxSelected', { max: signalProfileForm.indicators.length })}
                    selectAllLabel={t('trading.common.selectAll')}
                    clearLabel={t('trading.common.clearSelection')}
                    emptyLabel={t('trading.common.noOptions')}
                  />
                  <p className="text-xs text-muted-foreground">{t('trading.signals.profile.indicatorsSupportHint')}</p>
                </div>

                <div className="space-y-3">
                  <Label>{t('trading.signals.profile.techniques')}</Label>
                  <MultiSelectDropdown
                    label={t('trading.signals.profile.techniques')}
                    options={TRADING_TECHNIQUE_OPTIONS.map((option) => ({
                      value: option.key,
                      label: t(option.labelKey),
                    }))}
                    selectedValues={signalProfileForm.techniques}
                    onChange={updateSignalTechniques}
                    minSelected={1}
                    placeholder={t('trading.common.selectPlaceholder')}
                    selectedCountLabel={t('trading.common.selectedCount', { count: signalProfileForm.techniques.length })}
                    maxLabel={t('trading.common.maxSelected', { max: signalProfileForm.techniques.length })}
                    selectAllLabel={t('trading.common.selectAll')}
                    clearLabel={t('trading.common.clearSelection')}
                    emptyLabel={t('trading.common.noOptions')}
                  />
                  <p className="text-xs text-muted-foreground">{t('trading.signals.profile.techniquesHint')}</p>
                </div>

                <div className="space-y-3">
                  <Label>{t('trading.signals.profile.ensemble')}</Label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">{t('trading.signals.profile.ensembleMode')}</Label>
                      <Input value="ensemble_top3" disabled />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">{t('trading.signals.profile.ensembleTopN')}</Label>
                      <Select
                        value={String(signalProfileForm.ensembleConfig?.topN ?? DEFAULT_ENSEMBLE_CONFIG.topN)}
                        onValueChange={(value) => setSignalProfileForm((prev) => ({
                          ...prev,
                          ensembleConfig: { ...DEFAULT_ENSEMBLE_CONFIG, ...prev.ensembleConfig, topN: Number(value) },
                        }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4, 5].map((value) => (
                            <SelectItem key={value} value={String(value)}>{value}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {hasSignalArbitrage && signalProfileForm.arbitrageConfig && (
                  <div className="space-y-3">
                    <Label>{t('trading.signals.profile.arbitrage')}</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <MultiSelectDropdown
                          label={t('trading.signals.profile.arbitrageExchange')}
                          options={availableSignalArbitrageExchanges.map((exchange) => ({
                            value: exchange.id,
                            label: exchange.label,
                          }))}
                          selectedValues={signalProfileForm.arbitrageConfig?.exchanges ?? []}
                          onChange={updateSignalArbitrageExchanges}
                          placeholder={t('trading.common.selectPlaceholder')}
                          selectedCountLabel={t('trading.common.selectedCount', { count: signalProfileForm.arbitrageConfig?.exchanges?.length ?? 0 })}
                          maxLabel={t('trading.common.maxSelected', { max: signalProfileForm.arbitrageConfig?.exchanges?.length ?? 0 })}
                          selectAllLabel={t('trading.common.selectAll')}
                          clearLabel={t('trading.common.clearSelection')}
                          emptyLabel={isSignalArbitrageCatalogLoading ? t('trading.common.loadingOptions') : t('trading.common.noOptions')}
                        />
                      </div>
                      <div className="space-y-2">
                        <MultiSelectDropdown
                          label={t('trading.signals.profile.arbitrageIntermediate')}
                          options={availableSignalArbitrageAssets.map((asset) => ({
                            value: asset.toUpperCase(),
                            label: asset.toUpperCase(),
                          }))}
                          selectedValues={signalProfileForm.arbitrageConfig?.intermediateAssets ?? []}
                          onChange={updateSignalArbitrageAssets}
                          maxSelected={MAX_ARBITRAGE_ASSETS}
                          placeholder={t('trading.common.selectPlaceholder')}
                          selectedCountLabel={t('trading.common.selectedCount', { count: signalProfileForm.arbitrageConfig?.intermediateAssets?.length ?? 0 })}
                          maxLabel={t('trading.common.maxSelected', { max: MAX_ARBITRAGE_ASSETS })}
                          selectAllLabel={t('trading.common.selectAll')}
                          clearLabel={t('trading.common.clearSelection')}
                          emptyLabel={isSignalArbitrageCatalogLoading ? t('trading.common.loadingOptions') : t('trading.common.noOptions')}
                        />
                        <p className="text-xs text-muted-foreground">
                          Limite de {MAX_ARBITRAGE_ASSETS} ativos para evitar explosão combinatória.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">{t('trading.signals.profile.arbitrageFee')}</Label>
                        <Input
                          value={String(signalProfileForm.arbitrageConfig.feePct)}
                          readOnly
                        />
                        <p className="text-xs text-muted-foreground">
                          Taxa automática (maior entre exchanges selecionadas).
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">{t('trading.signals.profile.arbitrageSlippage')}</Label>
                        <Input
                          value={String(signalProfileForm.arbitrageConfig.maxSlippagePct)}
                          onChange={(event) => updateSignalArbitrageConfig({
                            maxSlippagePct: Number(event.target.value) || 0,
                          })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">{t('trading.signals.profile.arbitrageMinEdge')}</Label>
                        <Input
                          value={String(signalProfileForm.arbitrageConfig.minEdgePct)}
                          onChange={(event) => updateSignalArbitrageConfig({
                            minEdgePct: Number(event.target.value) || 0,
                          })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">{t('trading.signals.profile.arbitrageMaxInterval')}</Label>
                        <Input
                          value={String(signalProfileForm.arbitrageConfig.maxIntervalMinutes)}
                          onChange={(event) => updateSignalArbitrageConfig({
                            maxIntervalMinutes: Number(event.target.value) || DEFAULT_ARBITRAGE_CONFIG.maxIntervalMinutes,
                          })}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Network fees são aplicadas automaticamente quando a rota cruza exchanges.
                    </p>
                    <p className="text-xs text-muted-foreground">{t('trading.signals.profile.arbitrageHint')}</p>
                  </div>
                )}

                <div className="space-y-3">
                  <Label>{t('trading.signals.profile.sources')}</Label>
                  <MultiSelectDropdown
                    label={t('trading.signals.profile.sources')}
                    options={signalSourceOptions.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                    selectedValues={selectedSignalSources}
                    onChange={updateSignalSources}
                    placeholder={t('trading.common.selectPlaceholder')}
                    selectedCountLabel={t('trading.common.selectedCount', { count: selectedSignalSources.length })}
                    maxLabel={t('trading.common.maxSelected', { max: selectedSignalSources.length })}
                    selectAllLabel={t('trading.common.selectAll')}
                    clearLabel={t('trading.common.clearSelection')}
                    emptyLabel={t('trading.common.noOptions')}
                  />
                  <div className="text-xs text-muted-foreground space-y-1">
                    {signalSourceOptions.map((option) => (
                      <p key={option.value}>
                        <span className="font-medium">{option.label}:</span> {option.description}
                      </p>
                    ))}
                  </div>
                </div>

                <NewsConfigEditor
                  value={signalProfileForm.newsConfig}
                  onChange={(next) => setSignalProfileForm((prev) => ({
                    ...prev,
                    newsConfig: next,
                  }))}
                  title={t('trading.newsConfig.title')}
                  description={t('trading.newsConfig.subtitleSignals')}
                  presets={newsPresets}
                  selectedPresetId={selectedSignalNewsPresetId}
                  onSelectPresetId={setSelectedSignalNewsPresetId}
                  onApplyPreset={(preset) => {
                    setSignalProfileForm((prev) => ({
                      ...prev,
                      newsConfig: normalizeTradingNewsConfigForm(preset.config),
                    }));
                  }}
                  presetName={signalNewsPresetName}
                  presetDescription={signalNewsPresetDescription}
                  onPresetNameChange={setSignalNewsPresetName}
                  onPresetDescriptionChange={setSignalNewsPresetDescription}
                  onCreatePreset={(payload) => createNewsPresetMutation.mutate(payload)}
                  onUpdatePreset={(payload) => updateNewsPresetMutation.mutate(payload)}
                  onDeletePreset={(presetId) => deleteNewsPresetMutation.mutate(presetId)}
                />

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      if (isSignalArbitrageInvalid) {
                        toast({
                          title: t('trading.errors.profileUpdateFailed'),
                          description: signalArbitrageErrorMessage,
                          variant: 'destructive',
                        });
                        return;
                      }
                      if (isManualSignalSavePending) return;
                      setIsManualSignalSavePending(true);
                      updateSignalProfileMutation.mutate(signalProfilePayload, {
                        onSettled: () => {
                          setIsManualSignalSavePending(false);
                        },
                      });
                    }}
                    disabled={isManualSignalSavePending || isSignalArbitrageInvalid || signalProfilePayload.timeframes.length === 0 || signalProfilePayload.indicators.length === 0 || signalProfilePayload.techniques.length === 0}
                  >
                    {isManualSignalSavePending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {t('trading.signals.profile.save')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (isSignalArbitrageInvalid) {
                        toast({
                          title: t('trading.errors.signalGenerateFailed'),
                          description: signalArbitrageErrorMessage,
                          variant: 'destructive',
                        });
                        return;
                      }
                      generateSignalMutation.mutate();
                    }}
                    disabled={generateSignalMutation.isPending || isSignalArbitrageInvalid}
                  >
                    {generateSignalMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {t('trading.signals.generateNow')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => selectedSignalNewsPreset && updateNewsPresetMutation.mutate({
                      id: selectedSignalNewsPreset.id,
                      name: normalizedSignalNewsPresetName,
                      description: signalNewsPresetDescription.trim() || null,
                      config: signalProfileForm.newsConfig,
                    })}
                    disabled={!canUpdateSignalNewsPreset || updateNewsPresetMutation.isPending}
                  >
                    {updateNewsPresetMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {t('trading.newsConfig.updatePreset')}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => createNewsPresetMutation.mutate({
                      name: normalizedSignalNewsPresetName,
                      description: signalNewsPresetDescription.trim() || null,
                      config: signalProfileForm.newsConfig,
                    })}
                    disabled={!canCreateSignalNewsPreset || createNewsPresetMutation.isPending}
                  >
                    {createNewsPresetMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {t('trading.newsConfig.createPreset')}
                  </Button>
                </div>
                {isSignalArbitrageInvalid && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {signalArbitrageErrorMessage}
                  </div>
                )}
                <Separator className="my-6" />

                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold">{t('trading.signals.scheduler.title')}</h3>
                    <p className="text-xs text-muted-foreground">{t('trading.signals.scheduler.subtitle')}</p>
                  </div>

                  <div className="space-y-2">
                    <Label>{t('trading.signals.scheduler.timeframesLabel')}</Label>
                    <div className="flex flex-wrap gap-2">
                      {signalProfileForm.timeframes.map((frame) => (
                        <Badge key={frame} variant="outline">
                          {frame}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">{t('trading.signals.scheduler.timeframesHint')}</p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>{t('trading.signals.scheduler.intervalMinutes')}</Label>
                      <Input
                        type="number"
                        min={1}
                        max={1440}
                        value={schedulerForm.intervalMinutes}
                        onChange={(e) => setSchedulerForm({ ...schedulerForm, intervalMinutes: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>{t('trading.signals.scheduler.symbols')}</Label>
                      <Input
                        value={schedulerForm.symbols}
                        onChange={(e) => setSchedulerForm({ ...schedulerForm, symbols: e.target.value })}
                        placeholder={t('trading.signals.scheduler.symbolsPlaceholder')}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('trading.signals.scheduler.maxSignals')}</Label>
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        value={schedulerForm.maxSignalsPerRun}
                        onChange={(e) => setSchedulerForm({ ...schedulerForm, maxSignalsPerRun: e.target.value })}
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={schedulerForm.enabled}
                        onCheckedChange={(checked) => setSchedulerForm({ ...schedulerForm, enabled: checked })}
                      />
                      <span className="text-sm">{t('trading.signals.scheduler.enabled')}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => updateSignalSchedulerMutation.mutate()}
                      disabled={updateSignalSchedulerMutation.isPending}
                    >
                      {updateSignalSchedulerMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      {t('trading.signals.scheduler.save')}
                    </Button>
                  </div>

                  <div className="text-xs text-muted-foreground grid gap-1">
                    <span>{t('trading.signals.scheduler.status.nextRun')}: {schedulerConfig?.nextRunAt ? formatDateTime(String(schedulerConfig.nextRunAt), { locale, timeZone }) : t('common.notAvailable')}</span>
                    <span>{t('trading.signals.scheduler.status.lastRun')}: {schedulerConfig?.lastRunAt ? formatDateTime(String(schedulerConfig.lastRunAt), { locale, timeZone }) : t('common.notAvailable')}</span>
                    <span>{t('trading.signals.scheduler.status.lastSuccess')}: {schedulerConfig?.lastSuccessAt ? formatDateTime(String(schedulerConfig.lastSuccessAt), { locale, timeZone }) : t('common.notAvailable')}</span>
                    <span>{t('trading.signals.scheduler.status.lastDuration')}: {schedulerConfig?.lastDurationMs ? `${schedulerConfig.lastDurationMs}ms` : t('common.notAvailable')}</span>
                    {schedulerConfig?.lastError && (
                      <span className="text-destructive">{t('trading.signals.scheduler.status.lastError')}: {schedulerConfig.lastError}</span>
                    )}
                    {schedulerError && (
                      <span className="text-destructive">{t('trading.signals.scheduler.status.loadError')}</span>
                    )}
                    {isLoadingScheduler && (
                      <span>{t('trading.signals.scheduler.status.loading')}</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('trading.signals.detail.title')}</CardTitle>
                <CardDescription>
                  {selectedSignal
                    ? t('trading.signals.detail.subtitle', { symbol: selectedSignal.symbol })
                    : t('trading.signals.detail.empty')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedSignal ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">{t('trading.signals.detail.operationType')}</div>
                        <div className="text-sm font-medium">
                          {selectedSignal.metadata?.operationType
                            ? t(`trading.signals.operationType.${selectedSignal.metadata.operationType}`)
                            : t('common.notAvailable')}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">{t('trading.signals.detail.duration')}</div>
                        <div className="text-sm font-medium">
                          {selectedSignal.metadata?.expectedDurationLabel
                            ?? formatDurationMinutes(selectedSignal.metadata?.expectedDurationMinutes)
                            ?? t('common.notAvailable')}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">{t('trading.signals.detail.entry')}</div>
                        <div className="text-sm font-medium">
                          {Number.isFinite(selectedSignal.metadata?.entryPrice)
                            ? `$${formatNumber(Number(selectedSignal.metadata?.entryPrice), locale)}`
                            : t('common.notAvailable')}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">{t('trading.signals.detail.tp')}</div>
                        <div className="text-sm font-medium">
                          {Number.isFinite(selectedSignal.metadata?.takeProfit)
                            ? `$${formatNumber(Number(selectedSignal.metadata?.takeProfit), locale)}`
                            : t('common.notAvailable')}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">{t('trading.signals.detail.sl')}</div>
                        <div className="text-sm font-medium">
                          {Number.isFinite(selectedSignal.metadata?.stopLoss)
                            ? `$${formatNumber(Number(selectedSignal.metadata?.stopLoss), locale)}`
                            : t('common.notAvailable')}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">{t('trading.signals.detail.rr')}</div>
                        <div className="text-sm font-medium">
                          {Number.isFinite(selectedSignal.metadata?.riskReward)
                            ? formatNumber(Number(selectedSignal.metadata?.riskReward), locale, { maximumFractionDigits: 2 })
                            : t('common.notAvailable')}
                        </div>
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <div className="text-xs text-muted-foreground">{t('trading.signals.detail.summary')}</div>
                      <div className="text-sm">
                        {selectedSignal.metadata?.tradeSummary || selectedSignal.reasoning || t('trading.signals.noReasoning')}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs text-muted-foreground mb-2">{t('trading.signals.detail.motivators')}</div>
                        {(selectedSignal.metadata?.motivators?.length ?? 0) > 0 ? (
                          <ul className="text-sm list-disc pl-5 space-y-1 text-muted-foreground">
                            {selectedSignal.metadata?.motivators?.map((item, index) => (
                              <li key={`${selectedSignal.id}-motivator-${index}`}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-sm text-muted-foreground">{t('common.notAvailable')}</div>
                        )}
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-2">{t('trading.signals.detail.invalidations')}</div>
                        {(selectedSignal.metadata?.invalidationReasons?.length ?? 0) > 0 ? (
                          <ul className="text-sm list-disc pl-5 space-y-1 text-muted-foreground">
                            {selectedSignal.metadata?.invalidationReasons?.map((item, index) => (
                              <li key={`${selectedSignal.id}-invalidation-${index}`}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <div className="text-sm text-muted-foreground">{t('common.notAvailable')}</div>
                        )}
                      </div>
                    </div>

                    {(selectedSignal.metadata?.news?.results?.length ?? 0) > 0 ? (
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">{t('trading.signals.detail.newsTitle')}</div>
                        <div className="text-sm text-muted-foreground">
                          {t('trading.signals.detail.newsQuery')}: {selectedSignal.metadata?.news?.query}
                        </div>
                        <ul className="text-sm list-disc pl-5 space-y-1 text-muted-foreground">
                          {selectedSignal.metadata?.news?.results.map((item) => (
                            <li key={`${selectedSignal.id}-news-${item.url}`}>
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
                      </div>
                    ) : (
                      selectedSignal.metadata?.dataSources?.news ? (
                        <div className="text-sm text-muted-foreground">
                          {t('trading.signals.detail.newsEmpty')}
                        </div>
                      ) : null
                    )}
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">{t('trading.signals.detail.empty')}</div>
                )}
              </CardContent>
            </Card>

            {isLoadingSignals ? (
              <Skeleton className="h-64" />
            ) : signals.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Brain className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">{t('trading.signals.noSignals')}</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('trading.signals.table.type')}</TableHead>
                      <TableHead>{t('trading.signals.table.symbol')}</TableHead>
                      <TableHead>{t('trading.signals.table.market')}</TableHead>
                      <TableHead>{t('trading.signals.table.confidence')}</TableHead>
                      <TableHead>{t('trading.signals.table.validation')}</TableHead>
                      <TableHead>{t('trading.signals.table.source')}</TableHead>
                      <TableHead>{t('trading.signals.table.reasoning')}</TableHead>
                      <TableHead>{t('trading.signals.table.created')}</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {signals.map((signal) => {
                      const isSelected = signal.id === selectedSignalId;
                      return (
                      <TableRow
                        key={signal.id}
                        data-testid={`row-signal-${signal.id}`}
                        className={isSelected ? 'bg-muted/50' : undefined}
                        onClick={() => setSelectedSignalId(signal.id)}
                      >
                        <TableCell><SignalTypeBadge type={signal.signalType} /></TableCell>
                        <TableCell>{signal.symbol}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{t(`trading.marketType.${signal.marketType}`)}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-primary" 
                                style={{ width: `${Math.max(0, Math.min(1, signal.confidence)) * 100}%` }}
                              />
                            </div>
                            <span className="text-sm">{(Math.max(0, Math.min(1, signal.confidence)) * 100).toFixed(0)}%</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {signal.metadata?.validationStatus
                              ? t(`trading.signals.validation.${signal.metadata.validationStatus}`)
                              : t('common.notAvailable')}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {signal.metadata?.generationSource
                              ? t(`trading.signals.source.${signal.metadata.generationSource}`)
                              : (signal.sourceModel || t('common.notAvailable'))}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help">{signal.reasoning || '-'}</span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[300px]">
                              <p>{signal.reasoning || t('trading.signals.noReasoning')}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDateTime(signal.criadoEm, { locale, timeZone })}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(event) => {
                              event.stopPropagation();
                              deactivateSignalMutation.mutate(signal.id);
                            }}
                            data-testid={`button-deactivate-signal-${signal.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            )}

            {/* Painel de Aprovação de Sinais (21/12/2025) */}
            {/* BUG FIX 21/12/2025: Usar ?? ao invés de || para preservar valor 0 válido */}
            <SignalApprovalPanel
              marketType={selectedMarketType}
            />
          </TabsContent>

          {/* Analysis Tab - Análise Técnica Enterprise (21/12/2025) */}
          <TabsContent value="analysis" className="space-y-4 mt-6">
            <TechnicalAnalysisPanel
              symbol={selectedSymbol}
              defaultInterval={selectedInterval}
              intervalOptions={intervalOptions}
              marketType={selectedMarketType}
              marginMode={selectedMarginMode}
            />
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-4 mt-6">
            <Card>
              <CardHeader>
                <CardTitle>{t('trading.history.title')}</CardTitle>
                <CardDescription>{t('trading.history.subtitle')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <Button
                    variant="destructive"
                    disabled={!hasOrderHistorySelection || deleteOrderHistoryMutation.isPending}
                    onClick={() => deleteOrderHistoryMutation.mutate({ ids: Array.from(orderHistorySelectedIds), scope: 'self' })}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t('trading.history.actions.deleteSelected')}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={deleteOrderHistoryMutation.isPending}
                    onClick={() => deleteOrderHistoryMutation.mutate({ all: true, scope: 'self' })}
                  >
                    {t('trading.history.actions.deleteAllMine')}
                  </Button>
                  {isAdminRole && (
                    <Button
                      variant="outline"
                      disabled={deleteOrderHistoryMutation.isPending}
                      onClick={() => deleteOrderHistoryMutation.mutate({ all: true, scope: 'tenant' })}
                    >
                      {t('trading.history.actions.deleteAllTenant')}
                    </Button>
                  )}
                </div>

                {orderHistoryLoading ? (
                  <Skeleton className="h-64" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            checked={allOrderHistorySelected}
                            onCheckedChange={(checked) => toggleOrderHistorySelectAll(Boolean(checked))}
                          />
                        </TableHead>
                        <TableHead>{t('trading.history.table.date')}</TableHead>
                        <TableHead>{t('trading.history.table.type')}</TableHead>
                        <TableHead>{t('trading.history.table.symbol')}</TableHead>
                        <TableHead>{t('trading.history.table.side')}</TableHead>
                        <TableHead>{t('trading.history.table.size')}</TableHead>
                        <TableHead>{t('trading.history.table.price')}</TableHead>
                        <TableHead>{t('trading.history.table.status')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderHistoryItems.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell>
                            <Checkbox
                              checked={orderHistorySelectedIds.has(order.id)}
                              onCheckedChange={(checked) => toggleOrderHistorySelection(order.id, Boolean(checked))}
                            />
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDateTime(order.criadoEm, { locale, timeZone })}
                          </TableCell>
                          <TableCell className="capitalize">{order.orderType}</TableCell>
                          <TableCell>{order.symbol}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={order.side === 'buy' ? 'text-green-500 border-green-500' : 'text-red-500 border-red-500'}
                            >
                              {order.side.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell>{order.filledSize || order.size}</TableCell>
                          <TableCell>
                            ${formatNumber(parseFloat(order.avgFilledPrice || order.price), locale)}
                          </TableCell>
                          <TableCell><OrderStatusBadge status={order.status} /></TableCell>
                        </TableRow>
                      ))}
                      {orderHistoryItems.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-muted-foreground">
                            {t('trading.history.empty')}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
                <div className="flex items-center justify-between mt-4">
                  <span className="text-xs text-muted-foreground">
                    {t('trading.history.loadedCount', { count: orderHistoryItems.length })}
                  </span>
                  <Button
                    variant="outline"
                    disabled={!orderHistoryHasMore || orderHistoryLoading}
                    onClick={() => fetchOrderHistory()}
                  >
                    {orderHistoryLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    {t('trading.history.loadMore')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Chart Tab - Gráfico de Candlesticks */}
          <TabsContent value="chart" className="space-y-4 mt-6">
            <CandleChart
              data={klines}
              symbol={selectedSymbol}
              interval={selectedInterval}
              intervalOptions={intervalOptions}
              symbolOptions={symbolOptions}
              onSymbolChange={setSelectedSymbol}
              currentPrice={currentPrice}
              isLoading={isLoadingKlines}
              onIntervalChange={handleIntervalChange}
              onRefresh={() => refetchKlines()}
              height={500}
              showVolume={true}
              locale={locale}
              timeZone={timeZone}
            />
          </TabsContent>

          {/* Order Book Tab - Profundidade de Mercado */}
          <TabsContent value="orderbook" className="space-y-4 mt-6">
            <OrderBookViz
              data={orderBookData}
              symbol={selectedSymbol}
              currentPrice={currentPrice}
              isLoading={isLoadingOrderBook}
              depth={orderBookDepth ?? undefined}
              precision={orderBookPrecision ?? undefined}
              locale={locale}
            />
          </TabsContent>

          {/* Control Tab - Handover/Takeover */}
          <TabsContent value="control" className="space-y-4 mt-6">
            <HandoverPanel
              currentMode={controlMode}
              tradingEnabled={riskConfig?.tradingEnabled || false}
              circuitBreakerOpen={status.circuitBreaker.state === 'open'}
              history={controlHistory}
              isLoading={isLoadingControlHistory}
              onModeChange={handleModeChange}
              onTradingToggle={handleTradingToggle}
            />
          </TabsContent>

          {/* Account Management Tab - Gestão Completa da Conta KuCoin */}
          <TabsContent value="account" className="space-y-6 mt-6">
            {/* Visão geral da conta e API key */}
            <AccountOverview onRefresh={() => {
              queryClient.invalidateQueries({ queryKey: ['account'] });
            }} />

            {/* Depósitos e Withdrawals */}
            <DepositWithdraw defaultCurrency="USDT" />

            {/* Transferências entre contas */}
            <TransferPanel defaultCurrency="USDT" />

            {/* Sub-contas */}
            <SubAccountsPanel />

            {/* Histórico de Ledgers */}
            <LedgerHistory />

            {/* Taxas de Trading */}
            <TradeFees defaultFuturesSymbol={selectedSymbol} />
          </TabsContent>
        </Tabs>
      </motion.div>

      {/* ================================================================== */}
      {/* DIALOGS */}
      {/* ================================================================== */}

      {/* New Order Dialog - Estilo Exchange Real */}
      <Dialog open={showNewOrderDialog} onOpenChange={setShowNewOrderDialog}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="h-5 w-5" />
              {t('trading.orders.newDialog.title')}
            </DialogTitle>
            <DialogDescription>
              {t('trading.orders.newDialog.subtitle')}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[70vh] pr-4">
            <div className="space-y-4 py-2">
              {/* Cotação em Tempo Real (topo do diálogo como exchanges reais) */}
              {currentPrice > 0 && (
                <div className="p-3 bg-muted rounded-lg space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lg">{selectedSymbol || defaultSymbol}</span>
                      <Badge variant="outline" className="text-xs">{selectedMarketType}</Badge>
                    </div>
                    {wsEnabled && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <Activity className="h-3 w-3 text-green-500" />
                        {t('trading.status.liveLabel')}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold tabular-nums">
                      ${formatNumber(currentPrice, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    {priceChange !== 0 && (
                      <span className={`text-sm ${priceChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {priceChange >= 0 ? '+' : ''}{(priceChangePercent * 100).toFixed(2)}%
                      </span>
                    )}
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>Máx: ${formatNumber(market?.contract?.highPrice || 0, locale, { minimumFractionDigits: 2 })}</span>
                    <span>Mín: ${formatNumber(market?.contract?.lowPrice || 0, locale, { minimumFractionDigits: 2 })}</span>
                    <span>Vol: {formatNumber(market?.contract?.volumeOf24h || 0, locale, { maximumFractionDigits: 0 })}</span>
                  </div>
                </div>
              )}

              {/* Lado: Comprar / Vender (botões grandes como KuCoin) */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={orderForm.side === 'buy' ? 'default' : 'outline'}
                  className={orderForm.side === 'buy' ? 'bg-green-600 hover:bg-green-700 h-12' : 'h-12'}
                  onClick={() => setOrderForm({ ...orderForm, side: 'buy' })}
                >
                  <TrendingUp className="h-4 w-4 mr-2" />
                  {t('trading.orders.buy')}
                </Button>
                <Button
                  type="button"
                  variant={orderForm.side === 'sell' ? 'default' : 'outline'}
                  className={orderForm.side === 'sell' ? 'bg-red-600 hover:bg-red-700 h-12' : 'h-12'}
                  onClick={() => setOrderForm({ ...orderForm, side: 'sell' })}
                >
                  <TrendingDown className="h-4 w-4 mr-2" />
                  {t('trading.orders.sell')}
                </Button>
              </div>

              {/* Tipo de Ordem */}
              <div className="space-y-2">
                <Label>{t('trading.orders.form.orderType')}</Label>
                <Select
                  value={orderForm.orderType}
                  onValueChange={(value: 'limit' | 'market') => setOrderForm({ ...orderForm, orderType: value })}
                >
                  <SelectTrigger data-testid="select-order-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="market">{t('trading.orders.form.market')}</SelectItem>
                    <SelectItem value="limit">{t('trading.orders.form.limit')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Preço (apenas limit) */}
              {orderForm.orderType === 'limit' && (
                <div className="space-y-2">
                  <Label>{t('trading.orders.form.price')}</Label>
                  <Input
                    type="number"
                    placeholder={currentPrice > 0 ? currentPrice.toString() : '0'}
                    value={orderForm.price}
                    onChange={(e) => setOrderForm({ ...orderForm, price: e.target.value })}
                    data-testid="input-order-price"
                  />
                </div>
              )}

              {/* Quantidade (contratos) */}
              <div className="space-y-2">
                <Label>
                  {isFuturesMarket
                    ? t('trading.orders.form.sizeContracts')
                    : t('trading.orders.form.sizeAmount')}
                </Label>
                <Input
                  type="number"
                  placeholder="1"
                  value={orderForm.size}
                  onChange={(e) => isFuturesMarket ? handleOrderSizeChange(e.target.value) : setOrderForm({ ...orderForm, size: e.target.value })}
                  data-testid="input-order-size"
                />
                <p className="text-xs text-muted-foreground">
                  {isFuturesMarket
                    ? t('trading.orders.form.sizeHint', { symbol: selectedSymbol || defaultSymbol })
                    : t('trading.orders.form.sizeSpotHint')}
                </p>
              </div>

              {/* Valor em USDT (conversão automática - apenas Futures) */}
              {isFuturesMarket && (
                <div className="space-y-2">
                  <Label>Valor em USDT</Label>
                  <Input
                    type="number"
                    placeholder="100.00"
                    value={orderForm.usdtAmount}
                    onChange={(e) => handleOrderUsdtChange(e.target.value)}
                    data-testid="input-order-usdt"
                  />
                  <p className="text-xs text-muted-foreground">
                    Preencha contratos OU valor em USDT — a conversão é automática.
                  </p>
                </div>
              )}

              {/* Funds (somente Spot/Margin e ordem a mercado de compra) */}
              {!isFuturesMarket && orderForm.orderType === 'market' && orderForm.side === 'buy' && (
                <div className="space-y-2">
                  <Label>{t('trading.orders.form.funds')}</Label>
                  <Input
                    type="number"
                    placeholder="100"
                    value={orderForm.funds}
                    onChange={(e) => setOrderForm({ ...orderForm, funds: e.target.value })}
                    data-testid="input-order-funds"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('trading.orders.form.fundsHint')}
                  </p>
                </div>
              )}

              {/* Alavancagem (apenas Futures) */}
              {isFuturesMarket && (
                <div className="space-y-2">
                  <Label>{t('trading.orders.form.leverage')}</Label>
                  <Select
                    value={orderForm.leverage}
                    onValueChange={(value) => setOrderForm({ ...orderForm, leverage: value })}
                  >
                    <SelectTrigger data-testid="select-leverage">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 5, 10, 20, 50, 100].map((lev) => (
                        <SelectItem key={lev} value={lev.toString()} disabled={lev > (riskConfig?.maxLeverage || 20)}>
                          {lev}x
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Stop Loss & Take Profit */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('trading.orders.form.stopLoss')}</Label>
                  <Input
                    type="number"
                    placeholder={t('trading.orders.form.optional')}
                    value={orderForm.stopLoss}
                    onChange={(e) => setOrderForm({ ...orderForm, stopLoss: e.target.value })}
                    data-testid="input-stop-loss"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('trading.orders.form.takeProfit')}</Label>
                  <Input
                    type="number"
                    placeholder={t('trading.orders.form.optional')}
                    value={orderForm.takeProfit}
                    onChange={(e) => setOrderForm({ ...orderForm, takeProfit: e.target.value })}
                    data-testid="input-take-profit"
                  />
                </div>
              </div>

              {/* Resumo Detalhado da Ordem (estilo exchange) */}
              {(orderForm.size || orderForm.funds) && currentPrice > 0 && (
                <Card className="bg-muted/50 border-dashed">
                  <CardContent className="p-3 space-y-2">
                    <p className="font-semibold text-sm flex items-center gap-1">
                      <BookOpen className="h-4 w-4" />
                      {t('trading.orders.form.summary')}
                    </p>
                    <Separator />
                    <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                      <span className="text-muted-foreground">Símbolo</span>
                      <span className="font-mono text-right">{selectedSymbol || defaultSymbol}</span>

                      <span className="text-muted-foreground">Direção</span>
                      <span className={`text-right font-medium ${orderForm.side === 'buy' ? 'text-green-500' : 'text-red-500'}`}>
                        {orderForm.side === 'buy' ? t('trading.orders.buying') : t('trading.orders.selling')}
                      </span>

                      <span className="text-muted-foreground">{t('trading.orders.form.orderType')}</span>
                      <span className="text-right">
                        {orderForm.orderType === 'market' ? t('trading.orders.form.market') : t('trading.orders.form.limit')}
                      </span>

                      {orderForm.size && (
                        <>
                          <span className="text-muted-foreground">Quantidade</span>
                          <span className="font-mono text-right">
                            {orderForm.size} {isFuturesMarket ? t('trading.orders.contracts') : t('trading.orders.amount')}
                          </span>
                        </>
                      )}

                      <span className="text-muted-foreground">{t('trading.orders.form.price')}</span>
                      <span className="font-mono text-right">
                        {orderForm.orderType === 'market'
                          ? `~$${formatNumber(currentPrice, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${t('trading.orders.form.marketPrice')})`
                          : `$${formatNumber(orderEffectivePrice, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </span>

                      {isFuturesMarket && orderForm.usdtAmount && (
                        <>
                          <span className="text-muted-foreground">Valor Estimado</span>
                          <span className="font-mono text-right font-medium">
                            ~${formatNumber(parseFloat(orderForm.usdtAmount), locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                          </span>
                        </>
                      )}

                      {!isFuturesMarket && orderForm.funds && (
                        <>
                          <span className="text-muted-foreground">{t('trading.orders.form.funds')}</span>
                          <span className="font-mono text-right">${orderForm.funds}</span>
                        </>
                      )}

                      {isFuturesMarket && (
                        <>
                          <span className="text-muted-foreground">{t('trading.orders.form.leverage')}</span>
                          <span className="text-right">{orderForm.leverage}x</span>

                          {orderForm.usdtAmount && (
                            <>
                              <span className="text-muted-foreground">Margem Requerida</span>
                              <span className="font-mono text-right">
                                ~${formatNumber(parseFloat(orderForm.usdtAmount) / parseInt(orderForm.leverage || '1'), locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                              </span>
                            </>
                          )}
                        </>
                      )}

                      {orderForm.stopLoss && (
                        <>
                          <span className="text-muted-foreground">{t('trading.orders.form.stopLoss')}</span>
                          <span className="font-mono text-right text-red-500">${orderForm.stopLoss}</span>
                        </>
                      )}

                      {orderForm.takeProfit && (
                        <>
                          <span className="text-muted-foreground">{t('trading.orders.form.takeProfit')}</span>
                          <span className="font-mono text-right text-green-500">${orderForm.takeProfit}</span>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowNewOrderDialog(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => createOrderMutation.mutate(orderForm)}
              disabled={!canSubmitOrder || createOrderMutation.isPending}
              className={`font-bold ${orderForm.side === 'buy' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
            >
              {createOrderMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4 mr-2" />
              )}
              {t('trading.orders.form.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* OCO Order Dialog */}
      <OcoOrderForm
        open={showOcoOrderDialog}
        onOpenChange={setShowOcoOrderDialog}
        marketType={selectedMarketType}
        symbol={selectedSymbol || defaultSymbol}
        currentPrice={currentPrice}
        marginMode={selectedMarginMode}
      />

      {/* Review Order Dialog */}
      <Dialog open={showReviewOrderDialog} onOpenChange={setShowReviewOrderDialog}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCheck className="h-5 w-5" />
              Revisar Ordem
            </DialogTitle>
            <DialogDescription>
              Ajuste os parâmetros antes da execução na KuCoin.
            </DialogDescription>
          </DialogHeader>

          {reviewOrderTarget ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select
                    value={reviewOrderForm.orderType}
                    onValueChange={(value: TradingOrder['orderType']) =>
                      setReviewOrderForm({ ...reviewOrderForm, orderType: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="market">Market</SelectItem>
                      <SelectItem value="limit">Limit</SelectItem>
                      <SelectItem value="stop_market">Stop Market</SelectItem>
                      <SelectItem value="stop_limit">Stop Limit</SelectItem>
                      <SelectItem value="take_profit">Take Profit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Quantidade</Label>
                  <Input
                    type="number"
                    value={reviewOrderForm.size}
                    onChange={(e) => setReviewOrderForm({ ...reviewOrderForm, size: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Preço</Label>
                  <Input
                    type="number"
                    value={reviewOrderForm.price}
                    onChange={(e) => setReviewOrderForm({ ...reviewOrderForm, price: e.target.value })}
                    placeholder="Mercado"
                    disabled={reviewOrderForm.orderType === 'market' || reviewOrderForm.orderType === 'stop_market' || reviewOrderForm.orderType === 'take_profit'}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Alavancagem</Label>
                  <Input
                    type="number"
                    value={reviewOrderForm.leverage}
                    onChange={(e) => setReviewOrderForm({ ...reviewOrderForm, leverage: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Stop Loss</Label>
                  <Input
                    type="number"
                    value={reviewOrderForm.stopLoss}
                    onChange={(e) => setReviewOrderForm({ ...reviewOrderForm, stopLoss: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Take Profit</Label>
                  <Input
                    type="number"
                    value={reviewOrderForm.takeProfit}
                    onChange={(e) => setReviewOrderForm({ ...reviewOrderForm, takeProfit: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Nenhuma ordem selecionada.</div>
          )}

          <DialogFooter className="pt-4">
            <Button
              variant="outline"
              onClick={() => setShowReviewOrderDialog(false)}
            >
              Cancelar
            </Button>
            {reviewOrderTarget && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (!reviewOrderTarget) return;
                    const updates = {
                      orderType: reviewOrderForm.orderType,
                      size: reviewOrderForm.size ? Number(reviewOrderForm.size) : undefined,
                      price: reviewOrderForm.price ? Number(reviewOrderForm.price) : undefined,
                      leverage: reviewOrderForm.leverage ? Number(reviewOrderForm.leverage) : undefined,
                      stopLoss: reviewOrderForm.stopLoss ? Number(reviewOrderForm.stopLoss) : undefined,
                      takeProfit: reviewOrderForm.takeProfit ? Number(reviewOrderForm.takeProfit) : undefined,
                    };
                    updateReviewOrderMutation.mutate({ orderId: reviewOrderTarget.id, updates });
                  }}
                  disabled={updateReviewOrderMutation.isPending}
                >
                  Salvar ajustes
                </Button>
                <Button
                  onClick={() => approveReviewOrderMutation.mutate(reviewOrderTarget.id)}
                  disabled={approveReviewOrderMutation.isPending}
                >
                  Aprovar e Executar
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Risk Config Dialog */}
      <Dialog open={showRiskConfigDialog} onOpenChange={setShowRiskConfigDialog}>
        <DialogContent className="sm:max-w-[600px] h-[85vh] max-h-[85vh] overflow-hidden flex flex-col min-h-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              {t('trading.riskConfig.title')}
            </DialogTitle>
            <DialogDescription>
              {t('trading.riskConfig.subtitle')}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 min-h-0 -mx-1 px-1">
            <div className="space-y-6 py-4">
            {/* Trading Controls */}
            <div className="space-y-4">
              <h4 className="font-medium">{t('trading.riskConfig.controls')}</h4>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>{t('trading.riskConfig.tradingEnabled')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('trading.riskConfig.tradingEnabledDesc')}
                  </p>
                </div>
                <Switch
                  checked={riskForm.tradingEnabled}
                  onCheckedChange={(checked) => setRiskForm({ ...riskForm, tradingEnabled: checked })}
                  data-testid="switch-trading-enabled"
                />
              </div>

            </div>

            <Separator />

            {/* Risk Limits */}
            <div className="space-y-4">
              <h4 className="font-medium">{t('trading.riskConfig.limits')}</h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('trading.riskConfig.maxPositionSize')}</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={riskForm.maxPositionSize}
                      onChange={(e) => setRiskForm({ ...riskForm, maxPositionSize: e.target.value })}
                      className="pr-8"
                      data-testid="input-max-position-size"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t('trading.riskConfig.maxDailyLoss')}</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={riskForm.maxDailyLoss}
                      onChange={(e) => setRiskForm({ ...riskForm, maxDailyLoss: e.target.value })}
                      className="pr-8"
                      data-testid="input-max-daily-loss"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t('trading.riskConfig.maxOrderValue')}</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={riskForm.maxOrderValue}
                      onChange={(e) => setRiskForm({ ...riskForm, maxOrderValue: e.target.value })}
                      className="pl-8"
                      data-testid="input-max-order-value"
                    />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t('trading.riskConfig.maxLeverage')}</Label>
                  <Select
                    value={riskForm.maxLeverage.toString()}
                    onValueChange={(value) => setRiskForm({ ...riskForm, maxLeverage: parseInt(value) })}
                  >
                    <SelectTrigger data-testid="select-max-leverage">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[5, 10, 20, 50, 100].map((lev) => (
                        <SelectItem key={lev} value={lev.toString()}>
                          {lev}x
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t('trading.riskConfig.maxOpenPositions')}</Label>
                  <Input
                    type="number"
                    value={riskForm.maxOpenPositions}
                    onChange={(e) => setRiskForm({ ...riskForm, maxOpenPositions: parseInt(e.target.value) || 1 })}
                    min={1}
                    max={10}
                    data-testid="input-max-open-positions"
                  />
                </div>

              </div>
            </div>

            <Separator />

            {/* Defaults */}
            <div className="space-y-4">
              <h4 className="font-medium">{t('trading.riskConfig.defaults')}</h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('trading.riskConfig.defaultLeverage')}</Label>
                  <Select
                    value={riskForm.defaultLeverage.toString()}
                    onValueChange={(value) => setRiskForm({ ...riskForm, defaultLeverage: parseInt(value) })}
                  >
                    <SelectTrigger data-testid="select-default-leverage">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 5, 10, 20].map((lev) => (
                        <SelectItem key={lev} value={lev.toString()} disabled={lev > riskForm.maxLeverage}>
                          {lev}x
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('trading.riskConfig.defaultSymbol')}</Label>
                  <Select
                    value={riskForm.defaultSymbol}
                    onValueChange={(value) => setRiskForm({ ...riskForm, defaultSymbol: value })}
                    disabled={symbolOptions.length === 0}
                  >
                    <SelectTrigger data-testid="select-default-symbol">
                      <SelectValue placeholder={t('trading.riskConfig.defaultSymbolPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent className="max-h-60 overflow-y-auto">
                      {symbolOptions.map((symbol) => (
                        <SelectItem key={symbol} value={symbol}>
                          {symbol}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('trading.riskConfig.defaultMarketType')}</Label>
                  <Select
                    value={riskForm.defaultMarketType}
                    onValueChange={(value: 'futures' | 'spot' | 'margin') =>
                      setRiskForm({ ...riskForm, defaultMarketType: value })
                    }
                  >
                    <SelectTrigger data-testid="select-default-market-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="futures">{t('trading.marketType.futures')}</SelectItem>
                      <SelectItem value="spot">{t('trading.marketType.spot')}</SelectItem>
                      <SelectItem value="margin">{t('trading.marketType.margin')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('trading.riskConfig.marginMode')}</Label>
                  <Select
                    value={riskForm.marginMode}
                    onValueChange={(value: 'cross' | 'isolated') => setRiskForm({ ...riskForm, marginMode: value })}
                    disabled={riskForm.defaultMarketType !== 'margin'}
                  >
                    <SelectTrigger data-testid="select-default-margin-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cross">{t('trading.marginMode.cross')}</SelectItem>
                      <SelectItem value="isolated">{t('trading.marginMode.isolated')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
          </ScrollArea>

          <DialogFooter className="pt-4">
            <Button
              variant="outline"
              onClick={() => setShowRiskConfigDialog(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => updateRiskConfigMutation.mutate(riskForm)}
              disabled={updateRiskConfigMutation.isPending}
            >
              {updateRiskConfigMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-2" />
              )}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Signal Dialog */}
      <Dialog open={showNewSignalDialog} onOpenChange={setShowNewSignalDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              {t('trading.signals.newDialog.title')}
            </DialogTitle>
            <DialogDescription>
              {t('trading.signals.newDialog.subtitle')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Signal Type */}
            <div className="space-y-2">
              <Label>{t('trading.signals.form.type')}</Label>
              <Select
                value={signalForm.signalType}
                onValueChange={(value: typeof signalForm.signalType) => setSignalForm({ ...signalForm, signalType: value })}
              >
                <SelectTrigger data-testid="select-signal-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIGNAL_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      <div className="flex items-center gap-2">
                        <type.icon className={`h-4 w-4 ${type.color}`} />
                        {type.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Confidence */}
            <div className="space-y-2">
              <Label>{t('trading.signals.form.confidence')}</Label>
              <div className="relative">
                <Input
                  type="number"
                  value={(parseFloat(signalForm.confidence) * 100).toString()}
                  onChange={(e) => setSignalForm({ ...signalForm, confidence: (parseFloat(e.target.value) / 100).toString() })}
                  min={50}
                  max={100}
                  className="pr-8"
                  data-testid="input-signal-confidence"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all duration-300" 
                  style={{ width: `${parseFloat(signalForm.confidence) * 100}%` }}
                />
              </div>
            </div>

            {/* Reasoning */}
            <div className="space-y-2">
              <Label>{t('trading.signals.form.reasoning')}</Label>
              <Input
                placeholder={t('trading.signals.form.reasoningPlaceholder')}
                value={signalForm.reasoning}
                onChange={(e) => setSignalForm({ ...signalForm, reasoning: e.target.value })}
                data-testid="input-signal-reasoning"
              />
              <p className="text-xs text-muted-foreground">
                {t('trading.signals.form.reasoningHint')}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowNewSignalDialog(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => createSignalMutation.mutate(signalForm)}
              disabled={createSignalMutation.isPending}
            >
              {createSignalMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              {t('trading.signals.form.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
                