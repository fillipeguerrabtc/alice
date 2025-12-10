import express, { Request, Response } from 'express';
import Stripe from 'stripe';
import cors from 'cors';
// helmet aplicado via createSecurityMiddleware de @alice/shared-utils
import compression from 'compression';
// rateLimit via createRateLimiter de @alice/shared-utils
// CircuitBreaker via createCircuitBreaker de @alice/shared-utils
import crypto from 'crypto';
import { createLogger } from '@alice/logger';
import { 
  createCorrelationMiddleware, 
  createSecurityMiddleware,
  createRateLimiter,
  createErrorHandler,
  createNotFoundHandler,
  requirePermission, 
  extractAuthContext,
  generateInternalAuthHeaders,
  initFeatureFlags,
  createAlicePrometheus,
  initRbacPrometheusMetrics,
  instrumentCircuitBreaker,
  createCircuitBreaker,
  CIRCUIT_BREAKER_PRESETS,
  registerShutdownCallback,
  ShutdownPriority,
  setupSwaggerUI,
  INTEGRATIONS_SERVICE_TAGS,
} from '@alice/shared-utils';
import { integrationsServicePaths, integrationsServiceSchemas } from './openapi-specs.js';
import { loadConfig, integrationsServiceConfigSchema } from '@alice/config';
import { getDatabase, schema, closeDatabasePool, isPoolHealthy, createDrizzleFeatureFlagStorage } from '@alice/database';
import { eq, desc, sql, and } from '@alice/database';
import { z } from 'zod';
import { wiseService } from './wiseService.js';
import { isWiseConfigured, getSandboxStatus, getProfileIdSafe, getWiseCircuitBreakerStatus, validateWiseWebhook } from './wiseClient.js';
import { initWiseSyncService } from './wiseSyncService.js';

const logger = createLogger('integrations-service');
const config = loadConfig(integrationsServiceConfigSchema);

const app = express();

// ============================================================================
// PROMETHEUS: Instrumentação de métricas (Regra 16 - Observability Enterprise)
// ============================================================================
const { metrics, metricsRouter, httpMetricsMiddleware } = createAlicePrometheus({
  serviceName: 'integrations-service',
  collectDefaultMetrics: true,
});

// Inicializar métricas RBAC (Regra 16 - Observability Enterprise)
initRbacPrometheusMetrics(metrics.rbac);
logger.info('Métricas RBAC Prometheus inicializadas no integrations-service');

// Endpoint /metrics para Prometheus scraper (antes de outros middlewares)
app.use(metricsRouter);

// ============================================================================
// OPENAPI/SWAGGER: Documentação da API (OWASP API9)
// ============================================================================
setupSwaggerUI(app, {
  serviceName: 'integrations-service',
  version: '1.0.0',
  description: 'Serviço de integrações: Stripe, Wise, ERPNext, Twilio, Resend.',
  port: config.PORT ?? 3005,
  tags: INTEGRATIONS_SERVICE_TAGS,
  paths: integrationsServicePaths,
  schemas: integrationsServiceSchemas,
});
logger.info('Swagger UI configurado em /api/docs');

// Middleware para coletar métricas HTTP automaticamente
app.use(httpMetricsMiddleware);

// SEGURANÇA: Desabilitar X-Powered-By header (Express.js 2025 + OWASP API8)
app.disable('x-powered-by');

// SEGURANÇA: Trust proxy = 1 para confiar apenas no primeiro proxy (Traefik)
// Evita bypass de rate limiting (express-rate-limit 2025 best practice)
app.set('trust proxy', 1);

// STRIPE API VERSION: Versão estável atual (Novembro 2025)
// Referência: https://docs.stripe.com/changelog
const STRIPE_API_VERSION = '2024-12-18.acacia' as Stripe.LatestApiVersion;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DEFAULT_RESEND_FROM = 'onboarding@resend.dev';
const isProduction = config.NODE_ENV === 'production';

let stripe: Stripe | null = null;
if (config.STRIPE_SECRET_KEY) {
  stripe = new Stripe(config.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
  });
  logger.info({ apiVersion: STRIPE_API_VERSION }, 'Cliente Stripe inicializado');
}

if (isProduction && !RESEND_API_KEY) {
  logger.error('RESEND_API_KEY é obrigatório em produção (Regra 6 - fail-fast)');
  process.exit(1);
}

// Circuit Breaker para chamadas ao ERPNext (Best Practices 2025)
// Usa CIRCUIT_BREAKER_PRESETS centralizado (Regra 2 - Não Duplicar)

// RESILIÊNCIA: Timeout para chamadas externas (Best Practices 2025)
const EXTERNAL_API_TIMEOUT_MS = 8000;

const erpNextBreaker = createCircuitBreaker(async (options: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}) => {
  // RESILIÊNCIA: AbortController com timeout para evitar chamadas penduradas
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);
  
  try {
    const response = await fetch(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`ERPNext request failed: ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}, {
  name: 'erpnext-main',
  ...CIRCUIT_BREAKER_PRESETS.erpnextAPI,
});

// Instrumentar circuit breaker com métricas Prometheus
// Type assertion necessária: Opossum CircuitBreaker tem tipos de eventos mais específicos
instrumentCircuitBreaker(metrics, 'erpnext', erpNextBreaker as unknown as Parameters<typeof instrumentCircuitBreaker>[2]);

// Sincronizar cliente/pedido com ERPNext (com Circuit Breaker)
// Fluxo correto ERPNext: Customer → Sales Order → Sales Invoice → Payment Entry com referência
async function syncToERPNext(
  type: 'customer' | 'sales_order' | 'sales_invoice' | 'payment' | 'payment_from_invoice', 
  data: Record<string, unknown>
) {
  if (!config.ERPNEXT_URL || !config.ERPNEXT_API_KEY || !config.ERPNEXT_API_SECRET) {
    logger.warn('ERPNext não configurado, sincronização ignorada');
    return null;
  }

  const doctypes: Record<string, string> = {
    customer: 'Customer',
    sales_order: 'Sales Order',
    sales_invoice: 'Sales Invoice',
    payment: 'Payment Entry',
    payment_from_invoice: 'Payment Entry', // Usado quando temos referência a invoice
  };

  try {
    // Para Payment Entry com referência a invoice, usar API especial do ERPNext
    if (type === 'payment_from_invoice' && data.against_invoice) {
      // Usar o método get_payment_entry para criar Payment Entry corretamente linkado
      const getPaymentResult = await erpNextBreaker.fire({
        url: `${config.ERPNEXT_URL}/api/method/erpnext.accounts.doctype.payment_entry.payment_entry.get_payment_entry`,
        method: 'POST',
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dt: 'Sales Invoice',
          dn: data.against_invoice,
          party_amount: data.paid_amount,
          payment_type: 'Receive',
        }),
      }) as { message: Record<string, unknown> };

      // Salvar o Payment Entry gerado
      const paymentEntry = getPaymentResult.message;
      paymentEntry.reference_no = data.reference_no;
      paymentEntry.reference_date = data.reference_date;
      paymentEntry.mode_of_payment = data.mode_of_payment;
      
      // Adicionar campos custom se existirem
      if (data.custom_stripe_payment_intent_id) {
        paymentEntry.custom_stripe_payment_intent_id = data.custom_stripe_payment_intent_id;
      }
      if (data.custom_wise_transfer_id) {
        paymentEntry.custom_wise_transfer_id = data.custom_wise_transfer_id;
      }

      const result = await erpNextBreaker.fire({
        url: `${config.ERPNEXT_URL}/api/resource/Payment%20Entry`,
        method: 'POST',
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentEntry),
      }) as { data: { name: string } };

      logger.info({ type: 'payment_from_invoice', erpnextId: result.data.name, invoice: data.against_invoice }, 'Payment Entry criado com referência a Invoice');
      return result.data;
    }

    const result = await erpNextBreaker.fire({
      url: `${config.ERPNEXT_URL}/api/resource/${doctypes[type]}`,
      method: 'POST',
      headers: {
        'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    }) as { data: { name: string } };

    logger.info({ type, erpnextId: result.data.name }, 'Sincronizado com ERPNext');
    return result.data;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      logger.warn({ type }, 'Circuit breaker aberto - ERPNext temporariamente indisponível');
    } else {
      logger.error({ error, type }, 'Falha ao sincronizar com ERPNext');
    }
    return null;
  }
}

// Criar Sales Invoice a partir de Sales Order
async function createInvoiceFromOrder(salesOrderName: string): Promise<string | null> {
  if (!config.ERPNEXT_URL || !config.ERPNEXT_API_KEY || !config.ERPNEXT_API_SECRET) {
    return null;
  }

  try {
    // Usar API do ERPNext para criar Invoice a partir de Sales Order
    const result = await erpNextBreaker.fire({
      url: `${config.ERPNEXT_URL}/api/method/erpnext.selling.doctype.sales_order.sales_order.make_sales_invoice`,
      method: 'POST',
      headers: {
        'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source_name: salesOrderName }),
    }) as { message: Record<string, unknown> };

    // Salvar a invoice gerada
    const invoice = result.message;
    const saveResult = await erpNextBreaker.fire({
      url: `${config.ERPNEXT_URL}/api/resource/Sales%20Invoice`,
      method: 'POST',
      headers: {
        'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(invoice),
    }) as { data: { name: string } };

    logger.info({ salesOrder: salesOrderName, invoice: saveResult.data.name }, 'Sales Invoice criada a partir de Sales Order');
    return saveResult.data.name;
  } catch (error) {
    logger.error({ error, salesOrder: salesOrderName }, 'Falha ao criar Sales Invoice a partir de Sales Order');
    return null;
  }
}

// Inicializar sistema de feature flags com storage PostgreSQL (Regra 16 - Enterprise)
const featureFlagStorage = createDrizzleFeatureFlagStorage();
initFeatureFlags(featureFlagStorage);
logger.info('Sistema de feature flags inicializado');

const corsOriginsEnv = process.env.CORS_ORIGINS;
if (!corsOriginsEnv && process.env.NODE_ENV === 'production') {
  logger.error('CORS_ORIGINS é obrigatório em produção (Regra 6 - fail-fast)');
  process.exit(1);
}
const CORS_ORIGINS = corsOriginsEnv
  ? corsOriginsEnv.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [];

// SEGURANÇA: Helmet com CSP/HSTS enterprise (Express.js 2025 + OWASP 2023)
app.use(createSecurityMiddleware({
  contentSecurityPolicy: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV !== 'production',
}));

// OBSERVABILITY: Correlation ID middleware para rastreamento distribuído (Node.js 20 LTS 2025)
// Propaga correlation IDs entre microsserviços e injeta nos logs automaticamente
app.use(createCorrelationMiddleware({ serviceName: 'integrations-service' }));

// PERFORMANCE: Compression para reduzir tamanho de respostas (Express.js 2025)
app.use(compression());

// NOTA: Helmet já aplicado via createSecurityMiddleware() acima

app.use(cors({
  origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : false,
  credentials: CORS_ORIGINS.length > 0,
}));

// SEGURANÇA: Rate limiting multi-tenant (express-rate-limit 2025)
app.use(createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  skipRoutes: ['/api/integrations/health', '/api/integrations/stripe/webhook', '/api/integrations/wise/webhook', '/api/integrations/twilio/webhook'],
  serviceName: 'integrations-service',
}));

app.use('/api/integrations/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/integrations/wise/webhook', express.raw({ type: 'application/json' }));
app.use('/api/integrations/twilio/webhook', express.urlencoded({ extended: false }));
// SEGURANÇA: Limites de payload para prevenir DoS (OWASP API4)
app.use(express.json({ limit: '10mb' }));

app.get('/api/integrations/health', (_req: Request, res: Response) => {
  const wiseConfigured = isWiseConfigured();
  res.json({ 
    status: 'ok', 
    service: 'integrations-service', 
    timestamp: new Date().toISOString(),
    integrations: {
      stripe: !!stripe,
      erpnext: !!config.ERPNEXT_URL,
      wise: wiseConfigured,
    },
    circuitBreakers: {
      erpnext: erpNextBreaker.opened ? 'open' : 'closed',
      wise: wiseConfigured ? getWiseCircuitBreakerStatus() : null,
    },
  });
});

// ============================================================================
// KUBERNETES PROBES: /ready e /live (Regra 16 - Best Practices 2025)
// /live: Processo está vivo? Se não, Kubernetes reinicia o container
// /ready: Pronto para tráfego? Verifica conexão com PostgreSQL e circuit breakers
// ============================================================================

// Liveness probe - verificação simples que o processo responde
app.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ 
    status: 'alive', 
    service: 'integrations-service',
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe - verifica se PostgreSQL e integrações críticas estão acessíveis
app.get('/ready', async (_req: Request, res: Response) => {
  try {
    const dbHealthy = await isPoolHealthy();
    const erpnextReady = !erpNextBreaker.opened;
    
    // Para readiness, verificamos apenas PostgreSQL (obrigatório) e ERPNext (se configurado)
    const allReady = dbHealthy && (erpnextReady || !config.ERPNEXT_URL);
    
    if (allReady) {
      res.status(200).json({
        status: 'ready',
        service: 'integrations-service',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgresql: 'ready',
          erpnext: config.ERPNEXT_URL ? (erpnextReady ? 'ready' : 'circuit_open') : 'not_configured',
        },
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        service: 'integrations-service',
        reason: !dbHealthy ? 'PostgreSQL não está acessível' : 'ERPNext circuit breaker aberto',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgresql: dbHealthy ? 'ready' : 'not_ready',
          erpnext: config.ERPNEXT_URL ? (erpnextReady ? 'ready' : 'circuit_open') : 'not_configured',
        },
      });
    }
  } catch (error) {
    logger.error({ error }, 'Erro ao verificar readiness');
    res.status(503).json({
      status: 'not_ready',
      service: 'integrations-service',
      reason: 'Erro ao verificar dependências',
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/integrations', requirePermission('integrations:integrations:read'), async (req: Request, res: Response) => {
  // OWASP API3: Validação de query params
  const queryResult = integrationsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }
  const { tenantId } = queryResult.data;

  try {
    const db = getDatabase();

    const integrations = await db.query.integrations.findMany({
      where: tenantId ? eq(schema.integrations.tenantId, tenantId) : undefined,
      orderBy: [desc(schema.integrations.criadoEm)],
    });

    res.json({ integrations });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch integrations');
    res.status(500).json({ error: 'Internal server error' });
  }
});

const createIntegrationSchema = z.object({
  tenantId: z.string().uuid().optional(),
  tipo: z.enum(['stripe', 'erpnext', 'twilio', 'resend', 'whatsapp']),
  nome: z.string().min(1),
  configuracao: z.record(z.unknown()).optional(),
  credenciais: z.record(z.unknown()).optional(),
});

// OWASP API3 - Schemas Zod para Twilio webhooks e rotas
// Referência: https://www.twilio.com/docs/messaging/webhooks/message-webhooks
// Regex para formato Twilio: "whatsapp:+xxxxxxxxxxx" ou "+xxxxxxxxxxx"
const twilioPhoneRegex = /^(whatsapp:)?\+?[1-9]\d{9,14}$/;
// Regex para MessageSid webhook incoming: MM + 32 hex chars (MMS) ou SM + 32 (SMS)
const twilioIncomingSidRegex = /^(SM|MM)[0-9a-fA-F]{32}$/;
const twilioWebhookSchema = z.object({
  MessageSid: z.string().regex(twilioIncomingSidRegex), // SM/MM + 32 hex chars
  From: z.string().min(10).max(30).regex(twilioPhoneRegex), // whatsapp:+xxxxxxxxxxx ou +xxxxxxxxxxx
  To: z.string().min(10).max(30).regex(twilioPhoneRegex),
  Body: z.string().max(1600).default(''), // WhatsApp max message size
  NumMedia: z.string().regex(/^\d+$/).optional(),
  MediaUrl0: z.string().url().optional(),
  MediaContentType0: z.string().max(100).optional(),
});

// Twilio message status enum completo
// Docs: https://www.twilio.com/docs/messaging/guides/outbound-message-statuses
// Inclui todos os status: outbound, inbound e WhatsApp específicos
const twilioMessageStatuses = [
  // Outbound statuses
  'accepted', 'queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed',
  // Inbound statuses
  'receiving', 'received',
  // Scheduled message statuses
  'scheduled', 'canceled',
  // WhatsApp specific statuses
  'read',
] as const;
// Regex para MessageSid: SM + 32 hex chars
const twilioSidRegex = /^SM[0-9a-fA-F]{32}$/;
const twilioStatusSchema = z.object({
  MessageSid: z.string().regex(twilioSidRegex), // SM + 32 hex chars
  MessageStatus: z.enum(twilioMessageStatuses),
  ErrorCode: z.string().max(10).optional(),
  ErrorMessage: z.string().max(500).optional(),
  To: z.string().min(10).max(30).regex(twilioPhoneRegex), // whatsapp:+xxxxxxxxxxx ou +xxxxxxxxxxx
});

const twilioSendSchema = z.object({
  to: z.string().min(10).max(30).regex(twilioPhoneRegex), // whatsapp:+xxxxxxxxxxx ou +xxxxxxxxxxx
  message: z.string().min(1).max(1600), // WhatsApp max message size
  conversationId: z.string().uuid().optional(),
  mediaUrl: z.string().url().optional(),
});

// ============================================================================
// OWASP API3 - Schemas Zod para validação de parâmetros de rota e query
// Previne NaN e injection via parâmetros não validados
// ============================================================================

// Schema para ID numérico positivo (Wise recipient/transfer IDs)
const numericIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'ID deve ser numérico').transform(Number).refine(n => n > 0, 'ID deve ser positivo'),
});

// Schema para ID string (batch groups usam UUID) - reservado para uso futuro
const _stringIdParamSchema = z.object({
  id: z.string().min(1).max(100),
});

// Schema para query params de paginação
const paginationQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).transform(Number).refine(n => n >= 1 && n <= 100, 'limit deve ser entre 1 e 100').optional(),
  offset: z.string().regex(/^\d+$/).transform(Number).refine(n => n >= 0, 'offset deve ser >= 0').optional(),
});

// Schema para query params com tenantId opcional
const tenantQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

// Schema para query params de integrations
const integrationsQuerySchema = tenantQuerySchema;

// OWASP API3: Schemas para validação de query params Wise
// Previne injection e garante tipos corretos

// Schema para taxas de câmbio (source/target currencies)
const wiseRatesQuerySchema = z.object({
  source: z.string()
    .min(3, 'source deve ter 3 caracteres')
    .max(3, 'source deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'source deve ser código de moeda válido (ex: USD, EUR, BRL)'),
  target: z.string()
    .min(3, 'target deve ter 3 caracteres')
    .max(3, 'target deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'target deve ser código de moeda válido (ex: USD, EUR, BRL)'),
});

// Schema para filtro de destinatários por moeda (opcional)
const wiseRecipientsQuerySchema = z.object({
  currency: z.string()
    .min(3, 'currency deve ter 3 caracteres')
    .max(3, 'currency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'currency deve ser código de moeda válido')
    .optional(),
});

// Schema para requisitos de destinatário
const wiseRecipientRequirementsQuerySchema = z.object({
  sourceCurrency: z.string()
    .min(3, 'sourceCurrency deve ter 3 caracteres')
    .max(3, 'sourceCurrency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'sourceCurrency deve ser código de moeda válido'),
  targetCurrency: z.string()
    .min(3, 'targetCurrency deve ter 3 caracteres')
    .max(3, 'targetCurrency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'targetCurrency deve ser código de moeda válido'),
  sourceAmount: z.string()
    .regex(/^\d+(\.\d{1,2})?$/, 'sourceAmount deve ser número válido')
    .transform(Number)
    .refine(n => n > 0, 'sourceAmount deve ser positivo'),
});

app.post('/api/integrations', requirePermission('integrations:integrations:write'), async (req: Request, res: Response) => {
  try {
    const body = createIntegrationSchema.parse(req.body);
    const db = getDatabase();

    const [integration] = await db.insert(schema.integrations).values({
      tenantId: body.tenantId,
      tipo: body.tipo,
      nome: body.nome,
      configuracao: body.configuracao || {},
      credenciais: body.credenciais || {},
      ativo: true,
    }).returning();

    logger.info({ integrationId: integration.id, tipo: body.tipo }, 'Integration created');
    res.json({ integration });
  } catch (error) {
    logger.error({ error }, 'Failed to create integration');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/integrations/stripe/create-checkout', requirePermission('integrations:stripe:write'), async (req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const { priceId, userId, successUrl, cancelUrl } = req.body;

  try {
    const db = getDatabase();
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });

    let customerId = user?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user?.email || undefined,
        name: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || undefined,
        metadata: { userId },
      });
      customerId = customer.id;

      await db.update(schema.users)
        .set({ stripeCustomerId: customerId })
        .where(eq(schema.users.id, userId));
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId },
    });

    logger.info({ sessionId: session.id, userId }, 'Checkout session created');
    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    logger.error({ error }, 'Failed to create checkout session');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/integrations/stripe/create-portal', requirePermission('integrations:stripe:write'), async (req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const { userId, returnUrl } = req.body;

  try {
    const db = getDatabase();
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });

    if (!user?.stripeCustomerId) {
      return res.status(400).json({ error: 'User has no Stripe customer' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: returnUrl,
    });

    res.json({ url: session.url });
  } catch (error) {
    logger.error({ error }, 'Failed to create portal session');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Listar produtos do Stripe
app.get('/api/integrations/stripe/products', requirePermission('integrations:stripe:read'), async (_req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  try {
    const products = await stripe.products.list({ active: true, limit: 100 });
    const prices = await stripe.prices.list({ active: true, limit: 100 });

    const productsWithPrices = products.data.map(product => ({
      ...product,
      prices: prices.data.filter(price => price.product === product.id),
    }));

    res.json({ products: productsWithPrices });
  } catch (error) {
    logger.error({ error }, 'Failed to list products');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Criar PaymentIntent para pagamento único
app.post('/api/integrations/stripe/create-payment-intent', requirePermission('integrations:stripe:write'), async (req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const { amount, currency = 'eur', userId, description } = req.body;

  try {
    const db = getDatabase();
    let customerId: string | undefined;

    if (userId) {
      const user = await db.query.users.findFirst({
        where: eq(schema.users.id, userId),
      });

      if (user?.stripeCustomerId) {
        customerId = user.stripeCustomerId;
      } else if (user?.email) {
        const customer = await stripe.customers.create({
          email: user.email,
          name: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
          metadata: { userId },
        });
        customerId = customer.id;

        await db.update(schema.users)
          .set({ stripeCustomerId: customerId })
          .where(eq(schema.users.id, userId));
      }
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      customer: customerId,
      description,
      automatic_payment_methods: { enabled: true },
      metadata: { userId: userId || '' },
    });

    logger.info({ paymentIntentId: paymentIntent.id, amount, currency }, 'PaymentIntent created');
    res.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
  } catch (error) {
    logger.error({ error }, 'Failed to create PaymentIntent');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Validar secrets obrigatórios em produção (Regra 16 - Segurança Enterprise)
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const WISE_WEBHOOK_SECRET = process.env.WISE_WEBHOOK_SECRET;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// STRIPE: Fail-fast se produção sem webhook secret
if (!STRIPE_WEBHOOK_SECRET && IS_PRODUCTION && stripe) {
  logger.error('CRITICAL: STRIPE_WEBHOOK_SECRET é OBRIGATÓRIO em produção com Stripe ativo. Abortando.');
  process.exit(1);
}

// WISE: Fail-fast se produção sem webhook secret e Wise configurado
if (!WISE_WEBHOOK_SECRET && IS_PRODUCTION && isWiseConfigured()) {
  logger.error('CRITICAL: WISE_WEBHOOK_SECRET é OBRIGATÓRIO em produção com Wise ativo. Abortando.');
  process.exit(1);
}

// Função auxiliar para verificar idempotência de webhooks
async function checkWebhookIdempotency(
  db: ReturnType<typeof getDatabase>,
  source: 'stripe' | 'wise' | 'twilio' | 'erpnext',
  eventId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<{ isDuplicate: boolean; existingEvent?: typeof schema.webhookEvents.$inferSelect }> {
  // Verificar se evento já foi processado
  const existingEvent = await db.query.webhookEvents.findFirst({
    where: and(
      eq(schema.webhookEvents.source, source),
      eq(schema.webhookEvents.eventId, eventId)
    ),
  });

  if (existingEvent) {
    logger.info({ 
      source, 
      eventId, 
      processedAt: existingEvent.processedAt,
    }, 'Webhook duplicado detectado - ignorando (idempotência)');
    return { isDuplicate: true, existingEvent };
  }

  // Registrar evento para garantir idempotência
  await db.insert(schema.webhookEvents).values({
    source,
    eventId,
    eventType,
    payload,
    processed: false,
  });

  return { isDuplicate: false };
}

// Função auxiliar para marcar webhook como processado
async function markWebhookProcessed(
  db: ReturnType<typeof getDatabase>,
  source: 'stripe' | 'wise' | 'twilio' | 'erpnext',
  eventId: string,
  result: Record<string, unknown>,
  error?: string
): Promise<void> {
  await db.update(schema.webhookEvents)
    .set({
      processed: !error,
      processedAt: new Date(),
      result,
      error,
      retryCount: error ? sql`retry_count + 1` : undefined,
    })
    .where(and(
      eq(schema.webhookEvents.source, source),
      eq(schema.webhookEvents.eventId, eventId)
    ));
}

app.post('/api/integrations/stripe/webhook', async (req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const contentTypeHeader = req.headers['content-type'];
  const contentType = Array.isArray(contentTypeHeader)
    ? contentTypeHeader[0]?.toLowerCase()
    : contentTypeHeader?.toLowerCase();
  if (!contentType || !contentType.startsWith('application/json')) {
    logger.warn({ contentType }, 'Stripe webhook rejeitado: content-type inválido');
    return res.status(400).json({ error: 'Invalid content-type' });
  }

  const sig = req.headers['stripe-signature'] as string;

  if (!STRIPE_WEBHOOK_SECRET) {
    logger.error('Webhook recebido mas STRIPE_WEBHOOK_SECRET não configurado');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  // Exigir corpo bruto (Buffer) para validação de assinatura
  if (!Buffer.isBuffer(req.body)) {
    logger.error('Stripe webhook rejeitado: body não é Buffer (configure express.raw() antes da rota)');
    return res.status(500).json({ error: 'Invalid body parser for webhook' });
  }

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    const db = getDatabase();

    // IDEMPOTÊNCIA: Verificar se evento já foi processado
    const { isDuplicate } = await checkWebhookIdempotency(
      db,
      'stripe',
      event.id,
      event.type,
      event.data.object as unknown as Record<string, unknown>
    );

    if (isDuplicate) {
      return res.json({ received: true, duplicate: true });
    }

    let processingResult: Record<string, unknown> = {};
    let processingError: string | undefined;

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          const userId = session.metadata?.userId;

          if (userId && session.subscription) {
            await db.update(schema.users)
              .set({ stripeSubscriptionId: session.subscription as string })
              .where(eq(schema.users.id, userId));

            logger.info({ userId, subscriptionId: session.subscription }, 'Subscription created');
            processingResult = { userId, subscriptionId: session.subscription };
          }

          // FLUXO ERPNEXT COMPLETO: Customer → Sales Order → Sales Invoice → Payment Entry
          // Step 1: Criar registro de mapeamento para rastreabilidade
          const [mapping] = await db.insert(schema.stripeErpnextMapping).values({
            stripeSessionId: session.id,
            stripeCustomerId: session.customer as string,
            stripePaymentIntentId: session.payment_intent as string || null,
            stripeSubscriptionId: session.subscription as string || null,
            flowStatus: 'pending',
          }).returning();

          // Step 2: Criar Sales Order quando checkout completa
          if (session.customer && session.amount_total) {
            const customer = await stripe.customers.retrieve(session.customer as string);
            if (customer && !customer.deleted) {
              const salesOrderResult = await syncToERPNext('sales_order', {
                customer: customer.email || customer.id,
                transaction_date: new Date().toISOString().split('T')[0],
                delivery_date: new Date().toISOString().split('T')[0],
                currency: (session.currency || 'EUR').toUpperCase(),
                items: [{
                  item_code: session.metadata?.productId || 'SUBSCRIPTION',
                  qty: 1,
                  rate: (session.amount_total || 0) / 100,
                }],
                custom_stripe_session_id: session.id,
                custom_stripe_customer_id: session.customer,
              });
              
              if (salesOrderResult?.name) {
                // Atualizar mapeamento com Sales Order
                await db.update(schema.stripeErpnextMapping)
                  .set({ 
                    erpnextSalesOrder: salesOrderResult.name,
                    erpnextCustomer: customer.email || customer.id,
                    flowStatus: 'order_created',
                    atualizadoEm: new Date(),
                  })
                  .where(eq(schema.stripeErpnextMapping.id, mapping.id));
              }
              
              // Step 3: Se pagamento já foi feito (status=paid), criar Invoice + Payment Entry
              if (session.payment_status === 'paid' && salesOrderResult?.name) {
                // Criar Invoice a partir do Sales Order
                const invoiceName = await createInvoiceFromOrder(salesOrderResult.name);
                
                if (invoiceName) {
                  // Atualizar mapeamento com Invoice
                  await db.update(schema.stripeErpnextMapping)
                    .set({ 
                      erpnextSalesInvoice: invoiceName,
                      flowStatus: 'invoice_created',
                      atualizadoEm: new Date(),
                    })
                    .where(eq(schema.stripeErpnextMapping.id, mapping.id));

                  // Criar Payment Entry com referência à Invoice
                  const paymentResult = await syncToERPNext('payment_from_invoice', {
                    against_invoice: invoiceName,
                    paid_amount: (session.amount_total || 0) / 100,
                    reference_no: session.payment_intent as string || session.id,
                    reference_date: new Date().toISOString().split('T')[0],
                    mode_of_payment: 'Stripe',
                    custom_stripe_session_id: session.id,
                    custom_stripe_payment_intent_id: session.payment_intent,
                  });
                  
                  // Atualizar mapeamento com Payment Entry
                  if (paymentResult?.name) {
                    await db.update(schema.stripeErpnextMapping)
                      .set({ 
                        erpnextPaymentEntry: paymentResult.name,
                        flowStatus: 'complete',
                        atualizadoEm: new Date(),
                      })
                      .where(eq(schema.stripeErpnextMapping.id, mapping.id));
                  }
                  
                  logger.info({ 
                    salesOrder: salesOrderResult.name, 
                    invoice: invoiceName,
                    sessionId: session.id 
                  }, 'Fluxo ERPNext completo: Sales Order → Invoice → Payment Entry');
                  
                  processingResult = { 
                    ...processingResult, 
                    salesOrder: salesOrderResult.name, 
                    invoice: invoiceName,
                    erpnextFlowComplete: true 
                  };
                }
              } else if (salesOrderResult?.name) {
                // Pagamento pendente - apenas Sales Order criado
                logger.info({ 
                  salesOrder: salesOrderResult.name, 
                  sessionId: session.id,
                  paymentStatus: session.payment_status 
                }, 'Sales Order criado - Invoice será criada quando pagamento confirmar');
                processingResult = { ...processingResult, salesOrder: salesOrderResult.name };
              }
            }
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          const customerId = subscription.customer as string;

          const user = await db.query.users.findFirst({
            where: eq(schema.users.stripeCustomerId, customerId),
          });

          if (user) {
            await db.update(schema.users)
              .set({ stripeSubscriptionId: null })
              .where(eq(schema.users.id, user.id));

            logger.info({ userId: user.id }, 'Subscription cancelled');
            processingResult = { userId: user.id, action: 'subscription_cancelled' };
          }
          break;
        }

        case 'payment_intent.succeeded': {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          
          // Completar fluxo ERPNext se pagamento foi feito após checkout
          // Usar tabela de mapeamento para encontrar o Sales Order correto
          
          if (paymentIntent.amount && paymentIntent.customer) {
            // Buscar mapeamento pelo payment_intent_id
            const mapping = await db.query.stripeErpnextMapping.findFirst({
              where: eq(schema.stripeErpnextMapping.stripePaymentIntentId, paymentIntent.id),
            });

            if (mapping && mapping.erpnextSalesOrder) {
              // Verificar se fluxo já está completo
              if (mapping.flowStatus === 'complete') {
                logger.info({ paymentIntentId: paymentIntent.id, mappingId: mapping.id }, 
                  'Fluxo ERPNext já completo - ignorando payment_intent.succeeded');
                processingResult = { 
                  paymentIntentId: paymentIntent.id, 
                  amount: paymentIntent.amount,
                  alreadyComplete: true 
                };
              } else if (mapping.flowStatus === 'order_created') {
                // Sales Order existe mas Invoice não - criar Invoice + Payment Entry
                try {
                  const invoiceName = await createInvoiceFromOrder(mapping.erpnextSalesOrder);
                  
                  if (invoiceName) {
                    // Atualizar mapeamento com Invoice
                    await db.update(schema.stripeErpnextMapping)
                      .set({ 
                        erpnextSalesInvoice: invoiceName,
                        flowStatus: 'invoice_created',
                        atualizadoEm: new Date(),
                      })
                      .where(eq(schema.stripeErpnextMapping.id, mapping.id));

                    // Criar Payment Entry com referência à Invoice
                    const paymentResult = await syncToERPNext('payment_from_invoice', {
                      against_invoice: invoiceName,
                      paid_amount: paymentIntent.amount / 100,
                      reference_no: paymentIntent.id,
                      reference_date: new Date().toISOString().split('T')[0],
                      mode_of_payment: 'Stripe',
                      custom_stripe_payment_intent_id: paymentIntent.id,
                    });
                    
                    // Atualizar mapeamento com Payment Entry
                    if (paymentResult?.name) {
                      await db.update(schema.stripeErpnextMapping)
                        .set({ 
                          erpnextPaymentEntry: paymentResult.name,
                          flowStatus: 'complete',
                          atualizadoEm: new Date(),
                        })
                        .where(eq(schema.stripeErpnextMapping.id, mapping.id));
                    }
                    
                    logger.info({ 
                      salesOrder: mapping.erpnextSalesOrder, 
                      invoice: invoiceName,
                      paymentIntentId: paymentIntent.id 
                    }, 'Fluxo ERPNext completado via payment_intent.succeeded');
                    
                    processingResult = { 
                      paymentIntentId: paymentIntent.id, 
                      amount: paymentIntent.amount,
                      salesOrder: mapping.erpnextSalesOrder,
                      invoice: invoiceName,
                      erpnextFlowComplete: true
                    };
                  }
                } catch (erpnextError) {
                  logger.error({ error: erpnextError, paymentIntentId: paymentIntent.id, mapping }, 
                    'Falha ao completar fluxo ERPNext via payment_intent.succeeded');
                  
                  processingResult = { 
                    paymentIntentId: paymentIntent.id, 
                    amount: paymentIntent.amount,
                    error: 'ERPNext flow failed',
                    salesOrder: mapping.erpnextSalesOrder
                  };
                }
              } else if (mapping.flowStatus === 'invoice_created' && mapping.erpnextSalesInvoice) {
                // Invoice existe mas Payment Entry não - criar apenas Payment Entry
                try {
                  const paymentResult = await syncToERPNext('payment_from_invoice', {
                    against_invoice: mapping.erpnextSalesInvoice,
                    paid_amount: paymentIntent.amount / 100,
                    reference_no: paymentIntent.id,
                    reference_date: new Date().toISOString().split('T')[0],
                    mode_of_payment: 'Stripe',
                    custom_stripe_payment_intent_id: paymentIntent.id,
                  });
                  
                  if (paymentResult?.name) {
                    await db.update(schema.stripeErpnextMapping)
                      .set({ 
                        erpnextPaymentEntry: paymentResult.name,
                        flowStatus: 'complete',
                        atualizadoEm: new Date(),
                      })
                      .where(eq(schema.stripeErpnextMapping.id, mapping.id));
                  }
                  
                  processingResult = { 
                    paymentIntentId: paymentIntent.id, 
                    amount: paymentIntent.amount,
                    invoice: mapping.erpnextSalesInvoice,
                    paymentCreated: true
                  };
                } catch (paymentError) {
                  logger.error({ error: paymentError, paymentIntentId: paymentIntent.id }, 
                    'Falha ao criar Payment Entry');
                }
              }
            } else {
              // Sem mapeamento encontrado - registrar apenas metadados
              logger.info({ paymentIntentId: paymentIntent.id }, 
                'Payment intent sem mapeamento - provavelmente processado por checkout.session.completed');
              processingResult = { 
                paymentIntentId: paymentIntent.id, 
                amount: paymentIntent.amount,
                note: 'No mapping found - may be handled by checkout.session.completed'
              };
            }
          }
          break;
        }

        case 'customer.created': {
          const customer = event.data.object as Stripe.Customer;
          
          // Sincronizar cliente com ERPNext
          await syncToERPNext('customer', {
            customer_name: customer.name || customer.email || customer.id,
            customer_type: 'Individual',
            customer_group: 'Individual',
            territory: 'Portugal',
            email_id: customer.email,
            custom_stripe_customer_id: customer.id,
          });
          processingResult = { customerId: customer.id };
          break;
        }
      }
    } catch (processingErr) {
      processingError = processingErr instanceof Error ? processingErr.message : String(processingErr);
      logger.error({ error: processingErr, eventId: event.id }, 'Erro ao processar webhook Stripe');
    }

    // Marcar webhook como processado (ou com erro)
    await markWebhookProcessed(db, 'stripe', event.id, processingResult, processingError);

    res.json({ received: true });
  } catch (error) {
    logger.error({ error }, 'Webhook error');
    res.status(400).json({ error: 'Webhook error' });
  }
});

app.get('/api/integrations/erpnext/test', requirePermission('integrations:erpnext:read'), async (_req: Request, res: Response) => {
  if (!config.ERPNEXT_URL) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  // RESILIÊNCIA: AbortController com timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.ERPNEXT_URL}/api/method/frappe.auth.get_logged_user`, {
      headers: {
        'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error('ERPNext connection failed');
    }

    const data = await response.json() as { message: string };
    res.json({ status: 'connected', user: data.message });
  } catch (error) {
    logger.error({ error }, 'ERPNext test failed');
    res.status(500).json({ error: 'ERPNext connection failed' });
  } finally {
    clearTimeout(timeoutId);
  }
});

app.get('/api/integrations/erpnext/customers', requirePermission('integrations:erpnext:read'), async (_req: Request, res: Response) => {
  if (!config.ERPNEXT_URL) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  // RESILIÊNCIA: AbortController com timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${config.ERPNEXT_URL}/api/resource/Customer?fields=["name","customer_name","customer_type","territory"]&limit_page_length=100`,
      {
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
        },
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch customers');
    }

    const data = await response.json() as { data: unknown[] };
    res.json({ customers: data.data });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch ERPNext customers');
    res.status(500).json({ error: 'Failed to fetch customers' });
  } finally {
    clearTimeout(timeoutId);
  }
});

app.get('/api/integrations/erpnext/items', requirePermission('integrations:erpnext:read'), async (_req: Request, res: Response) => {
  if (!config.ERPNEXT_URL) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  // RESILIÊNCIA: AbortController com timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${config.ERPNEXT_URL}/api/resource/Item?fields=["name","item_name","item_group","stock_uom","standard_rate"]&limit_page_length=100`,
      {
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
        },
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch items');
    }

    const data = await response.json() as { data: unknown[] };
    res.json({ items: data.data });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch ERPNext items');
    res.status(500).json({ error: 'Failed to fetch items' });
  } finally {
    clearTimeout(timeoutId);
  }
});

const resendEmailSchema = z.object({
  to: z.union([
    z.string().trim().email(),
    z.array(z.string().trim().email()).min(1),
  ]),
  subject: z.string().min(1).max(200),
  html: z.string().min(1),
  from: z.string().trim().email().optional(),
});

app.post('/api/integrations/resend/send', requirePermission('integrations:resend:write'), async (req: Request, res: Response) => {
  const parsed = resendEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn({ errors: parsed.error.flatten() }, 'Payload inválido para Resend');
    return res.status(400).json({ error: 'Payload inválido', details: parsed.error.format() });
  }

  if (!RESEND_API_KEY) {
    return res.status(503).json({ error: 'Resend não configurado' });
  }

  const to = parsed.data.to;
  const subject = parsed.data.subject;
  const html = parsed.data.html;
  const fromEmail = parsed.data.from ?? DEFAULT_RESEND_FROM;

  // RESILIÊNCIA: AbortController com timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to,
        subject,
        html,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, errorText }, 'Falha no envio via Resend');
      throw new Error(errorText || 'Resend returned non-200');
    }

    const data = await response.json() as { id: string };
    logger.info({ to, subject, from: fromEmail }, 'Email enviado via Resend');
    res.json({ success: true, id: data.id });
  } catch (error) {
    logger.error({ error }, 'Failed to send email');
    res.status(500).json({ error: 'Failed to send email' });
  } finally {
    clearTimeout(timeoutId);
  }
});

// ============================================================
// WISE API - Pagamentos Globais
// Documentação: https://docs.wise.com/api-docs/
// ============================================================

// Obter saldos multi-moeda
app.get('/api/integrations/wise/balances', requirePermission('integrations:wise:read'), async (_req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  try {
    const account = await wiseService.getBalances();
    res.json({ balances: account.balances, sandbox: wiseService.isSandboxMode() });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter saldos Wise');
    res.status(500).json({ error: 'Falha ao obter saldos' });
  }
});

// Obter taxas de câmbio
app.get('/api/integrations/wise/rates', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação Zod obrigatória de query params
  const queryResult = wiseRatesQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    logger.warn({ errors: queryResult.error.flatten() }, 'Input inválido em /api/integrations/wise/rates');
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }

  const { source, target } = queryResult.data;

  try {
    const rate = await wiseService.getExchangeRates(source, target);
    res.json({ rate });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter taxa de câmbio Wise');
    res.status(500).json({ error: 'Falha ao obter taxa de câmbio' });
  }
});

// Criar cotação
app.post('/api/integrations/wise/quotes', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const { sourceCurrency, targetCurrency, sourceAmount, targetAmount } = req.body;

  try {
    const quote = await wiseService.createQuote({
      sourceCurrency,
      targetCurrency,
      sourceAmount,
      targetAmount,
    });
    res.json({ quote });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar cotação Wise');
    res.status(500).json({ error: 'Falha ao criar cotação' });
  }
});

// Listar destinatários
app.get('/api/integrations/wise/recipients', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação Zod de query params (currency é opcional)
  const queryResult = wiseRecipientsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    logger.warn({ errors: queryResult.error.flatten() }, 'Input inválido em /api/integrations/wise/recipients');
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }

  const { currency } = queryResult.data;

  try {
    const recipients = await wiseService.listRecipients(currency);
    res.json({ recipients });
  } catch (error) {
    logger.error({ error }, 'Falha ao listar destinatários Wise');
    res.status(500).json({ error: 'Falha ao listar destinatários' });
  }
});

// Criar destinatário
app.post('/api/integrations/wise/recipients', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const { currency, type, accountHolderName, details } = req.body;

  try {
    const recipient = await wiseService.createRecipient({
      currency,
      type,
      accountHolderName,
      details,
    });
    res.json({ recipient });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar destinatário Wise');
    res.status(500).json({ error: 'Falha ao criar destinatário' });
  }
});

// Obter destinatário por ID
app.get('/api/integrations/wise/recipients/:id', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de parâmetro de rota
  const paramResult = numericIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
  }

  try {
    const recipient = await wiseService.getRecipient(paramResult.data.id);
    res.json({ recipient });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter destinatário Wise');
    res.status(500).json({ error: 'Falha ao obter destinatário' });
  }
});

// Excluir destinatário
app.delete('/api/integrations/wise/recipients/:id', requirePermission('integrations:wise:delete'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de parâmetro de rota
  const paramResult = numericIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
  }

  try {
    await wiseService.deleteRecipient(paramResult.data.id);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Falha ao excluir destinatário Wise');
    res.status(500).json({ error: 'Falha ao excluir destinatário' });
  }
});

// Listar transferências
app.get('/api/integrations/wise/transfers', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de query params de paginação
  const queryResult = paginationQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }
  const limit = queryResult.data.limit ?? 20;
  const offset = queryResult.data.offset ?? 0;

  try {
    const transfers = await wiseService.listTransfers(limit, offset);
    res.json({ transfers });
  } catch (error) {
    logger.error({ error }, 'Falha ao listar transferências Wise');
    res.status(500).json({ error: 'Falha ao listar transferências' });
  }
});

// Criar transferência
app.post('/api/integrations/wise/transfers', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const { targetAccount, quoteUuid, customerTransactionId, details } = req.body;

  try {
    const transfer = await wiseService.createTransfer({
      targetAccount,
      quoteUuid,
      customerTransactionId: customerTransactionId || `alice-${Date.now()}`,
      details: details || { reference: 'Pagamento Alice' },
    });

    logger.info({ transferId: transfer.id, targetAccount }, 'Transferência Wise criada');
    res.json({ transfer });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar transferência Wise');
    res.status(500).json({ error: 'Falha ao criar transferência' });
  }
});

// Obter transferência por ID
app.get('/api/integrations/wise/transfers/:id', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de parâmetro de rota
  const paramResult = numericIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
  }

  try {
    const transfer = await wiseService.getTransfer(paramResult.data.id);
    res.json({ transfer });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter transferência Wise');
    res.status(500).json({ error: 'Falha ao obter transferência' });
  }
});

// Financiar transferência (sandbox)
app.post('/api/integrations/wise/transfers/:id/fund', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de parâmetro de rota
  const paramResult = numericIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
  }

  try {
    const result = await wiseService.fundTransfer(paramResult.data.id);
    res.json({ result });
  } catch (error) {
    logger.error({ error }, 'Falha ao financiar transferência Wise');
    res.status(500).json({ error: 'Falha ao financiar transferência' });
  }
});

// Cancelar transferência
app.post('/api/integrations/wise/transfers/:id/cancel', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de parâmetro de rota
  const paramResult = numericIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
  }

  try {
    const transfer = await wiseService.cancelTransfer(paramResult.data.id);
    res.json({ transfer });
  } catch (error) {
    logger.error({ error }, 'Falha ao cancelar transferência Wise');
    res.status(500).json({ error: 'Falha ao cancelar transferência' });
  }
});

// Listar batch groups (pagamentos em lote)
app.get('/api/integrations/wise/batch-groups', requirePermission('integrations:wise:read'), async (_req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  try {
    const batchGroups = await wiseService.listBatchGroups();
    res.json({ batchGroups });
  } catch (error) {
    logger.error({ error }, 'Falha ao listar batch groups Wise');
    res.status(500).json({ error: 'Falha ao listar batch groups' });
  }
});

// Criar batch group
app.post('/api/integrations/wise/batch-groups', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const { name, sourceCurrency } = req.body;

  try {
    const batchGroup = await wiseService.createBatchGroup({ name, sourceCurrency });
    res.json({ batchGroup });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar batch group Wise');
    res.status(500).json({ error: 'Falha ao criar batch group' });
  }
});

// Obter batch group por ID
app.get('/api/integrations/wise/batch-groups/:id', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  try {
    const batchGroup = await wiseService.getBatchGroup(req.params.id);
    res.json({ batchGroup });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter batch group Wise');
    res.status(500).json({ error: 'Falha ao obter batch group' });
  }
});

// Completar batch group
app.post('/api/integrations/wise/batch-groups/:id/complete', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const { version } = req.body;

  try {
    const batchGroup = await wiseService.completeBatchGroup(req.params.id, version);
    res.json({ batchGroup });
  } catch (error) {
    logger.error({ error }, 'Falha ao completar batch group Wise');
    res.status(500).json({ error: 'Falha ao completar batch group' });
  }
});

// Webhook Wise - Receber notificações de transferências
// SEGURANÇA: Validar assinatura ANTES de responder (OWASP API4)
app.post('/api/integrations/wise/webhook', async (req: Request, res: Response) => {
  const contentTypeHeader = req.headers['content-type'];
  const contentType = Array.isArray(contentTypeHeader)
    ? contentTypeHeader[0]?.toLowerCase()
    : contentTypeHeader?.toLowerCase();
  if (!contentType || !contentType.startsWith('application/json')) {
    logger.warn({ contentType }, 'Webhook Wise: content-type inválido');
    return res.status(400).json({ error: 'Invalid content-type' });
  }

  if (!Buffer.isBuffer(req.body)) {
    logger.error('Webhook Wise: body não é Buffer (configure express.raw() antes da rota)');
    return res.status(500).json({ error: 'Invalid body parser for webhook' });
  }

  const signature = req.headers['x-signature-sha256'] as string;
  const isTestNotification = req.headers['x-test-notification'] === 'true';
  const deliveryId = req.headers['x-delivery-id'] as string;
  const payload = req.body.toString('utf8');

  // Verificar se é notificação de teste
  if (isTestNotification) {
    logger.info({ deliveryId }, 'Webhook Wise: Notificação de teste recebida');
    res.status(200).json({ received: true });
    return;
  }

  // CRÍTICO: Validar assinatura ANTES de responder (não depois!)
  const webhookSecret = WISE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error({ deliveryId }, 'Webhook Wise: WISE_WEBHOOK_SECRET não configurado');
    res.status(500).json({ error: 'Webhook secret not configured' });
    return;
  }

  const validation = validateWiseWebhook(signature, payload, webhookSecret);
  if (!validation.valid) {
    logger.warn({ 
      deliveryId, 
      reason: validation.reason,
      signaturePresent: !!signature,
    }, 'Webhook Wise: Assinatura inválida - rejeitando');
    res.status(403).json({ error: 'Invalid signature' });
    return;
  }

  // Parse event early to get event_type for idempotency check
  let event: {
    event_type: string;
    data: {
      resource: {
        id: number;
        type: string;
        profile_id: number;
        state?: string;
        source_amount?: number;
        source_currency?: string;
        target_amount?: number;
        target_currency?: string;
        reference?: string;
      };
      current_state?: string;
      previous_state?: string;
      occurred_at: string;
    };
  };

  try {
    event = JSON.parse(payload);
  } catch (parseError) {
    logger.error({ error: parseError, deliveryId }, 'Webhook Wise: Falha ao parsear payload');
    res.status(400).json({ error: 'Invalid JSON payload' });
    return;
  }

  // IDEMPOTÊNCIA: Verificar se evento já foi processado usando deliveryId
  const db = getDatabase();
  const eventId = deliveryId || `wise-${event.data.resource.id}-${event.event_type}-${event.data.occurred_at}`;
  
  const { isDuplicate } = await checkWebhookIdempotency(
    db,
    'wise',
    eventId,
    event.event_type,
    event as unknown as Record<string, unknown>
  );

  if (isDuplicate) {
    res.status(200).json({ received: true, duplicate: true });
    return;
  }

  // Assinatura válida e não duplicado - responder 200 e processar
  res.status(200).json({ received: true });

  // Processar webhook de forma assíncrona (após validação e resposta)
  let processingResult: Record<string, unknown> = {};
  let processingError: string | undefined;

  try {
    logger.info({ 
      eventType: event.event_type, 
      resourceId: event.data.resource.id,
      deliveryId,
    }, 'Webhook Wise recebido e validado');

    // Processar eventos de transferência
    if (event.event_type === 'transfers#state-change') {
      const transfer = event.data.resource;
      const newState = event.data.current_state;

      // Sincronizar com ERPNext quando transferência for concluída
      if (newState === 'outgoing_payment_sent' || newState === 'funds_converted') {
        await syncToERPNext('payment', {
          payment_type: 'Pay',
          party_type: 'Supplier',
          party: transfer.reference || `Wise-${transfer.id}`,
          paid_amount: transfer.source_amount,
          paid_to_account_currency: transfer.source_currency,
          received_amount: transfer.target_amount,
          reference_no: `WISE-${transfer.id}`,
          reference_date: event.data.occurred_at.split('T')[0],
          mode_of_payment: 'Wise Transfer',
          custom_wise_transfer_id: transfer.id.toString(),
          custom_wise_state: newState,
        });

        logger.info({ transferId: transfer.id, state: newState }, 'Transferência Wise sincronizada com ERPNext');
        processingResult = { transferId: transfer.id, state: newState, action: 'synced_to_erpnext' };
      }
    }

    // Processar eventos de depósito (credit balance)
    if (event.event_type === 'balances#credit') {
      const balance = event.data.resource;
      
      // Registrar recebimento no ERPNext
      await syncToERPNext('payment', {
        payment_type: 'Receive',
        party_type: 'Customer',
        party: `Wise-Balance-${balance.id}`,
        paid_amount: balance.source_amount,
        paid_from_account_currency: balance.source_currency,
        reference_no: `WISE-CREDIT-${balance.id}`,
        reference_date: event.data.occurred_at.split('T')[0],
        mode_of_payment: 'Wise Deposit',
        custom_wise_balance_id: balance.id.toString(),
      });

      logger.info({ balanceId: balance.id }, 'Depósito Wise sincronizado com ERPNext');
      processingResult = { balanceId: balance.id, action: 'credit_synced' };
    }

  } catch (error) {
    processingError = error instanceof Error ? error.message : String(error);
    logger.error({ error, deliveryId }, 'Falha ao processar webhook Wise');
  }

  // Marcar webhook como processado (ou com erro)
  await markWebhookProcessed(db, 'wise', eventId, processingResult, processingError);
});

// Obter requisitos de conta por moeda
app.get('/api/integrations/wise/recipient-requirements', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação Zod obrigatória de query params
  const queryResult = wiseRecipientRequirementsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    logger.warn({ errors: queryResult.error.flatten() }, 'Input inválido em /api/integrations/wise/recipient-requirements');
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }

  const { sourceCurrency, targetCurrency, sourceAmount } = queryResult.data;

  try {
    const requirements = await wiseService.getRecipientRequirements(
      sourceCurrency,
      targetCurrency,
      sourceAmount
    );
    res.json({ requirements });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter requisitos de destinatário Wise');
    res.status(500).json({ error: 'Falha ao obter requisitos' });
  }
});

// Status do Wise (não requer configuração para retornar status)
app.get('/api/integrations/wise/status', (_req: Request, res: Response) => {
  const profileId = getProfileIdSafe();
  res.json({
    configured: isWiseConfigured(),
    sandbox: getSandboxStatus(),
    profileId: profileId ? '***' + profileId.slice(-4) : null,
  });
});

// ============================================================
// TWILIO/WHATSAPP API - Mensagens e Webhooks
// Documentação: https://www.twilio.com/docs/messaging/webhooks
// Integração com Conversation Orchestrator para Handover/Takeover
// ============================================================

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;
// REGRA 6: Sem fallbacks localhost em produção - variável DEVE estar definida
const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL;
if (!CHAT_SERVICE_URL && process.env.NODE_ENV === 'production') {
  throw new Error('CHAT_SERVICE_URL é obrigatório em produção');
}
// Fallback apenas para desenvolvimento
const CHAT_SERVICE_URL_FINAL = CHAT_SERVICE_URL || 'http://localhost:3002';

// URL do Training Service para coleta de dados de treinamento (GAP CRÍTICO #2 - WhatsApp)
// REGRA 6: Sem fallbacks para localhost em produção - variável DEVE estar definida
// Alice MULTIMODAL: coleta dados de WhatsApp (texto, imagens, áudio, vídeo) para aprendizado
const TRAINING_SERVICE_URL = process.env.TRAINING_SERVICE_URL;
if (!TRAINING_SERVICE_URL && process.env.NODE_ENV === 'production') {
  throw new Error('TRAINING_SERVICE_URL é obrigatório em produção');
}
// Fallback apenas para desenvolvimento
const TRAINING_SERVICE_URL_FINAL = TRAINING_SERVICE_URL || 'http://localhost:3004';

/**
 * Valida assinatura do webhook Twilio
 * Segue especificação oficial: https://www.twilio.com/docs/usage/security
 * 
 * Algoritmo Twilio:
 * 1. Pegar URL completa do webhook
 * 2. Ordenar parâmetros POST alfabeticamente por chave
 * 3. Concatenar: URL + key1 + value1 + key2 + value2...
 * 4. HMAC-SHA1 com auth token
 * 5. Comparar base64 com X-Twilio-Signature
 */
function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>
): { valid: boolean; reason?: string } {
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (!TWILIO_AUTH_TOKEN) {
    if (isProduction) {
      logger.error('TWILIO_AUTH_TOKEN obrigatório em produção - webhook rejeitado');
      return { valid: false, reason: 'AUTH_TOKEN_MISSING' };
    }
    logger.warn('TWILIO_AUTH_TOKEN não configurado - validação ignorada em desenvolvimento');
    return { valid: true, reason: 'DEV_MODE_SKIP' };
  }

  if (!signature) {
    logger.warn('X-Twilio-Signature header ausente');
    return { valid: false, reason: 'SIGNATURE_MISSING' };
  }

  try {
    // Ordenar parâmetros alfabeticamente e concatenar
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + (params[key] || ''), '');
    
    const dataToSign = url + sortedParams;
    
    const expectedSignature = crypto
      .createHmac('sha1', TWILIO_AUTH_TOKEN)
      .update(new Uint8Array(Buffer.from(dataToSign, 'utf-8')))
      .digest('base64');

    // Usar timingSafeEqual para prevenir timing attacks
    const signatureBuffer = new Uint8Array(Buffer.from(signature));
    const expectedBuffer = new Uint8Array(Buffer.from(expectedSignature));
    
    if (signatureBuffer.length !== expectedBuffer.length) {
      return { valid: false, reason: 'SIGNATURE_LENGTH_MISMATCH' };
    }

    const isValid = crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
    return { valid: isValid, reason: isValid ? 'VALID' : 'SIGNATURE_MISMATCH' };
  } catch (error) {
    logger.error({ error }, 'Erro ao validar assinatura Twilio');
    return { valid: false, reason: 'VALIDATION_ERROR' };
  }
}

/**
 * Envia mensagem WhatsApp via Twilio
 */
async function sendWhatsAppMessage(to: string, body: string, mediaUrl?: string): Promise<{
  success: boolean;
  messageSid?: string;
  error?: string;
}> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_NUMBER) {
    logger.error('Twilio não configurado para envio de mensagens');
    return { success: false, error: 'Twilio não configurado' };
  }

  // RESILIÊNCIA: AbortController com timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

  try {
    const formData = new URLSearchParams();
    formData.append('From', `whatsapp:${TWILIO_WHATSAPP_NUMBER}`);
    formData.append('To', to.startsWith('whatsapp:') ? to : `whatsapp:${to}`);
    formData.append('Body', body);
    if (mediaUrl) {
      formData.append('MediaUrl', mediaUrl);
    }

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const errorData = await response.json() as { message?: string };
      throw new Error(errorData.message || `Twilio API error: ${response.status}`);
    }

    const data = await response.json() as { sid: string };
    logger.info({ messageSid: data.sid, to }, 'Mensagem WhatsApp enviada com sucesso');
    return { success: true, messageSid: data.sid };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error, to }, 'Falha ao enviar mensagem WhatsApp');
    return { success: false, error: errorMessage };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Resultado do processamento de mensagem via Chat Service
 * Inclui suporte para escalação automática (handover)
 */
interface ChatMessageResult {
  response: string | null;
  escalated: boolean;
  humanMode: boolean;
  trigger?: string;
  error?: string;
}

/**
 * Processa mensagem via Chat Service (LLM + RAG)
 * Integrado com sistema de Handover/Takeover para escalação automática
 * 
 * O chat-service agora verifica shouldEscalate() e pode retornar:
 * - escalated: true → Conversa foi escalada para agente humano
 * - humanMode: true → Conversa já está em modo humano
 * - response: string → Resposta normal do LLM
 */
async function processMessageWithLLM(
  conversationId: string,
  message: string,
  tenantId?: string
): Promise<ChatMessageResult> {
  // RESILIÊNCIA: AbortController com timeout para chamada ao chat-service
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s para LLM processing

  try {
    const response = await fetch(`${CHAT_SERVICE_URL_FINAL}/api/chat/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(tenantId && { 'X-Tenant-Id': tenantId }),
      },
      body: JSON.stringify({
        conversationId,
        content: message,
        role: 'user',
        channel: 'whatsapp',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Chat service error: ${response.status}`);
    }

    const data = await response.json() as {
      response?: string;
      escalated?: boolean;
      humanMode?: boolean;
      trigger?: string;
    };
    
    // Verificar se houve escalação automática
    if (data.escalated) {
      logger.info({
        conversationId,
        trigger: data.trigger,
        channel: 'whatsapp',
      }, 'Escalação automática detectada via WhatsApp');
      
      return {
        response: data.response || 'Um de nossos atendentes irá auxiliá-lo em breve. Por favor, aguarde.',
        escalated: true,
        humanMode: false,
        trigger: data.trigger,
      };
    }
    
    // Verificar se conversa está em modo humano
    if (data.humanMode) {
      logger.info({
        conversationId,
        channel: 'whatsapp',
      }, 'Conversa em modo humano - mensagem encaminhada para agente');
      
      return {
        response: null,
        escalated: false,
        humanMode: true,
      };
    }
    
    // Resposta normal do LLM
    return {
      response: data.response || '',
      escalated: false,
      humanMode: false,
    };
  } catch (error) {
    logger.error({ error, conversationId }, 'Falha ao processar mensagem com LLM');
    return {
      response: 'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.',
      escalated: false,
      humanMode: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Webhook principal para mensagens WhatsApp recebidas
 * Rota: POST /api/integrations/twilio/webhook/whatsapp
 */
app.post('/api/integrations/twilio/webhook/whatsapp', async (req: Request, res: Response) => {
  const twilioSignature = req.headers['x-twilio-signature'] as string;
  const webhookUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  const contentTypeHeader = req.headers['content-type'];
  const contentType = Array.isArray(contentTypeHeader)
    ? contentTypeHeader[0]?.toLowerCase()
    : contentTypeHeader?.toLowerCase();
  if (!contentType || !contentType.startsWith('application/x-www-form-urlencoded')) {
    logger.warn({ contentType }, 'Webhook Twilio: content-type inválido');
    return res.status(400).send('Invalid content-type');
  }

  if (!TWILIO_AUTH_TOKEN) {
    logger.error('Webhook Twilio: TWILIO_AUTH_TOKEN não configurado');
    return res.status(500).send('Webhook secret not configured');
  }

  // SEGURANÇA: Validar que body é objeto (urlencoded produz objeto, não Buffer)
  // NOTA: express.urlencoded() sempre produz objeto Record<string, string>, nunca Buffer
  // DIFERENÇA COM STRIPE: Stripe usa express.raw() (Buffer), Twilio usa express.urlencoded() (objeto)
  // Se body for Buffer, significa que middleware incorreto foi aplicado (deveria ser urlencoded)
  if (Buffer.isBuffer(req.body)) {
    logger.error('Webhook Twilio: body é Buffer mas deveria ser objeto (middleware incorreto - use express.urlencoded(), não express.raw())');
    return res.status(500).send('Invalid middleware configuration');
  }
  // Validar que é objeto válido (não null, não primitivo)
  if (typeof req.body !== 'object' || req.body === null) {
    logger.error('Webhook Twilio: body inválido (deve ser objeto parseado por urlencoded)');
    return res.status(500).send('Invalid body format');
  }

  // CRÍTICO: Validar assinatura ANTES de responder
  const validation = validateTwilioSignature(
    twilioSignature,
    webhookUrl,
    req.body as Record<string, string>
  );

  if (!validation.valid) {
    logger.warn({ webhookUrl, reason: validation.reason }, 'Assinatura Twilio inválida - webhook rejeitado');
    res.status(403).send('Forbidden');
    return;
  }

  // Responder ao Twilio após validação bem-sucedida
  res.set('Content-Type', 'text/xml');
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

  // Processar webhook de forma assíncrona (após resposta enviada)
  try {
    // OWASP API3 - Validação Zod (não rejeita por falha pois já respondemos 200)
    const parseResult = twilioWebhookSchema.safeParse(req.body);
    if (!parseResult.success) {
      logger.warn({ errors: parseResult.error.flatten() }, 'Payload Twilio inválido');
      return;
    }
    const {
      MessageSid,
      From,
      To,
      Body,
      NumMedia,
      MediaUrl0,
      MediaContentType0,
    } = parseResult.data;

    logger.info({
      messageSid: MessageSid,
      from: From,
      hasMedia: parseInt(NumMedia || '0') > 0,
    }, 'Webhook WhatsApp recebido');

    const db = getDatabase();

    // Normalizar número de telefone (remover 'whatsapp:')
    const phoneNumber = From.replace('whatsapp:', '');

    // Buscar ou criar usuário pelo telefone
    let user = await db.query.users.findFirst({
      where: eq(schema.users.telefone, phoneNumber),
    });

    if (!user) {
      // Criar usuário temporário para WhatsApp
      const [newUser] = await db.insert(schema.users).values({
        email: `whatsapp_${phoneNumber.replace(/\+/g, '')}@temp.alice.app`,
        telefone: phoneNumber,
        firstName: 'WhatsApp',
        lastName: `User ${phoneNumber.slice(-4)}`,
        authProvider: 'whatsapp',
        role: 'guest',
      }).returning();
      user = newUser;
      logger.info({ userId: user.id, phone: phoneNumber }, 'Novo usuário WhatsApp criado');
    }

    // Buscar ou criar conversa ativa para este usuário via WhatsApp
    let conversation = await db.query.conversations.findFirst({
      where: (c, { and, eq: e }) => and(
        e(c.userId, user.id),
        e(c.status, 'active'),
        e(c.metadata, sql`metadata->>'channel' = 'whatsapp'`)
      ),
      orderBy: [desc(schema.conversations.criadoEm)],
    });

    if (!conversation) {
      // Criar nova conversa para WhatsApp
      const [newConversation] = await db.insert(schema.conversations).values({
        userId: user.id,
        titulo: `WhatsApp - ${phoneNumber}`,
        status: 'active',
        metadata: {
          channel: 'whatsapp',
          phoneNumber,
          twilioFrom: From,
          twilioTo: To,
        },
      }).returning();
      conversation = newConversation;
      logger.info({ conversationId: conversation.id }, 'Nova conversa WhatsApp criada');
    }

    // Salvar mensagem do usuário
    await db.insert(schema.messages).values({
      conversationId: conversation.id,
      userId: user.id,
      isFromUser: true,
      conteudo: Body,
      tipo: parseInt(NumMedia || '0') > 0 ? 'mixed' : 'text',
      metadata: {
        twilioMessageSid: MessageSid,
        mediaUrl: MediaUrl0,
        mediaContentType: MediaContentType0,
        channel: 'whatsapp',
      },
    });

    // Verificar estado de handover/takeover
    const conversationState = await db.query.conversationStates.findFirst({
      where: eq(schema.conversationStates.conversationId, conversation.id),
    });

    // Se a conversa está em modo humano, não responder automaticamente
    if (conversationState?.controlMode === 'human') {
      logger.info({
        conversationId: conversation.id,
        controlMode: 'human',
      }, 'Conversa em modo humano - mensagem salva sem resposta automática');

      // Notificar agente humano via chat-service WebSocket
      // RESILIÊNCIA: AbortController com timeout curto para notificação
      const notifyController = new AbortController();
      const notifyTimeoutId = setTimeout(() => notifyController.abort(), 5000);
      try {
        await fetch(`${CHAT_SERVICE_URL_FINAL}/api/chat/notify-agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: conversation.id,
            type: 'new_message',
            message: Body,
            from: phoneNumber,
          }),
          signal: notifyController.signal,
        });
      } catch (notifyError) {
        logger.warn({ error: notifyError }, 'Falha ao notificar agente humano');
      } finally {
        clearTimeout(notifyTimeoutId);
      }
      return;
    }

    // Processar mensagem com LLM via Chat Service
    // Inclui verificação automática de handover/escalação
    const chatResult = await processMessageWithLLM(
      conversation.id,
      Body,
      user.tenantId ?? undefined
    );

    // Se conversa está em modo humano, não enviar resposta automática
    if (chatResult.humanMode) {
      logger.info({
        conversationId: conversation.id,
        channel: 'whatsapp',
      }, 'Conversa em modo humano - aguardando resposta do agente');
      return;
    }

    // Se houve escalação automática, enviar mensagem de notificação
    if (chatResult.escalated) {
      logger.info({
        conversationId: conversation.id,
        trigger: chatResult.trigger,
        channel: 'whatsapp',
      }, 'Escalação automática processada via WhatsApp');
      
      // Salvar mensagem de escalação
      await db.insert(schema.messages).values({
        conversationId: conversation.id,
        isFromUser: false,
        conteudo: chatResult.response || 'Um de nossos atendentes irá auxiliá-lo em breve.',
        tipo: 'text',
        metadata: {
          channel: 'whatsapp',
          escalated: true,
          escalationTrigger: chatResult.trigger,
        },
      });
      
      // Enviar notificação de escalação via WhatsApp
      const escalationMessage = chatResult.response || 'Um de nossos atendentes irá auxiliá-lo em breve. Por favor, aguarde.';
      const sendResult = await sendWhatsAppMessage(From, escalationMessage);
      
      if (!sendResult.success) {
        logger.error({
          conversationId: conversation.id,
          error: sendResult.error,
        }, 'Falha ao enviar notificação de escalação WhatsApp');
      }
      
      return;
    }

    // Resposta normal do LLM
    if (chatResult.response) {
      // Salvar resposta do bot
      await db.insert(schema.messages).values({
        conversationId: conversation.id,
        isFromUser: false,
        conteudo: chatResult.response,
        tipo: 'text',
        metadata: {
          channel: 'whatsapp',
          generatedBy: 'llm',
        },
      });

      // Enviar resposta via WhatsApp
      const sendResult = await sendWhatsAppMessage(From, chatResult.response);

      if (!sendResult.success) {
        logger.error({
          conversationId: conversation.id,
          error: sendResult.error,
        }, 'Falha ao enviar resposta WhatsApp');
      }

      // GAP CRÍTICO #2: Coletar dados de treinamento para WhatsApp
      // Alice MULTIMODAL: coleta dados de texto, imagens, áudio, vídeo do WhatsApp para aprendizado
      // Rating inferido: se não houve escalação = positivo (5), se houve = negativo (1)
      // REGRA 6: Enterprise-grade - integração real com training-service (sem mocks)
      try {
        const rating = chatResult.escalated ? 1 : 5; // Inferir rating baseado em escalação
        
        // VALIDAÇÃO: Só coletar dados se houver resposta válida do LLM
        // Previne coleta de dados malformados (rating alto com resposta vazia)
        const hasValidResponse = chatResult.response && chatResult.response.trim().length > 0;
        
        // Coletar dados apenas se:
        // 1. Rating >= 4 (positivo) E houver resposta válida, OU
        // 2. Houve escalação (para aprendizado negativo) E houver resposta válida
        if ((rating >= 4 || chatResult.escalated) && hasValidResponse) {
          // conversations não possui objeto agent; usar namespaceId já persistido na conversa
          const namespaceId = conversation.namespaceId || undefined;
          const tenantId = user.tenantId;
          
          if (tenantId) {
            // Gerar headers de autenticação interna para training-service
            const internalHeaders = generateInternalAuthHeaders({
              userId: user.id,
              tenantId: tenantId,
              role: 'super_admin', // Service-to-service usa role privilegiado
            });
            
            // RESILIÊNCIA: AbortController com timeout para prevenir hang
            const trainingController = new AbortController();
            const trainingTimeoutId = setTimeout(() => trainingController.abort(), 10000); // 10s timeout
            
            try {
              // Chamar training-service para coletar dados
              const trainingResponse = await fetch(`${TRAINING_SERVICE_URL_FINAL}/api/training/data`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Internal-Signature': internalHeaders['x-internal-signature'],
                  'X-Internal-Timestamp': internalHeaders['x-internal-timestamp'],
                  'X-Internal-User-Id': user.id,
                  'X-Internal-Tenant-Id': tenantId,
                  'X-Internal-Role': 'super_admin',
                },
                body: JSON.stringify({
                  tenantId: tenantId,
                  namespaceId: namespaceId || undefined,
                  conversationId: conversation.id,
                  source: 'whatsapp', // Fonte: WhatsApp
                  messages: [
                    { role: 'user', content: Body },
                    { role: 'assistant', content: chatResult.response },
                  ],
                  rating: rating,
                }),
                signal: trainingController.signal,
              });
              
              if (!trainingResponse.ok) {
                const errorText = await trainingResponse.text();
                logger.error({ 
                  conversationId: conversation.id, 
                  status: trainingResponse.status,
                  error: errorText,
                }, 'Falha ao coletar dados de treinamento do WhatsApp');
              } else {
                const trainingData = await trainingResponse.json() as { trainingData?: { id: string }; isDuplicate?: boolean };
                logger.info({ 
                  conversationId: conversation.id, 
                  trainingDataId: trainingData.trainingData?.id,
                  isDuplicate: trainingData.isDuplicate,
                  rating: rating,
                  source: 'whatsapp',
                }, 'Dados de treinamento do WhatsApp coletados com sucesso');
              }
            } finally {
              clearTimeout(trainingTimeoutId);
            }
          }
        }
      } catch (trainingError) {
        // Não falhar o webhook se coleta de treinamento falhar (não crítico)
        logger.error({ error: trainingError, conversationId: conversation.id }, 'Erro ao coletar dados de treinamento do WhatsApp (não crítico)');
      }
    }

  } catch (error) {
    logger.error({ error }, 'Erro ao processar webhook WhatsApp');
  }
});

/**
 * Webhook para status de mensagens Twilio
 * Rota: POST /api/integrations/twilio/webhook/status
 */
app.post('/api/integrations/twilio/webhook/status', async (req: Request, res: Response) => {
  const twilioSignature = req.headers['x-twilio-signature'] as string;
  const webhookUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  const contentTypeHeader = req.headers['content-type'];
  const contentType = Array.isArray(contentTypeHeader)
    ? contentTypeHeader[0]?.toLowerCase()
    : contentTypeHeader?.toLowerCase();
  if (!contentType || !contentType.startsWith('application/x-www-form-urlencoded')) {
    logger.warn({ contentType }, 'Webhook Twilio status: content-type inválido');
    return res.status(400).send('Invalid content-type');
  }

  if (!TWILIO_AUTH_TOKEN) {
    logger.error('Webhook Twilio: TWILIO_AUTH_TOKEN não configurado');
    return res.status(500).send('Webhook secret not configured');
  }

  // SEGURANÇA: Validar que body é objeto (urlencoded produz objeto, não Buffer)
  // NOTA: express.urlencoded() sempre produz objeto Record<string, string>, nunca Buffer
  // Se alguém adicionar verificação Buffer.isBuffer() aqui, sempre falhará incorretamente
  if (Buffer.isBuffer(req.body) || typeof req.body !== 'object' || req.body === null) {
    logger.error('Webhook Twilio status: body inválido (deve ser objeto parseado por urlencoded, não Buffer)');
    return res.status(500).send('Invalid body format');
  }

  // CRÍTICO: Validar assinatura ANTES de responder
  const validation = validateTwilioSignature(
    twilioSignature,
    webhookUrl,
    req.body as Record<string, string>
  );

  if (!validation.valid) {
    logger.warn({ webhookUrl, reason: validation.reason }, 'Assinatura Twilio inválida - status webhook rejeitado');
    res.status(403).send('Forbidden');
    return;
  }

  // Responder ao Twilio após validação bem-sucedida
  res.set('Content-Type', 'text/xml');
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

  try {
    // OWASP API3 - Validação Zod (não rejeita por falha pois já respondemos 200)
    const parseResult = twilioStatusSchema.safeParse(req.body);
    if (!parseResult.success) {
      logger.warn({ errors: parseResult.error.flatten() }, 'Payload status Twilio inválido');
      return;
    }
    const {
      MessageSid,
      MessageStatus,
      ErrorCode,
      ErrorMessage,
      To,
    } = parseResult.data;

    logger.info({
      messageSid: MessageSid,
      status: MessageStatus,
      errorCode: ErrorCode,
      to: To,
    }, 'Status de mensagem Twilio recebido');

    // Atualizar metadata da mensagem com status
    if (MessageStatus === 'failed' || MessageStatus === 'undelivered') {
      logger.error({
        messageSid: MessageSid,
        status: MessageStatus,
        errorCode: ErrorCode,
        errorMessage: ErrorMessage,
      }, 'Mensagem WhatsApp falhou na entrega');

      // Registrar falha em audit log se necessário
      const db = getDatabase();
      await db.insert(schema.auditLogs).values({
        acao: 'whatsapp_delivery_failed',
        recurso: 'message',
        detalhes: {
          messageSid: MessageSid,
          status: MessageStatus,
          errorCode: ErrorCode,
          errorMessage: ErrorMessage,
          to: To,
        },
      });
    }
  } catch (error) {
    logger.error({ error }, 'Erro ao processar webhook de status Twilio');
  }
});

/**
 * Enviar mensagem WhatsApp manualmente (para handover humano)
 * Rota: POST /api/integrations/twilio/send
 */
app.post('/api/integrations/twilio/send', requirePermission('integrations:twilio:write'), async (req: Request, res: Response) => {
  // OWASP API3 - Validação Zod obrigatória
  const parseResult = twilioSendSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Input inválido' });
  }
  const { to, message, conversationId, mediaUrl } = parseResult.data;

  try {
    const result = await sendWhatsAppMessage(to, message, mediaUrl);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    // Se conversationId fornecido, salvar mensagem no histórico
    if (conversationId) {
      const db = getDatabase();
      const authContext = extractAuthContext(req);

      await db.insert(schema.messages).values({
        conversationId,
        userId: authContext?.userId,
        isFromUser: false,
        conteudo: message,
        tipo: mediaUrl ? 'mixed' : 'text',
        metadata: {
          channel: 'whatsapp',
          twilioMessageSid: result.messageSid,
          sentByAgent: true,
          mediaUrl,
        },
      });
    }

    res.json({ success: true, messageSid: result.messageSid });
  } catch (error) {
    logger.error({ error, to }, 'Falha ao enviar mensagem WhatsApp');
    res.status(500).json({ error: 'Falha ao enviar mensagem' });
  }
});

/**
 * Status da integração Twilio
 * Rota: GET /api/integrations/twilio/status
 */
app.get('/api/integrations/twilio/status', (_req: Request, res: Response) => {
  const configured = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_NUMBER);
  res.json({
    configured,
    accountSid: TWILIO_ACCOUNT_SID ? '***' + TWILIO_ACCOUNT_SID.slice(-4) : null,
    whatsappNumber: TWILIO_WHATSAPP_NUMBER ? TWILIO_WHATSAPP_NUMBER.slice(-4) : null,
  });
});

// ============================================================================
// MIDDLEWARE: Not Found + Error Handler (Express.js 2025)
// ============================================================================

// Not Found handler (antes do error handler)
app.use(createNotFoundHandler({ serviceName: 'integrations-service' }));

// Error handler global (OWASP 2023 + Express.js 2025)
app.use(createErrorHandler({ 
  serviceName: 'integrations-service', 
  logger,
  includeStackInDev: true,
}));

const PORT = config.PORT || 3005;

try {
  const db = getDatabase();
  initWiseSyncService(db);
  logger.info('WiseSyncService inicializado com sucesso');
} catch (error) {
  logger.warn({ error }, 'WiseSyncService não inicializado (database não disponível)');
}

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT }, 'Integrations service started');
});

// SEGURANÇA: Timeouts para prevenir conexões pendentes (Node.js 20 LTS Best Practices)
server.timeout = 30000; // 30s timeout para requisições
server.keepAliveTimeout = 65000; // 65s (maior que ALB timeout padrão de 60s)
server.headersTimeout = 66000; // Ligeiramente maior que keepAliveTimeout

// ============================================================================
// GRACEFUL SHUTDOWN (Enterprise-Grade - Regra 16 CLAUDE.md)
// ShutdownManager centralizado elimina duplicação de listeners (Regra 6)
// Ordem: HTTP server → Database pool (coordenado pelo ShutdownManager)
// ============================================================================

registerShutdownCallback(
  'integrations-http-server',
  async () => {
    logger.info('Encerrando HTTP server...');
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          logger.error({ error: err }, 'Erro ao fechar HTTP server');
          reject(err);
        } else {
          logger.info('HTTP server encerrado com sucesso');
          resolve();
        }
      });
    });
  },
  { priority: ShutdownPriority.HTTP_SERVER }
);

registerShutdownCallback(
  'integrations-database-pool',
  async () => {
    logger.info('Encerrando pool de conexões database...');
    await closeDatabasePool();
    logger.info('Pool de conexões encerrado com sucesso');
  },
  { priority: ShutdownPriority.DATABASE }
);
