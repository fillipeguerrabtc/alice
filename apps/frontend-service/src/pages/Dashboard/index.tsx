import { startTransition, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Settings2,
  ShieldAlert,
  TimerReset,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  type DashboardHomeCardId,
  type DashboardHomeResolvedCardPreferences,
  type DashboardHomeResolvedPreferences,
} from '@alice/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/utils';
import {
  buildNextDashboardPreferences,
  dashboardCardRegistry,
  dashboardSourceRegistry,
  getAvailableDashboardCardIds,
  getDashboardSourceIds,
  getEnabledDashboardCardIds,
  selectActionRequiredAlerts,
  selectFinanceSnapshotItems,
  selectHealthMetrics,
  selectRecentActivityItems,
  selectRoutingSnapshotItems,
  selectTrainingSnapshotItems,
  splitDashboardCardsByFold,
} from './dashboard-home-registry';
import type {
  DashboardFinanceSource,
  DashboardHealthSource,
  DashboardHomeConfigResponse,
  DashboardPrioritySource,
  DashboardRecentActivitySource,
  DashboardRoutingSource,
  DashboardSourceId,
  DashboardTrainingSource,
  DashboardTrendSource,
} from './types';

type DashboardPreferencesUpdateResponse = {
  meta: {
    generatedAt: string;
    preferenceVersion: number;
  };
  permissions: DashboardHomeConfigResponse['permissions'];
  preferences: DashboardHomeResolvedPreferences;
  enabledCardIds: DashboardHomeCardId[];
  availableCardIds: DashboardHomeCardId[];
};

const metricSetLabels: Record<string, string> = {
  all: 'Tudo',
  platform: 'Plataforma',
  support: 'Atendimento',
  routing: 'Routing',
  training: 'Training',
  overview: 'Visão geral',
  urgent: 'Urgentes',
  conversations: 'Conversas',
  tokens: 'Tokens',
  operations: 'Operações',
  exceptions: 'Exceções',
  capacity: 'Capacidade',
  cashflow: 'Fluxo financeiro',
};

const timeRangeLabels: Record<string, string> = {
  '24h': '24h',
  '7d': '7 dias',
  '14d': '14 dias',
  '30d': '30 dias',
};

function DashboardHeader(props: {
  activeCardsCount: number;
  onOpenSettings: () => void;
  preferencesReady: boolean;
  savePending: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-3xl border bg-card/70 p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-xl"
            aria-label="Abrir configurações globais da home"
            onClick={props.onOpenSettings}
            disabled={!props.preferencesReady}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Home da dashboard</h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Superfície operacional progressiva com menos ruído inicial e cards configuráveis por usuário.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="rounded-full px-3 py-1">
            {props.activeCardsCount} card(s) ativo(s)
          </Badge>
          {props.savePending ? (
            <Badge variant="outline" className="rounded-full px-3 py-1">
              Salvando preferências...
            </Badge>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DashboardCardShell(props: {
  title: string;
  description: string;
  href?: string | null;
  onNavigate: (href: string) => void;
  onOpenSettings: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="min-w-0 overflow-hidden rounded-2xl border shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className="break-words">{props.title}</CardTitle>
            <CardDescription className="break-words">{props.description}</CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {props.href ? (
              <Button type="button" variant="outline" size="sm" onClick={() => props.onNavigate(props.href!)}>
                Abrir
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-lg"
              aria-label={`Configurar card ${props.title}`}
              onClick={props.onOpenSettings}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}

function DashboardCardError(props: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4">
      <p className="text-sm text-muted-foreground">{props.message}</p>
      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={props.onRetry}>
        <RefreshCw className="mr-2 h-4 w-4" />
        Tentar novamente
      </Button>
    </div>
  );
}

function DashboardCardLoading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
    </div>
  );
}

function DashboardGlobalSettingsDialog(props: {
  availableCardIds: DashboardHomeCardId[];
  open: boolean;
  preferences: DashboardHomeResolvedPreferences | null;
  onConfigureCard: (cardId: DashboardHomeCardId) => void;
  onOpenChange: (open: boolean) => void;
  onToggleCard: (cardId: DashboardHomeCardId, enabled: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Configurar home da dashboard</DialogTitle>
          <DialogDescription>
            Escolha quais cards entram na home e refine a composição sem criar uma segunda fonte de verdade fora de `users.preferencias`.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {props.availableCardIds.map((cardId) => {
            const card = dashboardCardRegistry[cardId];
            const enabled = props.preferences?.cards[cardId]?.enabled === true;

            return (
              <div key={cardId} className="flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-foreground">{card.title}</p>
                  <p className="text-sm leading-6 text-muted-foreground">{card.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`dashboard-home-toggle-${cardId}`}>Ativo</Label>
                    <Switch
                      id={`dashboard-home-toggle-${cardId}`}
                      checked={enabled}
                      onCheckedChange={(checked) => props.onToggleCard(cardId, checked)}
                    />
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => props.onConfigureCard(cardId)}>
                    Configurar
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DashboardCardSettingsDialog(props: {
  activeCardId: DashboardHomeCardId | null;
  open: boolean;
  preferences: DashboardHomeResolvedPreferences | null;
  onOpenChange: (open: boolean) => void;
  onSave: (cardId: DashboardHomeCardId, nextConfig: DashboardHomeResolvedCardPreferences) => void;
}) {
  const cardId = props.activeCardId;
  const [draftConfig, setDraftConfig] = useState<DashboardHomeResolvedCardPreferences | null>(null);

  useEffect(() => {
    if (!cardId || !props.preferences) {
      setDraftConfig(null);
      return;
    }

    setDraftConfig(props.preferences.cards[cardId]);
  }, [cardId, props.preferences]);

  if (!cardId || !draftConfig) {
    return null;
  }

  const card = dashboardCardRegistry[cardId];

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange(open);
        if (!open) {
          setDraftConfig(null);
        }
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{card.title}</DialogTitle>
          <DialogDescription>{card.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex items-center justify-between rounded-xl border p-4">
            <div className="space-y-1">
              <p className="font-medium text-foreground">Exibir card</p>
              <p className="text-sm text-muted-foreground">Desative o card se ele não precisar fazer parte da sua rotina.</p>
            </div>
            <Switch
              aria-label={`Ativar ou desativar ${card.title}`}
              checked={draftConfig.enabled === true}
              onCheckedChange={(checked) => {
                setDraftConfig((current) => current ? { ...current, enabled: checked } : current);
              }}
            />
          </div>

          {card.supportedMetricSets.length > 0 ? (
            <div className="space-y-2">
              <Label htmlFor={`dashboard-card-metric-set-${cardId}`}>Tipo de dado</Label>
              <Select
                value={draftConfig.metricSet ?? card.supportedMetricSets[0]}
                onValueChange={(value) => {
                  setDraftConfig((current) => current ? { ...current, metricSet: value as DashboardHomeResolvedCardPreferences['metricSet'] } : current);
                }}
              >
                <SelectTrigger id={`dashboard-card-metric-set-${cardId}`}>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {card.supportedMetricSets.map((metricSet) => (
                    <SelectItem key={metricSet} value={metricSet}>
                      {metricSetLabels[metricSet] ?? metricSet}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {card.supportedTimeRanges.length > 0 ? (
            <div className="space-y-2">
              <Label htmlFor={`dashboard-card-time-range-${cardId}`}>Janela</Label>
              <Select
                value={draftConfig.timeRange ?? card.supportedTimeRanges[0]}
                onValueChange={(value) => {
                  setDraftConfig((current) => current ? { ...current, timeRange: value as DashboardHomeResolvedCardPreferences['timeRange'] } : current);
                }}
              >
                <SelectTrigger id={`dashboard-card-time-range-${cardId}`}>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {card.supportedTimeRanges.map((timeRange) => (
                    <SelectItem key={timeRange} value={timeRange}>
                      {timeRangeLabels[timeRange] ?? timeRange}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {card.supportedLimits.length > 0 ? (
            <div className="space-y-2">
              <Label htmlFor={`dashboard-card-limit-${cardId}`}>Limite</Label>
              <Select
                value={String(draftConfig.limit ?? card.supportedLimits[0])}
                onValueChange={(value) => {
                  setDraftConfig((current) => current ? { ...current, limit: Number(value) } : current);
                }}
              >
                <SelectTrigger id={`dashboard-card-limit-${cardId}`}>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {card.supportedLimits.map((limit) => (
                    <SelectItem key={limit} value={String(limit)}>
                      {limit} itens
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => {
              props.onSave(cardId, draftConfig);
              props.onOpenChange(false);
            }}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function renderDashboardCard(params: {
  cardId: DashboardHomeCardId;
  locale: string;
  onNavigate: (href: string) => void;
  onOpenSettings: () => void;
  onRetry: (sourceId: DashboardSourceId) => void;
  sourceResult: {
    error: Error | null;
    isLoading: boolean;
    data: unknown;
  } | undefined;
  preferences: DashboardHomeResolvedPreferences;
}) {
  const card = dashboardCardRegistry[params.cardId];
  const sourceResult = params.sourceResult;
  const config = params.preferences.cards[params.cardId];

  return (
    <DashboardCardShell
      title={card.title}
      description={card.description}
      href={card.href}
      onNavigate={params.onNavigate}
      onOpenSettings={params.onOpenSettings}
    >
      {sourceResult?.isLoading ? (
        <DashboardCardLoading />
      ) : sourceResult?.error ? (
        <DashboardCardError
          message="Não foi possível carregar este card agora."
          onRetry={() => params.onRetry(card.sourceId)}
        />
      ) : (() => {
        switch (params.cardId) {
          case 'actionRequired': {
            const source = sourceResult?.data as DashboardPrioritySource | undefined;
            const alerts = source ? selectActionRequiredAlerts(source, config) : [];

            if (!alerts.length) {
              return (
                <EmptyState
                  title="Nenhum alerta priorizado neste momento."
                  description="Os sinais críticos e de atenção voltam a aparecer assim que houver mudança operacional."
                />
              );
            }

            return (
              <div className="space-y-3">
                {alerts.map((alert) => (
                  <div key={alert.id} className="rounded-xl border p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={alert.severity === 'critical' ? 'border-transparent bg-destructive text-destructive-foreground' : 'border-transparent bg-amber-100 text-amber-950 dark:bg-amber-500/20 dark:text-amber-100'}>
                            {alert.severity === 'critical' ? 'Crítico' : 'Atenção'}
                          </Badge>
                          <span className="text-sm font-medium text-muted-foreground">{alert.count} ocorrência(s)</span>
                        </div>
                        <p className="font-medium text-foreground">{alert.title}</p>
                        <p className="text-sm text-muted-foreground">{alert.description}</p>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => params.onNavigate(alert.href)}>
                        Abrir
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            );
          }
          case 'supportQueue': {
            const source = sourceResult?.data as DashboardPrioritySource | undefined;
            const metricSet = config.metricSet ?? 'overview';
            const items = metricSet === 'urgent'
              ? [
                  { id: 'urgent', label: 'Urgentes', value: source?.support.urgentHandoffs ?? 0 },
                  { id: 'pending', label: 'Pendentes', value: source?.support.pendingHandoffs ?? 0 },
                ]
              : [
                  { id: 'pending', label: 'Pendentes', value: source?.support.pendingHandoffs ?? 0 },
                  { id: 'urgent', label: 'Urgentes', value: source?.support.urgentHandoffs ?? 0 },
                  { id: 'agents', label: 'Agentes humanos', value: source?.support.activeHumanAgents ?? 0 },
                ];

            return (
              <div className="grid gap-3 md:grid-cols-3">
                {items.map((item) => (
                  <div key={item.id} className="rounded-xl border bg-muted/20 p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground">{item.label}</p>
                    <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
                      {formatNumber(item.value, params.locale)}
                    </p>
                  </div>
                ))}
              </div>
            );
          }
          case 'conversationTrend': {
            const source = sourceResult?.data as DashboardTrendSource | undefined;
            const metric = config.metricSet ?? 'conversations';
            const timeRange = config.timeRange ?? '7d';
            const selectedMetric = source?.metrics.find((item) => item.id === metric) ?? source?.metrics[0];
            const selectedSeries = selectedMetric?.seriesByWindow[timeRange as '7d' | '30d'] ?? [];

            if (!selectedSeries.length) {
              return (
                <EmptyState
                  title="Sem dados suficientes para a tendência."
                  description="Assim que houver volume no período selecionado, a série aparece aqui."
                />
              );
            }

            return selectedMetric?.id === 'conversations' ? (
              <div className="space-y-4">
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={selectedSeries}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} />
                      <Tooltip />
                      <Bar dataKey="ai" stackId="conversations" fill="#2563eb" radius={[6, 6, 0, 0]} name="IA" />
                      <Bar dataKey="human" stackId="conversations" fill="#f59e0b" radius={[6, 6, 0, 0]} name="Humano" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-sm text-muted-foreground">
                  A troca de janela e métrica reutiliza o dataset já carregado, sem apagar agressivamente o conteúdo visível.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={selectedSeries}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} />
                      <Tooltip formatter={(value: number) => formatNumber(Number(value), params.locale)} />
                      <Line
                        type="monotone"
                        dataKey="total"
                        stroke="#0f766e"
                        strokeWidth={3}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                        name="Tokens"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-sm text-muted-foreground">
                  Tokens por dia no período selecionado, mantendo leitura estável durante a reconfiguração local do card.
                </p>
              </div>
            );
          }
          case 'platformHealth': {
            const source = sourceResult?.data as DashboardHealthSource | undefined;
            const metrics = source ? selectHealthMetrics(source, config) : [];

            return (
              <div className="grid gap-3 md:grid-cols-2">
                {metrics.map((metric) => (
                  <div key={metric.id} className="rounded-xl border p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      {metric.id === 'services' ? <Activity className="h-4 w-4" /> : null}
                      {metric.id === 'breakers' ? <ShieldAlert className="h-4 w-4" /> : null}
                      {metric.id === 'sla' ? <AlertTriangle className="h-4 w-4" /> : null}
                      {metric.id === 'latency' ? <TimerReset className="h-4 w-4" /> : null}
                      {metric.label}
                    </div>
                    <p className="mt-3 text-lg font-semibold text-foreground">{metric.value}</p>
                  </div>
                ))}
              </div>
            );
          }
          case 'recentActivity': {
            const source = sourceResult?.data as DashboardRecentActivitySource | undefined;
            const items = source ? selectRecentActivityItems(source, config) : [];

            if (!items.length) {
              return (
                <EmptyState
                  title="Nenhuma atividade recente para este recorte."
                  description="A atividade volta a aparecer aqui assim que houver eventos relevantes na janela escolhida."
                />
              );
            }

            return (
              <div className="space-y-3">
                {items.map((item) => (
                  <div key={item.id} className="rounded-xl border p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium text-foreground">{item.title}</p>
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.actor} • {item.timestamp ? formatDateTime(item.timestamp, { locale: params.locale }) : '-'}
                        </p>
                      </div>
                      {item.href ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => params.onNavigate(item.href!)}>
                          Abrir
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            );
          }
          case 'routingSnapshot': {
            const source = sourceResult?.data as DashboardRoutingSource | undefined;
            const items = source ? selectRoutingSnapshotItems(source, config) : [];

            return (
              <div className="grid gap-3 sm:grid-cols-3">
                {items.map((item) => (
                  <div key={item.label} className="rounded-xl border bg-muted/20 p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground">{item.label}</p>
                    <p className="mt-3 text-2xl font-semibold text-foreground">{formatNumber(item.value, params.locale)}</p>
                  </div>
                ))}
              </div>
            );
          }
          case 'trainingSnapshot': {
            const source = sourceResult?.data as DashboardTrainingSource | undefined;
            const items = source ? selectTrainingSnapshotItems(source, config) : [];

            return (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {items.map((item) => (
                  <div key={item.label} className="rounded-xl border bg-muted/20 p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground">{item.label}</p>
                    <p className="mt-3 text-2xl font-semibold text-foreground">{typeof item.value === 'number' ? formatNumber(item.value, params.locale) : item.value}</p>
                  </div>
                ))}
              </div>
            );
          }
          case 'financeSnapshot': {
            const source = sourceResult?.data as DashboardFinanceSource | undefined;
            const items = source ? selectFinanceSnapshotItems(source, config) : [];

            return (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {items.map((item) => (
                  <div key={item.label} className="rounded-xl border bg-muted/20 p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground">{item.label}</p>
                    <p className="mt-3 text-2xl font-semibold text-foreground">
                      {item.kind === 'currency'
                        ? formatCurrency(item.value, source?.metrics.stripeCurrency ?? 'EUR', params.locale)
                        : formatNumber(item.value, params.locale)}
                    </p>
                  </div>
                ))}
              </div>
            );
          }
          default:
            return null;
        }
      })()}
    </DashboardCardShell>
  );
}

function getCardLayoutClass(cardId: DashboardHomeCardId): string {
  switch (cardId) {
    case 'actionRequired':
      return 'xl:col-span-7';
    case 'supportQueue':
      return 'xl:col-span-5';
    case 'conversationTrend':
      return 'xl:col-span-12';
    default:
      return 'xl:col-span-6';
  }
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const locale = user?.idioma ?? 'pt-BR';
  const queryClient = useQueryClient();
  const [isGlobalSettingsOpen, setIsGlobalSettingsOpen] = useState(false);
  const [activeCardId, setActiveCardId] = useState<DashboardHomeCardId | null>(null);
  const [belowFoldReady, setBelowFoldReady] = useState(false);
  const [localPreferences, setLocalPreferences] = useState<DashboardHomeResolvedPreferences | null>(null);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setBelowFoldReady(true);
    }, 120);

    return () => {
      window.clearTimeout(timerId);
    };
  }, []);

  const dashboardConfigQuery = useQuery<DashboardHomeConfigResponse>({
    queryKey: ['/api/dashboard/home/config'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/dashboard/home/config');
      return response.json();
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!dashboardConfigQuery.data?.preferences) {
      return;
    }

    setLocalPreferences(dashboardConfigQuery.data.preferences);
  }, [dashboardConfigQuery.data?.preferences]);

  const activeConfig = dashboardConfigQuery.data;
  const preferences = localPreferences ?? activeConfig?.preferences ?? null;
  const availableCardIds = activeConfig ? getAvailableDashboardCardIds(activeConfig) : [];
  const enabledCardIds = activeConfig && preferences
    ? getEnabledDashboardCardIds({
        ...activeConfig,
        preferences,
      })
    : [];
  const cardGroups = splitDashboardCardsByFold(enabledCardIds);
  const sourceIds = getDashboardSourceIds(enabledCardIds);
  const sourceModeById = new Map<DashboardSourceId, 'aboveFold' | 'belowFold'>();

  for (const cardId of enabledCardIds) {
    const sourceId = dashboardCardRegistry[cardId].sourceId;
    const currentMode = sourceModeById.get(sourceId);
    if (currentMode === 'aboveFold') {
      continue;
    }
    sourceModeById.set(sourceId, dashboardCardRegistry[cardId].loadStrategy);
  }

  const sourceQueries = useQueries({
    queries: sourceIds.map((sourceId) => {
      const mode = sourceModeById.get(sourceId) ?? 'belowFold';
      return dashboardSourceRegistry[sourceId].buildQueryOptions(mode === 'aboveFold' || belowFoldReady);
    }),
  });

  const sourceResultById = useMemo(() => {
    return sourceIds.reduce((accumulator, sourceId, index) => {
      const query = sourceQueries[index];
      accumulator[sourceId] = {
        data: query.data,
        error: query.error as Error | null,
        isLoading: query.isLoading,
      };
      return accumulator;
    }, {} as Record<DashboardSourceId, { data: unknown; error: Error | null; isLoading: boolean }>);
  }, [sourceIds, sourceQueries]);

  const savePreferencesMutation = useMutation({
    mutationFn: async (dashboardHome: DashboardHomeResolvedPreferences) => {
      const response = await apiRequest('PUT', '/api/dashboard/home/preferences', { dashboardHome });
      return response.json() as Promise<DashboardPreferencesUpdateResponse>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData<DashboardHomeConfigResponse>(['/api/dashboard/home/config'], (current: DashboardHomeConfigResponse | undefined) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          meta: data.meta,
          permissions: data.permissions,
          preferences: data.preferences,
          enabledCardIds: data.enabledCardIds,
          availableCardIds: data.availableCardIds,
        };
      });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    },
  });

  function navigateTo(href: string) {
    navigate(href);
  }

  function persistPreferences(nextPreferences: DashboardHomeResolvedPreferences) {
    if (!activeConfig || !preferences) {
      return;
    }

    const previousPreferences = preferences;
    startTransition(() => {
      setLocalPreferences(nextPreferences);
    });

    savePreferencesMutation.mutate(nextPreferences, {
      onError: () => {
        setLocalPreferences(previousPreferences);
        toast({
          title: 'Falha ao salvar configurações da home',
          description: 'As preferências foram restauradas para evitar estado inconsistente.',
          variant: 'destructive',
        });
      },
      onSuccess: () => {
        setLocalPreferences(nextPreferences);
      },
    });
  }

  function updatePreferences(
    updater: (current: DashboardHomeResolvedPreferences) => DashboardHomeResolvedPreferences,
  ) {
    if (!activeConfig || !preferences) {
      return;
    }

    const nextPreferences = buildNextDashboardPreferences({
      current: preferences,
      permissions: activeConfig.permissions,
      updater,
    });

    persistPreferences(nextPreferences);
  }

  function handleToggleCard(cardId: DashboardHomeCardId, enabled: boolean) {
    updatePreferences((current) => ({
      ...current,
      cards: {
        ...current.cards,
        [cardId]: {
          ...current.cards[cardId],
          enabled,
        },
      },
      visibleCardIds: enabled
        ? [...current.visibleCardIds, cardId]
        : current.visibleCardIds.filter((visibleCardId) => visibleCardId !== cardId),
    }));
  }

  function handleSaveCardConfig(
    cardId: DashboardHomeCardId,
    nextConfig: DashboardHomeResolvedCardPreferences,
  ) {
    updatePreferences((current) => ({
      ...current,
      cards: {
        ...current.cards,
        [cardId]: {
          ...current.cards[cardId],
          ...nextConfig,
        },
      },
      visibleCardIds: nextConfig.enabled === false
        ? current.visibleCardIds.filter((visibleCardId) => visibleCardId !== cardId)
        : current.visibleCardIds.includes(cardId)
          ? current.visibleCardIds
          : [...current.visibleCardIds, cardId],
    }));
  }

  function handleRetrySource(sourceId: DashboardSourceId) {
    queryClient.invalidateQueries({
      queryKey: dashboardSourceRegistry[sourceId].buildQueryOptions(true).queryKey,
    });
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <DashboardHeader
        activeCardsCount={enabledCardIds.length}
        onOpenSettings={() => setIsGlobalSettingsOpen(true)}
        preferencesReady={Boolean(preferences)}
        savePending={savePreferencesMutation.isPending}
      />

      {dashboardConfigQuery.isLoading && !preferences ? (
        <div className="grid gap-4 xl:grid-cols-12">
          <div className="xl:col-span-7">
            <DashboardCardLoading />
          </div>
          <div className="xl:col-span-5">
            <DashboardCardLoading />
          </div>
          <div className="xl:col-span-12">
            <DashboardCardLoading />
          </div>
        </div>
      ) : dashboardConfigQuery.error ? (
        <Card className="rounded-2xl border shadow-sm">
          <CardHeader>
            <CardTitle>Não foi possível montar a home configurável</CardTitle>
            <CardDescription>
              A home antiga deixou de ser a fonte primária. Recarregue a configuração para continuar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DashboardCardError
              message="Falha ao carregar a configuração base da home."
              onRetry={() => {
                queryClient.invalidateQueries({ queryKey: ['/api/dashboard/home/config'] });
              }}
            />
          </CardContent>
        </Card>
      ) : preferences ? (
        <>
          {cardGroups.aboveFold.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-12">
              {cardGroups.aboveFold.map((cardId) => (
                <div key={cardId} className={getCardLayoutClass(cardId)}>
                  {renderDashboardCard({
                    cardId,
                    locale,
                    onNavigate: navigateTo,
                    onOpenSettings: () => setActiveCardId(cardId),
                    onRetry: handleRetrySource,
                    sourceResult: sourceResultById[dashboardCardRegistry[cardId].sourceId],
                    preferences,
                  })}
                </div>
              ))}
            </div>
          ) : null}

          {cardGroups.belowFold.length > 0 ? (
            <>
              <Separator />
              <div className="grid gap-4 xl:grid-cols-12">
                {cardGroups.belowFold.map((cardId) => (
                  <div key={cardId} className={getCardLayoutClass(cardId)}>
                    {renderDashboardCard({
                      cardId,
                      locale,
                      onNavigate: navigateTo,
                      onOpenSettings: () => setActiveCardId(cardId),
                      onRetry: handleRetrySource,
                      sourceResult: sourceResultById[dashboardCardRegistry[cardId].sourceId],
                      preferences,
                    })}
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : null}

      <DashboardGlobalSettingsDialog
        availableCardIds={availableCardIds}
        open={isGlobalSettingsOpen}
        preferences={preferences}
        onOpenChange={setIsGlobalSettingsOpen}
        onToggleCard={handleToggleCard}
        onConfigureCard={(cardId) => {
          setIsGlobalSettingsOpen(false);
          setActiveCardId(cardId);
        }}
      />

      <DashboardCardSettingsDialog
        activeCardId={activeCardId}
        open={Boolean(activeCardId)}
        preferences={preferences}
        onOpenChange={(open) => {
          if (!open) {
            setActiveCardId(null);
          }
        }}
        onSave={handleSaveCardConfig}
      />
    </div>
  );
}
