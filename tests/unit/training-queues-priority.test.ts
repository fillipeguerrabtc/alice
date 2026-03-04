import { describe, expect, it } from 'vitest';
import {
  TRAINING_FINE_TUNING_QUEUE_HIGH,
  TRAINING_FINE_TUNING_QUEUE_LOW,
  TRAINING_FINE_TUNING_QUEUE_NORMAL,
  resolveTrainingFineTuningQueue,
  trainingFineTuningQueuePayloadSchema,
} from '../../packages/shared-utils/src/training-queues';

describe('training fine-tuning queue priority routing', () => {
  it('routes high/normal/low priorities to dedicated streams', () => {
    expect(resolveTrainingFineTuningQueue('high')).toBe(TRAINING_FINE_TUNING_QUEUE_HIGH);
    expect(resolveTrainingFineTuningQueue('normal')).toBe(TRAINING_FINE_TUNING_QUEUE_NORMAL);
    expect(resolveTrainingFineTuningQueue('low')).toBe(TRAINING_FINE_TUNING_QUEUE_LOW);
  });

  it('defaults unknown priority input to normal stream', () => {
    expect(resolveTrainingFineTuningQueue(undefined)).toBe(TRAINING_FINE_TUNING_QUEUE_NORMAL);
    expect(resolveTrainingFineTuningQueue(null)).toBe(TRAINING_FINE_TUNING_QUEUE_NORMAL);
  });
});

describe('training fine-tuning payload schema', () => {
  it('applies default priority as normal when omitted', () => {
    const parsed = trainingFineTuningQueuePayloadSchema.parse({
      runId: '11111111-1111-4111-8111-111111111111',
      fineTuningJobId: '22222222-2222-4222-8222-222222222222',
      tenantId: '33333333-3333-4333-8333-333333333333',
      idempotencyKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date().toISOString(),
    });

    expect(parsed.priority).toBe('normal');
  });
});
