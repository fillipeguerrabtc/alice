import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, eq, getDatabase, schema } from '@alice/database';
import { getRedisClient, validateTenantConsistency } from '@alice/shared-utils';
import { z } from 'zod';
import { validateWebhookBodyDigest, validateWebhookSignature } from '../webhook-security.js';

type RequestWithRawBody = Request & { rawBody?: Buffer };

type WebhookPayload = {
  event: 'training_data' | 'feedback';
  payload: {
    messages?: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
      timestamp?: string;
    }>;
    rating?: number;
    conversationId?: string;
    metadata?: Record<string, unknown>;
  };
  timestamp?: string;
};

type TrainingSourceType =
  | 'chat'
  | 'trading_signal'
  | 'trading_order'
  | 'trading_demo'
  | 'trading_postmortem'
  | 'document'
  | 'rag_document'
  | 'rag_media'
  | 'upload'
  | 'external'
  | 'manual'
  | 'system';

type CollectTrainingPayload = {
  namespaceId?: string;
  agentId?: string;
  domain?: string;
  conversationId?: string;
  source: string;
  sourceType?: TrainingSourceType;
  sourceId?: string;
  sourceMetadata?: Record<string, unknown>;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  rating?: number;
};

type CollectTrainingResult = {
  trainingData: {
    id: string;
  };
  queued: boolean;
  idempotencyHit?: boolean;
};

type TrainingHttpErrorResponse = {
  status: number;
  payload: unknown;
};

interface RegisterTrainingWebhookRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  collectTrainingDataForTenant: (params: {
    tenantId: string;
    createdBy?: string;
    payload: CollectTrainingPayload;
  }) => Promise<CollectTrainingResult>;
  parseCollectTrainingDataPayload: (body: unknown) => CollectTrainingPayload;
  toTrainingHttpErrorResponse: (error: unknown) => TrainingHttpErrorResponse | null;
  incrementWebhookAuthValidationTotal: (params: {
    mode: 'internal_api_secret' | 'legacy_webhook_secret' | 'none';
    result: 'accepted' | 'rejected';
  }) => void;
  incrementWebhookBodyDigestValidationTotal: (params: {
    result: 'accepted' | 'rejected' | 'skipped';
  }) => void;
  incrementWebhookNonceValidationTotal: (params: {
    storage: 'redis' | 'memory';
    result:
      | 'accepted'
      | 'replay'
      | 'fallback_after_redis_error'
      | 'redis_error_blocked'
      | 'redis_unavailable_blocked';
  }) => void;
}

const webhookSchema = z.object({
  event: z.enum(['training_data', 'feedback']),
  payload: z.object({
    messages: z.array(z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
      timestamp: z.string().datetime().optional(),
    })).optional(),
    rating: z.number().min(1).max(5).optional(),
    conversationId: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  timestamp: z.string().optional(),
});

const webhookInternalHeadersSchema = z.object({
  'x-webhook-secret': z.string().min(1),
  'x-internal-signature': z.string().regex(/^[a-f0-9]{64}$/i),
  'x-internal-timestamp': z.string().regex(/^\d+$/),
  'x-internal-user-id': z.string().min(1),
  'x-internal-tenant-id': z.string().uuid(),
  'x-internal-role': z.string().min(1),
  'x-internal-nonce': z.string().uuid(),
  'x-internal-body-sha256': z.string().regex(/^[a-f0-9]{64}$/i).optional(),
});

const webhookNonceStore = new Map<string, number>();
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;
const WEBHOOK_NONCE_TTL_MS = 10 * 60 * 1000;
const WEBHOOK_NONCE_REDIS_PREFIX = 'alice:training:webhook:nonce';

function readUuidFromUnknown(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

function parseEnvBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (typeof value === 'undefined') return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return defaultValue;
}

type WebhookNonceValidationResult = {
  accepted: boolean;
  storage: 'redis' | 'memory';
  result:
    | 'accepted'
    | 'replay'
    | 'fallback_after_redis_error'
    | 'redis_error_blocked'
    | 'redis_unavailable_blocked';
};

function createWebhookNonceValidator(params: {
  logger: ReturnType<typeof createLogger>;
  webhookNonceRequireRedis: boolean;
}) {
  return async function validateAndStoreWebhookNonce(input: {
    tenantId: string;
    nonce: string;
  }): Promise<WebhookNonceValidationResult> {
    const inMemoryKey = `${input.tenantId}:${input.nonce}`;
    const redis = getRedisClient();

    if (redis) {
      try {
        const redisKey = `${WEBHOOK_NONCE_REDIS_PREFIX}:${input.tenantId}:${input.nonce}`;
        const lock = await redis.set(redisKey, '1', { NX: true, PX: WEBHOOK_NONCE_TTL_MS });
        if (lock !== 'OK') {
          return { accepted: false, storage: 'redis', result: 'replay' };
        }
        return { accepted: true, storage: 'redis', result: 'accepted' };
      } catch (error) {
        params.logger.error(
          { error, tenantId: input.tenantId },
          'Falha ao validar nonce do webhook no Redis',
        );
        if (params.webhookNonceRequireRedis) {
          return { accepted: false, storage: 'redis', result: 'redis_error_blocked' };
        }
        const nonceExpiry = webhookNonceStore.get(inMemoryKey);
        if (nonceExpiry && nonceExpiry > Date.now()) {
          return { accepted: false, storage: 'memory', result: 'replay' };
        }
        webhookNonceStore.set(inMemoryKey, Date.now() + WEBHOOK_NONCE_TTL_MS);
        return { accepted: true, storage: 'memory', result: 'fallback_after_redis_error' };
      }
    }

    if (params.webhookNonceRequireRedis) {
      return { accepted: false, storage: 'redis', result: 'redis_unavailable_blocked' };
    }

    const nonceExpiry = webhookNonceStore.get(inMemoryKey);
    if (nonceExpiry && nonceExpiry > Date.now()) {
      return { accepted: false, storage: 'memory', result: 'replay' };
    }
    webhookNonceStore.set(inMemoryKey, Date.now() + WEBHOOK_NONCE_TTL_MS);
    return { accepted: true, storage: 'memory', result: 'accepted' };
  };
}

export function registerTrainingWebhookRoutes(
  app: Express,
  deps: RegisterTrainingWebhookRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('training-service');
  const webhookNonceRequireRedis = parseEnvBoolean(
    process.env.TRAINING_WEBHOOK_NONCE_REQUIRE_REDIS,
    process.env.NODE_ENV === 'production',
  );
  const validateAndStoreWebhookNonce = createWebhookNonceValidator({
    logger,
    webhookNonceRequireRedis,
  });

  const webhookNonceCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [nonce, expiresAt] of webhookNonceStore.entries()) {
      if (expiresAt <= now) {
        webhookNonceStore.delete(nonce);
      }
    }
  }, 60_000);
  webhookNonceCleanupTimer.unref?.();

  app.post('/api/training/webhook', async (req: Request, res: Response) => {
    const expectedSecret = process.env.TRAINING_WEBHOOK_SECRET;
    if (!expectedSecret) {
      logger.error('TRAINING_WEBHOOK_SECRET nao configurado - webhook desabilitado por seguranca');
      return res.status(503).json({ error: 'Webhook nao configurado. Configure TRAINING_WEBHOOK_SECRET.' });
    }

    const headersValidation = webhookInternalHeadersSchema.safeParse(req.headers);
    if (!headersValidation.success) {
      logger.warn({ issues: headersValidation.error.issues }, 'Webhook com headers internos invalidos');
      return res.status(401).json({ error: 'Headers internos invalidos' });
    }

    const {
      'x-webhook-secret': webhookSecret,
      'x-internal-signature': internalSignature,
      'x-internal-timestamp': internalTimestamp,
      'x-internal-user-id': internalUserId,
      'x-internal-tenant-id': internalTenantId,
      'x-internal-role': internalRole,
      'x-internal-nonce': internalNonce,
      'x-internal-body-sha256': internalBodySha256,
    } = headersValidation.data;

    const secretBuffer = Buffer.from(webhookSecret, 'utf-8');
    const expectedBuffer = Buffer.from(expectedSecret, 'utf-8');
    const lengthsMatch = secretBuffer.length === expectedBuffer.length;
    const secretValid = lengthsMatch && crypto.timingSafeEqual(
      secretBuffer,
      lengthsMatch ? expectedBuffer : Buffer.alloc(secretBuffer.length),
    );
    if (!secretValid) {
      logger.warn({ hasSecret: true }, 'Tentativa de webhook com secret invalido');
      return res.status(401).json({ error: 'Webhook secret invalido' });
    }

    const timestampNum = Number.parseInt(internalTimestamp, 10);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(timestampNum) || Math.abs(nowSeconds - timestampNum) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
      return res.status(401).json({ error: 'Timestamp interno invalido ou expirado' });
    }

    const rawBody = (req as RequestWithRawBody).rawBody ?? null;
    const computedBodyDigest = crypto
      .createHash('sha256')
      .update(rawBody ?? Buffer.from(JSON.stringify(req.body), 'utf8'))
      .digest('hex');
    const signaturePayloadV1 = `${internalUserId}:${internalTenantId}:${internalRole}:${internalNonce}:${internalTimestamp}`;
    const signaturePayloadV2 = `${signaturePayloadV1}:${computedBodyDigest}`;
    const allowLegacySignature = process.env.TRAINING_WEBHOOK_ALLOW_LEGACY_SIGNATURE === 'true';

    let signatureVersion: 'v1' | 'v2' = 'v2';
    let signatureValidation = validateWebhookSignature({
      signature: internalSignature,
      payload: signaturePayloadV2,
      webhookSecret: expectedSecret,
      internalApiSecret: process.env.INTERNAL_API_SECRET,
      allowLegacySignature,
    });
    if (!signatureValidation.ok) {
      signatureVersion = 'v1';
      signatureValidation = validateWebhookSignature({
        signature: internalSignature,
        payload: signaturePayloadV1,
        webhookSecret: expectedSecret,
        internalApiSecret: process.env.INTERNAL_API_SECRET,
        allowLegacySignature,
      });
    }
    deps.incrementWebhookAuthValidationTotal({
      mode: signatureValidation.mode,
      result: signatureValidation.ok ? 'accepted' : 'rejected',
    });
    if (!signatureValidation.ok) {
      return res.status(401).json({ error: 'Assinatura interna invalida' });
    }
    if (signatureValidation.mode === 'legacy_webhook_secret') {
      logger.warn(
        { tenantId: internalTenantId },
        'Webhook autenticado via assinatura legada; migre para assinatura com INTERNAL_API_SECRET',
      );
    }
    if (signatureValidation.ok && signatureVersion === 'v1') {
      logger.warn(
        { tenantId: internalTenantId },
        'Webhook autenticado sem bind criptografico do corpo (payload v1); migre para payload v2',
      );
    }

    const bodyDigestValidation = validateWebhookBodyDigest({
      payload: req.body,
      expectedDigest: internalBodySha256,
      rawBody,
    });
    deps.incrementWebhookBodyDigestValidationTotal({
      result: bodyDigestValidation.result,
    });
    if (!bodyDigestValidation.ok) {
      return res.status(401).json({ error: 'Integridade do payload do webhook invalida' });
    }

    const nonceValidation = await validateAndStoreWebhookNonce({
      tenantId: internalTenantId,
      nonce: internalNonce,
    });
    deps.incrementWebhookNonceValidationTotal({
      storage: nonceValidation.storage,
      result: nonceValidation.result,
    });
    if (!nonceValidation.accepted) {
      if (nonceValidation.result === 'redis_error_blocked' || nonceValidation.result === 'redis_unavailable_blocked') {
        return res.status(503).json({ error: 'Validacao de nonce indisponivel; webhook bloqueado (fail-closed)' });
      }
      return res.status(409).json({ error: 'Nonce ja utilizado (replay detectado)' });
    }

    const db = getDatabase();
    const tenant = await db.query.tenants.findFirst({
      where: eq(schema.tenants.id, internalTenantId),
      columns: { id: true },
    });
    if (!tenant) {
      return res.status(403).json({ error: 'Tenant invalido para webhook' });
    }
    const internalUser = await db.query.users.findFirst({
      where: eq(schema.users.id, internalUserId),
      columns: { id: true, tenantId: true },
    });
    if (!internalUser) {
      return res.status(401).json({ error: 'Usuario interno invalido para webhook' });
    }
    try {
      validateTenantConsistency('user', internalUser, internalTenantId, 'training_webhook');
    } catch {
      return res.status(403).json({ error: 'Usuario nao pertence ao tenant do webhook' });
    }

    try {
      const validation = webhookSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Payload invalido',
          details: validation.error.issues,
        });
      }
      const payloadEnvelope = validation.data as WebhookPayload;
      const { event, payload } = payloadEnvelope;

      if (event === 'training_data' && payload.messages) {
        const payloadMetadata = (payload.metadata ?? {}) as Record<string, unknown>;
        const sourceIdRaw = payloadMetadata.sourceId;
        const sourceId = typeof sourceIdRaw === 'string' && sourceIdRaw.trim().length > 0
          ? sourceIdRaw.trim().slice(0, 255)
          : undefined;

        const collectResult = await deps.collectTrainingDataForTenant({
          tenantId: internalTenantId,
          createdBy: internalUserId,
          payload: deps.parseCollectTrainingDataPayload({
            namespaceId: readUuidFromUnknown(payloadMetadata.namespaceId) ?? undefined,
            agentId: readUuidFromUnknown(payloadMetadata.agentId) ?? undefined,
            domain: typeof payloadMetadata.domain === 'string' ? payloadMetadata.domain : undefined,
            conversationId: readUuidFromUnknown(payload.conversationId) ?? undefined,
            source: 'webhook',
            sourceType: 'external',
            sourceId,
            sourceMetadata: {
              ...payloadMetadata,
              event,
              webhookTimestamp: payloadEnvelope.timestamp ?? null,
              internalRole,
            },
            messages: payload.messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            rating: payload.rating,
          }),
        });

        const statusCode = collectResult.idempotencyHit ? 200 : 201;
        logger.info({
          id: collectResult.trainingData.id,
          event,
          queued: collectResult.queued,
          idempotencyHit: Boolean(collectResult.idempotencyHit),
        }, 'Dados recebidos via webhook');
        return res.status(statusCode).json({
          success: true,
          id: collectResult.trainingData.id,
          queued: collectResult.queued,
          idempotencyHit: Boolean(collectResult.idempotencyHit),
        });
      }

      if (event === 'feedback' && payload.conversationId) {
        await db.update(schema.trainingData)
          .set({ rating: payload.rating })
          .where(and(
            eq(schema.trainingData.conversationId, payload.conversationId),
            eq(schema.trainingData.tenantId, internalTenantId),
          ));

        logger.info(
          { conversationId: payload.conversationId, rating: payload.rating },
          'Feedback atualizado via webhook',
        );
        return res.json({ success: true });
      }

      return res.status(400).json({ error: 'Evento nao suportado ou payload incompleto' });
    } catch (error) {
      const trainingHttpError = deps.toTrainingHttpErrorResponse(error);
      if (trainingHttpError) {
        return res.status(trainingHttpError.status).json(trainingHttpError.payload);
      }
      logger.error({ error }, 'Falha ao processar webhook');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  logger.info('Training webhook routes registered');
}
