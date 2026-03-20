import { Activity, AlertCircle, ShieldAlert, TimerReset } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/utils';
import type { DashboardHealth } from '../types';

type HealthSummarySectionProps = {
  health?: DashboardHealth;
  isLoading: boolean;
  locale: string;
  onNavigate: (href: string) => void;
};

export function HealthSummarySection({ health, isLoading, locale, onNavigate }: HealthSummarySectionProps) {
  if (isLoading) {
    return (
      <Card className="rounded-xl">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-lg border p-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-3 h-8 w-20" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!health) {
    return null;
  }

  const observabilityHref = health.href;

  const metrics = [
    {
      id: 'services',
      icon: Activity,
      label: 'Serviços',
      value: `${formatNumber(health.services.online, locale)} online / ${formatNumber(health.services.degraded + health.services.offline, locale)} com atenção`,
    },
    {
      id: 'breakers',
      icon: ShieldAlert,
      label: 'Circuit breakers',
      value: `${formatNumber(health.circuitBreakers.open + health.circuitBreakers.halfOpen, locale)} problemáticos`,
    },
    {
      id: 'sla',
      icon: AlertCircle,
      label: 'SLA',
      value: `${formatNumber(health.sla.atRisk + health.sla.breached, locale)} em risco ou violado(s)`,
    },
    {
      id: 'latency',
      icon: TimerReset,
      label: 'Latência média',
      value: `${formatNumber(health.avgLatencyMs, locale)} ms`,
    },
  ];

  return (
    <Card className="rounded-xl">
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Saúde da plataforma</CardTitle>
            <CardDescription>
              Resumo operacional de serviços, circuit breakers, SLA e tempo de resposta.
            </CardDescription>
          </div>
          {observabilityHref ? (
            <Button variant="outline" onClick={() => onNavigate(observabilityHref)}>
              Ver observabilidade completa
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {metrics.map((metric) => (
          <div key={metric.id} className="rounded-lg border p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <metric.icon className="h-4 w-4" />
              {metric.label}
            </div>
            <p className="mt-3 text-lg font-semibold text-foreground">{metric.value}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
