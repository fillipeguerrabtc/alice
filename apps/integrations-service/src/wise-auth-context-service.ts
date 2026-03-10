import type { AuthContext } from '@alice/shared-utils';

export type WiseAuthContext = AuthContext & { tenantId: string };

export function getWiseAuthContextFromRequest(user?: AuthContext): WiseAuthContext {
  if (!user?.tenantId) {
    throw new Error('Contexto de tenant não encontrado.');
  }
  return user as WiseAuthContext;
}
