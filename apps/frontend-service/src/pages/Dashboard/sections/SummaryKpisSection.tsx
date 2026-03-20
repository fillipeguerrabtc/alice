import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/utils';
import type { DashboardSummaryCard } from '../types';

type SummaryKpisSectionProps = {
  cards: DashboardSummaryCard[];
  isLoading: boolean;
  locale: string;
  onNavigate: (href: string) => void;
};

function getTrendIcon(referenceLabel: string) {
  return referenceLabel.trim().startsWith('-') ? TrendingDown : TrendingUp;
}

export function SummaryKpisSection({ cards, isLoading, locale, onNavigate }: SummaryKpisSectionProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="rounded-xl">
            <CardHeader className="space-y-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-4 w-40" />
            </CardHeader>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const TrendIcon = getTrendIcon(card.referenceLabel);

        return (
          <Card
            key={card.id}
            className="rounded-xl transition-colors hover:border-primary/40"
          >
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
                  <div className="text-3xl font-semibold tracking-tight">
                    {formatNumber(card.value, locale)}
                  </div>
                </div>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={`Abrir ${card.title}`}
                  onClick={() => onNavigate(card.href)}
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-1 text-sm">
                <p className="font-medium text-foreground">{card.periodLabel}</p>
                <p className="flex items-center gap-2 text-muted-foreground">
                  <TrendIcon className="h-4 w-4" />
                  {card.referenceLabel}
                </p>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <button
                type="button"
                className="text-sm font-medium text-primary"
                onClick={() => onNavigate(card.href)}
              >
                Abrir detalhe
              </button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
