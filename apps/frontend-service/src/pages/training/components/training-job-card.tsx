import { Brain, CheckCircle2, Clock, Pause, Play, RefreshCw, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { formatDate } from '@/lib/utils';

type TrainingJobCardData = {
  id: string;
  name: string;
  status: 'pending' | 'preparing' | 'training' | 'validating' | 'completed' | 'failed' | 'cancelled';
  trainingDataCount: number | null;
  progress: number | null;
  criadoEm: string;
  completadoEm?: string | null;
  baseModel: string;
  evaluationStatus?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  promotionStatus?: 'candidate' | 'staged' | 'activating' | 'active' | 'rollback_pending' | 'failed_activation' | 'archived' | 'rejected' | 'rolled_back';
  hyperparameters: {
    epochs?: number;
    learningRate?: number;
    batchSize?: number;
  };
  runSource?: 'custom_job' | 'on_demand' | 'scheduled';
  configSnapshot?: {
    priority?: 'low' | 'normal' | 'high';
  } | null;
  metrics: Record<string, unknown> | null;
};

type TrainingJobCardProps = {
  actionPending?: boolean;
  canApprovePromotion?: boolean;
  canPromote?: boolean;
  canRejectPromotion?: boolean;
  canRollback?: boolean;
  job: TrainingJobCardData;
  locale: string;
  onApprovePromotion?: () => void;
  onClick?: () => void;
  onPromote?: () => void;
  onRejectPromotion?: () => void;
  onRollback?: () => void;
  scopeLabel: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  timeZone: string;
  variants: {
    hidden: { opacity: number; y: number };
    visible: {
      opacity: number;
      y: number;
      transition: { type: 'spring'; stiffness: number; damping: number };
    };
  };
};

export function getTrainingJobStatusBadge(status: TrainingJobCardData['status'], t: (key: string) => string) {
  switch (status) {
    case 'pending':
      return <Badge variant="outline" className="bg-amber-500/10 text-amber-600"><Clock className="h-3 w-3 mr-1" />{t('training.status.queued')}</Badge>;
    case 'preparing':
      return <Badge variant="outline" className="bg-blue-500/10 text-blue-600"><RefreshCw className="h-3 w-3 mr-1 animate-spin" />{t('training.status.preparing')}</Badge>;
    case 'training':
    case 'validating':
      return <Badge variant="outline" className="bg-purple-500/10 text-purple-600"><Play className="h-3 w-3 mr-1" />{t('training.status.running')}</Badge>;
    case 'completed':
      return <Badge variant="outline" className="bg-green-500/10 text-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />{t('training.status.completed')}</Badge>;
    case 'failed':
      return <Badge variant="outline" className="bg-red-500/10 text-red-600"><AlertCircle className="h-3 w-3 mr-1" />{t('training.status.failed')}</Badge>;
    case 'cancelled':
      return <Badge variant="outline" className="bg-gray-500/10 text-gray-600"><Pause className="h-3 w-3 mr-1" />{t('training.status.cancelled')}</Badge>;
    default:
      return null;
  }
}

function getRunSourceLabel(job: TrainingJobCardData, t: (key: string, options?: Record<string, unknown>) => string): string {
  const runSource = job.runSource ?? 'custom_job';
  if (runSource === 'on_demand') return t('training.job.source.onDemand');
  if (runSource === 'scheduled') return t('training.job.source.scheduled');
  return t('training.job.source.advanced');
}

function getRunPriorityLabel(job: TrainingJobCardData, t: (key: string, options?: Record<string, unknown>) => string): string | null {
  const priority = job.configSnapshot?.priority;
  if (!priority) return null;
  if (priority === 'high') return t('training.job.priority.high');
  if (priority === 'normal') return t('training.job.priority.normal');
  return t('training.job.priority.low');
}

export function TrainingJobCard({
  actionPending,
  canApprovePromotion,
  canPromote,
  canRejectPromotion,
  canRollback,
  job,
  locale,
  onApprovePromotion,
  onClick,
  onPromote,
  onRejectPromotion,
  onRollback,
  scopeLabel,
  t,
  timeZone,
  variants,
}: TrainingJobCardProps) {
  const hyperparameters = job.hyperparameters;
  const evalLabel = t(`training.evaluation.${job.evaluationStatus ?? 'pending'}`);
  const promotionLabel = t(`training.promotion.${job.promotionStatus ?? 'candidate'}`);
  const runSourceLabel = getRunSourceLabel(job, t);
  const runPriorityLabel = getRunPriorityLabel(job, t);
  const timelineFinalKey = job.promotionStatus === 'active'
    ? 'training.timeline.active'
    : (job.promotionStatus === 'rejected' || job.promotionStatus === 'failed_activation' || job.evaluationStatus === 'failed'
      ? 'training.timeline.rejected'
      : 'training.timeline.active');

  const timelineChecks = {
    queued: true,
    preparing: job.status !== 'pending',
    training: ['training', 'validating', 'completed', 'failed', 'cancelled'].includes(job.status),
    evaluating: ['running', 'passed', 'failed', 'skipped'].includes(job.evaluationStatus ?? 'pending'),
    candidate: ['candidate', 'staged', 'activating', 'active', 'rollback_pending', 'failed_activation', 'archived', 'rejected', 'rolled_back'].includes(job.promotionStatus ?? 'candidate'),
    final: ['active', 'failed_activation', 'archived', 'rejected', 'rolled_back'].includes(job.promotionStatus ?? ''),
  };

  const timelineItems = [
    { key: 'queued', label: t('training.timeline.queued'), done: timelineChecks.queued },
    { key: 'preparing', label: t('training.timeline.preparing'), done: timelineChecks.preparing },
    { key: 'training', label: t('training.timeline.training'), done: timelineChecks.training },
    { key: 'evaluating', label: t('training.timeline.evaluating'), done: timelineChecks.evaluating },
    { key: 'candidate', label: t('training.timeline.candidate'), done: timelineChecks.candidate },
    { key: 'final', label: t(timelineFinalKey), done: timelineChecks.final },
  ];

  return (
    <motion.div variants={variants}>
      <Card className="hover-elevate cursor-pointer" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">{job.name}</CardTitle>
            </div>
            {getTrainingJobStatusBadge(job.status, t)}
          </div>
          <CardDescription>
            {t('training.job.baseModel', { model: job.baseModel, count: job.trainingDataCount ?? 0 })}
          </CardDescription>
          <CardDescription>{scopeLabel}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          {['preparing', 'training', 'validating'].includes(job.status) && job.progress !== null && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t('training.job.progress')}</span>
                <span>{job.progress}%</span>
              </div>
              <Progress value={job.progress} className="h-2" />
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="p-2 rounded bg-muted/50 text-center">
              <div className="font-medium">{hyperparameters?.epochs ?? '-'}</div>
              <div className="text-muted-foreground">{t('training.job.epochs')}</div>
            </div>
            <div className="p-2 rounded bg-muted/50 text-center">
              <div className="font-medium">{hyperparameters?.batchSize ?? '-'}</div>
              <div className="text-muted-foreground">{t('training.job.batch')}</div>
            </div>
            <div className="p-2 rounded bg-muted/50 text-center">
              <div className="font-medium">{hyperparameters?.learningRate ?? '-'}</div>
              <div className="text-muted-foreground">{t('training.job.lr')}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{runSourceLabel}</Badge>
            {runPriorityLabel && <Badge variant="outline">{runPriorityLabel}</Badge>}
            <Badge variant="outline">{evalLabel}</Badge>
            <Badge variant="outline">{promotionLabel}</Badge>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">{t('training.timeline.label')}</div>
            <div className="flex flex-wrap gap-1">
              {timelineItems.map((item) => (
                <Badge
                  key={item.key}
                  variant={item.done ? 'secondary' : 'outline'}
                  className="text-[10px]"
                >
                  {item.label}
                </Badge>
              ))}
            </div>
          </div>

          {job.metrics && typeof job.metrics === 'object' && Object.keys(job.metrics).length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {Object.entries(job.metrics).map(([key, value]) => (
                <Badge key={key} variant="secondary" className="text-xs">
                  {key}: {typeof value === 'number' ? value.toFixed(4) : String(value)}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>

        <CardFooter className="pt-2 text-xs text-muted-foreground">
          <div className="w-full space-y-2">
            <div className="flex justify-between w-full">
              <span>{t('training.job.created', { date: formatDate(job.criadoEm, { locale, timeZone }) })}</span>
              {(job.completadoEm ?? (job as unknown as Record<string, unknown>).finalizadoEm as string | undefined) && (
                <span>{t('training.job.finished', { date: formatDate((job.completadoEm ?? (job as unknown as Record<string, unknown>).finalizadoEm) as string, { locale, timeZone }) })}</span>
              )}
            </div>
            {(canPromote || canApprovePromotion || canRejectPromotion || canRollback) && (
              <div className="flex flex-wrap gap-2">
                {canApprovePromotion && onApprovePromotion && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-green-700"
                    disabled={actionPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      onApprovePromotion();
                    }}
                  >
                    {t('training.actions.approvePromotion')}
                  </Button>
                )}
                {canRejectPromotion && onRejectPromotion && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-red-700"
                    disabled={actionPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRejectPromotion();
                    }}
                  >
                    {t('training.actions.rejectPromotion')}
                  </Button>
                )}
                {canPromote && onPromote && (
                  <Button
                    size="sm"
                    className="h-7"
                    disabled={actionPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      onPromote();
                    }}
                  >
                    {t('training.actions.promote')}
                  </Button>
                )}
                {canRollback && onRollback && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    disabled={actionPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRollback();
                    }}
                  >
                    {t('training.actions.rollback')}
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardFooter>
      </Card>
    </motion.div>
  );
}
