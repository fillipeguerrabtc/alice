/**
 * Alice Enterprise Platform - Observability Service OpenAPI Specs
 * Author: Fillipe Guerra | Data: 05/12/2025
 */

export const observabilityServicePaths = {
  '/health': { get: { summary: 'Health check', tags: ['Health'], security: [], responses: { 200: { description: 'OK' } } } },
  '/ready': { get: { summary: 'Readiness check', tags: ['Health'], security: [], responses: { 200: { description: 'Ready' } } } },
  '/api/observability/backups': {
    get: { summary: 'Listar backups', tags: ['Backup'], parameters: [{ name: 'type', in: 'query', schema: { type: 'string', enum: ['postgres', 'redis', 's3', 'full'] } }, { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'] } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: { 200: { description: 'Lista', content: { 'application/json': { schema: { type: 'object', properties: { backups: { type: 'array', items: { $ref: '#/components/schemas/Backup' } } } } } } } } },
    post: { summary: 'Iniciar backup', tags: ['Backup'], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['type'], properties: { type: { type: 'string', enum: ['postgres', 'redis', 's3', 'full'] }, description: { type: 'string' } } } } } }, responses: { 202: { description: 'Iniciado' } } },
  },
  '/api/observability/backups/{id}': {
    get: { summary: 'Buscar backup', tags: ['Backup'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Backup' }, 404: { $ref: '#/components/responses/NotFound' } } },
    delete: { summary: 'Remover backup', tags: ['Backup'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 204: { description: 'Removido' } } },
  },
  '/api/observability/backups/{id}/download': { get: { summary: 'Download', tags: ['Backup'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Arquivo', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } } } } },
  '/api/observability/restore': { post: { summary: 'Iniciar restauração', tags: ['Restore'], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['backupId'], properties: { backupId: { type: 'string' }, targetTime: { type: 'string', format: 'date-time', description: 'Para PITR' } } } } } }, responses: { 202: { description: 'Iniciada' }, 400: { $ref: '#/components/responses/ValidationError' } } } },
  '/api/observability/restore/status': { get: { summary: 'Status restauração', tags: ['Restore'], responses: { 200: { description: 'Status', content: { 'application/json': { schema: { type: 'object', properties: { inProgress: { type: 'boolean' }, backupId: { type: 'string' }, progress: { type: 'number' }, startedAt: { type: 'string', format: 'date-time' } } } } } } } } },
  '/api/observability/metrics/services': { get: { summary: 'Métricas serviços', tags: ['Metrics'], responses: { 200: { description: 'Métricas', content: { 'application/json': { schema: { type: 'object', properties: { services: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, status: { type: 'string' }, uptime: { type: 'number' }, requestsPerMinute: { type: 'number' }, avgLatency: { type: 'number' } } } } } } } } } } } },
  '/api/observability/metrics/circuit-breakers': { get: { summary: 'Métricas circuit breakers', tags: ['Metrics'], responses: { 200: { description: 'Circuit breakers' } } } },
  '/api/observability/metrics/integrations': { get: { summary: 'Métricas integrações', tags: ['Metrics'], responses: { 200: { description: 'Integrações' } } } },
  '/api/observability/metrics/sla': { get: { summary: 'Métricas SLA por tenant', tags: ['Metrics'], parameters: [{ name: 'tenantId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'SLA' }, 400: { description: 'tenantId obrigatório' } } } },
  '/api/observability/alerts': { get: { summary: 'Listar alertas', tags: ['Alerts'], responses: { 200: { description: 'Lista' } } } },
  '/api/observability/alerts/{id}/acknowledge': { post: { summary: 'Reconhecer alerta', tags: ['Alerts'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Reconhecido' } } } },
  '/api/observability/health/aggregate': { get: { summary: 'Health agregado', tags: ['Health'], responses: { 200: { description: 'Status', content: { 'application/json': { schema: { type: 'object', properties: { overall: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] }, services: { type: 'object', additionalProperties: { type: 'object', properties: { status: { type: 'string' }, lastCheck: { type: 'string', format: 'date-time' } } } } } } } } } } } },
  '/api/observability/logs': { get: { summary: 'Buscar logs', tags: ['Metrics'], parameters: [{ name: 'service', in: 'query', schema: { type: 'string' } }, { name: 'level', in: 'query', schema: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] } }, { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: { 200: { description: 'Logs' } } } },
  '/api/observability/stats': { get: { summary: 'Estatísticas', tags: ['Metrics'], responses: { 200: { description: 'Stats' } } } },
  '/metrics': { get: { summary: 'Métricas Prometheus', tags: ['Health'], security: [], responses: { 200: { description: 'OK' } } } },
};

export const observabilityServiceSchemas = {
  Backup: { type: 'object', properties: { id: { type: 'string' }, type: { type: 'string', enum: ['postgres', 'redis', 's3', 'full'] }, status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'] }, size: { type: 'integer', description: 'Bytes' }, startedAt: { type: 'string', format: 'date-time' }, completedAt: { type: 'string', format: 'date-time' }, encrypted: { type: 'boolean' } } },
};
