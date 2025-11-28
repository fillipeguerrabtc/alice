// Blueprint: stripe integration - Serviço Stripe
// Enterprise-Grade: Idempotency keys OBRIGATÓRIAS para prevenir cobranças duplicadas (Stripe Best Practices 2025)
import { getUncachableStripeClient } from './stripeClient.js';
import { getDatabase, schema } from '@alice/database';
import { eq, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { createLogger } from '@alice/logger';

const logger = createLogger('stripe-service');

/**
 * Gera idempotency key única para operações Stripe.
 * 
 * ATENÇÃO: Esta função deve ser usada APENAS para gerar a key inicial.
 * O chamador DEVE persistir e reusar a mesma key em retries.
 * 
 * SEGURANÇA: Usa crypto.randomUUID() para garantir unicidade absoluta (OWASP 2025).
 * UUID v4 garante 2^122 bits de entropia.
 * 
 * @param prefix - Prefixo para identificar tipo de operação (cust, checkout, pi, sub, etc.)
 * @returns Idempotency key única no formato prefix_UUID
 */
export function generateIdempotencyKey(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/**
 * Valida idempotency key e retorna key válida ou lança erro em produção.
 * 
 * CONTRATO ENTERPRISE: Em produção, idempotencyKey é OBRIGATÓRIA.
 * O chamador deve gerar a key antes da primeira tentativa e reutilizá-la
 * em todos os retries para garantir idempotência real.
 * 
 * @param idempotencyKey - Key fornecida pelo chamador
 * @param prefix - Prefixo para fallback em dev
 * @param operation - Nome da operação para logs
 * @returns Key validada
 * @throws Error se em produção sem key (Regra 6 - ZERO soluções temporárias)
 */
function validateIdempotencyKey(
  idempotencyKey: string | undefined, 
  prefix: string,
  operation: string
): string {
  if (idempotencyKey) {
    return idempotencyKey;
  }
  
  // Em produção, idempotencyKey é OBRIGATÓRIA (Regra 6)
  if (process.env.NODE_ENV === 'production') {
    logger.error({ operation }, 'idempotencyKey não fornecida em produção - operação rejeitada');
    throw new Error(`idempotencyKey é obrigatória para ${operation} em produção. ` +
      'Gere uma key única por operação de negócio e reutilize em retries.');
  }
  
  // Em dev, gera key com warning (facilita testes, mas não para produção)
  const fallbackKey = generateIdempotencyKey(prefix);
  logger.warn({ 
    operation, 
    fallbackKey 
  }, 'idempotencyKey não fornecida - usando fallback (APENAS DEV). ' +
     'Em produção, chamador DEVE fornecer key.');
  
  return fallbackKey;
}

export class StripeService {
  /**
   * Criar cliente no Stripe com idempotency key.
   * 
   * CONTRATO: idempotencyKey é OBRIGATÓRIA em produção.
   * Gere com generateIdempotencyKey('cust') antes da primeira tentativa
   * e reutilize a mesma key em todos os retries.
   */
  async createCustomer(email: string, userId: string, name?: string, idempotencyKey?: string) {
    const stripe = await getUncachableStripeClient();
    const key = validateIdempotencyKey(idempotencyKey, 'cust', 'createCustomer');
    
    return await stripe.customers.create(
      {
        email,
        name,
        metadata: { userId },
      },
      {
        idempotencyKey: key,
      }
    );
  }

  /**
   * Criar sessão de checkout com idempotency key.
   * 
   * CONTRATO: idempotencyKey é OBRIGATÓRIA em produção.
   * Gere com generateIdempotencyKey('checkout') antes da primeira tentativa
   * e reutilize a mesma key em todos os retries.
   */
  async createCheckoutSession(
    customerId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
    mode: 'subscription' | 'payment' = 'subscription',
    idempotencyKey?: string
  ) {
    const stripe = await getUncachableStripeClient();
    const key = validateIdempotencyKey(idempotencyKey, 'checkout', 'createCheckoutSession');
    
    return await stripe.checkout.sessions.create(
      {
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode,
        success_url: successUrl,
        cancel_url: cancelUrl,
      },
      {
        idempotencyKey: key,
      }
    );
  }

  // Criar portal de gerenciamento de assinatura (sem idempotency - operação idempotente por natureza)
  async createCustomerPortalSession(customerId: string, returnUrl: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  /**
   * Criar PaymentIntent com idempotency key OBRIGATÓRIA.
   * 
   * CONTRATO ENTERPRISE: idempotencyKey é OBRIGATÓRIA em produção.
   * Gere com generateIdempotencyKey('pi') antes da primeira tentativa
   * e reutilize a mesma key em todos os retries.
   * 
   * ATENÇÃO: PaymentIntent envolve dinheiro real - idempotência é CRÍTICA
   * para prevenir cobranças duplicadas (Stripe Best Practices 2025).
   */
  async createPaymentIntent(
    amount: number, 
    currency: string = 'eur', 
    customerId?: string,
    idempotencyKey?: string,
    metadata?: Record<string, string>
  ) {
    const stripe = await getUncachableStripeClient();
    const key = validateIdempotencyKey(idempotencyKey, 'pi', 'createPaymentIntent');
    
    return await stripe.paymentIntents.create(
      {
        amount,
        currency,
        customer: customerId,
        automatic_payment_methods: { enabled: true },
        metadata,
      },
      {
        idempotencyKey: key,
      }
    );
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
