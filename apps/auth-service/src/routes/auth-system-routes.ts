import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';

interface ProvidersStatus {
  local: boolean;
  google: boolean;
  github: boolean;
  saml: boolean;
}

interface AuthMetricsSnapshot {
  attempts: Record<string, number>;
  successes: Record<string, number>;
  failures: Record<string, number>;
  lastSuccess: Record<string, Date | null>;
  lastFailure: Record<string, Date | null>;
}

interface AuthUser {
  userId: string;
}

type UserRecord = Record<string, unknown> & { passwordHash?: unknown };

interface RegisterAuthSystemRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  getConfiguredProviders: () => ProvidersStatus;
  getAuthMetrics: () => AuthMetricsSnapshot;
  isPoolHealthy: () => Promise<boolean>;
  getCurrentUserById: (userId: string) => Promise<UserRecord | null>;
  getOrCreateCsrfToken: (session: Request['session']) => string;
}

export function registerAuthSystemRoutes(
  app: Express,
  deps: RegisterAuthSystemRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('auth-service');
  const {
    getConfiguredProviders,
    getAuthMetrics,
    isPoolHealthy,
    getCurrentUserById,
    getOrCreateCsrfToken,
  } = deps;

  app.get('/api/auth/health', (_req: Request, res: Response) => {
    const configuredProviders = getConfiguredProviders();
    const totalConfigured = Object.values(configuredProviders).filter(Boolean).length;
    const metrics = getAuthMetrics();

    res.json({
      status: 'ok',
      service: 'auth-service',
      timestamp: new Date().toISOString(),
      providers: configuredProviders,
      metrics: {
        totalProvidersConfigured: totalConfigured,
        attempts: metrics.attempts,
        successes: metrics.successes,
        failures: metrics.failures,
        lastSuccess: metrics.lastSuccess,
        lastFailure: metrics.lastFailure,
      },
      note: 'OAuth/SAML usam redirecionamentos HTTP do navegador - circuit breakers não são aplicáveis para fluxos de redirecionamento',
    });
  });

  app.get('/live', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'alive',
      service: 'auth-service',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ready', async (_req: Request, res: Response) => {
    try {
      const dbHealthy = await isPoolHealthy();
      if (dbHealthy) {
        return res.status(200).json({
          status: 'ready',
          service: 'auth-service',
          timestamp: new Date().toISOString(),
          dependencies: {
            postgresql: 'ready',
          },
        });
      }

      return res.status(503).json({
        status: 'not_ready',
        service: 'auth-service',
        reason: 'PostgreSQL não está acessível',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgresql: 'not_ready',
        },
      });
    } catch (error) {
      logger.error({ error }, 'Erro ao verificar readiness');
      return res.status(503).json({
        status: 'not_ready',
        service: 'auth-service',
        reason: 'Erro ao verificar dependências',
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get('/api/auth/user', async (req: Request, res: Response) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    try {
      const auth = req.user as AuthUser;
      const user = await getCurrentUserById(auth.userId);
      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }

      const csrfToken = getOrCreateCsrfToken(req.session);
      const { passwordHash: _passwordHash, ...safeUser } = user;

      return res.json({
        user: safeUser,
        csrfToken,
      });
    } catch (error) {
      logger.error({ error }, 'Falha ao buscar usuário');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });
}
