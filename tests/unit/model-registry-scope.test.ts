import { describe, expect, it } from 'vitest';
import {
  assertValidModelRegistryScope,
  buildFineTuningScopeCondition,
  buildModelVersionScopeCondition,
  normalizeModelRegistryScope,
} from '../../apps/training-service/src/model-registry-scope';

describe('model-registry-scope', () => {
  it('normaliza escopo vazio para tenant-wide', () => {
    expect(normalizeModelRegistryScope()).toEqual({
      namespaceId: null,
      agentId: null,
    });
  });

  it('valida escopo namespace/agent consistente', () => {
    expect(assertValidModelRegistryScope({
      namespaceId: '11111111-1111-1111-1111-111111111111',
      agentId: '22222222-2222-2222-2222-222222222222',
    })).toEqual({
      namespaceId: '11111111-1111-1111-1111-111111111111',
      agentId: '22222222-2222-2222-2222-222222222222',
    });
  });

  it('rejeita escopo de agente sem namespace', () => {
    expect(() => assertValidModelRegistryScope({
      namespaceId: null,
      agentId: '22222222-2222-2222-2222-222222222222',
    })).toThrow('agentId exige namespaceId');
  });

  it('gera condicoes SQL para model_versions e fine_tuning_jobs', () => {
    const scope = {
      namespaceId: '11111111-1111-1111-1111-111111111111',
      agentId: '22222222-2222-2222-2222-222222222222',
    };
    expect(buildModelVersionScopeCondition(scope)).toBeTruthy();
    expect(buildFineTuningScopeCondition(scope)).toBeTruthy();
  });
});
