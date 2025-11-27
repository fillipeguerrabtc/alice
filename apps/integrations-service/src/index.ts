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
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { wiseService } from './wiseService';

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
app.use(express.json());

app.get('/api/integrations/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    service: 'integrations-service', 
    timestamp: new Date().toISOString(),
    integrations: {
      stripe: !!stripe,
      erpnext: !!config.ERPNEXT_URL,
      wise: !!process.env.WISE_API_KEY,
    },
  });
});

app.get('/api/integrations', async (req: Request, res: Response) => {
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

app.post('/api/integrations', async (req: Request, res: Response) => {
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

app.post('/api/integrations/stripe/create-checkout', async (req: Request, res: Response) => {
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

app.post('/api/integrations/stripe/create-portal', async (req: Request, res: Response) => {
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
app.get('/api/integrations/stripe/products', async (_req: Request, res: Response) => {
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
app.post('/api/integrations/stripe/create-payment-intent', async (req: Request, res: Response) => {
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

app.post('/api/integrations/stripe/webhook', async (req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
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

app.get('/api/integrations/erpnext/test', async (_req: Request, res: Response) => {
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

app.get('/api/integrations/erpnext/customers', async (_req: Request, res: Response) => {
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

app.get('/api/integrations/erpnext/items', async (_req: Request, res: Response) => {
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

app.post('/api/integrations/resend/send', async (req: Request, res: Response) => {
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

const errorHandler = (err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
};

app.use(errorHandler);

const PORT = config.PORT || 3005;

app.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT }, 'Integrations service started');
});

process.on('SIGTERM', () => {
  logger.info('Shutting down integrations service');
  process.exit(0);
});
