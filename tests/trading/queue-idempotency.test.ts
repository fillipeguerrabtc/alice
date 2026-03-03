import { describe, expect, it, vi } from 'vitest';
import type { RedisClientType } from 'redis';
import { RedisStreamQueue } from '../../packages/shared-utils/src/redis-queue';
import { TRADING_STREAMS, buildTradingIdempotencyKey } from '../../packages/shared-utils/src/trading-queues';

function createRedisMock(): RedisClientType {
  const locks = new Set<string>();
  const commands: string[][] = [];

  const mock = {
    set: vi.fn(async (key: string) => {
      if (locks.has(key)) {
        return null;
      }
      locks.add(key);
      return 'OK';
    }),
    sendCommand: vi.fn(async (command: string[]) => {
      commands.push(command);
      return 'OK';
    }),
    isOpen: true,
  };

  Reflect.set(mock, '__commands', commands);
  return mock as unknown as RedisClientType;
}

describe('trading redis queue idempotency', () => {
  it('builds deterministic idempotency key for universe scan payload', () => {
    const key = buildTradingIdempotencyKey(TRADING_STREAMS.universeScan, {
      tenantId: 'tenant-a',
      instrumentId: 'inst-a',
      timeframe: '5m',
      candleTimestamp: '2026-02-22T00:00:00.000Z',
      strategyVersion: 4,
      operationIntent: 'intraday',
    });

    expect(key).toBe('tenant-a:inst-a:5m:2026-02-22T00:00:00.000Z:4:intraday');
  });

  it('prevents duplicate enqueue for same idempotency key', async () => {
    const redis = createRedisMock();
    const queue = new RedisStreamQueue(TRADING_STREAMS.backtest, {
      group: 'training-service',
      consumer: 'training-test',
    });

    const payload = {
      tenantId: '9a5a60eb-4199-4b61-a4d0-f52624ac4ea5',
      requestedBy: '4c8ff4f7-978b-4e76-a3df-2cc5f2eadf80',
      idempotencyKey: 'backtest-1',
    };

    const first = await queue.enqueue(redis, payload, 'tenant-a:inst-a:5m:1');
    const second = await queue.enqueue(redis, payload, 'tenant-a:inst-a:5m:1');

    expect(first).toBe(true);
    expect(second).toBe(false);

    const calls = (redis.sendCommand as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const xaddCalls = calls.filter((call) => {
      const command = call[0] as string[];
      return command[0] === 'XADD';
    });
    expect(xaddCalls).toHaveLength(1);
  });
});
