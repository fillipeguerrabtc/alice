/**
 * Alice Enterprise Platform - LLM Gateway Service OpenAPI Specs
 *
 * Contratos OpenAPI para endpoints HTTP reais do llm-gateway-service.
 *
 * Author: Fillipe Guerra
 * Data: 11/03/2026
 */

export const llmGatewayPaths = {
  '/health': {
    get: {
      summary: 'Health check básico do LLM Gateway',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'Serviço saudável' } },
    },
  },
  '/live': {
    get: {
      summary: 'Liveness probe do LLM Gateway',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'Serviço vivo' } },
    },
  },
  '/ready': {
    get: {
      summary: 'Readiness probe do LLM Gateway',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'Serviço pronto' } },
    },
  },
  '/metrics': {
    get: {
      summary: 'Métricas Prometheus do LLM Gateway',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'Métricas expostas' } },
    },
  },
  '/api/llm/complete': {
    post: {
      summary: 'Inferência LLM sem streaming',
      tags: ['Inference'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/LlmCompleteRequest' },
          },
        },
      },
      responses: {
        200: { description: 'Inferência concluída' },
        400: { $ref: '#/components/responses/ValidationError' },
        412: { description: 'Pré-condição de escopo de trading não atendida' },
        502: { description: 'Falha ao chamar GPU Manager' },
      },
    },
  },
  '/api/llm/stream': {
    post: {
      summary: 'Inferência LLM com streaming SSE',
      tags: ['Inference'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/LlmCompleteRequest' },
          },
        },
      },
      responses: {
        200: {
          description: 'Stream SSE de tokens/model output',
          content: {
            'text/event-stream': {
              schema: { type: 'string' },
            },
          },
        },
        400: { $ref: '#/components/responses/ValidationError' },
        412: { description: 'Pré-condição de escopo de trading não atendida' },
        502: { description: 'Falha ao chamar GPU Manager' },
      },
    },
  },
  '/api/llm/governance/prompt-templates': {
    get: {
      summary: 'Listar prompt templates',
      tags: ['Governance'],
      parameters: [
        { name: 'tenantId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'namespaceId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'agentId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'promptKey', in: 'query', schema: { type: 'string' } },
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'active', 'deprecated', 'archived'] } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
      ],
      responses: {
        200: { description: 'Templates listados' },
        400: { $ref: '#/components/responses/ValidationError' },
      },
    },
    post: {
      summary: 'Criar prompt template',
      tags: ['Governance'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: true,
              description: 'Payload validado por getPromptTemplateCreateSchema() em runtime.',
            },
          },
        },
      },
      responses: {
        201: { description: 'Template criado' },
        400: { $ref: '#/components/responses/ValidationError' },
      },
    },
  },
  '/api/llm/governance/prompt-templates/{templateId}/evaluate': {
    post: {
      summary: 'Registrar avaliação de prompt template',
      tags: ['Governance'],
      parameters: [
        { name: 'templateId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: true,
              description: 'Payload validado por getPromptTemplateEvaluateSchema() em runtime.',
            },
          },
        },
      },
      responses: {
        200: { description: 'Avaliação registrada' },
        400: { $ref: '#/components/responses/ValidationError' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },
  '/api/llm/governance/prompt-templates/{templateId}/approval': {
    post: {
      summary: 'Registrar aprovação de prompt template',
      tags: ['Governance'],
      parameters: [
        { name: 'templateId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: true,
              description: 'Payload validado por getPromptTemplateApprovalSchema() em runtime.',
            },
          },
        },
      },
      responses: {
        200: { description: 'Aprovação registrada' },
        400: { $ref: '#/components/responses/ValidationError' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },
  '/api/llm/governance/prompt-templates/{templateId}/approvals': {
    get: {
      summary: 'Listar aprovações de prompt template',
      tags: ['Governance'],
      parameters: [
        { name: 'templateId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'tenantId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        200: { description: 'Aprovações listadas' },
        400: { $ref: '#/components/responses/ValidationError' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },
  '/api/llm/governance/prompt-templates/{templateId}/activate': {
    post: {
      summary: 'Ativar prompt template',
      tags: ['Governance'],
      parameters: [
        { name: 'templateId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: true,
              description: 'Payload validado por getPromptTemplateActivateSchema() em runtime.',
            },
          },
        },
      },
      responses: {
        200: { description: 'Template ativado' },
        400: { $ref: '#/components/responses/ValidationError' },
        404: { $ref: '#/components/responses/NotFound' },
        409: { description: 'Condições de ativação não atendidas' },
      },
    },
  },
  '/api/llm/governance/tool-policies': {
    get: {
      summary: 'Listar tool policies',
      tags: ['Governance'],
      parameters: [
        { name: 'tenantId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'namespaceId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'agentId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'policyKey', in: 'query', schema: { type: 'string' } },
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'active', 'deprecated', 'archived'] } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
      ],
      responses: {
        200: { description: 'Policies listadas' },
        400: { $ref: '#/components/responses/ValidationError' },
      },
    },
    post: {
      summary: 'Criar tool policy',
      tags: ['Governance'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: true,
              description: 'Payload validado por getToolPolicyCreateSchema() em runtime.',
            },
          },
        },
      },
      responses: {
        201: { description: 'Policy criada' },
        400: { $ref: '#/components/responses/ValidationError' },
      },
    },
  },
  '/api/llm/governance/tool-policies/{policyId}/approval': {
    post: {
      summary: 'Registrar aprovação de tool policy',
      tags: ['Governance'],
      parameters: [
        { name: 'policyId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: true,
              description: 'Payload validado por getToolPolicyApprovalSchema() em runtime.',
            },
          },
        },
      },
      responses: {
        200: { description: 'Aprovação registrada' },
        400: { $ref: '#/components/responses/ValidationError' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },
  '/api/llm/governance/tool-policies/{policyId}/approvals': {
    get: {
      summary: 'Listar aprovações de tool policy',
      tags: ['Governance'],
      parameters: [
        { name: 'policyId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'tenantId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        200: { description: 'Aprovações listadas' },
        400: { $ref: '#/components/responses/ValidationError' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },
  '/api/llm/governance/tool-policies/{policyId}/activate': {
    post: {
      summary: 'Ativar tool policy',
      tags: ['Governance'],
      parameters: [
        { name: 'policyId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: true,
              description: 'Payload validado por getToolPolicyActivateSchema() em runtime.',
            },
          },
        },
      },
      responses: {
        200: { description: 'Policy ativada' },
        400: { $ref: '#/components/responses/ValidationError' },
        404: { $ref: '#/components/responses/NotFound' },
        409: { description: 'Condições de ativação não atendidas' },
      },
    },
  },
} as const;

export const llmGatewaySchemas = {
  LlmMessage: {
    type: 'object',
    required: ['role', 'content'],
    properties: {
      role: { type: 'string', enum: ['system', 'user', 'assistant'] },
      content: { type: 'string' },
    },
  },
  LlmContext: {
    type: 'object',
    required: ['route', 'tenantId'],
    properties: {
      route: { type: 'string' },
      tenantId: { type: 'string', format: 'uuid' },
      userId: { type: 'string', format: 'uuid' },
      conversationId: { type: 'string', format: 'uuid' },
      namespaceId: { type: 'string', format: 'uuid' },
      agentId: { type: 'string', format: 'uuid' },
    },
  },
  LlmCompleteRequest: {
    type: 'object',
    required: ['messages', 'context'],
    properties: {
      messages: {
        type: 'array',
        minItems: 1,
        items: { $ref: '#/components/schemas/LlmMessage' },
      },
      context: { $ref: '#/components/schemas/LlmContext' },
      config: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          temperature: { type: 'number' },
          maxTokens: { type: 'number' },
        },
      },
      requestOptions: {
        type: 'object',
        properties: {
          timeout: { type: 'number', minimum: 1 },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
        },
      },
      extraBody: {
        type: 'object',
        properties: {
          alice_reasoning_mode: {
            type: 'string',
            enum: ['auto', 'thinking', 'non_thinking'],
            default: 'auto',
          },
          alice_requested_reasoning_mode: {
            type: 'string',
            enum: ['auto', 'thinking', 'non_thinking'],
          },
          chat_template_kwargs: {
            type: 'object',
            properties: {
              enable_thinking: { type: 'boolean' },
            },
            additionalProperties: true,
          },
        },
        additionalProperties: true,
      },
    },
  },
} as const;
