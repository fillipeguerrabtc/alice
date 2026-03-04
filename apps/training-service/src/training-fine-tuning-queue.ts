import crypto from 'node:crypto';
import {
  buildTrainingFineTuningIdempotencyKey,
  getRedisClient,
  RedisStreamQueue,
  resolveTrainingFineTuningQueue,
  trainingRunPrioritySchema,
  trainingFineTuningQueuePayloadSchema,
} from '@alice/shared-utils';

const QUEUE_STREAM_MAX_LEN = 20_000;

export async function enqueueTrainingFineTuningRun(params: {
  fineTuningJobId: string;
  tenantId: string;
  priority?: 'low' | 'normal' | 'high';
  requestedBy?: string | null;
  runId?: string;
}): Promise<{ enqueued: boolean; idempotencyKey: string; runId: string }> {
  const redis = getRedisClient();
  if (!redis) {
    throw new Error('Redis nao disponivel para fila de fine-tuning');
  }

  const priority = trainingRunPrioritySchema.parse(params.priority ?? 'normal');
  const queueName = resolveTrainingFineTuningQueue(priority);
  const queue = new RedisStreamQueue(queueName, {
    group: 'training-service',
    consumer: `training-${process.pid}`,
    maxRetries: 3,
    autoClaimCount: 10,
    streamMaxLen: QUEUE_STREAM_MAX_LEN,
  });

  const runId = params.runId ?? crypto.randomUUID();
  const idempotencyKey = buildTrainingFineTuningIdempotencyKey({
    fineTuningJobId: params.fineTuningJobId,
  });

  const payload = trainingFineTuningQueuePayloadSchema.parse({
    runId,
    fineTuningJobId: params.fineTuningJobId,
    tenantId: params.tenantId,
    priority,
    requestedBy: params.requestedBy ?? undefined,
    idempotencyKey,
    createdAt: new Date().toISOString(),
  });

  const enqueued = await queue.enqueue(redis, payload, payload.idempotencyKey);
  return {
    enqueued,
    idempotencyKey: payload.idempotencyKey,
    runId: payload.runId,
  };
}
