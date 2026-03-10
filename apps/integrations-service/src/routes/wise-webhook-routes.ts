import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { eq, getDatabase, schema } from '@alice/database';

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

type InsertWiseWebhookEventFn = (params: {
  tenantId?: string | null;
  deliveryId?: string;
  subscriptionId?: string;
  eventType?: string;
  schemaVersion?: string;
  sentAt?: string;
  signatureValid: boolean;
  payload: Record<string, unknown>;
}) => Promise<void>;

interface RegisterWiseWebhookRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  validateWiseWebhook: (signature: string, payload: string) => { valid: boolean; reason?: string };
  checkWebhookIdempotency: CheckWebhookIdempotencyFn;
  markWebhookProcessed: MarkWebhookProcessedFn;
  insertWiseWebhookEvent: InsertWiseWebhookEventFn;
}

interface WiseWebhookEvent {
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
}

export function registerWiseWebhookRoutes(
  app: Express,
  deps: RegisterWiseWebhookRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');
  const {
    validateWiseWebhook,
    checkWebhookIdempotency,
    markWebhookProcessed,
    insertWiseWebhookEvent,
  } = deps;

  // Wise Webhook - express.raw() já aplicado via app.use() ANTES de express.json()
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
      logger.error('Webhook Wise: body não é Buffer (express.raw() não aplicado corretamente)');
      return res.status(500).json({ error: 'Invalid body parser for webhook' });
    }

    const signature = req.headers['x-signature-sha256'] as string;
    const isTestNotification = req.headers['x-test-notification'] === 'true';
    const deliveryId = req.headers['x-delivery-id'] as string;
    const payload = req.body.toString('utf8');

    if (isTestNotification) {
      logger.info({ deliveryId }, 'Webhook Wise: Notificação de teste recebida');
      res.status(200).json({ received: true });
      return;
    }

    const validation = validateWiseWebhook(signature, payload);
    if (!validation.valid) {
      logger.warn({
        deliveryId,
        reason: validation.reason,
        signaturePresent: !!signature,
      }, 'Webhook Wise: Assinatura inválida - rejeitando');
      res.status(403).json({ error: 'Invalid signature' });
      return;
    }

    let event: WiseWebhookEvent;

    try {
      event = JSON.parse(payload) as WiseWebhookEvent;
    } catch (parseError) {
      logger.error({ error: parseError, deliveryId }, 'Webhook Wise: Falha ao parsear payload');
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }

    const db = getDatabase();
    const eventId = deliveryId || `wise-${event.data.resource.id}-${event.event_type}-${event.data.occurred_at}`;

    const { isDuplicate } = await checkWebhookIdempotency(
      db,
      'wise',
      eventId,
      event.event_type,
      event as unknown as Record<string, unknown>,
    );

    if (isDuplicate) {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }

    let webhookTenantId: string | null = null;
    if (Number.isFinite(event.data.resource.profile_id)) {
      const profileRecord = await db.query.wiseProfiles.findFirst({
        where: eq(schema.wiseProfiles.wiseProfileId, event.data.resource.profile_id),
        columns: { tenantId: true },
      });
      webhookTenantId = profileRecord?.tenantId ?? null;
    }

    await insertWiseWebhookEvent({
      tenantId: webhookTenantId,
      deliveryId,
      subscriptionId: typeof req.headers['x-subscription-id'] === 'string' ? req.headers['x-subscription-id'] : undefined,
      eventType: event.event_type,
      schemaVersion: typeof req.headers['x-schema-version'] === 'string' ? req.headers['x-schema-version'] : undefined,
      sentAt: event.data.occurred_at,
      signatureValid: true,
      payload: event as unknown as Record<string, unknown>,
    });

    res.status(200).json({ received: true });

    let processingResult: Record<string, unknown> = {};
    let processingError: string | undefined;

    try {
      logger.info({
        eventType: event.event_type,
        resourceId: event.data.resource.id,
        deliveryId,
      }, 'Webhook Wise recebido e validado');

      if (event.event_type === 'transfers#state-change') {
        const transfer = event.data.resource;
        const newState = event.data.current_state;
        processingResult = { transferId: transfer.id, state: newState };
      }

      if (event.event_type === 'balances#credit') {
        const balance = event.data.resource;
        processingResult = { balanceId: balance.id, action: 'credit_received' };
      }
    } catch (error) {
      processingError = error instanceof Error ? error.message : String(error);
      logger.error({ error, deliveryId }, 'Falha ao processar webhook Wise');
    }

    await markWebhookProcessed(db, 'wise', eventId, processingResult, processingError);
  });
}
