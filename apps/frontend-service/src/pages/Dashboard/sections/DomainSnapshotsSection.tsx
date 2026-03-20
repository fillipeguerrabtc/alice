import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import type { DashboardSnapshot } from '../types';

type DomainSnapshotsSectionProps = {
  snapshots: DashboardSnapshot[];
  isLoading: boolean;
  onNavigate: (href: string) => void;
};

function getToneClass(tone: DashboardSnapshot['items'][number]['tone']): string {
  if (tone === 'critical') return 'text-destructive';
  if (tone === 'warning') return 'text-amber-600 dark:text-amber-300';
  if (tone === 'success') return 'text-emerald-600 dark:text-emerald-300';
  return 'text-foreground';
}

export function DomainSnapshotsSection({ snapshots, isLoading, onNavigate }: DomainSnapshotsSectionProps) {
  if (isLoading) {
    return (
      <Card className="rounded-xl">
        <CardHeader>
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="rounded-lg border p-4">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="mt-2 h-4 w-full" />
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {Array.from({ length: 3 }).map((__, itemIndex) => (
                  <div key={itemIndex} className="rounded-md border p-3">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="mt-2 h-6 w-14" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="min-w-0 overflow-hidden rounded-xl">
      <CardHeader>
        <CardTitle>Snapshots por domínio</CardTitle>
        <CardDescription>
          Recortes operacionais exibidos apenas quando fazem sentido para o papel ativo.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0">
        {snapshots.length === 0 ? (
          <EmptyState
            title="Nenhum snapshot adicional para este papel."
            description="A home já está mostrando as métricas essenciais da sua rotina."
          />
        ) : (
          <div className="grid gap-4">
            {snapshots.map((snapshot) => (
              <div key={snapshot.id} className="min-w-0 overflow-hidden rounded-lg border p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="break-words font-medium text-foreground">{snapshot.title}</p>
                    <p className="break-words text-sm leading-6 text-muted-foreground">{snapshot.description}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 self-start"
                    onClick={() => onNavigate(snapshot.href)}
                  >
                    Abrir
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {snapshot.items.map((item) => (
                    <div key={item.label} className="min-w-0 overflow-hidden rounded-md border bg-muted/20 p-3">
                      <p className="break-words text-[11px] font-medium uppercase leading-4 tracking-[0.02em] text-muted-foreground">
                        {item.label}
                      </p>
                      <p className={`mt-2 break-words text-xl font-semibold leading-tight ${getToneClass(item.tone)}`}>
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
