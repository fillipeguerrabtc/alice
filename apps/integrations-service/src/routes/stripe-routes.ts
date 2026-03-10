import type { Express, Request, Response } from 'express';
import { getDatabase, schema } from '@alice/database';
import { createLogger } from '@alice/logger';
import { requirePermission } from '@alice/shared-utils';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';

type WebhookSource = 'stripe' | 'wise' | 'twilio';

type CheckWebhookIdempotencyFn = (
  db: ReturnType<typeof getDatabase>,
  source: WebhookSource,
  eventId: string,
  eventType: string,
  payload: Record<string, unknown>,
) => Promise<{ isDuplicate: boolean; existingEvent?: unknown }>;

type MarkWebhookProcessedFn = (
  db: ReturnType<typeof getDatabase>,
  source: WebhookSource,
  eventId: string,
  result: Record<string, unknown>,
  error?: string,
) => Promise<void>;

interface RegisterStripeRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  stripe: Stripe | null;
  executeStripeCall<T>(operation: string, fn: () => Promise<T>): Promise<T>;
  stripeWebhookSecret?: string;
  checkWebhookIdempotency: CheckWebhookIdempotencyFn;
  markWebhookProcessed: MarkWebhookProcessedFn;
}

export function registerStripeRoutes(
  app: Express,
  deps: RegisterStripeRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const {
    stripe,
    executeStripeCall,
    stripeWebhookSecret,
    checkWebhookIdempotency,
    markWebhookProcessed,
  } = deps;

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
        const customer = await executeStripeCall('customer.create', () => stripe.customers.create({
          email: user?.email || undefined,
          name: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || undefined,
          metadata: { userId },
        }));
        customerId = customer.id;

        await db.update(schema.users)
          .set({ stripeCustomerId: customerId })
          .where(eq(schema.users.id, userId));
      }

      const session = await executeStripeCall('checkout.create', () => stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { userId },
      }));

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

      const stripeCustomerId = user?.stripeCustomerId ?? undefined;
      if (!stripeCustomerId) {
        return res.status(400).json({ error: 'User has no Stripe customer' });
      }

      const session = await executeStripeCall('billing_portal.create', () => stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: returnUrl,
      }));

      res.json({ url: session.url });
    } catch (error) {
      logger.error({ error }, 'Failed to create portal session');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/integrations/stripe/products', requirePermission('integrations:stripe:read'), async (_req: Request, res: Response) => {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe not configured' });
    }

    try {
      const products = await executeStripeCall('products.list', () => stripe.products.list({ active: true, limit: 100 }));
      const prices = await executeStripeCall('prices.list', () => stripe.prices.list({ active: true, limit: 100 }));

      const productsWithPrices = products.data.map((product) => ({
        ...product,
        prices: prices.data.filter((price) => price.product === product.id),
      }));

      res.json({ products: productsWithPrices });
    } catch (error) {
      logger.error({ error }, 'Failed to list products');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

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
          const customer = await executeStripeCall('customer.create', () => stripe.customers.create({
            email: user.email ?? undefined,
            name: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
            metadata: { userId },
          }));
          customerId = customer.id;

          await db.update(schema.users)
            .set({ stripeCustomerId: customerId })
            .where(eq(schema.users.id, userId));
        }
      }

      const paymentIntent = await executeStripeCall('payment_intent.create', () => stripe.paymentIntents.create({
        amount,
        currency,
        customer: customerId,
        description,
        automatic_payment_methods: { enabled: true },
        metadata: { userId: userId || '' },
      }));

      logger.info({ paymentIntentId: paymentIntent.id, amount, currency }, 'PaymentIntent created');
      res.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
    } catch (error) {
      logger.error({ error }, 'Failed to create PaymentIntent');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Stripe Webhook - express.raw() já aplicado via app.use() ANTES de express.json()
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

    if (!stripeWebhookSecret) {
      logger.error('Webhook recebido mas STRIPE_WEBHOOK_SECRET não configurado');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    if (!Buffer.isBuffer(req.body)) {
      logger.error('Stripe webhook rejeitado: body não é Buffer (express.raw() não aplicado corretamente)');
      return res.status(500).json({ error: 'Invalid body parser for webhook' });
    }

    try {
      const event = stripe.webhooks.constructEvent(req.body, sig, stripeWebhookSecret);
      const db = getDatabase();

      const { isDuplicate } = await checkWebhookIdempotency(
        db,
        'stripe',
        event.id,
        event.type,
        event.data.object as unknown as Record<string, unknown>,
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
            processingResult = {
              paymentIntentId: paymentIntent.id,
              amount: paymentIntent.amount,
            };
            break;
          }

          case 'customer.created': {
            const customer = event.data.object as Stripe.Customer;
            processingResult = { customerId: customer.id };
            break;
          }
        }
      } catch (processingErr) {
        processingError = processingErr instanceof Error ? processingErr.message : String(processingErr);
        logger.error({ error: processingErr, eventId: event.id }, 'Erro ao processar webhook Stripe');
      }

      await markWebhookProcessed(db, 'stripe', event.id, processingResult, processingError);

      res.json({ received: true });
    } catch (error) {
      logger.error({ error }, 'Webhook error');
      res.status(400).json({ error: 'Webhook error' });
    }
  });
}
