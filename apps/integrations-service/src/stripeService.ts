// Blueprint: stripe integration - Serviço Stripe
import { getUncachableStripeClient } from './stripeClient';
import { getDatabase, schema } from '@alice/database';
import { eq, sql } from 'drizzle-orm';

export class StripeService {
  // Criar cliente no Stripe
  async createCustomer(email: string, userId: string, name?: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.customers.create({
      email,
      name,
      metadata: { userId },
    });
  }

  // Criar sessão de checkout
  async createCheckoutSession(
    customerId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
    mode: 'subscription' | 'payment' = 'subscription'
  ) {
    const stripe = await getUncachableStripeClient();
    return await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode,
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
  }

  // Criar portal de gerenciamento de assinatura
  async createCustomerPortalSession(customerId: string, returnUrl: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  // Criar PaymentIntent para pagamento único
  async createPaymentIntent(amount: number, currency: string = 'eur', customerId?: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.paymentIntents.create({
      amount,
      currency,
      customer: customerId,
      automatic_payment_methods: { enabled: true },
    });
  }

  // Listar produtos do stripe schema
  async listProducts(active = true, limit = 20, offset = 0) {
    const db = getDatabase();
    const result = await db.execute(
      sql`SELECT * FROM stripe.products WHERE active = ${active} LIMIT ${limit} OFFSET ${offset}`
    );
    return result.rows;
  }

  // Listar produtos com preços
  async listProductsWithPrices(active = true, limit = 20, offset = 0) {
    const db = getDatabase();
    const result = await db.execute(
      sql`
        WITH paginated_products AS (
          SELECT id, name, description, metadata, active
          FROM stripe.products
          WHERE active = ${active}
          ORDER BY id
          LIMIT ${limit} OFFSET ${offset}
        )
        SELECT 
          p.id as product_id,
          p.name as product_name,
          p.description as product_description,
          p.active as product_active,
          p.metadata as product_metadata,
          pr.id as price_id,
          pr.unit_amount,
          pr.currency,
          pr.recurring,
          pr.active as price_active,
          pr.metadata as price_metadata
        FROM paginated_products p
        LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
        ORDER BY p.id, pr.unit_amount
      `
    );
    return result.rows;
  }

  // Obter produto por ID
  async getProduct(productId: string) {
    const db = getDatabase();
    const result = await db.execute(
      sql`SELECT * FROM stripe.products WHERE id = ${productId}`
    );
    return result.rows[0] || null;
  }

  // Obter preços de um produto
  async getPricesForProduct(productId: string) {
    const db = getDatabase();
    const result = await db.execute(
      sql`SELECT * FROM stripe.prices WHERE product = ${productId} AND active = true`
    );
    return result.rows;
  }

  // Obter assinatura por ID
  async getSubscription(subscriptionId: string) {
    const db = getDatabase();
    const result = await db.execute(
      sql`SELECT * FROM stripe.subscriptions WHERE id = ${subscriptionId}`
    );
    return result.rows[0] || null;
  }

  // Atualizar info Stripe do usuário
  async updateUserStripeInfo(userId: string, stripeInfo: {
    stripeCustomerId?: string;
    stripeSubscriptionId?: string | null;
  }) {
    const db = getDatabase();
    const [user] = await db.update(schema.users)
      .set(stripeInfo)
      .where(eq(schema.users.id, userId))
      .returning();
    return user;
  }

  // Obter usuário por Stripe Customer ID
  async getUserByStripeCustomerId(customerId: string) {
    const db = getDatabase();
    return await db.query.users.findFirst({
      where: eq(schema.users.stripeCustomerId, customerId),
    });
  }
}

export const stripeService = new StripeService();
