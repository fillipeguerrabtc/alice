import { Cpu, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { TrainingTranslationFn } from '../training-request-utils';

type TrainingRuntimeCardProps = {
  inferenceAvailability: 'available' | 'unavailable' | 'unknown';
  isLoading: boolean;
  linkedRunId: string | null;
  linkedRunName: string | null;
  mode: string | null;
  reason: string | null;
  transitionState: string | null;
  t: TrainingTranslationFn;
};

function resolveStateLabel(state: string | null, t: TrainingTranslationFn): string {
  if (!state) {
    return t('training.runtime.state.unknown');
  }

  const key = `training.runtime.state.${state}`;
  const translated = t(key);
  if (translated === key) {
    return state;
  }
  return translated;
}

function resolveModeLabel(mode: string | null, t: TrainingTranslationFn): string {
  if (!mode) {
    return t('training.runtime.mode.unknown');
  }

  const key = `training.runtime.mode.${mode}`;
  const translated = t(key);
  if (translated === key) {
    return mode;
  }
  return translated;
}

function resolveInferenceBadge(
  inferenceAvailability: 'available' | 'unavailable' | 'unknown',
  t: TrainingTranslationFn,
): { label: string; variant: 'secondary' | 'destructive' | 'outline' } {
  if (inferenceAvailability === 'available') {
    return {
      label: t('training.runtime.card.inferenceAvailable'),
      variant: 'secondary',
    };
  }

  if (inferenceAvailability === 'unavailable') {
    return {
      label: t('training.runtime.card.inferenceUnavailable'),
      variant: 'destructive',
    };
  }

  return {
    label: t('training.runtime.card.inferenceUnknown'),
    variant: 'outline',
  };
}

export function TrainingRuntimeCard({
  inferenceAvailability,
  isLoading,
  linkedRunId,
  linkedRunName,
  mode,
  reason,
  transitionState,
  t,
}: TrainingRuntimeCardProps) {
  const inferenceBadge = resolveInferenceBadge(inferenceAvailability, t);

  return (
    <Card data-testid="training-runtime-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4" />
          {t('training.runtime.card.title')}
        </CardTitle>
        <CardDescription>{t('training.runtime.card.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('training.runtime.card.loading')}
          </div>
        ) : (
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">{t('training.runtime.card.currentMode')}</dt>
              <dd className="font-medium text-right">{resolveModeLabel(mode, t)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">{t('training.runtime.card.transitionState')}</dt>
              <dd className="font-medium text-right">
                {transitionState
                  ? resolveStateLabel(transitionState, t)
                  : t('training.runtime.card.noTransition')}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">{t('training.runtime.card.reason')}</dt>
              <dd className="font-medium text-right break-words max-w-[70%]">
                {reason?.trim().length
                  ? reason
                  : t('training.runtime.card.reasonUnavailable')}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">{t('training.runtime.card.linkedRun')}</dt>
              <dd className="font-medium text-right">
                {linkedRunId
                  ? linkedRunName
                    ? `${linkedRunName} (${linkedRunId.slice(0, 8)})`
                    : linkedRunId.slice(0, 8)
                  : t('training.runtime.card.noLinkedRun')}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">{t('training.runtime.card.inferenceAvailability')}</dt>
              <dd>
                <Badge variant={inferenceBadge.variant}>
                  {inferenceBadge.label}
                </Badge>
              </dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
