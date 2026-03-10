import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Brain, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { frontendLogger } from '@/lib/logger';
import { apiRequest } from '@/lib/queryClient';
import { formatDate, formatDateTime } from '@/lib/utils';
import { getTrainingJobStatusBadge } from './training-job-card';

const TRAINING_API_BASE = import.meta.env.VITE_API_URL || '';

type FineTuningJob = {
  id: string;
  name: string;
  baseModel: string;
  status: 'pending' | 'preparing' | 'training' | 'validating' | 'completed' | 'failed' | 'cancelled';
  trainingDataCount: number | null;
  progress: number | null;
  iniciadoEm: string | null;
  completadoEm?: string | null;
  criadoEm: string;
  errorMessage?: string | null;
};

type JobsResponse = {
  jobs: FineTuningJob[];
};

type TrainingGovernanceAuditEvent = {
  id: string;
  action:
    | 'training_promotion_approval_recorded'
    | 'training_model_promoted'
    | 'training_model_rollback_executed'
    | 'training_scope_binding_changed'
    | 'training_run_start_requested'
    | string;
  details: Record<string, unknown> | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string | null;
  } | null;
};

type TrainingJobRealtimeStreamState = 'idle' | 'connecting' | 'live' | 'fallback';

type TrainingJobRealtimeStreamPayload = {
  job: FineTuningJob;
  sentAt?: string;
};

type TrainingJobDetailModalProps = {
  jobId: string | null;
  locale: string;
  onClose: () => void;
  open: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
  timeZone: string;
};

function isFineTuningJobActive(status: FineTuningJob['status']): boolean {
  return status === 'pending'
    || status === 'preparing'
    || status === 'training'
    || status === 'validating';
}

function isTrainingJobRealtimeStreamPayload(value: unknown): value is TrainingJobRealtimeStreamPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (!payload.job || typeof payload.job !== 'object' || Array.isArray(payload.job)) return false;
  const job = payload.job as Record<string, unknown>;
  return typeof job.id === 'string'
    && typeof job.name === 'string'
    && typeof job.status === 'string';
}

function getTrainingAuditActionLabel(
  action: TrainingGovernanceAuditEvent['action'],
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (action === 'training_promotion_approval_recorded') return t('training.audit.actions.approval');
  if (action === 'training_model_promoted') return t('training.audit.actions.promoted');
  if (action === 'training_model_rollback_executed') return t('training.audit.actions.rolledBack');
  if (action === 'training_scope_binding_changed') return t('training.audit.actions.scopeBindingChanged');
  if (action === 'training_run_start_requested') return t('training.audit.actions.runStarted');
  return action;
}

export function TrainingJobDetailModal({
  jobId,
  locale,
  onClose,
  open,
  t,
  timeZone,
}: TrainingJobDetailModalProps) {
  const queryClient = useQueryClient();
  const [jobStreamState, setJobStreamState] = useState<TrainingJobRealtimeStreamState>('idle');

  const { data, isLoading } = useQuery<{ job: FineTuningJob }>({
    queryKey: ['/api/training/jobs', jobId],
    queryFn: async () => {
      const response = await apiRequest('GET', `/api/training/jobs/${jobId}`);
      return response.json();
    },
    enabled: open && !!jobId,
    refetchInterval: (query) => {
      const job = query.state.data?.job;
      if (!job) return false;
      if (jobStreamState === 'live') return false;
      return isFineTuningJobActive(job.status) ? 2000 : false;
    },
  });
  const { data: auditData, isLoading: auditLoading } = useQuery<{ events: TrainingGovernanceAuditEvent[] }>({
    queryKey: ['/api/training/jobs', jobId, 'audit-trail'],
    queryFn: async () => {
      const response = await apiRequest('GET', `/api/training/jobs/${jobId}/audit-trail`);
      return response.json();
    },
    enabled: open && !!jobId,
    refetchInterval: false,
  });

  const job = data?.job;
  const auditEvents = auditData?.events ?? [];

  useEffect(() => {
    if (!open || !jobId || !job || !isFineTuningJobActive(job.status)) {
      setJobStreamState('idle');
      return;
    }

    setJobStreamState('connecting');
    const streamUrl = `${TRAINING_API_BASE}/api/training/jobs/${jobId}/stream`;
    const eventSource = new EventSource(streamUrl, { withCredentials: true });
    let closed = false;

    const applyStreamedJob = (nextJob: FineTuningJob): void => {
      queryClient.setQueryData<{ job: FineTuningJob }>(['/api/training/jobs', jobId], { job: nextJob });
      queryClient.setQueryData<JobsResponse>(['/api/training/jobs'], (previous) => {
        if (!previous) return previous;
        let replaced = false;
        const jobs = previous.jobs.map((existingJob) => {
          if (existingJob.id !== nextJob.id) return existingJob;
          replaced = true;
          return { ...existingJob, ...nextJob };
        });
        return replaced ? { ...previous, jobs } : previous;
      });
    };

    eventSource.onopen = () => {
      if (closed) return;
      setJobStreamState('live');
    };

    eventSource.addEventListener('job', (rawEvent) => {
      if (closed) return;
      const event = rawEvent as MessageEvent<string>;
      try {
        const payload = JSON.parse(event.data) as unknown;
        if (!isTrainingJobRealtimeStreamPayload(payload)) {
          return;
        }
        applyStreamedJob(payload.job);
        setJobStreamState('live');
        if (!isFineTuningJobActive(payload.job.status)) {
          setJobStreamState('idle');
          eventSource.close();
          queryClient.invalidateQueries({ queryKey: ['/api/training/jobs'] });
        }
      } catch (error) {
        frontendLogger.warn('Falha ao processar stream de job de treinamento', {
          jobId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    eventSource.addEventListener('end', () => {
      if (closed) return;
      setJobStreamState('idle');
      eventSource.close();
      queryClient.invalidateQueries({ queryKey: ['/api/training/jobs', jobId] });
      queryClient.invalidateQueries({ queryKey: ['/api/training/jobs'] });
    });

    eventSource.onerror = () => {
      if (closed) return;
      setJobStreamState('fallback');
      eventSource.close();
    };

    return () => {
      closed = true;
      eventSource.close();
    };
  }, [job, jobId, open, queryClient]);

  if (!open || !jobId) return null;

  const startTime = job?.iniciadoEm ? new Date(job.iniciadoEm).getTime() : null;
  const elapsedSec = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
  const progress = job?.progress ?? 0;
  const etaSec = progress > 0 && progress < 100 ? Math.round((elapsedSec / progress) * (100 - progress)) : null;
  const hasActiveStreamableJob = !!job && isFineTuningJobActive(job.status);
  const streamStatusLabel = !hasActiveStreamableJob
    ? null
    : jobStreamState === 'live'
      ? t('training.jobDetail.liveConnected')
      : jobStreamState === 'fallback'
        ? t('training.jobDetail.liveFallback')
        : t('training.jobDetail.liveConnecting');
  const currentTask = job?.status === 'preparing' ? t('training.jobDetail.taskPreparing')
    : job?.status === 'training' ? t('training.jobDetail.taskTraining')
    : job?.status === 'validating' ? t('training.jobDetail.taskValidating')
    : job?.status === 'pending' ? t('training.jobDetail.taskQueued')
    : null;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            {job?.name ?? t('training.jobDetail.loading')}
          </DialogTitle>
          <DialogDescription>
            {job ? t('training.job.baseModel', { model: job.baseModel, count: job.trainingDataCount ?? 0 }) : null}
          </DialogDescription>
        </DialogHeader>
        {isLoading && !job ? (
          <div className="flex items-center gap-2 py-4">
            <Loader2 className="h-5 w-5 animate-spin" />
            {t('training.jobDetail.loading')}
          </div>
        ) : job ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              {getTrainingJobStatusBadge(job.status, t)}
              <span className="text-xs text-muted-foreground">{formatDateTime(job.criadoEm, { locale, timeZone })}</span>
            </div>
            {currentTask && (
              <p className="text-sm text-muted-foreground">{currentTask}</p>
            )}
            {streamStatusLabel && (
              <p className="text-xs text-muted-foreground">{streamStatusLabel}</p>
            )}
            {['preparing', 'training', 'validating'].includes(job.status) && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span>{t('training.job.progress')}</span>
                  <span>{job.progress ?? 0}%</span>
                </div>
                <Progress value={job.progress ?? 0} className="h-2" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">{t('training.jobDetail.elapsed')}</p>
                <p className="font-medium">{t('training.jobDetail.elapsedValue', { seconds: elapsedSec })}</p>
              </div>
              {etaSec !== null && (
                <div className="rounded bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">{t('training.jobDetail.eta')}</p>
                  <p className="font-medium">~{Math.floor(etaSec / 60)}m {etaSec % 60}s</p>
                </div>
              )}
              {job.completadoEm && (
                <div className="col-span-2 rounded bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">
                    {t('training.job.finished', { date: formatDate(job.completadoEm, { locale, timeZone }) })}
                  </p>
                </div>
              )}
            </div>
            {job.errorMessage && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t('training.status.failed')}</AlertTitle>
                <AlertDescription>{job.errorMessage}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('training.audit.title')}
              </p>
              {auditLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('training.audit.loading')}
                </div>
              ) : auditEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('training.audit.empty')}</p>
              ) : (
                <div className="max-h-40 space-y-2 overflow-y-auto rounded border p-2">
                  {auditEvents.map((event) => {
                    const details = event.details ?? {};
                    const reason = typeof details.reason === 'string' ? details.reason : null;
                    return (
                      <div key={event.id} className="rounded border bg-muted/20 p-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Badge variant="outline">{getTrainingAuditActionLabel(event.action, t)}</Badge>
                          <span className="text-muted-foreground">
                            {formatDateTime(event.createdAt, { locale, timeZone })}
                          </span>
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          {event.user?.name ?? t('training.audit.systemUser')}
                        </p>
                        {reason && <p className="mt-1">{t('training.audit.reason', { reason })}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
