import { Loader2, FileCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { TabsContent } from '@/components/ui/tabs';

type NamespaceOption = {
  id: string;
  nome: string;
};

type AutoLearningSchedule = {
  id: string;
  type: 'incremental_fine_tuning' | 'complete_fine_tuning';
  scheduledFor: string;
  status: string;
  namespaceId: string | null;
};

type AutoLearningStatus = {
  activeModel?: {
    version: number;
    name: string;
    improvementPercent: number;
    trainingDataUsed: number;
    imagesUsed: number;
  };
  pendingData?: {
    trainingEntries: number;
    images: number;
  };
  recentVersions?: Array<{
    version: number;
    status: string;
    createdAt: string;
  }>;
  upcomingSchedules?: AutoLearningSchedule[];
};

type RunStatus =
  | {
      hasRunningTraining: false;
      status: 'idle';
      message: string;
    }
  | {
      hasRunningTraining: true;
      status: 'training';
      currentJob: {
        id: string;
        name: string;
        baseModel: string;
        trainingDataCount: number | null;
        progress: number;
        elapsedSeconds: number;
        startedAt: string | null;
      };
    };

type QueueStatus = {
  queues: Array<{
    queue: string;
    pending: number;
    lag: number;
    dlq: number;
  }>;
  governance: {
    maxInflightRunsPerTenant: number;
    requireEvalPassedForPromotion: boolean;
    requireDualApprovalForPromotion: boolean;
    promotionMinApprovals: number;
    requireIdempotencyKeyForRunStart?: boolean;
    requireStrictApprovedDataForAutoEngine?: boolean;
    tradingMinInferenceConfidence?: number;
  };
  tenant: {
    id: string;
    inflightCount: number;
  };
};

type TrainingAutoLearningTabContentProps = {
  autoLearning?: AutoLearningStatus;
  autoLearningLoading: boolean;
  canManageSchedule: boolean;
  configureSchedulePending: boolean;
  formatScheduleDate: (value: string) => string;
  minScheduledDatasetSizeFull: number;
  minScheduledDatasetSizeIncremental: number;
  namespaces: NamespaceOption[];
  onConfigureSchedule: () => void;
  queueStatus?: QueueStatus;
  queueStatusLoading: boolean;
  resolveScheduleScopeLabel: (namespaceId: string | null) => string;
  runStatus?: RunStatus;
  runStatusLoading: boolean;
  scheduleCronPattern: string;
  scheduleEnabled: boolean;
  scheduleMinDataRequired: number;
  scheduleNamespaceId: string;
  scheduleType: 'incremental_fine_tuning' | 'complete_fine_tuning';
  setScheduleCronPattern: (value: string) => void;
  setScheduleEnabled: (value: boolean) => void;
  setScheduleMinDataRequired: (value: number) => void;
  setScheduleNamespaceId: (value: string) => void;
  setScheduleType: (value: 'incremental_fine_tuning' | 'complete_fine_tuning') => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  tenantId: string | null | undefined;
};

export function TrainingAutoLearningTabContent({
  autoLearning,
  autoLearningLoading,
  canManageSchedule,
  configureSchedulePending,
  formatScheduleDate,
  minScheduledDatasetSizeFull,
  minScheduledDatasetSizeIncremental,
  namespaces,
  onConfigureSchedule,
  queueStatus,
  queueStatusLoading,
  resolveScheduleScopeLabel,
  runStatus,
  runStatusLoading,
  scheduleCronPattern,
  scheduleEnabled,
  scheduleMinDataRequired,
  scheduleNamespaceId,
  scheduleType,
  setScheduleCronPattern,
  setScheduleEnabled,
  setScheduleMinDataRequired,
  setScheduleNamespaceId,
  setScheduleType,
  t,
  tenantId,
}: TrainingAutoLearningTabContentProps) {
  const scheduleControlsDisabled = !tenantId || configureSchedulePending || !canManageSchedule;

  return (
    <TabsContent value="auto-learning" className="flex-1 m-0">
      <ScrollArea className="flex-1 p-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('training.autoLearning.statusTitle')}</CardTitle>
              <CardDescription>{t('training.autoLearning.statusDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              {autoLearningLoading ? (
                <Skeleton className="h-32" />
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{t('training.autoLearning.activeModel')}</span>
                    <Badge variant="secondary">
                      {autoLearning?.activeModel?.name} v{autoLearning?.activeModel?.version}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">{t('training.autoLearning.pendingEntries')}</div>
                      <div className="text-xl font-semibold">{autoLearning?.pendingData?.trainingEntries ?? 0}</div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">{t('training.autoLearning.pendingImages')}</div>
                      <div className="text-xl font-semibold">{autoLearning?.pendingData?.images ?? 0}</div>
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">{t('training.autoLearning.runStatus')}</div>
                    {runStatusLoading ? (
                      <Skeleton className="h-6 mt-2" />
                    ) : runStatus?.hasRunningTraining ? (
                      <div className="mt-2 text-sm">
                        <div className="font-medium">{runStatus.currentJob.name}</div>
                        <div className="text-muted-foreground">
                          {t('training.autoLearning.elapsed', { seconds: runStatus.currentJob.elapsedSeconds })}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-muted-foreground">
                        {runStatus?.message || t('training.autoLearning.idle')}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('training.autoLearning.scheduleTitle')}</CardTitle>
              <CardDescription>{t('training.autoLearning.scheduleDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label>{t('training.autoLearning.scheduleType')}</Label>
                  <Select value={scheduleType} onValueChange={setScheduleType} disabled={scheduleControlsDisabled}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="incremental_fine_tuning">{t('training.autoLearning.incremental')}</SelectItem>
                      <SelectItem value="complete_fine_tuning">{t('training.autoLearning.complete')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>{t('training.autoLearning.scheduleScope')}</Label>
                  <Select value={scheduleNamespaceId} onValueChange={setScheduleNamespaceId} disabled={scheduleControlsDisabled}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__tenant__">{t('training.autoLearning.scheduleScopeTenant')}</SelectItem>
                      {namespaces.map((namespace) => (
                        <SelectItem key={namespace.id} value={namespace.id}>{namespace.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t('training.autoLearning.scheduleScopeDesc')}</p>
                </div>

                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <div className="text-sm font-medium">{t('training.autoLearning.enabled')}</div>
                    <div className="text-xs text-muted-foreground">{t('training.autoLearning.enabledDesc')}</div>
                  </div>
                  <Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} disabled={scheduleControlsDisabled} />
                </div>

                <div className="grid gap-2">
                  <Label>{t('training.autoLearning.cronPattern')}</Label>
                  <Input
                    value={scheduleCronPattern}
                    onChange={(event) => setScheduleCronPattern(event.target.value)}
                    placeholder="0 3 * * 0"
                    disabled={scheduleControlsDisabled}
                  />
                  <p className="text-xs text-muted-foreground">{t('training.autoLearning.cronHelp')}</p>
                </div>

                <div className="grid gap-2">
                  <Label>{t('training.autoLearning.minDataRequired')}</Label>
                  <Input
                    type="number"
                    value={scheduleMinDataRequired}
                    onChange={(event) => setScheduleMinDataRequired(Number(event.target.value))}
                    min={
                      scheduleType === 'incremental_fine_tuning'
                        ? minScheduledDatasetSizeIncremental
                        : minScheduledDatasetSizeFull
                    }
                    disabled={scheduleControlsDisabled}
                  />
                </div>

                <Button onClick={onConfigureSchedule} disabled={scheduleControlsDisabled}>
                  {configureSchedulePending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('training.autoLearning.saving')}
                    </>
                  ) : (
                    <>
                      <FileCheck className="h-4 w-4 mr-2" />
                      {t('training.autoLearning.saveSchedule')}
                    </>
                  )}
                </Button>
                {!canManageSchedule && (
                  <p className="text-xs text-amber-600">
                    {t('training.runtime.controls.restrictedDescription')}
                  </p>
                )}
              </div>

              <div className="rounded-md border p-3">
                <div className="text-sm font-medium mb-2">{t('training.autoLearning.upcoming')}</div>
                {autoLearningLoading ? (
                  <Skeleton className="h-20" />
                ) : (autoLearning?.upcomingSchedules?.length || 0) === 0 ? (
                  <div className="text-sm text-muted-foreground">{t('training.autoLearning.noUpcoming')}</div>
                ) : (
                  <div className="space-y-2">
                    {autoLearning?.upcomingSchedules?.slice(0, 5).map((schedule) => (
                      <div key={schedule.id} className="flex items-center justify-between text-sm">
                        <div className="flex flex-col">
                          <span className="text-muted-foreground">
                            {schedule.type === 'incremental_fine_tuning'
                              ? t('training.autoLearning.incremental')
                              : t('training.autoLearning.complete')}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {resolveScheduleScopeLabel(schedule.namespaceId)}
                          </span>
                        </div>
                        <span>{formatScheduleDate(schedule.scheduledFor)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('training.autoLearning.queueTitle')}</CardTitle>
              <CardDescription>{t('training.autoLearning.queueDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {queueStatusLoading ? (
                <Skeleton className="h-24" />
              ) : (
                <>
                  <div className="rounded-md border p-3 space-y-2">
                    <div className="text-xs text-muted-foreground">{t('training.autoLearning.policyTitle')}</div>
                    <div className="text-sm">
                      {t('training.autoLearning.policyInflight', {
                        current: queueStatus?.tenant?.inflightCount ?? 0,
                        max: queueStatus?.governance?.maxInflightRunsPerTenant ?? 0,
                      })}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {queueStatus?.governance?.requireEvalPassedForPromotion
                        ? t('training.autoLearning.policyRequireEvalPassed')
                        : t('training.autoLearning.policyAllowWithoutEval')}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {queueStatus?.governance?.requireDualApprovalForPromotion
                        ? t('training.autoLearning.policyDualApprovalEnabled', {
                          count: queueStatus?.governance?.promotionMinApprovals ?? 2,
                        })
                        : t('training.autoLearning.policyDualApprovalDisabled')}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {queueStatus?.governance?.requireIdempotencyKeyForRunStart
                        ? t('training.autoLearning.policyRequireIdempotencyKey')
                        : t('training.autoLearning.policyOptionalIdempotencyKey')}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {queueStatus?.governance?.requireStrictApprovedDataForAutoEngine
                        ? t('training.autoLearning.policyRequireStrictTradingData', {
                          confidence: Number(
                            queueStatus?.governance?.tradingMinInferenceConfidence ?? 0.65
                          ).toFixed(2),
                        })
                        : t('training.autoLearning.policyRelaxedTradingData')}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {(queueStatus?.queues ?? []).map((queue) => {
                      const priorityLabel = queue.queue.endsWith(':high')
                        ? t('training.autoLearning.priorityHigh')
                        : queue.queue.endsWith(':low')
                          ? t('training.autoLearning.priorityLow')
                          : t('training.autoLearning.priorityNormal');
                      return (
                        <div key={queue.queue} className="rounded-md border p-3">
                          <div className="text-sm font-medium">{priorityLabel}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {t('training.autoLearning.queueStats', {
                              pending: queue.pending,
                              lag: queue.lag,
                              dlq: queue.dlq,
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </TabsContent>
  );
}
