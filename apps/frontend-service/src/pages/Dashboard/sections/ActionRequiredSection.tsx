import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import type { DashboardAlert } from '../types';

type ActionRequiredSectionProps = {
  alerts: DashboardAlert[];
  isLoading: boolean;
  onNavigate: (href: string) => void;
};

function getSeverityClass(severity: DashboardAlert['severity']): string {
  return severity === 'critical'
    ? 'border-transparent bg-destructive text-destructive-foreground'
    : 'border-transparent bg-amber-100 text-amber-950 dark:bg-amber-500/20 dark:text-amber-100';
}

export function ActionRequiredSection({ alerts, isLoading, onNavigate }: ActionRequiredSectionProps) {
  if (isLoading) {
    return (
      <Card className="rounded-xl">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-lg border p-4">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-40" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="min-w-0 overflow-hidden rounded-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          Precisa de ação agora
        </CardTitle>
        <CardDescription>
          Lista priorizada de exceções que merecem o próximo clique operacional.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <EmptyState
            title="Nenhum alerta crítico ou de atenção no momento."
            description="A plataforma está estável para o escopo que a home acompanha."
          />
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div key={alert.id} className="min-w-0 overflow-hidden rounded-lg border p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={getSeverityClass(alert.severity)}>
                        {alert.severity === 'critical' ? 'Crítico' : 'Atenção'}
                      </Badge>
                      <span className="text-sm font-medium text-muted-foreground">
                        {alert.count} ocorrência(s)
                      </span>
                    </div>
                    <p className="break-words font-medium text-foreground">{alert.title}</p>
                    <p className="break-words text-sm text-muted-foreground">{alert.description}</p>
                  </div>
                  <Button
                    variant="outline"
                    className="shrink-0 self-start"
                    onClick={() => onNavigate(alert.href)}
                  >
                    Abrir
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
