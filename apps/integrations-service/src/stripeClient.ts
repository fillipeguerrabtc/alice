// Cliente Stripe para Alice Enterprise Platform
// Produção: Hetzner Cloud com variáveis de ambiente padrão
import Stripe from 'stripe';

// Obtém a chave secreta do Stripe das variáveis de ambiente
function getStripeSecretKeySync(): string {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY não configurada nas variáveis de ambiente');
  }
  return secretKey;
}

// Obtém a chave pública do Stripe das variáveis de ambiente
function getStripePublishableKeySync(): string {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) {
    throw new Error('STRIPE_PUBLISHABLE_KEY não configurada nas variáveis de ambiente');
  }
  return publishableKey;
}

// Cliente Stripe singleton (pode ser cacheado em produção)
let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(getStripeSecretKeySync(), {
      apiVersion: '2025-08-27.basil' as const,
    });
  }
  return stripeClient;
}

// Funções assíncronas para compatibilidade com código existente
export async function getUncachableStripeClient(): Promise<Stripe> {
  return new Stripe(getStripeSecretKeySync(), {
    apiVersion: '2025-08-27.basil' as const,
  });
}

export async function getStripePublishableKey(): Promise<string> {
  return getStripePublishableKeySync();
}

export async function getStripeSecretKey(): Promise<string> {
  return getStripeSecretKeySync();
}

// Webhook secret para validação de eventos
export function getStripeWebhookSecret(): string {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET não configurada nas variáveis de ambiente');
  }
  return webhookSecret;
}

// Validar assinatura de webhook
export function validateWebhookSignature(
  payload: string | Buffer,
  signature: string
): Stripe.Event {
  const stripe = getStripeClient();
  const webhookSecret = getStripeWebhookSecret();
  
  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}

// Tipos de eventos Stripe que a Alice processa
export const ALICE_STRIPE_EVENTS = [
  'customer.created',
  'customer.updated',
  'customer.deleted',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'invoice.paid',
  'invoice.payment_failed',
  'checkout.session.completed',
  'subscription.created',
  'subscription.updated',
  'subscription.deleted',
] as const;

export type AliceStripeEvent = typeof ALICE_STRIPE_EVENTS[number];

// Interface para processamento de webhooks
interface StripeSyncProcessor {
  processWebhook(payload: Buffer, signature: string, uuid: string): Promise<void>;
}

// Obtém o processador de sincronização do Stripe
export async function getStripeSync(): Promise<StripeSyncProcessor> {
  const stripe = getStripeClient();
  const webhookSecret = getStripeWebhookSecret();

  return {
    async processWebhook(payload: Buffer, signature: string, _uuid: string): Promise<void> {
      // Validar e construir o evento
      const event = stripe.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret
      );

      // Processar eventos baseado no tipo
      switch (event.type) {
        case 'customer.created':
        case 'customer.updated':
        case 'customer.deleted':
          console.log(`[Stripe] Evento de cliente processado: ${event.type}`);
          break;
        case 'payment_intent.succeeded':
          console.log('[Stripe] Pagamento bem-sucedido');
          break;
        case 'payment_intent.payment_failed':
          console.log('[Stripe] Pagamento falhou');
          break;
        case 'invoice.paid':
        case 'invoice.payment_failed':
          console.log(`[Stripe] Evento de fatura processado: ${event.type}`);
          break;
        case 'checkout.session.completed':
          console.log('[Stripe] Checkout concluído');
          break;
        default:
          console.log(`[Stripe] Evento não tratado: ${event.type}`);
      }
    }
  };
}
