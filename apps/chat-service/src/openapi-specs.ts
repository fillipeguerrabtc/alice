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
      tags: ['Chat'],
      summary: 'Excluir conversa (soft delete)',
      description: 'Marca a conversa como deleted e remove as mensagens associadas.',
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': {
          description: 'Conversa excluída',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  conversationId: { type: 'string', format: 'uuid' },
                },
              },
            },
          },
        },
        '404': { description: 'Conversa não encontrada' },
      },
    },
  },
  '/api/chat/conversations/bulk-delete': {
    post: {
      tags: ['Chat'],
      summary: 'Excluir conversas em lote',
      description: 'Marca as conversas como deleted e remove as mensagens associadas.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                ids: {
                  type: 'array',
                  items: { type: 'string', format: 'uuid' },
                  minItems: 1,
                  maxItems: 200,
                },
              },
              required: ['ids'],
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Conversas excluídas',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  deleted: { type: 'number' },
                  skipped: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
  },
  '/api/chat/conversations/delete-all': {
    post: {
      tags: ['Chat'],
      summary: 'Excluir todas as conversas do usuário',
      description: 'Marca todas as conversas do usuário como deleted e remove as mensagens associadas.',
      responses: {
        '200': {
          description: 'Conversas excluídas',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  deleted: { type: 'number' },
                },
              },
            },
          },
        },
      },
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
  '/api/chat/conversations/{id}/training/collect': {
    post: {
      summary: 'Enviar conversa para coleta de treinamento',
      tags: ['Training'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                namespaceId: { type: 'string', format: 'uuid' },
                maxMessages: { type: 'integer', minimum: 2, maximum: 100 },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Conversa enviada para aprovação' },
        400: { $ref: '#/components/responses/ValidationError' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
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
  // Gate 2: Geração de imagens via OpenAI (gpt-image-1).
  '/api/chat/images/generate': {
    post: {
      summary: 'Gerar imagem via OpenAI (gpt-image-1)',
      tags: ['Images'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['prompt'],
              properties: {
                prompt: { type: 'string', example: 'Um gato laranja usando óculos de sol' },
                negativePrompt: { type: 'string', example: 'texto borrado' },
                width: { type: 'integer', default: 1024, description: 'Somente 1024 ou 1536' },
                height: { type: 'integer', default: 1024, description: 'Somente 1024 ou 1536' },
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
                  image: {
                    type: 'object',
                    description: 'Registro completo da imagem gerada',
                  },
                },
              },
            },
          },
        },
        400: {
          description: 'Input inválido',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Input inválido' },
                },
              },
            },
          },
        },
        401: {
          description: 'Autenticação necessária',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Autenticação necessária' },
                },
              },
            },
          },
        },
        502: {
          description: 'Falha ao gerar imagem',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Falha ao gerar imagem' },
                  details: { type: 'string' },
                },
              },
            },
          },
        },
        503: {
          description: 'OpenAI não configurado',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'OpenAI não configurado' },
                  code: { type: 'string', example: 'OPENAI_NOT_CONFIGURED' },
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
  '/api/agents/model-options': {
    get: {
      summary: 'Modelos disponíveis para Agents (SSOT)',
      description:
        'Single Source of Truth para a UI: lista de modelos LLM suportados (Gate 2), defaults e limites (ex.: maxTokens).',
      tags: ['Agents'],
      responses: {
        200: {
          description: 'Opções de modelos para Agents',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  models: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        value: { type: 'string' },
                        label: { type: 'string' },
                        description: { type: 'string' },
                      },
                    },
                  },
                  defaults: {
                    type: 'object',
                    properties: {
                      modeloBase: { type: 'string' },
                      temperaturaModelo: { type: 'number' },
                      maxTokens: { type: 'integer' },
                    },
                  },
                  constraints: {
                    type: 'object',
                    properties: {
                      maxTokensMin: { type: 'integer' },
                      maxTokensMax: { type: 'integer' },
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
  '/metrics': {
    get: {
      summary: 'Métricas Prometheus',
      tags: ['Health'],
      security: [],
      responses: { 200: { description: 'Métricas', content: { 'text/plain': { schema: { type: 'string' } } } } },
    },
  },
  '/api/namespaces': {
    get: {
      summary: 'Listar namespaces',
      tags: ['Namespaces'],
      responses: {
        200: {
          description: 'Lista de namespaces',
          content: {
            'application/json': {
              schema: { type: 'array', items: { $ref: '#/components/schemas/Namespace' } },
            },
          },
        },
      },
    },
    post: {
      summary: 'Criar namespace',
      tags: ['Namespaces'],
      requestBody: {
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/NamespaceInput' },
          },
        },
      },
      responses: {
        201: {
          description: 'Namespace criado',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Namespace' } } },
        },
      },
    },
  },
  '/api/namespaces/{id}': {
    patch: {
      summary: 'Atualizar namespace',
      tags: ['Namespaces'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/NamespaceInput' },
          },
        },
      },
      responses: {
        200: {
          description: 'Namespace atualizado',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Namespace' } } },
        },
      },
    },
    delete: {
      summary: 'Excluir namespace',
      tags: ['Namespaces'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 204: { description: 'Namespace excluído' } },
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
  Namespace: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      nome: { type: 'string' },
      slug: { type: 'string' },
      descricao: { type: 'string', nullable: true },
      cor: { type: 'string', nullable: true },
      icone: { type: 'string', nullable: true },
      contextoSistema: { type: 'string', nullable: true },
      ordem: { type: 'integer' },
      ativo: { type: 'boolean' },
      criadoEm: { type: 'string', format: 'date-time' },
      atualizadoEm: { type: 'string', format: 'date-time' },
    },
  },
  NamespaceInput: {
    type: 'object',
    properties: {
      nome: { type: 'string' },
      slug: { type: 'string' },
      descricao: { type: 'string', nullable: true },
      cor: { type: 'string', nullable: true },
      icone: { type: 'string', nullable: true },
      contextoSistema: { type: 'string', nullable: true },
      ordem: { type: 'integer' },
      ativo: { type: 'boolean' },
    },
  },
};
