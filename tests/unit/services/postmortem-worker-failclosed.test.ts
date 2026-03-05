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
const { enqueuePostMortem, retryDlqJob, PostMortemQueueUnavailableError } = workerModule;

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

describe('postmortem-worker dlq retry tenant isolation', () => {
  afterEach(() => {
    sharedUtilsState.redisClient = null;
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('rejects retry when DLQ job tenant differs from caller tenant', async () => {
    const redis = {
      zScore: vi.fn().mockResolvedValue(1),
      get: vi.fn().mockResolvedValue(JSON.stringify({ id: 'job-1', tenantId: 'tenant-2', retryCount: 2 })),
      set: vi.fn().mockResolvedValue('OK'),
      zRem: vi.fn().mockResolvedValue(1),
      zAdd: vi.fn().mockResolvedValue(1),
    };
    sharedUtilsState.redisClient = redis;

    const success = await retryDlqJob('job-1', 'tenant-1');

    expect(success).toBe(false);
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.zRem).not.toHaveBeenCalled();
    expect(redis.zAdd).not.toHaveBeenCalled();
  });

  it('allows retry when DLQ job tenant matches caller tenant', async () => {
    const redis = {
      zScore: vi.fn().mockResolvedValue(1),
      get: vi.fn().mockResolvedValue(JSON.stringify({ id: 'job-1', tenantId: 'tenant-1', retryCount: 2 })),
      set: vi.fn().mockResolvedValue('OK'),
      zRem: vi.fn().mockResolvedValue(1),
      zAdd: vi.fn().mockResolvedValue(1),
    };
    sharedUtilsState.redisClient = redis;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_709_100_000_000);

    const success = await retryDlqJob('job-1', 'tenant-1');

    expect(success).toBe(true);
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.zRem).toHaveBeenCalledWith('alice:postmortem:dlq', 'job-1');
    expect(redis.zAdd).toHaveBeenCalledWith(
      'alice:postmortem:queue',
      expect.objectContaining({ score: 1_709_100_000_000, value: 'job-1' })
    );
    nowSpy.mockRestore();
  });
});
