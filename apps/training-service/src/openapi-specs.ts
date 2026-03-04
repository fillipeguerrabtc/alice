/**
 * Alice Enterprise Platform - Training Service OpenAPI Specs
 * Author: Fillipe Guerra | Data: 05/12/2025
 */

export const trainingServicePaths = {
  '/health': { get: { summary: 'Health check', tags: ['Health'], security: [], responses: { 200: { description: 'OK' } } } },
  '/ready': { get: { summary: 'Readiness check', tags: ['Health'], security: [], responses: { 200: { description: 'Ready' } } } },
  '/api/training/jobs': {
    get: { summary: 'Listar jobs', tags: ['Training Jobs'], parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'cancelled'] } }, { name: 'page', in: 'query', schema: { type: 'integer' } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: { 200: { description: 'Lista', content: { 'application/json': { schema: { type: 'object', properties: { jobs: { type: 'array', items: { $ref: '#/components/schemas/TrainingJob' } } } } } } } } },
    post: { summary: 'Criar job', tags: ['Training Jobs'], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['datasetId', 'type'], properties: { datasetId: { type: 'string' }, type: { type: 'string', enum: ['lora', 'full'], default: 'lora' }, hyperparameters: { type: 'object', properties: { learningRate: { type: 'number' }, epochs: { type: 'integer' }, batchSize: { type: 'integer' } } } } } } } }, responses: { 201: { description: 'Criado' }, 400: { $ref: '#/components/responses/ValidationError' } } },
  },
  '/api/training/jobs/{id}': {
    get: { summary: 'Buscar job', tags: ['Training Jobs'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Job' }, 404: { $ref: '#/components/responses/NotFound' } } },
    delete: { summary: 'Cancelar job', tags: ['Training Jobs'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 204: { description: 'Cancelado' } } },
  },
  '/api/training/jobs/{id}/promotion-approvals': {
    get: {
      summary: 'Listar aprovacoes de promocao',
      tags: ['Training Jobs'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'Aprovacoes' } },
    },
  },
  '/api/training/jobs/{id}/audit-trail': {
    get: {
      summary: 'Listar trilha de auditoria de governanca do job',
      tags: ['Training Jobs'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'Eventos de auditoria' } },
    },
  },
  '/api/training/jobs/{id}/promotion-approval': {
    post: {
      summary: 'Registrar aprovacao/reprovacao de promocao',
      tags: ['Training Jobs'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['decision'],
              properties: {
                decision: { type: 'string', enum: ['approved', 'rejected'] },
                reason: { type: 'string' },
              },
            },
          },
        },
      },
      responses: { 200: { description: 'Aprovacao registrada' } },
    },
  },
  '/api/training/datasets': {
    get: { summary: 'Listar datasets', tags: ['Datasets'], responses: { 200: { description: 'Lista' } } },
    post: { summary: 'Criar dataset', tags: ['Datasets'], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, description: { type: 'string' } } } } } }, responses: { 201: { description: 'Criado' } } },
  },
  '/api/training/datasets/{id}': {
    get: { summary: 'Buscar dataset', tags: ['Datasets'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Dataset' } } },
    delete: { summary: 'Remover dataset', tags: ['Datasets'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 204: { description: 'Removido' } } },
  },
  '/api/training/datasets/{id}/examples': { post: { summary: 'Adicionar exemplo', tags: ['Datasets'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['input', 'output'], properties: { input: { type: 'string' }, output: { type: 'string' }, rating: { type: 'integer', minimum: 1, maximum: 5 } } } } } }, responses: { 201: { description: 'Adicionado' } } } },
  '/api/training/datasets/{id}/export': { get: { summary: 'Exportar JSONL', tags: ['Datasets'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'JSONL', content: { 'application/jsonl': { schema: { type: 'string' } } } } } } },
  '/api/training/models': { get: { summary: 'Listar modelos', tags: ['Models'], responses: { 200: { description: 'Lista' } } } },
  '/api/training/models/{id}/activate': { post: { summary: 'Ativar modelo', tags: ['Models'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Ativado' } } } },
  '/api/training/auto-learning/status': {
    get: {
      summary: 'Status auto-learning',
      tags: ['Auto-Learning'],
      parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: {
          description: 'Status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  activeModel: {
                    type: 'object',
                    properties: {
                      version: { type: 'integer' },
                      name: { type: 'string' },
                      improvementPercent: { type: 'number' },
                      trainingDataUsed: { type: 'integer' },
                      imagesUsed: { type: 'integer' },
                    },
                  },
                  pendingData: {
                    type: 'object',
                    properties: {
                      trainingEntries: { type: 'integer' },
                      images: { type: 'integer' },
                    },
                  },
                  recentVersions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        version: { type: 'integer' },
                        status: { type: 'string' },
                        namespaceId: { type: 'string', format: 'uuid', nullable: true },
                        agentId: { type: 'string', format: 'uuid', nullable: true },
                        createdAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                  upcomingSchedules: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        type: { type: 'string', enum: ['incremental_fine_tuning', 'complete_fine_tuning'] },
                        scheduledFor: { type: 'string', format: 'date-time' },
                        status: { type: 'string' },
                        namespaceId: { type: 'string', format: 'uuid', nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  '/api/training/schedule/configure': {
    post: {
      summary: 'Configurar schedule de treinamento',
      tags: ['Auto-Learning'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['tenantId', 'scheduleType'],
              properties: {
                tenantId: { type: 'string', format: 'uuid' },
                scheduleType: { type: 'string', enum: ['incremental_fine_tuning', 'complete_fine_tuning'] },
                enabled: { type: 'boolean', default: true },
                cronPattern: { type: 'string' },
                minDataRequired: { type: 'integer', minimum: 1 },
                namespaceId: { type: 'string', format: 'uuid', nullable: true },
              },
            },
          },
        },
      },
      responses: { 200: { description: 'Schedule configurado' } },
    },
  },
  '/api/training/run/start': {
    post: {
      summary: 'Iniciar run de treinamento on-demand',
      tags: ['Auto-Learning'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['tenantId'],
              properties: {
                tenantId: { type: 'string', format: 'uuid' },
                trainingType: { type: 'string', enum: ['incremental', 'full'], default: 'incremental' },
                includeImages: { type: 'boolean', default: false },
                priority: { type: 'string', enum: ['low', 'normal', 'high'], default: 'normal' },
                description: { type: 'string', maxLength: 500 },
                namespaceId: { type: 'string', format: 'uuid' },
              },
            },
          },
        },
      },
      responses: { 202: { description: 'Run enfileirado' } },
    },
  },
  '/api/training/queue/status': {
    get: {
      summary: 'Status das filas de fine-tuning',
      tags: ['Auto-Learning'],
      parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: {
          description: 'Status das filas por prioridade',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  queues: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        queue: { type: 'string' },
                        pending: { type: 'integer' },
                        lag: { type: 'integer' },
                        dlq: { type: 'integer' },
                      },
                    },
                  },
                  governance: {
                    type: 'object',
                    properties: {
                      maxInflightRunsPerTenant: { type: 'integer' },
                      requireEvalPassedForPromotion: { type: 'boolean' },
                      requireDualApprovalForPromotion: { type: 'boolean' },
                      promotionMinApprovals: { type: 'integer' },
                    },
                  },
                  tenant: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      inflightCount: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  '/api/training/auto-learning/trigger': { post: { summary: 'Disparar auto-learning', tags: ['Auto-Learning'], responses: { 202: { description: 'Iniciado' } } } },
  '/api/training/stats': { get: { summary: 'Estatísticas', tags: ['Health'], responses: { 200: { description: 'Stats' } } } },
  '/metrics': { get: { summary: 'Métricas', tags: ['Health'], security: [], responses: { 200: { description: 'OK' } } } },
};

export const trainingServiceSchemas = {
  TrainingJob: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'cancelled'] }, type: { type: 'string', enum: ['lora', 'full'] }, progress: { type: 'number' }, startedAt: { type: 'string', format: 'date-time' }, completedAt: { type: 'string', format: 'date-time' } } },
};
