import type { Role } from '@alice/shared-utils';

const GOVERNANCE_ALLOWED_ROLES = new Set<Role>(['super_admin', 'admin']);

export type GovernanceActorResolution =
  | {
      ok: true;
      actorUserId: string;
    }
  | {
      ok: false;
      status: 401 | 403 | 409;
      code: 'GOVERNANCE_HMAC_REQUIRED' | 'GOVERNANCE_ROLE_FORBIDDEN' | 'GOVERNANCE_ACTOR_MISMATCH';
      message: string;
    };

export function resolveGovernanceActor(input: {
  authenticatedUserId?: string | null;
  authenticatedRole?: Role | null;
  providedActorUserId?: string | null;
}): GovernanceActorResolution {
  if (!input.authenticatedUserId) {
    return {
      ok: false,
      status: 401,
      code: 'GOVERNANCE_HMAC_REQUIRED',
      message: 'Mutações de governança exigem autenticação interna HMAC com usuário autenticado',
    };
  }

  if (!input.authenticatedRole || !GOVERNANCE_ALLOWED_ROLES.has(input.authenticatedRole)) {
    return {
      ok: false,
      status: 403,
      code: 'GOVERNANCE_ROLE_FORBIDDEN',
      message: 'Role sem permissão para mutações de governança',
    };
  }

  if (input.providedActorUserId && input.providedActorUserId !== input.authenticatedUserId) {
    return {
      ok: false,
      status: 409,
      code: 'GOVERNANCE_ACTOR_MISMATCH',
      message: 'Actor informado no payload diverge do usuário autenticado',
    };
  }

  return {
    ok: true,
    actorUserId: input.authenticatedUserId,
  };
}
