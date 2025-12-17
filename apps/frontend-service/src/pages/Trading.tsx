/**
 * Trading - Página de Trading BTC Futures KuCoin
 * 
 * Dashboard enterprise-grade para trading automatizado de BTC perpetuals
 * na KuCoin Futures. Integrado com Alice IA (Mixtral 8x7B) para sinais
 * autônomos e execução automática de ordens.
 * 
 * Funcionalidades:
 * - Visualização em tempo real de dados de mercado
 * - Gestão de ordens (criar, cancelar, sincronizar)
 * - Monitoramento de posições abertas
 * - Configuração de gestão de risco
 * - Sinais de trading do Mixtral LLM
 * - Histórico completo de operações com auditoria
 * - Execução autônoma via Alice (Chat/WhatsApp)
 * 
 * Regra 6 - SEM MOCKS: Apenas dados reais da API KuCoin
 * Regra 10 - Documentação PT-BR
 * Regra 13 - Internacionalização i18next
 * 
 * Autor: Fillipe Guerra
 * Data: 17 de Dezembro de 2025
 */

import { useState, useEffect } from 'react';
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
  Bot,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  Eye,
  Edit,
  Trash2,
  Rocket,
  Brain,
  LineChart,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { apiRequest, queryClient } from '@/lib/queryClient';

// ============================================================================
// TIPOS (TypeScript strict - Regra 8)
// ============================================================================

interface TradingStatus {
  isConfigured: boolean;
  isSandbox: boolean;
  circuitBreaker: {
    state: string;
    failures: number;
    successes: number;
  };
  riskConfig: RiskConfig | null;
  activeSignals: number;
  pendingOrders: number;
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
  defaultStopLoss: string | null;
  defaultTakeProfit: string | null;
  tradingEnabled: boolean;
  autoExecuteSignals: boolean;
  minConfidenceToExecute: string;
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

interface AccountOverview {
  accountEquity: number;
  unrealisedPNL: number;
  marginBalance: number;
  positionMargin: number;
  orderMargin: number;
  frozenFunds: number;
  availableBalance: number;
  currency: string;
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

interface TradingSignal {
  id: string;
  tenantId: string;
  signalType: 'long' | 'short' | 'close_long' | 'close_short' | 'hold';
  symbol: string;
  confidence: string;
  reasoning: string | null;
  sourceModel: string;
  metadata: Record<string, unknown>;
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
  orderType: 'limit' | 'market';
  status: 'pending' | 'open' | 'filled' | 'cancelled' | 'rejected' | 'expired';
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

// ============================================================================
// CONSTANTES
// ============================================================================

const SYMBOLS = [
  { value: 'XBTUSDTM', label: 'BTC/USDT Perpetual' },
  { value: 'XBTUSDM', label: 'BTC/USD Perpetual' },
];

const SIGNAL_TYPES = [
  { value: 'long', label: 'Long (Compra)', icon: TrendingUp, color: 'text-green-500' },
  { value: 'short', label: 'Short (Venda)', icon: TrendingDown, color: 'text-red-500' },
  { value: 'close_long', label: 'Fechar Long', icon: XCircle, color: 'text-yellow-500' },
  { value: 'close_short', label: 'Fechar Short', icon: XCircle, color: 'text-yellow-500' },
  { value: 'hold', label: 'Manter', icon: Pause, color: 'text-gray-500' },
];

const ORDER_STATUS_BADGES: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof CheckCircle }> = {
  pending: { variant: 'secondary', icon: Clock },
  open: { variant: 'outline', icon: Activity },
  filled: { variant: 'default', icon: CheckCircle },
  cancelled: { variant: 'destructive', icon: XCircle },
  rejected: { variant: 'destructive', icon: AlertCircle },
  expired: { variant: 'secondary', icon: Clock },
};

// Animações Framer Motion
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { type: 'spring', stiffness: 100, damping: 15 },
  },
};

// ============================================================================
// COMPONENTES AUXILIARES
// ============================================================================

function PriceDisplay({ price, change, changePercent }: { price: number; change: number; changePercent: number }) {
  const isPositive = change >= 0;
  
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-3xl font-bold tabular-nums">
        ${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <div className={`flex items-center gap-1 text-sm ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
        {isPositive ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
        <span>{isPositive ? '+' : ''}{change.toFixed(2)}</span>
        <span>({isPositive ? '+' : ''}{(changePercent * 100).toFixed(2)}%)</span>
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
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedSymbol, setSelectedSymbol] = useState('XBTUSDTM');
  const [showNewOrderDialog, setShowNewOrderDialog] = useState(false);
  const [showRiskConfigDialog, setShowRiskConfigDialog] = useState(false);
  const [showNewSignalDialog, setShowNewSignalDialog] = useState(false);
  
  // Form state para nova ordem
  const [orderForm, setOrderForm] = useState({
    side: 'buy' as 'buy' | 'sell',
    orderType: 'market' as 'limit' | 'market',
    size: '',
    price: '',
    leverage: '10',
    stopLoss: '',
    takeProfit: '',
  });

  // Form state para configuração de risco
  const [riskForm, setRiskForm] = useState({
    maxPositionSize: '10',
    maxDailyLoss: '5',
    maxOrderValue: '10000',
    maxLeverage: 20,
    maxOpenPositions: 3,
    defaultLeverage: 10,
    tradingEnabled: false,
    autoExecuteSignals: false,
    minConfidenceToExecute: '0.8',
  });

  // Form state para novo sinal
  const [signalForm, setSignalForm] = useState({
    signalType: 'long' as 'long' | 'short' | 'close_long' | 'close_short' | 'hold',
    confidence: '0.85',
    reasoning: '',
  });

  // ============================================================================
  // QUERIES
  // ============================================================================

  const { data: statusData, isLoading: isLoadingStatus, refetch: refetchStatus } = useQuery<{ success: boolean; data: TradingStatus }>({
    queryKey: ['/api/integrations/trading/status'],
    refetchInterval: 30000, // Atualizar a cada 30 segundos
  });

  const { data: marketData, isLoading: isLoadingMarket, refetch: refetchMarket } = useQuery<{ success: boolean; data: MarketData }>({
    queryKey: ['/api/integrations/trading/market', selectedSymbol],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/integrations/trading/market/${selectedSymbol}`);
      return res.json();
    },
    refetchInterval: 5000, // Atualizar a cada 5 segundos
    enabled: statusData?.data?.isConfigured,
  });

  const { data: accountData, isLoading: isLoadingAccount, refetch: refetchAccount } = useQuery<{ success: boolean; data: AccountOverview }>({
    queryKey: ['/api/integrations/trading/account'],
    refetchInterval: 10000,
    enabled: statusData?.data?.isConfigured,
  });

  const { data: positionsData, isLoading: isLoadingPositions, refetch: refetchPositions } = useQuery<{ success: boolean; data: Position[] }>({
    queryKey: ['/api/integrations/trading/positions'],
    refetchInterval: 10000,
    enabled: statusData?.data?.isConfigured,
  });

  const { data: signalsData, isLoading: isLoadingSignals, refetch: refetchSignals } = useQuery<{ success: boolean; data: TradingSignal[] }>({
    queryKey: ['/api/integrations/trading/signals'],
    refetchInterval: 15000,
  });

  const { data: ordersData, isLoading: isLoadingOrders, refetch: refetchOrders } = useQuery<{ success: boolean; data: TradingOrder[] }>({
    queryKey: ['/api/integrations/trading/orders'],
    refetchInterval: 10000,
  });

  const { data: riskConfigData, refetch: refetchRiskConfig } = useQuery<{ success: boolean; data: RiskConfig | null }>({
    queryKey: ['/api/integrations/trading/risk-config'],
  });

  // Atualizar form de risco quando dados carregarem
  useEffect(() => {
    if (riskConfigData?.data) {
      const config = riskConfigData.data;
      setRiskForm({
        maxPositionSize: config.maxPositionSize || '10',
        maxDailyLoss: config.maxDailyLoss || '5',
        maxOrderValue: config.maxOrderValue || '10000',
        maxLeverage: config.maxLeverage || 20,
        maxOpenPositions: config.maxOpenPositions || 3,
        defaultLeverage: config.defaultLeverage || 10,
        tradingEnabled: config.tradingEnabled || false,
        autoExecuteSignals: config.autoExecuteSignals || false,
        minConfidenceToExecute: config.minConfidenceToExecute || '0.8',
      });
    }
  }, [riskConfigData]);

  // ============================================================================
  // MUTATIONS
  // ============================================================================

  const createOrderMutation = useMutation({
    mutationFn: async (data: typeof orderForm) => {
      const res = await apiRequest('POST', '/api/integrations/trading/orders', {
        symbol: selectedSymbol,
        side: data.side,
        orderType: data.orderType,
        size: parseFloat(data.size),
        price: data.orderType === 'limit' ? parseFloat(data.price) : undefined,
        leverage: parseInt(data.leverage),
        stopLoss: data.stopLoss ? parseFloat(data.stopLoss) : undefined,
        takeProfit: data.takeProfit ? parseFloat(data.takeProfit) : undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: t('trading.success.orderCreated'),
        description: t('trading.success.orderCreatedDesc'),
      });
      setShowNewOrderDialog(false);
      setOrderForm({
        side: 'buy',
        orderType: 'market',
        size: '',
        price: '',
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
      const res = await apiRequest('PUT', '/api/integrations/trading/risk-config', {
        maxPositionSize: data.maxPositionSize,
        maxDailyLoss: data.maxDailyLoss,
        maxOrderValue: data.maxOrderValue,
        maxLeverage: data.maxLeverage,
        maxOpenPositions: data.maxOpenPositions,
        defaultLeverage: data.defaultLeverage,
        tradingEnabled: data.tradingEnabled,
        autoExecuteSignals: data.autoExecuteSignals,
        minConfidenceToExecute: data.minConfidenceToExecute,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: t('trading.success.riskConfigUpdated'),
      });
      setShowRiskConfigDialog(false);
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

  const createSignalMutation = useMutation({
    mutationFn: async (data: typeof signalForm) => {
      const res = await apiRequest('POST', '/api/integrations/trading/signals', {
        signalType: data.signalType,
        symbol: selectedSymbol,
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
        signalType: 'long',
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
  };

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
  // RENDER - Not Configured State
  // ============================================================================

  if (!statusData?.data?.isConfigured) {
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
              <p>KUCOIN_PRO_API_KEY</p>
              <p>KUCOIN_PRO_API_SECRET</p>
              <p>KUCOIN_PRO_API_PASSPHRASE</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============================================================================
  // DADOS EXTRAÍDOS
  // ============================================================================

  const status = statusData.data;
  const market = marketData?.data;
  const account = accountData?.data;
  const positions = positionsData?.data || [];
  const signals = signalsData?.data || [];
  const orders = ordersData?.data || [];
  const riskConfig = riskConfigData?.data;

  const currentPrice = market?.contract?.lastTradePrice || 0;
  const priceChange = market?.contract?.priceChg || 0;
  const priceChangePercent = market?.contract?.priceChgPct || 0;

  // ============================================================================
  // RENDER - Main
  // ============================================================================

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="p-6 space-y-6"
    >
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
            {status.isSandbox && (
              <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Sandbox
              </Badge>
            )}
            
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

            {riskConfig?.autoExecuteSignals && (
              <Badge variant="outline" className="text-blue-600 border-blue-600">
                <Bot className="h-3 w-3 mr-1" />
                {t('trading.status.autoExecute')}
              </Badge>
            )}

            {/* Symbol Selector */}
            <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
              <SelectTrigger className="w-[180px]" data-testid="select-symbol">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SYMBOLS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

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
                <Badge variant="outline" className="text-xs">
                  {t('trading.market.live')}
                </Badge>
              </div>
              {isLoadingMarket ? (
                <Skeleton className="h-10 w-64" />
              ) : (
                <PriceDisplay 
                  price={currentPrice} 
                  change={priceChange} 
                  changePercent={priceChangePercent} 
                />
              )}
              <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
                <div>
                  <p className="text-muted-foreground">{t('trading.market.high24h')}</p>
                  <p className="font-medium">${market?.contract?.highPrice?.toLocaleString() || '-'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('trading.market.low24h')}</p>
                  <p className="font-medium">${market?.contract?.lowPrice?.toLocaleString() || '-'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('trading.market.volume24h')}</p>
                  <p className="font-medium">{market?.contract?.volumeOf24h?.toLocaleString() || '-'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Saldo Disponível */}
          <StatCard
            title={t('trading.account.availableBalance')}
            value={isLoadingAccount ? '-' : `$${account?.availableBalance?.toLocaleString() || '0'}`}
            subtitle={account?.currency}
            icon={DollarSign}
            isLoading={isLoadingAccount}
          />

          {/* PnL Não Realizado */}
          <StatCard
            title={t('trading.account.unrealisedPnl')}
            value={isLoadingAccount ? '-' : `$${account?.unrealisedPNL?.toFixed(2) || '0'}`}
            subtitle={t('trading.account.allPositions')}
            icon={account?.unrealisedPNL && account.unrealisedPNL >= 0 ? TrendingUp : TrendingDown}
            trend={account?.unrealisedPNL && account.unrealisedPNL >= 0 ? 'up' : 'down'}
            isLoading={isLoadingAccount}
          />
        </div>
      </motion.div>

      {/* Stats Row 2 */}
      <motion.div variants={itemVariants}>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <StatCard
            title={t('trading.stats.activeSignals')}
            value={status.activeSignals}
            icon={Zap}
          />
          <StatCard
            title={t('trading.stats.pendingOrders')}
            value={status.pendingOrders}
            icon={Clock}
          />
          <StatCard
            title={t('trading.stats.openPositions')}
            value={positions.filter(p => p.isOpen).length}
            icon={Activity}
          />
          <StatCard
            title={t('trading.stats.fundingRate')}
            value={`${((market?.contract?.fundingFeeRate || 0) * 100).toFixed(4)}%`}
            icon={Percent}
          />
          <StatCard
            title={t('trading.stats.maxLeverage')}
            value={`${riskConfig?.maxLeverage || 20}x`}
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

      {/* Main Tabs */}
      <motion.div variants={itemVariants}>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview" data-testid="tab-overview">
              <BarChart3 className="h-4 w-4 mr-2" />
              {t('trading.tabs.overview')}
            </TabsTrigger>
            <TabsTrigger value="orders" data-testid="tab-orders">
              <Activity className="h-4 w-4 mr-2" />
              {t('trading.tabs.orders')}
            </TabsTrigger>
            <TabsTrigger value="positions" data-testid="tab-positions">
              <Target className="h-4 w-4 mr-2" />
              {t('trading.tabs.positions')}
            </TabsTrigger>
            <TabsTrigger value="signals" data-testid="tab-signals">
              <Brain className="h-4 w-4 mr-2" />
              {t('trading.tabs.signals')}
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">
              <History className="h-4 w-4 mr-2" />
              {t('trading.tabs.history')}
            </TabsTrigger>
          </TabsList>

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
                        ${(parseFloat(market?.ticker?.bestAskPrice || '0') - parseFloat(market?.ticker?.bestBidPrice || '0')).toFixed(2)}
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
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('trading.account.equity')}</span>
                        <span className="font-medium">${account?.accountEquity?.toLocaleString() || '0'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('trading.account.marginBalance')}</span>
                        <span className="font-medium">${account?.marginBalance?.toLocaleString() || '0'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('trading.account.positionMargin')}</span>
                        <span className="font-medium">${account?.positionMargin?.toLocaleString() || '0'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('trading.account.orderMargin')}</span>
                        <span className="font-medium">${account?.orderMargin?.toLocaleString() || '0'}</span>
                      </div>
                      <Separator />
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('trading.account.frozenFunds')}</span>
                        <span className="font-medium">${account?.frozenFunds?.toLocaleString() || '0'}</span>
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
                                  {t('trading.signals.confidence')}: {(parseFloat(signal.confidence) * 100).toFixed(0)}%
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {signal.sourceModel}
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
                                <p className="text-sm font-medium">{order.size} @ ${order.price}</p>
                                <p className="text-xs text-muted-foreground">{order.symbol}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <OrderStatusBadge status={order.status} />
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
                        <TableCell>${parseFloat(order.price).toLocaleString()}</TableCell>
                        <TableCell>
                          {order.filledSize || '0'} / {order.size}
                        </TableCell>
                        <TableCell><OrderStatusBadge status={order.status} /></TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {new Date(order.criadoEm).toLocaleString('pt-BR')}
                        </TableCell>
                        <TableCell>
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchPositions()}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('common.refresh')}
              </Button>
            </div>

            {isLoadingPositions ? (
              <Skeleton className="h-64" />
            ) : positions.filter(p => p.isOpen).length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Target className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">{t('trading.positions.noPositions')}</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {positions.filter(p => p.isOpen).map((position) => (
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
                          <p className="font-medium">${position.avgEntryPrice.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t('trading.positions.markPrice')}</p>
                          <p className="font-medium">${position.markPrice.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t('trading.positions.liquidationPrice')}</p>
                          <p className="font-medium text-red-500">${position.liquidationPrice.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t('trading.positions.margin')}</p>
                          <p className="font-medium">${position.posMargin.toFixed(2)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
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
                      <TableHead>{t('trading.signals.table.confidence')}</TableHead>
                      <TableHead>{t('trading.signals.table.source')}</TableHead>
                      <TableHead>{t('trading.signals.table.reasoning')}</TableHead>
                      <TableHead>{t('trading.signals.table.created')}</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {signals.map((signal) => (
                      <TableRow key={signal.id} data-testid={`row-signal-${signal.id}`}>
                        <TableCell><SignalTypeBadge type={signal.signalType} /></TableCell>
                        <TableCell>{signal.symbol}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-primary" 
                                style={{ width: `${parseFloat(signal.confidence) * 100}%` }}
                              />
                            </div>
                            <span className="text-sm">{(parseFloat(signal.confidence) * 100).toFixed(0)}%</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{signal.sourceModel}</Badge>
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
                          {new Date(signal.criadoEm).toLocaleString('pt-BR')}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deactivateSignalMutation.mutate(signal.id)}
                            data-testid={`button-deactivate-signal-${signal.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-4 mt-6">
            <Card>
              <CardHeader>
                <CardTitle>{t('trading.history.title')}</CardTitle>
                <CardDescription>{t('trading.history.subtitle')}</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingOrders ? (
                  <Skeleton className="h-64" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
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
                      {orders
                        .filter(o => o.status === 'filled' || o.status === 'cancelled' || o.status === 'expired')
                        .map((order) => (
                          <TableRow key={order.id}>
                            <TableCell className="text-muted-foreground">
                              {new Date(order.criadoEm).toLocaleString('pt-BR')}
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
                            <TableCell>${parseFloat(order.avgFilledPrice || order.price).toLocaleString()}</TableCell>
                            <TableCell><OrderStatusBadge status={order.status} /></TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </motion.div>

      {/* ================================================================== */}
      {/* DIALOGS */}
      {/* ================================================================== */}

      {/* New Order Dialog */}
      <Dialog open={showNewOrderDialog} onOpenChange={setShowNewOrderDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="h-5 w-5" />
              {t('trading.orders.newDialog.title')}
            </DialogTitle>
            <DialogDescription>
              {t('trading.orders.newDialog.subtitle')}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Side */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={orderForm.side === 'buy' ? 'default' : 'outline'}
                className={orderForm.side === 'buy' ? 'bg-green-600 hover:bg-green-700' : ''}
                onClick={() => setOrderForm({ ...orderForm, side: 'buy' })}
              >
                <TrendingUp className="h-4 w-4 mr-2" />
                {t('trading.orders.buy')}
              </Button>
              <Button
                type="button"
                variant={orderForm.side === 'sell' ? 'default' : 'outline'}
                className={orderForm.side === 'sell' ? 'bg-red-600 hover:bg-red-700' : ''}
                onClick={() => setOrderForm({ ...orderForm, side: 'sell' })}
              >
                <TrendingDown className="h-4 w-4 mr-2" />
                {t('trading.orders.sell')}
              </Button>
            </div>

            {/* Order Type */}
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

            {/* Size */}
            <div className="space-y-2">
              <Label>{t('trading.orders.form.size')}</Label>
              <Input
                type="number"
                placeholder="1"
                value={orderForm.size}
                onChange={(e) => setOrderForm({ ...orderForm, size: e.target.value })}
                data-testid="input-order-size"
              />
              <p className="text-xs text-muted-foreground">
                {t('trading.orders.form.sizeHint')}
              </p>
            </div>

            {/* Price (only for limit) */}
            {orderForm.orderType === 'limit' && (
              <div className="space-y-2">
                <Label>{t('trading.orders.form.price')}</Label>
                <Input
                  type="number"
                  placeholder={currentPrice.toString()}
                  value={orderForm.price}
                  onChange={(e) => setOrderForm({ ...orderForm, price: e.target.value })}
                  data-testid="input-order-price"
                />
              </div>
            )}

            {/* Leverage */}
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

            {/* Order Summary */}
            {orderForm.size && (
              <Card className="bg-muted/50">
                <CardContent className="p-3 text-sm">
                  <p className="font-medium mb-2">{t('trading.orders.form.summary')}</p>
                  <div className="space-y-1 text-muted-foreground">
                    <p>{orderForm.side === 'buy' ? t('trading.orders.buying') : t('trading.orders.selling')} {orderForm.size} {t('trading.orders.contracts')}</p>
                    <p>{t('trading.orders.form.at')} {orderForm.orderType === 'market' ? t('trading.orders.form.marketPrice') : `$${orderForm.price || currentPrice}`}</p>
                    <p>{t('trading.orders.form.withLeverage')} {orderForm.leverage}x</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowNewOrderDialog(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => createOrderMutation.mutate(orderForm)}
              disabled={!orderForm.size || createOrderMutation.isPending}
              className={orderForm.side === 'buy' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}
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

      {/* Risk Config Dialog */}
      <Dialog open={showRiskConfigDialog} onOpenChange={setShowRiskConfigDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              {t('trading.riskConfig.title')}
            </DialogTitle>
            <DialogDescription>
              {t('trading.riskConfig.subtitle')}
            </DialogDescription>
          </DialogHeader>

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

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>{t('trading.riskConfig.autoExecute')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('trading.riskConfig.autoExecuteDesc')}
                  </p>
                </div>
                <Switch
                  checked={riskForm.autoExecuteSignals}
                  onCheckedChange={(checked) => setRiskForm({ ...riskForm, autoExecuteSignals: checked })}
                  data-testid="switch-auto-execute"
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

                <div className="space-y-2">
                  <Label>{t('trading.riskConfig.minConfidence')}</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      value={(parseFloat(riskForm.minConfidenceToExecute) * 100).toString()}
                      onChange={(e) => setRiskForm({ ...riskForm, minConfidenceToExecute: (parseFloat(e.target.value) / 100).toString() })}
                      min={50}
                      max={100}
                      className="pr-8"
                      data-testid="input-min-confidence"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                  </div>
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
              </div>
            </div>
          </div>

          <DialogFooter>
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
                