import { describe, expect, it } from 'vitest';
import { buildPriorityQueueScanOrder } from '../../apps/training-service/src/workers/training-fine-tuning-worker';

type QueueStub = { name: string; queue: unknown };

function namesFrom(order: QueueStub[]): string[] {
  return order.map((item) => item.name);
}

describe('buildPriorityQueueScanOrder', () => {
  const queues: QueueStub[] = [
    { name: 'high', queue: {} },
    { name: 'normal', queue: {} },
    { name: 'low', queue: {} },
  ];

  it('keeps high as primary more often but still rotates normal and low', () => {
    const cycle0 = namesFrom(buildPriorityQueueScanOrder(queues, 0));
    const cycle2 = namesFrom(buildPriorityQueueScanOrder(queues, 2));
    const cycle5 = namesFrom(buildPriorityQueueScanOrder(queues, 5));

    expect(cycle0[0]).toBe('high');
    expect(cycle2[0]).toBe('normal');
    expect(cycle5[0]).toBe('low');
  });

  it('is deterministic for same cycle index', () => {
    const a = namesFrom(buildPriorityQueueScanOrder(queues, 4));
    const b = namesFrom(buildPriorityQueueScanOrder(queues, 4));
    expect(a).toEqual(b);
  });
});
