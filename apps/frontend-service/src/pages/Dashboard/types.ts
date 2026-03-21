import type {
  DashboardHomeCardId,
  DashboardHomeMetricSet,
  DashboardHomePermissionKey,
  DashboardHomePermissionSnapshot,
  DashboardHomeResolvedPreferences,
  DashboardHomeResolvedCardPreferences,
  DashboardHomeTimeRange,
} from '@alice/shared';

export type DashboardHomeConfigResponse = {
  meta: {
    generatedAt: string;
    preferenceVersion: number;
  };
  permissions: DashboardHomePermissionSnapshot & {
    canUploadDocuments: boolean;
    role: string;
    tenantId: string;
  };
  preferences: DashboardHomeResolvedPreferences;
  enabledCardIds: DashboardHomeCardId[];
  availableCardIds: DashboardHomeCardId[];
};

export type DashboardPrioritySource = {
  generatedAt: string;
  status: {
    level: 'healthy' | 'warning' | 'critical';
    label: 'Saudável' | 'Atenção' | 'Crítico';
  };
  alerts: Array<{
    id: string;
    severity: 'critical' | 'warning';
    title: string;
    description: string;
    count: number;
    href: string;
    domain: string;
  }>;
  support: {
    activeHumanAgents: number;
    pendingHandoffs: number;
    urgentHandoffs: number;
  };
};

export type DashboardHealthSource = {
  generatedAt: string;
  href: string | null;
  metrics: {
    avgLatencyMs: number;
    services: {
      online: number;
      degraded: number;
      offline: number;
    };
    breakers: {
      open: number;
      halfOpen: number;
      closed: number;
    };
    sla: {
      onTrack: number;
      atRisk: number;
      breached: number;
    };
  };
};

export type DashboardConversationTrendPoint = {
  date: string;
  label: string;
  ai: number;
  human: number;
};

export type DashboardTokensTrendPoint = {
  date: string;
  label: string;
  total: number;
};

export type DashboardTrendSource = {
  generatedAt: string;
  windows: Array<{ id: '7d' | '30d'; label: string }>;
  metrics: Array<{
    id: 'conversations' | 'tokens';
    label: string;
    supportsBreakdown: boolean;
    seriesByWindow: {
      '7d': DashboardConversationTrendPoint[] | DashboardTokensTrendPoint[];
      '30d': DashboardConversationTrendPoint[] | DashboardTokensTrendPoint[];
    };
  }>;
};

export type DashboardRecentActivity = {
  id: string;
  title: string;
  description: string;
  category: 'conversation' | 'document' | 'training' | 'routing' | 'governance' | 'integration' | 'system';
  severity: 'info' | 'success' | 'warning' | 'critical';
  href: string | null;
  actor: string;
  timestamp: string | null;
};

export type DashboardRecentActivitySource = {
  generatedAt: string;
  itemsByWindow: {
    '24h': DashboardRecentActivity[];
    '7d': DashboardRecentActivity[];
    '30d': DashboardRecentActivity[];
  };
};

export type DashboardRoutingSource = {
  generatedAt: string;
  href: string;
  metricsByWindow: Record<'24h' | '7d' | '14d', {
    fallbackTotal: number;
    reviewQueue: number;
    unmappedContexts: number;
  }>;
};

export type DashboardTrainingSource = {
  generatedAt: string;
  href: string;
  metrics: {
    pending: number;
    dlq: number;
    inflight: number;
    maxInflight: number;
  };
};

export type DashboardFinanceSource = {
  generatedAt: string;
  href: string;
  metrics: {
    stripeCurrency: string;
    stripeRevenue: number;
    stripeTransactions: number;
    wiseCompletedCount: number;
    wisePendingAmount: number;
    wiseTotalTransfers: number;
  };
};

export type DashboardSourceId =
  | 'priority'
  | 'platformHealth'
  | 'conversationTrend'
  | 'recentActivity'
  | 'routingSnapshot'
  | 'trainingSnapshot'
  | 'financeSnapshot';

export type DashboardSourcePayloadById = {
  priority: DashboardPrioritySource;
  platformHealth: DashboardHealthSource;
  conversationTrend: DashboardTrendSource;
  recentActivity: DashboardRecentActivitySource;
  routingSnapshot: DashboardRoutingSource;
  trainingSnapshot: DashboardTrainingSource;
  financeSnapshot: DashboardFinanceSource;
};

export type DashboardCardContext = {
  cardId: DashboardHomeCardId;
  config: DashboardHomeResolvedCardPreferences;
  locale: string;
};

export type DashboardCardRegistryItem = {
  id: DashboardHomeCardId;
  title: string;
  description: string;
  shortDescription: string;
  defaultEnabled: boolean;
  priority: number;
  href: string | null;
  loadStrategy: 'aboveFold' | 'belowFold';
  permissionGate: DashboardHomePermissionKey | null;
  sourceId: DashboardSourceId;
  supportedTimeRanges: readonly DashboardHomeTimeRange[];
  supportedMetricSets: readonly DashboardHomeMetricSet[];
  supportedLimits: readonly number[];
};
