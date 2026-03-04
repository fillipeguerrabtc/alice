import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import {
  acquireTrainingOperationLock,
  buildTrainingJobOperationLockKey,
  buildTrainingRunStartIdempotencyRedisKey,
  buildTrainingScopeOperationLockKey,
  extractRequestIp,
  extractRequestUserAgent,
  releaseTrainingOperationLock,
} from '../../apps/training-service/src/training-enterprise-controls';

describe('training-enterprise-controls', () => {
  it('gera chave de lock por escopo com fallback global', () => {
    const key = buildTrainingScopeOperationLockKey({
      scope: {
        tenantId: 'tenant-a',
        namespaceId: null,
        agentId: null,
      },
      operation: 'promote',
    });
    expect(key).toBe('alice:training:model-registry:scope-lock:tenant-a:global:global:promote');
  });

  it('gera chave de lock por escopo namespace+agent', () => {
    const key = buildTrainingScopeOperationLockKey({
      scope: {
        tenantId: 'tenant-a',
        namespaceId: 'ns-1',
        agentId: 'agent-1',
      },
      operation: 'rollback',
    });
    expect(key).toBe('alice:training:model-registry:scope-lock:tenant-a:ns-1:agent-1:rollback');
  });

  it('gera chave de lock para inicializacao de run por tenant', () => {
    const key = buildTrainingScopeOperationLockKey({
      scope: {
        tenantId: 'tenant-a',
        namespaceId: null,
        agentId: null,
      },
      operation: 'run_start',
    });
    expect(key).toBe('alice:training:model-registry:scope-lock:tenant-a:global:global:run_start');
  });

  it('gera chave de lock por job para aprovacao de promocao', () => {
    const key = buildTrainingJobOperationLockKey({
      tenantId: 'tenant-a',
      fineTuningJobId: 'job-1',
      operation: 'promotion_approval',
    });
    expect(key).toBe('alice:training:model-registry:job-lock:tenant-a:job-1:promotion_approval');
  });

  it('gera chave de idempotencia deterministica para run start', () => {
    const first = buildTrainingRunStartIdempotencyRedisKey({
      tenantId: 'tenant-a',
      operation: 'on_demand',
      idempotencyKey: '  req-12345-ABCDE  ',
    });
    const second = buildTrainingRunStartIdempotencyRedisKey({
      tenantId: 'tenant-a',
      operation: 'on_demand',
      idempotencyKey: 'req-12345-ABCDE',
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^alice:training:run-start:idempotency:tenant-a:on_demand:[a-f0-9]{64}$/);
  });

  it('extrai IP via x-forwarded-for quando presente', () => {
    const req = {
      headers: {
        'x-forwarded-for': '203.0.113.10, 10.0.0.1',
      },
      ip: '127.0.0.1',
    } as unknown as Request;
    expect(extractRequestIp(req)).toBe('203.0.113.10');
  });

  it('extrai user-agent com fallback para array', () => {
    const req = {
      headers: {
        'user-agent': ['curl/8.6.0'],
      },
      ip: '127.0.0.1',
    } as unknown as Request;
    expect(extractRequestUserAgent(req)).toBe('curl/8.6.0');
  });

  it('adquire lock distribuido e detecta contencao', async () => {
    const locks = new Map<string, string>();
    const redis = {
      set: async (key: string, value: string, opts: { NX?: boolean }) => {
        if (opts?.NX && locks.has(key)) return null;
        locks.set(key, value);
        return 'OK';
      },
    } as unknown as NonNullable<ReturnType<typeof import('@alice/shared-utils').getRedisClient>>;

    const first = await acquireTrainingOperationLock({
      redis,
      key: 'alice:test:lock',
      ttlSeconds: 60,
    });
    expect(first).not.toBeNull();

    const second = await acquireTrainingOperationLock({
      redis,
      key: 'alice:test:lock',
      ttlSeconds: 60,
    });
    expect(second).toBeNull();
  });

  it('libera lock apenas quando token confere', async () => {
    const locks = new Map<string, string>();
    const redis = {
      set: async (key: string, value: string, opts: { NX?: boolean }) => {
        if (opts?.NX && locks.has(key)) return null;
        locks.set(key, value);
        return 'OK';
      },
      eval: async (_script: string, params: { keys: string[]; arguments: string[] }) => {
        const key = params.keys[0];
        const token = params.arguments[0];
        if (locks.get(key) === token) {
          locks.delete(key);
          return 1;
        }
        return 0;
      },
    } as unknown as NonNullable<ReturnType<typeof import('@alice/shared-utils').getRedisClient>>;

    const handle = await acquireTrainingOperationLock({
      redis,
      key: 'alice:test:release',
      ttlSeconds: 60,
    });
    expect(handle).not.toBeNull();
    if (!handle) return;

    // lock permanece quando token não confere
    await releaseTrainingOperationLock({
      redis,
      handle: {
        key: handle.key,
        token: 'wrong-token',
      },
    });
    expect(locks.has(handle.key)).toBe(true);

    // lock é removido quando token confere
    await releaseTrainingOperationLock({
      redis,
      handle,
    });
    expect(locks.has(handle.key)).toBe(false);
  });
});
