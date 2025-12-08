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

import express, { Request, Response, NextFunction } from 'express';
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
} from '@alice/shared-utils';
import { authServicePaths, authServiceSchemas } from './openapi-specs.js';

// Logger centralizado: JSON em produção, pino-pretty em desenvolvimento
const logger = createLogger('auth-service');

// Inicializar sistema de feature flags com storage PostgreSQL (Regra 16 - Enterprise)
const featureFlagStorage = createDrizzleFeatureFlagStorage();
initFeatureFlags(featureFlagStorage);
logger.info('Sistema de feature flags inicializado');

type DbUser = typeof schema.users.$inferSelect;

function toAuthContext(dbUser: DbUser): Express.User {
  return {
    userId: dbUser.id,
    tenantId: dbUser.tenantId || undefined,
    role: dbUser.role || 'guest',
    email: dbUser.email || undefined,
    permissions: [],
  };
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
    '/api/auth/register', 
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
const baseAuthConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().optional(),
  SESSION_SECRET: z.string().default('dev-secret-min-32-characters-long!'),
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
const authConfigSchema = baseAuthConfigSchema.refine(
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
);

type AuthConfig = z.infer<typeof authConfigSchema>;

// Carregar configuração com validação Zod
let config: AuthConfig;

// Validar SESSION_SECRET obrigatório em produção (Regra 16 - Best Practices 2025)
const nodeEnv = process.env.NODE_ENV || 'development';
const sessionSecret = process.env.SESSION_SECRET;

if (nodeEnv === 'production' && !sessionSecret) {
  logger.error('CRITICAL: SESSION_SECRET é OBRIGATÓRIO em produção. Abortando inicialização.');
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
  const adminEmail = config.ADMIN_USER?.toLowerCase().trim();
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
const corsOrigins = process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5000'];
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
    done(null, toAuthContext(dbUser));
  } catch (error) {
    logger.error({ error, userId: id }, 'Erro ao deserializar usuário');
    done(error, null);
  }
});

// URL base para callbacks OAuth
// Produção: Hetzner Cloud (yesyoudeserve.duckdns.org)
const getBaseUrl = (): string => {
  // Prioridade: BASE_URL definida explicitamente
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }
  // Produção Hetzner
  if (process.env.NODE_ENV === 'production') {
    return 'https://yesyoudeserve.duckdns.org';
  }
  // Desenvolvimento local
  return 'http://localhost:5000';
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
// para contagem precisa de sessões distribuídas (TODO: fase futura)

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
      return done(null, toAuthContext(user));
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

if (googleClientId && googleClientSecret) {
  passport.use(new GoogleStrategy(
    {
      clientID: googleClientId,
      clientSecret: googleClientSecret,
      callbackURL: `${getBaseUrl()}/api/auth/google/callback`,
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
              role: 'viewer',
              idioma: 'pt-BR',
              timezone: 'Europe/Lisbon',
            }).returning();
          });
          user = newUser;
          const createdUserId = user.id;
          logger.info({ userId: createdUserId, email }, 'Novo usuário criado via Google');
          
          // Identity Provisioning: Sincronizar usuário com Grafana/ERPNext
          publishProvisioningEvent('user.created', {
            userId: user.id,
            email: user.email || email,
            firstName: user.firstName || undefined,
            lastName: user.lastName || undefined,
            role: user.role || 'viewer',
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
        return done(null, toAuthContext(user));
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

const githubClientId = process.env.GITHUB_CLIENT_ID;
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;

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
              role: 'viewer',
              idioma: 'pt-BR',
              timezone: 'Europe/Lisbon',
            }).returning();
          });
          user = newUser;
          const createdUserId = user.id;
          logger.info({ userId: createdUserId, email }, 'Novo usuário criado via GitHub');
          
          // Identity Provisioning: Sincronizar usuário com Grafana/ERPNext
          publishProvisioningEvent('user.created', {
            userId: user.id,
            email: user.email || email,
            firstName: user.firstName || undefined,
            lastName: user.lastName || undefined,
            role: user.role || 'viewer',
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
        return done(null, toAuthContext(user));
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
  logger.warn('OAuth GitHub não configurado - GITHUB_CLIENT_ID ou GITHUB_CLIENT_SECRET ausentes');
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
              role: 'viewer',
              idioma: 'pt-BR',
              timezone: 'Europe/Lisbon',
            }).returning();
          });
          user = newUser;
          const createdUserId = user.id;
          logger.info({ userId: createdUserId, email }, 'Novo usuário criado via SAML');
          
          // Identity Provisioning: Sincronizar usuário com Grafana/ERPNext
          publishProvisioningEvent('user.created', {
            userId: user.id,
            email: user.email || email,
            firstName: user.firstName || undefined,
            lastName: user.lastName || undefined,
            role: user.role || 'viewer',
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
        return done(null, toAuthContext(user) as unknown as Record<string, unknown>);
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
    .max(100, 'Nome muito longo')
    .optional(),
  lastName: z.string()
    .max(100, 'Sobrenome muito longo')
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

app.post('/api/auth/register', asyncHandler(async (req: Request, res: Response) => {
  // Validação Zod (OWASP API3 - Injection Prevention)
  const parseResult = registerSchema.safeParse(req.body);
  
  if (!parseResult.success) {
    const errors = parseResult.error.errors.map(e => e.message);
    return res.status(400).json({ 
      error: 'Dados de registro inválidos', 
      details: errors,
    });
  }

  const { email, password, firstName, lastName } = parseResult.data;

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

  // Criar novo usuário
  const [newUser] = await db.insert(schema.users).values({
    email,
    passwordHash,
    firstName,
    lastName,
    authProvider: 'local',
    emailVerified: false,
    role: 'viewer',
    idioma: 'pt-BR',
    timezone: 'Europe/Lisbon',
  }).returning();

  logger.info({ userId: newUser.id, email }, 'Novo usuário registrado');

  // Identity Provisioning: Sincronizar usuário com Grafana/ERPNext
  publishProvisioningEvent('user.created', {
    userId: newUser.id,
    email: newUser.email || email,
    firstName: newUser.firstName || undefined,
    lastName: newUser.lastName || undefined,
    role: newUser.role || 'viewer',
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
const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 5, // 5 tentativas por minuto
  message: { error: 'Muitas tentativas de login. Aguarde 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Usar IP + email para evitar bloqueio de IP compartilhado
    const email = req.body?.email || '';
    return `${req.ip}-${email}`;
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
    scope: ['profile', 'email'] 
  }));

  app.get('/api/auth/google/callback',
    passport.authenticate('google', { 
      failureRedirect: '/login?error=google_auth_failed',
      successRedirect: '/dashboard'
    })
  );
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
// ROTAS: Permissões RBAC
// ============================================================================

app.get('/api/auth/permissions', requireAuth(), async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  try {
    const db = getDatabase();
    const userRole = req.user.role;

    // Buscar permissões da role
    const rolePermissions = await db.query.rolePermissions.findMany({
      where: eq(schema.rolePermissions.role, userRole || 'viewer'),
      with: {
        permission: true,
      },
    });

    const permissions = rolePermissions
      .map(rp => (rp as { permission?: { codigo?: string } }).permission?.codigo)
      .filter(Boolean);

    res.json({ 
      role: userRole, 
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
  
  // Verificar se já existe atribuição
  const existing = await db.query.userModules.findFirst({
    where: eq(schema.userModules.userId, result.data.userId),
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
  
  // Verificar se já existe atribuição
  const existing = await db.query.roleModules.findFirst({
    where: eq(schema.roleModules.role, result.data.role),
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
// ROTAS: Gestão de Usuários (Identity Provisioning → Grafana/ERPNext)
// Regra 6: Persistência real em PostgreSQL, propagação automática
// ============================================================================

// Zod schemas para validação de entrada (OWASP API3 - Input Validation)
const updateUserProfileSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().max(100).optional(),
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

const updateUserStatusSchema = z.object({
  ativo: z.boolean(),
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
      role: true,
      cargo: true,
      departamento: true,
      ativo: true,
      ultimoAcesso: true,
      createdAt: true,
      profileImageUrl: true,
      authProvider: true,
    },
    orderBy: (users, { desc }) => [desc(users.createdAt)],
  });

  res.json({ users });
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
      role: true,
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
  });

  if (!user) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }
  
  // Multi-tenant: Verificar se pertence ao mesmo tenant
  if (req.tenantId && user.tenantId !== req.tenantId && !['super_admin'].includes(requestingUser?.role || '')) {
    return res.status(403).json({ error: 'Acesso negado - tenant diferente' });
  }

  res.json({ user });
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

  res.json({ 
    user: { 
      id: updatedUser.id, 
      role: updatedUser.role,
      previousRole,
    }, 
    message: 'Role atualizada com sucesso',
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
  .catch((error) => {
    logger.error({ error }, 'Falha ao montar rotas OIDC Provider');
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

const server = app.listen(PORT, '0.0.0.0', () => {
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
