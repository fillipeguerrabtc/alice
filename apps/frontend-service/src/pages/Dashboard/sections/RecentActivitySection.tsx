import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/utils';
import type { DashboardRecentActivity } from '../types';

type RecentActivitySectionProps = {
  items: DashboardRecentActivity[];
  isLoading: boolean;
  locale: string;
  onNavigate: (href: string) => void;
};

export function RecentActivitySection({ items, isLoading, locale, onNavigate }: RecentActivitySectionProps) {
  if (isLoading) {
    return (
      <Card className="rounded-xl">
        <CardHeader>
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="rounded-lg border p-4">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="mt-3 h-4 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="min-w-0 overflow-hidden rounded-xl">
      <CardHeader>
        <CardTitle>Atividade recente</CardTitle>
        <CardDescription>
          Eventos humanizados para leitura rápida, sem despejar o audit log cru na home.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState
            title="Nenhuma atividade recente para exibir."
            description="Quando houver eventos relevantes, eles aparecerão aqui em linguagem operacional."
          />
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const itemHref = item.href;

              return (
                <div key={item.id} className="min-w-0 overflow-hidden rounded-lg border p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-1">
                      <p className="break-words font-medium text-foreground">{item.title}</p>
                      <p className="break-words text-sm text-muted-foreground">{item.description}</p>
                      <p className="break-words text-xs text-muted-foreground">
                        {item.actor} • {item.timestamp ? formatDateTime(item.timestamp, { locale }) : '-'}
                      </p>
                    </div>
                    {itemHref ? (
                      <Button variant="ghost" size="sm" className="shrink-0 self-start" onClick={() => onNavigate(itemHref)}>
                        Abrir
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
