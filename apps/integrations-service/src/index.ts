import express, { Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import CircuitBreaker from 'opossum';
import crypto from 'crypto';
import { createLogger } from '@alice/logger';
import { loadConfig, integrationsServiceConfigSchema } from '@alice/config';
import { getDatabase, schema } from '@alice/database';
import { eq, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { wiseService } from './wiseService.js';
import { isWiseConfigured, getSandboxStatus, getProfileIdSafe, getWiseCircuitBreakerStatus } from './wiseClient.js';
import { initWiseSyncService, syncWiseTransfer, getSyncStats as getWiseSyncStats } from './wiseSyncService.js';
import { 
  requirePermission, 
  requireAuth,
  extractAuthContext,
} from '@alice/shared-utils';

process.setMaxListeners(20);

const logger = createLogger('integrations-service');
const config = loadConfig(integrationsServiceConfigSchema);

const app = express();

let stripe: Stripe | null = null;
if (config.STRIPE_SECRET_KEY) {
  stripe = new Stripe(config.STRIPE_SECRET_KEY, {
    apiVersion: '2025-08-27.basil' as const,
  });
}

// Circuit Breaker para chamadas ao ERPNext
const circuitBreakerOptions = {
  timeout: 10000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
};

const erpNextBreaker = new CircuitBreaker(async (options: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}) => {
  const response = await fetch(options.url, {
    method: options.method,
    headers: options.headers,
    body: options.body,
  });
  if (!response.ok) {
    throw new Error(`ERPNext request failed: ${response.status}`);
  }
  return response.json();
}, circuitBreakerOptions);

erpNextBreaker.on('open', () => logger.warn('Circuit breaker ERPNext: ABERTO'));
erpNextBreaker.on('halfOpen', () => logger.info('Circuit breaker ERPNext: HALF-OPEN'));
erpNextBreaker.on('close', () => logger.info('Circuit breaker ERPNext: FECHADO'));

// Sincronizar cliente/pedido com ERPNext (com Circuit Breaker)
async function syncToERPNext(type: 'customer' | 'sales_order' | 'payment', data: Record<string, unknown>) {
  if (!config.ERPNEXT_URL || !config.ERPNEXT_API_KEY || !config.ERPNEXT_API_SECRET) {
    logger.warn('ERPNext não configurado, sincronização ignorada');
    return null;
  }

  const doctypes: Record<string, string> = {
    customer: 'Customer',
    sales_order: 'Sales Order',
    payment: 'Payment Entry',
  };

  try {
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

const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',') || [];

app.use(helmet());
app.use(cors({
  origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : false,
  credentials: CORS_ORIGINS.length > 0,
}));

// Rate limiting - 60 requisições por minuto por IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Muitas requisições. Tente novamente em 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/integrations/stripe/webhook',
});
app.use(limiter);

app.use('/api/integrations/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/integrations/wise/webhook', express.raw({ type: 'application/json' }));
app.use('/api/integrations/twilio/webhook', express.urlencoded({ extended: false }));
app.use(express.json());

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

app.get('/api/integrations', requirePermission('integrations:integrations:read'), async (req: Request, res: Response) => {
  const tenantId = req.query.tenantId as string;

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

// Validar STRIPE_WEBHOOK_SECRET obrigatório em produção (Regra 16 - Segurança Enterprise)
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (!STRIPE_WEBHOOK_SECRET && IS_PRODUCTION && stripe) {
  logger.error('CRITICAL: STRIPE_WEBHOOK_SECRET é OBRIGATÓRIO em produção com Stripe ativo. Abortando.');
  process.exit(1);
}

app.post('/api/integrations/stripe/webhook', async (req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const sig = req.headers['stripe-signature'] as string;

  if (!STRIPE_WEBHOOK_SECRET) {
    logger.error('Webhook recebido mas STRIPE_WEBHOOK_SECRET não configurado');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    const db = getDatabase();

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;

        if (userId && session.subscription) {
          await db.update(schema.users)
            .set({ stripeSubscriptionId: session.subscription as string })
            .where(eq(schema.users.id, userId));

          logger.info({ userId, subscriptionId: session.subscription }, 'Subscription created');
        }

        // Sincronizar com ERPNext como Sales Order
        if (session.customer && session.amount_total) {
          const customer = await stripe.customers.retrieve(session.customer as string);
          if (customer && !customer.deleted) {
            await syncToERPNext('sales_order', {
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
        }
        break;
      }

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        
        // Sincronizar pagamento com ERPNext
        if (paymentIntent.amount && paymentIntent.customer) {
          await syncToERPNext('payment', {
            payment_type: 'Receive',
            party_type: 'Customer',
            party: paymentIntent.customer as string,
            paid_amount: paymentIntent.amount / 100,
            received_amount: paymentIntent.amount / 100,
            reference_no: paymentIntent.id,
            reference_date: new Date().toISOString().split('T')[0],
            mode_of_payment: 'Stripe',
            custom_stripe_payment_intent_id: paymentIntent.id,
          });
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
        break;
      }
    }

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

  try {
    const response = await fetch(`${config.ERPNEXT_URL}/api/method/frappe.auth.get_logged_user`, {
      headers: {
        'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
      },
    });

    if (!response.ok) {
      throw new Error('ERPNext connection failed');
    }

    const data = await response.json() as { message: string };
    res.json({ status: 'connected', user: data.message });
  } catch (error) {
    logger.error({ error }, 'ERPNext test failed');
    res.status(500).json({ error: 'ERPNext connection failed' });
  }
});

app.get('/api/integrations/erpnext/customers', requirePermission('integrations:erpnext:read'), async (_req: Request, res: Response) => {
  if (!config.ERPNEXT_URL) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  try {
    const response = await fetch(
      `${config.ERPNEXT_URL}/api/resource/Customer?fields=["name","customer_name","customer_type","territory"]&limit_page_length=100`,
      {
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
        },
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
  }
});

app.get('/api/integrations/erpnext/items', requirePermission('integrations:erpnext:read'), async (_req: Request, res: Response) => {
  if (!config.ERPNEXT_URL) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  try {
    const response = await fetch(
      `${config.ERPNEXT_URL}/api/resource/Item?fields=["name","item_name","item_group","stock_uom","standard_rate"]&limit_page_length=100`,
      {
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
        },
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
  }
});

app.post('/api/integrations/resend/send', requirePermission('integrations:resend:write'), async (req: Request, res: Response) => {
  const { to, subject, html, from } = req.body;

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return res.status(503).json({ error: 'Resend not configured' });
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from || 'Alice <noreply@alice.app>',
        to,
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error);
    }

    const data = await response.json();
    logger.info({ to, subject }, 'Email sent');
    res.json({ success: true, id: (data as { id: string }).id });
  } catch (error) {
    logger.error({ error }, 'Failed to send email');
    res.status(500).json({ error: 'Failed to send email' });
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

  const { source, target } = req.query;
  if (!source || !target) {
    return res.status(400).json({ error: 'Parâmetros source e target são obrigatórios' });
  }

  try {
    const rate = await wiseService.getExchangeRates(source as string, target as string);
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

  const { currency } = req.query;

  try {
    const recipients = await wiseService.listRecipients(currency as string | undefined);
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

  try {
    const recipient = await wiseService.getRecipient(parseInt(req.params.id));
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

  try {
    await wiseService.deleteRecipient(parseInt(req.params.id));
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

  const limit = parseInt(req.query.limit as string) || 20;
  const offset = parseInt(req.query.offset as string) || 0;

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

  try {
    const transfer = await wiseService.getTransfer(parseInt(req.params.id));
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

  try {
    const result = await wiseService.fundTransfer(parseInt(req.params.id));
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

  try {
    const transfer = await wiseService.cancelTransfer(parseInt(req.params.id));
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
app.post('/api/integrations/wise/webhook', async (req: Request, res: Response) => {
  const signature = req.headers['x-signature-sha256'] as string;
  const isTestNotification = req.headers['x-test-notification'] === 'true';
  const deliveryId = req.headers['x-delivery-id'] as string;

  // Responder imediatamente para o Wise
  res.status(200).json({ received: true });

  // Processar webhook de forma assíncrona
  try {
    const payload = req.body.toString('utf8');
    
    // Verificar se é notificação de teste
    if (isTestNotification) {
      logger.info({ deliveryId }, 'Webhook Wise: Notificação de teste recebida');
      return;
    }

    // Validar assinatura (se webhook secret configurado)
    const webhookSecret = process.env.WISE_WEBHOOK_SECRET;
    if (webhookSecret && signature) {
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('hex');
      
      if (signature !== expectedSignature) {
        logger.warn({ deliveryId }, 'Webhook Wise: Assinatura inválida');
        return;
      }
    }

    const event = JSON.parse(payload) as {
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

    logger.info({ 
      eventType: event.event_type, 
      resourceId: event.data.resource.id,
      deliveryId,
    }, 'Webhook Wise recebido');

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
    }

  } catch (error) {
    logger.error({ error, deliveryId }, 'Falha ao processar webhook Wise');
  }
});

// Obter requisitos de conta por moeda
app.get('/api/integrations/wise/recipient-requirements', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const { sourceCurrency, targetCurrency, sourceAmount } = req.query;

  if (!sourceCurrency || !targetCurrency || !sourceAmount) {
    return res.status(400).json({ error: 'Parâmetros sourceCurrency, targetCurrency e sourceAmount são obrigatórios' });
  }

  try {
    const requirements = await wiseService.getRecipientRequirements(
      sourceCurrency as string,
      targetCurrency as string,
      parseFloat(sourceAmount as string)
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
const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL || 'http://localhost:3002';

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
  }
}

/**
 * Processa mensagem via Chat Service (LLM + RAG)
 */
async function processMessageWithLLM(
  conversationId: string,
  message: string,
  tenantId?: string
): Promise<string> {
  try {
    const response = await fetch(`${CHAT_SERVICE_URL}/api/chat/message`, {
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
    });

    if (!response.ok) {
      throw new Error(`Chat service error: ${response.status}`);
    }

    const data = await response.json() as { response: string };
    return data.response;
  } catch (error) {
    logger.error({ error, conversationId }, 'Falha ao processar mensagem com LLM');
    return 'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.';
  }
}

/**
 * Webhook principal para mensagens WhatsApp recebidas
 * Rota: POST /api/integrations/twilio/webhook/whatsapp
 */
app.post('/api/integrations/twilio/webhook/whatsapp', async (req: Request, res: Response) => {
  const twilioSignature = req.headers['x-twilio-signature'] as string;
  const webhookUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

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
    const {
      MessageSid,
      From,
      To,
      Body,
      NumMedia,
      MediaUrl0,
      MediaContentType0,
    } = req.body as {
      MessageSid: string;
      From: string;
      To: string;
      Body: string;
      NumMedia?: string;
      MediaUrl0?: string;
      MediaContentType0?: string;
    };

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
      try {
        await fetch(`${CHAT_SERVICE_URL}/api/chat/notify-agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: conversation.id,
            type: 'new_message',
            message: Body,
            from: phoneNumber,
          }),
        });
      } catch (notifyError) {
        logger.warn({ error: notifyError }, 'Falha ao notificar agente humano');
      }
      return;
    }

    // Processar mensagem com LLM via Chat Service
    const llmResponse = await processMessageWithLLM(
      conversation.id,
      Body,
      user.tenantId ?? undefined
    );

    // Salvar resposta do bot
    await db.insert(schema.messages).values({
      conversationId: conversation.id,
      isFromUser: false,
      conteudo: llmResponse,
      tipo: 'text',
      metadata: {
        channel: 'whatsapp',
        generatedBy: 'llm',
      },
    });

    // Enviar resposta via WhatsApp
    const sendResult = await sendWhatsAppMessage(From, llmResponse);

    if (!sendResult.success) {
      logger.error({
        conversationId: conversation.id,
        error: sendResult.error,
      }, 'Falha ao enviar resposta WhatsApp');
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
    const {
      MessageSid,
      MessageStatus,
      ErrorCode,
      ErrorMessage,
      To,
    } = req.body as {
      MessageSid: string;
      MessageStatus: string;
      ErrorCode?: string;
      ErrorMessage?: string;
      To: string;
    };

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
  const { to, message, conversationId, mediaUrl } = req.body as {
    to: string;
    message: string;
    conversationId?: string;
    mediaUrl?: string;
  };

  if (!to || !message) {
    return res.status(400).json({ error: 'Parâmetros to e message são obrigatórios' });
  }

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

const errorHandler = (err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
};

app.use(errorHandler);

const PORT = config.PORT || 3005;

try {
  const db = getDatabase();
  initWiseSyncService(db);
  logger.info('WiseSyncService inicializado com sucesso');
} catch (error) {
  logger.warn({ error }, 'WiseSyncService não inicializado (database não disponível)');
}

app.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT }, 'Integrations service started');
});

process.on('SIGTERM', () => {
  logger.info('Shutting down integrations service');
  process.exit(0);
});
