/**
 * Alice Enterprise Platform - Configuração OpenAPI/Swagger
 * 
 * Configuração base para documentação OpenAPI 3.0 de todos os serviços.
 * Resolve OWASP API9 (Improper Inventory Management).
 * 
 * Author: Fillipe Guerra
 * Data: 05/12/2025
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 * Melhores Práticas 2025 (Regra 11 replit.md)
 */

import { Express, Request, Response } from 'express';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { createLogger } from '@alice/logger';

const logger = createLogger('openapi');

// ============================================================================
// TIPOS E INTERFACES
// ============================================================================

export interface OpenApiServiceConfig {
  /** Nome do serviço (ex: 'auth-service') */
  serviceName: string;
  /** Versão da API (ex: '1.0.0') */
  version: string;
  /** Descrição do serviço em PT-BR */
  description: string;
  /** Porta do serviço */
  port: number;
  /** Tags para agrupamento de endpoints */
  tags: OpenApiTag[];
  /** Caminhos para arquivos com JSDoc @openapi (glob patterns) */
  apis: string[];
}

export interface OpenApiTag {
  name: string;
  description: string;
}

// ============================================================================
// CONFIGURAÇÃO BASE
// ============================================================================

/**
 * Configuração base OpenAPI 3.0 para todos os serviços Alice
 */
export const baseOpenApiConfig = {
  openapi: '3.0.3',
  info: {
    title: 'Alice Enterprise API',
    version: '1.0.0',
    description: `
# Alice Enterprise Platform

Plataforma de IA Autônoma Enterprise com suporte a:
- Chat em tempo real com LLM (Llama 4 Maverick)
- RAG (Retrieval-Augmented Generation)
- Geração de imagens (FLUX.1 Schnell)
- Fine-tuning automatizado
- Integrações (Stripe, Wise, ERPNext)

## Autenticação

A API suporta múltiplos métodos de autenticação:
- **Cookie Session**: Para aplicações web (connect.sid)
- **Bearer Token**: Para APIs externas
- **API Key**: Para integrações S2S

## Rate Limiting

| Endpoint | Limite |
|----------|--------|
| Login/Register | 5/minuto |
| API geral | 100/minuto |
| WebSocket | 1000 msgs/minuto |

## Códigos de Erro

| Código | Descrição |
|--------|-----------|
| 400 | Requisição inválida |
| 401 | Não autenticado |
| 403 | Não autorizado |
| 404 | Recurso não encontrado |
| 429 | Rate limit excedido |
| 500 | Erro interno |

---
**Versão**: 1.0.0  
**Ambiente**: Produção  
**Base URL**: https://yesyoudeserve.duckdns.org
    `,
    contact: {
      name: 'Fillipe Guerra',
      email: 'suporte@alice.ai',
    },
    license: {
      name: 'Proprietary',
      url: 'https://alice.ai/license',
    },
  },
  servers: [
    {
      url: 'https://yesyoudeserve.duckdns.org',
      description: 'Produção (Hetzner)',
    },
    {
      url: 'http://localhost:{port}',
      description: 'Desenvolvimento Local',
      variables: {
        port: {
          default: '3001',
          description: 'Porta do serviço',
        },
      },
    },
  ],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'connect.sid',
        description: 'Cookie de sessão para autenticação web',
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token JWT para APIs',
      },
      apiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API Key para integrações S2S',
      },
      internalAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Internal-Secret',
        description: 'Secret interno entre microsserviços',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error', 'message'],
        properties: {
          error: {
            type: 'string',
            description: 'Código do erro',
            example: 'VALIDATION_ERROR',
          },
          message: {
            type: 'string',
            description: 'Mensagem descritiva do erro',
            example: 'Campo email é obrigatório',
          },
          details: {
            type: 'object',
            description: 'Detalhes adicionais do erro',
          },
        },
      },
      HealthCheck: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['healthy', 'degraded', 'unhealthy'],
            example: 'healthy',
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            example: '2025-12-05T10:00:00Z',
          },
          service: {
            type: 'string',
            example: 'auth-service',
          },
          version: {
            type: 'string',
            example: '1.0.0',
          },
          dependencies: {
            type: 'object',
            properties: {
              database: {
                type: 'string',
                enum: ['up', 'down'],
              },
              redis: {
                type: 'string',
                enum: ['up', 'down'],
              },
            },
          },
        },
      },
      Pagination: {
        type: 'object',
        properties: {
          page: {
            type: 'integer',
            minimum: 1,
            example: 1,
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            example: 20,
          },
          total: {
            type: 'integer',
            example: 150,
          },
          totalPages: {
            type: 'integer',
            example: 8,
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            example: '550e8400-e29b-41d4-a716-446655440000',
          },
          email: {
            type: 'string',
            format: 'email',
            example: 'usuario@empresa.com',
          },
          name: {
            type: 'string',
            example: 'João Silva',
          },
          role: {
            type: 'string',
            enum: ['guest', 'user', 'moderator', 'manager', 'admin', 'super_admin'],
            example: 'user',
          },
          tenantId: {
            type: 'string',
            format: 'uuid',
            nullable: true,
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: 'Não autenticado',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              error: 'UNAUTHORIZED',
              message: 'Autenticação necessária',
            },
          },
        },
      },
      Forbidden: {
        description: 'Não autorizado',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              error: 'FORBIDDEN',
              message: 'Permissão negada para este recurso',
            },
          },
        },
      },
      NotFound: {
        description: 'Recurso não encontrado',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              error: 'NOT_FOUND',
              message: 'Recurso não encontrado',
            },
          },
        },
      },
      ValidationError: {
        description: 'Erro de validação',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              error: 'VALIDATION_ERROR',
              message: 'Dados inválidos',
              details: {
                email: 'Formato de email inválido',
              },
            },
          },
        },
      },
      RateLimited: {
        description: 'Rate limit excedido',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              error: 'RATE_LIMITED',
              message: 'Muitas requisições. Tente novamente em 60 segundos.',
            },
          },
        },
      },
      InternalError: {
        description: 'Erro interno do servidor',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              error: 'INTERNAL_ERROR',
              message: 'Erro interno. Entre em contato com o suporte.',
            },
          },
        },
      },
    },
  },
  security: [
    { cookieAuth: [] },
    { bearerAuth: [] },
  ],
};

// ============================================================================
// FUNÇÕES DE SETUP
// ============================================================================

/**
 * Cria configuração OpenAPI específica para um serviço
 */
export function createServiceOpenApiConfig(config: OpenApiServiceConfig): swaggerJsdoc.Options {
  return {
    definition: {
      ...baseOpenApiConfig,
      info: {
        ...baseOpenApiConfig.info,
        title: `Alice API - ${config.serviceName}`,
        version: config.version,
        description: config.description,
      },
      servers: [
        {
          url: `https://yesyoudeserve.duckdns.org/api/${config.serviceName.replace('-service', '')}`,
          description: 'Produção via Traefik',
        },
        {
          url: `http://localhost:${config.port}`,
          description: 'Desenvolvimento Local',
        },
      ],
      tags: config.tags,
    },
    apis: config.apis,
  };
}

/**
 * Configura Swagger UI em uma aplicação Express
 * 
 * @param app - Aplicação Express
 * @param config - Configuração do serviço
 */
export function setupSwaggerUI(app: Express, config: OpenApiServiceConfig): void {
  try {
    const swaggerSpec = swaggerJsdoc(createServiceOpenApiConfig(config));
    
    // Endpoint para especificação JSON
    app.get('/api/docs/openapi.json', (_req: Request, res: Response) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(swaggerSpec);
    });
    
    // Swagger UI
    app.use(
      '/api/docs',
      swaggerUi.serve,
      swaggerUi.setup(swaggerSpec, {
        customCss: `
          .swagger-ui .topbar { display: none }
          .swagger-ui .info { margin: 20px 0 }
          .swagger-ui .info .title { color: #6366f1 }
        `,
        customSiteTitle: `${config.serviceName} - API Docs`,
        customfavIcon: '/favicon.ico',
        swaggerOptions: {
          persistAuthorization: true,
          displayRequestDuration: true,
          filter: true,
          showExtensions: true,
          showCommonExtensions: true,
          docExpansion: 'list',
        },
      })
    );
    
    logger.info({ 
      service: config.serviceName,
      docsUrl: `/api/docs`,
      specUrl: `/api/docs/openapi.json`,
    }, 'Swagger UI configurado com sucesso');
  } catch (error) {
    logger.error({ error, service: config.serviceName }, 'Erro ao configurar Swagger UI');
    throw error;
  }
}

// ============================================================================
// TAGS PRÉ-DEFINIDAS POR SERVIÇO
// ============================================================================

export const AUTH_SERVICE_TAGS: OpenApiTag[] = [
  { name: 'Auth', description: 'Autenticação e autorização' },
  { name: 'Users', description: 'Gerenciamento de usuários' },
  { name: 'Sessions', description: 'Gerenciamento de sessões' },
  { name: 'OAuth', description: 'Autenticação OAuth 2.0' },
  { name: 'SAML', description: 'Autenticação SAML 2.0' },
  { name: 'OIDC', description: 'OpenID Connect Provider' },
  { name: 'RBAC', description: 'Controle de acesso baseado em papéis' },
  { name: 'Feature Flags', description: 'Gerenciamento de feature flags' },
  { name: 'Health', description: 'Health checks e métricas' },
];

export const CHAT_SERVICE_TAGS: OpenApiTag[] = [
  { name: 'Chat', description: 'Mensagens e conversas' },
  { name: 'WebSocket', description: 'Comunicação em tempo real' },
  { name: 'LLM', description: 'Interação com modelo de linguagem' },
  { name: 'Image Generation', description: 'Geração de imagens com FLUX.1' },
  { name: 'Takeover', description: 'Controle humano de conversas' },
  { name: 'Health', description: 'Health checks e métricas' },
];

export const RAG_SERVICE_TAGS: OpenApiTag[] = [
  { name: 'Documents', description: 'Upload e processamento de documentos' },
  { name: 'Search', description: 'Busca semântica' },
  { name: 'Embeddings', description: 'Geração de embeddings' },
  { name: 'Chunks', description: 'Gerenciamento de chunks' },
  { name: 'Health', description: 'Health checks e métricas' },
];

export const TRAINING_SERVICE_TAGS: OpenApiTag[] = [
  { name: 'Training Jobs', description: 'Jobs de treinamento' },
  { name: 'Datasets', description: 'Gerenciamento de datasets' },
  { name: 'Models', description: 'Versões de modelos' },
  { name: 'Auto-Learning', description: 'Aprendizado automático' },
  { name: 'Health', description: 'Health checks e métricas' },
];

export const INTEGRATIONS_SERVICE_TAGS: OpenApiTag[] = [
  { name: 'Stripe', description: 'Integração com Stripe' },
  { name: 'Wise', description: 'Integração com Wise' },
  { name: 'ERPNext', description: 'Integração com ERPNext' },
  { name: 'Twilio', description: 'Integração com Twilio (SMS/WhatsApp)' },
  { name: 'Resend', description: 'Integração com Resend (Email)' },
  { name: 'Webhooks', description: 'Recebimento de webhooks' },
  { name: 'Health', description: 'Health checks e métricas' },
];

export const OBSERVABILITY_SERVICE_TAGS: OpenApiTag[] = [
  { name: 'Backup', description: 'Gerenciamento de backups' },
  { name: 'Restore', description: 'Restauração de backups' },
  { name: 'Metrics', description: 'Métricas e dashboards' },
  { name: 'Alerts', description: 'Alertas e notificações' },
  { name: 'Health', description: 'Health checks agregados' },
];

// ============================================================================
// EXPORTS
// ============================================================================

export {
  swaggerJsdoc,
  swaggerUi,
};
