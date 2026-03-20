import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/utils';
import type { DashboardHomeResponse } from '../types';

type HeaderSectionProps = {
  data?: DashboardHomeResponse;
  isLoading: boolean;
  locale: string;
  onNavigate: (href: string) => void;
};

function getStatusClass(level: DashboardHomeResponse['status']['level'] | undefined): string {
  if (level === 'critical') return 'border-transparent bg-destructive text-destructive-foreground';
  if (level === 'warning') return 'border-transparent bg-amber-100 text-amber-950 dark:bg-amber-500/20 dark:text-amber-100';
  return 'border-transparent bg-emerald-100 text-emerald-950 dark:bg-emerald-500/20 dark:text-emerald-100';
}

export function HeaderSection({ data, isLoading, locale, onNavigate }: HeaderSectionProps) {
  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-5 w-80 max-w-full" />
            <Skeleton className="h-5 w-52" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-40" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
            <Badge className={getStatusClass(data?.status.level)}>
              {data?.status.label ?? 'Saudável'}
            </Badge>
          </div>
          <p className="max-w-3xl font-medium text-foreground">
            Torre de controle operacional para saúde, alertas e próximos cliques úteis da Alice.
          </p>
          <p className="text-sm text-muted-foreground">
            Última atualização {data?.meta.generatedAt ? formatDateTime(data.meta.generatedAt, { locale }) : '-'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(data?.quickActions ?? []).map((action) => (
            <Button
              key={action.id}
              variant={action.id === 'new-conversation' ? 'default' : 'outline'}
              onClick={() => onNavigate(action.href)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
