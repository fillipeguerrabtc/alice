/**
 * Tipos compartilhados para componentes do Dashboard
 * 
 * @module Dashboard/components/types
 */

export interface DashboardStats {
  conversations: number;
  documents: number;
  trainingData: number;
  tokensUsed: number;
  trend?: {
    conversations: number;
    documents: number;
    trainingData: number;
    tokensUsed: number;
  };
}

export interface UsageData {
  date: string;
  conversations: number;
  tokens: number;
}

export interface RecentActivity {
  id: string;
  action: string;
  time: string;
  user: string;
  type?: 'chat' | 'document' | 'training' | 'payment' | 'system';
}

export interface ServiceHealth {
  service: string;
  status: 'ok' | 'degraded' | 'down';
  latency?: number;
  uptime?: number;
}

export interface IntegrationStats {
  stripe?: {
    totalRevenue: number;
    transactions: number;
    currency: string;
  };
  wise?: {
    totalTransfers: number;
    pendingAmount: number;
    completedCount: number;
  };
}

export interface ImageGenerationStats {
  totalGenerated: number;
  approved: number;
  pending: number;
  inTraining: number;
  avgRating: number;
}

export interface TakeoverStats {
  pendingHandoffs: number;
  activeHumanAgents: number;
  urgentConversations: number;
  avgResponseTime: number;
  resolvedByAI: number;
  resolvedByHuman: number;
}

export interface SLAMetrics {
  breachedCount: number;
  atRiskCount: number;
  onTrackCount: number;
  avgFirstResponseTime: number;
  avgResolutionTime: number;
}

export interface ConversationBreakdown {
  name: string;
  value: number;
  color: string;
}

export interface CircuitBreakerStatus {
  name: string;
  status: 'closed' | 'open' | 'half-open';
  failures: number;
  successRate: number;
}

export const CHART_COLORS = {
  primary: 'hsl(var(--primary))',
  secondary: 'hsl(var(--secondary))',
  accent: 'hsl(var(--accent))',
  muted: 'hsl(var(--muted))',
};

export const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
} as const;

export const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 100,
      damping: 12,
    },
  },
} as const;
