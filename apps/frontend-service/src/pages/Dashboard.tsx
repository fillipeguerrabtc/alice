/**
 * Dashboard - Alice Enterprise Platform
 * 
 * Painel de controle com métricas em tempo real.
 * Usa dados reais da API (Regra 6 - SEM MOCKS)
 * Internacionalização completa (Regra 13 - i18n)
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageSquare, FileText, Brain, Zap, TrendingUp, Users, Activity } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

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
}

function StatCard({ title, value, description, icon: Icon, trend, isLoading }: {
  title: string;
  value: string | number;
  description: string;
  icon: typeof MessageSquare;
  trend?: number;
  isLoading?: boolean;
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold" data-testid={`stat-${title.toLowerCase().replace(/\s/g, '-')}`}>
          {typeof value === 'number' ? value.toLocaleString('pt-BR') : value}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {trend !== undefined && (
            <span className={trend >= 0 ? 'text-green-600' : 'text-red-600'}>
              {trend >= 0 ? '+' : ''}{trend}%
            </span>
          )}
          <span>{description}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ['/api/chat/stats'],
    staleTime: 1000 * 60 * 5,
  });

  const { data: usageData, isLoading: usageLoading } = useQuery<UsageData[]>({
    queryKey: ['/api/chat/usage'],
    staleTime: 1000 * 60 * 5,
  });

  const { data: recentActivity, isLoading: activityLoading } = useQuery<RecentActivity[]>({
    queryKey: ['/api/audit/recent'],
    staleTime: 1000 * 60,
  });

  const displayStats: DashboardStats = stats || {
    conversations: 0,
    documents: 0,
    trainingData: 0,
    tokensUsed: 0,
  };

  const displayUsage: UsageData[] = usageData || [];
  const displayActivity: RecentActivity[] = recentActivity || [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
          {t('dashboard.title')}
        </h1>
        <p className="text-muted-foreground">
          {t('dashboard.summary')}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t('dashboard.stats.activeConversations')}
          value={displayStats.conversations}
          description={t('dashboard.stats.totalConversations')}
          icon={MessageSquare}
          trend={displayStats.trend?.conversations}
          isLoading={statsLoading}
        />
        <StatCard
          title={t('dashboard.stats.ragDocuments')}
          value={displayStats.documents}
          description={t('nav.knowledge')}
          icon={FileText}
          trend={displayStats.trend?.documents}
          isLoading={statsLoading}
        />
        <StatCard
          title={t('nav.training') || 'Training Data'}
          value={displayStats.trainingData}
          description={t('dashboard.training')}
          icon={Brain}
          trend={displayStats.trend?.trainingData}
          isLoading={statsLoading}
        />
        <StatCard
          title={t('dashboard.stats.tokensUsed')}
          value={displayStats.tokensUsed > 0 ? `${(displayStats.tokensUsed / 1000).toFixed(1)}K` : '0'}
          description={t('dashboard.usage.tokens')}
          icon={Zap}
          trend={displayStats.trend?.tokensUsed}
          isLoading={statsLoading}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              {t('dashboard.resourceUsage')}
            </CardTitle>
            <CardDescription>
              {t('dashboard.usage.tokens')}
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
                  <LineChart data={displayUsage}>
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
                    <Line
                      type="monotone"
                      dataKey="conversations"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      name={t('dashboard.stats.activeConversations')}
                    />
                  </LineChart>
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              {t('dashboard.recentActivity')}
            </CardTitle>
            <CardDescription>
              {t('dashboard.overview')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {activityLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <div className="flex-1 min-w-0 space-y-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                    <Skeleton className="h-3 w-16" />
                  </div>
                ))
              ) : displayActivity.length > 0 ? (
                displayActivity.map((activity) => (
                  <div key={activity.id} className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{activity.action}</p>
                      <p className="text-xs text-muted-foreground">{activity.user}</p>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {activity.time}
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Activity className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-sm">{t('dashboard.noActivity')}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
