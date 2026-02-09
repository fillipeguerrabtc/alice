/**
 * Demo Trading - Página de Trading Simulado com Dados Reais
 * 
 * Permite operar em modo demo com preços reais da KuCoin.
 * Balances infinitos auditáveis, ordens simuladas com slippage/fees,
 * posições com PnL em tempo real, e post-mortem automático no fechamento.
 * 
 * NUNCA executa ordens reais - total isolamento.
 * 
 * @author Fillipe Guerra
 * @since 09/02/2026
 */

import { useState } from 'react';
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
} from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { apiRequest, queryClient } from '@/lib/queryClient';

// ============================================================================
// Tipos
// ============================================================================

interface DemoBalance {
  id: string;
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
  status: string;
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

interface FundHistory {
  id: string;
  action: string;
  amount: string;
  currency: string;
  balanceAfter: string;
  note: string | null;
  createdAt: string;
}

// ============================================================================
// Componente Principal
// ============================================================================

export default function DemoTrading() {
  const [activeTab, setActiveTab] = useState('overview');
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [addFundsDialogOpen, setAddFundsDialogOpen] = useState(false);

  // Formulário de ordem
  const [orderForm, setOrderForm] = useState({
    symbol: 'XBTUSDTM',
    marketType: 'futures' as 'spot' | 'futures' | 'margin',
    side: 'buy' as 'buy' | 'sell',
    orderType: 'market' as 'market' | 'limit' | 'stop',
    size: '',
    price: '',
    leverage: '10',
    stopLoss: '',
    takeProfit: '',
  });

  // Formulário de fundos
  const [fundsAmount, setFundsAmount] = useState('');

  // ============================================================================
  // Queries
  // ============================================================================

  const balanceQuery = useQuery({
    queryKey: ['/api/integrations/demo-trading/balance'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/integrations/demo-trading/balance');
      const json = await res.json() as { data: DemoBalance };
      return json.data;
    },
    refetchInterval: 10_000,
  });

  const positionsQuery = useQuery({
    queryKey: ['/api/integrations/demo-trading/positions', 'all'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/integrations/demo-trading/positions?limit=100');
      const json = await res.json() as { data: DemoPosition[] };
      return json.data;
    },
    refetchInterval: 5_000,
  });

  const ordersQuery = useQuery({
    queryKey: ['/api/integrations/demo-trading/orders'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/integrations/demo-trading/orders?limit=100');
      const json = await res.json() as { data: DemoOrder[] };
      return json.data;
    },
    refetchInterval: 10_000,
  });

  const fundHistoryQuery = useQuery({
    queryKey: ['/api/integrations/demo-trading/funds/history'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/integrations/demo-trading/funds/history');
      const json = await res.json() as { data: FundHistory[] };
      return json.data;
    },
  });

  const postmortemsQuery = useQuery({
    queryKey: ['/api/integrations/postmortem', 'demo'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/integrations/postmortem?isDemo=true&limit=50');
      const json = await res.json() as { data: PostMortem[] };
      return json.data;
    },
    refetchInterval: 15_000,
  });

  const queueStatsQuery = useQuery({
    queryKey: ['/api/integrations/postmortem/queue/stats'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/integrations/postmortem/queue/stats');
      const json = await res.json() as { data: { pending: number; dlq: number } };
      return json.data;
    },
    refetchInterval: 10_000,
  });

  // ============================================================================
  // Mutations
  // ============================================================================

  const createOrderMutation = useMutation({
    mutationFn: async () => {
      const body = {
        symbol: orderForm.symbol,
        marketType: orderForm.marketType,
        side: orderForm.side,
        orderType: orderForm.orderType,
        size: parseFloat(orderForm.size),
        price: orderForm.price ? parseFloat(orderForm.price) : undefined,
        leverage: parseInt(orderForm.leverage),
        stopLoss: orderForm.stopLoss ? parseFloat(orderForm.stopLoss) : undefined,
        takeProfit: orderForm.takeProfit ? parseFloat(orderForm.takeProfit) : undefined,
      };
      const res = await apiRequest('POST', '/api/integrations/demo-trading/orders', body);
      const json = await res.json();
      return json.data;
    },
    onSuccess: () => {
      setOrderDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading'] });
    },
  });

  const addFundsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/integrations/demo-trading/funds', {
        amount: parseFloat(fundsAmount),
        note: 'Adição manual via UI',
      });
      const json = await res.json();
      return json.data;
    },
    onSuccess: () => {
      setAddFundsDialogOpen(false);
      setFundsAmount('');
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading'] });
    },
  });

  const closePositionMutation = useMutation({
    mutationFn: async (positionId: string) => {
      const res = await apiRequest('POST', `/api/integrations/demo-trading/positions/${positionId}/close`);
      const json = await res.json();
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/postmortem'] });
    },
  });

  const cancelOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      await apiRequest('DELETE', `/api/integrations/demo-trading/orders/${orderId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/demo-trading'] });
    },
  });

  // ============================================================================
  // Dados derivados
  // ============================================================================

  const openPositions = (positionsQuery.data ?? []).filter(p => p.status === 'open');
  const closedPositions = (positionsQuery.data ?? []).filter(p => p.status !== 'open');
  const balance = balanceQuery.data;

  const totalPnl = closedPositions.reduce((acc, p) => acc + parseFloat(p.realizedPnl ?? '0'), 0);
  const winCount = closedPositions.filter(p => parseFloat(p.realizedPnl ?? '0') > 0).length;
  const lossCount = closedPositions.filter(p => parseFloat(p.realizedPnl ?? '0') < 0).length;
  const winRate = closedPositions.length > 0 ? (winCount / closedPositions.length * 100) : 0;

  // ============================================================================
  // Helpers de renderização
  // ============================================================================

  const formatMoney = (val: string | number) => {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
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
      failed: { variant: 'destructive', label: 'Falhou' },
    };
    const config = variants[status] ?? { variant: 'outline' as const, label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  // ============================================================================
  // Renderização
  // ============================================================================

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
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
                    type="number"
                    value={fundsAmount}
                    onChange={e => setFundsAmount(e.target.value)}
                    placeholder="10000"
                  />
                </div>
                <Button
                  onClick={() => addFundsMutation.mutate()}
                  disabled={!fundsAmount || parseFloat(fundsAmount) <= 0 || addFundsMutation.isPending}
                  className="w-full"
                >
                  {addFundsMutation.isPending ? 'Adicionando...' : 'Confirmar'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={orderDialogOpen} onOpenChange={setOrderDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nova Ordem
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Nova Ordem Demo</DialogTitle>
                <DialogDescription>Crie uma ordem simulada com preço real de mercado.</DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[60vh] pr-4">
                <div className="space-y-4 pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Símbolo</Label>
                      <Input value={orderForm.symbol} onChange={e => setOrderForm(prev => ({ ...prev, symbol: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Mercado</Label>
                      <Select value={orderForm.marketType} onValueChange={v => setOrderForm(prev => ({ ...prev, marketType: v as 'spot' | 'futures' | 'margin' }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="futures">Futures</SelectItem>
                          <SelectItem value="spot">Spot</SelectItem>
                          <SelectItem value="margin">Margin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Lado</Label>
                      <Select value={orderForm.side} onValueChange={v => setOrderForm(prev => ({ ...prev, side: v as 'buy' | 'sell' }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="buy">Comprar (Long)</SelectItem>
                          <SelectItem value="sell">Vender (Short)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Tipo</Label>
                      <Select value={orderForm.orderType} onValueChange={v => setOrderForm(prev => ({ ...prev, orderType: v as 'market' | 'limit' | 'stop' }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="market">Market</SelectItem>
                          <SelectItem value="limit">Limit</SelectItem>
                          <SelectItem value="stop">Stop</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Tamanho</Label>
                      <Input type="number" value={orderForm.size} onChange={e => setOrderForm(prev => ({ ...prev, size: e.target.value }))} placeholder="0.001" />
                    </div>
                    <div>
                      <Label>Alavancagem</Label>
                      <Input type="number" value={orderForm.leverage} onChange={e => setOrderForm(prev => ({ ...prev, leverage: e.target.value }))} />
                    </div>
                  </div>

                  {orderForm.orderType !== 'market' && (
                    <div>
                      <Label>Preço</Label>
                      <Input type="number" value={orderForm.price} onChange={e => setOrderForm(prev => ({ ...prev, price: e.target.value }))} placeholder="Preço alvo" />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Stop Loss</Label>
                      <Input type="number" value={orderForm.stopLoss} onChange={e => setOrderForm(prev => ({ ...prev, stopLoss: e.target.value }))} placeholder="Opcional" />
                    </div>
                    <div>
                      <Label>Take Profit</Label>
                      <Input type="number" value={orderForm.takeProfit} onChange={e => setOrderForm(prev => ({ ...prev, takeProfit: e.target.value }))} placeholder="Opcional" />
                    </div>
                  </div>

                  <Button
                    onClick={() => createOrderMutation.mutate()}
                    disabled={!orderForm.size || createOrderMutation.isPending}
                    className="w-full"
                  >
                    {createOrderMutation.isPending ? 'Criando...' : `${orderForm.side === 'buy' ? 'Comprar' : 'Vender'} ${orderForm.symbol}`}
                  </Button>

                  {createOrderMutation.error && (
                    <p className="text-sm text-destructive">{(createOrderMutation.error as Error).message}</p>
                  )}
                </div>
              </ScrollArea>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Métricas Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Saldo Disponível</span>
            </div>
            <p className="text-2xl font-bold mt-1">
              ${balance ? formatMoney(balance.available) : '---'}
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
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">PnL Total</span>
            </div>
            <p className={`text-2xl font-bold mt-1 ${getPnlColor(totalPnl)}`}>
              ${formatMoney(totalPnl)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Win Rate</span>
            </div>
            <p className="text-2xl font-bold mt-1">{winRate.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">{winCount}W / {lossCount}L</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="positions">Posições</TabsTrigger>
          <TabsTrigger value="orders">Ordens</TabsTrigger>
          <TabsTrigger value="postmortems">Post-Mortems</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>

        {/* Tab: Visão Geral */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Posições Abertas */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Posições Abertas</CardTitle>
              </CardHeader>
              <CardContent>
                {openPositions.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">Nenhuma posição aberta</p>
                ) : (
                  <div className="space-y-3">
                    {openPositions.map(pos => (
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
                          </p>
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => closePositionMutation.mutate(pos.id)}
                          disabled={closePositionMutation.isPending}
                        >
                          Fechar
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
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Na fila</span>
                    <Badge variant="outline">{queueStatsQuery.data?.pending ?? 0}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">DLQ (falhos)</span>
                    <Badge variant={queueStatsQuery.data?.dlq ? 'destructive' : 'outline'}>
                      {queueStatsQuery.data?.dlq ?? 0}
                    </Badge>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Total Completos</span>
                    <Badge>{(postmortemsQuery.data ?? []).filter(pm => pm.status === 'completed').length}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab: Posições */}
        <TabsContent value="positions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Posições Abertas</CardTitle>
            </CardHeader>
            <CardContent>
              {openPositions.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">Nenhuma posição aberta</p>
              ) : (
                <div className="space-y-3">
                  {openPositions.map(pos => (
                    <div key={pos.id} className="p-4 border rounded-lg space-y-2">
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
                        <Button variant="destructive" onClick={() => closePositionMutation.mutate(pos.id)}>
                          Fechar Posição
                        </Button>
                      </div>
                      <div className="grid grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Entrada</span>
                          <p className="font-mono">${formatMoney(pos.entryPrice)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Tamanho</span>
                          <p className="font-mono">{pos.size}</p>
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
                    </div>
                  ))}
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
              {(ordersQuery.data ?? []).length === 0 ? (
                <p className="text-muted-foreground text-center py-8">Nenhuma ordem encontrada</p>
              ) : (
                <div className="space-y-2">
                  {(ordersQuery.data ?? []).map(order => (
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
              {(postmortemsQuery.data ?? []).length === 0 ? (
                <p className="text-muted-foreground text-center py-8">Nenhum post-mortem ainda. Feche uma posição para gerar automaticamente.</p>
              ) : (
                <div className="space-y-3">
                  {(postmortemsQuery.data ?? []).map(pm => (
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
                      {pm.motivators && pm.motivators.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-sm font-semibold flex items-center gap-1">
                            <BookOpen className="h-3 w-3" /> Motivadores
                          </h4>
                          {pm.motivators.map((m, i) => (
                            <div key={i} className="ml-4 text-sm">
                              <p className="font-medium">{m.title}</p>
                              <p className="text-muted-foreground">{m.explanation}</p>
                              {Object.keys(m.citedValues).length > 0 && (
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
                          {pm.lessons.repeat.length > 0 && (
                            <div>
                              <h4 className="text-sm font-semibold text-green-500 flex items-center gap-1">
                                <CheckCircle className="h-3 w-3" /> Repetir
                              </h4>
                              <ul className="ml-4 text-sm text-muted-foreground list-disc">
                                {pm.lessons.repeat.map((l, i) => <li key={i}>{l}</li>)}
                              </ul>
                            </div>
                          )}
                          {pm.lessons.avoid.length > 0 && (
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
                    <p className="text-muted-foreground text-center py-8">Nenhuma posição fechada</p>
                  ) : (
                    <div className="space-y-2">
                      {closedPositions.map(pos => {
                        const pnl = parseFloat(pos.realizedPnl ?? '0');
                        return (
                          <div key={pos.id} className="flex items-center justify-between p-3 border rounded-lg">
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
                    <p className="text-muted-foreground text-center py-8">Nenhum registro</p>
                  ) : (
                    <div className="space-y-2">
                      {(fundHistoryQuery.data ?? []).map(entry => (
                        <div key={entry.id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div>
                            <p className="text-sm font-medium">{entry.note ?? entry.action}</p>
                            <p className="text-xs text-muted-foreground">{formatDate(entry.createdAt)}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-mono font-medium">
                              {entry.action.includes('debit') ? '-' : '+'}{formatMoney(entry.amount)} {entry.currency}
                            </p>
                            <p className="text-xs text-muted-foreground">Saldo: ${formatMoney(entry.balanceAfter)}</p>
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
      </Tabs>
    </div>
  );
}
