/**
 * Alice Enterprise Platform - Auth Service
 * 
 * Serviço de autenticação enterprise com suporte a:
 * - OAuth 2.0 (Google, GitHub, Microsoft)
 * - SAML 2.0 (Azure AD, Okta)
 * - Autenticação local (email/senha com bcrypt)
 * 
 * Segue best practices 2025 para microserviços (Regra 16 replit.md)
 * Documentação em PT-BR (Regra 10 replit.md)
 * 
 * REFATORADO: Usa @alice/database centralizado (Regra 2 - Não Duplicar)
 */

import express, { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
// Microsoft OAuth desabilitado - aguardando credenciais
// import { Strategy as MicrosoftStrategy } from 'passport-microsoft';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as SamlStrategy, Profile as SamlProfile, VerifiedCallback } from '@node-saml/passport-saml';
import bcrypt from 'bcrypt';
import { createLogger, runWithLogContext } from '@alice/logger';
import { 
  createCorrelationMiddleware, 
  getContextHeaders,
  createSecurityMiddleware,
  createRateLimiter,
  createErrorHandler,
  createNotFoundHandler,
  asyncHandler,
  requirePermission, 
  requireAuth,
  requireRole,
  createAlicePrometheus,
  instrumentCircuitBreaker,
  Counter as PromCounter,
  Gauge as PromGauge,
  type AliceMetrics,
} from '@alice/shared-utils';
import { eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { 
  getDatabase, 
  getPool, 
  schema, 
  setupGracefulShutdown,
  getPoolMetrics,
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
  featureFlagsMiddleware,
  FEATURE_FLAGS,
  isFeatureEnabled,
} from '@alice/shared-utils';

// Logger centralizado: JSON em produção, pino-pretty em desenvolvimento
const logger = createLogger('auth-service');

// Configurar graceful shutdown do pool centralizado (Regra 16 - Best Practices 2025)
setupGracefulShutdown(logger);

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
const authConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().optional(),
  SESSION_SECRET: z.string().default('dev-secret-min-32-characters-long!'),
  // OAuth Google
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // OAuth GitHub
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  // OAuth Microsoft
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT_ID: z.string().optional(),
  // SAML 2.0 (Azure AD, Okta)
  SAML_ENTRY_POINT: z.string().optional(),
  SAML_ISSUER: z.string().optional(),
  SAML_CERT: z.string().optional(),
});

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
    if (nodeEnv === 'production') {
      logger.error({ errors: result.error.format() }, 'Configuração inválida em produção. Abortando.');
      process.exit(1);
    }
    logger.warn({ errors: result.error.format() }, 'Configuração parcial, usando defaults (apenas desenvolvimento)');
    config = authConfigSchema.parse({});
  }
} catch (error) {
  if (nodeEnv === 'production') {
    logger.error({ error }, 'Falha crítica ao carregar configuração em produção. Abortando.');
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
// PROMETHEUS: Instrumentação de métricas (Regra 16 - Observability Enterprise)
// ============================================================================
const { metrics, metricsRouter, httpMetricsMiddleware } = createAlicePrometheus({
  serviceName: 'auth-service',
  collectDefaultMetrics: true,
});

// Endpoint /metrics para Prometheus scraper (antes de outros middlewares)
app.use(metricsRouter);

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

const authActiveSessionsGauge = new PromGauge({
  name: 'alice_auth_active_sessions',
  help: 'Número de sessões ativas',
  registers: [metrics.registry],
});

const authMetrics = {
  attempts: { google: 0, github: 0, microsoft: 0, saml: 0, local: 0 },
  successes: { google: 0, github: 0, microsoft: 0, saml: 0, local: 0 },
  failures: { google: 0, github: 0, microsoft: 0, saml: 0, local: 0 },
  lastSuccess: { google: null, github: null, microsoft: null, saml: null, local: null } as Record<string, Date | null>,
  lastFailure: { google: null, github: null, microsoft: null, saml: null, local: null } as Record<string, Date | null>,
};

function recordAuthAttempt(provider: 'google' | 'github' | 'microsoft' | 'saml' | 'local', success: boolean): void {
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
// ESTRATÉGIA: Autenticação Local (Email/Senha)
// ============================================================================

passport.use(new LocalStrategy(
  {
    usernameField: 'email',
    passwordField: 'password',
  },
  async (email, password, done) => {
    try {
      const db = getDatabase();
      const user = await db.query.users.findFirst({
        where: eq(schema.users.email, email.toLowerCase()),
      });

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

      // Atualizar último acesso
      await db.update(schema.users)
        .set({ ultimoAcesso: new Date() })
        .where(eq(schema.users.id, user.id));

      recordAuthAttempt('local', true);
      logger.info({ userId: user.id, email }, 'Login local bem-sucedido');
      return done(null, toAuthContext(user));
    } catch (error) {
      recordAuthAttempt('local', false);
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

        // Buscar usuário por googleId ou email
        let user = await db.query.users.findFirst({
          where: or(
            eq(schema.users.googleId, googleId),
            eq(schema.users.email, email)
          ),
        });

        if (!user) {
          // Criar novo usuário
          const [newUser] = await db.insert(schema.users).values({
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
          user = newUser;
          logger.info({ userId: user.id, email }, 'Novo usuário criado via Google');
          
          // Identity Provisioning: Sincronizar usuário com Grafana/ERPNext
          publishProvisioningEvent('user.created', {
            userId: user.id,
            email: user.email || email,
            firstName: user.firstName || undefined,
            lastName: user.lastName || undefined,
            role: user.role || 'viewer',
            tenantId: user.tenantId || undefined,
          }).catch((error) => {
            logger.error({ error, userId: user.id }, 'Erro ao publicar evento de provisioning');
          });
        } else if (!user.googleId) {
          // Vincular conta Google existente
          await db.update(schema.users)
            .set({ 
              googleId,
              profileImageUrl: user.profileImageUrl || profile.photos?.[0]?.value,
              emailVerified: true,
              ultimoAcesso: new Date(),
            })
            .where(eq(schema.users.id, user.id));
          logger.info({ userId: user.id, email }, 'Conta Google vinculada a usuário existente');
        } else {
          // Atualizar último acesso
          await db.update(schema.users)
            .set({ ultimoAcesso: new Date() })
            .where(eq(schema.users.id, user.id));
        }

        recordAuthAttempt('google', true);
        return done(null, toAuthContext(user));
      } catch (error) {
        recordAuthAttempt('google', false);
        logger.error({ error }, 'Erro na autenticação Google');
        return done(error as Error);
      }
    }
  ));
  logger.info('OAuth Google configurado');
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

        // Buscar usuário por githubId ou email
        let user = await db.query.users.findFirst({
          where: or(
            eq(schema.users.githubId, githubId),
            eq(schema.users.email, email)
          ),
        });

        if (!user) {
          // Criar novo usuário
          const displayName = profile.displayName || profile.username || '';
          const [newUser] = await db.insert(schema.users).values({
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
          user = newUser;
          logger.info({ userId: user.id, email }, 'Novo usuário criado via GitHub');
          
          // Identity Provisioning: Sincronizar usuário com Grafana/ERPNext
          publishProvisioningEvent('user.created', {
            userId: user.id,
            email: user.email || email,
            firstName: user.firstName || undefined,
            lastName: user.lastName || undefined,
            role: user.role || 'viewer',
            tenantId: user.tenantId || undefined,
          }).catch((error) => {
            logger.error({ error, userId: user.id }, 'Erro ao publicar evento de provisioning');
          });
        } else if (!user.githubId) {
          // Vincular conta GitHub existente
          await db.update(schema.users)
            .set({ 
              githubId,
              profileImageUrl: user.profileImageUrl || profile.photos?.[0]?.value,
              emailVerified: true,
              ultimoAcesso: new Date(),
            })
            .where(eq(schema.users.id, user.id));
          logger.info({ userId: user.id, email }, 'Conta GitHub vinculada a usuário existente');
        } else {
          await db.update(schema.users)
            .set({ ultimoAcesso: new Date() })
            .where(eq(schema.users.id, user.id));
        }

        recordAuthAttempt('github', true);
        return done(null, toAuthContext(user));
      } catch (error) {
        recordAuthAttempt('github', false);
        logger.error({ error }, 'Erro na autenticação GitHub');
        return done(error as Error);
      }
    }
  ));
  logger.info('OAuth GitHub configurado');
} else {
  logger.warn('OAuth GitHub não configurado - GITHUB_CLIENT_ID ou GITHUB_CLIENT_SECRET ausentes');
}

// ============================================================================
// ESTRATÉGIA: OAuth Microsoft (DESABILITADO - aguardando credenciais)
// ============================================================================
// TODO: Quando as credenciais Microsoft estiverem disponíveis:
// 1. Descomentar import do passport-microsoft no topo do arquivo
// 2. Descomentar e implementar a estratégia abaixo
// 3. Adicionar MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT_ID aos secrets

const microsoftClientId = process.env.MICROSOFT_CLIENT_ID;
const microsoftClientSecret = process.env.MICROSOFT_CLIENT_SECRET;

if (microsoftClientId && microsoftClientSecret) {
  // Credenciais detectadas mas implementação ainda não ativada
  logger.warn('Credenciais Microsoft detectadas mas OAuth Microsoft ainda não implementado - aguardando ativação');
} else {
  logger.info('OAuth Microsoft desabilitado - credenciais não configuradas');
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

        // Buscar usuário por samlNameId ou email
        let user = await db.query.users.findFirst({
          where: or(
            eq(schema.users.samlNameId, samlNameId),
            eq(schema.users.email, email)
          ),
        });

        if (!user) {
          // Criar novo usuário
          const displayName = typeof profile.displayName === 'string' ? profile.displayName : '';
          const firstName = (profile.firstName as string) || displayName.split(' ')[0] || '';
          const lastName = (profile.lastName as string) || displayName.split(' ').slice(1).join(' ') || '';
          
          const [newUser] = await db.insert(schema.users).values({
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
          user = newUser;
          logger.info({ userId: user.id, email }, 'Novo usuário criado via SAML');
          
          // Identity Provisioning: Sincronizar usuário com Grafana/ERPNext
          publishProvisioningEvent('user.created', {
            userId: user.id,
            email: user.email || email,
            firstName: user.firstName || undefined,
            lastName: user.lastName || undefined,
            role: user.role || 'viewer',
            tenantId: user.tenantId || undefined,
          }).catch((error) => {
            logger.error({ error, userId: user.id }, 'Erro ao publicar evento de provisioning');
          });
        } else if (!user.samlNameId) {
          // Vincular conta SAML existente
          await db.update(schema.users)
            .set({ 
              samlNameId,
              emailVerified: true,
              ultimoAcesso: new Date(),
            })
            .where(eq(schema.users.id, user.id));
          logger.info({ userId: user.id, email }, 'Conta SAML vinculada a usuário existente');
        } else {
          await db.update(schema.users)
            .set({ ultimoAcesso: new Date() })
            .where(eq(schema.users.id, user.id));
        }

        recordAuthAttempt('saml', true);
        return done(null, toAuthContext(user) as unknown as Record<string, unknown>);
      } catch (error) {
        recordAuthAttempt('saml', false);
        logger.error({ error }, 'Erro na autenticação SAML');
        return done(error as Error);
      }
    },
    () => { /* logout callback - não usado */ }
  ));
  logger.info('SAML 2.0 configurado');
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
    microsoft: !!microsoftClientId,
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

    // Remover campos sensíveis
    const { passwordHash, ...safeUser } = user;
    
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
// ROTAS: OAuth Microsoft (DESABILITADO - aguardando credenciais)
// ============================================================================
// Rotas serão habilitadas quando as credenciais Microsoft estiverem disponíveis

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
      // Microsoft OAuth desabilitado - aguardando credenciais
      // { id: 'microsoft', name: 'Microsoft', enabled: false },
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
app.post('/api/auth/modules', requireAuth(), requireRole(['super_admin', 'admin']), asyncHandler(async (req: Request, res: Response) => {
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
app.patch('/api/auth/modules/:id', requireAuth(), requireRole(['super_admin', 'admin']), asyncHandler(async (req: Request, res: Response) => {
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
app.delete('/api/auth/modules/:id', requireAuth(), requireRole(['super_admin']), asyncHandler(async (req: Request, res: Response) => {
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
app.post('/api/auth/modules/assign', requireAuth(), requireRole(['super_admin', 'admin']), asyncHandler(async (req: Request, res: Response) => {
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
app.post('/api/auth/modules/role/assign', requireAuth(), requireRole(['super_admin']), asyncHandler(async (req: Request, res: Response) => {
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
      microsoft: !!microsoftClientId,
      saml: !!(samlEntryPoint && samlIssuer && samlCert),
    }
  }, 'Provedores de autenticação disponíveis');
  
  // Identity Provisioning: Sincronização Alice → Grafana/ERPNext
  // Processa eventos de criação/atualização/deleção de usuários via Outbox Pattern
  startIdentityProvisioning()
    .then(() => {
      logger.info('Identity Provisioning iniciado - sincronização com Grafana/ERPNext ativa');
    })
    .catch((error) => {
      logger.error({ error }, 'Falha ao iniciar Identity Provisioning (não crítico)');
    });
});

// SEGURANÇA: Timeouts para prevenir conexões pendentes (Node.js 20 LTS Best Practices)
server.timeout = 30000; // 30s timeout para requisições
server.keepAliveTimeout = 65000; // 65s (maior que ALB timeout padrão de 60s)
server.headersTimeout = 66000; // Ligeiramente maior que keepAliveTimeout

// GRACEFUL SHUTDOWN (Enterprise-Grade - Regra 16 replit.md)
// Usamos process.once() em vez de process.on() para evitar listeners duplicados
const gracefulShutdown = async (signal: string) => {
  logger.info({ signal }, `Encerrando auth service (${signal})...`);
  
  // Parar Identity Provisioning primeiro
  try {
    await stopIdentityProvisioning();
    logger.info('Identity Provisioning parado');
  } catch (error) {
    logger.error({ error }, 'Erro ao parar Identity Provisioning');
  }
  
  server.close(() => {
    logger.info('HTTP server fechado');
    process.exit(0);
  });
};

process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
