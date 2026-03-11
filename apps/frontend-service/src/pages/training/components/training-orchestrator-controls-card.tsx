import { Loader2, RotateCcw, ShieldAlert, Wrench } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { TrainingTranslationFn } from '../training-request-utils';

type TrainingOrchestratorControlsCardProps = {
  canControl: boolean;
  controlsDisabled: boolean;
  currentState: string | null;
  isPreparePending: boolean;
  isRestorePending: boolean;
  onPrepareTraining: () => void;
  onRestoreServing: () => void;
  t: TrainingTranslationFn;
};

export function TrainingOrchestratorControlsCard({
  canControl,
  controlsDisabled,
  currentState,
  isPreparePending,
  isRestorePending,
  onPrepareTraining,
  onRestoreServing,
  t,
}: TrainingOrchestratorControlsCardProps) {
  const isBusy = isPreparePending || isRestorePending;
  const isPrepareBlockedByState = currentState === 'training_active' || currentState === 'training_starting';
  const isRestoreBlockedByState = currentState === 'serving_ready' || currentState === 'serving_restoring';

  return (
    <Card data-testid="training-orchestrator-controls-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4" />
          {t('training.runtime.controls.title')}
        </CardTitle>
        <CardDescription>{t('training.runtime.controls.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!canControl && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>{t('training.runtime.controls.restrictedTitle')}</AlertTitle>
            <AlertDescription>{t('training.runtime.controls.restrictedDescription')}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-2">
          <Button
            onClick={onPrepareTraining}
            disabled={!canControl || controlsDisabled || isBusy || isPrepareBlockedByState}
            data-testid="button-prepare-training-runtime"
          >
            {isPreparePending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Wrench className="h-4 w-4 mr-2" />
            )}
            {t('training.runtime.controls.prepareTraining')}
          </Button>
          <Button
            variant="outline"
            onClick={onRestoreServing}
            disabled={!canControl || controlsDisabled || isBusy || isRestoreBlockedByState}
            data-testid="button-restore-serving-runtime"
          >
            {isRestorePending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-2" />
            )}
            {t('training.runtime.controls.restoreServing')}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          {t('training.runtime.controls.hint')}
        </p>
      </CardContent>
    </Card>
  );
}
