import { Fragment, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Brain, Clock, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { TabsContent } from '@/components/ui/tabs';

type TrainingJobsTabJobBase = {
  id: string;
  name: string;
  status: 'pending' | 'preparing' | 'training' | 'validating' | 'completed' | 'failed' | 'cancelled';
  evaluationStatus?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  promotionStatus?: 'candidate' | 'staged' | 'activating' | 'active' | 'rollback_pending' | 'failed_activation' | 'archived' | 'rejected' | 'rolled_back';
};

type TrainingJobsTabContentProps<TJob extends TrainingJobsTabJobBase> = {
  activeJobsByScope: TJob[];
  allJobs: TJob[];
  createFirstJobDisabled: boolean;
  jobsLoading: boolean;
  onCreateFirstJob: () => void;
  renderHistoryJobCard: (job: TJob) => ReactNode;
  renderRunningJobCard: (job: TJob) => ReactNode;
  resolveScopeLabel: (job: TJob) => string;
  t: (key: string, options?: Record<string, unknown>) => string;
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
} as const;

export function TrainingJobsTabContent<TJob extends TrainingJobsTabJobBase>({
  activeJobsByScope,
  allJobs,
  createFirstJobDisabled,
  jobsLoading,
  onCreateFirstJob,
  renderHistoryJobCard,
  renderRunningJobCard,
  resolveScopeLabel,
  t,
}: TrainingJobsTabContentProps<TJob>) {
  const runningJobs = allJobs.filter((job) => ['pending', 'preparing', 'training', 'validating'].includes(job.status));
  const historyJobs = allJobs.filter((job) => ['completed', 'failed', 'cancelled'].includes(job.status));

  return (
    <TabsContent value="jobs" className="flex-1 m-0">
      <ScrollArea className="flex-1 p-4">
        {jobsLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-48" />
            ))}
          </div>
        ) : allJobs.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center h-64 text-center"
          >
            <Brain className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-medium mb-1">{t('training.empty.noJobs')}</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              {t('training.empty.noJobsDesc')}
            </p>
            <Button
              className="mt-4"
              onClick={onCreateFirstJob}
              disabled={createFirstJobDisabled}
              data-testid="button-create-first-job"
            >
              <Brain className="h-4 w-4 mr-2" />
              {t('training.empty.createFirstJob')}
            </Button>
          </motion.div>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t('training.activeByScope.title')}</CardTitle>
                <CardDescription>{t('training.activeByScope.desc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {activeJobsByScope.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('training.activeByScope.none')}</p>
                ) : (
                  activeJobsByScope.map((job) => (
                    <div key={job.id} className="flex items-center justify-between rounded-md border p-2">
                      <div>
                        <p className="text-sm font-medium">{job.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {resolveScopeLabel(job)}
                        </p>
                      </div>
                      <Badge>{t('training.promotion.active')}</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {runningJobs.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-primary" />
                  {t('training.jobsInProgress')}
                </h3>
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  className="grid gap-4 md:grid-cols-2"
                >
                  {runningJobs.map((job) => (
                    <Fragment key={job.id}>{renderRunningJobCard(job)}</Fragment>
                  ))}
                </motion.div>
              </div>
            )}

            {historyJobs.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  {t('training.jobHistory')}
                </h3>
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  className="grid gap-4 md:grid-cols-2"
                >
                  {historyJobs.map((job) => (
                    <Fragment key={job.id}>{renderHistoryJobCard(job)}</Fragment>
                  ))}
                </motion.div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </TabsContent>
  );
}
