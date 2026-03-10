import { ApiError } from '@/lib/queryClient';

export type TrainingTranslationFn = (key: string, options?: Record<string, unknown>) => string;

export function generateTrainingIdempotencyKey(prefix: 'training-job' | 'training-on-demand'): string {
  const entropy = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${entropy}`.slice(0, 128);
}

export function buildTrainingIdempotencyFingerprint(value: unknown): string {
  const stableSerialize = (input: unknown): string => {
    if (input === null) return 'null';
    if (typeof input !== 'object') return JSON.stringify(input);
    if (Array.isArray(input)) return `[${input.map((item) => stableSerialize(item)).join(',')}]`;
    const entries = Object.entries(input as Record<string, unknown>)
      .filter(([, entryValue]) => typeof entryValue !== 'undefined')
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
    return `{${entries.map(([entryKey, entryValue]) => `${JSON.stringify(entryKey)}:${stableSerialize(entryValue)}`).join(',')}}`;
  };
  return stableSerialize(value);
}

export function getRetryAfterHint(error: unknown, t: TrainingTranslationFn): string | null {
  if (!(error instanceof ApiError)) return null;
  if (!Number.isFinite(error.retryAfterSeconds) || !error.retryAfterSeconds || error.retryAfterSeconds <= 0) {
    return null;
  }
  return t('training.autoLearning.retryAfterHint', { seconds: error.retryAfterSeconds });
}
