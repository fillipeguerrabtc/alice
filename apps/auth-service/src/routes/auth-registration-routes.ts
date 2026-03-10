import type { Express, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { eq } from '@alice/database';
import { getDatabase, schema } from '@alice/database';
import { createLogger } from '@alice/logger';
import { asyncHandler, requireAuth, requireRole } from '@alice/shared-utils';
import { z } from 'zod';
import type { publishProvisioningEvent } from '../identity-provisioning/index.js';

interface RegisterAuthRegistrationRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  publishProvisioningEvent: typeof publishProvisioningEvent;
}

const registerSchema = z.object({
  email: z.string()
    .email('Email inválido')
    .max(255, 'Email muito longo')
    .transform((value) => value.toLowerCase().trim()),
  password: z.string()
    .min(8, 'Senha deve ter pelo menos 8 caracteres')
    .max(128, 'Senha muito longa')
    .regex(/[A-Z]/, 'Senha deve conter pelo menos uma letra maiúscula')
    .regex(/[a-z]/, 'Senha deve conter pelo menos uma letra minúscula')
    .regex(/[0-9]/, 'Senha deve conter pelo menos um número'),
  firstName: z.string()
    .min(1, 'Nome é obrigatório')
    .max(100, 'Nome muito longo'),
  lastName: z.string()
    .min(1, 'Sobrenome é obrigatório')
    .max(100, 'Sobrenome muito longo'),
  cargo: z.string()
    .min(1, 'Cargo é obrigatório')
    .max(120, 'Cargo muito longo'),
  departamento: z.string()
    .min(1, 'Departamento é obrigatório')
    .max(120, 'Departamento muito longo'),
  telefone: z.string()
    .min(6, 'Telefone é obrigatório')
    .max(30, 'Telefone muito longo'),
  preferredName: z.string()
    .min(2, 'Nome preferido muito curto')
    .max(120, 'Nome preferido muito longo')
    .optional(),
});

export function registerAuthRegistrationRoutes(
  app: Express,
  deps: RegisterAuthRegistrationRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('auth-service');
  const { publishProvisioningEvent } = deps;

  app.post('/api/auth/register', requireAuth(), requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
    const parseResult = registerSchema.safeParse(req.body);

    if (!parseResult.success) {
      const errors = parseResult.error.errors.map((error) => error.message);
      return res.status(400).json({
        error: 'Dados de registro inválidos',
        details: errors,
      });
    }

    const { email, password, firstName, lastName, cargo, departamento, telefone, preferredName } = parseResult.data;
    const db = getDatabase();

    const existingUser = await db.query.users.findFirst({
      where: eq(schema.users.email, email),
    });

    if (existingUser) {
      return res.status(409).json({ error: 'Email já cadastrado' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    let defaultTenant = await db.query.tenants.findFirst({
      where: eq(schema.tenants.slug, 'alice-platform'),
    });

    if (!defaultTenant) {
      logger.warn('Tenant default não encontrado durante local registration, criando...');
      const inserted = await db.insert(schema.tenants).values({
        nome: 'Alice Platform',
        slug: 'alice-platform',
        dominio: 'yesyoudeserve.duckdns.org',
        plano: 'enterprise',
        limiteUsuarios: 999999,
        limiteConversas: 999999,
        limiteArmazenamento: 999999,
        ativo: true,
      }).onConflictDoNothing().returning();

      if (inserted.length === 0) {
        defaultTenant = await db.query.tenants.findFirst({
          where: eq(schema.tenants.slug, 'alice-platform'),
        });
      } else {
        defaultTenant = inserted[0];
      }

      if (!defaultTenant) {
        logger.error('Tenant default não encontrado após insert+query - crítico');
        return res.status(500).json({ error: 'Configuração do sistema incompleta' });
      }
    }

    const [newUser] = await db.insert(schema.users).values({
      email,
      passwordHash,
      firstName,
      lastName,
      preferredName: preferredName || null,
      cargo,
      departamento,
      telefone,
      authProvider: 'local',
      emailVerified: false,
      role: 'guest',
      idioma: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      tenantId: defaultTenant.id,
    }).returning();

    await db.insert(schema.userRoles).values({
      userId: newUser.id,
      role: 'guest',
    }).onConflictDoNothing();

    logger.info({ userId: newUser.id, email }, 'Novo usuário registrado');

    publishProvisioningEvent('user.created', {
      userId: newUser.id,
      email: newUser.email || email,
      firstName: newUser.firstName || undefined,
      lastName: newUser.lastName || undefined,
      role: newUser.role || 'guest',
      tenantId: newUser.tenantId || undefined,
    }).catch((error) => {
      logger.error({ error, userId: newUser.id }, 'Erro ao publicar evento de provisioning');
    });

    const { passwordHash: _passwordHash, ...safeUser } = newUser;
    return res.status(201).json({ user: safeUser, message: 'Conta criada com sucesso' });
  }));
}
