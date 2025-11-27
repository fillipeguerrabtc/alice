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
 */

import express, { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import cors from 'cors';
import helmet from 'helmet';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { Strategy as MicrosoftStrategy } from './types/passport-microsoft';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as SamlStrategy, Profile as SamlProfile, VerifiedCallback } from '@node-saml/passport-saml';
import bcrypt from 'bcrypt';
import pino from 'pino';
import pg from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../../../packages/shared/src/schema';
import { eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { 
  requirePermission, 
  requireAuth,
  requireRole,
} from '../../../packages/shared-utils/src/rbac/middleware.js';

const { Pool } = pg;

const logger = pino({
  name: 'auth-service',
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: { colorize: true },
  } : undefined,
});

let poolInstance: pg.Pool | null = null;
let dbInstance: NodePgDatabase<typeof schema> | null = null;

function getPool(): pg.Pool {
  if (!poolInstance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL é obrigatório');
    }
    poolInstance = new Pool({ 
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }
  return poolInstance;
}

function getDatabase(): NodePgDatabase<typeof schema> {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema });
  }
  return dbInstance;
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

// Middleware de segurança
app.use(helmet());

// CORS configurado para desenvolvimento e produção
const corsOrigins = process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5000'];
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuração de sessão com PostgreSQL
const PgSession = connectPgSimple(session);
const pool = getPool();

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
    secure: config.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
    sameSite: 'lax',
  },
  name: 'alice.sid',
}));

// Inicializar Passport
app.use(passport.initialize());
app.use(passport.session());

// Serialização de usuário para sessão
passport.serializeUser((user: Express.User, done) => {
  done(null, (user as { id: string }).id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const db = getDatabase();
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, id),
    });
    done(null, user || null);
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
// MÉTRICAS DE AUTENTICAÇÃO
// Monitoramento de resiliência para provedores OAuth/SAML
// ============================================================================

const authMetrics = {
  attempts: { google: 0, github: 0, microsoft: 0, saml: 0, local: 0 },
  successes: { google: 0, github: 0, microsoft: 0, saml: 0, local: 0 },
  failures: { google: 0, github: 0, microsoft: 0, saml: 0, local: 0 },
  lastSuccess: { google: null, github: null, microsoft: null, saml: null, local: null } as Record<string, Date | null>,
  lastFailure: { google: null, github: null, microsoft: null, saml: null, local: null } as Record<string, Date | null>,
};

function recordAuthAttempt(provider: 'google' | 'github' | 'microsoft' | 'saml' | 'local', success: boolean): void {
  authMetrics.attempts[provider]++;
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
      return done(null, user);
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
        return done(null, user);
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
        return done(null, user);
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
// ESTRATÉGIA: OAuth Microsoft
// ============================================================================

const microsoftClientId = process.env.MICROSOFT_CLIENT_ID;
const microsoftClientSecret = process.env.MICROSOFT_CLIENT_SECRET;
const microsoftTenantId = process.env.MICROSOFT_TENANT_ID || 'common';

if (microsoftClientId && microsoftClientSecret) {
  passport.use(new MicrosoftStrategy(
    {
      clientID: microsoftClientId,
      clientSecret: microsoftClientSecret,
      callbackURL: `${getBaseUrl()}/api/auth/microsoft/callback`,
      scope: ['user.read', 'openid', 'profile', 'email'],
      tenant: microsoftTenantId,
    },
    async (accessToken: string, refreshToken: string, profile: { id: string; displayName?: string; emails?: { value: string }[] }, done: (error: Error | null, user?: Express.User) => void) => {
      try {
        const db = getDatabase();
        const email = profile.emails?.[0]?.value?.toLowerCase();
        const microsoftId = profile.id;

        if (!email) {
          recordAuthAttempt('microsoft', false);
          logger.error({ microsoftId }, 'Email não encontrado no perfil Microsoft');
          return done(new Error('Email não disponível no perfil Microsoft'));
        }

        // Buscar usuário por microsoftId ou email
        let user = await db.query.users.findFirst({
          where: or(
            eq(schema.users.microsoftId, microsoftId),
            eq(schema.users.email, email)
          ),
        });

        if (!user) {
          // Criar novo usuário
          const displayName = profile.displayName || '';
          const [newUser] = await db.insert(schema.users).values({
            email,
            firstName: displayName.split(' ')[0],
            lastName: displayName.split(' ').slice(1).join(' ') || null,
            microsoftId,
            authProvider: 'microsoft',
            emailVerified: true,
            role: 'viewer',
            idioma: 'pt-BR',
            timezone: 'Europe/Lisbon',
          }).returning();
          user = newUser;
          logger.info({ userId: user.id, email }, 'Novo usuário criado via Microsoft');
        } else if (!user.microsoftId) {
          // Vincular conta Microsoft existente
          await db.update(schema.users)
            .set({ 
              microsoftId,
              emailVerified: true,
              ultimoAcesso: new Date(),
            })
            .where(eq(schema.users.id, user.id));
          logger.info({ userId: user.id, email }, 'Conta Microsoft vinculada a usuário existente');
        } else {
          await db.update(schema.users)
            .set({ ultimoAcesso: new Date() })
            .where(eq(schema.users.id, user.id));
        }

        recordAuthAttempt('microsoft', true);
        return done(null, user);
      } catch (error) {
        recordAuthAttempt('microsoft', false);
        logger.error({ error }, 'Erro na autenticação Microsoft');
        return done(error as Error);
      }
    }
  ));
  logger.info('OAuth Microsoft configurado');
} else {
  logger.warn('OAuth Microsoft não configurado - MICROSOFT_CLIENT_ID ou MICROSOFT_CLIENT_SECRET ausentes');
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
        return done(null, user);
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
      where: eq(schema.users.id, (req.user as { id: string }).id),
      with: {
        tenant: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // Remover campos sensíveis
    const { passwordHash, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar usuário');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// ROTAS: Autenticação Local
// ============================================================================

app.post('/api/auth/register', async (req: Request, res: Response) => {
  const { email, password, firstName, lastName } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Senha deve ter pelo menos 8 caracteres' });
  }

  try {
    const db = getDatabase();
    
    // Verificar se email já existe
    const existingUser = await db.query.users.findFirst({
      where: eq(schema.users.email, email.toLowerCase()),
    });

    if (existingUser) {
      return res.status(409).json({ error: 'Email já cadastrado' });
    }

    // Hash da senha com bcrypt (custo 12 para segurança enterprise)
    const passwordHash = await bcrypt.hash(password, 12);

    // Criar novo usuário
    const [newUser] = await db.insert(schema.users).values({
      email: email.toLowerCase(),
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

    // Remover campos sensíveis
    const { passwordHash: _, ...safeUser } = newUser;
    res.status(201).json({ user: safeUser, message: 'Conta criada com sucesso' });
  } catch (error) {
    logger.error({ error }, 'Falha no registro');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/login', passport.authenticate('local'), (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Falha na autenticação' });
  }
  
  const user = req.user as { id: string; passwordHash?: string; [key: string]: unknown };
  const { passwordHash, ...safeUser } = user;
  res.json({ user: safeUser });
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
// ROTAS: OAuth Microsoft
// ============================================================================

if (microsoftClientId) {
  app.get('/api/auth/microsoft', passport.authenticate('microsoft', {
    prompt: 'select_account'
  }));

  app.get('/api/auth/microsoft/callback',
    passport.authenticate('microsoft', {
      failureRedirect: '/login?error=microsoft_auth_failed',
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
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, (req.user as { id: string }).id),
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // Buscar permissões da role
    const rolePermissions = await db.query.rolePermissions.findMany({
      where: eq(schema.rolePermissions.role, user.role || 'viewer'),
      with: {
        permission: true,
      },
    });

    const permissions = rolePermissions
      .map(rp => (rp as { permission?: { codigo?: string } }).permission?.codigo)
      .filter(Boolean);

    res.json({ 
      role: user.role, 
      permissions,
      canManageUsers: ['super_admin', 'admin'].includes(user.role || ''),
      canManageAgents: ['super_admin', 'admin', 'manager'].includes(user.role || ''),
      canViewReports: ['super_admin', 'admin', 'manager', 'operator'].includes(user.role || ''),
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
      { id: 'microsoft', name: 'Microsoft', enabled: !!microsoftClientId },
      { id: 'saml', name: 'SSO Empresarial (SAML)', enabled: !!(samlEntryPoint && samlIssuer && samlCert) },
    ].filter(p => p.enabled)
  });
});

// ============================================================================
// ROTAS: Audit Logs (Atividades Recentes)
// ============================================================================

app.get('/api/audit/recent', async (req: Request, res: Response) => {
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

    const activities = recentAudit.map(log => ({
      id: log.id,
      action: log.acao,
      resource: log.recurso,
      resourceId: log.recursoId,
      details: log.detalhes,
      ipAddress: log.ip,
      timestamp: log.criadoEm,
      user: log.user ? {
        id: log.user.id,
        name: `${log.user.firstName || ''} ${log.user.lastName || ''}`.trim() || log.user.email,
      } : null,
    }));

    res.json(activities);
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar atividades recentes');
    res.json([]);
  }
});

// ============================================================================
// MIDDLEWARE: Error Handler
// ============================================================================

const errorHandler = (err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err }, 'Erro não tratado');
  res.status(500).json({ error: 'Erro interno do servidor' });
};

app.use(errorHandler);

// ============================================================================
// INICIAR SERVIDOR
// ============================================================================

const PORT = config.PORT || 3001;

app.listen(PORT, '0.0.0.0', () => {
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
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Encerrando auth service...');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Encerrando auth service (SIGINT)...');
  process.exit(0);
});
