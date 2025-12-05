/**
 * Alice Enterprise Platform - Integrations Service OpenAPI Specs
 * Author: Fillipe Guerra | Data: 05/12/2025
 */

export const integrationsServicePaths = {
  '/health': { get: { summary: 'Health check', tags: ['Health'], security: [], responses: { 200: { description: 'OK' } } } },
  '/ready': { get: { summary: 'Readiness check', tags: ['Health'], security: [], responses: { 200: { description: 'Ready' } } } },
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
  '/api/integrations/erpnext/sync': { post: { summary: 'Sincronizar', tags: ['ERPNext'], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { entity: { type: 'string', enum: ['customers', 'invoices', 'items'] } } } } } }, responses: { 202: { description: 'Iniciada' } } } },
  '/api/integrations/twilio/sms': { post: { summary: 'Enviar SMS', tags: ['Twilio'], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['to', 'body'], properties: { to: { type: 'string', example: '+5511999999999' }, body: { type: 'string' } } } } } }, responses: { 200: { description: 'Enviado' } } } },
  '/api/integrations/twilio/whatsapp': { post: { summary: 'Enviar WhatsApp', tags: ['Twilio'], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['to', 'body'], properties: { to: { type: 'string' }, body: { type: 'string' }, mediaUrl: { type: 'string', format: 'uri' } } } } } }, responses: { 200: { description: 'Enviado' } } } },
  '/api/integrations/resend/email': { post: { summary: 'Enviar email', tags: ['Resend'], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['to', 'subject', 'html'], properties: { to: { type: 'string', format: 'email' }, subject: { type: 'string' }, html: { type: 'string' }, from: { type: 'string', format: 'email' } } } } } }, responses: { 200: { description: 'Enviado' } } } },
  '/api/integrations/stats': { get: { summary: 'Estatísticas', tags: ['Health'], responses: { 200: { description: 'Stats', content: { 'application/json': { schema: { type: 'object', properties: { stripe: { type: 'object', properties: { status: { type: 'string' }, lastSync: { type: 'string' } } }, wise: { type: 'object' }, erpnext: { type: 'object' } } } } } } } } },
  '/metrics': { get: { summary: 'Métricas', tags: ['Health'], security: [], responses: { 200: { description: 'OK' } } } },
};

export const integrationsServiceSchemas = {};
