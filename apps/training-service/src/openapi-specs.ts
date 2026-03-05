/**
 * Alice Enterprise Platform - Training Service OpenAPI Specs
 * Author: Fillipe Guerra | Data: 05/12/2025
 */

const fineTuningJobStatusEnum = [
  'pending',
  'preparing',
  'training',
  'validating',
  'completed',
  'failed',
  'cancelled',
];

const fineTuningPromotionStatusEnum = [
  'candidate',
  'active',
  'staged',
  'rejected',
];

const trainingRunPriorityEnum = ['low', 'normal', 'high'];
const scheduleTypeEnum = ['incremental_fine_tuning', 'complete_fine_tuning'];

export const trainingServicePaths = {
  '/live': {
    get: {
      summary: 'Liveness probe',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'Service alive' } },
    },
  },
  '/ready': {
    get: {
      summary: 'Readiness probe',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'Service ready' } },
    },
  },
  '/metrics': {
    get: {
      summary: 'Prometheus metrics',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'Metrics exposed' } },
    },
  },
  '/api/training/health': {
    get: {
      summary: 'Training service health',
      tags: ['Health'],
      security: [],
      responses: {
        200: {
          description: 'Health status',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TrainingHealth' },
            },
          },
        },
      },
    },
  },
  '/api/training/system-config': {
    get: {
      summary: 'List effective training runtime config',
      tags: ['System Config'],
      responses: {
        200: { description: 'Effective config loaded from DB/env' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
    patch: {
      summary: 'Update training runtime config',
      tags: ['System Config'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: true,
            },
          },
        },
      },
      responses: {
        200: { description: 'Config updated' },
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },
  '/api/training/data': {
    get: {
      summary: 'List training data',
      tags: ['Training Data'],
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'approved', 'rejected', 'used'] } },
        { name: 'namespaceId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'agentId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'sourceType', in: 'query', schema: { type: 'string' } },
      ],
      responses: {
        200: { description: 'Training data list' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
    post: {
      summary: 'Create training data entry',
      tags: ['Training Data'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['messages'],
              properties: {
                conversationId: { type: 'string', format: 'uuid', nullable: true },
                namespaceId: { type: 'string', format: 'uuid', nullable: true },
                agentId: { type: 'string', format: 'uuid', nullable: true },
                sourceType: { type: 'string' },
                metadata: { type: 'object', additionalProperties: true },
                messages: {
                  type: 'array',
                  minItems: 1,
                  items: { $ref: '#/components/schemas/TrainingMessage' },
                },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'Training data created' },
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },
  '/api/training/data/{id}/status': {
    patch: {
      summary: 'Approve or reject one training data entry',
      tags: ['Training Data'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['status'],
              properties: {
                status: { type: 'string', enum: ['approved', 'rejected'] },
                reviewNotes: { type: 'string', maxLength: 2000 },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Status updated' },
        400: { $ref: '#/components/responses/ValidationError' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },
  '/api/training/data/{id}/resolve-scope': {
    patch: {
      summary: 'Resolve quarantined scope for a training data entry',
      tags: ['Training Data'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['namespaceId', 'reason'],
              properties: {
                namespaceId: { type: 'string', format: 'uuid' },
                agentId: { type: 'string', format: 'uuid', nullable: true },
                domain: { type: 'string', maxLength: 120, nullable: true },
                reason: { type: 'string', minLength: 10, maxLength: 2000 },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Scope resolved' },
        400: { $ref: '#/components/responses/ValidationError' },
      },
    },
  },
  '/api/training/data/approve-batch': {
    post: {
      summary: 'Approve/reject training data in batch',
      tags: ['Training Data'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['ids', 'action'],
              properties: {
                ids: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 1000,
                  items: { type: 'string', format: 'uuid' },
                },
                action: { type: 'string', enum: ['approve', 'reject'] },
                reviewNotes: { type: 'string', maxLength: 2000 },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Batch operation completed' },
        400: { $ref: '#/components/responses/ValidationError' },
      },
    },
  },
  '/api/training/bulk-import': {
    post: {
      summary: 'Bulk import to training_data',
      tags: ['Training Data'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['items'],
              properties: {
                namespaceId: { type: 'string', format: 'uuid', nullable: true },
                sourceType: { type: 'string' },
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['messages'],
                    properties: {
                      messages: {
                        type: 'array',
                        minItems: 1,
                        items: { $ref: '#/components/schemas/TrainingMessage' },
                      },
                      metadata: { type: 'object', additionalProperties: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Import result' },
        400: { $ref: '#/components/responses/ValidationError' },
      },
    },
  },
  '/api/training/jobs': {
    get: {
      summary: 'List fine-tuning jobs',
      tags: ['Training Jobs'],
      'x-required-permission': 'training:fine_tuning_jobs:read',
      parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: {
          description: 'Jobs list',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  jobs: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/FineTuningJob' },
                  },
                },
              },
            },
          },
        },
        400: { $ref: '#/components/responses/ValidationError' },
      },
    },
    post: {
      summary: 'Create custom scoped fine-tuning job',
      tags: ['Training Jobs'],
      'x-required-permission': 'training:fine_tuning_jobs:start',
      parameters: [
        {
          name: 'x-idempotency-key',
          in: 'header',
          required: false,
          schema: { type: 'string', minLength: 16, maxLength: 128 },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateTrainingJobRequest' },
          },
        },
      },
      responses: {
        200: {
          description: 'Idempotent replay: existing job returned',
          headers: {
            'X-Idempotency-Key': { schema: { type: 'string' } },
            'X-Idempotency-Status': { schema: { type: 'string', enum: ['replayed'] } },
          },
        },
        202: {
          description: 'Job created and enqueued',
          headers: {
            'X-Idempotency-Key': { schema: { type: 'string' } },
            'X-Idempotency-Status': { schema: { type: 'string', enum: ['created'] } },
          },
        },
        400: { $ref: '#/components/responses/ValidationError' },
        403: { $ref: '#/components/responses/Forbidden' },
        409: {
          description: 'Run start lock contention or idempotency payload mismatch',
          headers: {
            'X-Idempotency-Key': { schema: { type: 'string' } },
            'X-Idempotency-Status': { schema: { type: 'string', enum: ['conflict'] } },
            'Retry-After': { schema: { type: 'string' } },
          },
        },
        429: {
          description: 'Tenant run capacity exhausted',
          headers: {
            'X-Idempotency-Key': { schema: { type: 'string' } },
            'X-Idempotency-Status': { schema: { type: 'string', enum: ['conflict'] } },
            'Retry-After': { schema: { type: 'string' } },
          },
        },
      },
    },
  },
  '/api/training/jobs/{id}': {
    get: {
      summary: 'Get job details',
      tags: ['Training Jobs'],
      'x-required-permission': 'training:fine_tuning_jobs:read',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: {
          description: 'Job details',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  job: { $ref: '#/components/schemas/FineTuningJob' },
                },
              },
            },
          },
        },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
    delete: {
      summary: 'Cancel one fine-tuning job',
      tags: ['Training Jobs'],
      'x-required-permission': 'training:fine_tuning_jobs:cancel',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: { description: 'Job cancelled' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },
  '/api/training/jobs/{id}/promotion-approvals': {
    get: {
      summary: 'Get promotion approval summary',
      tags: ['Training Jobs'],
      'x-required-permission': 'training:fine_tuning_jobs:read',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: {
          description: 'Approval summary',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PromotionApprovalSummary' },
            },
          },
        },
      },
    },
  },
  '/api/training/jobs/{id}/audit-trail': {
    get: {
      summary: 'Get governance audit trail for job',
      tags: ['Training Jobs'],
      'x-required-permission': 'training:fine_tuning_jobs:read',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: {
          description: 'Audit trail events',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  events: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/TrainingGovernanceAuditEvent' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  '/api/training/jobs/{id}/promotion-approval': {
    post: {
      summary: 'Register promotion approval decision',
      tags: ['Training Jobs'],
      'x-required-permission': 'training:fine_tuning_jobs:start',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['decision'],
              properties: {
                decision: { type: 'string', enum: ['approved', 'rejected'] },
                reason: { type: 'string', maxLength: 2000 },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Decision recorded' },
        409: { description: 'Approval conflict or invalid job state' },
      },
    },
  },
  '/api/training/jobs/{id}/promote': {
    post: {
      summary: 'Promote completed job to active model',
      tags: ['Training Jobs'],
      'x-required-permission': 'training:fine_tuning_jobs:start',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: { description: 'Promotion completed or idempotent' },
        409: { description: 'Promotion policy or lock conflict' },
      },
    },
  },
  '/api/training/jobs/{id}/rollback': {
    post: {
      summary: 'Rollback active model version for scope',
      tags: ['Training Jobs'],
      'x-required-permission': 'training:fine_tuning_jobs:start',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['reason'],
              properties: {
                reason: { type: 'string', minLength: 10, maxLength: 500 },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Rollback completed' },
        409: { description: 'Rollback not allowed for current state' },
      },
    },
  },
  '/api/training/lora/activate/{jobId}': {
    post: {
      summary: 'Activate LoRA adapter by job id',
      tags: ['LoRA'],
      parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Adapter activated' } },
    },
  },
  '/api/training/lora/active': {
    get: {
      summary: 'Get active LoRA adapter',
      tags: ['LoRA'],
      parameters: [
        { name: 'tenantId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'namespaceId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'agentId', in: 'query', schema: { type: 'string', format: 'uuid' } },
      ],
      responses: { 200: { description: 'Active adapter state' } },
    },
    delete: {
      summary: 'Deactivate active LoRA adapter for scope',
      tags: ['LoRA'],
      responses: { 200: { description: 'Adapter deactivated' } },
    },
  },
  '/api/training/gpu-orchestrator/state': {
    get: {
      summary: 'Get GPU orchestrator state',
      tags: ['GPU'],
      responses: { 200: { description: 'Current orchestrator state' } },
    },
  },
  '/api/training/gpu-orchestrator/return': {
    post: {
      summary: 'Return GPU lease to orchestrator',
      tags: ['GPU'],
      responses: { 200: { description: 'GPU lease returned' } },
    },
  },
  '/api/training/webhook': {
    post: {
      summary: 'Internal webhook for training ingestion',
      tags: ['Webhooks'],
      security: [],
      parameters: [
        { name: 'x-webhook-secret', in: 'header', required: true, schema: { type: 'string' } },
        { name: 'x-internal-signature', in: 'header', required: true, schema: { type: 'string' } },
        { name: 'x-internal-timestamp', in: 'header', required: true, schema: { type: 'string' } },
        { name: 'x-internal-user-id', in: 'header', required: true, schema: { type: 'string' } },
        { name: 'x-internal-tenant-id', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'x-internal-role', in: 'header', required: true, schema: { type: 'string' } },
        { name: 'x-internal-nonce', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'x-internal-body-sha256', in: 'header', required: false, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/TrainingWebhookRequest' },
          },
        },
      },
      responses: {
        201: { description: 'Training data received from webhook' },
        200: { description: 'Feedback webhook processed' },
        400: { $ref: '#/components/responses/ValidationError' },
        401: { description: 'Invalid internal auth/signature/secret' },
        409: { description: 'Webhook nonce replay detected' },
        503: { description: 'Webhook feature disabled (missing secret)' },
      },
    },
  },
  '/api/training/auto-learning/status': {
    get: {
      summary: 'Get auto-learning status',
      tags: ['Auto-Learning'],
      'x-required-permission': 'training:training_data:read',
      parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Auto-learning status' } },
    },
  },
  '/api/training/execution-modes': {
    get: {
      summary: 'Get objective training execution mode definitions',
      tags: ['Auto-Learning'],
      'x-required-permission': 'training:training_data:read',
      parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: {
          description: 'Execution mode SSOT',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TrainingExecutionModesResponse' },
            },
          },
        },
      },
    },
  },
  '/api/training/stats': {
    get: {
      summary: 'Get training dataset/job counters',
      tags: ['Auto-Learning'],
      parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'Training stats' } },
    },
  },
  '/api/training/schedule/configure': {
    post: {
      summary: 'Configure auto-learning schedule',
      tags: ['Auto-Learning'],
      'x-required-permission': 'training:training_data:manage',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['tenantId', 'scheduleType'],
              properties: {
                tenantId: { type: 'string', format: 'uuid' },
                scheduleType: { type: 'string', enum: scheduleTypeEnum },
                enabled: { type: 'boolean', default: true },
                cronPattern: { type: 'string' },
                minDataRequired: { type: 'integer', minimum: 1 },
                namespaceId: { type: 'string', format: 'uuid', nullable: true },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Schedule configured' },
        400: { $ref: '#/components/responses/ValidationError' },
      },
    },
  },
  '/api/training/run/start': {
    post: {
      summary: 'Start on-demand training run',
      tags: ['Auto-Learning'],
      'x-required-permission': 'training:training_data:manage',
      parameters: [
        {
          name: 'x-idempotency-key',
          in: 'header',
          required: false,
          schema: { type: 'string', minLength: 16, maxLength: 128 },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/TrainingRunStartRequest' },
          },
        },
      },
      responses: {
        200: {
          description: 'Idempotent replay: existing run returned',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TrainingRunStartResponse' },
            },
          },
          headers: {
            'X-Idempotency-Key': { schema: { type: 'string' } },
            'X-Idempotency-Status': { schema: { type: 'string', enum: ['replayed'] } },
          },
        },
        202: {
          description: 'Run accepted and enqueued',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TrainingRunStartResponse' },
            },
          },
          headers: {
            'X-Idempotency-Key': { schema: { type: 'string' } },
            'X-Idempotency-Status': { schema: { type: 'string', enum: ['created'] } },
          },
        },
        400: { $ref: '#/components/responses/ValidationError' },
        409: {
          description: 'Run already in progress, lock contention, or idempotency payload mismatch',
          headers: {
            'X-Idempotency-Key': { schema: { type: 'string' } },
            'X-Idempotency-Status': { schema: { type: 'string', enum: ['conflict'] } },
            'Retry-After': { schema: { type: 'string' } },
          },
        },
        429: {
          description: 'Tenant run capacity exhausted',
          headers: {
            'X-Idempotency-Key': { schema: { type: 'string' } },
            'X-Idempotency-Status': { schema: { type: 'string', enum: ['conflict'] } },
            'Retry-After': { schema: { type: 'string' } },
          },
        },
      },
    },
  },
  '/api/training/run/status': {
    get: {
      summary: 'Get current training run status',
      tags: ['Auto-Learning'],
      'x-required-permission': 'training:training_data:read',
      parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: {
          description: 'Current run status',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TrainingRunStatusResponse' },
            },
          },
        },
      },
    },
  },
  '/api/training/queue/status': {
    get: {
      summary: 'Get fine-tuning queue/governance status',
      tags: ['Auto-Learning'],
      'x-required-permission': 'training:fine_tuning_jobs:read',
      parameters: [{ name: 'tenantId', in: 'query', schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: {
          description: 'Queue and governance status',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/FineTuningQueueStatusResponse' },
            },
          },
        },
      },
    },
  },
  '/api/training/run/history': {
    get: {
      summary: 'Get training run history',
      tags: ['Auto-Learning'],
      'x-required-permission': 'training:training_data:read',
      parameters: [
        { name: 'tenantId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      ],
      responses: {
        200: {
          description: 'Run history',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/TrainingRunHistoryResponse' },
            },
          },
        },
      },
    },
  },
  '/api/training/run/cancel': {
    delete: {
      summary: 'Cancel one in-flight training run',
      tags: ['Auto-Learning'],
      'x-required-permission': 'training:training_data:manage',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['trainingRunId'],
              properties: {
                trainingRunId: { type: 'string', format: 'uuid' },
                reason: { type: 'string', maxLength: 500 },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Run cancelled' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },
};

export const trainingServiceSchemas = {
  ErrorResponse: {
    type: 'object',
    properties: {
      error: { type: 'string' },
      details: { type: 'object', additionalProperties: true },
    },
  },
  TrainingMessage: {
    type: 'object',
    required: ['role', 'content'],
    properties: {
      role: { type: 'string', enum: ['system', 'user', 'assistant'] },
      content: { type: 'string' },
      timestamp: { type: 'string', format: 'date-time' },
    },
  },
  TrainingHealth: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['ok', 'degraded'] },
      service: { type: 'string' },
      timestamp: { type: 'string', format: 'date-time' },
      embeddingsProvider: { type: 'string' },
      model: { type: 'string' },
      fineTuningStatus: { type: 'string' },
      circuitBreakers: { type: 'object', additionalProperties: true },
    },
  },
  FineTuningJob: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      tenantId: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      baseModel: { type: 'string' },
      status: { type: 'string', enum: fineTuningJobStatusEnum },
      runSource: { type: 'string', enum: ['custom_job', 'on_demand', 'scheduled'] },
      progress: { type: 'number' },
      trainingDataCount: { type: 'integer' },
      validationDataCount: { type: 'integer' },
      loraJobId: { type: 'string', format: 'uuid', nullable: true },
      modelVersionId: { type: 'string', format: 'uuid', nullable: true },
      evaluationStatus: { type: 'string', enum: ['pending', 'running', 'passed', 'failed', 'skipped'] },
      promotionStatus: { type: 'string', enum: fineTuningPromotionStatusEnum },
      scopeNamespaceId: { type: 'string', format: 'uuid', nullable: true },
      scopeAgentId: { type: 'string', format: 'uuid', nullable: true },
      iniciadoEm: { type: 'string', format: 'date-time', nullable: true },
      completadoEm: { type: 'string', format: 'date-time', nullable: true },
      criadoEm: { type: 'string', format: 'date-time' },
      errorMessage: { type: 'string', nullable: true },
    },
  },
  CreateTrainingJobRequest: {
    type: 'object',
    required: ['namespaceId', 'name'],
    properties: {
      tenantId: { type: 'string', format: 'uuid' },
      namespaceId: { type: 'string', format: 'uuid' },
      agentId: { type: 'string', format: 'uuid' },
      domain: { type: 'string', minLength: 1, maxLength: 120 },
      name: { type: 'string', minLength: 1 },
      baseModel: { type: 'string' },
      hyperparametersPreset: { type: 'string', enum: ['safe', 'standard', 'large'] },
      hyperparameters: { type: 'object', additionalProperties: true },
      forceMinSize: { type: 'boolean' },
    },
  },
  PromotionApprovalSummary: {
    type: 'object',
    properties: {
      approvedDistinctUsersCount: { type: 'integer' },
      requesterHasApproved: { type: 'boolean' },
      approvals: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            approverUserId: { type: 'string', format: 'uuid' },
            decision: { type: 'string', enum: ['approved', 'rejected'] },
            reason: { type: 'string', nullable: true },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },
  TrainingGovernanceAuditEvent: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      action: { type: 'string' },
      resourceId: { type: 'string', format: 'uuid' },
      details: { type: 'object', additionalProperties: true, nullable: true },
      ip: { type: 'string', nullable: true },
      userAgent: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      user: {
        type: 'object',
        nullable: true,
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          email: { type: 'string' },
        },
      },
    },
  },
  TrainingWebhookRequest: {
    type: 'object',
    required: ['event', 'payload'],
    properties: {
      event: { type: 'string', enum: ['training_data', 'feedback'] },
      timestamp: { type: 'string', format: 'date-time' },
      payload: {
        type: 'object',
        properties: {
          conversationId: { type: 'string' },
          rating: { type: 'number', minimum: 1, maximum: 5 },
          metadata: { type: 'object', additionalProperties: true },
          messages: {
            type: 'array',
            items: { $ref: '#/components/schemas/TrainingMessage' },
          },
        },
      },
    },
  },
  TrainingRunStartRequest: {
    type: 'object',
    required: ['tenantId'],
    properties: {
      tenantId: { type: 'string', format: 'uuid' },
      trainingType: { type: 'string', enum: ['incremental', 'full'], default: 'incremental' },
      includeImages: { type: 'boolean', default: false },
      priority: { type: 'string', enum: trainingRunPriorityEnum, default: 'normal' },
      description: { type: 'string', maxLength: 500 },
      namespaceId: { type: 'string', format: 'uuid' },
    },
  },
  TrainingRunStartResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      jobId: { type: 'string', format: 'uuid' },
      loraJobId: { type: 'string', format: 'uuid' },
      modelVersionId: { type: 'string', format: 'uuid', nullable: true },
      version: { type: 'integer', nullable: true },
      trainingDataUsed: { type: 'integer', nullable: true },
      imagesUsed: { type: 'integer', nullable: true },
      status: { type: 'string' },
      enqueued: { type: 'boolean' },
      idempotencyHit: { type: 'boolean' },
    },
  },
  TrainingRunStatusResponse: {
    type: 'object',
    properties: {
      hasRunningTraining: { type: 'boolean' },
      status: { type: 'string', enum: ['idle', 'training'] },
      message: { type: 'string' },
      currentJob: {
        type: 'object',
        nullable: true,
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          baseModel: { type: 'string' },
          trainingDataCount: { type: 'integer' },
          progress: { type: 'number' },
          elapsedSeconds: { type: 'integer' },
          startedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
    },
  },
  FineTuningQueueStatusResponse: {
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
          requireIdempotencyKeyForRunStart: { type: 'boolean' },
          requireStrictApprovedDataForAutoEngine: { type: 'boolean' },
          enforceMinInferenceConfidence: { type: 'boolean' },
          tradingMinInferenceConfidence: { type: 'number' },
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
  TrainingRunHistoryResponse: {
    type: 'object',
    properties: {
      total: { type: 'integer' },
      history: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            jobType: { type: 'string' },
            status: { type: 'string', enum: fineTuningJobStatusEnum },
            totalRecords: { type: 'integer', nullable: true },
            processedRecords: { type: 'integer' },
            description: { type: 'string' },
            startedAt: { type: 'string', format: 'date-time', nullable: true },
            completedAt: { type: 'string', format: 'date-time', nullable: true },
            durationSeconds: { type: 'integer', nullable: true },
            errorMessage: { type: 'string', nullable: true },
          },
        },
      },
    },
  },
  TrainingExecutionModesResponse: {
    type: 'object',
    properties: {
      tenantId: { type: 'string', format: 'uuid' },
      modes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', enum: ['quick_run', 'advanced_job', 'auto_schedule'] },
            runSource: { type: 'string', enum: ['on_demand', 'custom_job', 'scheduled'] },
            endpoint: { type: 'string' },
            scope: { type: 'string', enum: ['tenant_or_namespace', 'namespace_required'] },
            trigger: { type: 'string', enum: ['manual_immediate', 'cron_recurring'] },
            datasetPolicy: { type: 'object', additionalProperties: true },
            hyperparametersPolicy: { type: 'string' },
            schedulePolicy: { type: 'string' },
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
          requireIdempotencyKeyForRunStart: { type: 'boolean' },
          requireStrictApprovedDataForAutoEngine: { type: 'boolean' },
          enforceMinInferenceConfidence: { type: 'boolean' },
          tradingMinInferenceConfidence: { type: 'number' },
        },
      },
    },
  },
};
