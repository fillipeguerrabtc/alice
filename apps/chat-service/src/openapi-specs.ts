/**
 * Alice Enterprise Platform - Chat Service OpenAPI Specs
 * 
 * Specs definidas como objeto para compatibilidade com esbuild.
 * 
 * Author: Fillipe Guerra
 * Data: 05/12/2025
 */

export const chatServicePaths = {
  '/health': {
    get: {
      summary: 'Health check básico',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'Serviço saudável' } },
    },
  },
  '/ready': {
    get: {
      summary: 'Readiness check',
      tags: ['Health'],
      security: [],
      responses: {
        200: {
          description: 'Serviço pronto',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthCheck' } } },
        },
      },
    },
  },
  '/api/chat/conversations': {
    get: {
      summary: 'Listar conversas',
      tags: ['Chat'],
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer' } },
        { name: 'limit', in: 'query', schema: { type: 'integer' } },
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'archived', 'escalated'] } },
      ],
      responses: {
        200: {
          description: 'Lista de conversas',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  conversations: { type: 'array', items: { $ref: '#/components/schemas/Conversation' } },
                  pagination: { $ref: '#/components/schemas/Pagination' },
                },
              },
            },
          },
        },
      },
    },
    post: {
      summary: 'Criar nova conversa',
      tags: ['Chat'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                metadata: { type: 'object' },
              },
            },
          },
        },
      },
      responses: { 201: { description: 'Conversa criada' } },
    },
  },
  '/api/chat/conversations/{id}': {
    get: {
      summary: 'Buscar conversa',
      tags: ['Chat'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: { description: 'Dados da conversa' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
    delete: {
      summary: 'Arquivar conversa',
      tags: ['Chat'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 204: { description: 'Conversa arquivada' } },
    },
  },
  '/api/chat/conversations/{id}/messages': {
    get: {
      summary: 'Listar mensagens',
      tags: ['Chat'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
      ],
      responses: { 200: { description: 'Lista de mensagens' } },
    },
    post: {
      summary: 'Enviar mensagem',
      tags: ['Chat'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['content'],
              properties: {
                content: { type: 'string' },
                attachments: { type: 'array', items: { type: 'string', format: 'uri' } },
              },
            },
          },
        },
      },
      responses: { 201: { description: 'Mensagem enviada' } },
    },
  },
  '/api/chat/conversations/{id}/stream': {
    post: {
      summary: 'Enviar mensagem com streaming',
      description: 'Envia mensagem e recebe resposta do LLM via Server-Sent Events.',
      tags: ['LLM'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['content'],
              properties: {
                content: { type: 'string' },
                useRag: { type: 'boolean', default: true },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Stream de tokens',
          content: { 'text/event-stream': { schema: { type: 'string' } } },
        },
      },
    },
  },
  '/api/chat/conversations/{id}/takeover': {
    post: {
      summary: 'Assumir controle da conversa (takeover humano)',
      tags: ['Takeover'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { reason: { type: 'string' } },
            },
          },
        },
      },
      responses: {
        200: { description: 'Controle assumido' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },
  '/api/chat/conversations/{id}/handover': {
    post: {
      summary: 'Devolver controle para IA (handover)',
      tags: ['Takeover'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'Controle devolvido' } },
    },
  },
  '/api/chat/image/generate': {
    post: {
      summary: 'Gerar imagem com FLUX.1',
      tags: ['Image Generation'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['prompt'],
              properties: {
                prompt: { type: 'string', example: 'Um gato laranja usando óculos de sol' },
                width: { type: 'integer', default: 1024 },
                height: { type: 'integer', default: 1024 },
                steps: { type: 'integer', default: 4 },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Imagem gerada',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  imageUrl: { type: 'string', format: 'uri' },
                  seed: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
  },
  '/api/chat/escalated': {
    get: {
      summary: 'Listar conversas escaladas',
      description: 'Lista conversas que precisam de atenção humana.',
      tags: ['Takeover'],
      responses: { 200: { description: 'Lista de conversas escaladas' } },
    },
  },
  '/api/chat/stats': {
    get: {
      summary: 'Estatísticas do chat',
      tags: ['Chat'],
      responses: {
        200: {
          description: 'Estatísticas',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  totalConversations: { type: 'integer' },
                  activeConversations: { type: 'integer' },
                  escalatedCount: { type: 'integer' },
                  avgResponseTime: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
  },
  '/metrics': {
    get: {
      summary: 'Métricas Prometheus',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'Métricas', content: { 'text/plain': { schema: { type: 'string' } } } } },
    },
  },
};

export const chatServiceSchemas = {
  Conversation: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      status: { type: 'string', enum: ['active', 'archived', 'escalated'] },
      controlMode: { type: 'string', enum: ['ai', 'human', 'auto'] },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
};
