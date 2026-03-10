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
  setPermissionResolver,
  createAlicePrometheus,
  initRbacPrometheusMetrics,
  instrumentCircuitBreaker,
  registerShutdownCallback,
  ShutdownPriority,
  Counter as PromCounter,
  createCircuitBreaker,
  CIRCUIT_BREAKER_PRESETS,
} from '@alice/shared-utils';
import { eq, or } from '@alice/database';
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
} from '@alice/shared-utils';
import { authServicePaths, authServiceSchemas } from './openapi-specs.js';
import { ensurePermissionCatalog } from './rbac/permission-catalog.js';
import {
  buildAuthContext,
  type DbUser,
  resolvePermissionsForAuth,
} from './rbac/role-assignments.js';
import { registerRbacAdminRoutes } from './routes/rbac-admin-routes.js';
import { registerAuthProviderRoutes } from './routes/auth-provider-routes.js';
import { registerAuthPasswordRoutes } from './routes/auth-password-routes.js';
import { registerAuthBiometricsRoutes } from './routes/auth-biometrics-routes.js';
import { registerAuthRegistrationRoutes } from './routes/auth-registration-routes.js';
import { registerAuthSystemRoutes } from './routes/auth-system-routes.js';
import { registerUserManagementRoutes } from './routes/user-management-routes.js';

// Logger centralizado: JSON em produção, pino-pretty em desenvolvimento
const logger = createLogger('auth-service');

const BIOMETRICS_SERVICE_URL = process.env.BIOMETRICS_SERVICE_URL?.trim();
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET?.trim();

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
  const grafanaSecret = process.env.GRAFANA_OAUTH_CLIENT_SECRET;
  const grafanaUrl = process.env.GRAFANA_URL || 'https://observability.yesyoudeserve.duckdns.org';

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

const getGithubCallbackUrl = (): string => {
  const oauthCallback = process.env.OAUTH_GITHUB_CALLBACK_URL?.trim();
  if (oauthCallback) {
    const isPathOnly = oauthCallback.startsWith('/');
    if (isPathOnly) {
      const baseUrl = getBaseUrl();
      const resolved = `${baseUrl}${oauthCallback}`;
      if (!oauthCallback.startsWith('/api/auth/github/callback')) {
        logger.warn({ oauthCallback }, 'OAUTH_GITHUB_CALLBACK_URL fora do padrao /api/auth/github/callback');
      }
      return resolved;
    }
    try {
      const parsed = new URL(oauthCallback);
      if (!parsed.pathname.startsWith('/api/auth/github/callback')) {
        logger.warn({ oauthCallback }, 'OAUTH_GITHUB_CALLBACK_URL fora do padrao /api/auth/github/callback');
      }
      return parsed.toString();
    } catch (error) {
      logger.warn({ oauthCallback, error }, 'OAUTH_GITHUB_CALLBACK_URL invalido; usando callback padrao');
      return `${getBaseUrl()}/api/auth/github/callback`;
    }
  }
  return `${getBaseUrl()}/api/auth/github/callback`;
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
              timezone: 'America/Sao_Paulo',
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
          
          // Identity Provisioning: Sincronizar usuário com Grafana
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
const githubCallbackUrl = getGithubCallbackUrl();
const githubCallbackPath = getCallbackPath(githubCallbackUrl, '/api/auth/github/callback');

if (githubClientId && githubClientSecret) {
  passport.use(new GitHubStrategy(
    {
      clientID: githubClientId,
      clientSecret: githubClientSecret,
      callbackURL: githubCallbackUrl,
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
              timezone: 'America/Sao_Paulo',
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
          
          // Identity Provisioning: Sincronizar usuário com Grafana
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
              timezone: 'America/Sao_Paulo',
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
          
          // Identity Provisioning: Sincronizar usuário com Grafana
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

registerAuthSystemRoutes(app, {
  logger,
  getConfiguredProviders: () => ({
    local: true,
    google: !!googleClientId,
    github: !!githubClientId,
    saml: !!(samlEntryPoint && samlIssuer && samlCert),
  }),
  getAuthMetrics: () => ({
    attempts: authMetrics.attempts,
    successes: authMetrics.successes,
    failures: authMetrics.failures,
    lastSuccess: authMetrics.lastSuccess,
    lastFailure: authMetrics.lastFailure,
  }),
  isPoolHealthy,
  getCurrentUserById: async (userId) => {
    const db = getDatabase();
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      with: {
        tenant: true,
      },
    });
    return user as Record<string, unknown> | null;
  },
  getOrCreateCsrfToken: (sessionData) => getOrCreateCsrfToken(sessionData),
});

// ============================================================================
// SCHEMAS ZOD: Validação de Autenticação (OWASP API3 - Input Validation)
// ============================================================================

// Schema para login
const loginSchema = z.object({
  email: z.string()
    .email('Email inválido')
    .transform(v => v.toLowerCase().trim()),
  password: z.string()
    .min(1, 'Senha é obrigatória'),
});

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

const biometricsLoginRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: { error: 'Muitas tentativas de biometria. Aguarde 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = req.body?.email || '';
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return `${ip}-${email}-biometrics`;
  },
  validate: {
    keyGeneratorIpFallback: false,
  },
});

const verifyPasswordRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Muitas tentativas de senha. Aguarde 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return `${ip}-verify-password`;
  },
  validate: {
    keyGeneratorIpFallback: false,
  },
});

const biometricsImageSchema = z.object({
  imageBase64: z.string().min(100),
  captureMode: z.enum(['replace', 'append']).optional(),
});

const biometricsLoginSchema = z.object({
  email: z.string().email(),
  imageBase64: z.string().min(100),
});

const biometricsVerifySchema = z.object({
  imageBase64: z.string().min(100),
  actionType: z.enum(['login', 'approval']),
  actionContext: z.record(z.string(), z.unknown()).optional(),
});

const verifyPasswordSchema = z.object({
  password: z.string().min(1, 'Senha é obrigatória'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Senha atual é obrigatória'),
  newPassword: z.string().min(8, 'Nova senha deve ter no mínimo 8 caracteres').max(200),
});

async function callBiometricsService<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  if (!BIOMETRICS_SERVICE_URL || !INTERNAL_API_SECRET) {
    throw new BiometricsServiceError('Biometria nao configurada.', 503);
  }
  const response = await fetch(`${BIOMETRICS_SERVICE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Api-Secret': INTERNAL_API_SECRET,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    let message = 'Falha ao chamar biometria.';
    if (errText) {
      try {
        const parsed = JSON.parse(errText) as { error?: unknown; message?: unknown };
        const upstreamMessage =
          (typeof parsed.error === 'string' && parsed.error.trim()) ||
          (typeof parsed.message === 'string' && parsed.message.trim()) ||
          '';
        if (upstreamMessage) {
          message = upstreamMessage;
        }
      } catch {
        message = errText;
      }
    }
    throw new BiometricsServiceError(message, response.status);
  }
  return response.json() as Promise<T>;
}

class BiometricsServiceError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'BiometricsServiceError';
    this.status = status;
  }
}

function resolveBiometricsError(error: unknown): { status: number; message: string } {
  if (error instanceof BiometricsServiceError) {
    return {
      status: error.status >= 400 && error.status < 600 ? error.status : 502,
      message: error.message || 'Falha ao chamar biometria.',
    };
  }

  if (error instanceof Error) {
    return { status: 500, message: error.message || 'Erro desconhecido' };
  }

  return { status: 500, message: 'Erro desconhecido' };
}

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

registerAuthPasswordRoutes(app, {
  logger,
  passport,
  loginRateLimiter,
  validateLogin,
  verifyPasswordRateLimiter,
  parseVerifyPassword: (input) => verifyPasswordSchema.safeParse(input),
  parseChangePassword: (input) => changePasswordSchema.safeParse(input),
  getUserPasswordHash: async (userId) => {
    const db = getDatabase();
    const dbUser = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: { passwordHash: true },
    });
    return dbUser?.passwordHash ?? null;
  },
  comparePassword: (plain, hash) => bcrypt.compare(plain, hash),
  hashPassword: (plain) => bcrypt.hash(plain, 12),
  updateUserPassword: async (userId, hash) => {
    const db = getDatabase();
    await db.update(schema.users)
      .set({ passwordHash: hash, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
  },
});

registerAuthBiometricsRoutes(app, {
  logger,
  biometricsLoginRateLimiter,
  parseBiometricsLogin: (input) => biometricsLoginSchema.safeParse(input),
  parseBiometricsImage: (input) => biometricsImageSchema.safeParse(input),
  parseBiometricsVerify: (input) => biometricsVerifySchema.safeParse(input),
  getUserByEmail: async (email) => {
    const db = getDatabase();
    return db.query.users.findFirst({
      where: eq(schema.users.email, email),
    });
  },
  buildAuthContext: (user) => buildAuthContext(user as DbUser),
  callBiometricsService: (endpoint, body) => callBiometricsService<Record<string, unknown>>(endpoint, body),
  resolveBiometricsError,
});

registerAuthProviderRoutes(app, {
  passport,
  googleEnabled: !!googleClientId,
  githubEnabled: !!githubClientId,
  samlEnabled: !!(samlEntryPoint && samlIssuer && samlCert),
  googleCallbackPath,
  githubCallbackPath,
});

registerAuthRegistrationRoutes(app, {
  logger,
  publishProvisioningEvent,
});

// ============================================================================
// ROTAS: Admin/RBAC e Gestão de Usuários (modularizado)
// ============================================================================

registerRbacAdminRoutes(app, {
  logger,
  googleEnabled: !!googleClientId,
  githubEnabled: !!githubClientId,
  samlEnabled: !!(samlEntryPoint && samlIssuer && samlCert),
});

registerUserManagementRoutes(app, {
  logger,
  publishProvisioningEvent,
  invalidateUserPermissions,
});

// ============================================================================
// OIDC PROVIDER: Alice como IdP único para Grafana
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
      
      // Seed do administrador global (admin central para Alice/Grafana)
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

      // Identity Provisioning: Sincronização Alice → Grafana
      // Processa eventos de criação/atualização/deleção de usuários via Outbox Pattern
      try {
        startIdentityProvisioning();
        logger.info('Identity Provisioning iniciado - sincronização com Grafana ativa');
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
