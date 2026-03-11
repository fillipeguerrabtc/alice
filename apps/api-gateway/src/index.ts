/**
 * Alice Enterprise Platform - API Gateway (Desenvolvimento)
 *
 * Gateway de desenvolvimento para orquestrar microserviços localmente.
 * Em produção, usar Caddy com a configuração em infra/docker/Caddyfile
 *
 * Funcionalidades:
 * - Rate limiting (Regra 16 - Best Practices 2025)
 * - Health checks agregados
 * - Circuit breaker para resiliência
 * - Proxy reverso para microserviços
 * - Logging centralizado via Pino
 *
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import express from 'express';
import { createLogger } from '@alice/logger';
import { startGatewayServer } from './bootstrap.js';
import { registerGatewayErrorHandlers } from './error-handlers.js';
import { createServiceCircuitBreakers, registerHealthRoutes } from './health.js';
import {
  configureCoreMiddleware,
  registerAuthRateLimiters,
  registerRequestLogger,
} from './middleware.js';
import { registerGatewayProxies } from './proxy.js';
import { resolveGatewayRuntimeConfig } from './runtime-config.js';
import { buildServiceConfigs, resolveIntegrationsService } from './services.js';
import { registerGatewayShutdownCallbacks } from './shutdown.js';

const logger = createLogger('api-gateway');

let runtimeState: ReturnType<typeof resolveGatewayRuntimeConfig>;

try {
  runtimeState = resolveGatewayRuntimeConfig(logger);
} catch (error) {
  logger.error({ error }, 'Falha crítica ao carregar configuração do API Gateway. Abortando.');
  process.exit(1);
}

const {
  config,
  validatedCorsOrigins,
  nodeEnv,
} = runtimeState;

const app: express.Application = express();

configureCoreMiddleware({
  app,
  config,
  validatedCorsOrigins,
  logger,
});

const services = buildServiceConfigs(config);
const integrationsService = resolveIntegrationsService(services);

if (!integrationsService) {
  logger.error('Serviço integrations-service não configurado no API Gateway.');
  if (nodeEnv === 'production') {
    process.exit(1);
  }
}

const circuitBreakers = createServiceCircuitBreakers(services);

registerHealthRoutes(app, services, circuitBreakers);
registerRequestLogger(app, logger);
registerAuthRateLimiters(app);

registerGatewayProxies({
  app,
  services,
  integrationsService,
  logger,
});

registerGatewayErrorHandlers(app, logger);

const server = startGatewayServer({
  app,
  port: config.PORT,
  services,
  logger,
});

registerGatewayShutdownCallbacks({
  server,
  circuitBreakers,
  logger,
});

export { app, server };
