import { startTransition, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Line,
  LineChart,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/utils';
import type {
  DashboardConversationTrendPoint,
  DashboardTokensTrendPoint,
  DashboardHomeResponse,
} from '../types';

type TrendSectionProps = {
  data?: DashboardHomeResponse['trends'];
  isLoading: boolean;
  locale: string;
};

export function TrendSection({ data, isLoading, locale }: TrendSectionProps) {
  const [metric, setMetric] = useState<'conversations' | 'tokens'>(data?.defaultMetric ?? 'conversations');
  const [window, setWindow] = useState<'7d' | '30d'>(data?.defaultWindow ?? '7d');

  if (isLoading) {
    return (
      <Card className="rounded-xl">
        <CardHeader>
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[320px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const selectedMetric = data.metrics.find((item) => item.id === metric) ?? data.metrics[0];
  const selectedSeries = selectedMetric?.seriesByWindow[window] ?? [];

  return (
    <Card className="rounded-xl">
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Tendência</CardTitle>
            <CardDescription>
              Volume resumido do período com leitura imediata do comportamento operacional.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.metrics.map((item) => (
              <Button
                key={item.id}
                variant={metric === item.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => startTransition(() => setMetric(item.id))}
              >
                {item.label}
              </Button>
            ))}
            {data.windows.map((item) => (
              <Button
                key={item.id}
                variant={window === item.id ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => startTransition(() => setWindow(item.id))}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {selectedSeries.length === 0 ? (
          <EmptyState
            title="Sem dados suficientes para exibir tendência."
            description="A série aparecerá assim que houver volume no período selecionado."
          />
        ) : selectedMetric.id === 'conversations' ? (
          <div className="space-y-4">
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={selectedSeries as DashboardConversationTrendPoint[]}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Bar dataKey="ai" stackId="conversations" fill="#2563eb" radius={[4, 4, 0, 0]} name="IA" />
                  <Bar dataKey="human" stackId="conversations" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Humano" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-sm text-muted-foreground">
              Conversas por dia com separação entre fluxo resolvido por IA e fluxo que exigiu intervenção humana.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={selectedSeries as DashboardTokensTrendPoint[]}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip formatter={(value: number) => formatNumber(Number(value), locale)} />
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="#0f766e"
                    strokeWidth={3}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                    name="Tokens"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-sm text-muted-foreground">
              Tokens por dia no período selecionado, sem misturar total histórico com janela recente.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
