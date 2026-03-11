/**
 * Alice Enterprise Platform - API Gateway OpenAPI Specs
 *
 * Contrato OpenAPI do gateway para endpoints próprios de health/operabilidade
 * e pontos de entrada de proxy HTTP.
 *
 * Author: Fillipe Guerra
 * Data: 11/03/2026
 */

const proxyPassthroughOperation = {
  summary: 'Proxy pass-through para serviço interno',
  description:
    'Encaminha a requisição para o microsserviço alvo preservando método, headers e payload. O contrato funcional detalhado deve ser consultado na spec do serviço de destino.',
  tags: ['Proxy'],
  responses: {
    200: { description: 'Resposta encaminhada do serviço alvo' },
    201: { description: 'Resposta encaminhada do serviço alvo' },
    202: { description: 'Resposta encaminhada do serviço alvo' },
    400: { $ref: '#/components/responses/ValidationError' },
    401: { $ref: '#/components/responses/Unauthorized' },
    403: { $ref: '#/components/responses/Forbidden' },
    404: { $ref: '#/components/responses/NotFound' },
    429: { $ref: '#/components/responses/RateLimited' },
    503: { description: 'Serviço de destino indisponível no gateway' },
  },
} as const;

export const apiGatewayPaths = {
  '/health': {
    get: {
      summary: 'Health check básico do gateway',
      tags: ['Health'],
      security: [],
      responses: {
        200: {
          description: 'Gateway saudável',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'ok' },
                  service: { type: 'string', example: 'api-gateway' },
                  timestamp: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
  },
  '/live': {
    get: {
      summary: 'Liveness probe do gateway',
      tags: ['Health'],
      security: [],
      responses: {
        200: { description: 'Gateway vivo' },
      },
    },
  },
  '/ready': {
    get: {
      summary: 'Readiness probe com status dos backends',
      tags: ['Health'],
      security: [],
      responses: {
        200: { description: 'Gateway pronto (ao menos um backend disponível)' },
        503: { description: 'Gateway não pronto (nenhum backend disponível)' },
      },
    },
  },
  '/api/health': {
    get: {
      summary: 'Health agregado do gateway e microsserviços',
      tags: ['Health'],
      security: [],
      responses: {
        200: {
          description: 'Todos os serviços monitorados saudáveis',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GatewayAggregatedHealth' },
            },
          },
        },
        503: {
          description: 'Estado degradado em um ou mais serviços monitorados',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GatewayAggregatedHealth' },
            },
          },
        },
      },
    },
  },
  '/metrics': {
    get: {
      summary: 'Métricas de circuit breaker do gateway',
      tags: ['Health'],
      security: [],
      responses: {
        200: { description: 'Métricas em formato text/plain' },
      },
    },
  },
  '/api/auth': {
    get: proxyPassthroughOperation,
    post: proxyPassthroughOperation,
    put: proxyPassthroughOperation,
    patch: proxyPassthroughOperation,
    delete: proxyPassthroughOperation,
  },
  '/api/chat': {
    get: proxyPassthroughOperation,
    post: proxyPassthroughOperation,
    put: proxyPassthroughOperation,
    patch: proxyPassthroughOperation,
    delete: proxyPassthroughOperation,
  },
  '/api/rag': {
    get: proxyPassthroughOperation,
    post: proxyPassthroughOperation,
    put: proxyPassthroughOperation,
    patch: proxyPassthroughOperation,
    delete: proxyPassthroughOperation,
  },
  '/api/training': {
    get: proxyPassthroughOperation,
    post: proxyPassthroughOperation,
    put: proxyPassthroughOperation,
    patch: proxyPassthroughOperation,
    delete: proxyPassthroughOperation,
  },
  '/api/integrations': {
    get: proxyPassthroughOperation,
    post: proxyPassthroughOperation,
    put: proxyPassthroughOperation,
    patch: proxyPassthroughOperation,
    delete: proxyPassthroughOperation,
  },
  '/api/observability': {
    get: proxyPassthroughOperation,
    post: proxyPassthroughOperation,
    put: proxyPassthroughOperation,
    patch: proxyPassthroughOperation,
    delete: proxyPassthroughOperation,
  },
  '/api/integrations/trading/signals/generate': {
    post: {
      ...proxyPassthroughOperation,
      summary: 'Proxy pass-through com timeout estendido para geração de sinais',
      description:
        'Encaminha para integrations-service com timeout de proxy estendido (long-running).',
    },
  },
  '/api/integrations/trading/analysis': {
    get: {
      ...proxyPassthroughOperation,
      summary: 'Proxy pass-through com timeout estendido para análise de trading',
      description:
        'Encaminha para integrations-service com timeout de proxy estendido (long-running).',
    },
    post: {
      ...proxyPassthroughOperation,
      summary: 'Proxy pass-through com timeout estendido para análise de trading',
      description:
        'Encaminha para integrations-service com timeout de proxy estendido (long-running).',
    },
  },
} as const;

export const apiGatewaySchemas = {
  GatewayAggregatedHealth: {
    type: 'object',
    properties: {
      gateway: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      services: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'ok' },
            circuit: { type: 'string', example: 'closed' },
          },
        },
      },
      overall: { type: 'string', example: 'healthy' },
    },
  },
} as const;
