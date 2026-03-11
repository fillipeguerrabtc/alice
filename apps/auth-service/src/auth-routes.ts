import bcrypt from 'bcrypt';
import type { Request } from 'express';
import type express from 'express';
import rateLimit from 'express-rate-limit';
import type { PassportStatic } from 'passport';
import type { createLogger } from '@alice/logger';
import { eq } from '@alice/database';
import { getDatabase, schema, isPoolHealthy } from '@alice/database';
import { invalidateUserPermissions } from '@alice/shared-utils';
import { z } from 'zod';
import type { publishProvisioningEvent } from './identity-provisioning/index.js';
import type { AuthProviderRuntime } from './auth-providers.js';
import { buildAuthContext, type DbUser } from './rbac/role-assignments.js';
import { registerAuthBiometricsRoutes } from './routes/auth-biometrics-routes.js';
import { registerAuthPasswordRoutes } from './routes/auth-password-routes.js';
import { registerAuthProviderRoutes } from './routes/auth-provider-routes.js';
import { registerAuthRegistrationRoutes } from './routes/auth-registration-routes.js';
import { registerAuthSystemRoutes } from './routes/auth-system-routes.js';
import { registerRbacAdminRoutes } from './routes/rbac-admin-routes.js';
import { registerUserManagementRoutes } from './routes/user-management-routes.js';

interface RegisterAuthServiceRoutesParams {
  app: express.Express;
  logger: ReturnType<typeof createLogger>;
  passport: PassportStatic;
  providerRuntime: AuthProviderRuntime;
  publishProvisioningEvent: typeof publishProvisioningEvent;
  defaultTenantDomain: string;
  getOrCreateCsrfToken: (sessionData: Request['session']) => string;
  biometricsServiceUrl?: string;
  internalApiSecret?: string;
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

export function registerAuthServiceRoutes(params: RegisterAuthServiceRoutesParams): void {
  const {
    app,
    logger,
    passport,
    providerRuntime,
    publishProvisioningEvent,
    defaultTenantDomain,
    getOrCreateCsrfToken,
    biometricsServiceUrl,
    internalApiSecret,
  } = params;

  registerAuthSystemRoutes(app, {
    logger,
    getConfiguredProviders: () => ({
      local: true,
      google: providerRuntime.googleEnabled,
      github: providerRuntime.githubEnabled,
      saml: providerRuntime.samlEnabled,
    }),
    getAuthMetrics: providerRuntime.getAuthMetrics,
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
    getOrCreateCsrfToken,
  });

  const loginSchema = z.object({
    email: z.string()
      .email('Email inválido')
      .transform((value) => value.toLowerCase().trim()),
    password: z.string()
      .min(1, 'Senha é obrigatória'),
  });

  const loginRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: 'Muitas tentativas de login. Aguarde 1 minuto.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const email = req.body?.email || '';
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      return `${ip}-${email}`;
    },
    validate: {
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

  const callBiometricsService = async <T>(endpoint: string, body: Record<string, unknown>): Promise<T> => {
    if (!biometricsServiceUrl || !internalApiSecret) {
      throw new BiometricsServiceError('Biometria nao configurada.', 503);
    }

    const response = await fetch(`${biometricsServiceUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Secret': internalApiSecret,
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
  };

  const validateLogin = (req: Request, res: express.Response, next: express.NextFunction): void => {
    const parseResult = loginSchema.safeParse(req.body);

    if (!parseResult.success) {
      const errors = parseResult.error.errors.map((error) => error.message);
      res.status(400).json({
        error: 'Dados de login inválidos',
        details: errors,
      });
      return;
    }

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
    googleEnabled: providerRuntime.googleEnabled,
    githubEnabled: providerRuntime.githubEnabled,
    samlEnabled: providerRuntime.samlEnabled,
    googleCallbackPath: providerRuntime.googleCallbackPath,
    githubCallbackPath: providerRuntime.githubCallbackPath,
  });

  registerAuthRegistrationRoutes(app, {
    logger,
    publishProvisioningEvent,
    defaultTenantDomain,
  });

  registerRbacAdminRoutes(app, {
    logger,
    googleEnabled: providerRuntime.googleEnabled,
    githubEnabled: providerRuntime.githubEnabled,
    samlEnabled: providerRuntime.samlEnabled,
  });

  registerUserManagementRoutes(app, {
    logger,
    publishProvisioningEvent,
    invalidateUserPermissions,
  });
}
