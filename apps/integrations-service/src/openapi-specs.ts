/**
 * Alice Enterprise Platform - Integrations Service OpenAPI Specs
 * 
 * Documentação OpenAPI 3.0 para o serviço de integrações.
 * 
 * Author: Fillipe Guerra
 * Data: 05/12/2025
 */

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: Serviço saudável
 */

/**
 * @openapi
 * /ready:
 *   get:
 *     summary: Readiness check
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: Serviço pronto
 */

/**
 * @openapi
 * /api/integrations/stripe/checkout:
 *   post:
 *     summary: Criar sessão de checkout
 *     tags: [Stripe]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [priceId]
 *             properties:
 *               priceId:
 *                 type: string
 *               quantity:
 *                 type: integer
 *                 default: 1
 *               successUrl:
 *                 type: string
 *               cancelUrl:
 *                 type: string
 *     responses:
 *       200:
 *         description: URL de checkout
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url:
 *                   type: string
 *                   format: uri
 */

/**
 * @openapi
 * /api/integrations/stripe/portal:
 *   post:
 *     summary: Criar sessão do portal do cliente
 *     tags: [Stripe]
 *     responses:
 *       200:
 *         description: URL do portal
 */

/**
 * @openapi
 * /api/integrations/stripe/subscriptions:
 *   get:
 *     summary: Listar assinaturas
 *     tags: [Stripe]
 *     responses:
 *       200:
 *         description: Lista de assinaturas
 */

/**
 * @openapi
 * /api/integrations/stripe/invoices:
 *   get:
 *     summary: Listar faturas
 *     tags: [Stripe]
 *     parameters:
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Lista de faturas
 */

/**
 * @openapi
 * /api/integrations/webhooks/stripe:
 *   post:
 *     summary: Webhook Stripe
 *     tags: [Webhooks]
 *     security:
 *       - stripeWebhook: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook processado
 *       400:
 *         description: Assinatura inválida
 */

/**
 * @openapi
 * /api/integrations/wise/quotes:
 *   post:
 *     summary: Criar cotação de transferência
 *     tags: [Wise]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sourceCurrency, targetCurrency, sourceAmount]
 *             properties:
 *               sourceCurrency:
 *                 type: string
 *                 example: 'BRL'
 *               targetCurrency:
 *                 type: string
 *                 example: 'USD'
 *               sourceAmount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Cotação criada
 */

/**
 * @openapi
 * /api/integrations/wise/transfers:
 *   get:
 *     summary: Listar transferências
 *     tags: [Wise]
 *     responses:
 *       200:
 *         description: Lista de transferências
 *   post:
 *     summary: Criar transferência
 *     tags: [Wise]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [quoteId, targetRecipientId]
 *             properties:
 *               quoteId:
 *                 type: string
 *               targetRecipientId:
 *                 type: string
 *               reference:
 *                 type: string
 *     responses:
 *       201:
 *         description: Transferência criada
 */

/**
 * @openapi
 * /api/integrations/webhooks/wise:
 *   post:
 *     summary: Webhook Wise
 *     tags: [Webhooks]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook processado
 */

/**
 * @openapi
 * /api/integrations/erpnext/customers:
 *   get:
 *     summary: Listar clientes ERPNext
 *     tags: [ERPNext]
 *     parameters:
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Lista de clientes
 *   post:
 *     summary: Criar cliente ERPNext
 *     tags: [ERPNext]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customer_name]
 *             properties:
 *               customer_name:
 *                 type: string
 *               customer_type:
 *                 type: string
 *                 enum: [Company, Individual]
 *               territory:
 *                 type: string
 *     responses:
 *       201:
 *         description: Cliente criado
 */

/**
 * @openapi
 * /api/integrations/erpnext/invoices:
 *   get:
 *     summary: Listar faturas ERPNext
 *     tags: [ERPNext]
 *     responses:
 *       200:
 *         description: Lista de faturas
 *   post:
 *     summary: Criar fatura ERPNext
 *     tags: [ERPNext]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customer, items]
 *             properties:
 *               customer:
 *                 type: string
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     item_code:
 *                       type: string
 *                     qty:
 *                       type: number
 *                     rate:
 *                       type: number
 *     responses:
 *       201:
 *         description: Fatura criada
 */

/**
 * @openapi
 * /api/integrations/erpnext/sync:
 *   post:
 *     summary: Sincronizar com ERPNext
 *     tags: [ERPNext]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               entity:
 *                 type: string
 *                 enum: [customers, invoices, items]
 *     responses:
 *       202:
 *         description: Sincronização iniciada
 */

/**
 * @openapi
 * /api/integrations/twilio/sms:
 *   post:
 *     summary: Enviar SMS
 *     tags: [Twilio]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [to, body]
 *             properties:
 *               to:
 *                 type: string
 *                 example: '+5511999999999'
 *               body:
 *                 type: string
 *     responses:
 *       200:
 *         description: SMS enviado
 */

/**
 * @openapi
 * /api/integrations/twilio/whatsapp:
 *   post:
 *     summary: Enviar WhatsApp
 *     tags: [Twilio]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [to, body]
 *             properties:
 *               to:
 *                 type: string
 *               body:
 *                 type: string
 *               mediaUrl:
 *                 type: string
 *                 format: uri
 *     responses:
 *       200:
 *         description: Mensagem enviada
 */

/**
 * @openapi
 * /api/integrations/resend/email:
 *   post:
 *     summary: Enviar email
 *     tags: [Resend]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [to, subject, html]
 *             properties:
 *               to:
 *                 type: string
 *                 format: email
 *               subject:
 *                 type: string
 *               html:
 *                 type: string
 *               from:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Email enviado
 */

/**
 * @openapi
 * /api/integrations/stats:
 *   get:
 *     summary: Estatísticas de integrações
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Estatísticas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 stripe:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                     lastSync:
 *                       type: string
 *                 wise:
 *                   type: object
 *                 erpnext:
 *                   type: object
 */

/**
 * @openapi
 * /metrics:
 *   get:
 *     summary: Métricas Prometheus
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: Métricas
 */

export {};
