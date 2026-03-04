import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import {
  buildTrainingJobOperationLockKey,
  buildTrainingScopeOperationLockKey,
  extractRequestIp,
  extractRequestUserAgent,
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
});
