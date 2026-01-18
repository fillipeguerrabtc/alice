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
  '/api/training/jobs/trading': {
    post: {
      summary: 'Criar job de Trading',
      tags: ['Training Jobs'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['namespaceId'],
              properties: {
                tenantId: { type: 'string', format: 'uuid' },
                namespaceId: { type: 'string', format: 'uuid' },
                name: { type: 'string' },
                baseModel: { type: 'string' },
                hyperparameters: {
                  type: 'object',
                  properties: {
                    learningRate: { type: 'number' },
                    epochs: { type: 'integer' },
                    batchSize: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Criado' },
        400: { $ref: '#/components/responses/ValidationError' },
      },
    },
  },
  '/api/training/jobs/{id}': {
    get: { summary: 'Buscar job', tags: ['Training Jobs'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Job' }, 404: { $ref: '#/components/responses/NotFound' } } },
    delete: { summary: 'Cancelar job', tags: ['Training Jobs'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 204: { description: 'Cancelado' } } },
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
  '/api/training/auto-learning/status': { get: { summary: 'Status auto-learning', tags: ['Auto-Learning'], responses: { 200: { description: 'Status', content: { 'application/json': { schema: { type: 'object', properties: { enabled: { type: 'boolean' }, nextScheduledRun: { type: 'string', format: 'date-time' }, lastRun: { type: 'string', format: 'date-time' }, examplesCollected: { type: 'integer' } } } } } } } } },
  '/api/training/auto-learning/trigger': { post: { summary: 'Disparar auto-learning', tags: ['Auto-Learning'], responses: { 202: { description: 'Iniciado' } } } },
  '/api/training/stats': { get: { summary: 'Estatísticas', tags: ['Health'], responses: { 200: { description: 'Stats' } } } },
  '/metrics': { get: { summary: 'Métricas', tags: ['Health'], security: [], responses: { 200: { description: 'OK' } } } },
};

export const trainingServiceSchemas = {
  TrainingJob: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'cancelled'] }, type: { type: 'string', enum: ['lora', 'full'] }, progress: { type: 'number' }, startedAt: { type: 'string', format: 'date-time' }, completedAt: { type: 'string', format: 'date-time' } } },
};
