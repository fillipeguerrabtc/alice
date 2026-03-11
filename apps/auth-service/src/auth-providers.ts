import bcrypt from 'bcrypt';
import { Strategy as SamlStrategy, type Profile as SamlProfile, type VerifiedCallback } from '@node-saml/passport-saml';
import { readOptionalStringEnv } from '@alice/config';
import { eq, or } from '@alice/database';
import { getDatabase, schema } from '@alice/database';
import type { createLogger } from '@alice/logger';
import {
  Counter as PromCounter,
  createCircuitBreaker,
  CIRCUIT_BREAKER_PRESETS,
  instrumentCircuitBreaker,
} from '@alice/shared-utils';
import type { PassportStatic } from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as LocalStrategy } from 'passport-local';
import type { publishProvisioningEvent } from './identity-provisioning/index.js';
import type { DbUser } from './rbac/role-assignments.js';
import { buildAuthContext } from './rbac/role-assignments.js';
import type { AuthPrometheusMetrics } from './auth-middlewares.js';

export interface AuthProvidersConfig {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  OAUTH_GITHUB_CLIENT_ID?: string;
  OAUTH_GITHUB_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SAML_ENTRY_POINT?: string;
  SAML_ISSUER?: string;
  SAML_CERT?: string;
}

export interface AuthMetricsSnapshot {
  attempts: Record<'google' | 'github' | 'saml' | 'local', number>;
  successes: Record<'google' | 'github' | 'saml' | 'local', number>;
  failures: Record<'google' | 'github' | 'saml' | 'local', number>;
  lastSuccess: Record<'google' | 'github' | 'saml' | 'local', Date | null>;
  lastFailure: Record<'google' | 'github' | 'saml' | 'local', Date | null>;
}

export interface AuthProviderRuntime {
  googleEnabled: boolean;
  githubEnabled: boolean;
  samlEnabled: boolean;
  googleCallbackPath: string;
  githubCallbackPath: string;
  getAuthMetrics: () => AuthMetricsSnapshot;
}

interface ConfigureAuthProvidersParams {
  passport: PassportStatic;
  logger: ReturnType<typeof createLogger>;
  config: AuthProvidersConfig;
  serviceBaseUrl: string;
  defaultTenantDomain: string;
  metrics: AuthPrometheusMetrics;
  publishProvisioningEvent: typeof publishProvisioningEvent;
}

export function configureAuthProviders(
  params: ConfigureAuthProvidersParams,
): AuthProviderRuntime {
  const {
    passport,
    logger,
    config,
    serviceBaseUrl,
    defaultTenantDomain,
    metrics,
    publishProvisioningEvent,
  } = params;

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

  const resolveOAuthCallbackUrl = (options: {
    envKey: string;
    defaultPath: string;
    expectedPathPrefix: string;
  }): string => {
    const callbackValue = readOptionalStringEnv(options.envKey);
    const defaultCallback = `${serviceBaseUrl}${options.defaultPath}`;

    if (!callbackValue) {
      return defaultCallback;
    }

    if (callbackValue.startsWith('/')) {
      if (!callbackValue.startsWith(options.expectedPathPrefix)) {
        logger.warn(
          { envKey: options.envKey, callbackValue, expectedPathPrefix: options.expectedPathPrefix },
          'Callback relativo fora do padrão esperado',
        );
      }
      return `${serviceBaseUrl}${callbackValue}`;
    }

    try {
      const parsed = new URL(callbackValue);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('protocolo inválido');
      }
      if (!parsed.pathname.startsWith(options.expectedPathPrefix)) {
        logger.warn(
          { envKey: options.envKey, callbackValue, expectedPathPrefix: options.expectedPathPrefix },
          'Callback absoluto fora do padrão esperado',
        );
      }
      return parsed.toString();
    } catch (error) {
      logger.warn(
        { envKey: options.envKey, callbackValue, error },
        'Callback inválido; usando callback padrão',
      );
      return defaultCallback;
    }
  };

  const getGoogleCallbackUrl = (): string => {
    return resolveOAuthCallbackUrl({
      envKey: 'OAUTH_CALLBACK_URL',
      defaultPath: '/api/auth/google/callback',
      expectedPathPrefix: '/api/auth/google/callback',
    });
  };

  const getGithubCallbackUrl = (): string => {
    return resolveOAuthCallbackUrl({
      envKey: 'OAUTH_GITHUB_CALLBACK_URL',
      defaultPath: '/api/auth/github/callback',
      expectedPathPrefix: '/api/auth/github/callback',
    });
  };

  const authAttemptsCounter = new PromCounter({
    name: 'alice_auth_attempts_total',
    help: 'Total de tentativas de autenticação',
    labelNames: ['provider', 'status'] as const,
    registers: [metrics.registry],
  });

  const authMetrics: AuthMetricsSnapshot = {
    attempts: { google: 0, github: 0, saml: 0, local: 0 },
    successes: { google: 0, github: 0, saml: 0, local: 0 },
    failures: { google: 0, github: 0, saml: 0, local: 0 },
    lastSuccess: { google: null, github: null, saml: null, local: null },
    lastFailure: { google: null, github: null, saml: null, local: null },
  };

  function recordAuthAttempt(provider: 'google' | 'github' | 'saml' | 'local', success: boolean): void {
    authMetrics.attempts[provider]++;

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
    },
  );

  instrumentCircuitBreaker(metrics, 'auth_db_user_lookup', dbUserLookupBreaker);

  const dbOAuthLookupBreaker = createCircuitBreaker(
    async (lookupParams: { googleId?: string; githubId?: string; email: string }): Promise<DbUser | undefined> => {
      const db = getDatabase();
      const conditions = [];
      if (lookupParams.googleId) {
        conditions.push(eq(schema.users.googleId, lookupParams.googleId));
      }
      if (lookupParams.githubId) {
        conditions.push(eq(schema.users.githubId, lookupParams.githubId));
      }
      conditions.push(eq(schema.users.email, lookupParams.email.toLowerCase()));

      return db.query.users.findFirst({
        where: or(...conditions),
      });
    },
    {
      name: 'auth-db-oauth-lookup',
      ...CIRCUIT_BREAKER_PRESETS.databasePool,
    },
  );

  instrumentCircuitBreaker(metrics, 'auth_db_oauth_lookup', dbOAuthLookupBreaker);

  const dbSamlLookupBreaker = createCircuitBreaker(
    async (lookupParams: { samlNameId: string; email: string }): Promise<DbUser | undefined> => {
      const db = getDatabase();
      return db.query.users.findFirst({
        where: or(
          eq(schema.users.samlNameId, lookupParams.samlNameId),
          eq(schema.users.email, lookupParams.email.toLowerCase()),
        ),
      });
    },
    {
      name: 'auth-db-saml-lookup',
      ...CIRCUIT_BREAKER_PRESETS.databasePool,
    },
  );

  instrumentCircuitBreaker(metrics, 'auth_db_saml_lookup', dbSamlLookupBreaker);

  const dbUserUpsertBreaker = createCircuitBreaker(
    async (operation: () => Promise<DbUser[]>): Promise<DbUser[]> => {
      return operation();
    },
    {
      name: 'auth-db-user-upsert',
      ...CIRCUIT_BREAKER_PRESETS.databasePool,
    },
  );

  instrumentCircuitBreaker(metrics, 'auth_db_user_upsert', dbUserUpsertBreaker);

  logger.info('Circuit breakers de autenticação inicializados (OAuth, SAML, Database)');

  passport.use(new LocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password',
    },
    async (email, password, done) => {
      try {
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
        if ((error as Error).message?.includes('Breaker is open')) {
          logger.error({ email }, 'Circuit breaker aberto - serviço de banco de dados indisponível');
          return done(new Error('Serviço temporariamente indisponível. Tente novamente em alguns segundos.'));
        }
        logger.error({ error, email }, 'Erro na autenticação local');
        return done(error as Error);
      }
    },
  ));

  const googleClientId = config.GOOGLE_CLIENT_ID;
  const googleClientSecret = config.GOOGLE_CLIENT_SECRET;
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
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const db = getDatabase();
          const email = profile.emails?.[0]?.value?.toLowerCase();
          const googleId = profile.id;

          if (!email) {
            recordAuthAttempt('google', false);
            logger.error({ googleId }, 'Email não encontrado no perfil Google');
            return done(new Error('Email não disponível no perfil Google'));
          }

          let user = await dbOAuthLookupBreaker.fire({ googleId, email });

          if (!user) {
            let defaultTenant = await db.query.tenants.findFirst({
              where: eq(schema.tenants.slug, 'alice-platform'),
            });

            if (!defaultTenant) {
              logger.warn('Tenant default não encontrado durante OAuth Google, criando...');
              const inserted = await db.insert(schema.tenants).values({
                nome: 'Alice Platform',
                slug: 'alice-platform',
                dominio: defaultTenantDomain,
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
                return done(new Error('Configuração do sistema incompleta'));
              }
            }

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
                tenantId: defaultTenant.id,
              }).returning();
            });

            user = newUser;
            const createdUserId = user.id;
            await db.insert(schema.userRoles).values({
              userId: createdUserId,
              role: 'guest',
            }).onConflictDoNothing();

            logger.info({ userId: createdUserId, email }, 'Novo usuário criado via Google');

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
          if ((error as Error).message?.includes('Breaker is open')) {
            logger.error({ provider: 'google' }, 'Circuit breaker aberto - serviço de autenticação indisponível');
            return done(new Error('Serviço temporariamente indisponível. Tente novamente em alguns segundos.'));
          }
          logger.error({ error }, 'Erro na autenticação Google');
          return done(error as Error);
        }
      },
    ));
    logger.info('OAuth Google configurado com circuit breaker');
  } else {
    logger.warn('OAuth Google não configurado - GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET ausentes');
  }

  const githubClientId = config.OAUTH_GITHUB_CLIENT_ID ?? config.GITHUB_CLIENT_ID;
  const githubClientSecret = config.OAUTH_GITHUB_CLIENT_SECRET ?? config.GITHUB_CLIENT_SECRET;
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
      async (_accessToken: string, _refreshToken: string, profile: {
        id: string;
        displayName?: string;
        username?: string;
        emails?: { value: string }[];
        photos?: { value: string }[];
      }, done: (error: Error | null, user?: Express.User) => void) => {
        try {
          const db = getDatabase();
          const email = profile.emails?.[0]?.value?.toLowerCase();
          const githubId = profile.id;

          if (!email) {
            recordAuthAttempt('github', false);
            logger.error({ githubId }, 'Email não encontrado no perfil GitHub');
            return done(new Error('Email não disponível no perfil GitHub'));
          }

          let user = await dbOAuthLookupBreaker.fire({ githubId, email });

          if (!user) {
            let defaultTenant = await db.query.tenants.findFirst({
              where: eq(schema.tenants.slug, 'alice-platform'),
            });

            if (!defaultTenant) {
              logger.warn('Tenant default não encontrado durante OAuth GitHub, criando...');
              const inserted = await db.insert(schema.tenants).values({
                nome: 'Alice Platform',
                slug: 'alice-platform',
                dominio: defaultTenantDomain,
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
                return done(new Error('Configuração do sistema incompleta'));
              }
            }

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
                tenantId: defaultTenant.id,
              }).returning();
            });

            user = newUser;
            const createdUserId = user.id;
            await db.insert(schema.userRoles).values({
              userId: createdUserId,
              role: 'guest',
            }).onConflictDoNothing();

            logger.info({ userId: createdUserId, email }, 'Novo usuário criado via GitHub');

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
          if ((error as Error).message?.includes('Breaker is open')) {
            logger.error({ provider: 'github' }, 'Circuit breaker aberto - serviço de autenticação indisponível');
            return done(new Error('Serviço temporariamente indisponível. Tente novamente em alguns segundos.'));
          }
          logger.error({ error }, 'Erro na autenticação GitHub');
          return done(error as Error);
        }
      },
    ));
    logger.info('OAuth GitHub configurado com circuit breaker');
  } else {
    logger.warn('OAuth GitHub não configurado - OAUTH_GITHUB_CLIENT_ID/GITHUB_CLIENT_ID ou OAUTH_GITHUB_CLIENT_SECRET/GITHUB_CLIENT_SECRET ausentes');
  }

  const samlEntryPoint = config.SAML_ENTRY_POINT;
  const samlIssuer = config.SAML_ISSUER;
  const samlCert = config.SAML_CERT;

  if (samlEntryPoint && samlIssuer && samlCert) {
    passport.use('saml', new SamlStrategy(
      {
        entryPoint: samlEntryPoint,
        issuer: samlIssuer,
        callbackUrl: `${serviceBaseUrl}/api/auth/saml/callback`,
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

          let user = await dbSamlLookupBreaker.fire({ samlNameId, email });

          if (!user) {
            let defaultTenant = await db.query.tenants.findFirst({
              where: eq(schema.tenants.slug, 'alice-platform'),
            });

            if (!defaultTenant) {
              logger.warn('Tenant default não encontrado durante SAML auth, criando...');
              const inserted = await db.insert(schema.tenants).values({
                nome: 'Alice Platform',
                slug: 'alice-platform',
                dominio: defaultTenantDomain,
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
                return done(new Error('Configuração do sistema incompleta'));
              }
            }

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
                tenantId: defaultTenant.id,
              }).returning();
            });

            user = newUser;
            const createdUserId = user.id;
            await db.insert(schema.userRoles).values({
              userId: createdUserId,
              role: 'guest',
            }).onConflictDoNothing();

            logger.info({ userId: createdUserId, email }, 'Novo usuário criado via SAML');

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
          if ((error as Error).message?.includes('Breaker is open')) {
            logger.error({ provider: 'saml' }, 'Circuit breaker aberto - serviço de autenticação indisponível');
            return done(new Error('Serviço temporariamente indisponível. Tente novamente em alguns segundos.'));
          }
          logger.error({ error }, 'Erro na autenticação SAML');
          return done(error as Error);
        }
      },
      () => { /* logout callback - não usado */ },
    ));
    logger.info('SAML 2.0 configurado com circuit breaker');
  } else {
    logger.warn('SAML 2.0 não configurado - SAML_ENTRY_POINT, SAML_ISSUER ou SAML_CERT ausentes');
  }

  return {
    googleEnabled: !!googleClientId,
    githubEnabled: !!githubClientId,
    samlEnabled: !!(samlEntryPoint && samlIssuer && samlCert),
    googleCallbackPath,
    githubCallbackPath,
    getAuthMetrics: () => ({
      attempts: { ...authMetrics.attempts },
      successes: { ...authMetrics.successes },
      failures: { ...authMetrics.failures },
      lastSuccess: { ...authMetrics.lastSuccess },
      lastFailure: { ...authMetrics.lastFailure },
    }),
  };
}
