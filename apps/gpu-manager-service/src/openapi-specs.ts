/**
 * Alice Enterprise Platform - GPU Manager Service OpenAPI Specs
 *
 * Contratos OpenAPI para endpoints HTTP reais do gpu-manager-service.
 *
 * Author: Fillipe Guerra
 * Data: 11/03/2026
 */

export const gpuManagerServicePaths = {
  '/health': {
    get: {
      summary: 'Health check básico do GPU Manager',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'Serviço saudável' } },
    },
  },
  '/live': {
    get: {
      summary: 'Liveness probe do GPU Manager',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'Serviço vivo' }, 503: { description: 'Serviço indisponível' } },
    },
  },
  '/ready': {
    get: {
      summary: 'Readiness probe do GPU Manager',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'Serviço pronto' }, 503: { description: 'Serviço não pronto' } },
    },
  },
  '/metrics': {
    get: {
      summary: 'Métricas Prometheus do GPU Manager',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'Métricas expostas' } },
    },
  },
  '/api/gpu/embeddings/health': {
    get: {
      summary: 'Health check proxy do serviço de embeddings',
      tags: ['Embeddings'],
      responses: {
        200: { description: 'Embeddings saudável' },
        502: { description: 'Embeddings respondeu com erro' },
        503: { description: 'Embeddings indisponível' },
      },
    },
  },
  '/api/gpu/queue': {
    post: {
      summary: 'Enfileirar requisição GPU',
      tags: ['Queue'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/GpuQueueRequest' },
          },
        },
      },
      responses: {
        202: { description: 'Requisição enfileirada' },
        400: { $ref: '#/components/responses/ValidationError' },
        429: { description: 'Requisição rejeitada por admission control (limite)' },
        503: { description: 'Requisição rejeitada por indisponibilidade/VRAM' },
      },
    },
  },
  '/api/gpu/queue/{requestId}': {
    get: {
      summary: 'Consultar resultado de requisição GPU',
      tags: ['Queue'],
      parameters: [
        {
          name: 'requestId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: {
        200: { description: 'Resultado encontrado' },
        404: { $ref: '#/components/responses/NotFound' },
        503: { description: 'Redis indisponível' },
      },
    },
  },
  '/api/gpu/orchestrator/state': {
    get: {
      summary: 'Consultar estado do orquestrador GPU',
      tags: ['Orchestrator'],
      responses: {
        200: { description: 'Estado atual retornado' },
      },
    },
  },
  '/api/gpu/orchestrator/prepare-training': {
    post: {
      summary: 'Preparar runtime GPU para treinamento (FSM canônica)',
      tags: ['Orchestrator'],
      responses: {
        200: { description: 'Runtime preparado para treinamento' },
        403: { description: 'Permissão insuficiente (admin/superadmin)' },
        503: { description: 'Orquestrador indisponível' },
      },
    },
  },
  '/api/gpu/orchestrator/restore-serving': {
    post: {
      summary: 'Restaurar runtime de serving (LLM + Embeddings)',
      tags: ['Orchestrator'],
      responses: {
        200: { description: 'Serving restaurado' },
        403: { description: 'Permissão insuficiente (admin/superadmin)' },
        503: { description: 'Orquestrador indisponível' },
      },
    },
  },
  '/api/gpu/orchestrator/return': {
    post: {
      summary: 'Alias legado de restore-serving',
      tags: ['Orchestrator'],
      deprecated: true,
      responses: {
        200: { description: 'Serving restaurado' },
        403: { description: 'Permissão insuficiente (admin/superadmin)' },
        503: { description: 'Orquestrador indisponível' },
      },
    },
  },
  '/api/gpu/stream': {
    post: {
      summary: 'Streaming SSE via GPU Manager (LLM)',
      tags: ['Inference'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/GpuStreamRequest' },
          },
        },
      },
      responses: {
        200: {
          description: 'Streaming SSE iniciado',
          content: {
            'text/event-stream': {
              schema: { type: 'string' },
            },
          },
        },
        400: { $ref: '#/components/responses/ValidationError' },
        429: { description: 'Requisição rejeitada por policy/rate do admission control' },
        503: { description: 'GPU ocupada/VRAM indisponível' },
      },
    },
  },
  '/api/gpu/vram': {
    get: {
      summary: 'Status atual de VRAM',
      tags: ['VRAM'],
      responses: {
        200: {
          description: 'Status de VRAM retornado',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GpuVramStatus' },
            },
          },
        },
      },
    },
  },
  '/api/gpu/queue/status': {
    get: {
      summary: 'Status das filas GPU por serviço',
      tags: ['Queue'],
      responses: {
        200: { description: 'Status das filas retornado' },
        503: { description: 'Redis indisponível' },
      },
    },
  },
  '/api/gpu/services': {
    get: {
      summary: 'Estado operacional dos serviços GPU',
      tags: ['Services'],
      responses: {
        200: { description: 'Status dos serviços GPU retornado' },
      },
    },
  },
} as const;

export const gpuManagerServiceSchemas = {
  GpuQueueRequest: {
    type: 'object',
    required: ['serviceType', 'endpoint'],
    properties: {
      serviceType: { type: 'string', enum: ['llm', 'embeddings', 'training'] },
      priority: { type: 'number', description: 'Enum numérico de prioridade interna' },
      endpoint: { type: 'string' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], default: 'POST' },
      body: { type: 'object', additionalProperties: true },
      headers: { type: 'object', additionalProperties: { type: 'string' } },
      timeout: { type: 'number' },
      maxRetries: { type: 'number' },
      metadata: { type: 'object', additionalProperties: true },
    },
  },
  GpuStreamRequest: {
    type: 'object',
    required: ['serviceType', 'endpoint'],
    properties: {
      serviceType: { type: 'string', enum: ['llm', 'embeddings', 'training'] },
      endpoint: { type: 'string' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], default: 'POST' },
      body: { type: 'object', additionalProperties: true },
      headers: { type: 'object', additionalProperties: { type: 'string' } },
      timeout: { type: 'number' },
    },
  },
  GpuVramStatus: {
    type: 'object',
    properties: {
      totalGB: { type: 'number' },
      usedGB: { type: 'number' },
      freeGB: { type: 'number' },
      utilizationPercent: { type: 'number' },
      activeServices: {
        type: 'array',
        items: { type: 'string', enum: ['llm', 'embeddings', 'training'] },
      },
    },
  },
} as const;
