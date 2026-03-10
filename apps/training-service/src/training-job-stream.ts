import { schema } from '@alice/database';

type FineTuningJobRow = typeof schema.fineTuningJobs.$inferSelect;

function toIsoTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stableStringifyForFingerprint(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringifyForFingerprint(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => typeof entryValue !== 'undefined')
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
  return `{${entries
    .map(([entryKey, entryValue]) => `${JSON.stringify(entryKey)}:${stableStringifyForFingerprint(entryValue)}`)
    .join(',')}}`;
}

export function isActiveFineTuningJobStatus(status: FineTuningJobRow['status']): boolean {
  return status === 'pending'
    || status === 'preparing'
    || status === 'training'
    || status === 'validating';
}

export function buildFineTuningJobStreamFingerprint(job: FineTuningJobRow): string {
  const metrics = asObjectRecord(job.metrics);
  const progress = asObjectRecord(metrics?.progress);
  const failure = asObjectRecord(metrics?.failure);

  return stableStringifyForFingerprint({
    id: job.id,
    status: job.status,
    progress: job.progress ?? null,
    evaluationStatus: job.evaluationStatus ?? null,
    promotionStatus: job.promotionStatus ?? null,
    resultModel: job.resultModel ?? null,
    errorMessage: job.errorMessage ?? null,
    iniciadoEm: toIsoTimestamp(job.iniciadoEm),
    completadoEm: toIsoTimestamp(job.completadoEm),
    progressMetrics: {
      status: typeof progress?.status === 'string' ? progress.status : null,
      progress: typeof progress?.progress === 'number' ? progress.progress : null,
      currentStep: typeof progress?.currentStep === 'number' ? progress.currentStep : null,
      totalSteps: typeof progress?.totalSteps === 'number' ? progress.totalSteps : null,
      updatedAt: typeof progress?.updatedAt === 'string' ? progress.updatedAt : null,
      adapterPath: typeof metrics?.adapterPath === 'string' ? metrics.adapterPath : null,
    },
    failureMetrics: {
      message: typeof failure?.message === 'string' ? failure.message : null,
      at: typeof failure?.at === 'string' ? failure.at : null,
    },
  });
}
