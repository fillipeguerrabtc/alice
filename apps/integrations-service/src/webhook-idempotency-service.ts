import { getDatabase, schema } from '@alice/database';
import { and, eq, sql } from '@alice/database';

type WebhookLogger = {
  info: (payload: unknown, message: string) => void;
};

export type WebhookSource = 'stripe' | 'wise' | 'twilio';

export async function checkWebhookIdempotency(
  db: ReturnType<typeof getDatabase>,
  logger: WebhookLogger,
  source: WebhookSource,
  eventId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<{ isDuplicate: boolean; existingEvent?: typeof schema.webhookEvents.$inferSelect }> {
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

  await db.insert(schema.webhookEvents).values({
    source,
    eventId,
    eventType,
    payload,
    processed: false,
  });

  return { isDuplicate: false };
}

export async function markWebhookProcessed(
  db: ReturnType<typeof getDatabase>,
  source: WebhookSource,
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
