/**
 * Demo Trading - Página de Trading Simulado com Dados Reais
 * 
 * Permite operar em modo demo com preços reais da KuCoin.
 * Balances infinitos auditáveis, ordens simuladas com slippage/fees,
 * posições com PnL em tempo real, e post-mortem automático no fechamento.
 * 
 * NUNCA executa ordens reais - total isolamento.
 * 
 * Dados de mercado (cotações, símbolos, preços) são consumidos em tempo real
 * via WebSocket (fonte ÚNICA) — mesma infraestrutura da página Trading Real.
 * REST é usado apenas para carga inicial. Sem polling fallback (Regra 6).
 * Suporta todos os 3 mercados: Futures, Spot e Margin.
 * 
 * @author Fillipe Guerra
 * @since 09/02/2026
 * @updated 10/02/2026
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Plus,
  X,
  Wallet,
  Target,
  BarChart3,
  AlertTriangle,
  CheckCircle,
  ArrowUpRight,
  ArrowDownRight,
  BookOpen,
  Activity,
  FileCheck,
  Loader2,
} from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WorkspaceFilterBar } from '@/components/ui/workspace-filter-bar';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ErrorBoundary } from '@/components/error-boundary';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { emitTradingTelemetry } from '@/lib/tradingTelemetry';
import { useKucoinWebSocket } from '@/hooks/useKucoinWebSocket';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { formatTradingNumber, parseLocaleNumberInput } from '@/lib/utils';
import {
  getDemoBalances,
  getDemoFundHistory,
  getDemoOrders,
  getDemoPositions,
  getDemoPostMortemQueueStats,
  getDemoPostMortems,
  getDemoSourceDatasets,
} from '@/services/api/tradingDemo';

// ============================================================================
// Tipos
// ============================================================================

interface DemoBalance {
  id: string;
  currency: string;
  available: string;
  frozen: string;
}

interface DemoOrder {
  id: string;
  symbol: string;
  marketType: string;
  side: string;
  orderType: string;
  size: string;
  price: string;
  fillPrice: string | null;
  fee: string;
  leverage: number;
  status: string;
  createdAt: string;
  filledAt: string | null;
}

interface DemoPosition {
  id: string;
  symbol: string;
  marketType: string;
  side: string;
  entryPrice: string;
  exitPrice: string | null;
  size: string;
  leverage: number;
  stopLoss: string | null;
  takeProfit: string | null;
  realizedPnl: string | null;
  totalFees: string | null;
  marginAmount?: string | null;
  liquidationPrice?: string | null;
  status: string;
  metadata?: Record<string, unknown>;
  openedAt: string;
  closedAt: string | null;
}

interface PostMortem {
  id: string;
  positionId: string;
  isDemo: boolean;
  fingerprint: string;
  status: string;
  classification: {
    tradeStyle: string;
    archetype: string;
    strategy: string;
    pnlPct: number;
    durationSec: number;
  } | null;
  motivators: Array<{
    title: string;
    explanation: string;
    citedValues: Record<string, number | string>;
  }>;
  successFactors: string[];
  failureFactors: string[];
  lessons: { repeat: string[]; avoid: string[] } | null;
  createdAt: string;
  completedAt: string | null;
}

interface NamespaceOption {
  id: string;
  nome: string;
  slug: string;
  ativo?: boolean;
}

interface FundHistory {
  id: string;
  tenantId: string;
  amount: string;
  currency: string;
  reason: string | null;
  createdAt: string;
}

/** Resposta da API de símbolos (mesmo padrão Trading Real) */
interface TradingSymbolsResponse {
  symbols: string[];
  defaultSymbol: string;
  favorites?: string[];
  featured?: string[];
  topSymbols?: string[];
}

/** Resposta da API de status do trading (mesmo padrão Trading Real) */
interface TradingStatus {
  isConfigured: boolean;
  requiresTenant?: boolean;
  featureFlags?: {
    tradingWorkspaceV2Enabled?: boolean;
    [key: string]: unknown;
  };
}

/** Resposta da API de dados de mercado (mesmo padrão Trading Real) */
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

type MarketType = 'spot' | 'futures' | 'margin';
type DemoTradingTabKey = 'overview' | 'positions' | 'orders' | 'postmortems' | 'history';
type DemoTradingWorkspaceKey = 'all' | 'execution' | 'operations' | 'analytics';

type DemoTradingTabDescriptor = {
  value: DemoTradingTabKey;
  icon: typeof BarChart3;
  label: string;
};

// ============================================================================
// Constantes
// ============================================================================

/** Intervalo de refetch para símbolos (5 minutos - mesma cache Redis do backend) */
const SYMBOLS_REFETCH_INTERVAL = 300_000;
const DEMO_TRADING_TAB_DESCRIPTORS: DemoTradingTabDescriptor[] = [
  { value: 'overview', icon: BarChart3, label: 'Visão Geral' },
  { value: 'positions', icon: Target, label: 'Posições' },
  { value: 'orders', icon: Activity, label: 'Ordens' },
  { value: 'postmortems', icon: FileCheck, label: 'Post-Mortems' },
  { value: 'history', icon: BookOpen, label: 'Histórico' },
];

const DEMO_TRADING_WORKSPACE_TABS: Record<DemoTradingWorkspaceKey, DemoTradingTabKey[]> = {
  all: DEMO_TRADING_TAB_DESCRIPTORS.map((tab) => tab.value),
  execution: ['overview', 'positions', 'orders'],
  operations: ['positions', 'orders', 'history'],
  analytics: ['overview', 'postmortems', 'history'],
};

const DEMO_TRADING_WORKSPACES: Array<{ value: DemoTradingWorkspaceKey; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'execution', label: 'Execução' },
  { value: 'operations', label: 'Operações' },
  { value: 'analytics', label: 'Análises' },
];

/**
 * ARQUITETURA REAL-TIME (10/02/2026):
 * - Dados de mercado (ticker) vêm 100% via WebSocket — REST apenas carga inicial.
 * - Sem polling fallback (Regra 6 — PROIBIDO workarounds).
 * - DemoTrading reutiliza o mesmo hook useKucoinWebSocket da Trading Real.
 */

// ============================================================================
// Componente Principal
// ============================================================================

/**
 * Componente interno com toda a lógica e hooks do Demo Trading.
 *
 * CORREÇÃO (22/02/2026) — Causa raiz dos crashes em produção:
 * O componente original declarava hooks (useState, useQuery, etc.) APÓS
 * early returns condicionais (isAuthLoading / !user?.id). Isso viola a
 * Regra de Hooks do React: hooks devem ser chamados na mesma ordem em
 * todos os renders. A violação causava:
 *   1. React Error #310 ("Rendered more hooks than during the previous render")
 *   2. ReferenceError TDZ no build minificado de produção
 *      ("Cannot access 'X' before initialization")
 *
 * Solução: separar em wrapper (DemoTrading) + inner (DemoTradingContent).
 * O inner é montado apenas quando o usuário está autenticado, portanto
 * TODOS os seus hooks são sempre chamados na mesma ordem.
 */
function DemoTradingContent() {
  const { toast } = useToast();

  // ============================================================================
  // Autenticação (leitura do cache React Query — sem chamada extra ao servidor)
  // ============================================================================
  const { user, csrfReady } = useAuth();

  const [activeTab, setActiveTab] = useState<DemoTradingTabKey>('overview');
  const [activeWorkspace, setActiveWorkspace] = useState<DemoTradingWorkspaceKey>('all');
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [addFundsDialogOpen, setAddFundsDialogOpen] = useState(false);
  const [positionDetailOpen, setPositionDetailOpen] = useState(false);
  const [postmortemTrainingDialogOpen, setPostmortemTrainingDialogOpen] = useState(false);
  const [selectedPostmortemForTraining, setSelectedPostmortemForTraining] = useState<string | null>(null);
  const [selectedTrainingNamespaceId, setSelectedTrainingNamespaceId] = useState<string>('');
  const [selectedClosedPosition, setSelectedClosedPosition] = useState<DemoPosition | null>(null);
  const workspaceUsageRef = useRef<{ tab: DemoTradingTabKey; workspace: DemoTradingWorkspaceKey } | null>(null);

  const visibleTabs = useMemo(() => {
    const allowed = DEMO_TRADING_WORKSPACE_TABS[activeWorkspace];
    return DEMO_TRADING_TAB_DESCRIPTORS.filter((tab) => allowed.includes(tab.value));
  }, [activeWorkspace]);

  const handleWorkspaceChange = useCallback((workspace: DemoTradingWorkspaceKey) => {
    setActiveWorkspace(workspace);
    if (workspace === 'all') return;
    const allowed = DEMO_TRADING_WORKSPACE_TABS[workspace];
    if (!allowed.includes(activeTab)) {
      setActiveTab(allowed[0] ?? 'overview');
    }
  }, [activeTab]);

  const handleTabChange = useCallback((nextTab: string) => {
    const normalized = DEMO_TRADING_TAB_DESCRIPTORS.find((tab) => tab.value === nextTab)?.value;
    if (!normalized) return;
    setActiveTab(normalized);
    if (activeWorkspace !== 'all' && !DEMO_TRADING_WORKSPACE_TABS[activeWorkspace].includes(normalized)) {
      setActiveWorkspace('all');
    }
  }, [activeWorkspace]);

  // Seleção de mercado e símbolo (mesmo padrão Trading Real)
  const [selectedMarketType, setSelectedMarketType] = useState<MarketType>('futures');
  const [selectedSymbol, setSelectedSymbol] = useState('');
  // marginMode alinhado com Trading Real para compartilhar cache TanStack Query
  const selectedMarginMode: 'cross' | 'isolated' = 'cross';

  // Formulário de ordem
  const [orderForm, setOrderForm] = useState({
    side: 'buy' as 'buy' | 'sell',
    orderType: 'market' as 'market' | 'limit' | 'stop',
    size: '',
    usdtAmount: '', // Campo para valor em USDT (conversão automática)
    price: '',
    leverage: '10',
    stopLoss: '',
    takeProfit: '',
  });

  // Formulário de fundos
  const [fundsAmount, setFundsAmount] = useState('');
  const [positionDrafts, setPositionDrafts] = useState<Record<string, {
    addSize: string;
    closeSize: string;
    stopLoss: string;
    takeProfit: string;
  }>>({});

  // ============================================================================
  // Queries de dados de mercado (mesmas APIs da Trading Real)
  // ============================================================================

  /** Status do trading (verifica se KuCoin está configurado) */
  const { data: statusData, isSuccess: isStatusSuccess } = useQuery<{ success: boolean; data: TradingStatus }>({
    queryKey: ['/api/integrations/trading/status'],
    refetchInterval: 60_000,
    enabled: !!user?.id && csrfReady, // Só executar após auth completa
  });

  const isConfigured = isStatusSuccess && (statusData?.data?.isConfigured ?? false);
  const tradingWorkspaceV2Enabled = Boolean(statusData?.data?.featureFlags?.tradingWorkspaceV2Enabled);

  useEffect(() => {
    const previous = workspaceUsageRef.current;
    if (previous?.tab === activeTab && previous.workspace === activeWorkspace) {
      return;
    }
    emitTradingTelemetry('trading.workspace.usage', {
      source: 'demo_trading',
      workspace: activeWorkspace,
      tab: activeTab,
      tradingWorkspaceV2Enabled,
      reason: previous
        ? (previous.workspace !== activeWorkspace ? 'workspace_change' : 'tab_change')
        : 'initial_mount',
    });
    workspaceUsageRef.current = { tab: activeTab, workspace: activeWorkspace };
  }, [activeTab, activeWorkspace, tradingWorkspaceV2Enabled]);

  /** Lista de símbolos disponíveis na KuCoin (mesma query key da Trading Real para reusar cache) */
  const { data: symbolsData, isLoading: isLoadingSymbols } = useQuery<{ success: boolean; data: TradingSymbolsResponse }>({
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
    enabled: !!user?.id && isConfigured, // Só executar após auth e status OK
  });

  const availableSymbols = symbolsData?.data?.symbols ?? [];
  const featuredOverride = symbolsData?.data?.featured ?? [];
  const topSymbols = symbolsData?.data?.topSymbols ?? [];
  const featuredSymbols = featuredOverride.length > 0 ? featuredOverride : topSymbols;

  // Selecionar símbolo padrão quando dados carregarem
  useEffect(() => {
    if (!selectedSymbol && symbolsData?.data) {
      const defaultSym = symbolsData.data.defaultSymbol;
      if (defaultSym && availableSymbols.includes(defaultSym)) {
        setSelectedSymbol(defaultSym);
      } else if (availableSymbols.length > 0) {
        setSelectedSymbol(availableSymbols[0]);
      }
    }
  }, [symbolsData, availableSymbols, selectedSymbol]);

  // Normalizar símbolo para request (padrão Trading Real)
  const isFuturesMarket = selectedMarketType === 'futures';
  const requestSymbol = useMemo(() => {
    if (!selectedSymbol) return '';
    // Futuros KuCoin usam sufixo M (ex: XBTUSDTM)
    if (isFuturesMarket && selectedSymbol && !selectedSymbol.endsWith('M')) {
      return `${selectedSymbol}M`;
    }
    return selectedSymbol;
  }, [selectedSymbol, isFuturesMarket]);

  const isSymbolValid = !!requestSymbol && availableSymbols.includes(selectedSymbol);

  // WebSocket para cotações em tempo real (reusar hook da Trading Real — 3 mercados)
  // CRÍTICO: Só conectar após auth completa E config OK
  const wsEnabled = !!user?.id && isSymbolValid && isConfigured;
  const [positionLiveQuotes, setPositionLiveQuotes] = useState<Record<string, number>>({});
  const {
    state: wsState,
    ticker: wsTicker,
    subscribe: subscribePositionQuotes,
    unsubscribe: unsubscribePositionQuotes,
  } = useKucoinWebSocket({
    symbol: wsEnabled ? requestSymbol : '',
    channels: wsEnabled ? ['ticker', 'positions', 'orders', 'balance'] : [],
    autoConnect: wsEnabled,
    marketType: selectedMarketType,
    marginMode: selectedMarginMode,
    onOrderUpdate: () => {
      void queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading/orders'] });
      void queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading/positions', 'all'] });
    },
    onPositionUpdate: () => {
      void queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading/positions', 'all'] });
      void queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading/balances'] });
    },
    onBalance: () => {
      void queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading/balances'] });
    },
    onTicker: (data) => {
      const next = Number(data.price);
      if (!Number.isFinite(next) || next <= 0) return;
      const symbolKey = (data.symbol ?? '').toUpperCase();
      if (!symbolKey) return;
      setPositionLiveQuotes((prev) => {
        if (prev[symbolKey] === next) return prev;
        return { ...prev, [symbolKey]: next };
      });
    },
  });
  const wsHealthy = wsEnabled && wsState.connected && !wsState.error;

  /** Dados de mercado REST (mesma query key da Trading Real para reusar cache) */
  const marketQueryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('marketType', selectedMarketType);
    if (selectedMarketType === 'margin') {
      params.set('marginMode', selectedMarginMode);
    }
    return params.toString();
  }, [selectedMarketType, selectedMarginMode]);

  const { data: marketData, isLoading: isLoadingMarket } = useQuery<{ success: boolean; data: MarketData }>({
    queryKey: ['/api/integrations/trading/market', requestSymbol, selectedMarketType, selectedMarginMode],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/integrations/trading/market/${requestSymbol}?${marketQueryString}`);
      return res.json();
    },
    enabled: !!user?.id && isConfigured && isSymbolValid, // Só executar após auth e config OK
    // FE-001: mercado deve usar WS como fonte primária; polling só como fallback.
    refetchInterval: wsHealthy ? false : 3_000,
  });

  const market = marketData?.data;

  // Preço atual: WS é fonte principal (REST apenas carga inicial)
  const normalizedSymbol = requestSymbol.toUpperCase();
  const wsTickerPrice = wsEnabled && wsTicker?.symbol?.toUpperCase() === normalizedSymbol
    ? Number(wsTicker.price)
    : NaN;
  const restPrice = isFuturesMarket
    ? market?.contract?.lastTradePrice
    : (market?.ticker?.price ? Number(market.ticker.price) : undefined);
  const restPriceValue = Number.isFinite(restPrice ?? NaN) ? Number(restPrice) : 0;
  const currentPrice = Number.isFinite(wsTickerPrice) ? wsTickerPrice : restPriceValue;

  // Variação de preço: Futures usa contract, Spot/Margin usa ticker
  const priceChange = isFuturesMarket
    ? (market?.contract?.priceChg ?? 0)
    : (market?.ticker ? Number((market.ticker as Record<string, unknown>).changePrice ?? 0) : 0);
  const priceChangePercent = isFuturesMarket
    ? (market?.contract?.priceChgPct ?? 0)
    : (market?.ticker ? Number((market.ticker as Record<string, unknown>).changeRate ?? 0) * 100 : 0);
  const high24h = market?.contract?.highPrice ?? 0;
  const low24h = market?.contract?.lowPrice ?? 0;
  const volume24h = market?.contract?.volumeOf24h ?? 0;
  const fundingRate = market?.contract?.fundingFeeRate ?? 0;
  const maxLeverage = market?.contract?.maxLeverage ?? 0;

  // ============================================================================
  // Queries de dados demo
  // ============================================================================

  const balancesQuery = useQuery<DemoBalance[]>({
    queryKey: ['/api/integrations/demo-trading/balances'],
    queryFn: () => getDemoBalances(),
    enabled: !!user?.id && isConfigured, // Só executar após auth e config OK
    refetchInterval: 10_000,
  });

  const positionsQuery = useQuery<DemoPosition[]>({
    queryKey: ['/api/integrations/demo-trading/positions', 'all'],
    queryFn: () => getDemoPositions(100),
    enabled: !!user?.id && isConfigured, // Só executar após auth e config OK
    refetchInterval: 2_000,
  });

  const ordersQuery = useQuery<DemoOrder[]>({
    queryKey: ['/api/integrations/demo-trading/orders'],
    queryFn: () => getDemoOrders(100),
    enabled: !!user?.id && isConfigured, // Só executar após auth e config OK
    refetchInterval: 2_000,
  });

  const fundHistoryQuery = useQuery<FundHistory[]>({
    queryKey: ['/api/integrations/demo-trading/funds/history'],
    queryFn: () => getDemoFundHistory(),
    enabled: !!user?.id && isConfigured, // Só executar após auth e config OK
  });

  const postmortemsQuery = useQuery<PostMortem[]>({
    queryKey: ['/api/integrations/postmortem', 'demo'],
    queryFn: () => getDemoPostMortems(50),
    enabled: !!user?.id && isConfigured, // Só executar após auth e config OK
    refetchInterval: 15_000,
  });

  const { data: namespacesData } = useQuery<NamespaceOption[]>({
    queryKey: ['/api/namespaces'],
    staleTime: 60_000,
    enabled: !!user?.id, // Só executar após auth completa
  });
  const availableNamespaces = useMemo(
    () => (namespacesData ?? []).filter((namespace) => namespace.ativo !== false),
    [namespacesData]
  );

  /** IDs de post-mortems já enviados para treinamento (têm training_data com sourceType trading_postmortem) */
  const { data: tradingDatasetsForSentCheck } = useQuery({
    queryKey: ['/api/integrations/trading/datasets', 'postmortem-ids'],
    queryFn: () => getDemoSourceDatasets(200),
    staleTime: 1000 * 30,
    enabled: !!user?.id && isConfigured, // Só executar após auth e config OK
  });

  const postmortemIdsSentToTraining = useMemo(() => {
    const data = tradingDatasetsForSentCheck ?? [];
    return new Set(
      data
        .filter((d) => (d.sourceType === 'trading_postmortem' || d.sourceType === 'postmortem') && d.sourceId)
        .map((d) => d.sourceId as string)
    );
  }, [tradingDatasetsForSentCheck]);

  const queueStatsQuery = useQuery({
    queryKey: ['/api/integrations/postmortem/queue/stats'],
    queryFn: () => getDemoPostMortemQueueStats(),
    refetchInterval: 10_000,
    enabled: !!user?.id && isConfigured, // Só executar após auth e config OK
  });

  // ============================================================================
  // Mutations
  // ============================================================================

  const createOrderMutation = useMutation({
    mutationFn: async () => {
      const leverageValue = parseInt(orderForm.leverage);
      const size = parseLocaleNumberInput(orderForm.size);
      const price = orderForm.price ? parseLocaleNumberInput(orderForm.price) : null;
      const stopLoss = orderForm.stopLoss ? parseLocaleNumberInput(orderForm.stopLoss) : null;
      const takeProfit = orderForm.takeProfit ? parseLocaleNumberInput(orderForm.takeProfit) : null;
      if (!size || size <= 0) {
        throw new Error('Quantidade inválida. Use formato de exchange (ex: 1,25 ou 1.25).');
      }
      const body = {
        symbol: requestSymbol || selectedSymbol,
        marketType: selectedMarketType,
        side: orderForm.side,
        orderType: orderForm.orderType,
        size,
        price: price ?? undefined,
        leverage: Number.isFinite(leverageValue) && leverageValue >= 1 ? leverageValue : 1,
        stopLoss: stopLoss ?? undefined,
        takeProfit: takeProfit ?? undefined,
      };
      const res = await apiRequest('POST', '/api/integrations/demo-trading/orders', body);
      const json = await res.json();
      return json.data;
    },
    onSuccess: () => {
      setOrderDialogOpen(false);
      // Ordem criada afeta: balance (margem congelada), ordens, e posições (se fill imediato)
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading/balances'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading/orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading/positions', 'all'] });
    },
  });

  const addFundsMutation = useMutation({
    mutationFn: async () => {
      const amount = parseLocaleNumberInput(fundsAmount);
      if (!amount || amount <= 0) {
        throw new Error('Valor de depósito inválido.');
      }
      const res = await apiRequest('POST', '/api/integrations/demo-trading/funds', {
        amount,
        note: 'Adição manual via UI',
      });
      const json = await res.json();
      return json.data;
    },
    onSuccess: () => {
      setAddFundsDialogOpen(false);
      setFundsAmount('');
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading/balances'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading/funds/history'] });
    },
  });

  const closePositionMutation = useMutation({
    mutationFn: async (payload: { positionId: string; size?: number }) => {
      const body = payload.size ? { size: payload.size } : undefined;
      const res = await apiRequest('POST', `/api/integrations/demo-trading/positions/${payload.positionId}/close`, body);
      const json = await res.json();
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading/balances'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading/positions', 'all'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/postmortem', 'demo'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/postmortem/queue/stats'] });
    },
  });

  const updatePositionRiskMutation = useMutation({
    mutationFn: async (payload: { positionId: string; stopLoss?: number | null; takeProfit?: number | null }) => {
      const res = await apiRequest('PATCH', `/api/integrations/demo-trading/positions/${payload.positionId}`, {
        stopLoss: payload.stopLoss,
        takeProfit: payload.takeProfit,
      });
      const json = await res.json();
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading/positions', 'all'] });
    },
  });

  const addToPositionMutation = useMutation({
    mutationFn: async (payload: { positionId: string; size: number; stopLoss?: number | null; takeProfit?: number | null }) => {
      const res = await apiRequest('POST', `/api/integrations/demo-trading/positions/${payload.positionId}/add`, {
        size: payload.size,
        stopLoss: payload.stopLoss,
        takeProfit: payload.takeProfit,
      });
      const json = await res.json();
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading/positions', 'all'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading/orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading/balances'] });
    },
  });

  const cancelOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      await apiRequest('DELETE', `/api/integrations/demo-trading/orders/${orderId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading/balances'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading/orders'] });
    },
  });

  const sendPostMortemToTrainingMutation = useMutation({
    mutationFn: async (params: { postmortemId: string; namespaceId: string }) => {
      const res = await apiRequest('POST', '/api/integrations/postmortem/send-to-training', {
        postmortemId: params.postmortemId,
        namespaceId: params.namespaceId,
      });
      return (await res.json()) as { success: boolean; data?: { datasetId: string } };
    },
    onSuccess: () => {
      setPostmortemTrainingDialogOpen(false);
      setSelectedPostmortemForTraining(null);
      setSelectedTrainingNamespaceId('');
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/datasets'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/datasets/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/postmortem', 'demo'] });
      toast({
        title: 'Post-mortem enviado para treinamento',
        description: 'Dataset criado e enviado para aprovação na página Training.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao enviar post-mortem',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // ============================================================================
  // Dados derivados
  // ============================================================================

  const positions = Array.isArray(positionsQuery.data) ? positionsQuery.data : [];
  const openPositions = positions.filter(p => p.status === 'open');
  const closedPositions = positions.filter(p => p.status !== 'open');
  const balances = Array.isArray(balancesQuery.data) ? balancesQuery.data : [];
  const orders = Array.isArray(ordersQuery.data) ? ordersQuery.data : [];
  const postmortems = Array.isArray(postmortemsQuery.data) ? postmortemsQuery.data : [];
  const usdtBalance = balances.find((entry) => entry.currency.toUpperCase() === 'USDT');
  const balancesWithFunds = balances.filter((entry) => Number(entry.available) > 0 || Number(entry.frozen) > 0);

  const totalPnl = closedPositions.reduce((acc, p) => acc + parseFloat(p.realizedPnl ?? '0'), 0);
  const winCount = closedPositions.filter(p => parseFloat(p.realizedPnl ?? '0') > 0).length;
  const lossCount = closedPositions.filter(p => parseFloat(p.realizedPnl ?? '0') < 0).length;
  const winRate = closedPositions.length > 0 ? (winCount / closedPositions.length * 100) : 0;

  // CORREÇÃO TDZ (22/02/2026): getLivePositionStats precisa ser declarado ANTES
  // de totalUnrealizedPnL que o usa. const/useCallback não são hoisted.
  const getLivePositionStats = useCallback((position: DemoPosition): { markPrice: number | null; pnlValue: number | null; pnlPct: number | null } => {
    const posSymbol = (position.symbol ?? '').toUpperCase();
    const markPrice = positionLiveQuotes[posSymbol];
    if (!Number.isFinite(markPrice) || (markPrice ?? 0) <= 0) {
      return { markPrice: null, pnlValue: null, pnlPct: null };
    }

    const size = Number(position.size);
    const entryPrice = Number(position.entryPrice);
    const leverage = Math.max(Number(position.leverage ?? 1), 1);
    if (!Number.isFinite(size) || !Number.isFinite(entryPrice) || size <= 0 || entryPrice <= 0) {
      return { markPrice: null, pnlValue: null, pnlPct: null };
    }

    const isLong = position.side === 'long';
    const direction = isLong ? 1 : -1;
    const pnlValue = ((markPrice as number) - entryPrice) * size * direction;
    const margin = (entryPrice * size) / leverage;
    const pnlPct = margin > 0 ? (pnlValue / margin) * 100 : 0;

    return { markPrice: markPrice as number, pnlValue, pnlPct };
  }, [positionLiveQuotes]);

  // ✅ CROSS MARGIN: Calcular Equity Total (saldo + frozen + unrealized PnL)
  const totalUnrealizedPnL = openPositions.reduce((acc, pos) => {
    const live = getLivePositionStats(pos);
    return acc + (live.pnlValue ?? 0);
  }, 0);
  const totalAccountEquity = Number(usdtBalance?.available ?? 0) + Number(usdtBalance?.frozen ?? 0) + totalUnrealizedPnL;

  // Conversão USDT ↔ Quantidade (usa preço atual em tempo real - apenas Futures)
  // Para Futures: qty = usdt / (preço * multiplier), onde multiplier define valor de 1 contrato
  // Para Spot/Margin: sem conversão automática (campo USDT não exibido - padrão Trading Real)
  const contractMultiplier = market?.contract?.multiplier ?? 0.001;

  const handleUsdtAmountChange = useCallback((usdtValue: string) => {
    setOrderForm(prev => {
      const usdtNum = parseLocaleNumberInput(usdtValue);
      if (currentPrice > 0 && usdtNum !== null && Number.isFinite(usdtNum) && usdtNum > 0 && isFuturesMarket) {
        const qty = usdtNum / (currentPrice * contractMultiplier);
        return { ...prev, usdtAmount: usdtValue, size: formatTradingNumber(qty, 'pt-BR', 0, 6) };
      }
      return { ...prev, usdtAmount: usdtValue, size: '' };
    });
  }, [currentPrice, contractMultiplier, isFuturesMarket]);

  const handleSizeChange = useCallback((sizeValue: string) => {
    setOrderForm(prev => {
      const sizeNum = parseLocaleNumberInput(sizeValue);
      if (currentPrice > 0 && sizeNum !== null && Number.isFinite(sizeNum) && sizeNum > 0 && isFuturesMarket) {
        const usdtVal = sizeNum * currentPrice * contractMultiplier;
        return { ...prev, size: sizeValue, usdtAmount: formatTradingNumber(usdtVal, 'pt-BR', 2, 2) };
      }
      return { ...prev, size: sizeValue, usdtAmount: '' };
    });
  }, [currentPrice, contractMultiplier, isFuturesMarket]);

  // Opções de símbolo ordenadas (featured primeiro, depois alfabético)
  const symbolOptions = useMemo(() => {
    if (availableSymbols.length === 0) return [];
    const featuredSet = new Set(featuredSymbols);
    const featured = featuredSymbols.filter(s => availableSymbols.includes(s));
    const rest = [...availableSymbols].filter(s => !featuredSet.has(s)).sort((a, b) => a.localeCompare(b));
    return [...featured, ...rest];
  }, [availableSymbols, featuredSymbols]);

  const getPositionDraft = useCallback((position: DemoPosition) => {
    const current = positionDrafts[position.id];
    return {
      addSize: current?.addSize ?? '',
      closeSize: current?.closeSize ?? '',
      stopLoss: current?.stopLoss ?? (position.stopLoss ?? ''),
      takeProfit: current?.takeProfit ?? (position.takeProfit ?? ''),
    };
  }, [positionDrafts]);

  const updatePositionDraft = useCallback((positionId: string, patch: Partial<{
    addSize: string;
    closeSize: string;
    stopLoss: string;
    takeProfit: string;
  }>) => {
    setPositionDrafts((prev) => ({
      ...prev,
      [positionId]: {
        addSize: prev[positionId]?.addSize ?? '',
        closeSize: prev[positionId]?.closeSize ?? '',
        stopLoss: prev[positionId]?.stopLoss ?? '',
        takeProfit: prev[positionId]?.takeProfit ?? '',
        ...patch,
      },
    }));
  }, []);

  const prefillSellFromBalance = useCallback((currency: string) => {
    if (!currency || currency.toUpperCase() === 'USDT') return;
    const targetSymbol = `${currency.toUpperCase()}USDT`;
    setSelectedMarketType('spot');
    setSelectedSymbol(targetSymbol);
    setOrderForm((prev) => ({
      ...prev,
      side: 'sell',
      orderType: 'market',
      price: '',
      leverage: '1',
      stopLoss: '',
      takeProfit: '',
    }));
    setOrderDialogOpen(true);
  }, []);

  // ============================================================================
  // Helpers de renderização
  // ============================================================================

  const formatMoney = (val: string | number) => {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const estimatePnlForPrice = useCallback((params: {
    side: 'buy' | 'sell';
    entryPrice: number;
    exitPrice: number;
    size: number;
    leverage: number;
  }): { pnlValue: number; pnlPct: number } => {
    const direction = params.side === 'buy' ? 1 : -1;
    const pnlValue = (params.exitPrice - params.entryPrice) * params.size * direction;
    const margin = (params.entryPrice * params.size) / Math.max(params.leverage, 1);
    const pnlPct = margin > 0 ? (pnlValue / margin) * 100 : 0;
    return { pnlValue, pnlPct };
  }, []);

  useEffect(() => {
    if (!wsState.connected) return;
    const activeSymbols = new Set(
      openPositions.map((position) => (position.symbol ?? '').toUpperCase()).filter((symbol) => symbol.length > 0)
    );
    activeSymbols.forEach((symbol) => {
      subscribePositionQuotes('ticker', symbol, undefined, selectedMarketType, selectedMarginMode);
    });
    return () => {
      activeSymbols.forEach((symbol) => {
        unsubscribePositionQuotes('ticker', symbol, undefined, selectedMarketType, selectedMarginMode);
      });
    };
  }, [openPositions, wsState.connected, selectedMarketType, selectedMarginMode, subscribePositionQuotes, unsubscribePositionQuotes]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  };

  const formatVolume = (vol: number) => {
    if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
    if (vol >= 1_000) return `${(vol / 1_000).toFixed(0)}K`;
    return vol.toLocaleString('pt-BR');
  };

  const getPnlColor = (pnl: number) => pnl >= 0 ? 'text-green-500' : 'text-red-500';

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
      open: { variant: 'default', label: 'Aberta' },
      filled: { variant: 'secondary', label: 'Executada' },
      cancelled: { variant: 'outline', label: 'Cancelada' },
      closed: { variant: 'secondary', label: 'Fechada' },
      liquidated: { variant: 'destructive', label: 'Liquidada' },
      completed: { variant: 'default', label: 'Completo' },
      completed_cpu: { variant: 'outline', label: 'CPU OK' },
      processing_cpu: { variant: 'outline', label: 'CPU...' },
      processing_llm: { variant: 'outline', label: 'LLM...' },
      queued: { variant: 'outline', label: 'Na fila' },
      no_trade: { variant: 'outline', label: 'Sem trade' },
      blocked: { variant: 'outline', label: 'Bloqueado' },
      failed: { variant: 'destructive', label: 'Falhou' },
    };
    const config = variants[status] ?? { variant: 'outline' as const, label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  // ============================================================================
  // Renderização
  // ============================================================================

  return (
    <ErrorBoundary>
      <div className="flex flex-col gap-6 p-6">
      {/* Header com seleção de mercado e símbolo */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Trading Demo</h1>
            <p className="text-muted-foreground">
              Simulação com dados reais de mercado. Sem risco financeiro.
            </p>
          </div>
          <div className="flex gap-2">
            <Dialog open={addFundsDialogOpen} onOpenChange={setAddFundsDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Wallet className="mr-2 h-4 w-4" />
                  Adicionar Fundos
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Adicionar Fundos Demo</DialogTitle>
                  <DialogDescription>Adicione USDT à sua conta demo.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div>
                    <Label>Quantidade (USDT)</Label>
                    <Input
                      type="text"
                      value={fundsAmount}
                      onChange={e => setFundsAmount(e.target.value)}
                      placeholder="Ex: 10.000,00"
                    />
                  </div>
                  <Button
                    onClick={() => addFundsMutation.mutate()}
                    disabled={!fundsAmount || (parseLocaleNumberInput(fundsAmount) ?? 0) <= 0 || addFundsMutation.isPending}
                    className="w-full"
                  >
                    {addFundsMutation.isPending ? 'Adicionando...' : 'Confirmar'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Button onClick={() => setOrderDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nova Ordem
            </Button>
          </div>
        </div>

        {/* Barra de seleção: Mercado + Símbolo + Chips de Featured */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Tipo de Mercado */}
          <Select
            value={selectedMarketType}
            onValueChange={(value: MarketType) => {
              setSelectedSymbol('');
              setSelectedMarketType(value);
            }}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="futures">Futures</SelectItem>
              <SelectItem value="spot">Spot</SelectItem>
              <SelectItem value="margin">Margin</SelectItem>
            </SelectContent>
          </Select>

          {/* Símbolo (dropdown com todos os símbolos disponíveis) */}
          <Select
            value={selectedSymbol}
            onValueChange={setSelectedSymbol}
            disabled={isLoadingSymbols || symbolOptions.length === 0}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={isLoadingSymbols ? 'Carregando...' : 'Selecione'} />
            </SelectTrigger>
            <SelectContent className="max-h-60 overflow-y-auto">
              {featuredSymbols.length > 0 && (
                <>
                  <SelectItem value="__featured_label__" disabled className="text-xs uppercase text-muted-foreground">
                    Principais
                  </SelectItem>
                  {featuredSymbols.filter(s => availableSymbols.includes(s)).map(symbol => (
                    <SelectItem key={`f-${symbol}`} value={symbol}>
                      {symbol}
                    </SelectItem>
                  ))}
                  <SelectItem value="__all_label__" disabled className="text-xs uppercase text-muted-foreground">
                    Todos
                  </SelectItem>
                </>
              )}
              {symbolOptions.filter(s => !featuredSymbols.includes(s)).map(symbol => (
                <SelectItem key={symbol} value={symbol}>
                  {symbol}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Indicador de status WebSocket — dados de mercado são 100% real-time via WS */}
          {wsEnabled && (
            <div className="flex items-center gap-1.5 text-xs px-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  wsHealthy ? 'bg-green-500 animate-pulse' : (wsState.connecting ? 'bg-yellow-500' : 'bg-red-500')
                }`}
              />
              <span className="text-muted-foreground">
                {wsHealthy ? 'Live' : (wsState.connecting ? 'Connecting...' : 'Offline')}
              </span>
            </div>
          )}
        </div>

        {/* Chips de símbolos featured (acesso rápido) */}
        {featuredSymbols.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {featuredSymbols.filter(s => availableSymbols.includes(s)).map(symbol => (
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

      {/* Card de Cotação em Tempo Real */}
      {isSymbolValid && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm text-muted-foreground">{selectedSymbol} - Último Preço</span>
                  {wsEnabled && wsTicker && (
                    <Badge variant="outline" className="text-xs">WS: connected</Badge>
                  )}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold tabular-nums">
                    ${isLoadingMarket && currentPrice === 0 ? '---' : formatMoney(currentPrice)}
                  </span>
                  {priceChange !== 0 && (
                    <div className={`flex items-center gap-1 text-sm ${priceChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {priceChange >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                      <span>{priceChange >= 0 ? '+' : ''}{formatMoney(priceChange)}</span>
                      <span>({priceChange >= 0 ? '+' : ''}{(priceChangePercent * 100).toFixed(2)}%)</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Máxima 24h</span>
                  <p className="font-mono font-medium">${formatMoney(high24h)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Mínima 24h</span>
                  <p className="font-mono font-medium">${formatMoney(low24h)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Volume 24h</span>
                  <p className="font-mono font-medium">{formatVolume(volume24h)}</p>
                </div>
                {isFuturesMarket && (
                  <div>
                    <span className="text-muted-foreground">Funding Rate</span>
                    <p className="font-mono font-medium">{(fundingRate * 100).toFixed(4)}%</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Métricas Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Saldo Disponível</span>
            </div>
            <p className="text-2xl font-bold mt-1">
              ${usdtBalance ? formatMoney(usdtBalance.available) : '---'}
            </p>
          </CardContent>
        </Card>

        {/* ✅ CROSS MARGIN: Equity Total */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Equity Total (Cross)</span>
            </div>
            <p className={`text-2xl font-bold mt-1 ${getPnlColor(totalUnrealizedPnL)}`}>
              ${formatMoney(totalAccountEquity)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Saldo + PnL Não Realizado
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Posições Abertas</span>
            </div>
            <p className="text-2xl font-bold mt-1">{openPositions.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">PnL Realizado</span>
            </div>
            <p className={`text-2xl font-bold mt-1 ${getPnlColor(totalPnl)}`}>
              ${formatMoney(totalPnl)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Win Rate</span>
            </div>
            <p className="text-2xl font-bold mt-1">{winRate.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">{winCount}W / {lossCount}L</p>
          </CardContent>
        </Card>

        {isFuturesMarket && maxLeverage > 0 && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Alavancagem Máx.</span>
              </div>
              <p className="text-2xl font-bold mt-1">{maxLeverage}x</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Dialog Nova Ordem - Estilo Exchange Real */}
      <Dialog open={orderDialogOpen} onOpenChange={setOrderDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Nova Ordem Demo
            </DialogTitle>
            <DialogDescription>
              Ordem simulada com preço real de mercado. Sem risco financeiro.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[70vh] pr-4">
            <div className="space-y-4 py-2">
              {/* Cotação em Tempo Real (topo do diálogo) */}
              {currentPrice > 0 && (
                <div className="p-3 bg-muted rounded-lg space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lg">{selectedSymbol}</span>
                      <Badge variant="outline" className="text-xs">{selectedMarketType}</Badge>
                    </div>
                    {wsEnabled && wsTicker && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <Activity className="h-3 w-3 text-green-500" />
                        Ao Vivo
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold tabular-nums">${formatMoney(currentPrice)}</span>
                    {priceChange !== 0 && (
                      <span className={`text-sm ${priceChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {priceChange >= 0 ? '+' : ''}{(priceChangePercent * 100).toFixed(2)}%
                      </span>
                    )}
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>Máx: ${formatMoney(high24h)}</span>
                    <span>Mín: ${formatMoney(low24h)}</span>
                    <span>Vol: {formatVolume(volume24h)}</span>
                  </div>
                </div>
              )}

              {/* Lado: Comprar / Vender (botões grandes como KuCoin) */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={orderForm.side === 'buy' ? 'default' : 'outline'}
                  className={orderForm.side === 'buy' ? 'bg-green-600 hover:bg-green-700 h-12' : 'h-12'}
                  onClick={() => setOrderForm(prev => ({ ...prev, side: 'buy' }))}
                >
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Comprar
                </Button>
                <Button
                  type="button"
                  variant={orderForm.side === 'sell' ? 'default' : 'outline'}
                  className={orderForm.side === 'sell' ? 'bg-red-600 hover:bg-red-700 h-12' : 'h-12'}
                  onClick={() => setOrderForm(prev => ({ ...prev, side: 'sell' }))}
                >
                  <TrendingDown className="h-4 w-4 mr-2" />
                  Vender
                </Button>
              </div>

              {/* Tipo de Ordem */}
              <div className="space-y-2">
                <Label>Tipo de Ordem</Label>
                <Select value={orderForm.orderType} onValueChange={v => setOrderForm(prev => ({ ...prev, orderType: v as 'market' | 'limit' | 'stop' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="market">Mercado</SelectItem>
                    <SelectItem value="limit">Limite</SelectItem>
                    <SelectItem value="stop">Stop</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Preço (apenas limit/stop) */}
              {orderForm.orderType !== 'market' && (
                <div className="space-y-2">
                  <Label>Preço</Label>
                  <Input
                  type="text"
                    value={orderForm.price}
                    onChange={e => setOrderForm(prev => ({ ...prev, price: e.target.value }))}
                  placeholder={currentPrice > 0 ? formatTradingNumber(currentPrice, 'pt-BR', 2, 8) : 'Ex: 66.250,00'}
                  />
                </div>
              )}

              {/* Quantidade */}
              <div className="space-y-2">
                <Label>{isFuturesMarket ? 'Quantidade (contratos)' : 'Quantidade'}</Label>
                <Input
                  type="text"
                  value={orderForm.size}
                  onChange={e => isFuturesMarket ? handleSizeChange(e.target.value) : setOrderForm(prev => ({ ...prev, size: e.target.value }))}
                  placeholder={isFuturesMarket ? 'Ex: 7,5' : 'Ex: 0,001'}
                />
                <p className="text-xs text-muted-foreground">
                  {isFuturesMarket
                    ? `1 contrato = ${market?.contract?.multiplier ?? 0.001} BTC para ${selectedSymbol}`
                    : 'Informe a quantidade do ativo para Spot/Margin'}
                </p>
              </div>

              {/* Valor em USDT (conversão automática - apenas Futures) */}
              {isFuturesMarket && (
                <div className="space-y-2">
                  <Label>Valor em USDT</Label>
                  <Input
                    type="text"
                    value={orderForm.usdtAmount}
                    onChange={e => handleUsdtAmountChange(e.target.value)}
                    placeholder="Ex: 12.345,67"
                  />
                  <p className="text-xs text-muted-foreground">
                    Preencha contratos OU valor em USDT. Exemplo cripto: 0,00123456. Exemplo fiat: 12.345,67.
                  </p>
                </div>
              )}

              {/* Alavancagem (Futures) */}
              {isFuturesMarket && (
                <div className="space-y-2">
                  <Label>Alavancagem</Label>
                  <Select
                    value={orderForm.leverage}
                    onValueChange={v => setOrderForm(prev => ({ ...prev, leverage: v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 5, 10, 20, 50, 100].filter(l => l <= (maxLeverage || 100)).map(lev => (
                        <SelectItem key={lev} value={lev.toString()}>
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
                  <Label>Stop Loss</Label>
                  <Input
                    type="text"
                    value={orderForm.stopLoss}
                    onChange={e => setOrderForm(prev => ({ ...prev, stopLoss: e.target.value }))}
                    placeholder="Opcional"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Take Profit</Label>
                  <Input
                    type="text"
                    value={orderForm.takeProfit}
                    onChange={e => setOrderForm(prev => ({ ...prev, takeProfit: e.target.value }))}
                    placeholder="Opcional"
                  />
                </div>
              </div>

              {/* Resumo da Ordem (mostra quando tem dados suficientes) */}
              {orderForm.size && currentPrice > 0 && (
                <Card className="bg-muted/50 border-dashed">
                  <CardContent className="p-3 space-y-2">
                    <p className="font-semibold text-sm flex items-center gap-1">
                      <BookOpen className="h-4 w-4" />
                      Resumo da Ordem
                    </p>
                    <Separator />
                    <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                      <span className="text-muted-foreground">Símbolo</span>
                      <span className="font-mono text-right">{selectedSymbol}</span>

                      <span className="text-muted-foreground">Direção</span>
                      <span className={`text-right font-medium ${orderForm.side === 'buy' ? 'text-green-500' : 'text-red-500'}`}>
                        {orderForm.side === 'buy' ? 'COMPRA (Long)' : 'VENDA (Short)'}
                      </span>

                      <span className="text-muted-foreground">Tipo</span>
                      <span className="text-right capitalize">{orderForm.orderType === 'market' ? 'Mercado' : orderForm.orderType === 'limit' ? 'Limite' : 'Stop'}</span>

                      <span className="text-muted-foreground">Quantidade</span>
                      <span className="font-mono text-right">{orderForm.size} contrato(s)</span>

                      <span className="text-muted-foreground">Preço</span>
                      <span className="font-mono text-right">
                        {orderForm.orderType === 'market' ? `~$${formatMoney(currentPrice)} (mercado)` : `$${formatMoney(orderForm.price || currentPrice)}`}
                      </span>

                      <span className="text-muted-foreground">Valor Estimado</span>
                      <span className="font-mono text-right font-medium">
                        {(() => {
                          if (isFuturesMarket && orderForm.usdtAmount) {
                            return `~$${formatMoney(orderForm.usdtAmount)} USDT`;
                          }
                          // Spot/Margin: valor = quantidade * preço
                          const qty = parseLocaleNumberInput(orderForm.size);
                          const effectivePrice = orderForm.orderType === 'limit' && orderForm.price
                            ? (parseLocaleNumberInput(orderForm.price) ?? 0)
                            : currentPrice;
                          if (qty !== null && Number.isFinite(qty) && qty > 0 && effectivePrice > 0) {
                            return `~$${formatMoney(qty * effectivePrice)} USDT`;
                          }
                          return '---';
                        })()}
                      </span>

                      {isFuturesMarket && (
                        <>
                          <span className="text-muted-foreground">Alavancagem</span>
                          <span className="text-right">{orderForm.leverage}x</span>

                          <span className="text-muted-foreground">Margem Requerida</span>
                          <span className="font-mono text-right">
                            ~${orderForm.usdtAmount ? formatMoney(parseFloat(orderForm.usdtAmount) / parseInt(orderForm.leverage || '1')) : '---'} USDT
                          </span>
                        </>
                      )}

                      {orderForm.stopLoss && (
                        <>
                          <span className="text-muted-foreground">Stop Loss</span>
                          <span className="font-mono text-right text-red-500">${formatMoney(orderForm.stopLoss)}</span>
                          {(() => {
                            const qty = parseLocaleNumberInput(orderForm.size);
                            const sl = parseLocaleNumberInput(orderForm.stopLoss);
                            const entry = orderForm.orderType === 'limit' && orderForm.price
                              ? parseLocaleNumberInput(orderForm.price)
                              : currentPrice;
                            const leverage = Number.parseInt(orderForm.leverage || '1', 10) || 1;
                            if (!qty || !sl || !entry || qty <= 0 || sl <= 0 || entry <= 0) return null;
                            const estimate = estimatePnlForPrice({
                              side: orderForm.side,
                              entryPrice: entry,
                              exitPrice: sl,
                              size: qty,
                              leverage,
                            });
                            return (
                              <>
                                <span className="text-muted-foreground">Estimativa SL</span>
                                <span className={`font-mono text-right ${estimate.pnlValue >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                  {estimate.pnlValue >= 0 ? '+' : ''}${formatMoney(estimate.pnlValue)} ({estimate.pnlPct >= 0 ? '+' : ''}{estimate.pnlPct.toFixed(2)}%)
                                </span>
                              </>
                            );
                          })()}
                        </>
                      )}

                      {orderForm.takeProfit && (
                        <>
                          <span className="text-muted-foreground">Take Profit</span>
                          <span className="font-mono text-right text-green-500">${formatMoney(orderForm.takeProfit)}</span>
                          {(() => {
                            const qty = parseLocaleNumberInput(orderForm.size);
                            const tp = parseLocaleNumberInput(orderForm.takeProfit);
                            const entry = orderForm.orderType === 'limit' && orderForm.price
                              ? parseLocaleNumberInput(orderForm.price)
                              : currentPrice;
                            const leverage = Number.parseInt(orderForm.leverage || '1', 10) || 1;
                            if (!qty || !tp || !entry || qty <= 0 || tp <= 0 || entry <= 0) return null;
                            const estimate = estimatePnlForPrice({
                              side: orderForm.side,
                              entryPrice: entry,
                              exitPrice: tp,
                              size: qty,
                              leverage,
                            });
                            return (
                              <>
                                <span className="text-muted-foreground">Estimativa TP</span>
                                <span className={`font-mono text-right ${estimate.pnlValue >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                  {estimate.pnlValue >= 0 ? '+' : ''}${formatMoney(estimate.pnlValue)} ({estimate.pnlPct >= 0 ? '+' : ''}{estimate.pnlPct.toFixed(2)}%)
                                </span>
                              </>
                            );
                          })()}
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {createOrderMutation.error && (
                <p className="text-sm text-destructive">{(createOrderMutation.error as Error).message}</p>
              )}
            </div>
          </ScrollArea>

          {/* Footer com botões */}
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setOrderDialogOpen(false)}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => createOrderMutation.mutate()}
              disabled={!orderForm.size || !selectedSymbol || createOrderMutation.isPending}
              className={`flex-1 h-11 font-bold ${orderForm.side === 'buy' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
            >
              {createOrderMutation.isPending ? 'Executando...' : `${orderForm.side === 'buy' ? '✓ Comprar' : '✓ Vender'} ${selectedSymbol}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <WorkspaceFilterBar
          activeWorkspace={activeWorkspace}
          options={DEMO_TRADING_WORKSPACES.map((workspace) => ({
            value: workspace.value,
            label: workspace.label,
          }))}
          onWorkspaceChange={handleWorkspaceChange}
          getTestId={(workspace) => `demo-workspace-${workspace}`}
        />
        <div className="w-full min-w-0 overflow-x-auto pb-2 -mx-2 px-2 md:mx-0 md:px-0">
          <TabsList className="inline-flex min-w-max flex-nowrap items-center gap-1 whitespace-nowrap">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="whitespace-nowrap shrink-0"
                >
                  <Icon className="h-4 w-4 md:mr-2" />
                  <span className="hidden md:inline">{tab.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {/* Tab: Visão Geral */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Trade Rápido */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Trade Rápido
                </CardTitle>
                <CardDescription>Execute ordens demo rapidamente</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    className="h-16 bg-green-600 hover:bg-green-700"
                    onClick={() => {
                      setOrderForm(prev => ({ ...prev, side: 'buy' }));
                      setOrderDialogOpen(true);
                    }}
                    disabled={!selectedSymbol}
                  >
                    <div className="flex flex-col items-center">
                      <TrendingUp className="h-5 w-5 mb-1" />
                      <span>Comprar (Long)</span>
                    </div>
                  </Button>
                  <Button
                    className="h-16 bg-red-600 hover:bg-red-700"
                    onClick={() => {
                      setOrderForm(prev => ({ ...prev, side: 'sell' }));
                      setOrderDialogOpen(true);
                    }}
                    disabled={!selectedSymbol}
                  >
                    <div className="flex flex-col items-center">
                      <TrendingDown className="h-5 w-5 mb-1" />
                      <span>Vender (Short)</span>
                    </div>
                  </Button>
                </div>
                <Separator />
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Melhor Compra</span>
                    <span className="font-mono text-green-500">
                      {market?.ticker?.bestBidPrice ? `$${formatMoney(market.ticker.bestBidPrice)}` : '-'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Melhor Venda</span>
                    <span className="font-mono text-red-500">
                      {market?.ticker?.bestAskPrice ? `$${formatMoney(market.ticker.bestAskPrice)}` : '-'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Spread</span>
                    <span className="font-mono">
                      {market?.ticker?.bestAskPrice && market?.ticker?.bestBidPrice
                        ? `$${formatMoney(parseFloat(market.ticker.bestAskPrice) - parseFloat(market.ticker.bestBidPrice))}`
                        : '-'}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Posições Abertas */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Posições Abertas</CardTitle>
              </CardHeader>
              <CardContent>
                {openPositions.length === 0 ? (
                  <EmptyState title="Nenhuma posição aberta" />
                ) : (
                  <div className="space-y-3">
                    {openPositions.map(pos => {
                      const live = getLivePositionStats(pos);
                      return (
                      <div key={pos.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <div className="flex items-center gap-2">
                            {pos.side === 'long' ? (
                              <ArrowUpRight className="h-4 w-4 text-green-500" />
                            ) : (
                              <ArrowDownRight className="h-4 w-4 text-red-500" />
                            )}
                            <span className="font-medium">{pos.symbol}</span>
                            <Badge variant="outline">{pos.side.toUpperCase()}</Badge>
                            {pos.leverage > 1 && <Badge variant="secondary">{pos.leverage}x</Badge>}
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            Entrada: ${formatMoney(pos.entryPrice)} | Tamanho: {pos.size}
                            {pos.symbol.toUpperCase().includes('XBT') || pos.symbol.toUpperCase().includes('BTC')
                              ? ` | Equiv. BTC: ${(Number(pos.size) * contractMultiplier).toFixed(6)} BTC`
                              : ''}
                          </p>
                          {live.markPrice !== null && live.pnlValue !== null && live.pnlPct !== null && (
                            <p className="text-sm mt-1">
                              Cotação RT: <span className="font-mono">${formatMoney(live.markPrice)}</span>
                              {' | '}
                              PnL RT: <span className={`font-mono ${live.pnlValue >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                {live.pnlValue >= 0 ? '+' : ''}${formatMoney(live.pnlValue)} ({live.pnlPct >= 0 ? '+' : ''}{live.pnlPct.toFixed(2)}%)
                              </span>
                            </p>
                          )}
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => closePositionMutation.mutate({ positionId: pos.id })}
                          disabled={closePositionMutation.isPending}
                        >
                          Fechar
                        </Button>
                      </div>
                    )})}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Saldos por Ativo (Demo)</CardTitle>
              <CardDescription>Visualize ativos disponíveis e envie venda direta para o ticket de ordem.</CardDescription>
            </CardHeader>
            <CardContent>
              {balancesWithFunds.length === 0 ? (
                <EmptyState title="Nenhum saldo disponível." />
              ) : (
                <div className="space-y-2">
                  {balancesWithFunds.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium">{entry.currency}</p>
                        <p className="text-xs text-muted-foreground">
                          Disponível: {formatMoney(entry.available)} | Congelado: {formatMoney(entry.frozen)}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={entry.currency.toUpperCase() === 'USDT' || Number(entry.available) <= 0}
                        onClick={() => prefillSellFromBalance(entry.currency)}
                      >
                        Vender ativo
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Fila Post-Mortem */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Status Post-Mortem</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-8">
                <div className="flex items-center gap-2">
                  <span className="text-sm">Na fila</span>
                  <Badge variant="outline">{queueStatsQuery.data?.pending ?? 0}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm">DLQ (falhos)</span>
                  <Badge variant={queueStatsQuery.data?.dlq ? 'destructive' : 'outline'}>
                    {queueStatsQuery.data?.dlq ?? 0}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm">Total Completos</span>
                  <Badge>{postmortems.filter(pm => pm.status === 'completed').length}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Posições */}
        <TabsContent value="positions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Posições Abertas</CardTitle>
            </CardHeader>
            <CardContent>
              {openPositions.length === 0 ? (
                <EmptyState title="Nenhuma posição aberta" />
              ) : (
                <div className="space-y-3">
                  {openPositions.map((pos) => {
                    const draft = getPositionDraft(pos);
                    const live = getLivePositionStats(pos);
                    return (
                      <div key={pos.id} className="p-4 border rounded-lg space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {pos.side === 'long' ? (
                              <TrendingUp className="h-5 w-5 text-green-500" />
                            ) : (
                              <TrendingDown className="h-5 w-5 text-red-500" />
                            )}
                            <span className="font-bold text-lg">{pos.symbol}</span>
                            <Badge variant={pos.side === 'long' ? 'default' : 'destructive'}>{pos.side.toUpperCase()}</Badge>
                            {pos.leverage > 1 && <Badge variant="secondary">{pos.leverage}x</Badge>}
                            <Badge variant="outline">{pos.marketType}</Badge>
                          </div>
                          <Button
                            variant="destructive"
                            onClick={() => closePositionMutation.mutate({ positionId: pos.id })}
                            disabled={closePositionMutation.isPending}
                          >
                            Fechar Posição
                          </Button>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Entrada</span>
                            <p className="font-mono">${formatMoney(pos.entryPrice)}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Cotação RT</span>
                            <p className="font-mono">
                              {live.markPrice !== null ? `$${formatMoney(live.markPrice)}` : '-'}
                              {live.markPrice !== null && <span className="ml-2 text-xs text-green-500">WS</span>}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Tamanho</span>
                            <p className="font-mono">{pos.size}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">PnL RT</span>
                            <p className={`font-mono ${live.pnlValue !== null && live.pnlValue >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                              {live.pnlValue !== null && live.pnlPct !== null
                                ? `${live.pnlValue >= 0 ? '+' : ''}$${formatMoney(live.pnlValue)} (${live.pnlPct >= 0 ? '+' : ''}${live.pnlPct.toFixed(2)}%)`
                                : '-'}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Stop Loss</span>
                            <p className="font-mono">{pos.stopLoss ? `$${formatMoney(pos.stopLoss)}` : '-'}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Take Profit</span>
                            <p className="font-mono">{pos.takeProfit ? `$${formatMoney(pos.takeProfit)}` : '-'}</p>
                          </div>
                        </div>

                        {pos.marketType === 'futures' && (
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t">
                            <div className="space-y-2">
                              <Label className="text-xs">Adicionar tamanho</Label>
                              <Input
                                type="text"
                                value={draft.addSize}
                                onChange={(e) => updatePositionDraft(pos.id, { addSize: e.target.value })}
                                placeholder="Ex: 10"
                              />
                              <Button
                                size="sm"
                                className="w-full"
                                disabled={!draft.addSize || addToPositionMutation.isPending}
                                onClick={() => {
                                  const size = parseLocaleNumberInput(draft.addSize);
                                  if (size === null || !Number.isFinite(size) || size <= 0) return;
                                  addToPositionMutation.mutate({
                                    positionId: pos.id,
                                    size,
                                    stopLoss: draft.stopLoss ? (parseLocaleNumberInput(draft.stopLoss) ?? null) : null,
                                    takeProfit: draft.takeProfit ? (parseLocaleNumberInput(draft.takeProfit) ?? null) : null,
                                  });
                                }}
                              >
                                Adicionar à posição
                              </Button>
                            </div>

                            <div className="space-y-2">
                              <Label className="text-xs">Fechamento parcial</Label>
                              <Input
                                type="text"
                                value={draft.closeSize}
                                onChange={(e) => updatePositionDraft(pos.id, { closeSize: e.target.value })}
                                placeholder="Ex: 5"
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full"
                                disabled={!draft.closeSize || closePositionMutation.isPending}
                                onClick={() => {
                                  const size = parseLocaleNumberInput(draft.closeSize);
                                  if (size === null || !Number.isFinite(size) || size <= 0) return;
                                  closePositionMutation.mutate({ positionId: pos.id, size });
                                }}
                              >
                                Fechar parcial
                              </Button>
                            </div>

                            <div className="space-y-2">
                              <Label className="text-xs">Ajustar SL/TP</Label>
                              <div className="grid grid-cols-2 gap-2">
                                <Input
                                  type="text"
                                  value={draft.stopLoss}
                                  onChange={(e) => updatePositionDraft(pos.id, { stopLoss: e.target.value })}
                                  placeholder="SL"
                                />
                                <Input
                                  type="text"
                                  value={draft.takeProfit}
                                  onChange={(e) => updatePositionDraft(pos.id, { takeProfit: e.target.value })}
                                  placeholder="TP"
                                />
                              </div>
                              <Button
                                size="sm"
                                variant="secondary"
                                className="w-full"
                                disabled={updatePositionRiskMutation.isPending}
                                onClick={() => {
                                  updatePositionRiskMutation.mutate({
                                    positionId: pos.id,
                                    stopLoss: draft.stopLoss ? (parseLocaleNumberInput(draft.stopLoss) ?? null) : null,
                                    takeProfit: draft.takeProfit ? (parseLocaleNumberInput(draft.takeProfit) ?? null) : null,
                                  });
                                }}
                              >
                                Atualizar SL/TP
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Ordens */}
        <TabsContent value="orders" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Ordens Demo</CardTitle>
            </CardHeader>
            <CardContent>
              {orders.length === 0 ? (
                <EmptyState title="Nenhuma ordem encontrada" />
              ) : (
                <div className="space-y-2">
                  {orders.map(order => (
                    <div key={order.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        {getStatusBadge(order.status)}
                        <span className="font-medium">{order.symbol}</span>
                        <Badge variant={order.side === 'buy' ? 'default' : 'destructive'}>{order.side.toUpperCase()}</Badge>
                        <Badge variant="outline">{order.orderType}</Badge>
                        <span className="text-sm text-muted-foreground">
                          {order.size} @ {order.fillPrice ? `$${formatMoney(order.fillPrice)}` : `$${formatMoney(order.price)}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</span>
                        {order.status === 'open' && (
                          <Button variant="ghost" size="sm" onClick={() => cancelOrderMutation.mutate(order.id)}>
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Post-Mortems */}
        <TabsContent value="postmortems" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Post-Mortems Automáticos</CardTitle>
              <CardDescription>
                Análise automática gerada ao fechar cada posição (CPU + LLM)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {postmortems.length === 0 ? (
                <EmptyState title="Nenhum post-mortem ainda." description="Feche uma posição para gerar automaticamente." />
              ) : (
                <div className="space-y-3">
                  {postmortems.map(pm => (
                    <div key={pm.id} className="p-4 border rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {getStatusBadge(pm.status)}
                          {pm.classification && (
                            <>
                              <Badge variant="outline">{pm.classification.tradeStyle}</Badge>
                              <Badge variant="outline">{pm.classification.archetype}</Badge>
                              <span className={`font-mono font-bold ${getPnlColor(pm.classification.pnlPct)}`}>
                                {pm.classification.pnlPct > 0 ? '+' : ''}{pm.classification.pnlPct.toFixed(2)}%
                              </span>
                            </>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">{formatDate(pm.createdAt)}</span>
                      </div>

                      {/* Motivadores */}
                      {Array.isArray(pm.motivators) && pm.motivators.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-sm font-semibold flex items-center gap-1">
                            <BookOpen className="h-3 w-3" /> Motivadores
                          </h4>
                          {pm.motivators.map((m, i) => (
                            <div key={i} className="ml-4 text-sm">
                              <p className="font-medium">{m.title}</p>
                              <p className="text-muted-foreground">{m.explanation}</p>
                              {m.citedValues && Object.keys(m.citedValues).length > 0 && (
                                <div className="flex gap-2 mt-1 flex-wrap">
                                  {Object.entries(m.citedValues).map(([k, v]) => (
                                    <Badge key={k} variant="secondary" className="text-xs">
                                      {k}: {v}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Lições */}
                      {pm.lessons && (
                        <div className="grid grid-cols-2 gap-4">
                          {Array.isArray(pm.lessons.repeat) && pm.lessons.repeat.length > 0 && (
                            <div>
                              <h4 className="text-sm font-semibold text-green-500 flex items-center gap-1">
                                <CheckCircle className="h-3 w-3" /> Repetir
                              </h4>
                              <ul className="ml-4 text-sm text-muted-foreground list-disc">
                                {pm.lessons.repeat.map((l, i) => <li key={i}>{l}</li>)}
                              </ul>
                            </div>
                          )}
                          {Array.isArray(pm.lessons.avoid) && pm.lessons.avoid.length > 0 && (
                            <div>
                              <h4 className="text-sm font-semibold text-red-500 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" /> Evitar
                              </h4>
                              <ul className="ml-4 text-sm text-muted-foreground list-disc">
                                {pm.lessons.avoid.map((l, i) => <li key={i}>{l}</li>)}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}

                      {pm.status === 'completed' && (
                        <div className="pt-2 border-t flex justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              postmortemIdsSentToTraining.has(pm.id) ||
                              sendPostMortemToTrainingMutation.isPending
                            }
                            onClick={() => {
                              setSelectedPostmortemForTraining(pm.id);
                              setSelectedTrainingNamespaceId('');
                              setPostmortemTrainingDialogOpen(true);
                            }}
                          >
                            {sendPostMortemToTrainingMutation.isPending ? (
                              'Enviando...'
                            ) : postmortemIdsSentToTraining.has(pm.id) ? (
                              <>
                                <CheckCircle className="h-4 w-4 mr-2" />
                                Enviado para Treinamento
                              </>
                            ) : (
                              <>
                                <FileCheck className="h-4 w-4 mr-2" />
                                Enviar para Treinamento
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Histórico */}
        <TabsContent value="history" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Posições Fechadas */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Posições Fechadas</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-[400px]">
                  {closedPositions.length === 0 ? (
                    <EmptyState title="Nenhuma posição fechada" />
                  ) : (
                    <div className="space-y-2">
                      {closedPositions.map(pos => {
                        const pnl = parseFloat(pos.realizedPnl ?? '0');
                        const closeReason = typeof pos.metadata?.closeReason === 'string'
                          ? pos.metadata.closeReason
                          : (pos.status === 'liquidated' ? 'liquidation' : 'manual');
                        return (
                          <div
                            key={pos.id}
                            className="flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-muted/60"
                            onClick={() => {
                              setSelectedClosedPosition(pos);
                              setPositionDetailOpen(true);
                            }}
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{pos.symbol}</span>
                                <Badge variant={pos.side === 'long' ? 'default' : 'destructive'} className="text-xs">
                                  {pos.side}
                                </Badge>
                                {getStatusBadge(pos.status)}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {formatDate(pos.openedAt)} → {pos.closedAt ? formatDate(pos.closedAt) : '-'}
                              </p>
                              <p className="text-xs text-muted-foreground">Motivo: {closeReason}</p>
                            </div>
                            <span className={`font-mono font-bold ${getPnlColor(pnl)}`}>
                              {pnl > 0 ? '+' : ''}{formatMoney(pnl)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Histórico de Fundos */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Histórico de Fundos</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-[400px]">
                  {(fundHistoryQuery.data ?? []).length === 0 ? (
                    <EmptyState title="Nenhum registro" />
                  ) : (
                    <div className="space-y-2">
                      {(fundHistoryQuery.data ?? []).map(entry => {
                        // reason segue formato "action - descrição" (ex: "pnl_debit - PnL de XBTUSDTM long: -5.20 USDT")
                        const reason = entry.reason ?? '';
                        const separatorIdx = reason.indexOf(' - ');
                        const action = separatorIdx >= 0 ? reason.slice(0, separatorIdx) : reason;
                        const description = separatorIdx >= 0 ? reason.slice(separatorIdx + 3) : reason;
                        const isDebit = action.includes('debit');

                        return (
                          <div key={entry.id} className="flex items-center justify-between p-3 border rounded-lg">
                            <div>
                              <p className="text-sm font-medium">{description || action || 'Movimentação'}</p>
                              <p className="text-xs text-muted-foreground">{formatDate(entry.createdAt)}</p>
                            </div>
                            <div className="text-right">
                              <p className={`font-mono font-medium ${isDebit ? 'text-red-500' : 'text-green-500'}`}>
                                {isDebit ? '-' : '+'}{formatMoney(entry.amount)} {entry.currency}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={postmortemTrainingDialogOpen}
        onOpenChange={(open) => {
          setPostmortemTrainingDialogOpen(open);
          if (!open) {
            setSelectedPostmortemForTraining(null);
            setSelectedTrainingNamespaceId('');
          }
        }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Enviar post-mortem para treinamento</DialogTitle>
            <DialogDescription>
              Selecione um namespace de destino para criar o dataset e enviá-lo para aprovação no Training.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Namespace</Label>
            <Select value={selectedTrainingNamespaceId} onValueChange={setSelectedTrainingNamespaceId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um namespace" />
              </SelectTrigger>
              <SelectContent>
                {availableNamespaces.map((namespace) => (
                  <SelectItem key={namespace.id} value={namespace.id}>
                    {namespace.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPostmortemTrainingDialogOpen(false);
                setSelectedPostmortemForTraining(null);
                setSelectedTrainingNamespaceId('');
              }}
            >
              Cancelar
            </Button>
            <Button
              disabled={!selectedPostmortemForTraining || !selectedTrainingNamespaceId || sendPostMortemToTrainingMutation.isPending}
              onClick={() => {
                if (!selectedPostmortemForTraining || !selectedTrainingNamespaceId) {
                  toast({
                    title: 'Namespace obrigatório',
                    description: 'Selecione um namespace para enviar o post-mortem ao treinamento.',
                    variant: 'destructive',
                  });
                  return;
                }
                sendPostMortemToTrainingMutation.mutate({
                  postmortemId: selectedPostmortemForTraining,
                  namespaceId: selectedTrainingNamespaceId,
                });
              }}
            >
              {sendPostMortemToTrainingMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <FileCheck className="h-4 w-4 mr-2" />
                  Confirmar envio
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={positionDetailOpen} onOpenChange={setPositionDetailOpen}>
        <DialogContent className="sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>Detalhes da Posição</DialogTitle>
            <DialogDescription>Dados completos da posição fechada no Trading Demo.</DialogDescription>
          </DialogHeader>
          {selectedClosedPosition ? (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Símbolo</span><p className="font-mono">{selectedClosedPosition.symbol}</p></div>
              <div><span className="text-muted-foreground">Mercado</span><p className="font-mono">{selectedClosedPosition.marketType}</p></div>
              <div><span className="text-muted-foreground">Lado</span><p className="font-mono">{selectedClosedPosition.side.toUpperCase()}</p></div>
              <div><span className="text-muted-foreground">Status</span><p className="font-mono">{selectedClosedPosition.status}</p></div>
              <div><span className="text-muted-foreground">Entrada</span><p className="font-mono">{selectedClosedPosition.entryPrice}</p></div>
              <div><span className="text-muted-foreground">Saída</span><p className="font-mono">{selectedClosedPosition.exitPrice ?? '-'}</p></div>
              <div><span className="text-muted-foreground">Tamanho</span><p className="font-mono">{selectedClosedPosition.size}</p></div>
              <div><span className="text-muted-foreground">Leverage</span><p className="font-mono">{selectedClosedPosition.leverage}x</p></div>
              <div><span className="text-muted-foreground">Margem</span><p className="font-mono">{selectedClosedPosition.marginAmount ?? '-'}</p></div>
              <div><span className="text-muted-foreground">Preço de Liquidação</span><p className="font-mono">{selectedClosedPosition.liquidationPrice ?? '-'}</p></div>
              <div><span className="text-muted-foreground">Stop Loss</span><p className="font-mono">{selectedClosedPosition.stopLoss ?? '-'}</p></div>
              <div><span className="text-muted-foreground">Take Profit</span><p className="font-mono">{selectedClosedPosition.takeProfit ?? '-'}</p></div>
              <div><span className="text-muted-foreground">Fees Totais</span><p className="font-mono">{selectedClosedPosition.totalFees ?? '-'}</p></div>
              <div><span className="text-muted-foreground">PnL Realizado</span><p className="font-mono">{selectedClosedPosition.realizedPnl ?? '-'}</p></div>
              <div><span className="text-muted-foreground">Abertura</span><p className="font-mono">{formatDate(selectedClosedPosition.openedAt)}</p></div>
              <div><span className="text-muted-foreground">Fechamento</span><p className="font-mono">{selectedClosedPosition.closedAt ? formatDate(selectedClosedPosition.closedAt) : '-'}</p></div>
              <div className="col-span-2">
                <span className="text-muted-foreground">Motivo de Fechamento</span>
                <p className="font-mono">
                  {(typeof selectedClosedPosition.metadata?.closeReason === 'string'
                    ? selectedClosedPosition.metadata.closeReason
                    : (selectedClosedPosition.status === 'liquidated' ? 'liquidation' : 'manual'))}
                </p>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
    </ErrorBoundary>
  );
}

/**
 * Wrapper de autenticação para Demo Trading.
 *
 * Mantém contagem de hooks constante (apenas useAuth) garantindo que
 * DemoTradingContent só seja montado quando o usuário está autenticado.
 * Isso evita a violação da Regra de Hooks que causava React Error #310 e
 * ReferenceError TDZ no build minificado de produção.
 */
export default function DemoTrading() {
  const { user, isLoading: isAuthLoading } = useAuth();

  // Aguardar autenticação antes de montar componente com múltiplos hooks
  if (isAuthLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Carregando autenticação...</p>
        </div>
      </div>
    );
  }

  // Usuário não autenticado (redundante com App.tsx — defesa em profundidade)
  if (!user?.id) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Autenticação Necessária</CardTitle>
            <CardDescription>
              Você precisa estar autenticado para acessar o Demo Trading.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => window.location.href = '/login'} className="w-full">
              Fazer Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <DemoTradingContent />;
}
