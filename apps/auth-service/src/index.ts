/**
 * Alice Enterprise Platform - Auth Service
 * 
 * Serviço de autenticação enterprise com suporte a:
 * - OAuth 2.0 (Google, GitHub)
 * - SAML 2.0 (Azure AD, Okta)
 * - Autenticação local (email/senha com bcrypt)
 * 
 * Segue best practices 2025 para microserviços (Regra 16 CLAUDE.md)
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * 
 * REFATORADO: Usa @alice/database centralizado (Regra 2 - Não Duplicar)
 */

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import cors from 'cors';
// helmet aplicado via createSecurityMiddleware de @alice/shared-utils
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as SamlStrategy, Profile as SamlProfile, VerifiedCallback } from '@node-saml/passport-saml';
import bcrypt from 'bcrypt';
import { createLogger } from '@alice/logger';
import { 
  createCorrelationMiddleware, 
  createSecurityMiddleware,
  createRateLimiter,
  createErrorHandler,
  createNotFoundHandler,
  asyncHandler,
  requirePermission, 
  requireAuth,
  requireRole,
  setPermissionResolver,
  createAlicePrometheus,
  initRbacPrometheusMetrics,
  instrumentCircuitBreaker,
  registerShutdownCallback,
  ShutdownPriority,
  Counter as PromCounter,
  createCircuitBreaker,
  CIRCUIT_BREAKER_PRESETS,
  clearPermissionCache,
  PERMISSION_MAP,
  Role,
  ROLE_HIERARCHY,
  ROLE_DESCRIPTIONS,
} from '@alice/shared-utils';
import { eq, or, and, inArray, sql } from '@alice/database';
import type { AuthContext } from '@alice/shared-utils';
import { z } from 'zod';
import { 
  getDatabase, 
  getPool, 
  schema, 
  closeDatabasePool,
  isPoolHealthy,
  createDrizzleFeatureFlagStorage,
} from '@alice/database';
import { mountOIDCRoutes } from './oidc/index.js';
import { 
  startProcessor as startIdentityProvisioning, 
  stopProcessor as stopIdentityProvisioning,
  publishProvisioningEvent,
} from './identity-provisioning/index.js';
import { 
  initFeatureFlags,
  setupSwaggerUI,
  AUTH_SERVICE_TAGS,
  invalidateUserPermissions,
  invalidateTenantPermissions,
} from '@alice/shared-utils';
import { authServicePaths, authServiceSchemas } from './openapi-specs.js';

// Logger centralizado: JSON em produção, pino-pretty em desenvolvimento
const logger = createLogger('auth-service');

// Inicializar sistema de feature flags com storage PostgreSQL (Regra 16 - Enterprise)
const featureFlagStorage = createDrizzleFeatureFlagStorage();
initFeatureFlags(featureFlagStorage);
logger.info('Sistema de feature flags inicializado');

async function resolveUserRoleAssignments(params: {
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

function resolveHighestRole(roles: Role[], fallback: Role): Role {
  if (roles.length === 0) return fallback;
  return roles.reduce((highest, role) => (
    ROLE_HIERARCHY[role] < ROLE_HIERARCHY[highest] ? role : highest
  ));
}

setPermissionResolver(async (auth: AuthContext) => {
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
});

type DbUser = typeof schema.users.$inferSelect;

async function buildAuthContext(dbUser: DbUser): Promise<Express.User> {
  const assignments = await resolveUserRoleAssignments({
    userId: dbUser.id,
    tenantId: dbUser.tenantId || undefined,
  });
  const effectiveRole = resolveHighestRole(assignments.baseRoles, (dbUser.role || 'guest') as Role);
  return {
    userId: dbUser.id,
    tenantId: dbUser.tenantId || undefined,
    role: effectiveRole,
    customRoleId: undefined,
    email: dbUser.email || undefined,
    permissions: [],
  };
}

type PermissionDefinition = {
  codigo: string;
  nome: string;
  descricao: string;
  modulo: string;
};

const MODULE_LABELS: Record<string, string> = {
  auth: 'Autenticação',
  chat: 'Chat',
  rag: 'RAG',
  training: 'Treinamento',
  integrations: 'Integrações',
  images: 'Imagens',
  admin: 'Administração',
  audit: 'Auditoria',
};

const ACTION_LABELS: Record<string, string> = {
  read: 'Visualizar',
  write: 'Editar',
  delete: 'Excluir',
  manage: 'Gerenciar',
  upload: 'Enviar',
  sync: 'Sincronizar',
  approve: 'Aprovar',
  start: 'Iniciar',
  cancel: 'Cancelar',
  retry: 'Reprocessar',
  reconcile: 'Conciliar',
  assign: 'Atribuir',
};

const PERMISSION_OVERRIDES: Record<string, PermissionDefinition> = {
  'admin:alice_core:write': {
    codigo: 'admin:alice_core:write',
    nome: 'Editar Core da Alice',
    descricao: 'Permite editar ética, moral, legal, guardrails, system prompt e identidade do criador.',
    modulo: 'admin',
  },
};

function humanizeToken(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeRoleSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function buildPermissionDefinition(code: string): PermissionDefinition {
  const override = PERMISSION_OVERRIDES[code];
  if (override) {
    return override;
  }

  const [moduleRaw = 'admin', resourceRaw = 'resource', actionRaw = 'read'] = code.split(':');
  const moduleLabel = MODULE_LABELS[moduleRaw] || humanizeToken(moduleRaw);
  const actionLabel = ACTION_LABELS[actionRaw] || humanizeToken(actionRaw);
  const resourceLabel = humanizeToken(resourceRaw);

  return {
    codigo: code,
    nome: `${actionLabel} ${resourceLabel}`,
    descricao: `Permite ${actionLabel.toLowerCase()} ${resourceLabel.toLowerCase()} no módulo ${moduleLabel}.`,
    modulo: moduleRaw,
  };
}

async function ensurePermissionCatalog(): Promise<void> {
  const db = getDatabase();
  const existing = await db.query.permissions.findMany({
    columns: {
      id: true,
      codigo: true,
      nome: true,
      descricao: true,
      modulo: true,
    },
  });
  const existingCodes = new Set(existing.map((item) => item.codigo));
  const missingCodes = Object.keys(PERMISSION_MAP).filter((code) => !existingCodes.has(code));

  if (missingCodes.length > 0) {
    const newPermissions = missingCodes.map(buildPermissionDefinition);
    await db.insert(schema.permissions).values(newPermissions);
    logger.info({ count: newPermissions.length }, 'Permissões ausentes criadas no catálogo');
  }

  const overrides = Object.values(PERMISSION_OVERRIDES);
  for (const override of overrides) {
    const current = existing.find((perm) => perm.codigo === override.codigo);
    if (!current) continue;
    if (current.nome !== override.nome || current.descricao !== override.descricao || current.modulo !== override.modulo) {
      await db.update(schema.permissions)
        .set({
          nome: override.nome,
          descricao: override.descricao,
          modulo: override.modulo,
        })
        .where(eq(schema.permissions.codigo, override.codigo));
    }
  }

  const allPermissions = await db.query.permissions.findMany({
    columns: { id: true, codigo: true },
  });
  const permissionIds = allPermissions.map((perm) => perm.id);
  const roles = ['admin', 'super_admin'] as const;

  await db.transaction(async (tx) => {
    for (const role of roles) {
      const current = await tx.query.rolePermissions.findMany({
        where: eq(schema.rolePermissions.role, role),
        columns: { permissionId: true },
      });
      const currentIds = new Set(current.map((item) => item.permissionId));
      const toAdd = permissionIds.filter((id) => !currentIds.has(id));

      if (toAdd.length > 0) {
        await tx.insert(schema.rolePermissions).values(
          toAdd.map((permissionId) => ({
            role,
            permissionId,
          }))
        );
        logger.info({ role, added: toAdd.length }, 'Permissões atribuídas automaticamente à role');
      }
    }
  });
}

// ============================================================================
// CSRF Protection (Regra 16 - Segurança Enterprise)
// ============================================================================

// Extensão de tipos para sessão com CSRF token
declare module 'express-session' {
  interface SessionData {
    csrfToken?: string;
  }
}

/**
 * Gera ou retorna CSRF token da sessão
 * Token é criptograficamente seguro (32 bytes hex = 64 chars)
 */
function getOrCreateCsrfToken(sessionData: session.Session & session.SessionData): string {
  if (!sessionData.csrfToken) {
    sessionData.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return sessionData.csrfToken;
}

/**
 * Middleware para validar CSRF token em requests mutating
 * Aplica apenas a POST, PUT, PATCH, DELETE
 */
function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  const mutatingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  
  // Ignorar métodos não-mutating
  if (!mutatingMethods.includes(req.method)) {
    return next();
  }
  
  // Rotas isentas (login inicial, webhooks, health checks)
  const exemptRoutes = [
    '/api/auth/login',
    '/api/auth/google',
    '/api/auth/github',
    '/api/auth/saml',
    '/api/auth/health',
    '/api/stripe/webhook',
    '/api/twilio/webhook',
  ];
  
  if (exemptRoutes.some(route => req.path.startsWith(route))) {
    return next();
  }
  
  // Token vem do header X-CSRF-Token
  const tokenFromHeader = req.headers['x-csrf-token'] as string | undefined;
  const tokenFromSession = req.session?.csrfToken;
  
  // Em desenvolvimento sem sessão, permitir
  if (config.NODE_ENV !== 'production' && !tokenFromSession) {
    return next();
  }
  
  // Validar presença dos tokens
  if (!tokenFromHeader || !tokenFromSession) {
    logger.warn({ 
      path: req.path, 
      method: req.method,
      hasHeaderToken: !!tokenFromHeader,
      hasSessionToken: !!tokenFromSession,
    }, 'CSRF token ausente');
    
    res.status(403).json({ error: 'CSRF token ausente' });
    return;
  }
  
  // SEGURANÇA: Usar comparação timing-safe para evitar timing attacks (OWASP 2025)
  // Comparação com === expõe timing side-channel que permite brute-force do token
  const headerBuffer = Buffer.from(tokenFromHeader, 'utf8');
  const sessionBuffer = Buffer.from(tokenFromSession, 'utf8');
  
  // Tokens devem ter o mesmo tamanho para comparação segura
  if (headerBuffer.length !== sessionBuffer.length) {
    logger.warn({ 
      path: req.path, 
      method: req.method,
    }, 'CSRF token com tamanho inválido');
    
    res.status(403).json({ error: 'CSRF token inválido' });
    return;
  }
  
  // Comparação timing-safe
  if (!crypto.timingSafeEqual(headerBuffer, sessionBuffer)) {
    logger.warn({ 
      path: req.path, 
      method: req.method,
    }, 'CSRF token não corresponde');
    
    res.status(403).json({ error: 'CSRF token inválido' });
    return;
  }
  
  next();
}

// Schema de configuração do auth-service
// REGRA 14: ADMIN_USER e ADMIN_PWD são obrigatórios em produção (fail-fast no GitHub Actions)
// Schema Zod deve refletir requisito de runtime - obrigatórios em produção, opcionais em desenvolvimento
const DEV_SESSION_SECRET = 'dev-secret-min-32-characters-long!';

const baseAuthConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().optional(),
  // Em desenvolvimento, mantemos compatibilidade com o default (usado também em outros serviços).
  // Em produção, a validação abaixo exige >= 64 chars (Regra 6: sem defaults inseguros).
  SESSION_SECRET: z.string().default(DEV_SESSION_SECRET),
  ADMIN_USER: z.string().email().optional(),
  ADMIN_PWD: z.string().min(8, 'ADMIN_PWD deve ter no mínimo 8 caracteres').optional(),
  // OAuth Google
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // OAuth GitHub
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  // SAML 2.0 (Azure AD, Okta)
  SAML_ENTRY_POINT: z.string().optional(),
  SAML_ISSUER: z.string().optional(),
  SAML_CERT: z.string().optional(),
});

// Schema com validação condicional: ADMIN_USER e ADMIN_PWD obrigatórios apenas em produção
const authConfigSchema = baseAuthConfigSchema
  .refine(
  (data) => {
    // Em produção, ADMIN_USER e ADMIN_PWD são obrigatórios (fail-fast no GitHub Actions)
    if (data.NODE_ENV === 'production') {
      return !!data.ADMIN_USER && !!data.ADMIN_PWD;
    }
    // Em desenvolvimento/test, são opcionais
    return true;
  },
  {
    message: 'ADMIN_USER e ADMIN_PWD são obrigatórios em produção (fail-fast no GitHub Actions)',
    path: ['ADMIN_USER', 'ADMIN_PWD'],
  }
)
  .refine(
    (data) => {
      if (data.NODE_ENV !== 'production') return true;
      // Regra 6: sem secrets fracos em produção
      return typeof data.SESSION_SECRET === 'string' && data.SESSION_SECRET.length >= 64 && data.SESSION_SECRET !== DEV_SESSION_SECRET;
    },
    {
      message: 'SESSION_SECRET é obrigatório em produção e deve ter >= 64 caracteres (sem usar o default de desenvolvimento).',
      path: ['SESSION_SECRET'],
    }
  );

type AuthConfig = z.infer<typeof authConfigSchema>;

// Carregar configuração com validação Zod
let config: AuthConfig;

// Validar SESSION_SECRET obrigatório em produção (Regra 16 - Best Practices 2025)
const nodeEnv = process.env.NODE_ENV || 'development';
const sessionSecret = process.env.SESSION_SECRET;

if (nodeEnv === 'production' && (!sessionSecret || sessionSecret.length < 64 || sessionSecret === DEV_SESSION_SECRET)) {
  logger.error('CRITICAL: SESSION_SECRET é OBRIGATÓRIO em produção, deve ter >= 64 caracteres e não pode ser o default de desenvolvimento. Abortando inicialização.');
  process.exit(1);
}

if (!sessionSecret && nodeEnv === 'development') {
  logger.warn('SESSION_SECRET não definido. Usando valor de desenvolvimento (NÃO usar em produção!)');
}

try {
  const result = authConfigSchema.safeParse(process.env);
  if (result.success) {
    config = result.data;
  } else {
    // REGRA 14: Em produção, validação de schema deve falhar explicitamente
    // GitHub Actions já validou formato de email, mas Zod é a fonte da verdade
    if (nodeEnv === 'production') {
      const formattedErrors = result.error.format();
      logger.error({ 
        errors: formattedErrors,
        env: {
          ADMIN_USER: process.env.ADMIN_USER ? '[SET]' : '[NOT SET]',
          ADMIN_PWD: process.env.ADMIN_PWD ? '[SET]' : '[NOT SET]',
        }
      }, 'Configuração inválida em produção. Abortando.');
      
      // Log detalhado dos erros de validação para facilitar debug
      result.error.errors.forEach((err) => {
        logger.error({ 
          path: err.path.join('.'),
          message: err.message,
          code: err.code,
        }, 'Erro de validação Zod');
      });
      
      process.exit(1);
    }
    logger.warn({ errors: result.error.format() }, 'Configuração parcial, usando defaults (apenas desenvolvimento)');
    config = authConfigSchema.parse({});
  }
} catch (error) {
  if (nodeEnv === 'production') {
    logger.error({ 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }, 'Falha crítica ao carregar configuração em produção. Abortando.');
    process.exit(1);
  }
  logger.error({ error }, 'Falha ao carregar configuração. Usando valores padrão (apenas desenvolvimento).');
  config = {
    NODE_ENV: 'development',
    PORT: 3001,
    SESSION_SECRET: 'dev-secret-min-32-characters-long!',
  };
}

const app = express();

// ============================================================================
// SEED: Usuário Administrador Global (Regra 14 - Autenticação Centralizada)
// ============================================================================
async function ensureGlobalAdmin(): Promise<void> {
  // REGRA 14: ADMIN_USER e ADMIN_PWD são obrigatórios em produção (fail-fast no GitHub Actions)
  // Schema Zod valida obrigatoriedade e formato de email em produção, mas em desenvolvimento são opcionais
  // REGRA 8: Optional chaining em ambas as chamadas para evitar TypeError se ADMIN_USER for undefined
  const adminEmail = config.ADMIN_USER?.toLowerCase()?.trim();
  const adminPassword = config.ADMIN_PWD;

  if (!adminEmail || !adminPassword) {
    // Em produção, o schema Zod já garantiu que existem e são válidos (validação com refine + .email())
    // Se chegou aqui em produção, é um bug crítico - o schema deveria ter falhado
    if (config.NODE_ENV === 'production') {
      logger.error({ 
        ADMIN_USER: config.ADMIN_USER ? '[SET]' : '[NOT SET]',
        ADMIN_PWD: config.ADMIN_PWD ? '[SET]' : '[NOT SET]',
      }, 'ADMIN_USER/ADMIN_PWD não configurados em produção - schema deveria ter validado e abortado');
      throw new Error('ADMIN_USER e ADMIN_PWD são obrigatórios em produção - falha crítica de validação');
    }
    // Em desenvolvimento, apenas loga warning e continua (opcional)
    logger.warn('ADMIN_USER/ADMIN_PWD não configurados - seed de administrador global ignorado');
    return;
  }
  
  // Validação adicional de formato de email (defesa em profundidade)
  // REGRA 14: GitHub Actions já validou, mas validar novamente em runtime para garantir
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(adminEmail)) {
    logger.error({ 
      adminEmail,
      NODE_ENV: config.NODE_ENV,
    }, 'ADMIN_USER não é um email válido - validação falhou em runtime');
    
    if (config.NODE_ENV === 'production') {
      throw new Error(`ADMIN_USER deve ser um email válido. Valor fornecido: ${adminEmail}`);
    }
    logger.warn('ADMIN_USER com formato inválido - seed de administrador global ignorado');
    return;
  }

  if (adminPassword.length < 8) {
    logger.error('ADMIN_PWD não atende ao requisito mínimo de 8 caracteres');
    return;
  }

  const db = getDatabase();
  
  // BUG FIX 13/01/2026: Garantir que tenant default existe antes de criar usuário
  // Migration 0013 cria tenant "Alice Platform", mas precisamos do ID aqui
  let defaultTenant = await db.query.tenants.findFirst({
    where: eq(schema.tenants.slug, 'alice-platform'),
  });
  
  // Se tenant default não existe, criar agora (fallback para caso migration não rode)
  if (!defaultTenant) {
    logger.info('Tenant default não encontrado, criando "Alice Platform"...');
    
    // BUG FIX 13/01/2026: Usar onConflictDoNothing para evitar race condition
    // Se múltiplas instâncias auth-service iniciarem simultaneamente, ambas podem
    // tentar inserir o tenant default. onConflictDoNothing previne unique constraint error.
    // REF: Migration 0013 usa ON CONFLICT (slug) DO NOTHING
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
    
    // Se insert retornou vazio (conflito), buscar novamente
    if (inserted.length === 0) {
      logger.info('Tenant default já existe (inserido por outra instância), buscando...');
      defaultTenant = await db.query.tenants.findFirst({
        where: eq(schema.tenants.slug, 'alice-platform'),
      });
    } else {
      defaultTenant = inserted[0];
      logger.info({ tenantId: defaultTenant?.id }, 'Tenant default "Alice Platform" criado');
    }
    
    // Validação: se ainda não existe (caso extremo), falhar fast
    if (!defaultTenant) {
      throw new Error('CRITICAL: Tenant default não encontrado após insert+query');
    }
  }
  
  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, adminEmail),
  });

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const baseUser = {
    email: adminEmail,
    passwordHash,
    firstName: 'Administrator',
    lastName: 'Global',
    authProvider: 'local' as const,
    emailVerified: true,
    role: 'super_admin' as const,
    idioma: 'pt-BR',
    timezone: 'UTC',
    tenantId: defaultTenant.id, // BUG FIX 13/01/2026: SEMPRE associar a um tenant
  };

  if (!existing) {
    // REGRA 8: Capturar resultado do insert para verificar sucesso (Drizzle ORM best practice)
    const [created] = await db.insert(schema.users).values(baseUser).returning();
    
    // Verificar se insert teve sucesso antes de logar e provisionar
    if (!created) {
      logger.error({ email: adminEmail }, 'Falha ao criar administrador global via seed');
      return;
    }
    
    logger.info({ userId: created.id, email: adminEmail }, 'Administrador global criado via seed');
    publishProvisioningEvent('user.created', {
      userId: created.id,
      email: created.email || adminEmail,
      firstName: created.firstName || undefined,
      lastName: created.lastName || undefined,
      role: created.role || 'super_admin',
      tenantId: created.tenantId || undefined,
    }).catch((error) => logger.warn({ error }, 'Provisionamento do admin global falhou (não crítico)'));
    return;
  }

  // Atualizar role e senha para garantir alinhamento com os secrets
  // REGRA 8: Capturar resultado do update para verificar sucesso (Drizzle ORM best practice)
  const [updated] = await db
    .update(schema.users)
    .set({
      ...baseUser,
    })
    .where(eq(schema.users.id, existing.id))
    .returning();

  // Verificar se update teve sucesso antes de logar e provisionar
  if (!updated) {
    logger.error({ userId: existing.id, email: adminEmail }, 'Falha ao atualizar administrador global via seed');
    return;
  }

  logger.info({ userId: updated.id, email: adminEmail }, 'Administrador global atualizado via seed');
  publishProvisioningEvent('user.updated', {
    userId: updated.id,
    email: updated.email || adminEmail,
    firstName: updated.firstName || undefined,
    lastName: updated.lastName || undefined,
    role: updated.role || 'super_admin',
    tenantId: updated.tenantId || undefined,
  }).catch((error) => logger.warn({ error }, 'Provisionamento do admin global falhou (não crítico)'));
}

// ============================================================================
// SEED: OAuth Clients para SSO Automatizado (31/12/2025)
// ============================================================================
// Cria/atualiza clientes OAuth para Grafana e ERPNext no startup
// Usa secrets pré-definidos do ambiente para deploy 100% automatizado
// Idempotente: pode rodar múltiplas vezes sem problemas
// ============================================================================

interface OAuthClientSeedConfig {
  clientId: string;
  clientSecret: string;
  nome: string;
  descricao: string;
  redirectUris: string[];
  scopes: string[];
}

async function ensureOAuthClients(): Promise<void> {
  // Variáveis obrigatórias apenas em produção
  const grafanaSecret = process.env.GRAFANA_OAUTH_CLIENT_SECRET;
  const erpnextSecret = process.env.ERPNEXT_OAUTH_CLIENT_SECRET;
  const grafanaUrl = process.env.GRAFANA_URL || 'https://observability.yesyoudeserve.duckdns.org';
  const erpnextUrl = process.env.ERPNEXT_URL || 'https://erp.yesyoudeserve.duckdns.org';

  if (!grafanaSecret || !erpnextSecret) {
    if (config.NODE_ENV === 'production') {
      logger.error({
        GRAFANA_OAUTH_CLIENT_SECRET: grafanaSecret ? '[SET]' : '[NOT SET]',
        ERPNEXT_OAUTH_CLIENT_SECRET: erpnextSecret ? '[SET]' : '[NOT SET]',
      }, 'OAuth client secrets não configurados em produção - SSO não funcionará');
      // Não é crítico - apenas loga erro, não aborta o serviço
    } else {
      logger.warn('OAuth client secrets não configurados - seed de clientes OAuth ignorado');
    }
    return;
  }

  const clients: OAuthClientSeedConfig[] = [
    {
      clientId: 'grafana-sso',
      clientSecret: grafanaSecret,
      nome: 'Grafana OSS',
      descricao: 'Dashboard de observabilidade - SSO via Alice IdP',
      redirectUris: [`${grafanaUrl}/login/generic_oauth`],
      // Escopo "alice" habilita claims customizados (role, tenant_id, modules) para RBAC no Grafana.
      scopes: ['openid', 'profile', 'email', 'alice'],
    },
    {
      clientId: 'erpnext-sso',
      clientSecret: erpnextSecret,
      nome: 'ERPNext CRM/ERP',
      descricao: 'Sistema de gestão empresarial - SSO via Alice IdP',
      redirectUris: [`${erpnextUrl}/api/method/frappe.integrations.oauth2.login_via_oauth2`],
      // Escopo "alice" habilita claims customizados usados no provisioning e mapeamento de roles.
      scopes: ['openid', 'profile', 'email', 'alice'],
    },
  ];

  const db = getDatabase();

  for (const client of clients) {
    try {
      const existing = await db.query.oauthClients.findFirst({
        where: eq(schema.oauthClients.clientId, client.clientId),
      });

      if (!existing) {
        // Criar cliente novo
        await db.insert(schema.oauthClients).values({
          clientId: client.clientId,
          clientSecret: client.clientSecret,
          nome: client.nome,
          descricao: client.descricao,
          redirectUris: client.redirectUris,
          scopes: client.scopes,
          grantTypes: ['authorization_code', 'refresh_token'],
          tokenEndpointAuthMethod: client.clientId === 'grafana-sso' ? 'client_secret_basic' : 'client_secret_post',
          accessTokenTtl: 3600,
          refreshTokenTtl: 86400,
          autoConsent: true,
          ativo: true,
        });

        logger.info(
          { clientId: client.clientId, secretPrefix: client.clientSecret.substring(0, 8) + '...' },
          'Cliente OAuth criado no startup'
        );
      } else {
        // Atualizar cliente existente (idempotente)
        await db.update(schema.oauthClients)
          .set({
            clientSecret: client.clientSecret,
            nome: client.nome,
            descricao: client.descricao,
            redirectUris: client.redirectUris,
            scopes: client.scopes,
            ativo: true,
            atualizadoEm: new Date(),
          })
          .where(eq(schema.oauthClients.clientId, client.clientId));

        logger.info(
          { clientId: client.clientId, secretPrefix: client.clientSecret.substring(0, 8) + '...' },
          'Cliente OAuth atualizado no startup'
        );
      }
    } catch (error) {
      logger.error({ error, clientId: client.clientId }, 'Falha ao criar/atualizar cliente OAuth');
    }
  }

  logger.info('Seed de clientes OAuth concluído - SSO 100% automatizado');
}

// ============================================================================
// PROMETHEUS: Instrumentação de métricas (Regra 16 - Observability Enterprise)
// ============================================================================
const { metrics, metricsRouter, httpMetricsMiddleware } = createAlicePrometheus({
  serviceName: 'auth-service',
  collectDefaultMetrics: true,
});

// Inicializar métricas RBAC (Regra 16 - Observability Enterprise)
initRbacPrometheusMetrics(metrics.rbac);
logger.info('Métricas RBAC Prometheus inicializadas no auth-service');

// Endpoint /metrics para Prometheus scraper (antes de outros middlewares)
app.use(metricsRouter);

// ============================================================================
// OPENAPI/SWAGGER: Documentação da API (OWASP API9 - Improper Inventory Management)
// ============================================================================
setupSwaggerUI(app, {
  serviceName: 'auth-service',
  version: '1.0.0',
  description: 'Serviço de autenticação enterprise com OAuth 2.0, SAML 2.0, OIDC e RBAC.',
  port: config.PORT ?? 3001,
  tags: AUTH_SERVICE_TAGS,
  paths: authServicePaths,
  schemas: authServiceSchemas,
});
logger.info('Swagger UI configurado em /api/docs');

// Middleware para coletar métricas HTTP automaticamente
app.use(httpMetricsMiddleware);

// SEGURANÇA: Desabilitar X-Powered-By header (Express.js 2025 + OWASP API8)
app.disable('x-powered-by');

// SEGURANÇA: Trust proxy = 1 para confiar apenas no primeiro proxy (Traefik)
// Evita bypass de rate limiting (express-rate-limit 2025 best practice)
app.set('trust proxy', 1);

// SEGURANÇA: Helmet com CSP/HSTS enterprise (Express.js 2025 + OWASP 2023)
app.use(createSecurityMiddleware({
  contentSecurityPolicy: config.NODE_ENV === 'production',
  isDevelopment: config.NODE_ENV !== 'production',
}));

// OBSERVABILITY: Correlation ID middleware para rastreamento distribuído (Node.js 20 LTS 2025)
// Propaga correlation IDs entre microsserviços e injeta nos logs automaticamente
app.use(createCorrelationMiddleware({ serviceName: 'auth-service' }));

// PERFORMANCE: Compression para reduzir tamanho de respostas (Express.js 2025)
app.use(compression());

// SEGURANÇA: Rate limiting multi-tenant (express-rate-limit 2025)
app.use(createRateLimiter({
  windowMs: 60 * 1000,
  max: 100,
  skipRoutes: ['/api/auth/health', '/api/auth/google', '/api/auth/github', '/api/auth/saml'],
  serviceName: 'auth-service',
}));

// NOTA: Helmet já aplicado via createSecurityMiddleware() acima

// CORS configurado para desenvolvimento e produção
// REGRA 6: Consistência com api-gateway - aceitar CORS_ORIGIN ou CORS_ORIGINS
// CORS_ORIGIN = valor ÚNICO (origem principal); CORS_ORIGINS = lista separada por vírgula
const corsOriginEnv = process.env.CORS_ORIGIN?.trim();
const corsOriginsEnv = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? [];
if (!corsOriginEnv && corsOriginsEnv.length === 0 && process.env.NODE_ENV === 'production') {
  logger.error('CORS_ORIGIN ou CORS_ORIGINS são obrigatórios em produção (Regra 6 - fail-fast)');
  process.exit(1);
}
// Combinar ambas as fontes de configuração e deduplicar
// PADRÃO CONSISTENTE COM api-gateway: CORS_ORIGIN é valor único, CORS_ORIGINS é lista
const allOrigins = [
  ...(corsOriginEnv ? [corsOriginEnv] : []),
  ...corsOriginsEnv,
].filter((o): o is string => Boolean(o));
const corsOrigins = allOrigins.length > 0
  ? [...new Set(allOrigins)] // Deduplicar usando Set
  : ['http://localhost:5000'];
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
}));

// SEGURANÇA: Limites de payload para prevenir DoS (OWASP API4)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Configuração de sessão com PostgreSQL
const PgSession = connectPgSimple(session);
const pool = getPool();

// Configuração de sessão com PostgreSQL (Regra 16 - Segurança Enterprise)
app.use(session({
  store: new PgSession({
    pool,
    tableName: 'sessions',
    createTableIfMissing: true,
  }),
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    // CORREÇÃO SEGURANÇA: secure=true SEMPRE em produção
    secure: config.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
    // CORREÇÃO SEGURANÇA: sameSite=strict para prevenir CSRF
    sameSite: config.NODE_ENV === 'production' ? 'strict' : 'lax',
  },
  name: 'alice.sid',
}));

// Inicializar Passport
app.use(passport.initialize());
app.use(passport.session());

// Proteção CSRF em rotas mutating (após sessão estar disponível)
app.use(csrfProtection);

// Serialização de usuário para sessão
passport.serializeUser((user: Express.User, done) => {
  done(null, user.userId);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const db = getDatabase();
    const dbUser = await db.query.users.findFirst({
      where: eq(schema.users.id, id),
    });
    if (!dbUser) {
      return done(null, null);
    }
    const authContext = await buildAuthContext(dbUser);
    done(null, authContext);
  } catch (error) {
    logger.error({ error, userId: id }, 'Erro ao deserializar usuário');
    done(error, null);
  }
});

// URL base para callbacks OAuth
// Produção: Hetzner Cloud (yesyoudeserve.duckdns.org)
const normalizeBaseUrl = (value: string): string => {
  return value.trim().replace(/\/+$/, '');
};

const getBaseUrl = (): string => {
  // Prioridade: BASE_URL definida explicitamente
  if (process.env.BASE_URL) {
    return normalizeBaseUrl(process.env.BASE_URL);
  }
  // Produção Hetzner
  if (process.env.NODE_ENV === 'production') {
    return 'https://yesyoudeserve.duckdns.org';
  }
  // Desenvolvimento local
  return 'http://localhost:5000';
};

const getCallbackPath = (callbackUrl: string, fallbackPath: string): string => {
  if (!callbackUrl) {
    return fallbackPath;
  }
  if (callbackUrl.startsWith('/')) {
    return callbackUrl;
  }
  try {
    return new URL(callbackUrl).pathname || fallbackPath;
  } catch {
    return fallbackPath;
  }
};

const getGoogleCallbackUrl = (): string => {
  const oauthCallback = process.env.OAUTH_CALLBACK_URL?.trim();
  if (oauthCallback) {
    const isPathOnly = oauthCallback.startsWith('/');
    if (isPathOnly) {
      const baseUrl = getBaseUrl();
      const resolved = `${baseUrl}${oauthCallback}`;
      if (!oauthCallback.startsWith('/api/auth/google/callback')) {
        logger.warn({ oauthCallback }, 'OAUTH_CALLBACK_URL fora do padrão /api/auth/google/callback');
      }
      return resolved;
    }
    try {
      const parsed = new URL(oauthCallback);
      if (!parsed.pathname.startsWith('/api/auth/google/callback')) {
        logger.warn({ oauthCallback }, 'OAUTH_CALLBACK_URL fora do padrão /api/auth/google/callback');
      }
      return parsed.toString();
    } catch (error) {
      logger.warn({ oauthCallback, error }, 'OAUTH_CALLBACK_URL inválido; usando callback padrão');
      return `${getBaseUrl()}/api/auth/google/callback`;
    }
  }
  return `${getBaseUrl()}/api/auth/google/callback`;
};

// ============================================================================
// MÉTRICAS DE AUTENTICAÇÃO (Prometheus + Legacy)
// Monitoramento de resiliência para provedores OAuth/SAML
// ============================================================================

// Métricas Prometheus customizadas para autenticação
// Usar metrics.registry do createAlicePrometheus para métricas adicionais
const authAttemptsCounter = new PromCounter({
  name: 'alice_auth_attempts_total',
  help: 'Total de tentativas de autenticação',
  labelNames: ['provider', 'status'] as const,
  registers: [metrics.registry],
});

// NOTA: Métrica de sessões ativas removida - requer implementação com Redis pub/sub
// para contagem precisa de sessões distribuídas; pendente de requisito específico.

const authMetrics = {
  attempts: { google: 0, github: 0, saml: 0, local: 0 },
  successes: { google: 0, github: 0, saml: 0, local: 0 },
  failures: { google: 0, github: 0, saml: 0, local: 0 },
  lastSuccess: { google: null, github: null, saml: null, local: null } as Record<string, Date | null>,
  lastFailure: { google: null, github: null, saml: null, local: null } as Record<string, Date | null>,
};

function recordAuthAttempt(provider: 'google' | 'github' | 'saml' | 'local', success: boolean): void {
  authMetrics.attempts[provider]++;
  
  // Prometheus metrics
  authAttemptsCounter.inc({ provider, status: success ? 'success' : 'failure' });
  
  if (success) {
    authMetrics.successes[provider]++;
    authMetrics.lastSuccess[provider] = new Date();
  } else {
    authMetrics.failures[provider]++;
    authMetrics.lastFailure[provider] = new Date();
  }
  logger.info({ provider, success, attempts: authMetrics.attempts[provider] }, 'Tentativa de autenticação registrada');
}

// ============================================================================
// CIRCUIT BREAKERS: Proteção contra falhas em cascata (Regra 16 - Best Practices 2025)
// 
// Implementação enterprise-grade de circuit breakers para:
// - Operações de banco de dados (PostgreSQL)
// - Provedores OAuth externos (Google, GitHub)
// - Provedores SAML/IdP (Azure AD, Okta)
// 
// Documentação: opossum (Netflix Hystrix pattern para Node.js)
// ============================================================================

// Circuit Breaker para operações de banco de dados (busca de usuário)
const dbUserLookupBreaker = createCircuitBreaker(
  async (email: string): Promise<DbUser | undefined> => {
    const db = getDatabase();
    return db.query.users.findFirst({
      where: eq(schema.users.email, email.toLowerCase()),
    });
  },
  {
    name: 'auth-db-user-lookup',
    ...CIRCUIT_BREAKER_PRESETS.databasePool,
  }
);

// Instrumentar circuit breaker com métricas Prometheus
instrumentCircuitBreaker(metrics, 'auth_db_user_lookup', dbUserLookupBreaker);

// Circuit Breaker para operações de banco de dados (busca por OAuth ID)
// NOTA: Usa preset databasePool porque é operação de DB, não chamada externa OAuth
const dbOAuthLookupBreaker = createCircuitBreaker(
  async (params: { googleId?: string; githubId?: string; email: string }): Promise<DbUser | undefined> => {
    const db = getDatabase();
    const conditions = [];
    if (params.googleId) {
      conditions.push(eq(schema.users.googleId, params.googleId));
    }
    if (params.githubId) {
      conditions.push(eq(schema.users.githubId, params.githubId));
    }
    // Sempre adiciona email como fallback, garantindo que conditions nunca está vazio
    conditions.push(eq(schema.users.email, params.email.toLowerCase()));
    
    return db.query.users.findFirst({
      where: or(...conditions),
    });
  },
  {
    name: 'auth-db-oauth-lookup',
    ...CIRCUIT_BREAKER_PRESETS.databasePool,
  }
);

instrumentCircuitBreaker(metrics, 'auth_db_oauth_lookup', dbOAuthLookupBreaker);

// Circuit Breaker para operações de banco de dados (busca por SAML nameID)
// NOTA: Usa preset databasePool porque é operação de DB, não chamada externa SAML/IdP
const dbSamlLookupBreaker = createCircuitBreaker(
  async (params: { samlNameId: string; email: string }): Promise<DbUser | undefined> => {
    const db = getDatabase();
    return db.query.users.findFirst({
      where: or(
        eq(schema.users.samlNameId, params.samlNameId),
        eq(schema.users.email, params.email.toLowerCase())
      ),
    });
  },
  {
    name: 'auth-db-saml-lookup',
    ...CIRCUIT_BREAKER_PRESETS.databasePool,
  }
);

instrumentCircuitBreaker(metrics, 'auth_db_saml_lookup', dbSamlLookupBreaker);

// Circuit Breaker para operações de criação/atualização de usuário
const dbUserUpsertBreaker = createCircuitBreaker(
  async (operation: () => Promise<DbUser[]>): Promise<DbUser[]> => {
    return operation();
  },
  {
    name: 'auth-db-user-upsert',
    ...CIRCUIT_BREAKER_PRESETS.databasePool,
  }
);

instrumentCircuitBreaker(metrics, 'auth_db_user_upsert', dbUserUpsertBreaker);

logger.info('Circuit breakers de autenticação inicializados (OAuth, SAML, Database)');

// ============================================================================
// ESTRATÉGIA: Autenticação Local (Email/Senha)
// ============================================================================

passport.use(new LocalStrategy(
  {
    usernameField: 'email',
    passwordField: 'password',
  },
  async (email, password, done) => {
    try {
      // Usar circuit breaker para busca de usuário (Regra 16 - Resiliência)
      const user = await dbUserLookupBreaker.fire(email);

      if (!user) {
        recordAuthAttempt('local', false);
        logger.warn({ email }, 'Tentativa de login com email não encontrado');
        return done(null, false, { message: 'Credenciais inválidas' });
      }

      if (!user.passwordHash) {
        recordAuthAttempt('local', false);
        logger.warn({ email }, 'Usuário sem senha configurada (OAuth only)');
        return done(null, false, { message: 'Use o provedor de login original' });
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        recordAuthAttempt('local', false);
        logger.warn({ email }, 'Senha incorreta');
        return done(null, false, { message: 'Credenciais inválidas' });
      }

      // Atualizar último acesso com circuit breaker
      const db = getDatabase();
      await dbUserUpsertBreaker.fire(async () => {
        await db.update(schema.users)
          .set({ ultimoAcesso: new Date() })
          .where(eq(schema.users.id, user.id));
        return [user];
      });

      recordAuthAttempt('local', true);
      logger.info({ userId: user.id, email }, 'Login local bem-sucedido');
      const authContext = await buildAuthContext(user);
      return done(null, authContext);
    } catch (error) {
      recordAuthAttempt('local', false);
      // Tratamento específico para circuit breaker aberto
      if ((error as Error).message?.includes('Breaker is open')) {
        logger.error({ email }, 'Circuit breaker aberto - serviço de banco de dados indisponível');
        return done(new Error('Serviço temporariamente indisponível. Tente novamente em alguns segundos.'));
      }
      logger.error({ error, email }, 'Erro na autenticação local');
      return done(error);
    }
  }
));

// ============================================================================
// ESTRATÉGIA: OAuth Google
// ============================================================================

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleCallbackUrl = getGoogleCallbackUrl();
const googleCallbackPath = getCallbackPath(googleCallbackUrl, '/api/auth/google/callback');

if (googleClientId && googleClientSecret) {
  passport.use(new GoogleStrategy(
    {
      clientID: googleClientId,
      clientSecret: googleClientSecret,
      callbackURL: googleCallbackUrl,
      scope: ['profile', 'email'],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const db = getDatabase();
        const email = profile.emails?.[0]?.value?.toLowerCase();
        const googleId = profile.id;

        if (!email) {
          recordAuthAttempt('google', false);
          logger.error({ googleId }, 'Email não encontrado no perfil Google');
          return done(new Error('Email não disponível no perfil Google'));
        }

        // Usar circuit breaker para busca de usuário OAuth (Regra 16 - Resiliência)
        let user = await dbOAuthLookupBreaker.fire({ googleId, email });

        if (!user) {
          // BUG FIX 13/01/2026: Obter tenant default para associar novo usuário
          // BUG FIX 13/01/2026 (Race Condition): Criar tenant se não existir com onConflictDoNothing
          let defaultTenant = await db.query.tenants.findFirst({
            where: eq(schema.tenants.slug, 'alice-platform'),
          });
          
          if (!defaultTenant) {
            logger.warn('Tenant default não encontrado durante OAuth Google, criando...');
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
              // Conflito - tenant já existe, buscar novamente
              defaultTenant = await db.query.tenants.findFirst({
                where: eq(schema.tenants.slug, 'alice-platform'),
              });
            } else {
              defaultTenant = inserted[0];
            }
            
            if (!defaultTenant) {
              logger.error('Tenant default não encontrado após insert+query - crítico');
              return done(new Error('Configuração do sistema incompleta'));
            }
          }
          
          // Criar novo usuário com circuit breaker
          const [newUser] = await dbUserUpsertBreaker.fire(async () => {
            return db.insert(schema.users).values({
              email,
              firstName: profile.name?.givenName || profile.displayName?.split(' ')[0],
              lastName: profile.name?.familyName || profile.displayName?.split(' ').slice(1).join(' '),
              profileImageUrl: profile.photos?.[0]?.value,
              googleId,
              authProvider: 'google',
              emailVerified: true,
              role: 'guest',
              idioma: 'pt-BR',
              timezone: 'Europe/Lisbon',
              tenantId: defaultTenant.id, // BUG FIX 13/01/2026: SEMPRE associar a um tenant
            }).returning();
          });
          user = newUser;
          const createdUserId = user.id;
          await db.insert(schema.userRoles).values({
            userId: createdUserId,
            role: 'guest',
          }).onConflictDoNothing();

          logger.info({ userId: createdUserId, email }, 'Novo usuário criado via Google');
          
          // Identity Provisioning: Sincronizar usuário com Grafana/ERPNext
          publishProvisioningEvent('user.created', {
            userId: user.id,
            email: user.email || email,
            firstName: user.firstName || undefined,
            lastName: user.lastName || undefined,
            role: user.role || 'guest',
            tenantId: user.tenantId || undefined,
          }).catch((error: unknown) => {
            logger.error({ error, userId: createdUserId }, 'Erro ao publicar evento de provisioning');
          });
        } else if (!user.googleId) {
          // Vincular conta Google existente com circuit breaker
          await dbUserUpsertBreaker.fire(async () => {
            await db.update(schema.users)
              .set({ 
                googleId,
                profileImageUrl: user!.profileImageUrl || profile.photos?.[0]?.value,
                emailVerified: true,
                ultimoAcesso: new Date(),
              })
              .where(eq(schema.users.id, user!.id));
            return [user!];
          });
          logger.info({ userId: user.id, email }, 'Conta Google vinculada a usuário existente');
        } else {
          // Atualizar último acesso com circuit breaker
          await dbUserUpsertBreaker.fire(async () => {
            await db.update(schema.users)
              .set({ ultimoAcesso: new Date() })
              .where(eq(schema.users.id, user!.id));
            return [user!];
          });
        }

        recordAuthAttempt('google', true);
        const authContext = await buildAuthContext(user);
        return done(null, authContext);
      } catch (error) {
        recordAuthAttempt('google', false);
        // Tratamento específico para circuit breaker aberto
        if ((error as Error).message?.includes('Breaker is open')) {
          logger.error({ provider: 'google' }, 'Circuit breaker aberto - serviço de autenticação indisponível');
          return done(new Error('Serviço temporariamente indisponível. Tente novamente em alguns segundos.'));
        }
        logger.error({ error }, 'Erro na autenticação Google');
        return done(error as Error);
      }
    }
  ));
  logger.info('OAuth Google configurado com circuit breaker');
} else {
  logger.warn('OAuth Google não configurado - GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET ausentes');
}

// ============================================================================
// ESTRATÉGIA: OAuth GitHub
// ============================================================================

const githubClientId = process.env.OAUTH_GITHUB_CLIENT_ID ?? process.env.GITHUB_CLIENT_ID;
const githubClientSecret = process.env.OAUTH_GITHUB_CLIENT_SECRET ?? process.env.GITHUB_CLIENT_SECRET;

if (githubClientId && githubClientSecret) {
  passport.use(new GitHubStrategy(
    {
      clientID: githubClientId,
      clientSecret: githubClientSecret,
      callbackURL: `${getBaseUrl()}/api/auth/github/callback`,
      scope: ['user:email'],
    },
    async (accessToken: string, refreshToken: string, profile: { id: string; displayName?: string; username?: string; emails?: { value: string }[]; photos?: { value: string }[] }, done: (error: Error | null, user?: Express.User) => void) => {
      try {
        const db = getDatabase();
        const email = profile.emails?.[0]?.value?.toLowerCase();
        const githubId = profile.id;

        if (!email) {
          recordAuthAttempt('github', false);
          logger.error({ githubId }, 'Email não encontrado no perfil GitHub');
          return done(new Error('Email não disponível no perfil GitHub'));
        }

        // Usar circuit breaker para busca de usuário OAuth (Regra 16 - Resiliência)
        let user = await dbOAuthLookupBreaker.fire({ githubId, email });

        if (!user) {
          // BUG FIX 13/01/2026: Obter tenant default para associar novo usuário
          // BUG FIX 13/01/2026 (Race Condition): Criar tenant se não existir com onConflictDoNothing
          let defaultTenant = await db.query.tenants.findFirst({
            where: eq(schema.tenants.slug, 'alice-platform'),
          });
          
          if (!defaultTenant) {
            logger.warn('Tenant default não encontrado durante OAuth GitHub, criando...');
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
              // Conflito - tenant já existe, buscar novamente
              defaultTenant = await db.query.tenants.findFirst({
                where: eq(schema.tenants.slug, 'alice-platform'),
              });
            } else {
              defaultTenant = inserted[0];
            }
            
            if (!defaultTenant) {
              logger.error('Tenant default não encontrado após insert+query - crítico');
              return done(new Error('Configuração do sistema incompleta'));
            }
          }
          
          // Criar novo usuário com circuit breaker
          const displayName = profile.displayName || profile.username || '';
          const [newUser] = await dbUserUpsertBreaker.fire(async () => {
            return db.insert(schema.users).values({
              email,
              firstName: displayName.split(' ')[0],
              lastName: displayName.split(' ').slice(1).join(' ') || null,
              profileImageUrl: profile.photos?.[0]?.value,
              githubId,
              authProvider: 'github',
              emailVerified: true,
              role: 'guest',
              idioma: 'pt-BR',
              timezone: 'Europe/Lisbon',
              tenantId: defaultTenant.id, // BUG FIX 13/01/2026: SEMPRE associar a um tenant
            }).returning();
          });
          user = newUser;
          const createdUserId = user.id;
          await db.insert(schema.userRoles).values({
            userId: createdUserId,
            role: 'guest',
          }).onConflictDoNothing();

          logger.info({ userId: createdUserId, email }, 'Novo usuário criado via GitHub');
          
          // Identity Provisioning: Sincronizar usuário com Grafana/ERPNext
          publishProvisioningEvent('user.created', {
            userId: user.id,
            email: user.email || email,
            firstName: user.firstName || undefined,
            lastName: user.lastName || undefined,
            role: user.role || 'guest',
            tenantId: user.tenantId || undefined,
          }).catch((error: unknown) => {
            logger.error({ error, userId: createdUserId }, 'Erro ao publicar evento de provisioning');
          });
        } else if (!user.githubId) {
          // Vincular conta GitHub existente com circuit breaker
          await dbUserUpsertBreaker.fire(async () => {
            await db.update(schema.users)
              .set({ 
                githubId,
                profileImageUrl: user!.profileImageUrl || profile.photos?.[0]?.value,
                emailVerified: true,
                ultimoAcesso: new Date(),
              })
              .where(eq(schema.users.id, user!.id));
            return [user!];
          });
          logger.info({ userId: user.id, email }, 'Conta GitHub vinculada a usuário existente');
        } else {
          // Atualizar último acesso com circuit breaker
          await dbUserUpsertBreaker.fire(async () => {
            await db.update(schema.users)
              .set({ ultimoAcesso: new Date() })
              .where(eq(schema.users.id, user!.id));
            return [user!];
          });
        }

        recordAuthAttempt('github', true);
        const authContext = await buildAuthContext(user);
        return done(null, authContext);
      } catch (error) {
        recordAuthAttempt('github', false);
        // Tratamento específico para circuit breaker aberto
        if ((error as Error).message?.includes('Breaker is open')) {
          logger.error({ provider: 'github' }, 'Circuit breaker aberto - serviço de autenticação indisponível');
          return done(new Error('Serviço temporariamente indisponível. Tente novamente em alguns segundos.'));
        }
        logger.error({ error }, 'Erro na autenticação GitHub');
        return done(error as Error);
      }
    }
  ));
  logger.info('OAuth GitHub configurado com circuit breaker');
} else {
  logger.warn('OAuth GitHub não configurado - OAUTH_GITHUB_CLIENT_ID/GITHUB_CLIENT_ID ou OAUTH_GITHUB_CLIENT_SECRET/GITHUB_CLIENT_SECRET ausentes');
}

// ============================================================================
// ESTRATÉGIA: SAML 2.0 (Azure AD, Okta)
// ============================================================================

const samlEntryPoint = process.env.SAML_ENTRY_POINT;
const samlIssuer = process.env.SAML_ISSUER;
const samlCert = process.env.SAML_CERT;

if (samlEntryPoint && samlIssuer && samlCert) {
  passport.use('saml', new SamlStrategy(
    {
      entryPoint: samlEntryPoint,
      issuer: samlIssuer,
      callbackUrl: `${getBaseUrl()}/api/auth/saml/callback`,
      idpCert: samlCert,
      wantAssertionsSigned: true,
      signatureAlgorithm: 'sha256',
      digestAlgorithm: 'sha256',
    },
    async (profile: SamlProfile | null | undefined, done: VerifiedCallback) => {
      try {
        if (!profile) {
          recordAuthAttempt('saml', false);
          logger.error('Perfil SAML não disponível');
          return done(new Error('Perfil SAML não disponível'));
        }

        const db = getDatabase();
        const profileEmail = profile.email as string | undefined;
        const email = (profileEmail || profile.nameID || '').toLowerCase();
        const samlNameId = profile.nameID || '';

        if (!email) {
          recordAuthAttempt('saml', false);
          logger.error({ samlNameId }, 'Email não encontrado no perfil SAML');
          return done(new Error('Email não disponível no perfil SAML'));
        }

        // Usar circuit breaker para busca de usuário SAML (Regra 16 - Resiliência)
        let user = await dbSamlLookupBreaker.fire({ samlNameId, email });

        if (!user) {
          // BUG FIX 13/01/2026: Obter tenant default para associar novo usuário
          // BUG FIX 13/01/2026 (Race Condition): Criar tenant se não existir com onConflictDoNothing
          let defaultTenant = await db.query.tenants.findFirst({
            where: eq(schema.tenants.slug, 'alice-platform'),
          });
          
          if (!defaultTenant) {
            logger.warn('Tenant default não encontrado durante SAML auth, criando...');
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
              // Conflito - tenant já existe, buscar novamente
              defaultTenant = await db.query.tenants.findFirst({
                where: eq(schema.tenants.slug, 'alice-platform'),
              });
            } else {
              defaultTenant = inserted[0];
            }
            
            if (!defaultTenant) {
              logger.error('Tenant default não encontrado após insert+query - crítico');
              return done(new Error('Configuração do sistema incompleta'));
            }
          }
          
          // Criar novo usuário com circuit breaker
          const displayName = typeof profile.displayName === 'string' ? profile.displayName : '';
          const firstName = (profile.firstName as string) || displayName.split(' ')[0] || '';
          const lastName = (profile.lastName as string) || displayName.split(' ').slice(1).join(' ') || '';
          
          const [newUser] = await dbUserUpsertBreaker.fire(async () => {
            return db.insert(schema.users).values({
              email,
              firstName: firstName || null,
              lastName: lastName || null,
              samlNameId,
              authProvider: 'saml',
              emailVerified: true,
              role: 'guest',
              idioma: 'pt-BR',
              timezone: 'Europe/Lisbon',
              tenantId: defaultTenant.id, // BUG FIX 13/01/2026: SEMPRE associar a um tenant
            }).returning();
          });
          user = newUser;
          const createdUserId = user.id;
          await db.insert(schema.userRoles).values({
            userId: createdUserId,
            role: 'guest',
          }).onConflictDoNothing();

          logger.info({ userId: createdUserId, email }, 'Novo usuário criado via SAML');
          
          // Identity Provisioning: Sincronizar usuário com Grafana/ERPNext
          publishProvisioningEvent('user.created', {
            userId: user.id,
            email: user.email || email,
            firstName: user.firstName || undefined,
            lastName: user.lastName || undefined,
            role: user.role || 'guest',
            tenantId: user.tenantId || undefined,
          }).catch((error: unknown) => {
            logger.error({ error, userId: createdUserId }, 'Erro ao publicar evento de provisioning');
          });
        } else if (!user.samlNameId) {
          // Vincular conta SAML existente com circuit breaker
          await dbUserUpsertBreaker.fire(async () => {
            await db.update(schema.users)
              .set({ 
                samlNameId,
                emailVerified: true,
                ultimoAcesso: new Date(),
              })
              .where(eq(schema.users.id, user!.id));
            return [user!];
          });
          logger.info({ userId: user.id, email }, 'Conta SAML vinculada a usuário existente');
        } else {
          // Atualizar último acesso com circuit breaker
          await dbUserUpsertBreaker.fire(async () => {
            await db.update(schema.users)
              .set({ ultimoAcesso: new Date() })
              .where(eq(schema.users.id, user!.id));
            return [user!];
          });
        }

        recordAuthAttempt('saml', true);
        const authContext = await buildAuthContext(user);
        return done(null, authContext as unknown as Record<string, unknown>);
      } catch (error) {
        recordAuthAttempt('saml', false);
        // Tratamento específico para circuit breaker aberto
        if ((error as Error).message?.includes('Breaker is open')) {
          logger.error({ provider: 'saml' }, 'Circuit breaker aberto - serviço de autenticação indisponível');
          return done(new Error('Serviço temporariamente indisponível. Tente novamente em alguns segundos.'));
        }
        logger.error({ error }, 'Erro na autenticação SAML');
        return done(error as Error);
      }
    },
    () => { /* logout callback - não usado */ }
  ));
  logger.info('SAML 2.0 configurado com circuit breaker');
} else {
  logger.warn('SAML 2.0 não configurado - SAML_ENTRY_POINT, SAML_ISSUER ou SAML_CERT ausentes');
}

// ============================================================================
// ROTAS: Health Check
// ============================================================================

app.get('/api/auth/health', (_req: Request, res: Response) => {
  const configuredProviders = {
    local: true,
    google: !!googleClientId,
    github: !!githubClientId,
    saml: !!(samlEntryPoint && samlIssuer && samlCert),
  };

  const totalConfigured = Object.values(configuredProviders).filter(Boolean).length;

  res.json({ 
    status: 'ok', 
    service: 'auth-service', 
    timestamp: new Date().toISOString(),
    providers: configuredProviders,
    metrics: {
      totalProvidersConfigured: totalConfigured,
      attempts: authMetrics.attempts,
      successes: authMetrics.successes,
      failures: authMetrics.failures,
      lastSuccess: authMetrics.lastSuccess,
      lastFailure: authMetrics.lastFailure,
    },
    note: 'OAuth/SAML usam redirecionamentos HTTP do navegador - circuit breakers não são aplicáveis para fluxos de redirecionamento',
  });
});

// ============================================================================
// KUBERNETES PROBES: /ready e /live (Regra 16 - Best Practices 2025)
// /live: Processo está vivo? Se não, Kubernetes reinicia o container
// /ready: Pronto para tráfego? Verifica conexão com PostgreSQL
// ============================================================================

// Liveness probe - verificação simples que o processo responde
app.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ 
    status: 'alive', 
    service: 'auth-service',
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe - verifica se PostgreSQL está acessível
app.get('/ready', async (_req: Request, res: Response) => {
  try {
    const dbHealthy = await isPoolHealthy();
    
    if (dbHealthy) {
      res.status(200).json({
        status: 'ready',
        service: 'auth-service',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgresql: 'ready',
        },
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        service: 'auth-service',
        reason: 'PostgreSQL não está acessível',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgresql: 'not_ready',
        },
      });
    }
  } catch (error) {
    logger.error({ error }, 'Erro ao verificar readiness');
    res.status(503).json({
      status: 'not_ready',
      service: 'auth-service',
      reason: 'Erro ao verificar dependências',
      timestamp: new Date().toISOString(),
    });
  }
});

// ============================================================================
// ROTAS: Usuário Atual
// ============================================================================

app.get('/api/auth/user', async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  try {
    const db = getDatabase();
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, req.user.userId),
      with: {
        tenant: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // Gerar/obter CSRF token para a sessão (Regra 16 - Segurança Enterprise)
    const csrfToken = getOrCreateCsrfToken(req.session);

    // Remover campos sensíveis (prefixo _ indica variável descartada intencionalmente)
    const { passwordHash: _passwordHash, ...safeUser } = user;
    
    // Incluir CSRF token no response para o frontend usar em mutations
    res.json({ 
      user: safeUser,
      csrfToken,
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar usuário');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// SCHEMAS ZOD: Validação de Autenticação (OWASP API3 - Input Validation)
// ============================================================================

// Schema para registro de usuário
const registerSchema = z.object({
  email: z.string()
    .email('Email inválido')
    .max(255, 'Email muito longo')
    .transform(v => v.toLowerCase().trim()),
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

// Schema para login
const loginSchema = z.object({
  email: z.string()
    .email('Email inválido')
    .transform(v => v.toLowerCase().trim()),
  password: z.string()
    .min(1, 'Senha é obrigatória'),
});

// ============================================================================
// ROTAS: Autenticação Local
// ============================================================================

app.post('/api/auth/register', requireAuth(), requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  // Validação Zod (OWASP API3 - Injection Prevention)
  const parseResult = registerSchema.safeParse(req.body);
  
  if (!parseResult.success) {
    const errors = parseResult.error.errors.map(e => e.message);
    return res.status(400).json({ 
      error: 'Dados de registro inválidos', 
      details: errors,
    });
  }

  const { email, password, firstName, lastName, cargo, departamento, telefone, preferredName } = parseResult.data;

  const db = getDatabase();
  
  // Verificar se email já existe
  const existingUser = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });

  if (existingUser) {
    return res.status(409).json({ error: 'Email já cadastrado' });
  }

  // Hash da senha com bcrypt (custo 12 para segurança enterprise)
  const passwordHash = await bcrypt.hash(password, 12);

  // BUG FIX 13/01/2026: Obter tenant default para associar novo usuário
  // BUG FIX 13/01/2026 (Race Condition): Criar tenant se não existir com onConflictDoNothing
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
      // Conflito - tenant já existe, buscar novamente
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

  // Criar novo usuário
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
    timezone: 'Europe/Lisbon',
    tenantId: defaultTenant.id, // BUG FIX 13/01/2026: SEMPRE associar a um tenant
  }).returning();

  await db.insert(schema.userRoles).values({
    userId: newUser.id,
    role: 'guest',
  }).onConflictDoNothing();

  logger.info({ userId: newUser.id, email }, 'Novo usuário registrado');

  // Identity Provisioning: Sincronizar usuário com Grafana/ERPNext
  publishProvisioningEvent('user.created', {
    userId: newUser.id,
    email: newUser.email || email,
    firstName: newUser.firstName || undefined,
    lastName: newUser.lastName || undefined,
    role: newUser.role || 'guest',
    tenantId: newUser.tenantId || undefined,
  }).catch((error) => {
    // Log error mas não falhar a requisição principal
    logger.error({ error, userId: newUser.id }, 'Erro ao publicar evento de provisioning');
  });

  // Remover campos sensíveis
  const { passwordHash: _, ...safeUser } = newUser;
  res.status(201).json({ user: safeUser, message: 'Conta criada com sucesso' });
}));

// Rate limiting para login - 5 tentativas por minuto por IP (Regra 16 - Proteção Brute-force)
// CORREÇÃO 23/12/2025: express-rate-limit 8.x requer validação IPv6 explícita
// Usando validate.keyGeneratorIpFallback: false pois combinamos IP+email (não IP puro)
const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 5, // 5 tentativas por minuto
  message: { error: 'Muitas tentativas de login. Aguarde 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Usar IP + email para evitar bloqueio de IP compartilhado
    // IP é tratado como parte da chave composta, não como chave única
    const email = req.body?.email || '';
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return `${ip}-${email}`;
  },
  validate: {
    // Desabilitar validação IPv6 pois usamos chave composta IP+email
    // A validação é para casos onde IP é usado sozinho como chave
    keyGeneratorIpFallback: false,
  },
});

// Middleware de validação Zod para login (OWASP API3)
const validateLogin = (req: Request, res: Response, next: NextFunction) => {
  const parseResult = loginSchema.safeParse(req.body);
  
  if (!parseResult.success) {
    const errors = parseResult.error.errors.map(e => e.message);
    return res.status(400).json({ 
      error: 'Dados de login inválidos', 
      details: errors,
    });
  }
  
  // Substituir body com dados validados/normalizados
  req.body = parseResult.data;
  next();
};

app.post('/api/auth/login', loginRateLimiter, validateLogin, passport.authenticate('local'), (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Falha na autenticação' });
  }
  
  res.json({ user: req.user });
});

// ============================================================================
// ROTAS: OAuth Google
// ============================================================================

if (googleClientId) {
  app.get('/api/auth/google', passport.authenticate('google', {
    scope: ['profile', 'email'],
  }));

  const googleCallbackHandler = passport.authenticate('google', {
    failureRedirect: '/login?error=google_auth_failed',
    successRedirect: '/dashboard',
  });

  const googleCallbackPaths = new Set([
    googleCallbackPath,
    '/api/auth/google/callback',
    '/api/auth/google/callback/',
  ]);

  for (const path of googleCallbackPaths) {
    if (!path) continue;
    app.get(path, googleCallbackHandler);
  }
}

// ============================================================================
// ROTAS: OAuth GitHub
// ============================================================================

if (githubClientId) {
  app.get('/api/auth/github', passport.authenticate('github', {
    scope: ['user:email']
  }));

  app.get('/api/auth/github/callback',
    passport.authenticate('github', {
      failureRedirect: '/login?error=github_auth_failed',
      successRedirect: '/dashboard'
    })
  );
}

// ============================================================================
// ROTAS: SAML 2.0 (Azure AD, Okta)
// ============================================================================

if (samlEntryPoint && samlIssuer && samlCert) {
  app.get('/api/auth/saml', passport.authenticate('saml'));

  app.post('/api/auth/saml/callback',
    passport.authenticate('saml', {
      failureRedirect: '/login?error=saml_auth_failed',
      successRedirect: '/dashboard'
    })
  );

  app.get('/api/auth/saml/metadata', (req: Request, res: Response) => {
    const strategy = (passport as { _strategy?: (name: string) => { generateServiceProviderMetadata?: (decryptionCert?: string, signingCert?: string) => string } })._strategy?.('saml');
    if (strategy?.generateServiceProviderMetadata) {
      const metadata = strategy.generateServiceProviderMetadata();
      res.type('application/xml');
      res.send(metadata);
    } else {
      res.status(404).json({ error: 'Estratégia SAML não configurada' });
    }
  });
}

// ============================================================================
// ROTAS: Logout
// ============================================================================

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
      { id: 'google', name: 'Google', enabled: !!googleClientId },
      { id: 'github', name: 'GitHub', enabled: !!githubClientId },
      { id: 'saml', name: 'SSO Empresarial (SAML)', enabled: !!(samlEntryPoint && samlIssuer && samlCert) },
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

// ============================================================================
// ROTAS: Gestão de Módulos do Sistema (RBAC Granular)
// Regra 6: Persistência real em PostgreSQL, sem mocks
// ============================================================================

// Zod schemas para validação de entrada (OWASP API3)
const createModuleSchema = z.object({
  codigo: z.string().min(2).max(100),
  nome: z.string().min(2).max(255),
  descricao: z.string().optional(),
  icone: z.string().max(50).optional(),
  categoria: z.string().min(2).max(100),
  urlExterna: z.string().url().optional().nullable(),
  ordem: z.number().int().optional(),
  ativo: z.boolean().optional(),
});

const updateModuleSchema = createModuleSchema.partial();

const assignModuleSchema = z.object({
  userId: z.string().uuid(),
  moduleId: z.string().uuid(),
  permitido: z.boolean(),
  acessoLeitura: z.boolean().optional(),
  acessoEscrita: z.boolean().optional(),
  acessoAdmin: z.boolean().optional(),
});

const assignRoleModuleSchema = z.object({
  role: z.enum(['super_admin', 'admin', 'manager', 'operator', 'viewer', 'guest']),
  moduleId: z.string().uuid(),
  acessoLeitura: z.boolean().optional(),
  acessoEscrita: z.boolean().optional(),
  acessoAdmin: z.boolean().optional(),
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

// GET /api/auth/modules - Listar todos os módulos do sistema
app.get('/api/auth/modules', requireAuth(), async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const modules = await db.query.systemModules.findMany({
      orderBy: (m, { asc }) => [asc(m.ordem), asc(m.categoria)],
    });

    logger.info({ count: modules.length }, 'Módulos listados');
    res.json({ modules });
  } catch (error) {
    logger.error({ error }, 'Falha ao listar módulos');
    res.status(500).json({ error: 'Erro ao listar módulos' });
  }
});

// GET /api/auth/modules/:id - Buscar módulo por ID
app.get('/api/auth/modules/:id', requireAuth(), async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const module = await db.query.systemModules.findFirst({
      where: eq(schema.systemModules.id, req.params.id),
    });

    if (!module) {
      res.status(404).json({ error: 'Módulo não encontrado' });
      return;
    }

    res.json({ module });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar módulo');
    res.status(500).json({ error: 'Erro ao buscar módulo' });
  }
});

// POST /api/auth/modules - Criar novo módulo (admin only)
app.post('/api/auth/modules', requireAuth(), requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const result = createModuleSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Dados inválidos', details: result.error.format() });
    return;
  }

  const db = getDatabase();
  
  // Verificar se código já existe
  const existing = await db.query.systemModules.findFirst({
    where: eq(schema.systemModules.codigo, result.data.codigo),
  });

  if (existing) {
    res.status(409).json({ error: 'Código de módulo já existe' });
    return;
  }

  const [module] = await db.insert(schema.systemModules)
    .values({
      codigo: result.data.codigo,
      nome: result.data.nome,
      descricao: result.data.descricao,
      icone: result.data.icone,
      categoria: result.data.categoria,
      urlExterna: result.data.urlExterna,
      ordem: result.data.ordem ?? 0,
      ativo: result.data.ativo ?? true,
    })
    .returning();

  logger.info({ moduleId: module.id, codigo: module.codigo }, 'Módulo criado');
  res.status(201).json({ module });
}));

// PATCH /api/auth/modules/:id - Atualizar módulo (admin only)
app.patch('/api/auth/modules/:id', requireAuth(), requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const result = updateModuleSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Dados inválidos', details: result.error.format() });
    return;
  }

  const db = getDatabase();
  
  const [module] = await db.update(schema.systemModules)
    .set(result.data)
    .where(eq(schema.systemModules.id, req.params.id))
    .returning();

  if (!module) {
    res.status(404).json({ error: 'Módulo não encontrado' });
    return;
  }

  logger.info({ moduleId: module.id }, 'Módulo atualizado');
  res.json({ module });
}));

// DELETE /api/auth/modules/:id - Deletar módulo (super_admin only)
app.delete('/api/auth/modules/:id', requireAuth(), requireRole('super_admin'), asyncHandler(async (req: Request, res: Response) => {
  const db = getDatabase();
  
  const [module] = await db.delete(schema.systemModules)
    .where(eq(schema.systemModules.id, req.params.id))
    .returning();

  if (!module) {
    res.status(404).json({ error: 'Módulo não encontrado' });
    return;
  }

  logger.info({ moduleId: module.id, codigo: module.codigo }, 'Módulo deletado');
  res.json({ success: true, module });
}));

// GET /api/auth/modules/user/:userId - Listar módulos de um usuário
app.get('/api/auth/modules/user/:userId', requireAuth(), async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const userModulesData = await db.select({
      id: schema.userModules.id,
      moduleId: schema.userModules.moduleId,
      permitido: schema.userModules.permitido,
      acessoLeitura: schema.userModules.acessoLeitura,
      acessoEscrita: schema.userModules.acessoEscrita,
      acessoAdmin: schema.userModules.acessoAdmin,
      module: schema.systemModules,
    })
      .from(schema.userModules)
      .innerJoin(schema.systemModules, eq(schema.userModules.moduleId, schema.systemModules.id))
      .where(eq(schema.userModules.userId, req.params.userId));

    res.json({ userModules: userModulesData });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar módulos do usuário');
    res.status(500).json({ error: 'Erro ao buscar módulos do usuário' });
  }
});

// POST /api/auth/modules/assign - Atribuir módulo a usuário (admin only)
app.post('/api/auth/modules/assign', requireAuth(), requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const result = assignModuleSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Dados inválidos', details: result.error.format() });
    return;
  }

  const db = getDatabase();
  
  // CORREÇÃO AUDITORIA 17/12/2025: Verificar combinação userId + moduleId
  // Bug: Buscava apenas por userId, causando atualização incorreta de módulos
  const existing = await db.query.userModules.findFirst({
    where: and(
      eq(schema.userModules.userId, result.data.userId),
      eq(schema.userModules.moduleId, result.data.moduleId)
    ),
  });

  if (existing) {
    // Atualizar atribuição existente
    const [updated] = await db.update(schema.userModules)
      .set({
        permitido: result.data.permitido,
        acessoLeitura: result.data.acessoLeitura ?? true,
        acessoEscrita: result.data.acessoEscrita ?? false,
        acessoAdmin: result.data.acessoAdmin ?? false,
        atualizadoEm: new Date(),
      })
      .where(eq(schema.userModules.id, existing.id))
      .returning();
    
    logger.info({ userId: result.data.userId, moduleId: result.data.moduleId }, 'Atribuição de módulo atualizada');
    res.json({ userModule: updated });
    return;
  }

  // Criar nova atribuição
  const [userModule] = await db.insert(schema.userModules)
    .values({
      userId: result.data.userId,
      moduleId: result.data.moduleId,
      permitido: result.data.permitido,
      acessoLeitura: result.data.acessoLeitura ?? true,
      acessoEscrita: result.data.acessoEscrita ?? false,
      acessoAdmin: result.data.acessoAdmin ?? false,
      criadoPor: req.user?.userId,
    })
    .returning();

  logger.info({ userId: result.data.userId, moduleId: result.data.moduleId }, 'Módulo atribuído ao usuário');
  res.status(201).json({ userModule });
}));

// GET /api/auth/modules/role/:role - Listar módulos por role
app.get('/api/auth/modules/role/:role', requireAuth(), async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const roleModulesData = await db.select({
      id: schema.roleModules.id,
      role: schema.roleModules.role,
      moduleId: schema.roleModules.moduleId,
      acessoLeitura: schema.roleModules.acessoLeitura,
      acessoEscrita: schema.roleModules.acessoEscrita,
      acessoAdmin: schema.roleModules.acessoAdmin,
      module: schema.systemModules,
    })
      .from(schema.roleModules)
      .innerJoin(schema.systemModules, eq(schema.roleModules.moduleId, schema.systemModules.id))
      .where(eq(schema.roleModules.role, req.params.role as 'super_admin' | 'admin' | 'manager' | 'operator' | 'viewer' | 'guest'));

    res.json({ roleModules: roleModulesData });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar módulos da role');
    res.status(500).json({ error: 'Erro ao buscar módulos da role' });
  }
});

// POST /api/auth/modules/role/assign - Atribuir módulo a role (super_admin only)
app.post('/api/auth/modules/role/assign', requireAuth(), requireRole('super_admin'), asyncHandler(async (req: Request, res: Response) => {
  const result = assignRoleModuleSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Dados inválidos', details: result.error.format() });
    return;
  }

  const db = getDatabase();
  
  // CORREÇÃO AUDITORIA 17/12/2025: Verificar combinação role + moduleId
  // Bug: Buscava apenas por role, causando atualização incorreta de módulos
  const existing = await db.query.roleModules.findFirst({
    where: and(
      eq(schema.roleModules.role, result.data.role),
      eq(schema.roleModules.moduleId, result.data.moduleId)
    ),
  });

  if (existing) {
    // Atualizar atribuição existente
    const [updated] = await db.update(schema.roleModules)
      .set({
        acessoLeitura: result.data.acessoLeitura ?? true,
        acessoEscrita: result.data.acessoEscrita ?? false,
        acessoAdmin: result.data.acessoAdmin ?? false,
      })
      .where(eq(schema.roleModules.id, existing.id))
      .returning();
    
    logger.info({ role: result.data.role, moduleId: result.data.moduleId }, 'Atribuição de módulo à role atualizada');
    res.json({ roleModule: updated });
    return;
  }

  // Criar nova atribuição
  const [roleModule] = await db.insert(schema.roleModules)
    .values({
      role: result.data.role,
      moduleId: result.data.moduleId,
      acessoLeitura: result.data.acessoLeitura ?? true,
      acessoEscrita: result.data.acessoEscrita ?? false,
      acessoAdmin: result.data.acessoAdmin ?? false,
    })
    .returning();

  logger.info({ role: result.data.role, moduleId: result.data.moduleId }, 'Módulo atribuído à role');
  res.status(201).json({ roleModule });
}));

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

// ============================================================================
// ROTAS: Gestão de Usuários (Identity Provisioning → Grafana/ERPNext)
// Regra 6: Persistência real em PostgreSQL, propagação automática
// ============================================================================

// Zod schemas para validação de entrada (OWASP API3 - Input Validation)
const updateUserProfileSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().max(100).optional(),
  preferredName: z.string().min(2).max(120).optional(),
  email: z.string().email().max(255).transform(v => v.toLowerCase().trim()).optional(),
  cargo: z.string().max(100).optional(),
  departamento: z.string().max(100).optional(),
  telefone: z.string().max(20).optional(),
  idioma: z.enum(['pt-BR', 'en-US', 'es-ES']).optional(),
  timezone: z.string().max(50).optional(),
  profileImageUrl: z.string().url().max(2048).optional().nullable(),
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
// Propaga automaticamente para Grafana/ERPNext via Identity Provisioning
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
  
  // Atualizar usuário
  const [updatedUser] = await db.update(schema.users)
    .set({
      ...parseResult.data,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId))
    .returning();

  logger.info({ 
    userId, 
    updatedFields: Object.keys(parseResult.data),
    updatedBy: requestingUser?.userId,
  }, 'Perfil de usuário atualizado');

  // Identity Provisioning: Propagar alteração para Grafana/ERPNext
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

// PATCH /api/users/:id/role - Atualizar role do usuário (admin+ only)
// Propaga automaticamente para Grafana/ERPNext via Identity Provisioning
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

  // Identity Provisioning: Propagar mudança de role para Grafana/ERPNext
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
// Propaga automaticamente para Grafana/ERPNext via Identity Provisioning
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

  // Identity Provisioning: Propagar desativação para Grafana/ERPNext
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
// Propaga automaticamente para Grafana/ERPNext via Identity Provisioning
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

  // Identity Provisioning: Propagar deleção para Grafana/ERPNext
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

// ============================================================================
// OIDC PROVIDER: Alice como IdP único para Grafana e ERPNext
// ============================================================================

// Montar rotas OIDC (/.well-known/openid-configuration, /oauth/*, /auth/interaction/*)
// Inicialização assíncrona - chamada no startup do servidor
mountOIDCRoutes(app)
  .then(() => {
    logger.info('Rotas OIDC Provider montadas com sucesso');
  })
  .catch((error: unknown) => {
    // CORREÇÃO 31/12/2025: Capturar erro completo com stack trace
    // Erro anterior: error:{} (objeto vazio) - não capturava informações úteis
    const errorDetails = error instanceof Error 
      ? { 
          name: error.name, 
          message: error.message, 
          stack: error.stack,
          cause: error.cause
        }
      : { raw: String(error) };
    logger.error({ error: errorDetails }, 'Falha ao montar rotas OIDC Provider');
  });

// ============================================================================
// MIDDLEWARE: Not Found + Error Handler (Express.js 2025)
// ============================================================================

// Not Found handler (antes do error handler)
app.use(createNotFoundHandler({ serviceName: 'auth-service' }));

// Error handler global (OWASP 2023 + Express.js 2025)
app.use(createErrorHandler({ 
  serviceName: 'auth-service', 
  logger,
  includeStackInDev: true,
}));

// ============================================================================
// INICIAR SERVIDOR
// ============================================================================

const PORT = config.PORT || 3001;

// CORREÇÃO 31/12/2025: Usar connectWithRetry para garantir PostgreSQL + pgvector prontos
// Previne crash loop quando PostgreSQL ainda está inicializando
import { connectWithRetry } from '@alice/database';

let server: ReturnType<typeof app.listen>;

(async () => {
  try {
    // Conectar ao PostgreSQL com retry logic ANTES de iniciar servidor HTTP
    // Isso garante que database está pronto antes de aceitar requisições
    await connectWithRetry({
      maxRetries: 15,
      initialDelayMs: 2000,
      checkPgvector: true, // Verificar extensão pgvector (obrigatório para embeddings)
    });
    
    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info({ port: PORT }, 'Auth service iniciado');
      logger.info({
        providers: {
          local: true,
          google: !!googleClientId,
          github: !!githubClientId,
          saml: !!(samlEntryPoint && samlIssuer && samlCert),
        }
      }, 'Provedores de autenticação disponíveis');
      
      // Seed do administrador global (admin central para Alice/ERPNext/Grafana)
      ensureGlobalAdmin().catch((error) => {
        logger.error({ error }, 'Falha ao criar/atualizar administrador global');
      });

      // Seed catálogo de permissões + auto-atribuição para admin/super_admin
      ensurePermissionCatalog().catch((error) => {
        logger.error({ error }, 'Falha ao sincronizar catálogo de permissões');
      });

      // Seed de clientes OAuth para SSO 100% automatizado (31/12/2025)
      ensureOAuthClients().catch((error) => {
        logger.error({ error }, 'Falha ao criar/atualizar clientes OAuth');
      });

      // Identity Provisioning: Sincronização Alice → Grafana/ERPNext
      // Processa eventos de criação/atualização/deleção de usuários via Outbox Pattern
      try {
        startIdentityProvisioning();
        logger.info('Identity Provisioning iniciado - sincronização com Grafana/ERPNext ativa');
      } catch (error: unknown) {
        logger.error({ error }, 'Falha ao iniciar Identity Provisioning (não crítico)');
      }
    });
    
    // SEGURANÇA: Timeouts para prevenir conexões pendentes (Node.js 20 LTS Best Practices)
    server.timeout = 30000; // 30s timeout para requisições
    server.keepAliveTimeout = 65000; // 65s (maior que ALB timeout padrão de 60s)
    server.headersTimeout = 66000; // Ligeiramente maior que keepAliveTimeout
    
    // ============================================================================
    // GRACEFUL SHUTDOWN (Enterprise-Grade - Regra 16 CLAUDE.md)
    // CORREÇÃO 31/12/2025: Callbacks movidos para dentro do IIFE para garantir
    // que 'server' está definido antes de registrar o callback
    // ShutdownManager centralizado elimina duplicação de listeners (Regra 6)
    // Ordem: Identity Provisioning → HTTP server → Database pool
    // ============================================================================

    registerShutdownCallback(
      'auth-identity-provisioning',
      async () => {
        logger.info('Parando Identity Provisioning...');
        await stopIdentityProvisioning();
        logger.info('Identity Provisioning parado');
      },
      { priority: ShutdownPriority.BACKGROUND_JOBS }
    );

    registerShutdownCallback(
      'auth-http-server',
      async () => {
        logger.info('Encerrando HTTP server...');
        await new Promise<void>((resolve, reject) => {
          server.close((err) => {
            if (err) {
              logger.error({ error: err }, 'Erro ao fechar HTTP server');
              reject(err);
            } else {
              logger.info('HTTP server encerrado com sucesso');
              resolve();
            }
          });
        });
      },
      { priority: ShutdownPriority.HTTP_SERVER }
    );

    registerShutdownCallback(
      'auth-database-pool',
      async () => {
        logger.info('Encerrando pool de conexões database...');
        await closeDatabasePool();
        logger.info('Pool de conexões encerrado com sucesso');
      },
      { priority: ShutdownPriority.DATABASE }
    );
    
  } catch (error) {
    logger.fatal({ error: error instanceof Error ? error.message : String(error) }, 
      '❌ FATAL: Falha ao conectar ao PostgreSQL - auth-service não pode iniciar');
    process.exit(1);
  }
})();
