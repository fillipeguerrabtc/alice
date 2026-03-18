/**
 * Dashboard Admin - Alice Enterprise Platform
 * 
 * Painel de controle enterprise com métricas em tempo real de todos os serviços.
 * Design moderno 2025 com animações Framer Motion.
 * Integração completa: Chat, RAG, Training, Stripe, Wise.
 * 
 * Regra 6 - SEM MOCKS: Apenas dados reais da API
 * Regra 10 - Documentação PT-BR
 * Regra 13 - Internacionalização i18next
 */

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  MessageSquare, 
  FileText, 
  Brain, 
  Zap, 
  TrendingUp, 
  Users, 
  Activity,
  Headphones,
  CreditCard,
  Wallet,
  Globe,
  Shield,
  Database,
  Cpu,
  Server,
} from 'lucide-react';
import { 
  AreaChart,
  Area,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/utils';

import {
  DashboardStats,
  UsageData,
  RecentActivity,
  ServiceHealth,
  IntegrationStats,
  ImageGenerationStats,
  TakeoverStats,
  SLAMetrics,
  CircuitBreakerStatus,
  CHART_COLORS,
  PIE_COLORS,
  containerVariants,
  itemVariants,
} from './components/types';
import { StatCard } from './components/StatCard';
import { ServiceHealthCard } from './components/ServiceHealthCard';
import { IntegrationCard } from './components/IntegrationCard';
import { ActivityItem } from './components/ActivityItem';
import { TakeoverStatsCard } from './components/TakeoverStatsCard';
import { ImageGenerationCard } from './components/ImageGenerationCard';
import { SLAMonitorCard } from './components/SLAMonitorCard';
import { CircuitBreakerCard } from './components/CircuitBreakerCard';
import { FallbacksCard } from './components/FallbacksCard';
import { ConversationsBarChart } from './components/ConversationsBarChart';

type ImageStatsApi = {
  total?: number;
  completed?: number;
  pending?: number;
  failed?: number;
  approvedForTraining?: number;
  usedInFineTuning?: number;
  averageGenerationTimeMs?: number;
  totalGenerated?: number;
  approved?: number;
  inTraining?: number;
  avgRating?: number;
};

type RecentActivityApi = {
  id?: string | number;
  action?: unknown;
  time?: unknown;
  timestamp?: unknown;
  user?: unknown;
  type?: unknown;
};

const RECENT_ACTIVITY_TYPES: ReadonlySet<NonNullable<RecentActivity['type']>> = new Set([
  'chat',
  'document',
  'training',
  'payment',
  'system',
]);

function toDisplayString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function normalizeRecentActivity(activity: RecentActivityApi, locale: string, index: number): RecentActivity {
  const id = toDisplayString(activity.id) ?? `activity-${index}`;
  const action = toDisplayString(activity.action) ?? 'Ação registrada';

  let time = toDisplayString(activity.time);
  if (!time && (typeof activity.timestamp === 'string' || typeof activity.timestamp === 'number' || activity.timestamp instanceof Date)) {
    const parsedDate = new Date(activity.timestamp);
    if (!Number.isNaN(parsedDate.getTime())) {
      time = formatDateTime(parsedDate, { locale });
    }
  }

  let user = toDisplayString(activity.user);
  if (!user && activity.user && typeof activity.user === 'object') {
    const structuredUser = activity.user as { id?: unknown; name?: unknown; email?: unknown };
    user =
      toDisplayString(structuredUser.name) ??
      toDisplayString(structuredUser.email) ??
      toDisplayString(structuredUser.id);
  }

  const type =
    typeof activity.type === 'string' && RECENT_ACTIVITY_TYPES.has(activity.type as NonNullable<RecentActivity['type']>)
      ? (activity.type as NonNullable<RecentActivity['type']>)
      : 'system';

  return {
    id,
    action,
    time: time ?? '-',
    user: user ?? 'Sistema',
    type,
  };
}

function normalizeImageStats(stats?: ImageStatsApi | null): ImageGenerationStats {
  if (!stats) {
    return {
      totalGenerated: 0,
      approved: 0,
      pending: 0,
      inTraining: 0,
      avgRating: 0,
    };
  }

  return {
    totalGenerated: stats.totalGenerated ?? stats.total ?? 0,
    approved: stats.approved ?? stats.approvedForTraining ?? 0,
    pending: stats.pending ?? 0,
    inTraining: stats.inTraining ?? stats.usedInFineTuning ?? 0,
    avgRating: Number.isFinite(stats.avgRating) ? Number(stats.avgRating) : 0,
  };
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const locale = user?.idioma ?? 'pt-BR';

  const navigateTo = useCallback((path: string) => {
    navigate(path);
  }, [navigate]);

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ['/api/chat/stats'],
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60,
  });

  const { data: usageData, isLoading: usageLoading } = useQuery<UsageData[]>({
    queryKey: ['/api/chat/usage'],
    staleTime: 1000 * 60 * 5,
  });

  const { data: recentActivity, isLoading: activityLoading } = useQuery<RecentActivityApi[]>({
    queryKey: ['/api/audit/recent'],
    staleTime: 1000 * 60,
  });

  const { data: healthData, isLoading: healthLoading } = useQuery<{
    services: Array<{
      name: string;
      status: 'healthy' | 'unhealthy' | 'unknown';
      uptime: number;
      requestsPerMinute: number;
      avgLatency: number;
    }>;
  }>({
    queryKey: ['/api/observability/metrics/services'],
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 30,
  });

  const { data: imageStats, isLoading: imageStatsLoading } = useQuery<ImageStatsApi>({
    queryKey: ['/api/chat/images/stats'],
    staleTime: 1000 * 60 * 2,
    refetchInterval: 1000 * 60 * 2,
  });

  const { data: takeoverStats, isLoading: takeoverLoading } = useQuery<TakeoverStats>({
    queryKey: ['/api/chat/takeover-stats'],
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 30,
  });

  const { data: slaMetrics, isLoading: slaLoading } = useQuery<SLAMetrics>({
    queryKey: ['/api/observability/metrics/sla', user?.tenantId],
    enabled: Boolean(user?.tenantId),
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 30,
    queryFn: async () => {
      const response = await fetch(`/api/observability/metrics/sla?tenantId=${user?.tenantId}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Falha ao carregar métricas SLA');
      }
      return response.json();
    },
  });

  const { data: circuitBreakerData, isLoading: circuitBreakerLoading } = useQuery<{ breakers: CircuitBreakerStatus[] }>({
    queryKey: ['/api/observability/metrics/circuit-breakers'],
    staleTime: 1000 * 60,
  });

  const { data: weeklyConversations, isLoading: weeklyLoading } = useQuery<{ data: { date: string; name: string; ai: number; human: number }[] }>({
    queryKey: ['/api/chat/conversations/weekly'],
    staleTime: 1000 * 60 * 5,
  });

  const { data: integrationStatsData, isLoading: integrationsLoading } = useQuery<IntegrationStats>({
    queryKey: ['/api/integrations/stats'],
    staleTime: 1000 * 60 * 5,
  });

  const { data: fallbackStats, isLoading: fallbackStatsLoading } = useQuery<{
    total: number;
    last24h: number;
    last7d: number;
    byRoute: Array<{ rota: string; count: number }>;
    byContext: Array<{ contexto: string; count: number }>;
  }>({
    queryKey: ['/api/llm/fallback-stats'],
    staleTime: 1000 * 60 * 2,
    refetchInterval: 1000 * 60 * 2,
    enabled: Boolean(user),
  });

  const { data: unmappedData } = useQuery<{ items: Array<{ rota: string; contexto: string; fallbackCount: number }> }>({
    queryKey: ['/api/namespaces/unmapped-contexts'],
    staleTime: 1000 * 60 * 2,
    refetchInterval: 1000 * 60 * 2,
    enabled: Boolean(user),
  });

  const displayImageStats = normalizeImageStats(imageStats);

  const displayTakeoverStats: TakeoverStats = takeoverStats || {
    pendingHandoffs: 0,
    activeHumanAgents: 0,
    urgentConversations: 0,
    avgResponseTime: 0,
    resolvedByAI: 0,
    resolvedByHuman: 0,
  };

  const integrationStats: IntegrationStats = integrationStatsData || {
    stripe: { totalRevenue: 0, transactions: 0, currency: 'EUR' },
    wise: { totalTransfers: 0, pendingAmount: 0, completedCount: 0 },
  };

  const displayStats: DashboardStats = stats || {
    conversations: 0,
    documents: 0,
    trainingData: 0,
    tokensUsed: 0,
  };

  const displayUsage: UsageData[] = usageData || [];
  const displayActivity: RecentActivity[] = (recentActivity ?? []).map((activity, index) =>
    normalizeRecentActivity(activity, locale, index)
  );
  const displayServices = (healthData?.services ?? []).map((service) => ({
    service: service.name,
    status: service.status === 'healthy' ? 'ok' : service.status === 'unknown' ? 'degraded' : 'down',
    latency: service.avgLatency,
    uptime: service.uptime,
  })) satisfies ServiceHealth[];

  const distributionData = [
    { name: 'Conversas', value: displayStats.conversations, color: '#3b82f6' },
    { name: 'Documentos', value: displayStats.documents, color: '#10b981' },
    { name: 'Training', value: displayStats.trainingData, color: '#f59e0b' },
  ].filter(d => d.value > 0);

  const displaySLAMetrics: SLAMetrics = slaMetrics || {
    breachedCount: 0,
    atRiskCount: 0,
    onTrackCount: 0,
    avgFirstResponseTime: 0,
    avgResolutionTime: 0,
  };

  const displayCircuitBreakers: CircuitBreakerStatus[] = circuitBreakerData?.breakers || [];

  const conversationsBarData = weeklyConversations?.data || [];
  const workspaceAccessCards = [
    {
      title: 'Training & Qualidade',
      description: 'Revisão de dataset, jobs, promoção e materiais que alimentam a qualidade da Alice.',
      icon: Brain,
      accentClassName: 'border-amber-500/30 bg-amber-500/5',
      primaryAction: { label: 'Abrir Training', path: '/training' },
      secondaryActions: [
        { label: 'Documentos', path: '/documents' },
        { label: 'Galeria', path: '/images' },
      ],
    },
    {
      title: 'Administração & Governança',
      description: 'RBAC, namespaces e configurações avançadas ficam concentrados nas superfícies administrativas.',
      icon: Shield,
      accentClassName: 'border-sky-500/30 bg-sky-500/5',
      primaryAction: { label: 'Abrir Usuários', path: '/users' },
      secondaryActions: [
        { label: 'Namespaces', path: '/namespaces' },
        { label: 'Configurações', path: '/system-settings' },
      ],
    },
    {
      title: 'Support & Diagnóstico',
      description: 'Acompanhamento operacional e investigação técnica agora ficam fora do chat principal.',
      icon: Headphones,
      accentClassName: 'border-emerald-500/30 bg-emerald-500/5',
      primaryAction: { label: 'Abrir Observabilidade', path: '/observability' },
      secondaryActions: [
        { label: 'Atendimento', path: '/takeover' },
        { label: 'Conversas', path: '/conversations' },
      ],
    },
  ] as const;
  const handleConversationDaySelect = useCallback((date: string) => {
    const params = new URLSearchParams();
    params.set('from', date);
    params.set('to', date);
    navigate(`/conversations?${params.toString()}`);
  }, [navigate]);

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="p-6 space-y-6"
    >
      <motion.div variants={itemVariants}>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 
              className="text-3xl font-bold tracking-tight" 
              data-testid="text-page-title"
            >
              {t('dashboard.title')}
            </h1>
            <p className="text-muted-foreground">
              {t('dashboard.summary')}
            </p>
          </div>
          <div className="flex items-center gap-2 mt-2 sm:mt-0">
            <Badge variant="outline" className="flex items-center gap-1">
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              {t('dashboard.systemOnline')}
            </Badge>
          </div>
        </div>
      </motion.div>

      <motion.div variants={itemVariants}>
        <div className="grid gap-4 xl:grid-cols-3">
          {workspaceAccessCards.map((card) => (
            <Card key={card.title} className={card.accentClassName}>
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <card.icon className="h-5 w-5 text-primary" />
                      {card.title}
                    </CardTitle>
                    <CardDescription className="mt-2 text-sm text-muted-foreground">
                      {card.description}
                    </CardDescription>
                  </div>
                  <Badge variant="outline">Fluxo dedicado</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => navigateTo(card.primaryAction.path)}>
                  {card.primaryAction.label}
                </Button>
                {card.secondaryActions.map((action) => (
                  <Button
                    key={action.path}
                    size="sm"
                    variant="outline"
                    onClick={() => navigateTo(action.path)}
                  >
                    {action.label}
                  </Button>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </motion.div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t('dashboard.stats.activeConversations')}
          value={displayStats.conversations}
          description={t('dashboard.stats.totalConversations')}
          icon={MessageSquare}
          trend={displayStats.trend?.conversations}
          isLoading={statsLoading}
          accent="default"
          onClick={() => navigateTo('/conversations')}
        />
        <StatCard
          title={t('dashboard.stats.ragDocuments')}
          value={displayStats.documents}
          description={t('nav.knowledge')}
          icon={FileText}
          trend={displayStats.trend?.documents}
          isLoading={statsLoading}
          accent="success"
          onClick={() => navigateTo('/documents')}
        />
        <StatCard
          title={t('nav.training')}
          value={displayStats.trainingData}
          description={t('dashboard.training')}
          icon={Brain}
          trend={displayStats.trend?.trainingData}
          isLoading={statsLoading}
          accent="warning"
          onClick={() => navigateTo('/training')}
        />
        <StatCard
          title={t('dashboard.stats.tokensUsed')}
          value={
            displayStats.tokensUsed > 0
              ? `${formatNumber(displayStats.tokensUsed / 1000, locale, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}K`
              : formatNumber(0, locale)
          }
          description={t('dashboard.usage.tokens')}
          icon={Zap}
          trend={displayStats.trend?.tokensUsed}
          isLoading={statsLoading}
          accent="default"
          onClick={() => navigateTo('/chat')}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <IntegrationCard
          title="Stripe Portugal"
          icon={CreditCard}
          isLoading={integrationsLoading}
          onClick={() => navigateTo('/integrations')}
          stats={
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Receita EUR</span>
                <span className="font-semibold">
                  {integrationStats?.stripe?.totalRevenue
                    ? formatCurrency(integrationStats.stripe.totalRevenue, 'EUR', locale)
                    : formatCurrency(0, 'EUR', locale)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Transações</span>
                <span className="font-medium">
                  {formatNumber(integrationStats?.stripe?.transactions ?? 0, locale)}
                </span>
              </div>
            </div>
          }
        />
        <IntegrationCard
          title="Wise Transfers"
          icon={Wallet}
          isLoading={integrationsLoading}
          onClick={() => navigateTo('/wise')}
          stats={
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Transferências</span>
                <span className="font-semibold">
                  {integrationStats?.wise?.totalTransfers || 0}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Concluídas</span>
                <Badge variant="secondary">
                  {integrationStats?.wise?.completedCount || 0}
                </Badge>
              </div>
            </div>
          }
        />
      </div>

      <motion.div variants={itemVariants}>
        <Card className="bg-gradient-to-r from-blue-500/5 via-purple-500/5 to-pink-500/5 dark:from-blue-500/10 dark:via-purple-500/10 dark:to-pink-500/10">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              Métricas de IA
            </CardTitle>
            <CardDescription>
              Operações autônomas, takeover/handover e geração de imagens
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              <TakeoverStatsCard 
                stats={displayTakeoverStats} 
                isLoading={takeoverLoading} 
                onClick={() => navigateTo('/takeover')}
              />
              <ImageGenerationCard 
                stats={displayImageStats} 
                isLoading={imageStatsLoading} 
                onClick={() => navigateTo('/images')}
              />
              <SLAMonitorCard 
                metrics={displaySLAMetrics} 
                isLoading={slaLoading} 
                onClick={() => navigateTo('/observability')}
              />
              <CircuitBreakerCard 
                breakers={displayCircuitBreakers} 
                isLoading={circuitBreakerLoading} 
                onClick={() => navigateTo('/observability')}
              />
              <FallbacksCard
                fallbackStats={fallbackStats ?? null}
                unmappedContexts={unmappedData?.items ?? []}
                isLoading={fallbackStatsLoading}
                onClick={() => navigateTo('/namespaces')}
              />
            </div>
            <div className="mt-4">
              <ConversationsBarChart 
                data={conversationsBarData} 
                isLoading={weeklyLoading}
                onSelectDate={handleConversationDaySelect}
              />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <Tabs defaultValue="usage" className="space-y-4">
        <TabsList>
          <TabsTrigger value="usage" className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            {t('dashboard.tabs.usage')}
          </TabsTrigger>
          <TabsTrigger value="distribution" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            {t('dashboard.tabs.distribution')}
          </TabsTrigger>
          <TabsTrigger value="services" className="flex items-center gap-2">
            <Cpu className="h-4 w-4" />
            {t('dashboard.tabs.services')}
          </TabsTrigger>
        </TabsList>

        <div className="grid gap-4 md:grid-cols-3">
          <TabsContent value="usage" className="md:col-span-2 mt-0">
            <motion.div variants={itemVariants}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    {t('dashboard.resourceUsage')}
                  </CardTitle>
                  <CardDescription>
                    {t('dashboard.usageDescription')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    {usageLoading ? (
                      <div className="flex items-center justify-center h-full">
                        <Activity className="h-8 w-8 animate-pulse text-muted-foreground" />
                      </div>
                    ) : displayUsage.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={displayUsage}>
                          <defs>
                            <linearGradient id="colorConversations" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.3}/>
                              <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis
                            dataKey="date"
                            className="text-xs"
                            tick={{ fill: 'hsl(var(--muted-foreground))' }}
                          />
                          <YAxis
                            className="text-xs"
                            tick={{ fill: 'hsl(var(--muted-foreground))' }}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'hsl(var(--popover))',
                              border: '1px solid hsl(var(--border))',
                              borderRadius: '0.5rem',
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="conversations"
                            stroke={CHART_COLORS.primary}
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#colorConversations)"
                            name={t('dashboard.charts.conversations')}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <TrendingUp className="h-12 w-12 mb-2 opacity-50" />
                        <p className="text-sm">{t('common.noResults')}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>

          <TabsContent value="distribution" className="md:col-span-2 mt-0">
            <motion.div variants={itemVariants}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    {t('dashboard.distribution.title')}
                  </CardTitle>
                  <CardDescription>
                    {t('dashboard.distribution.description')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    {distributionData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={distributionData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            fill="#8884d8"
                            paddingAngle={5}
                            dataKey="value"
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          >
                            {distributionData.map((_entry, index) => (
                              <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'hsl(var(--popover))',
                              border: '1px solid hsl(var(--border))',
                              borderRadius: '0.5rem',
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <Database className="h-12 w-12 mb-2 opacity-50" />
                        <p className="text-sm">{t('dashboard.distribution.noData')}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>

          <TabsContent value="services" className="md:col-span-2 mt-0">
            <ServiceHealthCard services={displayServices} isLoading={healthLoading} />
          </TabsContent>

          <div className="md:row-span-1">
            <motion.div variants={itemVariants}>
              <Card className="h-full">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-4 w-4" />
                    {t('dashboard.recentActivity')}
                  </CardTitle>
                  <CardDescription>
                    {t('dashboard.overview')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[260px] pr-4">
                    <motion.div 
                      variants={containerVariants}
                      className="space-y-2"
                    >
                      {activityLoading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                          <div key={i} className="flex items-center gap-3 p-2">
                            <Skeleton className="h-8 w-8 rounded-full" />
                            <div className="flex-1 space-y-1">
                              <Skeleton className="h-4 w-32" />
                              <Skeleton className="h-3 w-20" />
                            </div>
                            <Skeleton className="h-3 w-16" />
                          </div>
                        ))
                      ) : displayActivity.length > 0 ? (
                        displayActivity.map((activity) => (
                          <ActivityItem key={activity.id} activity={activity} />
                        ))
                      ) : (
                        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                          <Activity className="h-8 w-8 mb-2 opacity-50" />
                          <p className="text-sm">{t('dashboard.noActivity')}</p>
                        </div>
                      )}
                    </motion.div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </Tabs>

      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              {t('dashboard.systemOverview')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <div className="p-2 rounded-md bg-blue-500/10">
                  <Cpu className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t('dashboard.system.llm')}</p>
                  <p className="text-xs text-muted-foreground">{t('dashboard.system.llmParams')}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <div className="p-2 rounded-md bg-green-500/10">
                  <Database className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t('dashboard.system.database')}</p>
                  <p className="text-xs text-muted-foreground">{t('dashboard.system.databaseFeature')}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <div className="p-2 rounded-md bg-purple-500/10">
                  <Shield className="h-5 w-5 text-purple-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t('dashboard.system.rbac')}</p>
                  <p className="text-xs text-muted-foreground">{t('dashboard.system.rbacPermissions')}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <div className="p-2 rounded-md bg-orange-500/10">
                  <Server className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t('dashboard.system.server')}</p>
                  <p className="text-xs text-muted-foreground">{t('dashboard.system.serverSpecs')}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

