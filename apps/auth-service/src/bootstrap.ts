import type express from 'express';
import type { Server } from 'http';
import { closeDatabasePool, connectWithRetry } from '@alice/database';
import type { createLogger } from '@alice/logger';
import {
  registerShutdownCallback,
  ShutdownPriority,
} from '@alice/shared-utils';

interface AuthProvidersAvailability {
  local: boolean;
  google: boolean;
  github: boolean;
  saml: boolean;
}

interface StartAuthServiceParams {
  app: express.Express;
  port: number;
  logger: ReturnType<typeof createLogger>;
  providers: AuthProvidersAvailability;
  ensureGlobalAdmin: () => Promise<void>;
  ensurePermissionCatalog: () => Promise<void>;
  ensureOAuthClients: () => Promise<void>;
  startIdentityProvisioning: () => void;
  stopIdentityProvisioning: () => void;
}

export async function startAuthService(params: StartAuthServiceParams): Promise<Server> {
  const {
    app,
    port,
    logger,
    providers,
    ensureGlobalAdmin,
    ensurePermissionCatalog,
    ensureOAuthClients,
    startIdentityProvisioning,
    stopIdentityProvisioning,
  } = params;

  await connectWithRetry({
    maxRetries: 15,
    initialDelayMs: 2000,
    checkPgvector: true,
  });

  const server = app.listen(port, '0.0.0.0', () => {
    logger.info({ port }, 'Auth service iniciado');
    logger.info({ providers }, 'Provedores de autenticação disponíveis');

    ensureGlobalAdmin().catch((error) => {
      logger.error({ error }, 'Falha ao criar/atualizar administrador global');
    });

    ensurePermissionCatalog().catch((error) => {
      logger.error({ error }, 'Falha ao sincronizar catálogo de permissões');
    });

    ensureOAuthClients().catch((error) => {
      logger.error({ error }, 'Falha ao criar/atualizar clientes OAuth');
    });

    try {
      startIdentityProvisioning();
      logger.info('Identity Provisioning iniciado - sincronização com Grafana ativa');
    } catch (error: unknown) {
      logger.error({ error }, 'Falha ao iniciar Identity Provisioning (não crítico)');
    }
  });

  server.timeout = 30000;
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  registerShutdownCallback(
    'auth-identity-provisioning',
    async () => {
      logger.info('Parando Identity Provisioning...');
      stopIdentityProvisioning();
      logger.info('Identity Provisioning parado');
    },
    { priority: ShutdownPriority.BACKGROUND_JOBS },
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
    { priority: ShutdownPriority.HTTP_SERVER },
  );

  registerShutdownCallback(
    'auth-database-pool',
    async () => {
      logger.info('Encerrando pool de conexões database...');
      await closeDatabasePool();
      logger.info('Pool de conexões encerrado com sucesso');
    },
    { priority: ShutdownPriority.DATABASE },
  );

  return server;
}
