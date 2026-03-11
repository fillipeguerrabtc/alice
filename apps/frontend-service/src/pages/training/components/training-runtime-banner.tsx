import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { TrainingTranslationFn } from '../training-request-utils';

type TrainingRuntimeBannerProps = {
  inferenceAvailable: boolean;
  isLoading: boolean;
  reason: string | null;
  runtimeState: string | null;
  t: TrainingTranslationFn;
};

const TRANSITION_STATES = new Set([
  'serving_draining',
  'training_starting',
  'training_finishing',
  'serving_restoring',
]);

export function TrainingRuntimeBanner({
  inferenceAvailable,
  isLoading,
  reason,
  runtimeState,
  t,
}: TrainingRuntimeBannerProps) {
  if (isLoading) {
    return null;
  }

  const inTransition = runtimeState ? TRANSITION_STATES.has(runtimeState) : false;
  if (inferenceAvailable && !inTransition) {
    return null;
  }

  if (inferenceAvailable && inTransition) {
    return (
      <Alert className="mb-4" data-testid="training-runtime-transition-banner">
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>{t('training.runtime.banner.transitionTitle')}</AlertTitle>
        <AlertDescription>
          {t('training.runtime.banner.transitionDescription', {
            state: runtimeState ?? t('training.runtime.state.unknown'),
          })}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="mb-4" variant="destructive" data-testid="training-runtime-interruption-banner">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{t('training.runtime.banner.interruptedTitle')}</AlertTitle>
      <AlertDescription>
        {reason?.trim().length
          ? reason
          : t('training.runtime.banner.interruptedDescription')}
      </AlertDescription>
    </Alert>
  );
}
