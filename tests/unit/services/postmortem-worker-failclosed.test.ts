import { afterEach, describe, expect, it, vi } from 'vitest';

class NoopCounter {
  inc(): void {}
}

class NoopHistogram {
  observe(): void {}
}

class NoopGauge {
  set(): void {}
}

const { sharedUtilsState, getRedisClientMock } = vi.hoisted(() => {
  const state: { redisClient: unknown | null } = { redisClient: null };
  return {
    sharedUtilsState: state,
    getRedisClientMock: vi.fn(() => state.redisClient),
  };
});

vi.mock('@alice/shared-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alice/shared-utils')>();
  return {
    ...actual,
    getRedisClient: getRedisClientMock,
    Counter: NoopCounter,
    Histogram: NoopHistogram,
    Gauge: NoopGauge,
  };
});

const workerModule = await import('../../../apps/integrations-service/src/postmortem-worker');
const { enqueuePostMortem, PostMortemQueueUnavailableError } = workerModule;

function buildPositionData() {
  return {
    id: 'position-1',
    tenantId: 'tenant-1',
    isDemo: true,
    symbol: 'XBTUSDTM',
    marketType: 'futures' as const,
    side: 'long' as const,
    entryPrice: 60000,
    exitPrice: 60200,
    size: 0.1,
    leverage: 5,
    realizedPnl: 20,
    totalFees: 2,
    openedAt: new Date('2026-03-01T10:00:00.000Z'),
    closedAt: new Date('2026-03-01T10:05:00.000Z'),
  };
}

describe('postmortem-worker fail-closed enqueue', () => {
  afterEach(() => {
    sharedUtilsState.redisClient = null;
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('throws PostMortemQueueUnavailableError when Redis is unavailable', async () => {
    sharedUtilsState.redisClient = null;

    await expect(
      enqueuePostMortem({
        positionData: buildPositionData(),
      })
    ).rejects.toBeInstanceOf(PostMortemQueueUnavailableError);
  });

  it('enqueues postmortem job when Redis is available', async () => {
    const redis = {
      set: vi.fn().mockResolvedValue('OK'),
      zAdd: vi.fn().mockResolvedValue(1),
    };
    sharedUtilsState.redisClient = redis;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_709_000_000_000);

    const jobId = await enqueuePostMortem({
      positionData: buildPositionData(),
      namespaceId: 'ns-trading',
      userId: 'agent-1',
    });

    expect(jobId).toContain('pm-position-1-1709000000000');
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.zAdd).toHaveBeenCalledWith(
      'alice:postmortem:queue',
      expect.objectContaining({
        score: 1_709_000_000_000,
        value: jobId,
      })
    );

    const [jobDataKey, jobDataValue] = redis.set.mock.calls[0] as [string, string];
    expect(jobDataKey).toContain('alice:postmortem:job:');
    expect(JSON.parse(jobDataValue)).toEqual(
      expect.objectContaining({
        id: jobId,
        tenantId: 'tenant-1',
        positionId: 'position-1',
        namespaceId: 'ns-trading',
        userId: 'agent-1',
        retryCount: 0,
      })
    );

    nowSpy.mockRestore();
  });
});
