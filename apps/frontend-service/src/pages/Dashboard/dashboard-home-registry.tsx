import {
  DASHBOARD_HOME_CARD_CONTRACTS,
  sanitizeDashboardHomePreferences,
  type DashboardHomeCardId,
  type DashboardHomePermissionSnapshot,
  type DashboardHomeResolvedCardPreferences,
  type DashboardHomeResolvedPreferences,
} from '@alice/shared';
import { apiRequest } from '@/lib/queryClient';
import type {
  DashboardCardRegistryItem,
  DashboardFinanceSource,
  DashboardHealthSource,
  DashboardHomeConfigResponse,
  DashboardPrioritySource,
  DashboardRecentActivity,
  DashboardRecentActivitySource,
  DashboardRoutingSource,
  DashboardSourceId,
  DashboardTrainingSource,
  DashboardTrendSource,
} from './types';

async function fetchDashboardSource<T>(url: string): Promise<T> {
  const response = await apiRequest('GET', url);
  return response.json();
}

export const dashboardCardRegistry: Record<DashboardHomeCardId, DashboardCardRegistryItem> = {
  actionRequired: {
    id: 'actionRequired',
    title: 'Precisa de ação agora',
    description: 'Lista priorizada de exceções que merecem o próximo clique operacional.',
    shortDescription: 'Alertas priorizados',
    defaultEnabled: DASHBOARD_HOME_CARD_CONTRACTS.actionRequired.defaultEnabled,
    priority: DASHBOARD_HOME_CARD_CONTRACTS.actionRequired.priority,
    href: null,
    loadStrategy: 'aboveFold',
    permissionGate: DASHBOARD_HOME_CARD_CONTRACTS.actionRequired.permissionGate,
    sourceId: 'priority',
    supportedTimeRanges: DASHBOARD_HOME_CARD_CONTRACTS.actionRequired.supportedTimeRanges,
    supportedMetricSets: DASHBOARD_HOME_CARD_CONTRACTS.actionRequired.supportedMetricSets,
    supportedLimits: DASHBOARD_HOME_CARD_CONTRACTS.actionRequired.supportedLimits,
  },
  supportQueue: {
    id: 'supportQueue',
    title: 'Fila humana',
    description: 'Backlog e urgência do atendimento humano em tempo real.',
    shortDescription: 'Fila de handoffs',
    defaultEnabled: DASHBOARD_HOME_CARD_CONTRACTS.supportQueue.defaultEnabled,
    priority: DASHBOARD_HOME_CARD_CONTRACTS.supportQueue.priority,
    href: '/takeover',
    loadStrategy: 'aboveFold',
    permissionGate: DASHBOARD_HOME_CARD_CONTRACTS.supportQueue.permissionGate,
    sourceId: 'priority',
    supportedTimeRanges: DASHBOARD_HOME_CARD_CONTRACTS.supportQueue.supportedTimeRanges,
    supportedMetricSets: DASHBOARD_HOME_CARD_CONTRACTS.supportQueue.supportedMetricSets,
    supportedLimits: DASHBOARD_HOME_CARD_CONTRACTS.supportQueue.supportedLimits,
  },
  conversationTrend: {
    id: 'conversationTrend',
    title: 'Tendência',
    description: 'Leitura imediata de volume entre conversas resolvidas por IA e fluxo humano.',
    shortDescription: 'Tendência operacional',
    defaultEnabled: DASHBOARD_HOME_CARD_CONTRACTS.conversationTrend.defaultEnabled,
    priority: DASHBOARD_HOME_CARD_CONTRACTS.conversationTrend.priority,
    href: '/conversations',
    loadStrategy: 'aboveFold',
    permissionGate: DASHBOARD_HOME_CARD_CONTRACTS.conversationTrend.permissionGate,
    sourceId: 'conversationTrend',
    supportedTimeRanges: DASHBOARD_HOME_CARD_CONTRACTS.conversationTrend.supportedTimeRanges,
    supportedMetricSets: DASHBOARD_HOME_CARD_CONTRACTS.conversationTrend.supportedMetricSets,
    supportedLimits: DASHBOARD_HOME_CARD_CONTRACTS.conversationTrend.supportedLimits,
  },
  platformHealth: {
    id: 'platformHealth',
    title: 'Saúde da plataforma',
    description: 'Serviços, circuit breakers, SLA e latência com foco operacional.',
    shortDescription: 'Saúde da plataforma',
    defaultEnabled: DASHBOARD_HOME_CARD_CONTRACTS.platformHealth.defaultEnabled,
    priority: DASHBOARD_HOME_CARD_CONTRACTS.platformHealth.priority,
    href: '/observability',
    loadStrategy: 'belowFold',
    permissionGate: DASHBOARD_HOME_CARD_CONTRACTS.platformHealth.permissionGate,
    sourceId: 'platformHealth',
    supportedTimeRanges: DASHBOARD_HOME_CARD_CONTRACTS.platformHealth.supportedTimeRanges,
    supportedMetricSets: DASHBOARD_HOME_CARD_CONTRACTS.platformHealth.supportedMetricSets,
    supportedLimits: DASHBOARD_HOME_CARD_CONTRACTS.platformHealth.supportedLimits,
  },
  recentActivity: {
    id: 'recentActivity',
    title: 'Atividade recente',
    description: 'Eventos humanizados para leitura rápida, sem despejar o audit log cru na home.',
    shortDescription: 'Eventos recentes',
    defaultEnabled: DASHBOARD_HOME_CARD_CONTRACTS.recentActivity.defaultEnabled,
    priority: DASHBOARD_HOME_CARD_CONTRACTS.recentActivity.priority,
    href: null,
    loadStrategy: 'belowFold',
    permissionGate: DASHBOARD_HOME_CARD_CONTRACTS.recentActivity.permissionGate,
    sourceId: 'recentActivity',
    supportedTimeRanges: DASHBOARD_HOME_CARD_CONTRACTS.recentActivity.supportedTimeRanges,
    supportedMetricSets: DASHBOARD_HOME_CARD_CONTRACTS.recentActivity.supportedMetricSets,
    supportedLimits: DASHBOARD_HOME_CARD_CONTRACTS.recentActivity.supportedLimits,
  },
  routingSnapshot: {
    id: 'routingSnapshot',
    title: 'Routing',
    description: 'Fallbacks, revisão híbrida e contextos sem mapeamento em janelas operacionais.',
    shortDescription: 'Snapshot de routing',
    defaultEnabled: DASHBOARD_HOME_CARD_CONTRACTS.routingSnapshot.defaultEnabled,
    priority: DASHBOARD_HOME_CARD_CONTRACTS.routingSnapshot.priority,
    href: '/namespaces',
    loadStrategy: 'belowFold',
    permissionGate: DASHBOARD_HOME_CARD_CONTRACTS.routingSnapshot.permissionGate,
    sourceId: 'routingSnapshot',
    supportedTimeRanges: DASHBOARD_HOME_CARD_CONTRACTS.routingSnapshot.supportedTimeRanges,
    supportedMetricSets: DASHBOARD_HOME_CARD_CONTRACTS.routingSnapshot.supportedMetricSets,
    supportedLimits: DASHBOARD_HOME_CARD_CONTRACTS.routingSnapshot.supportedLimits,
  },
  trainingSnapshot: {
    id: 'trainingSnapshot',
    title: 'Training',
    description: 'Fila, DLQ e capacidade atual do pipeline de fine-tuning.',
    shortDescription: 'Snapshot de training',
    defaultEnabled: DASHBOARD_HOME_CARD_CONTRACTS.trainingSnapshot.defaultEnabled,
    priority: DASHBOARD_HOME_CARD_CONTRACTS.trainingSnapshot.priority,
    href: '/training',
    loadStrategy: 'belowFold',
    permissionGate: DASHBOARD_HOME_CARD_CONTRACTS.trainingSnapshot.permissionGate,
    sourceId: 'trainingSnapshot',
    supportedTimeRanges: DASHBOARD_HOME_CARD_CONTRACTS.trainingSnapshot.supportedTimeRanges,
    supportedMetricSets: DASHBOARD_HOME_CARD_CONTRACTS.trainingSnapshot.supportedMetricSets,
    supportedLimits: DASHBOARD_HOME_CARD_CONTRACTS.trainingSnapshot.supportedLimits,
  },
  financeSnapshot: {
    id: 'financeSnapshot',
    title: 'Financeiro',
    description: 'Recorte de Stripe e Wise quando fizer sentido para o papel ativo.',
    shortDescription: 'Snapshot financeiro',
    defaultEnabled: DASHBOARD_HOME_CARD_CONTRACTS.financeSnapshot.defaultEnabled,
    priority: DASHBOARD_HOME_CARD_CONTRACTS.financeSnapshot.priority,
    href: '/integrations',
    loadStrategy: 'belowFold',
    permissionGate: DASHBOARD_HOME_CARD_CONTRACTS.financeSnapshot.permissionGate,
    sourceId: 'financeSnapshot',
    supportedTimeRanges: DASHBOARD_HOME_CARD_CONTRACTS.financeSnapshot.supportedTimeRanges,
    supportedMetricSets: DASHBOARD_HOME_CARD_CONTRACTS.financeSnapshot.supportedMetricSets,
    supportedLimits: DASHBOARD_HOME_CARD_CONTRACTS.financeSnapshot.supportedLimits,
  },
};

export const dashboardSourceRegistry: Record<DashboardSourceId, {
  buildQueryOptions: (enabled: boolean) => {
    enabled: boolean;
    placeholderData: (previousData: unknown) => unknown;
    queryFn: () => Promise<unknown>;
    queryKey: string[];
    refetchInterval: number;
    staleTime: number;
  };
}> = {
  priority: {
    buildQueryOptions: (enabled) => ({
      queryKey: ['/api/dashboard/home/sources/priority'],
      queryFn: () => fetchDashboardSource<DashboardPrioritySource>('/api/dashboard/home/sources/priority'),
      enabled,
      staleTime: 30_000,
      refetchInterval: 30_000,
      placeholderData: (previousData) => previousData,
    }),
  },
  platformHealth: {
    buildQueryOptions: (enabled) => ({
      queryKey: ['/api/dashboard/home/sources/platform-health'],
      queryFn: () => fetchDashboardSource<DashboardHealthSource>('/api/dashboard/home/sources/platform-health'),
      enabled,
      staleTime: 30_000,
      refetchInterval: 30_000,
      placeholderData: (previousData) => previousData,
    }),
  },
  conversationTrend: {
    buildQueryOptions: (enabled) => ({
      queryKey: ['/api/dashboard/home/sources/conversation-trend'],
      queryFn: () => fetchDashboardSource<DashboardTrendSource>('/api/dashboard/home/sources/conversation-trend'),
      enabled,
      staleTime: 60_000,
      refetchInterval: 60_000,
      placeholderData: (previousData) => previousData,
    }),
  },
  recentActivity: {
    buildQueryOptions: (enabled) => ({
      queryKey: ['/api/dashboard/home/sources/recent-activity'],
      queryFn: () => fetchDashboardSource<DashboardRecentActivitySource>('/api/dashboard/home/sources/recent-activity'),
      enabled,
      staleTime: 60_000,
      refetchInterval: 60_000,
      placeholderData: (previousData) => previousData,
    }),
  },
  routingSnapshot: {
    buildQueryOptions: (enabled) => ({
      queryKey: ['/api/dashboard/home/sources/routing-snapshot'],
      queryFn: () => fetchDashboardSource<DashboardRoutingSource>('/api/dashboard/home/sources/routing-snapshot'),
      enabled,
      staleTime: 60_000,
      refetchInterval: 60_000,
      placeholderData: (previousData) => previousData,
    }),
  },
  trainingSnapshot: {
    buildQueryOptions: (enabled) => ({
      queryKey: ['/api/dashboard/home/sources/training-snapshot'],
      queryFn: () => fetchDashboardSource<DashboardTrainingSource>('/api/dashboard/home/sources/training-snapshot'),
      enabled,
      staleTime: 30_000,
      refetchInterval: 30_000,
      placeholderData: (previousData) => previousData,
    }),
  },
  financeSnapshot: {
    buildQueryOptions: (enabled) => ({
      queryKey: ['/api/dashboard/home/sources/finance-snapshot'],
      queryFn: () => fetchDashboardSource<DashboardFinanceSource>('/api/dashboard/home/sources/finance-snapshot'),
      enabled,
      staleTime: 60_000,
      refetchInterval: 60_000,
      placeholderData: (previousData) => previousData,
    }),
  },
};

export function getAvailableDashboardCardIds(config: DashboardHomeConfigResponse): DashboardHomeCardId[] {
  return config.availableCardIds
    .filter((cardId) => {
      const card = dashboardCardRegistry[cardId];
      if (!card.permissionGate) {
        return true;
      }

      return config.permissions[card.permissionGate] === true;
    })
    .sort((left, right) => dashboardCardRegistry[left].priority - dashboardCardRegistry[right].priority);
}

export function getEnabledDashboardCardIds(config: DashboardHomeConfigResponse): DashboardHomeCardId[] {
  const availableCardIds = new Set(getAvailableDashboardCardIds(config));
  return config.preferences.visibleCardIds.filter((cardId) => availableCardIds.has(cardId));
}

export function splitDashboardCardsByFold(cardIds: DashboardHomeCardId[]): {
  aboveFold: DashboardHomeCardId[];
  belowFold: DashboardHomeCardId[];
} {
  return {
    aboveFold: cardIds.filter((cardId) => dashboardCardRegistry[cardId].loadStrategy === 'aboveFold'),
    belowFold: cardIds.filter((cardId) => dashboardCardRegistry[cardId].loadStrategy === 'belowFold'),
  };
}

export function buildNextDashboardPreferences(params: {
  current: DashboardHomeResolvedPreferences;
  permissions: DashboardHomePermissionSnapshot;
  updater: (current: DashboardHomeResolvedPreferences) => DashboardHomeResolvedPreferences;
}): DashboardHomeResolvedPreferences {
  return sanitizeDashboardHomePreferences(params.updater(params.current), params.permissions);
}

export function selectActionRequiredAlerts(
  source: DashboardPrioritySource,
  config: DashboardHomeResolvedCardPreferences,
): DashboardPrioritySource['alerts'] {
  const metricSet = config.metricSet ?? DASHBOARD_HOME_CARD_CONTRACTS.actionRequired.defaultMetricSet ?? 'all';
  const limit = config.limit ?? DASHBOARD_HOME_CARD_CONTRACTS.actionRequired.defaultLimit ?? 5;

  return source.alerts
    .filter((alert) => {
      if (metricSet === 'all') {
        return true;
      }

      return alert.domain === metricSet;
    })
    .slice(0, limit);
}

export function selectRecentActivityItems(
  source: DashboardRecentActivitySource,
  config: DashboardHomeResolvedCardPreferences,
): DashboardRecentActivity[] {
  const timeRange = config.timeRange ?? DASHBOARD_HOME_CARD_CONTRACTS.recentActivity.defaultTimeRange ?? '24h';
  const limit = config.limit ?? DASHBOARD_HOME_CARD_CONTRACTS.recentActivity.defaultLimit ?? 5;
  const metricSet = config.metricSet ?? DASHBOARD_HOME_CARD_CONTRACTS.recentActivity.defaultMetricSet ?? 'operations';
  const items = source.itemsByWindow[timeRange as keyof DashboardRecentActivitySource['itemsByWindow']] ?? [];

  if (metricSet === 'all') {
    return items.slice(0, limit);
  }

  return items
    .filter((item) => item.category !== 'integration')
    .slice(0, limit);
}

export function selectRoutingSnapshotItems(
  source: DashboardRoutingSource,
  config: DashboardHomeResolvedCardPreferences,
): Array<{ label: string; value: number; tone: 'default' | 'success' | 'warning' | 'critical' }> {
  const timeRange = config.timeRange ?? DASHBOARD_HOME_CARD_CONTRACTS.routingSnapshot.defaultTimeRange ?? '7d';
  const metricSet = config.metricSet ?? DASHBOARD_HOME_CARD_CONTRACTS.routingSnapshot.defaultMetricSet ?? 'overview';
  const metrics = source.metricsByWindow[timeRange as keyof DashboardRoutingSource['metricsByWindow']];

  const items: Array<{ label: string; value: number; tone: 'default' | 'success' | 'warning' | 'critical' }> = [
    {
      label: 'Fallbacks',
      value: metrics?.fallbackTotal ?? 0,
      tone: (metrics?.fallbackTotal ?? 0) > 0 ? 'warning' : 'success',
    },
    {
      label: 'Revisão híbrida',
      value: metrics?.reviewQueue ?? 0,
      tone: (metrics?.reviewQueue ?? 0) > 0 ? 'warning' : 'success',
    },
    {
      label: 'Não mapeados',
      value: metrics?.unmappedContexts ?? 0,
      tone: (metrics?.unmappedContexts ?? 0) > 0 ? 'critical' : 'success',
    },
  ];

  if (metricSet === 'exceptions') {
    return items.filter((item) => item.label !== 'Fallbacks');
  }

  return [...items];
}

export function selectTrainingSnapshotItems(
  source: DashboardTrainingSource,
  config: DashboardHomeResolvedCardPreferences,
): Array<{ label: string; value: number | string; tone: 'default' | 'success' | 'warning' | 'critical' }> {
  const metricSet = config.metricSet ?? DASHBOARD_HOME_CARD_CONTRACTS.trainingSnapshot.defaultMetricSet ?? 'overview';
  const items: Array<{ label: string; value: number | string; tone: 'default' | 'success' | 'warning' | 'critical' }> = [
    {
      label: 'Pendentes',
      value: source.metrics.pending,
      tone: source.metrics.pending > 0 ? 'warning' : 'success',
    },
    {
      label: 'DLQ',
      value: source.metrics.dlq,
      tone: source.metrics.dlq > 0 ? 'critical' : 'success',
    },
    {
      label: 'Em voo',
      value: source.metrics.inflight,
      tone: 'default',
    },
    {
      label: 'Capacidade',
      value: source.metrics.maxInflight > 0
        ? `${source.metrics.inflight}/${source.metrics.maxInflight}`
        : `${source.metrics.inflight}`,
      tone: source.metrics.maxInflight > 0 && source.metrics.inflight >= source.metrics.maxInflight ? 'warning' : 'default',
    },
  ];

  if (metricSet === 'capacity') {
    return items.filter((item) => item.label === 'Em voo' || item.label === 'Capacidade');
  }

  return [...items];
}

export function selectFinanceSnapshotItems(
  source: DashboardFinanceSource,
  config: DashboardHomeResolvedCardPreferences,
): Array<{ label: string; value: number; kind: 'currency' | 'number' }> {
  const metricSet = config.metricSet ?? DASHBOARD_HOME_CARD_CONTRACTS.financeSnapshot.defaultMetricSet ?? 'overview';
  const items = [
    { label: 'Receita Stripe', value: source.metrics.stripeRevenue, kind: 'currency' as const },
    { label: 'Transações Stripe', value: source.metrics.stripeTransactions, kind: 'number' as const },
    { label: 'Wise pendente', value: source.metrics.wisePendingAmount, kind: 'currency' as const },
    { label: 'Transferências Wise', value: source.metrics.wiseTotalTransfers, kind: 'number' as const },
  ];

  if (metricSet === 'cashflow') {
    return items.filter((item) => item.kind === 'currency');
  }

  return items;
}

export function selectHealthMetrics(
  source: DashboardHealthSource,
  config: DashboardHomeResolvedCardPreferences,
): Array<{ id: string; label: string; value: number | string; tone?: 'default' | 'warning' | 'critical' }> {
  const metricSet = config.metricSet ?? DASHBOARD_HOME_CARD_CONTRACTS.platformHealth.defaultMetricSet ?? 'overview';
  const items: Array<{ id: string; label: string; value: number | string; tone?: 'default' | 'warning' | 'critical' }> = [
    {
      id: 'services',
      label: 'Serviços',
      value: `${source.metrics.services.online} online / ${source.metrics.services.degraded + source.metrics.services.offline} com atenção`,
      tone: source.metrics.services.offline > 0 ? 'critical' : source.metrics.services.degraded > 0 ? 'warning' : 'default',
    },
    {
      id: 'breakers',
      label: 'Circuit breakers',
      value: `${source.metrics.breakers.open + source.metrics.breakers.halfOpen} problemáticos`,
      tone: source.metrics.breakers.open > 0 ? 'critical' : source.metrics.breakers.halfOpen > 0 ? 'warning' : 'default',
    },
    {
      id: 'sla',
      label: 'SLA',
      value: `${source.metrics.sla.atRisk + source.metrics.sla.breached} em risco ou violado(s)`,
      tone: source.metrics.sla.breached > 0 ? 'critical' : source.metrics.sla.atRisk > 0 ? 'warning' : 'default',
    },
    {
      id: 'latency',
      label: 'Latência média',
      value: `${source.metrics.avgLatencyMs} ms`,
    },
  ];

  if (metricSet === 'operations') {
    return items.filter((item) => item.id !== 'sla');
  }

  return items;
}

export function getDashboardSourceIds(cardIds: DashboardHomeCardId[]): DashboardSourceId[] {
  return Array.from(new Set(cardIds.map((cardId) => dashboardCardRegistry[cardId].sourceId)));
}
