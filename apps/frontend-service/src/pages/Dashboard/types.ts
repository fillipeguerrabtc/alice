export type DashboardStatusLevel = 'healthy' | 'warning' | 'critical';

export type DashboardSummaryCard = {
  id: string;
  title: string;
  value: number;
  periodLabel: string;
  referenceLabel: string;
  href: string;
};

export type DashboardAlert = {
  id: string;
  severity: 'critical' | 'warning';
  title: string;
  description: string;
  count: number;
  href: string;
  domain: string;
};

export type DashboardHealth = {
  services: {
    online: number;
    degraded: number;
    offline: number;
  };
  circuitBreakers: {
    open: number;
    halfOpen: number;
    closed: number;
  };
  sla: {
    onTrack: number;
    atRisk: number;
    breached: number;
  };
  avgLatencyMs: number;
  href: string | null;
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

export type DashboardTrendMetric = {
  id: 'conversations' | 'tokens';
  label: string;
  supportsBreakdown: boolean;
  seriesByWindow: {
    '7d': DashboardConversationTrendPoint[] | DashboardTokensTrendPoint[];
    '30d': DashboardConversationTrendPoint[] | DashboardTokensTrendPoint[];
  };
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

export type DashboardSnapshot = {
  id: string;
  title: string;
  description: string;
  href: string;
  items: Array<{
    label: string;
    value: string;
    tone: 'default' | 'success' | 'warning' | 'critical';
  }>;
};

export type DashboardQuickAction = {
  id: string;
  label: string;
  href: string;
};

export type DashboardHomeResponse = {
  meta: {
    generatedAt: string;
  };
  status: {
    level: DashboardStatusLevel;
    label: 'Saudável' | 'Atenção' | 'Crítico';
  };
  summaryCards: DashboardSummaryCard[];
  alerts: DashboardAlert[];
  health: DashboardHealth;
  trends: {
    defaultWindow: '7d' | '30d';
    defaultMetric: 'conversations' | 'tokens';
    windows: Array<{ id: '7d' | '30d'; label: string }>;
    metrics: DashboardTrendMetric[];
  };
  recentActivity: DashboardRecentActivity[];
  domainSnapshots: DashboardSnapshot[];
  permissions: {
    role: string;
    tenantId: string;
    canManageConversations: boolean;
    canUploadDocuments: boolean;
    canOpenObservability: boolean;
    canViewTraining: boolean;
    canViewRouting: boolean;
    canViewFinance: boolean;
  };
  quickActions: DashboardQuickAction[];
};
