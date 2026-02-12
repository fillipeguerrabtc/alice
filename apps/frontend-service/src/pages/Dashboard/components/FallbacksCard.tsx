/**
 * FallbacksCard - Widget de fallbacks LLM no Dashboard admin
 *
 * Exibe métricas de fallback (contexto sem namespace mapeado) e contextos não mapeados.
 * Link para a página Namespaces para configurar mapeamentos.
 *
 * @module Dashboard/components/FallbacksCard
 */

import type { KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, FolderKanban } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { itemVariants } from './types';

/** Estatísticas de fallback LLM */
interface FallbackStats {
  total: number;
  last24h: number;
  last7d: number;
  byRoute: Array<{ rota: string; count: number }>;
  byContext: Array<{ contexto: string; count: number }>;
}

/** Item de contexto não mapeado */
interface UnmappedContext {
  rota: string;
  contexto: string;
  fallbackCount: number;
}

interface FallbacksCardProps {
  fallbackStats?: FallbackStats | null;
  unmappedContexts?: UnmappedContext[];
  isLoading: boolean;
  onClick?: () => void;
}

export function FallbacksCard({
  fallbackStats,
  unmappedContexts = [],
  isLoading,
  onClick,
}: FallbacksCardProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const last7d = fallbackStats?.last7d ?? 0;
  const unmappedCount = unmappedContexts.length;
  const hasAlerts = last7d > 0 || unmappedCount > 0;

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
          <div
            className={`p-2 rounded-md ${hasAlerts ? 'bg-amber-500/10' : 'bg-muted/50'}`}
          >
            <AlertTriangle
              className={`h-4 w-4 ${hasAlerts ? 'text-amber-500' : 'text-muted-foreground'}`}
            />
          </div>
          <div className="flex-1">
            <CardTitle className="text-sm font-medium">
              {t('dashboard.fallbacks.title')}
            </CardTitle>
            <CardDescription className="text-xs">
              {t('dashboard.fallbacks.description')}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
            <span className="text-sm text-muted-foreground">
              {t('dashboard.fallbacks.last7d')}
            </span>
            <Badge variant={last7d > 0 ? 'destructive' : 'secondary'}>
              {last7d}
            </Badge>
          </div>
          <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
            <span className="text-sm text-muted-foreground">
              {t('dashboard.fallbacks.unmappedContexts')}
            </span>
            <Badge variant={unmappedCount > 0 ? 'destructive' : 'secondary'}>
              {unmappedCount}
            </Badge>
          </div>
          {hasAlerts && (
            <div className="flex items-center gap-1 pt-1 text-xs text-muted-foreground">
              <FolderKanban className="h-3 w-3 shrink-0" />
              <span>{t('dashboard.fallbacks.configureInNamespaces')}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
