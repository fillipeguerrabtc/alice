import crypto from 'crypto';
import type { Request } from 'express';
import { getRedisClient } from '@alice/shared-utils';

export type TrainingModelRegistryScope = {
  tenantId: string;
  namespaceId: string | null;
  agentId: string | null;
};

type RedisClient = NonNullable<ReturnType<typeof getRedisClient>>;

export type TrainingScopedOperation = 'promote' | 'rollback' | 'run_start';
export type TrainingJobOperation = 'promotion_approval';
export type TrainingRunStartIdempotencyOperation = 'on_demand' | 'custom_job';

export type TrainingOperationLockHandle = {
  key: string;
  token: string;
};

const TRAINING_SCOPE_LOCK_PREFIX = 'alice:training:model-registry:scope-lock';
const TRAINING_JOB_LOCK_PREFIX = 'alice:training:model-registry:job-lock';
const TRAINING_RUN_START_IDEMPOTENCY_PREFIX = 'alice:training:run-start:idempotency';

function normalizeKeyPart(value: string | null | undefined): string {
  if (typeof value !== 'string') return 'global';
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : 'global';
}

export function buildTrainingScopeOperationLockKey(params: {
  scope: TrainingModelRegistryScope;
  operation: TrainingScopedOperation;
}): string {
  return [
    TRAINING_SCOPE_LOCK_PREFIX,
    normalizeKeyPart(params.scope.tenantId),
    normalizeKeyPart(params.scope.namespaceId),
    normalizeKeyPart(params.scope.agentId),
    params.operation,
  ].join(':');
}

export function buildTrainingJobOperationLockKey(params: {
  tenantId: string;
  fineTuningJobId: string;
  operation: TrainingJobOperation;
}): string {
  return [
    TRAINING_JOB_LOCK_PREFIX,
    normalizeKeyPart(params.tenantId),
    normalizeKeyPart(params.fineTuningJobId),
    params.operation,
  ].join(':');
}

export function buildTrainingRunStartIdempotencyRedisKey(params: {
  tenantId: string;
  operation: TrainingRunStartIdempotencyOperation;
  idempotencyKey: string;
}): string {
  const digest = crypto.createHash('sha256')
    .update(params.idempotencyKey.trim())
    .digest('hex');
  return [
    TRAINING_RUN_START_IDEMPOTENCY_PREFIX,
    normalizeKeyPart(params.tenantId),
    params.operation,
    digest,
  ].join(':');
}

export async function acquireTrainingOperationLock(params: {
  redis: RedisClient;
  key: string;
  ttlSeconds: number;
}): Promise<TrainingOperationLockHandle | null> {
  const token = crypto.randomUUID();
  const result = await params.redis.set(params.key, token, {
    NX: true,
    EX: params.ttlSeconds,
  });
  if (result !== 'OK') return null;
  return {
    key: params.key,
    token,
  };
}

export async function releaseTrainingOperationLock(params: {
  redis: RedisClient;
  handle: TrainingOperationLockHandle;
}): Promise<void> {
  await params.redis.eval(
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
    {
      keys: [params.handle.key],
      arguments: [params.handle.token],
    }
  );
}

export function extractRequestIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  if (Array.isArray(forwarded)) {
    const first = forwarded[0]?.trim();
    if (first) return first;
  }
  if (typeof req.ip === 'string' && req.ip.trim().length > 0) {
    return req.ip.trim();
  }
  return null;
}

export function extractRequestUserAgent(req: Request): string | null {
  const userAgent = req.headers['user-agent'];
  if (typeof userAgent === 'string' && userAgent.trim().length > 0) {
    return userAgent.trim();
  }
  if (Array.isArray(userAgent) && typeof userAgent[0] === 'string' && userAgent[0].trim().length > 0) {
    return userAgent[0].trim();
  }
  return null;
}
