import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { sql, and, eq, inArray } from '@alice/database';
import { getDatabase, schema } from '@alice/database';
import { createLogger } from '@alice/logger';
import { asyncHandler, requireAuth, requireRole, Role } from '@alice/shared-utils';
import { UserPreferenciasSchema } from '@alice/shared';
import { resolveHighestRole } from '../rbac/role-assignments.js';
import type { publishProvisioningEvent } from '../identity-provisioning/index.js';

interface RegisterUserManagementRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  publishProvisioningEvent: typeof publishProvisioningEvent;
  invalidateUserPermissions: (
    userId: string,
    tenantId?: string,
  ) => Promise<void>;
}

export function registerUserManagementRoutes(
  app: Express,
  deps: RegisterUserManagementRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('auth-service');
  const { publishProvisioningEvent, invalidateUserPermissions } = deps;
// Zod schemas para validação de entrada (OWASP API3 - Input Validation)
const isValidTimeZone = (timezone: string) => {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const userLocationSchema = z.object({
  countryCode: z.string().length(2).regex(/^[A-Z]{2}$/).optional(),
  countryName: z.string().max(80).optional(),
  region: z.string().max(80).optional(),
  city: z.string().max(80).optional(),
}).strict();

const userPreferenciasUpdateSchema = UserPreferenciasSchema.extend({
  location: userLocationSchema.optional(),
}).partial();

const updateUserProfileSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().max(100).optional(),
  preferredName: z.string().min(2).max(120).optional(),
  email: z.string().email().max(255).transform(v => v.toLowerCase().trim()).optional(),
  cargo: z.string().max(100).optional(),
  departamento: z.string().max(100).optional(),
  telefone: z.string().max(20).optional(),
  idioma: z.enum(['pt-BR', 'en-US', 'es-ES']).optional(),
  timezone: z.string().max(50).refine(isValidTimeZone, { message: 'Timezone IANA inválido' }).optional(),
  profileImageUrl: z.string().url().max(2048).optional().nullable(),
  preferencias: userPreferenciasUpdateSchema.optional(),
});

const updateUserPasswordSchema = z.object({
  newPassword: z.string().min(8).max(200),
});

const updateUserRoleSchema = z.object({
  role: z.enum(['super_admin', 'admin', 'manager', 'operator', 'viewer', 'guest']),
});

const updateUserCustomRoleSchema = z.object({
  customRoleId: z.string().uuid().nullable(),
});

const updateUserStatusSchema = z.object({
  ativo: z.boolean(),
});

const updateUserRolesSchema = z.object({
  roles: z.array(z.enum(['super_admin', 'admin', 'manager', 'operator', 'viewer', 'guest'])).min(1),
});

const updateUserCustomRolesSchema = z.object({
  customRoleIds: z.array(z.string().uuid()).default([]),
});

const updateUserGroupsSchema = z.object({
  groupIds: z.array(z.string().uuid()).default([]),
});

// GET /api/users - Listar usuários do tenant (admin+ only)
app.get('/api/users', requireAuth(), requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const tenantId = req.tenantId;
  
  // Multi-tenant: Filtrar por tenant (RLS via aplicação)
  const whereClause = tenantId 
    ? eq(schema.users.tenantId, tenantId)
    : undefined;
  
  const users = await db.query.users.findMany({
    where: whereClause,
    columns: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      role: true,
      customRoleId: true,
      cargo: true,
      departamento: true,
      ativo: true,
      ultimoAcesso: true,
      createdAt: true,
      profileImageUrl: true,
      authProvider: true,
    },
    with: {
      customRole: {
        columns: {
          id: true,
          nome: true,
          slug: true,
          baseRole: true,
          ativo: true,
        },
      },
    },
    orderBy: (users, { desc }) => [desc(users.createdAt)],
  });

  const userIds = users.map((user) => user.id);
  const [roleRows, customRoleRows, groupRows] = userIds.length > 0
    ? await Promise.all([
      db.query.userRoles.findMany({
        where: inArray(schema.userRoles.userId, userIds),
        columns: { userId: true, role: true },
      }),
      db.query.userCustomRoles.findMany({
        where: inArray(schema.userCustomRoles.userId, userIds),
        with: {
          customRole: {
            columns: { id: true, nome: true, slug: true, baseRole: true, ativo: true },
          },
        },
      }),
      db.query.userGroupMembers.findMany({
        where: inArray(schema.userGroupMembers.userId, userIds),
        with: {
          group: {
            columns: { id: true, nome: true, descricao: true, ativo: true },
          },
        },
      }),
    ])
    : [[], [], []];

  const rolesByUser = roleRows.reduce<Record<string, Role[]>>((acc, row) => {
    if (!acc[row.userId]) acc[row.userId] = [];
    acc[row.userId].push(row.role as Role);
    return acc;
  }, {});

  const customRolesByUser = customRoleRows.reduce<Record<string, Array<{ id: string; nome: string; slug: string; baseRole: Role; ativo: boolean }>>>((acc, row) => {
    if (!acc[row.userId]) acc[row.userId] = [];
    if (row.customRole) {
      acc[row.userId].push({
        id: row.customRole.id,
        nome: row.customRole.nome,
        slug: row.customRole.slug,
        baseRole: row.customRole.baseRole as Role,
        ativo: row.customRole.ativo ?? false,
      });
    }
    return acc;
  }, {});

  const groupsByUser = groupRows.reduce<Record<string, Array<{ id: string; nome: string; descricao?: string | null; ativo?: boolean | null }>>>((acc, row) => {
    if (!acc[row.userId]) acc[row.userId] = [];
    if (row.group) {
      acc[row.userId].push({
        id: row.group.id,
        nome: row.group.nome,
        descricao: row.group.descricao,
        ativo: row.group.ativo,
      });
    }
    return acc;
  }, {});

  const enrichedUsers = users.map((user) => ({
    ...user,
    roles: rolesByUser[user.id] ?? (user.role ? [user.role as Role] : []),
    customRoles: customRolesByUser[user.id] ?? (user.customRole ? [{
      id: user.customRole.id,
      nome: user.customRole.nome,
      slug: user.customRole.slug,
      baseRole: user.customRole.baseRole as Role,
      ativo: user.customRole.ativo,
    }] : []),
    groups: groupsByUser[user.id] ?? [],
  }));

  res.json({ users: enrichedUsers });
}));

// GET /api/users/:id - Buscar usuário específico
app.get('/api/users/:id', requireAuth(), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const userId = req.params.id;
  const requestingUser = req.user;
  
  // Usuário pode ver apenas seu próprio perfil, admin+ pode ver qualquer um
  const isAdmin = ['super_admin', 'admin'].includes(requestingUser?.role || '');
  const isSelf = requestingUser?.userId === userId;
  
  if (!isAdmin && !isSelf) {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      role: true,
      customRoleId: true,
      cargo: true,
      departamento: true,
      telefone: true,
      idioma: true,
      timezone: true,
      ativo: true,
      ultimoAcesso: true,
      createdAt: true,
      updatedAt: true,
      profileImageUrl: true,
      authProvider: true,
      emailVerified: true,
      tenantId: true,
    },
    with: {
      customRole: {
        columns: {
          id: true,
          nome: true,
          slug: true,
          baseRole: true,
          ativo: true,
        },
      },
    },
  });

  if (!user) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }
  
  // Multi-tenant: Verificar se pertence ao mesmo tenant
  if (req.tenantId && user.tenantId !== req.tenantId && !['super_admin'].includes(requestingUser?.role || '')) {
    return res.status(403).json({ error: 'Acesso negado - tenant diferente' });
  }

  const [roleRows, customRoleRows, groupRows] = await Promise.all([
    db.query.userRoles.findMany({
      where: eq(schema.userRoles.userId, userId),
      columns: { userId: true, role: true },
    }),
    db.query.userCustomRoles.findMany({
      where: eq(schema.userCustomRoles.userId, userId),
      with: {
        customRole: {
          columns: { id: true, nome: true, slug: true, baseRole: true, ativo: true },
        },
      },
    }),
    db.query.userGroupMembers.findMany({
      where: eq(schema.userGroupMembers.userId, userId),
      with: {
        group: {
          columns: { id: true, nome: true, descricao: true, ativo: true },
        },
      },
    }),
  ]);

  const roles = roleRows.map((row) => row.role as Role);
  const customRoles = customRoleRows
    .filter((row) => row.customRole)
    .map((row) => ({
      id: row.customRole!.id,
      nome: row.customRole!.nome,
      slug: row.customRole!.slug,
      baseRole: row.customRole!.baseRole as Role,
      ativo: row.customRole!.ativo,
    }));
  const groups = groupRows
    .filter((row) => row.group)
    .map((row) => ({
      id: row.group!.id,
      nome: row.group!.nome,
      descricao: row.group!.descricao,
      ativo: row.group!.ativo,
    }));

  res.json({ user: { ...user, roles, customRoles, groups } });
}));

// PATCH /api/users/:id - Atualizar perfil do usuário
// Propaga automaticamente para Grafana via Identity Provisioning
// SEGURANÇA OWASP: Usuário edita próprio perfil OU admin/super_admin do mesmo tenant
app.patch('/api/users/:id', requireAuth(), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const userId = req.params.id;
  const requestingUser = req.user;
  
  const isSuperAdmin = requestingUser?.role === 'super_admin';
  const isAdmin = ['super_admin', 'admin'].includes(requestingUser?.role || '');
  const isSelf = requestingUser?.userId === userId;
  
  // Derivar tenant do usuário autenticado (não do request)
  const requesterTenantId = requestingUser?.tenantId;
  
  // Buscar usuário alvo primeiro para verificar tenant
  const currentUser = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
  });
  
  if (!currentUser) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }
  
  // SEGURANÇA: Verificação de tenant rigorosa usando tenant do usuário autenticado
  // Super_admin pode acessar qualquer tenant
  // Admin só pode acessar usuários do próprio tenant (ambos DEVEM ter tenantId definido)
  // Usuário comum só pode editar a si mesmo
  
  if (!isSelf) {
    if (!isAdmin) {
      return res.status(403).json({ error: 'Acesso negado - apenas admins podem editar outros usuários' });
    }
    // Admin (não super_admin) DEVE ter tenantId definido E target DEVE ter tenantId definido E devem ser iguais
    if (!isSuperAdmin) {
      if (!requesterTenantId) {
        return res.status(403).json({ error: 'Acesso negado - admin sem tenant definido' });
      }
      if (!currentUser.tenantId) {
        return res.status(403).json({ error: 'Acesso negado - usuário alvo sem tenant definido' });
      }
      if (requesterTenantId !== currentUser.tenantId) {
        return res.status(403).json({ error: 'Acesso negado - tenant diferente' });
      }
    }
  }
  
  // Validação Zod (OWASP API3)
  const parseResult = updateUserProfileSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ 
      error: 'Dados inválidos', 
      details: parseResult.error.format(),
    });
  }
  
  // SEGURANÇA: Usuário comum não pode alterar email (apenas admin+)
  if (!isAdmin && parseResult.data.email && parseResult.data.email !== currentUser.email) {
    return res.status(403).json({ error: 'Apenas administradores podem alterar email' });
  }
  
  // Se email está sendo alterado, verificar duplicidade
  if (parseResult.data.email && parseResult.data.email !== currentUser.email) {
    const existingEmail = await db.query.users.findFirst({
      where: eq(schema.users.email, parseResult.data.email),
    });
    if (existingEmail) {
      return res.status(409).json({ error: 'Email já está em uso' });
    }
  }
  
  const hasPreferencesUpdate = Object.prototype.hasOwnProperty.call(parseResult.data, 'preferencias');
  const mergedPreferences = hasPreferencesUpdate
    ? {
        ...(currentUser.preferencias ?? {}),
        ...(parseResult.data.preferencias ?? {}),
      }
    : undefined;
  const updatePayload: Partial<typeof schema.users.$inferInsert> = {
    ...parseResult.data,
    updatedAt: new Date(),
    ...(hasPreferencesUpdate
      ? { preferencias: mergedPreferences as typeof schema.users.$inferInsert['preferencias'] }
      : {}),
  };

  // Atualizar usuário
  const [updatedUser] = await db.update(schema.users)
    .set(updatePayload)
    .where(eq(schema.users.id, userId))
    .returning();

  logger.info({ 
    userId, 
    updatedFields: Object.keys(parseResult.data),
    updatedBy: requestingUser?.userId,
  }, 'Perfil de usuário atualizado');

  // Identity Provisioning: Propagar alteração para Grafana
  publishProvisioningEvent('user.updated', {
    userId: updatedUser.id,
    email: updatedUser.email || currentUser.email || '',
    firstName: updatedUser.firstName || undefined,
    lastName: updatedUser.lastName || undefined,
    role: updatedUser.role || 'viewer',
    tenantId: updatedUser.tenantId || undefined,
  }).catch((error) => {
    logger.error({ error, userId }, 'Erro ao publicar evento user.updated');
  });

  // Remover campos sensíveis
  const { passwordHash: _, ...safeUser } = updatedUser;
  res.json({ user: safeUser, message: 'Perfil atualizado com sucesso' });
}));

// PATCH /api/users/:id/password - Redefinir senha do usuário (admin+ only)
app.patch('/api/users/:id/password', requireAuth(), requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const userId = req.params.id;
  const requestingUser = req.user;

  const isSuperAdmin = requestingUser?.role === 'super_admin';
  const requesterTenantId = requestingUser?.tenantId;

  const targetUser = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
  });

  if (!targetUser) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }

  if (!isSuperAdmin) {
    if (!requesterTenantId) {
      return res.status(403).json({ error: 'Acesso negado - admin sem tenant definido' });
    }
    if (!targetUser.tenantId) {
      return res.status(403).json({ error: 'Acesso negado - usuário alvo sem tenant definido' });
    }
    if (requesterTenantId !== targetUser.tenantId) {
      return res.status(403).json({ error: 'Acesso negado - tenant diferente' });
    }
  }

  const parseResult = updateUserPasswordSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Dados inválidos',
      details: parseResult.error.format(),
    });
  }

  const passwordHash = await bcrypt.hash(parseResult.data.newPassword, 12);
  const [updatedUser] = await db.update(schema.users)
    .set({
      passwordHash,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId))
    .returning();

  const { passwordHash: _, ...safeUser } = updatedUser;

  logger.info({
    userId,
    updatedBy: requestingUser?.userId,
  }, 'Senha de usuário redefinida');

  res.json({ user: safeUser, message: 'Senha atualizada com sucesso' });
}));

// PATCH /api/users/:id/role - Atualizar role do usuário (admin+ only)
// Propaga automaticamente para Grafana via Identity Provisioning
// SEGURANÇA OWASP: Admin pode alterar roles de usuários do mesmo tenant (exceto super_admin)
//                  Super_admin pode alterar qualquer role de qualquer tenant
//                  PROIBIDO: auto-elevação de role (admin não pode se promover a super_admin)
app.patch('/api/users/:id/role', requireAuth(), requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const userId = req.params.id;
  const requestingUser = req.user;
  
  const isSuperAdmin = requestingUser?.role === 'super_admin';
  const isSelf = requestingUser?.userId === userId;
  const requesterTenantId = requestingUser?.tenantId;
  
  // Validação Zod (OWASP API3)
  const parseResult = updateUserRoleSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ 
      error: 'Dados inválidos', 
      details: parseResult.error.format(),
    });
  }
  
  const { role: newRole } = parseResult.data;
  
  // SEGURANÇA: Proibir auto-alteração de role (exceto super_admin rebaixando a si mesmo - já protegido abaixo)
  if (isSelf && !isSuperAdmin) {
    return res.status(403).json({ error: 'Não pode alterar a própria role' });
  }
  
  // Buscar usuário atual
  const currentUser = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
  });
  
  if (!currentUser) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }
  
  // SEGURANÇA: Verificação de tenant rigorosa usando tenant do usuário autenticado
  // Admin (não super_admin) DEVE ter tenantId definido E target DEVE ter tenantId definido E devem ser iguais
  if (!isSuperAdmin) {
    if (!requesterTenantId) {
      return res.status(403).json({ error: 'Acesso negado - admin sem tenant definido' });
    }
    if (!currentUser.tenantId) {
      return res.status(403).json({ error: 'Acesso negado - usuário alvo sem tenant definido' });
    }
    if (requesterTenantId !== currentUser.tenantId) {
      return res.status(403).json({ error: 'Acesso negado - tenant diferente' });
    }
  }
  
  // Hierarquia de roles: super_admin > admin > manager > operator > viewer > guest
  const roleHierarchy: Record<string, number> = {
    super_admin: 6,
    admin: 5,
    manager: 4,
    operator: 3,
    viewer: 2,
    guest: 1,
  };
  
  const requestingRoleLevel = roleHierarchy[requestingUser?.role || 'guest'] || 0;
  const targetRoleLevel = roleHierarchy[newRole] || 0;
  const currentRoleLevel = roleHierarchy[currentUser.role || 'viewer'] || 0;
  
  // Não pode atribuir role igual ou superior à própria (exceto super_admin)
  if (requestingUser?.role !== 'super_admin') {
    if (targetRoleLevel >= requestingRoleLevel) {
      return res.status(403).json({ 
        error: 'Não pode atribuir role igual ou superior à sua',
      });
    }
    // Não pode alterar role de alguém com role igual ou superior
    if (currentRoleLevel >= requestingRoleLevel) {
      return res.status(403).json({ 
        error: 'Não pode alterar role de usuário com permissão igual ou superior',
      });
    }
  }
  
  // Não permitir que super_admin rebaixe a si mesmo
  if (requestingUser?.userId === userId && requestingUser?.role === 'super_admin' && newRole !== 'super_admin') {
    return res.status(403).json({ 
      error: 'Super admin não pode rebaixar a si mesmo',
    });
  }
  
  const previousRole = currentUser.role;
  
  // Atualizar role
  const [updatedUser] = await db.update(schema.users)
    .set({
      role: newRole,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId))
    .returning();

  logger.info({ 
    userId, 
    previousRole,
    newRole,
    updatedBy: requestingUser?.userId,
  }, 'Role de usuário atualizada');

  // Identity Provisioning: Propagar mudança de role para Grafana
  publishProvisioningEvent('user.role_changed', {
    userId: updatedUser.id,
    email: updatedUser.email || '',
    firstName: updatedUser.firstName || undefined,
    lastName: updatedUser.lastName || undefined,
    role: newRole,
    tenantId: updatedUser.tenantId || undefined,
  }).catch((error) => {
    logger.error({ error, userId, newRole }, 'Erro ao publicar evento user.role_changed');
  });

  await invalidateUserPermissions(updatedUser.id, updatedUser.tenantId || undefined);

  res.json({ 
    user: { 
      id: updatedUser.id, 
      role: updatedUser.role,
      previousRole,
    }, 
    message: 'Role atualizada com sucesso',
  });
}));

// PATCH /api/users/:id/custom-role - Atualizar role customizada (admin+ only)
app.patch('/api/users/:id/custom-role', requireAuth(), requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const userId = req.params.id;
  const requestingUser = req.user;

  const parseResult = updateUserCustomRoleSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Dados inválidos',
      details: parseResult.error.format(),
    });
  }

  const currentUser = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: { id: true, tenantId: true },
  });
  if (!currentUser) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }

  const isSuperAdmin = requestingUser?.role === 'super_admin';
  if (req.tenantId && currentUser.tenantId !== req.tenantId && !isSuperAdmin) {
    return res.status(403).json({ error: 'Acesso negado - tenant diferente' });
  }

  const { customRoleId } = parseResult.data;
  if (customRoleId) {
    const customRole = await db.query.customRoles.findFirst({
      where: eq(schema.customRoles.id, customRoleId),
      columns: { id: true, tenantId: true, ativo: true },
    });
    if (!customRole) {
      return res.status(404).json({ error: 'Role customizada não encontrada' });
    }
    if (customRole.ativo === false) {
      return res.status(400).json({ error: 'Role customizada inativa' });
    }
    if (req.tenantId && customRole.tenantId !== req.tenantId && !isSuperAdmin) {
      return res.status(403).json({ error: 'Acesso negado - role de outro tenant' });
    }
    if (
      customRole.tenantId &&
      currentUser.tenantId &&
      customRole.tenantId !== currentUser.tenantId
    ) {
      return res.status(400).json({ error: 'Role customizada de outro tenant' });
    }
  }

  const [updatedUser] = await db.update(schema.users)
    .set({
      customRoleId,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId))
    .returning({ id: schema.users.id, customRoleId: schema.users.customRoleId });

  await invalidateUserPermissions(updatedUser.id, currentUser.tenantId ?? req.tenantId);

  res.json({
    user: updatedUser,
    message: 'Role customizada atualizada com sucesso',
  });
}));

// PATCH /api/users/:id/status - Ativar/desativar usuário (admin+ only)
// Propaga automaticamente para Grafana via Identity Provisioning
// SEGURANÇA OWASP: Admin pode ativar/desativar usuários do mesmo tenant
//                  Super_admin pode ativar/desativar qualquer usuário
app.patch('/api/users/:id/status', requireAuth(), requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const userId = req.params.id;
  const requestingUser = req.user;
  
  const isSuperAdmin = requestingUser?.role === 'super_admin';
  const requesterTenantId = requestingUser?.tenantId;
  
  // Validação Zod (OWASP API3)
  const parseResult = updateUserStatusSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ 
      error: 'Dados inválidos', 
      details: parseResult.error.format(),
    });
  }
  
  const { ativo } = parseResult.data;
  
  // Buscar usuário atual
  const currentUser = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
  });
  
  if (!currentUser) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }
  
  // SEGURANÇA: Verificação de tenant rigorosa usando tenant do usuário autenticado
  // Admin (não super_admin) DEVE ter tenantId definido E target DEVE ter tenantId definido E devem ser iguais
  if (!isSuperAdmin) {
    if (!requesterTenantId) {
      return res.status(403).json({ error: 'Acesso negado - admin sem tenant definido' });
    }
    if (!currentUser.tenantId) {
      return res.status(403).json({ error: 'Acesso negado - usuário alvo sem tenant definido' });
    }
    if (requesterTenantId !== currentUser.tenantId) {
      return res.status(403).json({ error: 'Acesso negado - tenant diferente' });
    }
  }
  
  // Não permitir desativar a si mesmo
  if (requestingUser?.userId === userId && !ativo) {
    return res.status(403).json({ 
      error: 'Não pode desativar a própria conta',
    });
  }
  
  // Não permitir desativar super_admin (exceto por outro super_admin)
  if (currentUser.role === 'super_admin' && !ativo && !isSuperAdmin) {
    return res.status(403).json({ 
      error: 'Apenas super admin pode desativar outro super admin',
    });
  }
  
  // Atualizar status
  const [updatedUser] = await db.update(schema.users)
    .set({
      ativo,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId))
    .returning();

  logger.info({ 
    userId, 
    ativo,
    updatedBy: requestingUser?.userId,
  }, ativo ? 'Usuário ativado' : 'Usuário desativado');

  // Identity Provisioning: Propagar desativação para Grafana
  publishProvisioningEvent('user.disabled', {
    userId: updatedUser.id,
    email: updatedUser.email || '',
    firstName: updatedUser.firstName || undefined,
    lastName: updatedUser.lastName || undefined,
    role: updatedUser.role || 'viewer',
    tenantId: updatedUser.tenantId || undefined,
    disabled: !ativo, // true = desativado
  }).catch((error) => {
    logger.error({ error, userId, ativo }, 'Erro ao publicar evento user.disabled');
  });

  res.json({ 
    user: { 
      id: updatedUser.id, 
      ativo: updatedUser.ativo,
    }, 
    message: ativo ? 'Usuário ativado com sucesso' : 'Usuário desativado com sucesso',
  });
}));

// PATCH /api/users/:id/roles - Atualizar roles base do usuário (admin+ only)
app.patch('/api/users/:id/roles', requireAuth(), requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const userId = req.params.id;
  const requestingUser = req.user;
  const isSuperAdmin = requestingUser?.role === 'super_admin';
  const requesterTenantId = requestingUser?.tenantId;

  const parseResult = updateUserRolesSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: parseResult.error.format() });
  }

  const currentUser = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!currentUser) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }
  if (!isSuperAdmin) {
    if (!requesterTenantId || !currentUser.tenantId || requesterTenantId !== currentUser.tenantId) {
      return res.status(403).json({ error: 'Acesso negado - tenant diferente' });
    }
  }

  const { roles } = parseResult.data;
  const effectiveRole = resolveHighestRole(roles, (currentUser.role || 'guest') as Role);

  await db.transaction(async (tx) => {
    await tx.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await tx.insert(schema.userRoles).values(
      roles.map((role) => ({ userId, role }))
    );
    await tx.update(schema.users)
      .set({ role: effectiveRole, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
  });

  await invalidateUserPermissions(userId, currentUser.tenantId ?? req.tenantId);
  res.json({ success: true, roles, effectiveRole });
}));

// PATCH /api/users/:id/custom-roles - Atualizar roles customizadas (admin+ only)
app.patch('/api/users/:id/custom-roles', requireAuth(), requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const userId = req.params.id;
  const requestingUser = req.user;
  const isSuperAdmin = requestingUser?.role === 'super_admin';
  const requesterTenantId = requestingUser?.tenantId;

  const parseResult = updateUserCustomRolesSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: parseResult.error.format() });
  }

  const currentUser = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!currentUser) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }
  if (!isSuperAdmin) {
    if (!requesterTenantId || !currentUser.tenantId || requesterTenantId !== currentUser.tenantId) {
      return res.status(403).json({ error: 'Acesso negado - tenant diferente' });
    }
  }

  const { customRoleIds } = parseResult.data;
  if (customRoleIds.length > 0) {
    const roles = await db.query.customRoles.findMany({
      where: and(
        inArray(schema.customRoles.id, customRoleIds),
        eq(schema.customRoles.ativo, true),
        currentUser.tenantId ? eq(schema.customRoles.tenantId, currentUser.tenantId) : sql`1=1`
      ),
      columns: { id: true },
    });
    if (roles.length !== customRoleIds.length) {
      return res.status(400).json({ error: 'Role customizada inválida ou inativa' });
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.userCustomRoles).where(eq(schema.userCustomRoles.userId, userId));
    if (customRoleIds.length > 0) {
      await tx.insert(schema.userCustomRoles).values(
        customRoleIds.map((customRoleId) => ({ userId, customRoleId }))
      );
    }
  });

  await invalidateUserPermissions(userId, currentUser.tenantId ?? req.tenantId);
  res.json({ success: true, customRoleIds });
}));

// PATCH /api/users/:id/groups - Atualizar grupos do usuário (admin+ only)
app.patch('/api/users/:id/groups', requireAuth(), requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const userId = req.params.id;
  const requestingUser = req.user;
  const isSuperAdmin = requestingUser?.role === 'super_admin';
  const requesterTenantId = requestingUser?.tenantId;

  const parseResult = updateUserGroupsSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: parseResult.error.format() });
  }

  const currentUser = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!currentUser) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }
  if (!isSuperAdmin) {
    if (!requesterTenantId || !currentUser.tenantId || requesterTenantId !== currentUser.tenantId) {
      return res.status(403).json({ error: 'Acesso negado - tenant diferente' });
    }
  }

  const { groupIds } = parseResult.data;
  const targetTenantId = currentUser.tenantId ?? req.tenantId;
  if (!targetTenantId) {
    return res.status(400).json({ error: 'Tenant indefinido para associação de grupos' });
  }
  if (groupIds.length > 0) {
    const groups = await db.query.userGroups.findMany({
      where: and(
        inArray(schema.userGroups.id, groupIds),
        targetTenantId ? eq(schema.userGroups.tenantId, targetTenantId) : sql`1=1`
      ),
      columns: { id: true },
    });
    if (groups.length !== groupIds.length) {
      return res.status(400).json({ error: 'Grupo inválido para o tenant' });
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.userGroupMembers).where(eq(schema.userGroupMembers.userId, userId));
    if (groupIds.length > 0) {
      await tx.insert(schema.userGroupMembers).values(
        groupIds.map((groupId) => ({
          userId,
          groupId,
          tenantId: targetTenantId,
          criadoPor: requestingUser?.userId,
        }))
      );
    }
  });

  res.json({ success: true, groupIds });
}));

// DELETE /api/users/:id - Deletar usuário (super_admin only)
// Propaga automaticamente para Grafana via Identity Provisioning
app.delete('/api/users/:id', requireAuth(), requireRole('super_admin'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const userId = req.params.id;
  const requestingUser = req.user;
  
  // Não permitir deletar a si mesmo
  if (requestingUser?.userId === userId) {
    return res.status(403).json({ 
      error: 'Não pode deletar a própria conta',
    });
  }
  
  // Buscar usuário antes de deletar
  const userToDelete = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
  });
  
  if (!userToDelete) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }
  
  // Deletar usuário
  await db.delete(schema.users)
    .where(eq(schema.users.id, userId));

  logger.info({ 
    userId, 
    email: userToDelete.email,
    deletedBy: requestingUser?.userId,
  }, 'Usuário deletado');

  // Identity Provisioning: Propagar deleção para Grafana
  publishProvisioningEvent('user.deleted', {
    userId: userToDelete.id,
    email: userToDelete.email || '',
    firstName: userToDelete.firstName || undefined,
    lastName: userToDelete.lastName || undefined,
    role: userToDelete.role || 'viewer',
    tenantId: userToDelete.tenantId || undefined,
  }).catch((error) => {
    logger.error({ error, userId }, 'Erro ao publicar evento user.deleted');
  });

  res.json({ 
    success: true, 
    message: 'Usuário deletado com sucesso',
  });
}));
}
