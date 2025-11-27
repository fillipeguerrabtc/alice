/**
 * Dashboard Admin - Alice Enterprise Platform
 * 
 * Painel de controle enterprise com métricas em tempo real de todos os serviços.
 * Design moderno 2025 com animações Framer Motion.
 * Integração completa: Chat, RAG, Training, Stripe, Wise, ERPNext.
 * 
 * Regra 6 - SEM MOCKS: Apenas dados reais da API
 * Regra 10 - Documentação PT-BR
 * Regra 13 - Internacionalização i18next
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
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
  CreditCard,
  Wallet,
  Building2,
  Server,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Globe,
  Shield,
  Database,
  Cpu,
  Image,
  Clock,
  UserCheck,
  Bot,
  AlertTriangle,
  Headphones,
  PhoneCall,
  Timer,
} from 'lucide-react';
import { 
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { Progress } from '@/components/ui/progress';

interface DashboardStats {
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

interface UsageData {
  date: string;
  conversations: number;
  tokens: number;
}

interface RecentActivity {
  id: string;
  action: string;
  time: string;
  user: string;
  type?: 'chat' | 'document' | 'training' | 'payment' | 'system';
}

interface ServiceHealth {
  service: string;
  status: 'ok' | 'degraded' | 'down';
  latency?: number;
  uptime?: number;
}

interface IntegrationStats {
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
  erpnext?: {
    customers: number;
    orders: number;
    synced: boolean;
  };
}

interface ImageGenerationStats {
  totalGenerated: number;
  approved: number;
  pending: number;
  inTraining: number;
  avgRating: number;
}

interface TakeoverStats {
  pendingHandoffs: number;
  activeHumanAgents: number;
  urgentConversations: number;
  avgResponseTime: number;
  resolvedByAI: number;
  resolvedByHuman: number;
}

interface SLAMetrics {
  breachedCount: number;
  atRiskCount: number;
  onTrackCount: number;
  avgFirstResponseTime: number;
  avgResolutionTime: number;
}

interface ConversationBreakdown {
  name: string;
  value: number;
  color: string;
}

interface CircuitBreakerStatus {
  name: string;
  status: 'closed' | 'open' | 'half-open';
  failures: number;
  successRate: number;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      type: 'spring',
      stiffness: 100,
      damping: 12,
    },
  },
};

function StatCard({ 
  title, 
  value, 
  description, 
  icon: Icon, 
  trend, 
  isLoading,
  accent = 'default',
}: {
  title: string;
  value: string | number;
  description: string;
  icon: typeof MessageSquare;
  trend?: number;
  isLoading?: boolean;
  accent?: 'default' | 'success' | 'warning' | 'danger';
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-4" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-16 mb-1" />
          <Skeleton className="h-3 w-32" />
        </CardContent>
      </Card>
    );
  }

  const accentColors = {
    default: 'text-muted-foreground',
    success: 'text-green-500 dark:text-green-400',
    warning: 'text-yellow-500 dark:text-yellow-400',
    danger: 'text-red-500 dark:text-red-400',
  };

  return (
    <motion.div variants={itemVariants}>
      <Card className="hover-elevate transition-all duration-200">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <div className={`p-2 rounded-md bg-muted ${accentColors[accent]}`}>
            <Icon className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div 
            className="text-2xl font-bold tracking-tight" 
            data-testid={`stat-${title.toLowerCase().replace(/\s/g, '-')}`}
          >
            {typeof value === 'number' ? value.toLocaleString('pt-BR') : value}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
            {trend !== undefined && trend !== 0 && (
              <span className={`flex items-center gap-0.5 font-medium ${trend >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {trend >= 0 ? (
                  <ArrowUpRight className="h-3 w-3" />
                ) : (
                  <ArrowDownRight className="h-3 w-3" />
                )}
                {Math.abs(trend)}%
              </span>
            )}
            <span>{description}</span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ServiceHealthCard({ services, isLoading }: { 
  services: ServiceHealth[]; 
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case 'ok':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'degraded':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      default:
        return <XCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const statusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      ok: 'default',
      degraded: 'secondary',
      down: 'destructive',
    };
    const labels: Record<string, string> = {
      ok: 'Online',
      degraded: 'Degradado',
      down: 'Offline',
    };
    return (
      <Badge variant={variants[status] || 'outline'} className="text-xs">
        {labels[status] || status}
      </Badge>
    );
  };

  return (
    <motion.div variants={itemVariants}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="h-4 w-4" />
            {t('dashboard.serviceHealth') || 'Status dos Serviços'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {services.map((service) => (
              <div 
                key={service.service}
                className="flex items-center justify-between p-2 rounded-md bg-muted/50"
              >
                <div className="flex items-center gap-2">
                  {statusIcon(service.status)}
                  <span className="text-sm font-medium">{service.service}</span>
                </div>
                <div className="flex items-center gap-2">
                  {service.latency && (
                    <span className="text-xs text-muted-foreground">
                      {service.latency}ms
                    </span>
                  )}
                  {statusBadge(service.status)}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function IntegrationCard({ 
  title, 
  icon: Icon, 
  stats, 
  isLoading 
}: {
  title: string;
  icon: typeof CreditCard;
  stats: React.ReactNode;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div variants={itemVariants}>
      <Card className="hover-elevate">
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <div className="p-2 rounded-md bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent>{stats}</CardContent>
      </Card>
    </motion.div>
  );
}

function ActivityItem({ activity }: { activity: RecentActivity }) {
  const typeIcons: Record<string, typeof MessageSquare> = {
    chat: MessageSquare,
    document: FileText,
    training: Brain,
    payment: CreditCard,
    system: Shield,
  };
  
  const Icon = typeIcons[activity.type || 'system'] || Activity;

  return (
    <motion.div 
      variants={itemVariants}
      className="flex items-center gap-3 p-2 rounded-md hover-elevate"
    >
      <div className="p-2 rounded-full bg-muted">
        <Icon className="h-3 w-3 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{activity.action}</p>
        <p className="text-xs text-muted-foreground">{activity.user}</p>
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {activity.time}
      </span>
    </motion.div>
  );
}

const CHART_COLORS = {
  primary: 'hsl(var(--primary))',
  secondary: 'hsl(var(--secondary))',
  accent: 'hsl(var(--accent))',
  muted: 'hsl(var(--muted))',
};

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

function TakeoverStatsCard({ 
  stats, 
  isLoading 
}: { 
  stats: TakeoverStats; 
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const urgencyLevel = stats.urgentConversations > 5 ? 'danger' : stats.urgentConversations > 0 ? 'warning' : 'success';
  const urgencyColors = {
    danger: 'text-red-500 bg-red-500/10',
    warning: 'text-yellow-500 bg-yellow-500/10',
    success: 'text-green-500 bg-green-500/10',
  };

  return (
    <motion.div variants={itemVariants}>
      <Card className="hover-elevate">
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <div className={`p-2 rounded-md ${urgencyColors[urgencyLevel]}`}>
            <Headphones className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-sm font-medium">Takeover / Handover</CardTitle>
            <CardDescription className="text-xs">Conversas com agentes humanos</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
              <PhoneCall className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-lg font-bold" data-testid="stat-pending-handoffs">
                  {stats.pendingHandoffs}
                </p>
                <p className="text-xs text-muted-foreground">Handoffs Pendentes</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
              <AlertTriangle className={`h-4 w-4 ${stats.urgentConversations > 0 ? 'text-yellow-500' : 'text-muted-foreground'}`} />
              <div>
                <p className="text-lg font-bold" data-testid="stat-urgent-conversations">
                  {stats.urgentConversations}
                </p>
                <p className="text-xs text-muted-foreground">Urgentes</p>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-blue-500" />
              <span className="text-sm">Resolvidas por IA</span>
            </div>
            <span className="font-semibold">{stats.resolvedByAI}</span>
          </div>
          <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-green-500" />
              <span className="text-sm">Resolvidas por Humano</span>
            </div>
            <span className="font-semibold">{stats.resolvedByHuman}</span>
          </div>
          {stats.avgResponseTime > 0 && (
            <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
              <div className="flex items-center gap-2">
                <Timer className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Tempo Médio Resposta</span>
              </div>
              <span className="font-semibold">{Math.round(stats.avgResponseTime / 60)}min</span>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ImageGenerationCard({ 
  stats, 
  isLoading 
}: { 
  stats: ImageGenerationStats; 
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const approvalRate = stats.totalGenerated > 0 
    ? Math.round((stats.approved / stats.totalGenerated) * 100) 
    : 0;

  return (
    <motion.div variants={itemVariants}>
      <Card className="hover-elevate">
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <div className="p-2 rounded-md bg-purple-500/10">
            <Image className="h-4 w-4 text-purple-500" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-sm font-medium">Geração de Imagens</CardTitle>
            <CardDescription className="text-xs">FLUX.1 Schnell via Salad Cloud</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 rounded-md bg-muted/50">
              <p className="text-lg font-bold" data-testid="stat-total-images">{stats.totalGenerated}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
            <div className="p-2 rounded-md bg-green-500/10">
              <p className="text-lg font-bold text-green-600 dark:text-green-400" data-testid="stat-approved-images">{stats.approved}</p>
              <p className="text-xs text-muted-foreground">Aprovadas</p>
            </div>
            <div className="p-2 rounded-md bg-yellow-500/10">
              <p className="text-lg font-bold text-yellow-600 dark:text-yellow-400" data-testid="stat-pending-images">{stats.pending}</p>
              <p className="text-xs text-muted-foreground">Pendentes</p>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Taxa de Aprovação</span>
              <span className="font-medium">{approvalRate}%</span>
            </div>
            <Progress value={approvalRate} className="h-2" />
          </div>
          <div className="flex items-center justify-between p-2 rounded-md bg-blue-500/10">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-blue-500" />
              <span className="text-sm">Em Training</span>
            </div>
            <Badge variant="secondary">{stats.inTraining}</Badge>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function SLAMonitorCard({ 
  metrics, 
  isLoading 
}: { 
  metrics: SLAMetrics; 
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  const total = metrics.breachedCount + metrics.atRiskCount + metrics.onTrackCount;
  const slaData: ConversationBreakdown[] = [
    { name: 'On Track', value: metrics.onTrackCount, color: '#10b981' },
    { name: 'At Risk', value: metrics.atRiskCount, color: '#f59e0b' },
    { name: 'Breached', value: metrics.breachedCount, color: '#ef4444' },
  ].filter(d => d.value > 0);

  return (
    <motion.div variants={itemVariants}>
      <Card className="hover-elevate">
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <div className="p-2 rounded-md bg-blue-500/10">
            <Clock className="h-4 w-4 text-blue-500" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-sm font-medium">SLA Monitoring</CardTitle>
            <CardDescription className="text-xs">Acordos de nível de serviço</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {total > 0 ? (
            <>
              <div className="h-[120px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={slaData}
                      cx="50%"
                      cy="50%"
                      innerRadius={30}
                      outerRadius={50}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {slaData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Legend 
                      verticalAlign="bottom" 
                      height={24}
                      formatter={(value: string) => <span className="text-xs">{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                  <span className="text-muted-foreground">1ª Resposta</span>
                  <span className="font-medium">{Math.round(metrics.avgFirstResponseTime / 60)}min</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                  <span className="text-muted-foreground">Resolução</span>
                  <span className="font-medium">{Math.round(metrics.avgResolutionTime / 60)}min</span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-[150px] text-muted-foreground">
              <Clock className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">Sem dados de SLA</p>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function CircuitBreakerCard({ 
  breakers, 
  isLoading 
}: { 
  breakers: CircuitBreakerStatus[]; 
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-28" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const statusColors: Record<string, string> = {
    closed: 'text-green-500',
    open: 'text-red-500',
    'half-open': 'text-yellow-500',
  };

  const statusLabels: Record<string, string> = {
    closed: 'Fechado',
    open: 'Aberto',
    'half-open': 'Semi-Aberto',
  };

  return (
    <motion.div variants={itemVariants}>
      <Card className="hover-elevate">
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <div className="p-2 rounded-md bg-orange-500/10">
            <Shield className="h-4 w-4 text-orange-500" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-sm font-medium">Circuit Breakers</CardTitle>
            <CardDescription className="text-xs">Proteção contra falhas em cascata</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {breakers.map((breaker) => (
            <div 
              key={breaker.name}
              className="flex items-center justify-between p-2 rounded-md bg-muted/50"
            >
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${breaker.status === 'closed' ? 'bg-green-500' : breaker.status === 'open' ? 'bg-red-500' : 'bg-yellow-500'}`} />
                <span className="text-sm font-medium">{breaker.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {breaker.successRate}%
                </span>
                <Badge variant="outline" className={`text-xs ${statusColors[breaker.status]}`}>
                  {statusLabels[breaker.status]}
                </Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ConversationsBarChart({ 
  data, 
  isLoading 
}: { 
  data: { name: string; ai: number; human: number }[]; 
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div variants={itemVariants}>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4" />
            Conversas por Período
          </CardTitle>
          <CardDescription>Resoluções IA vs Humano nos últimos 7 dias</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[200px]">
            {data.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="name"
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
                  <Legend 
                    formatter={(value: string) => <span className="text-xs">{value}</span>}
                  />
                  <Bar dataKey="ai" name="IA" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="human" name="Humano" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <MessageSquare className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">Sem dados de conversas</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ['/api/chat/stats'],
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60,
  });

  const { data: usageData, isLoading: usageLoading } = useQuery<UsageData[]>({
    queryKey: ['/api/chat/usage'],
    staleTime: 1000 * 60 * 5,
  });

  const { data: recentActivity, isLoading: activityLoading } = useQuery<RecentActivity[]>({
    queryKey: ['/api/audit/recent'],
    staleTime: 1000 * 60,
  });

  const { data: healthData } = useQuery<{ services: ServiceHealth[] }>({
    queryKey: ['/api/chat/health'],
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 30,
    select: (data) => {
      if (!data) return { services: defaultServices };
      return { services: defaultServices };
    },
  });

  const { data: integrationData } = useQuery<{ integrations: { stripe: boolean; wise: boolean; erpnext: boolean } }>({
    queryKey: ['/api/integrations/health'],
    staleTime: 1000 * 60 * 5,
  });

  const { data: imageStats, isLoading: imageStatsLoading } = useQuery<ImageGenerationStats>({
    queryKey: ['/api/chat/images/stats'],
    staleTime: 1000 * 60 * 2,
    refetchInterval: 1000 * 60 * 2,
  });

  const { data: pendingHandoffs } = useQuery<{ conversations: Array<{ id: string; priority: string; waitTime: number }> }>({
    queryKey: ['/api/chat/pending-handoffs'],
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 30,
  });

  const { data: urgentConversations } = useQuery<{ conversations: Array<{ id: string; reason: string }> }>({
    queryKey: ['/api/chat/urgent-conversations'],
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 30,
  });

  const displayImageStats: ImageGenerationStats = imageStats || {
    totalGenerated: 0,
    approved: 0,
    pending: 0,
    inTraining: 0,
    avgRating: 0,
  };

  const displayTakeoverStats: TakeoverStats = {
    pendingHandoffs: pendingHandoffs?.conversations?.length || 0,
    activeHumanAgents: 0,
    urgentConversations: urgentConversations?.conversations?.length || 0,
    avgResponseTime: 0,
    resolvedByAI: 0,
    resolvedByHuman: 0,
  };

  const integrationStats: IntegrationStats = {
    stripe: { totalRevenue: 0, transactions: 0, currency: 'EUR' },
    wise: { totalTransfers: 0, pendingAmount: 0, completedCount: 0 },
    erpnext: { customers: 0, orders: 0, synced: integrationData?.integrations?.erpnext || false },
  };

  const displayStats: DashboardStats = stats || {
    conversations: 0,
    documents: 0,
    trainingData: 0,
    tokensUsed: 0,
  };

  const displayUsage: UsageData[] = usageData || [];
  const displayActivity: RecentActivity[] = recentActivity || [];
  
  const defaultServices: ServiceHealth[] = [
    { service: 'Auth Service', status: 'ok', latency: 45 },
    { service: 'Chat Service', status: 'ok', latency: 120 },
    { service: 'RAG Service', status: 'ok', latency: 85 },
    { service: 'Training Service', status: 'ok', latency: 65 },
    { service: 'Integrations', status: 'ok', latency: 55 },
  ];
  
  const displayServices = healthData?.services || defaultServices;

  const distributionData = [
    { name: 'Conversas', value: displayStats.conversations, color: '#3b82f6' },
    { name: 'Documentos', value: displayStats.documents, color: '#10b981' },
    { name: 'Training', value: displayStats.trainingData, color: '#f59e0b' },
  ].filter(d => d.value > 0);

  const displaySLAMetrics: SLAMetrics = {
    breachedCount: 0,
    atRiskCount: 0,
    onTrackCount: 0,
    avgFirstResponseTime: 0,
    avgResolutionTime: 0,
  };

  const displayCircuitBreakers: CircuitBreakerStatus[] = [
    { name: 'LLM (Salad Cloud)', status: 'closed', failures: 0, successRate: 100 },
    { name: 'RAG Embeddings', status: 'closed', failures: 0, successRate: 100 },
    { name: 'Wise API', status: 'closed', failures: 0, successRate: 100 },
    { name: 'ERPNext', status: 'closed', failures: 0, successRate: 100 },
  ];

  const conversationsBarData = [
    { name: 'Seg', ai: 0, human: 0 },
    { name: 'Ter', ai: 0, human: 0 },
    { name: 'Qua', ai: 0, human: 0 },
    { name: 'Qui', ai: 0, human: 0 },
    { name: 'Sex', ai: 0, human: 0 },
    { name: 'Sáb', ai: 0, human: 0 },
    { name: 'Dom', ai: 0, human: 0 },
  ];

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
              {t('dashboard.title') || 'Dashboard'}
            </h1>
            <p className="text-muted-foreground">
              {t('dashboard.summary') || 'Visão geral da plataforma Alice Enterprise'}
            </p>
          </div>
          <div className="flex items-center gap-2 mt-2 sm:mt-0">
            <Badge variant="outline" className="flex items-center gap-1">
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              Sistema Online
            </Badge>
          </div>
        </div>
      </motion.div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t('dashboard.stats.activeConversations') || 'Conversas'}
          value={displayStats.conversations}
          description={t('dashboard.stats.totalConversations') || 'total acumulado'}
          icon={MessageSquare}
          trend={displayStats.trend?.conversations}
          isLoading={statsLoading}
          accent="default"
        />
        <StatCard
          title={t('dashboard.stats.ragDocuments') || 'Documentos RAG'}
          value={displayStats.documents}
          description={t('nav.knowledge') || 'base de conhecimento'}
          icon={FileText}
          trend={displayStats.trend?.documents}
          isLoading={statsLoading}
          accent="success"
        />
        <StatCard
          title={t('nav.training') || 'Training Data'}
          value={displayStats.trainingData}
          description={t('dashboard.training') || 'dados aprovados'}
          icon={Brain}
          trend={displayStats.trend?.trainingData}
          isLoading={statsLoading}
          accent="warning"
        />
        <StatCard
          title={t('dashboard.stats.tokensUsed') || 'Tokens'}
          value={displayStats.tokensUsed > 0 ? `${(displayStats.tokensUsed / 1000).toFixed(1)}K` : '0'}
          description={t('dashboard.usage.tokens') || 'utilizados esta semana'}
          icon={Zap}
          trend={displayStats.trend?.tokensUsed}
          isLoading={statsLoading}
          accent="default"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <IntegrationCard
          title="Stripe Portugal"
          icon={CreditCard}
          isLoading={false}
          stats={
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Receita EUR</span>
                <span className="font-semibold">
                  {integrationStats?.stripe?.totalRevenue?.toLocaleString('pt-PT', { 
                    style: 'currency', 
                    currency: 'EUR' 
                  }) || '€0,00'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Transações</span>
                <span className="font-medium">
                  {integrationStats?.stripe?.transactions || 0}
                </span>
              </div>
            </div>
          }
        />
        <IntegrationCard
          title="Wise Transfers"
          icon={Wallet}
          isLoading={false}
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
        <IntegrationCard
          title="ERPNext CRM"
          icon={Building2}
          isLoading={false}
          stats={
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Clientes</span>
                <span className="font-semibold">
                  {integrationStats?.erpnext?.customers || 0}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Pedidos</span>
                <span className="font-medium">
                  {integrationStats?.erpnext?.orders || 0}
                </span>
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
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <TakeoverStatsCard 
                stats={displayTakeoverStats} 
                isLoading={imageStatsLoading} 
              />
              <ImageGenerationCard 
                stats={displayImageStats} 
                isLoading={imageStatsLoading} 
              />
              <SLAMonitorCard 
                metrics={displaySLAMetrics} 
                isLoading={false} 
              />
              <CircuitBreakerCard 
                breakers={displayCircuitBreakers} 
                isLoading={false} 
              />
            </div>
            <div className="mt-4">
              <ConversationsBarChart 
                data={conversationsBarData} 
                isLoading={statsLoading} 
              />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <Tabs defaultValue="usage" className="space-y-4">
        <TabsList>
          <TabsTrigger value="usage" className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Uso
          </TabsTrigger>
          <TabsTrigger value="distribution" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Distribuição
          </TabsTrigger>
          <TabsTrigger value="services" className="flex items-center gap-2">
            <Cpu className="h-4 w-4" />
            Serviços
          </TabsTrigger>
        </TabsList>

        <div className="grid gap-4 md:grid-cols-3">
          <TabsContent value="usage" className="md:col-span-2 mt-0">
            <motion.div variants={itemVariants}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    {t('dashboard.resourceUsage') || 'Uso de Recursos'}
                  </CardTitle>
                  <CardDescription>
                    Conversas e tokens nos últimos 7 dias
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
                            name="Conversas"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                        <TrendingUp className="h-12 w-12 mb-2 opacity-50" />
                        <p className="text-sm">{t('common.noResults') || 'Sem dados disponíveis'}</p>
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
                    Distribuição de Dados
                  </CardTitle>
                  <CardDescription>
                    Proporção entre conversas, documentos e training
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
                        <p className="text-sm">Sem dados para exibir</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>

          <TabsContent value="services" className="md:col-span-2 mt-0">
            <ServiceHealthCard services={displayServices} isLoading={false} />
          </TabsContent>

          <div className="md:row-span-1">
            <motion.div variants={itemVariants}>
              <Card className="h-full">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-4 w-4" />
                    {t('dashboard.recentActivity') || 'Atividade Recente'}
                  </CardTitle>
                  <CardDescription>
                    {t('dashboard.overview') || 'Últimas ações na plataforma'}
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
                          <p className="text-sm">{t('dashboard.noActivity') || 'Nenhuma atividade recente'}</p>
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
              Visão Geral do Sistema
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <div className="p-2 rounded-md bg-blue-500/10">
                  <Cpu className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">Llama 4 Maverick</p>
                  <p className="text-xs text-muted-foreground">400B parâmetros</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <div className="p-2 rounded-md bg-green-500/10">
                  <Database className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">PostgreSQL + pgvector</p>
                  <p className="text-xs text-muted-foreground">Busca vetorial</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <div className="p-2 rounded-md bg-purple-500/10">
                  <Shield className="h-5 w-5 text-purple-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">RBAC Enterprise</p>
                  <p className="text-xs text-muted-foreground">160+ permissões</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <div className="p-2 rounded-md bg-orange-500/10">
                  <Server className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">Hetzner CX43</p>
                  <p className="text-xs text-muted-foreground">8 vCPUs, 16GB RAM</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
