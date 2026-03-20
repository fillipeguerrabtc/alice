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
  '/api/chat/empty-state-headline': {
    get: {
      summary: 'Buscar headline dinamica da tela vazia do chat',
      tags: ['Chat'],
      security: [],
      responses: {
        200: {
          description: 'Headline dinamica pronta para o estado vazio do chat',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  dayPart: {
                    type: 'string',
                    enum: ['morning', 'afternoon', 'evening', 'night'],
                  },
                  headline: { type: 'string' },
                  locale: {
                    type: 'string',
                    enum: ['pt-BR', 'en-US'],
                  },
                  theme: {
                    type: 'string',
                    enum: ['create', 'work', 'organize', 'day_check', 'start_task', 'resume'],
                  },
                  variantKey: { type: 'string' },
                },
                required: ['dayPart', 'headline', 'locale', 'theme', 'variantKey'],
              },
            },
          },
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
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                agentId: { type: 'string', format: 'uuid', nullable: true },
                namespaceId: { type: 'string', format: 'uuid', nullable: true },
                reasoningMode: { type: 'string', enum: ['auto', 'thinking', 'non_thinking'], default: 'auto' },
                titulo: { type: 'string' },
                context: { type: 'string', enum: ['trading', 'sales', 'support', 'cambio', 'default'] },
                route: { type: 'string' },
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
        200: {
          description: 'Dados da conversa',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  conversation: { $ref: '#/components/schemas/Conversation' },
                },
                required: ['conversation'],
              },
            },
          },
        },
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
              required: ['conteudo'],
              properties: {
                conteudo: { type: 'string' },
                tipo: { type: 'string', enum: ['text', 'image', 'audio', 'mixed'], default: 'text' },
                namespaceId: { type: 'string', format: 'uuid', nullable: true },
                agentId: { type: 'string', format: 'uuid', nullable: true },
                reasoningMode: { type: 'string', enum: ['auto', 'thinking', 'non_thinking'], default: 'auto' },
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
                reasoningMode: { type: 'string', enum: ['auto', 'thinking', 'non_thinking'], default: 'auto' },
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
      'x-required-permission': 'chat:takeover:write',
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
  '/api/chat/conversations/{id}/handback': {
    post: {
      summary: 'Devolver controle para IA (handback)',
      tags: ['Takeover'],
      'x-required-permission': 'chat:handoff:write',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { resolutionNotes: { type: 'string' } },
            },
          },
        },
      },
      responses: {
        200: { description: 'Controle devolvido' },
        400: { $ref: '#/components/responses/ValidationError' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
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
  '/api/chat/stream': {
    post: {
      summary: 'Enviar mensagem com streaming SSE',
      description: 'Endpoint canônico de streaming do chat com suporte explícito a Área, Agente e Raciocínio.',
      tags: ['LLM'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                conversationId: { type: 'string', format: 'uuid' },
                message: { type: 'string' },
                messages: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      role: { type: 'string', enum: ['user', 'assistant', 'system'] },
                      content: { type: 'string' },
                    },
                    required: ['role', 'content'],
                  },
                },
                namespaceId: { type: 'string', format: 'uuid', nullable: true },
                agentId: { type: 'string', format: 'uuid', nullable: true },
                route: { type: 'string' },
                approvalPolicy: { type: 'string', enum: ['always_confirm', 'confirm_risky', 'never_confirm'] },
                agentRouting: {
                  type: 'object',
                  description: 'Compatibilidade legada temporária para transição interna.',
                  properties: {
                    mode: { type: 'string', enum: ['auto', 'manual'] },
                    agentIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
                  },
                },
                streamDiagnostics: { type: 'boolean', default: false },
                mediaAttachments: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      filename: { type: 'string' },
                      mimeType: { type: 'string' },
                      file: { type: 'string' },
                      uploadId: { type: 'string', format: 'uuid' },
                      fileUrl: { type: 'string' },
                      size: { type: 'integer' },
                    },
                    required: ['filename', 'mimeType'],
                  },
                },
                reasoningMode: { type: 'string', enum: ['auto', 'thinking', 'non_thinking'], default: 'auto' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Stream SSE de resposta',
          content: { 'text/event-stream': { schema: { type: 'string' } } },
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
  '/api/chat/ws-token': {
    get: {
      summary: 'Gerar token efemero para WebSocket',
      description:
        'Retorna token HMAC de curta duracao para autenticacao de conexoes WebSocket. aud=ws-agent exige permissao de takeover.',
      tags: ['WebSocket'],
      parameters: [
        {
          name: 'aud',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['ws', 'ws-agent'], default: 'ws' },
          description: 'Audience do token WebSocket',
        },
      ],
      responses: {
        200: {
          description: 'Token gerado com sucesso',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ChatWsTokenResponse' },
            },
          },
        },
        400: {
          description: 'Parametro aud invalido',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Parametro aud invalido' },
                },
              },
            },
          },
        },
        401: {
          description: 'Autenticacao necessaria',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Autenticacao necessaria' },
                },
              },
            },
          },
        },
        403: {
          description: 'Permissao insuficiente para ws-agent',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Permissao insuficiente para ws-agent' },
                },
              },
            },
          },
        },
      },
    },
  },
  '/api/chat/takeover-stats': {
    get: {
      summary: 'Estatísticas de takeover/handover',
      tags: ['Takeover'],
      responses: {
        200: {
          description: 'Resumo de takeover',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  pendingHandoffs: { type: 'integer' },
                  activeHumanAgents: { type: 'integer' },
                  urgentConversations: { type: 'integer' },
                  avgResponseTime: { type: 'number' },
                  resolvedByAI: { type: 'integer' },
                  resolvedByHuman: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
  },
  '/api/chat/sla-metrics': {
    get: {
      summary: 'Métricas de SLA do chat',
      tags: ['Takeover'],
      responses: {
        200: {
          description: 'Métricas de SLA',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  breachedCount: { type: 'integer' },
                  atRiskCount: { type: 'integer' },
                  onTrackCount: { type: 'integer' },
                  avgFirstResponseTime: { type: 'number' },
                  avgResolutionTime: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
  },
  '/api/chat/circuit-breakers': {
    get: {
      summary: 'Status dos circuit breakers do chat',
      tags: ['Health'],
      responses: {
        200: {
          description: 'Lista de circuit breakers',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  breakers: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        status: { type: 'string', enum: ['closed', 'open', 'half-open'] },
                        failures: { type: 'integer' },
                        successRate: { type: 'number' },
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
  '/api/chat/conversations/weekly': {
    get: {
      summary: 'Conversas por dia (IA vs humano)',
      tags: ['Chat'],
      responses: {
        200: {
          description: 'Série semanal de conversas',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        ai: { type: 'integer' },
                        human: { type: 'integer' },
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
  '/api/namespaces/{id}/profile': {
    get: {
      summary: 'Buscar profile de governança do namespace',
      tags: ['Namespaces'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        200: {
          description: 'Profile do namespace',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/NamespaceProfile' } } },
        },
      },
    },
    patch: {
      summary: 'Atualizar profile de governança do namespace',
      tags: ['Namespaces'],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: {
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/NamespaceProfilePatch' },
          },
        },
      },
      responses: {
        200: {
          description: 'Profile atualizado',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/NamespaceProfile' } } },
        },
      },
    },
  },
};

export const chatServiceSchemas = {
  ChatWsTokenResponse: {
    type: 'object',
    required: ['success', 'data'],
    properties: {
      success: { type: 'boolean', example: true },
      data: {
        type: 'object',
        required: ['token', 'expiresIn', 'aud'],
        properties: {
          token: { type: 'string' },
          expiresIn: { type: 'integer', example: 60 },
          aud: { type: 'string', enum: ['ws', 'ws-agent'] },
        },
      },
    },
  },
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
  NamespaceProfile: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      tenantId: { type: 'string', format: 'uuid' },
      namespaceId: { type: 'string', format: 'uuid' },
      version: { type: 'integer' },
      isActive: { type: 'boolean' },
      autoCollectEnabled: { type: 'boolean' },
      config: { type: 'object' },
      criadoEm: { type: 'string', format: 'date-time', nullable: true },
      atualizadoEm: { type: 'string', format: 'date-time', nullable: true },
    },
  },
  NamespaceProfilePatch: {
    type: 'object',
    properties: {
      isActive: { type: 'boolean' },
      autoCollectEnabled: { type: 'boolean' },
      config: { type: 'object' },
    },
  },
};
