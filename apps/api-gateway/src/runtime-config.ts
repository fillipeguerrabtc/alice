import {
  getNodeEnv,
  getOptionalServiceUrl,
  resolveBaseUrl,
  resolveCorsOrigins,
} from '@alice/config';
import { z } from 'zod';
import type { RuntimeNodeEnv } from '@alice/config';
import type { GatewayConfig, GatewayLogger, GatewayRuntimeConfig } from './types.js';

const gatewayRuntimeConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
});

const developmentServiceFallbacks = {
  auth: 'http://localhost:3001',
  chat: 'http://localhost:3002',
  rag: 'http://localhost:3003',
  training: 'http://localhost:3004',
  integrations: 'http://localhost:3005',
  observability: 'http://localhost:3006',
} as const;

type GatewayServiceName = keyof typeof developmentServiceFallbacks;

export interface GatewayRuntimeState {
  config: GatewayConfig;
  validatedCorsOrigins: string[];
  nodeEnv: RuntimeNodeEnv;
}

function resolveGatewayServiceUrl(serviceName: GatewayServiceName, nodeEnv: RuntimeNodeEnv): string {
  const configuredUrl = getOptionalServiceUrl(serviceName);
  if (configuredUrl) {
    return configuredUrl;
  }

  if (nodeEnv === 'production') {
    throw new Error(`URL de serviço obrigatória ausente para ${serviceName} em produção`);
  }

  return developmentServiceFallbacks[serviceName];
}

export function resolveGatewayRuntimeConfig(logger: GatewayLogger): GatewayRuntimeState {
  const nodeEnv = getNodeEnv();
  const parsedRuntimeConfig = gatewayRuntimeConfigSchema.safeParse(process.env);

  let runtimeConfig: GatewayRuntimeConfig;
  if (!parsedRuntimeConfig.success) {
    if (nodeEnv === 'production') {
      logger.error(
        { errors: parsedRuntimeConfig.error.format() },
        'Configuração inválida em produção. Abortando (Regra 6 - fail-fast).'
      );
      throw new Error('Configuração inválida para API Gateway em produção');
    }

    logger.warn(
      { errors: parsedRuntimeConfig.error.format() },
      'Configuração parcial, usando defaults (apenas desenvolvimento)'
    );
    runtimeConfig = {
      NODE_ENV: 'development',
      PORT: 3000,
      RATE_LIMIT_WINDOW_MS: 60000,
      RATE_LIMIT_MAX_REQUESTS: 100,
    };
  } else {
    runtimeConfig = parsedRuntimeConfig.data;
  }

  const developmentBaseUrl = resolveBaseUrl({
    requiredInProduction: false,
    developmentFallback: 'http://localhost:5000',
  });

  const validatedCorsOrigins = resolveCorsOrigins({
    requiredInProduction: true,
    developmentFallback: [developmentBaseUrl],
  });

  return {
    nodeEnv,
    validatedCorsOrigins,
    config: {
      ...runtimeConfig,
      AUTH_SERVICE_URL: resolveGatewayServiceUrl('auth', nodeEnv),
      CHAT_SERVICE_URL: resolveGatewayServiceUrl('chat', nodeEnv),
      RAG_SERVICE_URL: resolveGatewayServiceUrl('rag', nodeEnv),
      TRAINING_SERVICE_URL: resolveGatewayServiceUrl('training', nodeEnv),
      INTEGRATIONS_SERVICE_URL: resolveGatewayServiceUrl('integrations', nodeEnv),
      OBSERVABILITY_SERVICE_URL: resolveGatewayServiceUrl('observability', nodeEnv),
    },
  };
}
