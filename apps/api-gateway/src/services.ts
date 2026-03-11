import type { GatewayConfig, ServiceConfig } from './types.js';

export function buildServiceConfigs(config: GatewayConfig): ServiceConfig[] {
  return [
    {
      name: 'auth-service',
      url: config.AUTH_SERVICE_URL,
      healthPath: '/api/auth/health',
      pathPrefix: '/api/auth',
    },
    {
      name: 'chat-service',
      url: config.CHAT_SERVICE_URL,
      healthPath: '/api/chat/health',
      pathPrefix: '/api/chat',
    },
    {
      name: 'rag-service',
      url: config.RAG_SERVICE_URL,
      healthPath: '/api/rag/health',
      pathPrefix: '/api/rag',
    },
    {
      name: 'training-service',
      url: config.TRAINING_SERVICE_URL,
      healthPath: '/api/training/health',
      pathPrefix: '/api/training',
    },
    {
      name: 'integrations-service',
      url: config.INTEGRATIONS_SERVICE_URL,
      healthPath: '/api/integrations/health',
      pathPrefix: '/api/integrations',
    },
    {
      name: 'observability-service',
      url: config.OBSERVABILITY_SERVICE_URL,
      healthPath: '/health',
      pathPrefix: '/api/observability',
    },
  ];
}

export function resolveIntegrationsService(services: ServiceConfig[]): ServiceConfig | null {
  return services.find((service) => service.name === 'integrations-service') ?? null;
}
