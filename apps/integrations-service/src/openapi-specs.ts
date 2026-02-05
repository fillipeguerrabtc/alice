/**
 * Alice Enterprise Platform - Integrations Service OpenAPI Specs
 * Author: Fillipe Guerra | Data: 05/12/2025
 */

export const integrationsServicePaths = {
  '/health': { get: { summary: 'Health check', tags: ['Health'], security: [], responses: { 200: { description: 'OK' } } } },
  '/ready': { get: { summary: 'Readiness check', tags: ['Health'], security: [], responses: { 200: { description: 'Ready' } } } },
  '/api/integrations/health': {
    get: {
      summary: 'Status operacional das integrações',
      tags: ['Health'],
      security: [],
      responses: {
        200: { description: 'Status das integrações' },
        500: { description: 'Falha ao verificar integrações' },
      },
    },
  },
  '/api/integrations/stripe/checkout': {
    post: { summary: 'Criar checkout', tags: ['Stripe'], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['priceId'], properties: { priceId: { type: 'string' }, quantity: { type: 'integer', default: 1 }, successUrl: { type: 'string' }, cancelUrl: { type: 'string' } } } } } }, responses: { 200: { description: 'URL de checkout', content: { 'application/json': { schema: { type: 'object', properties: { url: { type: 'string', format: 'uri' } } } } } } } },
  },
  '/api/integrations/stripe/portal': { post: { summary: 'Portal do cliente', tags: ['Stripe'], responses: { 200: { description: 'URL do portal' } } } },
  '/api/integrations/stripe/subscriptions': { get: { summary: 'Listar assinaturas', tags: ['Stripe'], responses: { 200: { description: 'Lista' } } } },
  '/api/integrations/stripe/invoices': { get: { summary: 'Listar faturas', tags: ['Stripe'], parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: { 200: { description: 'Lista' } } } },
  '/api/integrations/webhooks/stripe': { post: { summary: 'Webhook Stripe', tags: ['Webhooks'], security: [], responses: { 200: { description: 'OK' }, 400: { description: 'Assinatura inválida' } } } },
  '/api/integrations/wise/quotes': {
    post: { summary: 'Cotação', tags: ['Wise'], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['sourceCurrency', 'targetCurrency', 'sourceAmount'], properties: { sourceCurrency: { type: 'string', example: 'BRL' }, targetCurrency: { type: 'string', example: 'USD' }, sourceAmount: { type: 'number' } } } } } }, responses: { 200: { description: 'Cotação criada' } } },
  },
  '/api/integrations/wise/transfers': {
    get: { summary: 'Listar transferências', tags: ['Wise'], responses: { 200: { description: 'Lista' } } },
    post: { summary: 'Criar transferência', tags: ['Wise'], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['quoteId', 'targetRecipientId'], properties: { quoteId: { type: 'string' }, targetRecipientId: { type: 'string' }, reference: { type: 'string' } } } } } }, responses: { 201: { description: 'Criada' } } },
  },
  '/api/integrations/webhooks/wise': { post: { summary: 'Webhook Wise', tags: ['Webhooks'], security: [], responses: { 200: { description: 'OK' } } } },
  '/api/integrations/erpnext/customers': {
    get: { summary: 'Listar clientes', tags: ['ERPNext'], parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }], responses: { 200: { description: 'Lista' } } },
    post: { summary: 'Criar cliente', tags: ['ERPNext'], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['customer_name'], properties: { customer_name: { type: 'string' }, customer_type: { type: 'string', enum: ['Company', 'Individual'] }, territory: { type: 'string' } } } } } }, responses: { 201: { description: 'Criado' } } },
  },
  '/api/integrations/erpnext/invoices': {
    get: { summary: 'Listar faturas', tags: ['ERPNext'], responses: { 200: { description: 'Lista' } } },
    post: { summary: 'Criar fatura', tags: ['ERPNext'], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['customer', 'items'], properties: { customer: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { item_code: { type: 'string' }, qty: { type: 'number' }, rate: { type: 'number' } } } } } } } } }, responses: { 201: { description: 'Criada' } } },
  },
  '/api/integrations/erpnext/resource/{doctype}': {
    get: {
      summary: 'Consultar/listar recursos ERPNext (DocType genérico)',
      tags: ['ERPNext'],
      parameters: [
        { name: 'doctype', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'name', in: 'query', schema: { type: 'string' } },
        { name: 'fields', in: 'query', schema: { type: 'string' } },
        { name: 'filters', in: 'query', schema: { type: 'string' } },
        { name: 'limit_start', in: 'query', schema: { type: 'string' } },
        { name: 'limit_page_length', in: 'query', schema: { type: 'string' } },
        { name: 'order_by', in: 'query', schema: { type: 'string' } },
      ],
      responses: { 200: { description: 'Resultado ERPNext' }, 403: { description: 'DocType não permitido' } },
    },
    post: {
      summary: 'Criar recurso ERPNext (DocType genérico)',
      tags: ['ERPNext'],
      parameters: [{ name: 'doctype', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
      responses: { 200: { description: 'Criado' }, 403: { description: 'DocType não permitido' } },
    },
  },
  '/api/integrations/erpnext/resource/{doctype}/{name}': {
    put: {
      summary: 'Atualizar recurso ERPNext (DocType genérico)',
      tags: ['ERPNext'],
      parameters: [
        { name: 'doctype', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'name', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
      responses: { 200: { description: 'Atualizado' }, 403: { description: 'DocType não permitido' } },
    },
    delete: {
      summary: 'Excluir recurso ERPNext (DocType genérico)',
      tags: ['ERPNext'],
      parameters: [
        { name: 'doctype', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'name', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: { description: 'Excluído' }, 403: { description: 'DocType não permitido' } },
    },
  },
  '/api/integrations/erpnext/method/{method}': {
    post: {
      summary: 'Executar método ERPNext (Frappe)',
      tags: ['ERPNext'],
      parameters: [{ name: 'method', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
      responses: { 200: { description: 'Executado' }, 403: { description: 'Method não permitido' } },
    },
  },
  '/api/integrations/erpnext/sync': { post: { summary: 'Sincronizar', tags: ['ERPNext'], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { entity: { type: 'string', enum: ['customers', 'invoices', 'items'] } } } } } }, responses: { 202: { description: 'Iniciada' } } } },
  '/api/integrations/github/deploy-stack': {
    post: {
      summary: 'Disparar deploy/rollback via GitHub Actions',
      tags: ['GitHub'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['stack', 'version'],
              properties: {
                stack: { type: 'string', enum: ['infra', 'alice', 'observability', 'erpnext', 'backup', 'all'] },
                version: { type: 'string' },
                rollback: { type: 'boolean' },
                rollbackVersion: { type: 'string' },
                dryRun: { type: 'boolean' },
                smartDeploy: { type: 'boolean' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Workflow disparado' },
        503: { description: 'GitHub não configurado' },
      },
    },
  },
  '/api/integrations/twilio/sms': { post: { summary: 'Enviar SMS', tags: ['Twilio'], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['to', 'body'], properties: { to: { type: 'string', example: '+5511999999999' }, body: { type: 'string' } } } } } }, responses: { 200: { description: 'Enviado' } } } },
  '/api/integrations/twilio/whatsapp': { post: { summary: 'Enviar WhatsApp', tags: ['Twilio'], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['to', 'body'], properties: { to: { type: 'string' }, body: { type: 'string' }, mediaUrl: { type: 'string', format: 'uri' } } } } } }, responses: { 200: { description: 'Enviado' } } } },
  '/api/integrations/email/send': { 
    post: { 
      summary: 'Enviar email transacional via Gmail SMTP', 
      description: 'Envia emails transacionais (comprovantes, faturas, promoções, notificações) usando Gmail SMTP com App Password.',
      tags: ['Email'], 
      requestBody: { 
        content: { 
          'application/json': { 
            schema: { 
              type: 'object', 
              required: ['to', 'subject', 'html'], 
              properties: { 
                to: { oneOf: [{ type: 'string', format: 'email' }, { type: 'array', items: { type: 'string', format: 'email' }, maxItems: 50 }], description: 'Destinatário(s) do email' },
                subject: { type: 'string', maxLength: 200, description: 'Assunto do email' },
                html: { type: 'string', description: 'Corpo do email em HTML' },
                text: { type: 'string', description: 'Versão texto plano (opcional)' },
                from: { type: 'string', format: 'email', description: 'Remetente (padrão: GMAIL_USER)' },
                replyTo: { type: 'string', format: 'email', description: 'Email para resposta' },
                metadata: { 
                  type: 'object', 
                  properties: {
                    type: { type: 'string', enum: ['receipt', 'invoice', 'promotion', 'notification', 'alert', 'other'] },
                    orderId: { type: 'string' },
                    customerId: { type: 'string' },
                    tenantId: { type: 'string', format: 'uuid' }
                  }
                }
              } 
            } 
          } 
        } 
      }, 
      responses: { 
        200: { description: 'Email enviado com sucesso', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, messageId: { type: 'string' }, accepted: { type: 'array', items: { type: 'string' } }, rejected: { type: 'array', items: { type: 'string' } } } } } } },
        400: { description: 'Payload inválido' },
        503: { description: 'Serviço de email não configurado' }
      } 
    } 
  },
  '/api/integrations/email/health': {
    get: {
      summary: 'Health check do serviço de email',
      description: 'Verifica se o Gmail SMTP está configurado e conectado.',
      tags: ['Email'],
      responses: {
        200: { description: 'Serviço saudável' },
        503: { description: 'Serviço indisponível' }
      }
    }
  },
  // ============================================================================
  // TRADING: KuCoin Futures (WS5)
  // ============================================================================
  '/api/integrations/trading/status': {
    get: {
      summary: 'Status do trading (KuCoin Futures)',
      tags: ['Trading'],
      responses: {
        200: { description: 'Status do trading' },
        401: { description: 'Não autenticado' },
        503: { description: 'KuCoin indisponível (breaker/credenciais)' },
      },
    },
  },
  '/api/integrations/trading/ws/status': {
    get: {
      summary: 'Status do WebSocket KuCoin (public/private)',
      tags: ['Trading'],
      responses: {
        200: { description: 'Estado do WebSocket (readiness operacional)' },
        401: { description: 'Não autenticado' },
      },
    },
  },
  '/api/integrations/trading/intervals': {
    get: {
      summary: 'Intervalos suportados (REST + WS)',
      tags: ['Trading'],
      responses: {
        200: { description: 'Intervalos suportados para klines' },
        401: { description: 'Não autenticado' },
      },
    },
  },
  '/api/integrations/trading/ws/subscribe': {
    post: {
      summary: 'Registrar subscription no WebSocket KuCoin',
      tags: ['Trading'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                channel: { type: 'string', enum: ['ticker', 'orderbook', 'klines', 'trades'] },
                symbol: { type: 'string' },
                interval: { type: 'string' },
                depth: { type: 'integer', enum: [5, 50] },
                marketType: { type: 'string', enum: ['futures', 'spot', 'margin'] },
                marginMode: { type: 'string', enum: ['cross', 'isolated'] },
              },
              required: ['channel', 'symbol', 'marketType'],
            },
          },
        },
      },
      responses: {
        200: { description: 'Subscription registrada' },
        400: { description: 'Payload inválido' },
        401: { description: 'Não autenticado' },
        501: { description: 'WebSocket disponível apenas para Futures' },
        503: { description: 'KuCoin indisponível (breaker/credenciais)' },
      },
    },
  },
  '/api/integrations/trading/ws/unsubscribe': {
    post: {
      summary: 'Cancelar subscription no WebSocket KuCoin',
      tags: ['Trading'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                channel: { type: 'string', enum: ['ticker', 'orderbook', 'klines', 'trades'] },
                symbol: { type: 'string' },
                interval: { type: 'string' },
                depth: { type: 'integer', enum: [5, 50] },
                marketType: { type: 'string', enum: ['futures', 'spot', 'margin'] },
                marginMode: { type: 'string', enum: ['cross', 'isolated'] },
              },
              required: ['channel', 'symbol', 'marketType'],
            },
          },
        },
      },
      responses: {
        200: { description: 'Subscription cancelada' },
        400: { description: 'Payload inválido' },
        401: { description: 'Não autenticado' },
        409: { description: 'WebSocket KuCoin não conectado' },
        501: { description: 'WebSocket disponível apenas para Futures' },
        503: { description: 'KuCoin indisponível (breaker/credenciais)' },
      },
    },
  },
  '/api/integrations/trading/symbols': {
    get: {
      summary: 'Lista símbolos disponíveis para trading',
      tags: ['Trading'],
      responses: {
        200: { description: 'Lista de símbolos e símbolo default' },
        401: { description: 'Não autenticado' },
        503: { description: 'KuCoin indisponível (breaker/credenciais)' },
      },
    },
  },
  '/api/integrations/trading/news-presets': {
    get: {
      summary: 'Listar presets de notícias (SearXNG)',
      tags: ['Trading'],
      responses: {
        200: { description: 'Lista de presets' },
        401: { description: 'Não autenticado' },
      },
    },
    post: {
      summary: 'Criar preset de notícias (SearXNG)',
      tags: ['Trading'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name', 'config'],
              properties: {
                name: { type: 'string', minLength: 2, maxLength: 120 },
                description: { type: 'string', maxLength: 500, nullable: true },
                isDefault: { type: 'boolean' },
                config: {
                  type: 'object',
                  properties: {
                    engines: { type: 'array', items: { type: 'string' } },
                    categories: { type: 'string' },
                    language: { type: 'string' },
                    safesearch: { type: 'string' },
                    timeRange: { type: 'string', enum: ['last_hour', 'last_24_hours', 'custom', 'day', 'week', 'month', 'year'] },
                    dateFrom: { type: 'string' },
                    dateTo: { type: 'string' },
                    queryTemplates: { type: 'array', items: { type: 'string' } },
                    extraTerms: { type: 'array', items: { type: 'string' } },
                    maxResults: { type: 'integer', minimum: 1, maximum: 10 },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'Preset criado' },
        400: { description: 'Dados inválidos' },
        401: { description: 'Não autenticado' },
        409: { description: 'Nome já existe' },
      },
    },
  },
  '/api/integrations/trading/news-presets/{id}': {
    put: {
      summary: 'Atualizar preset de notícias (SearXNG)',
      tags: ['Trading'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string', minLength: 2, maxLength: 120 },
                description: { type: 'string', maxLength: 500, nullable: true },
                isDefault: { type: 'boolean' },
                config: {
                  type: 'object',
                  properties: {
                    engines: { type: 'array', items: { type: 'string' } },
                    categories: { type: 'string' },
                    language: { type: 'string' },
                    safesearch: { type: 'string' },
                    timeRange: { type: 'string', enum: ['last_hour', 'last_24_hours', 'custom', 'day', 'week', 'month', 'year'] },
                    dateFrom: { type: 'string' },
                    dateTo: { type: 'string' },
                    queryTemplates: { type: 'array', items: { type: 'string' } },
                    extraTerms: { type: 'array', items: { type: 'string' } },
                    maxResults: { type: 'integer', minimum: 1, maximum: 10 },
                  },
                },
              },
              minProperties: 1,
            },
          },
        },
      },
      responses: {
        200: { description: 'Preset atualizado' },
        400: { description: 'Dados inválidos' },
        401: { description: 'Não autenticado' },
        404: { description: 'Preset não encontrado' },
        409: { description: 'Nome já existe' },
      },
    },
    delete: {
      summary: 'Remover preset de notícias (SearXNG)',
      tags: ['Trading'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        200: { description: 'Preset removido' },
        401: { description: 'Não autenticado' },
        404: { description: 'Preset não encontrado' },
      },
    },
  },
  '/api/integrations/trading/news-presets/apply': {
    post: {
      summary: 'Aplicar preset de notícias ao perfil',
      tags: ['Trading'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['presetId', 'kind'],
              properties: {
                presetId: { type: 'string', format: 'uuid' },
                kind: { type: 'string', enum: ['analysis', 'signal'] },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Preset aplicado' },
        401: { description: 'Não autenticado' },
        404: { description: 'Preset não encontrado' },
      },
    },
  },
  '/api/integrations/trading/signals/history': {
    get: {
      summary: 'Histórico de sinais (paginado)',
      tags: ['Trading'],
      parameters: [
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } },
        { name: 'cursor', in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'symbol', in: 'query', schema: { type: 'string' } },
        { name: 'marketType', in: 'query', schema: { type: 'string', enum: ['futures', 'spot', 'margin'] } },
        { name: 'validationStatus', in: 'query', schema: { type: 'string', enum: ['pending', 'validated', 'failed'] } },
        { name: 'approvalStatus', in: 'query', schema: { type: 'string', enum: ['pending', 'approved', 'rejected'] } },
      ],
      responses: {
        200: { description: 'Histórico de sinais' },
        401: { description: 'Não autenticado' },
        400: { description: 'Query inválida' },
      },
    },
  },
  '/api/integrations/trading/signals/history/stats': {
    get: {
      summary: 'Estatísticas do histórico de sinais',
      tags: ['Trading'],
      responses: {
        200: { description: 'Estatísticas de sinais' },
        401: { description: 'Não autenticado' },
      },
    },
  },
  '/api/integrations/trading/signals/history/delete': {
    post: {
      summary: 'Excluir sinais do histórico (exclusão lógica)',
      tags: ['Trading'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
                all: { type: 'boolean' },
                scope: { type: 'string', enum: ['self', 'tenant'] },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Histórico de sinais atualizado' },
        401: { description: 'Não autenticado' },
        403: { description: 'Apenas administradores podem excluir tudo' },
      },
    },
  },
  '/api/integrations/trading/orders/history': {
    get: {
      summary: 'Histórico de ordens (banco)',
      tags: ['Trading'],
      parameters: [
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } },
        { name: 'cursor', in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'symbol', in: 'query', schema: { type: 'string' } },
        { name: 'marketType', in: 'query', schema: { type: 'string', enum: ['futures', 'spot', 'margin'] } },
        { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'side', in: 'query', schema: { type: 'string', enum: ['buy', 'sell'] } },
      ],
      responses: {
        200: { description: 'Histórico de ordens' },
        401: { description: 'Não autenticado' },
        400: { description: 'Query inválida' },
      },
    },
  },
  '/api/integrations/trading/orders/history/delete': {
    post: {
      summary: 'Excluir ordens do histórico (exclusão lógica)',
      tags: ['Trading'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
                all: { type: 'boolean' },
                scope: { type: 'string', enum: ['self', 'tenant'] },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Histórico de ordens atualizado' },
        401: { description: 'Não autenticado' },
        403: { description: 'Apenas administradores podem excluir tudo' },
      },
    },
  },
  '/api/integrations/trading/analysis/history': {
    get: {
      summary: 'Histórico de análises (paginado)',
      tags: ['Trading'],
      parameters: [
        { name: 'symbol', in: 'query', schema: { type: 'string' } },
        { name: 'interval', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 } },
        { name: 'cursor', in: 'query', schema: { type: 'string', format: 'date-time' } },
      ],
      responses: {
        200: { description: 'Histórico de análises' },
        401: { description: 'Não autenticado' },
        400: { description: 'Query inválida' },
      },
    },
  },
  '/api/integrations/trading/analysis/history/delete': {
    post: {
      summary: 'Excluir análises do histórico (exclusão lógica)',
      tags: ['Trading'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
                all: { type: 'boolean' },
                scope: { type: 'string', enum: ['self', 'tenant'] },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Histórico de análises atualizado' },
        401: { description: 'Não autenticado' },
        403: { description: 'Apenas administradores podem excluir tudo' },
      },
    },
  },
  '/api/integrations/stats': {
    get: {
      summary: 'Estatísticas das integrações',
      tags: ['Integrations'],
      responses: {
        200: {
          description: 'Resumo das integrações',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  stripe: {
                    type: 'object',
                    properties: {
                      totalRevenue: { type: 'number' },
                      transactions: { type: 'integer' },
                      currency: { type: 'string' },
                    },
                  },
                  wise: {
                    type: 'object',
                    properties: {
                      totalTransfers: { type: 'integer' },
                      pendingAmount: { type: 'number' },
                      completedCount: { type: 'integer' },
                    },
                  },
                  erpnext: {
                    type: 'object',
                    properties: {
                      customers: { type: 'integer' },
                      orders: { type: 'integer' },
                      synced: { type: 'boolean' },
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
  '/metrics': { get: { summary: 'Métricas', tags: ['Health'], security: [], responses: { 200: { description: 'OK' } } } },
};

export const integrationsServiceSchemas = {};
