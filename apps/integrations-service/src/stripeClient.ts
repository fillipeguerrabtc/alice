// Cliente Stripe para Alice Enterprise Platform
// Produção: Hetzner Cloud com variáveis de ambiente padrão
// Documentação: https://docs.stripe.com/api/versioning
import Stripe from 'stripe';
import pino from 'pino';

// Logger usando pino diretamente (evita dependência circular com @alice/logger)
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  name: 'stripe-client',
});

// STRIPE API VERSION: Versão estável atual (Novembro 2025)
// Referência: https://docs.stripe.com/changelog
// IMPORTANTE: Atualizar periodicamente conforme novas versões são lançadas
const STRIPE_API_VERSION = '2024-12-18.acacia' as Stripe.LatestApiVersion;

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
      apiVersion: STRIPE_API_VERSION,
    });
    logger.info({ apiVersion: STRIPE_API_VERSION }, 'Cliente Stripe inicializado');
  }
  return stripeClient;
}

// Funções assíncronas para compatibilidade com código existente
export async function getUncachableStripeClient(): Promise<Stripe> {
  return new Stripe(getStripeSecretKeySync(), {
    apiVersion: STRIPE_API_VERSION,
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
          logger.info({ eventType: event.type }, 'Evento de cliente processado');
          break;
        case 'payment_intent.succeeded':
          logger.info({ eventType: event.type }, 'Pagamento bem-sucedido');
          break;
        case 'payment_intent.payment_failed':
          logger.warn({ eventType: event.type }, 'Pagamento falhou');
          break;
        case 'invoice.paid':
        case 'invoice.payment_failed':
          logger.info({ eventType: event.type }, 'Evento de fatura processado');
          break;
        case 'checkout.session.completed':
          logger.info({ eventType: event.type }, 'Checkout concluído');
          break;
        default:
          logger.debug({ eventType: event.type }, 'Evento não tratado');
      }
    }
  };
}
