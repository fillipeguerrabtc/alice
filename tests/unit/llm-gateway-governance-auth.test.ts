import { describe, expect, it } from 'vitest';
import { resolveGovernanceActor } from '../../apps/llm-gateway-service/src/governance-auth';

describe('resolveGovernanceActor', () => {
  it('falha quando não existe usuário autenticado por HMAC', () => {
    const result = resolveGovernanceActor({
      authenticatedUserId: null,
      authenticatedRole: 'admin',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.code).toBe('GOVERNANCE_HMAC_REQUIRED');
    }
  });

  it('falha quando role não possui permissão de mutação de governança', () => {
    const result = resolveGovernanceActor({
      authenticatedUserId: '11111111-1111-1111-1111-111111111111',
      authenticatedRole: 'manager',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.code).toBe('GOVERNANCE_ROLE_FORBIDDEN');
    }
  });

  it('falha quando actor no payload diverge do usuário autenticado', () => {
    const result = resolveGovernanceActor({
      authenticatedUserId: '11111111-1111-1111-1111-111111111111',
      authenticatedRole: 'admin',
      providedActorUserId: '22222222-2222-2222-2222-222222222222',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe('GOVERNANCE_ACTOR_MISMATCH');
    }
  });

  it('resolve com sucesso quando role e actor são válidos', () => {
    const result = resolveGovernanceActor({
      authenticatedUserId: '11111111-1111-1111-1111-111111111111',
      authenticatedRole: 'super_admin',
      providedActorUserId: '11111111-1111-1111-1111-111111111111',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.actorUserId).toBe('11111111-1111-1111-1111-111111111111');
    }
  });
});
