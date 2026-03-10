import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { createLogger } from '@alice/logger';
import {
  asyncHandler,
  clearPermissionCache,
  invalidateTenantPermissions,
  PERMISSION_MAP,
  requireAuth,
  requirePermission,
  Role,
  ROLE_DESCRIPTIONS,
} from '@alice/shared-utils';
import { and, eq, inArray } from '@alice/database';
import { getDatabase, schema } from '@alice/database';
import { normalizeRoleSlug } from '../rbac/permission-catalog.js';

interface RegisterRbacAdminRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  googleEnabled: boolean;
  githubEnabled: boolean;
  samlEnabled: boolean;
}

export function registerRbacAdminRoutes(
  app: Express,
  deps: RegisterRbacAdminRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('auth-service');
  const { googleEnabled, githubEnabled, samlEnabled } = deps;
app.post('/api/auth/logout', (req: Request, res: Response) => {
  req.logout((err) => {
    if (err) {
      logger.error({ error: err }, 'Erro no logout');
      return res.status(500).json({ error: 'Falha no logout' });
    }
    
    req.session.destroy((sessionErr) => {
      if (sessionErr) {
        logger.error({ error: sessionErr }, 'Erro ao destruir sessão');
      }
      res.clearCookie('alice.sid');
      res.json({ success: true, message: 'Logout realizado com sucesso' });
    });
  });
});

// ============================================================================
// ROTAS: Permissões RBAC (usuário autenticado)
// ============================================================================

app.get('/api/auth/rbac/permissions', requireAuth(), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  try {
    const db = getDatabase();
    const userRole = (req.user.role || 'viewer') as Role;
    const customRoleId = req.user.customRoleId ?? null;

    const isAdminRole = userRole === 'admin' || userRole === 'super_admin';
    // Buscar permissões da role
    const rolePermissions = isAdminRole
      ? await db.query.permissions.findMany({ columns: { codigo: true } })
      : await db.query.rolePermissions.findMany({
        where: eq(schema.rolePermissions.role, userRole),
        with: {
          permission: true,
        },
      });
    let activeCustomRoleId = customRoleId;
    if (activeCustomRoleId) {
      const activeRole = await db.query.customRoles.findFirst({
        where: and(
          eq(schema.customRoles.id, activeCustomRoleId),
          eq(schema.customRoles.ativo, true)
        ),
        columns: { id: true },
      });
      if (!activeRole) {
        activeCustomRoleId = null;
      }
    }
    const customRolePermissions = activeCustomRoleId
      ? await db.query.customRolePermissions.findMany({
        where: eq(schema.customRolePermissions.customRoleId, activeCustomRoleId),
        with: { permission: true },
      })
      : [];

    const dbPermissions = rolePermissions
      .map((rp) => ('codigo' in rp ? rp.codigo : (rp as { permission?: { codigo?: string } }).permission?.codigo))
      .filter(Boolean);
    const customPermissions = customRolePermissions
      .map(rp => (rp as { permission?: { codigo?: string } }).permission?.codigo)
      .filter(Boolean);

    const basePermissions = Object.entries(PERMISSION_MAP)
      .filter(([, roles]) => roles.includes(userRole))
      .map(([code]) => code);

    const permissions = Array.from(
      new Set([...(dbPermissions as string[]), ...(customPermissions as string[]), ...basePermissions])
    );
    if (['super_admin', 'admin'].includes(userRole) && !permissions.includes('admin:alice_core:write')) {
      permissions.push('admin:alice_core:write');
    }

    res.json({ 
      role: userRole,
      customRoleId: activeCustomRoleId,
      permissions,
      canManageUsers: ['super_admin', 'admin'].includes(userRole || ''),
      canManageAgents: ['super_admin', 'admin', 'manager'].includes(userRole || ''),
      canViewReports: ['super_admin', 'admin', 'manager', 'operator'].includes(userRole || ''),
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar permissões');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// ROTAS: Provedores Disponíveis
// ============================================================================

app.get('/api/auth/providers', (_req: Request, res: Response) => {
  res.json({
    providers: [
      { id: 'local', name: 'Email/Senha', enabled: true },
      { id: 'google', name: 'Google', enabled: googleEnabled },
      { id: 'github', name: 'GitHub', enabled: githubEnabled },
      { id: 'saml', name: 'SSO Empresarial (SAML)', enabled: samlEnabled },
    ].filter(p => p.enabled)
  });
});

// ============================================================================
// ROTAS: Audit Logs (Atividades Recentes)
// ============================================================================

app.get('/api/audit/recent', requireAuth(), requirePermission('audit:logs:read'), async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const recentAudit = await db.query.auditLogs.findMany({
      orderBy: (logs, { desc }) => [desc(logs.criadoEm)],
      limit: 10,
      with: {
        user: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    const activities = recentAudit.map(log => {
      const logUser = log.user as { id: string; firstName: string | null; lastName: string | null; email: string | null } | undefined;
      return {
        id: log.id,
        action: log.acao,
        resource: log.recurso,
        resourceId: log.recursoId,
        details: log.detalhes,
        ipAddress: log.ip,
        timestamp: log.criadoEm,
        user: logUser ? {
          id: logUser.id,
          name: `${logUser.firstName || ''} ${logUser.lastName || ''}`.trim() || logUser.email,
        } : null,
      };
    });

    res.json(activities);
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar atividades recentes');
    res.json([]);
  }
});


const createPermissionSchema = z.object({
  codigo: z.string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9_]+:[a-z0-9_]+:[a-z0-9_]+$/, 'Código inválido (formato esperado: modulo:recurso:acao)')
    .transform((value) => value.toLowerCase().trim()),
  nome: z.string().min(2).max(255),
  descricao: z.string().optional(),
  modulo: z.string().min(2).max(100).transform((value) => value.toLowerCase().trim()),
});

const updatePermissionSchema = z.object({
  nome: z.string().min(2).max(255).optional(),
  descricao: z.string().optional(),
  modulo: z.string().min(2).max(100).optional().transform((value) => value?.toLowerCase().trim()),
});

const assignRolePermissionsSchema = z.object({
  permissionCodes: z.array(z.string().min(2).max(100)).min(1),
});

const createGroupSchema = z.object({
  nome: z.string().min(2).max(255),
  descricao: z.string().optional(),
  ativo: z.boolean().optional(),
});

const updateGroupSchema = createGroupSchema.partial();

const groupMemberSchema = z.object({
  userId: z.string().uuid(),
});

const createCustomRoleSchema = z.object({
  nome: z.string().min(2).max(255),
  slug: z.string().min(2).max(100).optional(),
  descricao: z.string().max(1000).optional().nullable(),
  baseRole: z.enum(['super_admin', 'admin', 'manager', 'operator', 'viewer', 'guest']).optional().default('viewer'),
  ativo: z.boolean().optional(),
});

const updateCustomRoleSchema = createCustomRoleSchema.partial();

const assignCustomRolePermissionsSchema = z.object({
  permissionCodes: z.array(z.string().min(2).max(100)),
});


// ============================================================================
// ROTAS: Gestão de Permissões (RBAC Enterprise)
// ============================================================================

// GET /api/auth/permissions - Listar permissões do sistema
app.get('/api/auth/permissions', requireAuth(), requirePermission('admin:permissions:read'), asyncHandler(async (_req: Request, res: Response) => {
  const db = getDatabase();
  const permissions = await db.query.permissions.findMany({
    orderBy: (perm, { asc }) => [asc(perm.modulo), asc(perm.nome)],
  });
  res.json({ permissions });
}));

// GET /api/auth/permissions/:id - Buscar permissão por ID
app.get('/api/auth/permissions/:id', requireAuth(), requirePermission('admin:permissions:read'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const permission = await db.query.permissions.findFirst({
    where: eq(schema.permissions.id, req.params.id),
  });
  if (!permission) {
    res.status(404).json({ error: 'Permissão não encontrada' });
    return;
  }
  res.json({ permission });
}));

// POST /api/auth/permissions - Criar permissão
app.post('/api/auth/permissions', requireAuth(), requirePermission('admin:permissions:write'), asyncHandler(async (req: Request, res: Response) => {
  const result = createPermissionSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Dados inválidos', details: result.error.format() });
    return;
  }

  const db = getDatabase();
  const existing = await db.query.permissions.findFirst({
    where: eq(schema.permissions.codigo, result.data.codigo),
  });
  if (existing) {
    res.status(409).json({ error: 'Código de permissão já existe' });
    return;
  }

  const [permission] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(schema.permissions)
      .values({
        codigo: result.data.codigo,
        nome: result.data.nome,
        descricao: result.data.descricao,
        modulo: result.data.modulo,
      })
      .returning();

    const roles = ['admin', 'super_admin'] as const;
    for (const role of roles) {
      const existingRolePermission = await tx.query.rolePermissions.findFirst({
        where: and(
          eq(schema.rolePermissions.role, role),
          eq(schema.rolePermissions.permissionId, created.id)
        ),
      });
      if (!existingRolePermission) {
        await tx.insert(schema.rolePermissions).values({
          role,
          permissionId: created.id,
        });
      }
    }

    return [created];
  });

  await clearPermissionCache();
  res.status(201).json({ permission });
}));

// PATCH /api/auth/permissions/:id - Atualizar permissão
app.patch('/api/auth/permissions/:id', requireAuth(), requirePermission('admin:permissions:write'), asyncHandler(async (req: Request, res: Response) => {
  const result = updatePermissionSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Dados inválidos', details: result.error.format() });
    return;
  }
  if (Object.keys(result.data).length === 0) {
    res.status(400).json({ error: 'Nenhum campo para atualizar' });
    return;
  }

  const db = getDatabase();
  const [permission] = await db.update(schema.permissions)
    .set(result.data)
    .where(eq(schema.permissions.id, req.params.id))
    .returning();

  if (!permission) {
    res.status(404).json({ error: 'Permissão não encontrada' });
    return;
  }

  await clearPermissionCache();
  res.json({ permission });
}));

// DELETE /api/auth/permissions/:id - Excluir permissão
app.delete('/api/auth/permissions/:id', requireAuth(), requirePermission('admin:permissions:delete'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const [permission] = await db.delete(schema.permissions)
    .where(eq(schema.permissions.id, req.params.id))
    .returning();

  if (!permission) {
    res.status(404).json({ error: 'Permissão não encontrada' });
    return;
  }

  await clearPermissionCache();
  res.json({ success: true, permission });
}));

// ============================================================================
// ROTAS: Roles Customizadas (Departamentos/Funções)
// ============================================================================

// GET /api/auth/roles - Listar roles base do sistema
app.get('/api/auth/roles', requireAuth(), requirePermission('admin:roles:read'), asyncHandler(async (_req: Request, res: Response) => {
  const roles = (Object.keys(ROLE_DESCRIPTIONS) as Role[]).map((role) => ({
    role,
    descricao: ROLE_DESCRIPTIONS[role],
  }));
  res.json({ roles });
}));

// GET /api/auth/custom-roles - Listar roles customizadas do tenant
app.get('/api/auth/custom-roles', requireAuth(), requirePermission('admin:roles:read'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const tenantId = req.tenantId;
  const isSuperAdmin = req.user?.role === 'super_admin';

  if (!tenantId && !isSuperAdmin) {
    return res.status(400).json({ error: 'Tenant não identificado' });
  }

  const roles = await db.query.customRoles.findMany({
    where: tenantId ? eq(schema.customRoles.tenantId, tenantId) : undefined,
    orderBy: (role, { asc }) => [asc(role.nome)],
  });

  res.json({ roles });
}));

// POST /api/auth/custom-roles - Criar role customizada
app.post('/api/auth/custom-roles', requireAuth(), requirePermission('admin:roles:write'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(400).json({ error: 'Tenant não identificado' });
  }

  const result = createCustomRoleSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: result.error.format() });
  }

  const slug = normalizeRoleSlug(result.data.slug || result.data.nome);
  if (!slug) {
    return res.status(400).json({ error: 'Slug inválido' });
  }

  const existing = await db.query.customRoles.findFirst({
    where: and(
      eq(schema.customRoles.tenantId, tenantId),
      eq(schema.customRoles.slug, slug)
    ),
  });
  if (existing) {
    return res.status(409).json({ error: 'Já existe uma role com este slug' });
  }

  const [customRole] = await db.insert(schema.customRoles)
    .values({
      tenantId,
      nome: result.data.nome,
      slug,
      descricao: result.data.descricao ?? null,
      baseRole: result.data.baseRole ?? 'viewer',
      ativo: result.data.ativo ?? true,
    })
    .returning();

  await invalidateTenantPermissions(tenantId);
  res.status(201).json({ role: customRole });
}));

// PATCH /api/auth/custom-roles/:id - Atualizar role customizada
app.patch('/api/auth/custom-roles/:id', requireAuth(), requirePermission('admin:roles:write'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const tenantId = req.tenantId;
  const isSuperAdmin = req.user?.role === 'super_admin';

  if (!tenantId && !isSuperAdmin) {
    return res.status(400).json({ error: 'Tenant não identificado' });
  }

  const result = updateCustomRoleSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: result.error.format() });
  }
  if (Object.keys(result.data).length === 0) {
    return res.status(400).json({ error: 'Nenhum campo para atualizar' });
  }

  const current = await db.query.customRoles.findFirst({
    where: eq(schema.customRoles.id, req.params.id),
  });
  if (!current) {
    return res.status(404).json({ error: 'Role customizada não encontrada' });
  }
  if (!current.tenantId) {
    return res.status(400).json({ error: 'Role customizada sem tenant associado' });
  }
  if (tenantId && current.tenantId !== tenantId && !isSuperAdmin) {
    return res.status(403).json({ error: 'Acesso negado - role de outro tenant' });
  }

  const nextSlug = result.data.slug ? normalizeRoleSlug(result.data.slug) : current.slug;
  if (!nextSlug) {
    return res.status(400).json({ error: 'Slug inválido' });
  }

  if (nextSlug !== current.slug) {
    const existing = await db.query.customRoles.findFirst({
      where: and(
        eq(schema.customRoles.tenantId, current.tenantId),
        eq(schema.customRoles.slug, nextSlug)
      ),
    });
    if (existing) {
      return res.status(409).json({ error: 'Já existe uma role com este slug' });
    }
  }

  const [updated] = await db.update(schema.customRoles)
    .set({
      nome: result.data.nome ?? current.nome,
      slug: nextSlug,
      descricao: result.data.descricao ?? current.descricao,
      baseRole: result.data.baseRole ?? current.baseRole,
      ativo: result.data.ativo ?? current.ativo,
      atualizadoEm: new Date(),
    })
    .where(eq(schema.customRoles.id, req.params.id))
    .returning();

  const invalidateTenantId = tenantId ?? current.tenantId;
  await invalidateTenantPermissions(invalidateTenantId);
  res.json({ role: updated });
}));

// DELETE /api/auth/custom-roles/:id - Remover role customizada
app.delete('/api/auth/custom-roles/:id', requireAuth(), requirePermission('admin:roles:delete'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const tenantId = req.tenantId;
  const isSuperAdmin = req.user?.role === 'super_admin';

  if (!tenantId && !isSuperAdmin) {
    return res.status(400).json({ error: 'Tenant não identificado' });
  }

  const current = await db.query.customRoles.findFirst({
    where: eq(schema.customRoles.id, req.params.id),
  });
  if (!current) {
    return res.status(404).json({ error: 'Role customizada não encontrada' });
  }
  if (tenantId && current.tenantId !== tenantId && !isSuperAdmin) {
    return res.status(403).json({ error: 'Acesso negado - role de outro tenant' });
  }

  const [deleted] = await db.delete(schema.customRoles)
    .where(eq(schema.customRoles.id, req.params.id))
    .returning();

  const invalidateTenantId = tenantId ?? current.tenantId;
  if (invalidateTenantId) {
    await invalidateTenantPermissions(invalidateTenantId);
  }
  res.json({ success: true, role: deleted });
}));

// GET /api/auth/custom-roles/:id/permissions - Listar permissões da role customizada
app.get('/api/auth/custom-roles/:id/permissions', requireAuth(), requirePermission('admin:roles:read'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const tenantId = req.tenantId;
  const isSuperAdmin = req.user?.role === 'super_admin';

  if (!tenantId && !isSuperAdmin) {
    return res.status(400).json({ error: 'Tenant não identificado' });
  }

  const role = await db.query.customRoles.findFirst({
    where: eq(schema.customRoles.id, req.params.id),
  });
  if (!role) {
    return res.status(404).json({ error: 'Role customizada não encontrada' });
  }
  if (tenantId && role.tenantId !== tenantId && !isSuperAdmin) {
    return res.status(403).json({ error: 'Acesso negado - role de outro tenant' });
  }

  const rolePermissions = await db.select({
    id: schema.customRolePermissions.id,
    customRoleId: schema.customRolePermissions.customRoleId,
    permissionId: schema.customRolePermissions.permissionId,
    permission: schema.permissions,
  })
    .from(schema.customRolePermissions)
    .innerJoin(schema.permissions, eq(schema.customRolePermissions.permissionId, schema.permissions.id))
    .where(eq(schema.customRolePermissions.customRoleId, role.id));

  res.json({ rolePermissions });
}));

// PUT /api/auth/custom-roles/:id/permissions - Definir permissões da role customizada
app.put('/api/auth/custom-roles/:id/permissions', requireAuth(), requirePermission('admin:roles:manage'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const tenantId = req.tenantId;
  const isSuperAdmin = req.user?.role === 'super_admin';

  if (!tenantId && !isSuperAdmin) {
    return res.status(400).json({ error: 'Tenant não identificado' });
  }

  const role = await db.query.customRoles.findFirst({
    where: eq(schema.customRoles.id, req.params.id),
  });
  if (!role) {
    return res.status(404).json({ error: 'Role customizada não encontrada' });
  }
  if (tenantId && role.tenantId !== tenantId && !isSuperAdmin) {
    return res.status(403).json({ error: 'Acesso negado - role de outro tenant' });
  }

  const bodyParse = assignCustomRolePermissionsSchema.safeParse(req.body);
  if (!bodyParse.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: bodyParse.error.format() });
  }

  const requestedCodes = Array.from(new Set(bodyParse.data.permissionCodes));
  const permissions = requestedCodes.length > 0
    ? await db.query.permissions.findMany({
      where: (perm, { inArray }) => inArray(perm.codigo, requestedCodes),
    })
    : [];

  const foundCodes = new Set(permissions.map((perm) => perm.codigo));
  const missingCodes = requestedCodes.filter((code) => !foundCodes.has(code));
  if (missingCodes.length > 0) {
    return res.status(400).json({ error: 'Permissões não encontradas', missing: missingCodes });
  }

  await db.transaction(async (tx) => {
    const current = await tx.query.customRolePermissions.findMany({
      where: eq(schema.customRolePermissions.customRoleId, role.id),
    });
    const currentIds = new Set(current.map((rp) => rp.permissionId));
    const nextIds = new Set(permissions.map((perm) => perm.id));

    const toRemove = current.filter((rp) => !nextIds.has(rp.permissionId));
    if (toRemove.length > 0) {
      await tx.delete(schema.customRolePermissions)
        .where(inArray(schema.customRolePermissions.id, toRemove.map((item) => item.id)));
    }

    const toAdd = permissions.filter((perm) => !currentIds.has(perm.id));
    if (toAdd.length > 0) {
      await tx.insert(schema.customRolePermissions).values(
        toAdd.map((perm) => ({
          customRoleId: role.id,
          permissionId: perm.id,
        }))
      );
    }
  });

  const invalidateTenantId = tenantId ?? role.tenantId;
  if (invalidateTenantId) {
    await invalidateTenantPermissions(invalidateTenantId);
  }
  res.json({ success: true, roleId: role.id, permissionCodes: requestedCodes });
}));

// GET /api/auth/roles/:role/permissions - Listar permissões por role
app.get('/api/auth/roles/:role/permissions', requireAuth(), requirePermission('admin:permissions:read'), asyncHandler(async (req: Request, res: Response) => {
  const roleParse = z.enum(['super_admin', 'admin', 'manager', 'operator', 'viewer', 'guest']).safeParse(req.params.role);
  if (!roleParse.success) {
    res.status(400).json({ error: 'Role inválida' });
    return;
  }

  const db = getDatabase();
  const rolePermissions = await db.select({
    id: schema.rolePermissions.id,
    role: schema.rolePermissions.role,
    permissionId: schema.rolePermissions.permissionId,
    permission: schema.permissions,
  })
    .from(schema.rolePermissions)
    .innerJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
    .where(eq(schema.rolePermissions.role, roleParse.data));

  res.json({ rolePermissions });
}));

// PUT /api/auth/roles/:role/permissions - Definir permissões de uma role
app.put('/api/auth/roles/:role/permissions', requireAuth(), requirePermission('admin:permissions:manage'), asyncHandler(async (req: Request, res: Response) => {
  const roleParse = z.enum(['super_admin', 'admin', 'manager', 'operator', 'viewer', 'guest']).safeParse(req.params.role);
  if (!roleParse.success) {
    res.status(400).json({ error: 'Role inválida' });
    return;
  }

  const bodyParse = assignRolePermissionsSchema.safeParse(req.body);
  if (!bodyParse.success) {
    res.status(400).json({ error: 'Dados inválidos', details: bodyParse.error.format() });
    return;
  }

  const db = getDatabase();
  const requestedCodes = Array.from(new Set(bodyParse.data.permissionCodes));
  const role = roleParse.data;

  const allPermissions = await db.query.permissions.findMany({
    columns: { id: true, codigo: true },
  });
  const effectiveCodes = ['admin', 'super_admin'].includes(role)
    ? allPermissions.map((perm) => perm.codigo)
    : requestedCodes;

  const permissions = await db.query.permissions.findMany({
    where: (perm, { inArray }) => inArray(perm.codigo, effectiveCodes),
  });

  const foundCodes = new Set(permissions.map((perm) => perm.codigo));
  const missingCodes = effectiveCodes.filter((code) => !foundCodes.has(code));
  if (missingCodes.length > 0) {
    res.status(400).json({ error: 'Permissões não encontradas', missing: missingCodes });
    return;
  }

  await db.transaction(async (tx) => {
    const current = await tx.query.rolePermissions.findMany({
      where: eq(schema.rolePermissions.role, roleParse.data),
    });
    const currentIds = new Set(current.map((rp) => rp.permissionId));
    const nextIds = new Set(permissions.map((perm) => perm.id));

    const toRemove = current.filter((rp) => !nextIds.has(rp.permissionId));
    if (toRemove.length > 0) {
      await tx.delete(schema.rolePermissions)
        .where(inArray(schema.rolePermissions.id, toRemove.map((item) => item.id)));
    }

    const toAdd = permissions.filter((perm) => !currentIds.has(perm.id));
    if (toAdd.length > 0) {
      await tx.insert(schema.rolePermissions)
        .values(toAdd.map((perm) => ({
          role: roleParse.data,
          permissionId: perm.id,
        })));
    }
  });

  await clearPermissionCache();
  res.json({ success: true, role, permissions: effectiveCodes });
}));

// ============================================================================
// ROTAS: Gestão de Grupos Organizacionais (sem impacto em permissões)
// ============================================================================

// GET /api/auth/groups - Listar grupos do tenant
app.get('/api/auth/groups', requireAuth(), requirePermission('admin:groups:read'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.tenantId) {
    res.status(400).json({ error: 'Tenant não definido' });
    return;
  }

  const db = getDatabase();
  const groups = await db.query.userGroups.findMany({
    where: eq(schema.userGroups.tenantId, req.tenantId),
    orderBy: (group, { asc }) => [asc(group.nome)],
  });

  res.json({ groups });
}));

// POST /api/auth/groups - Criar grupo
app.post('/api/auth/groups', requireAuth(), requirePermission('admin:groups:write'), asyncHandler(async (req: Request, res: Response) => {
  if (!req.tenantId) {
    res.status(400).json({ error: 'Tenant não definido' });
    return;
  }

  const result = createGroupSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Dados inválidos', details: result.error.format() });
    return;
  }

  const db = getDatabase();
  const existing = await db.query.userGroups.findFirst({
    where: and(
      eq(schema.userGroups.tenantId, req.tenantId),
      eq(schema.userGroups.nome, result.data.nome)
    ),
  });
  if (existing) {
    res.status(409).json({ error: 'Já existe um grupo com esse nome' });
    return;
  }

  const [group] = await db.insert(schema.userGroups)
    .values({
      tenantId: req.tenantId,
      nome: result.data.nome,
      descricao: result.data.descricao,
      ativo: result.data.ativo ?? true,
      criadoPor: req.user?.userId,
      atualizadoPor: req.user?.userId,
    })
    .returning();

  res.status(201).json({ group });
}));

// PATCH /api/auth/groups/:id - Atualizar grupo
app.patch('/api/auth/groups/:id', requireAuth(), requirePermission('admin:groups:write'), asyncHandler(async (req: Request, res: Response) => {
  const result = updateGroupSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Dados inválidos', details: result.error.format() });
    return;
  }
  if (Object.keys(result.data).length === 0) {
    res.status(400).json({ error: 'Nenhum campo para atualizar' });
    return;
  }

  const db = getDatabase();
  const group = await db.query.userGroups.findFirst({
    where: eq(schema.userGroups.id, req.params.id),
  });
  if (!group) {
    res.status(404).json({ error: 'Grupo não encontrado' });
    return;
  }
  if (req.user?.role !== 'super_admin' && group.tenantId !== req.tenantId) {
    res.status(403).json({ error: 'Acesso negado - tenant diferente' });
    return;
  }

  const [updated] = await db.update(schema.userGroups)
    .set({
      ...result.data,
      atualizadoPor: req.user?.userId,
      atualizadoEm: new Date(),
    })
    .where(eq(schema.userGroups.id, req.params.id))
    .returning();

  res.json({ group: updated });
}));

// DELETE /api/auth/groups/:id - Excluir grupo
app.delete('/api/auth/groups/:id', requireAuth(), requirePermission('admin:groups:delete'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const group = await db.query.userGroups.findFirst({
    where: eq(schema.userGroups.id, req.params.id),
  });
  if (!group) {
    res.status(404).json({ error: 'Grupo não encontrado' });
    return;
  }
  if (req.user?.role !== 'super_admin' && group.tenantId !== req.tenantId) {
    res.status(403).json({ error: 'Acesso negado - tenant diferente' });
    return;
  }

  const [deleted] = await db.delete(schema.userGroups)
    .where(eq(schema.userGroups.id, req.params.id))
    .returning();

  res.json({ success: true, group: deleted });
}));

// GET /api/auth/groups/:id/users - Listar membros do grupo
app.get('/api/auth/groups/:id/users', requireAuth(), requirePermission('admin:groups:read'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const group = await db.query.userGroups.findFirst({
    where: eq(schema.userGroups.id, req.params.id),
  });
  if (!group) {
    res.status(404).json({ error: 'Grupo não encontrado' });
    return;
  }
  if (req.user?.role !== 'super_admin' && group.tenantId !== req.tenantId) {
    res.status(403).json({ error: 'Acesso negado - tenant diferente' });
    return;
  }

  const members = await db.select({
    id: schema.userGroupMembers.id,
    userId: schema.userGroupMembers.userId,
    groupId: schema.userGroupMembers.groupId,
    criadoEm: schema.userGroupMembers.criadoEm,
    user: schema.users,
  })
    .from(schema.userGroupMembers)
    .innerJoin(schema.users, eq(schema.userGroupMembers.userId, schema.users.id))
    .where(eq(schema.userGroupMembers.groupId, req.params.id));

  res.json({ members });
}));

// POST /api/auth/groups/:id/users - Adicionar usuário ao grupo
app.post('/api/auth/groups/:id/users', requireAuth(), requirePermission('admin:groups:manage'), asyncHandler(async (req: Request, res: Response) => {
  const result = groupMemberSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Dados inválidos', details: result.error.format() });
    return;
  }

  const db = getDatabase();
  const group = await db.query.userGroups.findFirst({
    where: eq(schema.userGroups.id, req.params.id),
  });
  if (!group) {
    res.status(404).json({ error: 'Grupo não encontrado' });
    return;
  }
  if (req.user?.role !== 'super_admin' && group.tenantId !== req.tenantId) {
    res.status(403).json({ error: 'Acesso negado - tenant diferente' });
    return;
  }

  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, result.data.userId),
  });
  if (!user) {
    res.status(404).json({ error: 'Usuário não encontrado' });
    return;
  }
  if (req.user?.role !== 'super_admin' && user.tenantId !== req.tenantId) {
    res.status(400).json({ error: 'Usuário de outro tenant não pode ser adicionado' });
    return;
  }

  const existing = await db.query.userGroupMembers.findFirst({
    where: and(
      eq(schema.userGroupMembers.groupId, req.params.id),
      eq(schema.userGroupMembers.userId, result.data.userId)
    ),
  });
  if (existing) {
    res.json({ member: existing });
    return;
  }

  const [member] = await db.insert(schema.userGroupMembers)
    .values({
      tenantId: group.tenantId,
      groupId: group.id,
      userId: result.data.userId,
      criadoPor: req.user?.userId,
    })
    .returning();

  res.status(201).json({ member });
}));

// DELETE /api/auth/groups/:id/users/:userId - Remover usuário do grupo
app.delete('/api/auth/groups/:id/users/:userId', requireAuth(), requirePermission('admin:groups:manage'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  const group = await db.query.userGroups.findFirst({
    where: eq(schema.userGroups.id, req.params.id),
  });
  if (!group) {
    res.status(404).json({ error: 'Grupo não encontrado' });
    return;
  }
  if (req.user?.role !== 'super_admin' && group.tenantId !== req.tenantId) {
    res.status(403).json({ error: 'Acesso negado - tenant diferente' });
    return;
  }

  const [deleted] = await db.delete(schema.userGroupMembers)
    .where(and(
      eq(schema.userGroupMembers.groupId, req.params.id),
      eq(schema.userGroupMembers.userId, req.params.userId)
    ))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: 'Membro não encontrado' });
    return;
  }

  res.json({ success: true, member: deleted });
}));
}
