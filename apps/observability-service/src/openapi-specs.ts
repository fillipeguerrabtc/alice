/**
 * Alice Enterprise Platform - Observability Service OpenAPI Specs
 */

export const observabilityServicePaths = {
  '/health': {
    get: {
      summary: 'Health check',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'OK' } },
    },
  },
  '/live': {
    get: {
      summary: 'Liveness check',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'Alive' } },
    },
  },
  '/ready': {
    get: {
      summary: 'Readiness check',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'Ready' } },
    },
  },
  '/api/observability/health': {
    get: {
      summary: 'Full observability stack health',
      tags: ['Health'],
      'x-required-permission': 'observability:core:read',
      responses: {
        200: { description: 'Stack healthy' },
        207: { description: 'Stack degraded' },
        503: { description: 'Stack unhealthy' },
      },
    },
  },
  '/api/observability/services/{name}': {
    get: {
      summary: 'Get health status for one observability service',
      tags: ['Health'],
      'x-required-permission': 'observability:core:read',
      parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        200: { description: 'Service health status' },
        404: { description: 'Service not found' },
      },
    },
  },
  '/api/observability/metrics/services': {
    get: {
      summary: 'Service metrics from Prometheus',
      tags: ['Metrics'],
      'x-required-permission': 'observability:core:read',
      responses: { 200: { description: 'Service metrics' } },
    },
  },
  '/api/observability/metrics/circuit-breakers': {
    get: {
      summary: 'Circuit breaker metrics from Prometheus',
      tags: ['Metrics'],
      'x-required-permission': 'observability:core:read',
      responses: { 200: { description: 'Circuit breaker metrics' } },
    },
  },
  '/api/observability/metrics/integrations': {
    get: {
      summary: 'Integration metrics from Prometheus',
      tags: ['Metrics'],
      'x-required-permission': 'observability:core:read',
      responses: { 200: { description: 'Integration metrics' } },
    },
  },
  '/api/observability/metrics/sla': {
    get: {
      summary: 'SLA metrics by tenant',
      tags: ['Metrics'],
      'x-required-permission': 'observability:core:read',
      parameters: [{ name: 'tenantId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: { description: 'SLA metrics' },
        400: { description: 'tenantId is required' },
      },
    },
  },
  '/api/observability/logs': {
    post: {
      summary: 'Frontend log ingestion',
      tags: ['Metrics'],
      'x-required-permission': 'observability:logs:write',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['level', 'message', 'timestamp', 'service'],
              properties: {
                level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
                message: { type: 'string' },
                timestamp: { type: 'string', format: 'date-time' },
                service: { type: 'string' },
                context: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
      },
      responses: {
        202: { description: 'Log accepted' },
        400: { description: 'Invalid log payload' },
      },
    },
  },
  '/api/observability/circuit-breakers': {
    get: {
      summary: 'Runtime circuit breaker states',
      tags: ['Metrics'],
      'x-required-permission': 'observability:core:read',
      responses: { 200: { description: 'Circuit breaker states' } },
    },
  },
  '/api/observability/urls': {
    get: {
      summary: 'Internal and external observability URLs',
      tags: ['Health'],
      'x-required-permission': 'observability:core:admin',
      responses: { 200: { description: 'Observability URLs' } },
    },
  },
  '/metrics': {
    get: {
      summary: 'Prometheus metrics',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'OK' } },
    },
  },
};

export const observabilityServiceSchemas = {
  Backup: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      type: { type: 'string' },
      status: { type: 'string' },
      size: { type: 'integer' },
      startedAt: { type: 'string', format: 'date-time' },
      completedAt: { type: 'string', format: 'date-time' },
      encrypted: { type: 'boolean' },
    },
  },
};
