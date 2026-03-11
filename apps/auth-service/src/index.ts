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

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import passport from 'passport';
import session from 'express-session';
import { z } from 'zod';
import { createLogger } from '@alice/logger';
import {
  getNodeEnv,
  readOptionalStringEnv,
  resolveBaseUrl,
  resolveTenantDomain,
} from '@alice/config';
import {
  createErrorHandler,
  createNotFoundHandler,
  initFeatureFlags,
  setPermissionResolver,
} from '@alice/shared-utils';
import { eq } from '@alice/database';
import {
  createDrizzleFeatureFlagStorage,
  getDatabase,
  schema,
} from '@alice/database';
import { startAuthService } from './bootstrap.js';
import { setupAuthServiceMiddlewares } from './auth-middlewares.js';
import { configureAuthProviders } from './auth-providers.js';
import { registerAuthServiceRoutes } from './auth-routes.js';
import {
  startProcessor as startIdentityProvisioning,
  stopProcessor as stopIdentityProvisioning,
  publishProvisioningEvent,
} from './identity-provisioning/index.js';
import { mountOIDCRoutes } from './oidc/index.js';
import { ensurePermissionCatalog } from './rbac/permission-catalog.js';
import { resolvePermissionsForAuth } from './rbac/role-assignments.js';

// Logger centralizado: JSON em produção, pino-pretty em desenvolvimento
const logger = createLogger('auth-service');

const nodeEnv = getNodeEnv();
const SERVICE_BASE_URL = resolveBaseUrl({
  requiredInProduction: true,
  developmentFallback: 'http://localhost:5000',
});
const DEFAULT_TENANT_DOMAIN = resolveTenantDomain({
  requiredInProduction: true,
  developmentFallback: 'localhost',
});
const BIOMETRICS_SERVICE_URL = readOptionalStringEnv('BIOMETRICS_SERVICE_URL');
const INTERNAL_API_SECRET = readOptionalStringEnv('INTERNAL_API_SECRET');

// Inicializar sistema de feature flags com storage PostgreSQL (Regra 16 - Enterprise)
const featureFlagStorage = createDrizzleFeatureFlagStorage();
initFeatureFlags(featureFlagStorage);
logger.info('Sistema de feature flags inicializado');

setPermissionResolver(resolvePermissionsForAuth);

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
    '/api/auth/biometrics/login',
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
  OAUTH_GITHUB_CLIENT_ID: z.string().optional(),
  OAUTH_GITHUB_CLIENT_SECRET: z.string().optional(),
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
const sessionSecret = readOptionalStringEnv('SESSION_SECRET');

if (nodeEnv === 'production' && (!sessionSecret || sessionSecret.length < 64 || sessionSecret === DEV_SESSION_SECRET)) {
  logger.error('CRITICAL: SESSION_SECRET é OBRIGATÓRIO em produção, deve ter >= 64 caracteres e não pode ser o default de desenvolvimento. Abortando inicialização.');
  process.exit(1);
}

if (!sessionSecret && nodeEnv === 'development') {
  logger.warn('SESSION_SECRET não definido. Usando valor de desenvolvimento (NÃO usar em produção!)');
}

if (nodeEnv === 'production' && (!BIOMETRICS_SERVICE_URL || !INTERNAL_API_SECRET)) {
  logger.warn({
    BIOMETRICS_SERVICE_URL: BIOMETRICS_SERVICE_URL ? '[SET]' : '[NOT SET]',
    INTERNAL_API_SECRET: INTERNAL_API_SECRET ? '[SET]' : '[NOT SET]',
  }, 'Biometria não configurada em produção. Login e aprovações por biometria ficarão indisponíveis.');
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
          ADMIN_USER: readOptionalStringEnv('ADMIN_USER') ? '[SET]' : '[NOT SET]',
          ADMIN_PWD: readOptionalStringEnv('ADMIN_PWD') ? '[SET]' : '[NOT SET]',
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
    SESSION_SECRET: DEV_SESSION_SECRET,
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
      dominio: DEFAULT_TENANT_DOMAIN,
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
    timezone: 'America/Sao_Paulo',
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
      // Preservar configurações regionais já personalizadas
      idioma: existing.idioma ?? baseUser.idioma,
      timezone: existing.timezone ?? baseUser.timezone,
      preferencias: existing.preferencias ?? undefined,
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
// Cria/atualiza cliente OAuth para Grafana no startup
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
  const grafanaSecret = readOptionalStringEnv('GRAFANA_OAUTH_CLIENT_SECRET');
  const grafanaUrl = readOptionalStringEnv('GRAFANA_URL');

  if (!grafanaSecret) {
    if (config.NODE_ENV === 'production') {
      logger.error({
        GRAFANA_OAUTH_CLIENT_SECRET: grafanaSecret ? '[SET]' : '[NOT SET]',
      }, 'OAuth client secret não configurado em produção - SSO não funcionará');
      // Não é crítico - apenas loga erro, não aborta o serviço
    } else {
      logger.warn('OAuth client secret não configurado - seed de cliente OAuth ignorado');
    }
    return;
  }

  if (!grafanaUrl) {
    if (config.NODE_ENV === 'production') {
      logger.error({
        GRAFANA_URL: '[NOT SET]',
      }, 'GRAFANA_URL é obrigatório em produção para seed de cliente OAuth');
    } else {
      logger.warn('GRAFANA_URL não configurado - seed de cliente OAuth ignorado');
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
      // Escopo "alice" habilita claims customizados (role, tenant_id) para RBAC no Grafana.
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

const middlewareRuntime = setupAuthServiceMiddlewares({
  app,
  config,
  serviceBaseUrl: SERVICE_BASE_URL,
  csrfProtection,
  passport,
  logger,
});

const providerRuntime = configureAuthProviders({
  passport,
  logger,
  config,
  serviceBaseUrl: SERVICE_BASE_URL,
  defaultTenantDomain: DEFAULT_TENANT_DOMAIN,
  metrics: middlewareRuntime.metrics,
  publishProvisioningEvent,
});

registerAuthServiceRoutes({
  app,
  logger,
  passport,
  providerRuntime,
  publishProvisioningEvent,
  defaultTenantDomain: DEFAULT_TENANT_DOMAIN,
  getOrCreateCsrfToken: (sessionData) =>
    getOrCreateCsrfToken(sessionData as session.Session & session.SessionData),
  biometricsServiceUrl: BIOMETRICS_SERVICE_URL ?? undefined,
  internalApiSecret: INTERNAL_API_SECRET ?? undefined,
});

mountOIDCRoutes(app)
  .then(() => {
    logger.info('Rotas OIDC Provider montadas com sucesso');
  })
  .catch((error: unknown) => {
    const errorDetails = error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
          cause: error.cause,
        }
      : { raw: String(error) };
    logger.error({ error: errorDetails }, 'Falha ao montar rotas OIDC Provider');
    if (config.NODE_ENV === 'production') {
      logger.fatal('OIDC Provider é obrigatório em produção - encerrando auth-service');
      process.exit(1);
    }
  });

app.use(createNotFoundHandler({ serviceName: 'auth-service' }));

app.use(createErrorHandler({
  serviceName: 'auth-service',
  logger,
  includeStackInDev: true,
}));

startAuthService({
  app,
  port: config.PORT || 3001,
  logger,
  providers: {
    local: true,
    google: providerRuntime.googleEnabled,
    github: providerRuntime.githubEnabled,
    saml: providerRuntime.samlEnabled,
  },
  ensureGlobalAdmin,
  ensurePermissionCatalog,
  ensureOAuthClients,
  startIdentityProvisioning,
  stopIdentityProvisioning,
}).catch((error: unknown) => {
  logger.fatal(
    { error: error instanceof Error ? error.message : String(error) },
    '❌ FATAL: Falha ao conectar ao PostgreSQL - auth-service não pode iniciar',
  );
  process.exit(1);
});
