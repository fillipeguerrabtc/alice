/**
 * TakeoverStatsCard - Card de estatísticas de takeover/handover
 * 
 * @module Dashboard/components/TakeoverStatsCard
 */

import type { KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { Headphones, PhoneCall, AlertTriangle, Bot, UserCheck, Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TakeoverStats, itemVariants } from './types';

interface TakeoverStatsCardProps {
  stats: TakeoverStats;
  isLoading: boolean;
  onClick?: () => void;
}

export function TakeoverStatsCard({ stats, isLoading, onClick }: TakeoverStatsCardProps) {
  const { t } = useTranslation();

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

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <motion.div variants={itemVariants}>
      <Card
        className={`hover-elevate ${onClick ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60' : ''}`}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick}
        onKeyDown={handleKeyDown}
      >
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <div className={`p-2 rounded-md ${urgencyColors[urgencyLevel]}`}>
            <Headphones className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-sm font-medium">
              {t('dashboard.takeover.title')}
            </CardTitle>
            <CardDescription className="text-xs">
              {t('dashboard.takeover.description')}
            </CardDescription>
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
                <p className="text-xs text-muted-foreground">
                  {t('dashboard.takeover.pendingHandoffs')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
              <AlertTriangle className={`h-4 w-4 ${stats.urgentConversations > 0 ? 'text-yellow-500' : 'text-muted-foreground'}`} />
              <div>
                <p className="text-lg font-bold" data-testid="stat-urgent-conversations">
                  {stats.urgentConversations}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('dashboard.takeover.urgent')}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-blue-500" />
              <span className="text-sm">
                {t('dashboard.takeover.resolvedByAI')}
              </span>
            </div>
            <span className="font-semibold">{stats.resolvedByAI}</span>
          </div>
          <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-green-500" />
              <span className="text-sm">
                {t('dashboard.takeover.resolvedByHuman')}
              </span>
            </div>
            <span className="font-semibold">{stats.resolvedByHuman}</span>
          </div>
          {stats.avgResponseTime > 0 && (
            <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
              <div className="flex items-center gap-2">
                <Timer className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  {t('dashboard.takeover.avgResponseTime')}
                </span>
              </div>
              <span className="font-semibold">{Math.round(stats.avgResponseTime / 60)}min</span>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
