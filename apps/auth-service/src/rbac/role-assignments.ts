import { and, eq, inArray, sql } from '@alice/database';
import { getDatabase, schema } from '@alice/database';
import type { AuthContext, Role } from '@alice/shared-utils';
import { PERMISSION_MAP, ROLE_HIERARCHY } from '@alice/shared-utils';

export type DbUser = typeof schema.users.$inferSelect;

export async function resolveUserRoleAssignments(params: {
  userId: string;
  tenantId?: string;
}): Promise<{ baseRoles: Role[]; customRoleIds: string[] }> {
  const db = getDatabase();

  const baseRoles = await db.query.userRoles.findMany({
    where: eq(schema.userRoles.userId, params.userId),
    columns: { role: true },
  });

  let resolvedBaseRoles = baseRoles.map((item) => item.role as Role).filter(Boolean);
  if (resolvedBaseRoles.length === 0) {
    const fallbackUser = await db.query.users.findFirst({
      where: eq(schema.users.id, params.userId),
      columns: { role: true },
    });
    if (fallbackUser?.role) {
      resolvedBaseRoles = [fallbackUser.role as Role];
    }
  }

  const customRoleLinks = await db.query.userCustomRoles.findMany({
    where: eq(schema.userCustomRoles.userId, params.userId),
    with: {
      customRole: {
        columns: { id: true, ativo: true, tenantId: true },
      },
    },
  });

  let customRoleIds = customRoleLinks
    .filter((link) => link.customRole?.ativo)
    .filter((link) => !params.tenantId || link.customRole?.tenantId === params.tenantId)
    .map((link) => link.customRoleId);

  if (customRoleIds.length === 0) {
    const fallbackUser = await db.query.users.findFirst({
      where: eq(schema.users.id, params.userId),
      columns: { customRoleId: true, tenantId: true },
    });

    const fallbackCustomRoleId = fallbackUser?.customRoleId ?? undefined;
    if (fallbackCustomRoleId) {
      const activeRole = await db.query.customRoles.findFirst({
        where: and(
          eq(schema.customRoles.id, fallbackCustomRoleId),
          eq(schema.customRoles.ativo, true),
          params.tenantId ? eq(schema.customRoles.tenantId, params.tenantId) : sql`1=1`
        ),
        columns: { id: true },
      });
      if (activeRole) {
        customRoleIds = [fallbackCustomRoleId];
      }
    }
  }

  return { baseRoles: resolvedBaseRoles, customRoleIds };
}

export function resolveHighestRole(roles: Role[], fallback: Role): Role {
  if (roles.length === 0) {
    return fallback;
  }
  return roles.reduce((highest, role) => (ROLE_HIERARCHY[role] < ROLE_HIERARCHY[highest] ? role : highest));
}

export async function buildAuthContext(dbUser: DbUser): Promise<AuthContext> {
  const assignments = await resolveUserRoleAssignments({
    userId: dbUser.id,
    tenantId: dbUser.tenantId || undefined,
  });

  const effectiveRole = resolveHighestRole(assignments.baseRoles, (dbUser.role || 'guest') as Role);
  const primaryCustomRoleId = assignments.customRoleIds[0] ?? undefined;

  return {
    userId: dbUser.id,
    tenantId: dbUser.tenantId || undefined,
    role: effectiveRole,
    customRoleId: primaryCustomRoleId,
    email: dbUser.email || undefined,
    permissions: [],
  };
}

export async function resolvePermissionsForAuth(auth: AuthContext): Promise<string[]> {
  const db = getDatabase();

  const assignments = await resolveUserRoleAssignments({
    userId: auth.userId,
    tenantId: auth.tenantId,
  });

  const baseRoles = assignments.baseRoles;
  const customRoleIds = assignments.customRoleIds;
  const isAdminRole = baseRoles.some((role) => role === 'admin' || role === 'super_admin');

  const rolePermissions = isAdminRole
    ? await db.query.permissions.findMany({ columns: { codigo: true } })
    : baseRoles.length > 0
      ? await db.query.rolePermissions.findMany({
        where: inArray(schema.rolePermissions.role, baseRoles),
        with: { permission: true },
      })
      : [];

  const customRolePermissions = customRoleIds.length > 0
    ? await db.query.customRolePermissions.findMany({
      where: inArray(schema.customRolePermissions.customRoleId, customRoleIds),
      with: { permission: true },
    })
    : [];

  const dbPermissions = rolePermissions
    .map((rp) => ('codigo' in rp ? rp.codigo : (rp as { permission?: { codigo?: string | null } }).permission?.codigo))
    .filter((code): code is string => Boolean(code));

  const customPermissions = customRolePermissions
    .map((rp) => (rp as { permission?: { codigo?: string | null } }).permission?.codigo)
    .filter((code): code is string => Boolean(code));

  const basePermissions = Object.entries(PERMISSION_MAP)
    .filter(([, roles]) => roles.some((role) => baseRoles.includes(role as Role)))
    .map(([code]) => code);

  const resolved = new Set<string>([...dbPermissions, ...customPermissions, ...basePermissions]);
  if (isAdminRole) {
    resolved.add('admin:alice_core:write');
  }

  return Array.from(resolved);
}
