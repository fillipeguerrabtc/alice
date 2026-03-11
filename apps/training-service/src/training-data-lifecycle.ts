import crypto from 'crypto';
import { getDatabase, schema, eq, and, desc, isNull, inArray, ne } from '@alice/database';
import { getNamespaceProfileDefaultConfig } from '@alice/database/system-config';
import {
  type NamespaceProfileConfig,
  NamespaceProfileConfigSchema,
} from '@alice/shared';
import {
  applyPrivacyPolicy,
  buildNamespaceProfileReconcileIdempotencyKey,
  buildTrainingIdempotencyKey,
  computeSemHash,
  trainingEmbeddingDedupeQueuePayloadSchema,
  trainingNamespaceProfileReconcileQueuePayloadSchema,
  validateNamespaceTenantConsistency,
  validateTenantConsistency,
} from '@alice/shared-utils';
import { z } from 'zod';

interface TrainingDataLifecycleLogger {
  info: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
}

type ScopeResolverResult = {
  namespaceId: string | null;
  agentId: string | null;
  domain: string | null;
  confidence: number;
  needsHumanReview: boolean;
  suggestedNewNamespace?: unknown;
  trace: Record<string, unknown>;
};

interface ResolveScopeInput {
  tenantId: string;
  namespaceId: string | null;
  agentId: string | null;
  domain: string | null;
  sourceType: string | null;
  sourceId: string | null;
  sourceMetadata: Record<string, unknown>;
  conversationId: string | null;
  messagesText: string;
}

interface TrainingDataLifecycleMetrics {
  recordPrivacyRedactions: (count: number) => void;
  incrementPrivacyQuarantine: () => void;
  incrementDataRejected: (reason: string, sourceType: string) => void;
  incrementConsentRejected: () => void;
  observeScopeConfidence: (value: number) => void;
  incrementScopeQuarantine: (sourceType: string, reason: string) => void;
  incrementScopeSuggestedNewNamespace: (sourceType: string) => void;
  incrementDataCollected: (sourceType: string, status: 'rejected' | 'pending') => void;
  observeQualityScore: (value: number) => void;
  incrementDataDuplicates: (sourceType: string) => void;
}

export interface CreateTrainingDataLifecycleServiceParams {
  logger: TrainingDataLifecycleLogger;
  db: ReturnType<typeof getDatabase>;
  findNamespaceByIdInTenant: (tenantId: string, namespaceId: string) => Promise<{ id: string; tenantId: string | null } | null | undefined>;
  findAgentByIdInTenant: (tenantId: string, agentId: string) => Promise<{ id: string; tenantId: string | null; namespaceId: string | null } | null | undefined>;
  resolveScope: (input: ResolveScopeInput) => Promise<ScopeResolverResult>;
  enqueueNamespaceProfileReconcileJob: (payload: z.infer<typeof trainingNamespaceProfileReconcileQueuePayloadSchema>) => Promise<boolean>;
  enqueueTrainingEmbeddingDedupeJob: (payload: z.infer<typeof trainingEmbeddingDedupeQueuePayloadSchema>) => Promise<boolean>;
  metrics: TrainingDataLifecycleMetrics;
}

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1, 'Conteúdo da mensagem é obrigatório'),
});

export const trainingSourceTypeSchema = z.enum([
  'chat',
  'trading_signal',
  'trading_order',
  'trading_demo',
  'trading_postmortem',
  'document',
  'rag_document',
  'rag_media',
  'upload',
  'external',
  'manual',
  'system',
]);

export const collectTrainingDataSchema = z.object({
  tenantId: z.string().uuid('Tenant ID deve ser UUID válido'),
  namespaceId: z.string().uuid('Namespace ID deve ser UUID válido').optional(),
  agentId: z.string().uuid('Agent ID deve ser UUID válido').optional(),
  domain: z.string().min(1).max(120).optional(),
  conversationId: z.string().uuid('Conversation ID deve ser UUID válido').optional(),
  source: z.string().min(1, 'Fonte é obrigatória'),
  sourceType: trainingSourceTypeSchema.optional(),
  sourceId: z.string().min(1).max(255).optional(),
  sourceMetadata: z.record(z.unknown()).optional(),
  messages: z.array(messageSchema).min(1, 'Pelo menos uma mensagem é obrigatória'),
  rating: z.number().min(1).max(5).optional(),
});

export const collectTrainingDataPayloadSchema = collectTrainingDataSchema.omit({ tenantId: true });

export const bulkImportSchema = z.object({
  source: z.string().min(1).max(50),
  sourceType: trainingSourceTypeSchema.optional(),
  namespaceId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  domain: z.string().min(1).max(120).optional(),
  data: z.array(z.object({
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string().min(1),
    })).min(2),
    rating: z.number().min(1).max(5).optional(),
  })).min(1).max(1000),
  autoApprove: z.boolean().optional().default(false),
});

const TRAINING_DATA_ACTIVE_FINGERPRINT_UNIQUE_INDEX = 'training_data_active_fingerprint_uidx';
const TRAINING_DATA_ACTIVE_STATUSES_FOR_FINGERPRINT = ['pending', 'approved', 'reserved', 'used'] as const;

type TrainingQualityAssessment = {
  score: number;
  rejectionReasons: string[];
};

function clampQualityScore(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function evaluateTrainingQuality(params: {
  sourceType: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  sourceMetadata?: Record<string, unknown>;
}): TrainingQualityAssessment {
  const reasons: string[] = [];
  const sourceMetadata = params.sourceMetadata ?? {};
  const messages = params.messages;

  if (messages.length < 2) {
    reasons.push('insufficient_message_count');
  }
  const hasUser = messages.some((msg) => msg.role === 'user');
  const hasAssistant = messages.some((msg) => msg.role === 'assistant');
  if (!hasUser) reasons.push('missing_user_message');
  if (!hasAssistant) reasons.push('missing_assistant_message');

  const normalizedContents = messages.map((msg) => msg.content.trim()).filter((content) => content.length > 0);
  const totalLength = normalizedContents.reduce((sum, content) => sum + content.length, 0);
  const avgLength = normalizedContents.length > 0 ? totalLength / normalizedContents.length : 0;

  if (totalLength < 120) {
    reasons.push('content_too_short');
  }
  if (avgLength < 30) {
    reasons.push('average_message_too_short');
  }

  const uniqueContent = new Set(normalizedContents.map((content) => content.toLowerCase()));
  if (normalizedContents.length > 0 && uniqueContent.size / normalizedContents.length < 0.5) {
    reasons.push('high_content_repetition');
  }

  const isTradingSource = params.sourceType.startsWith('trading_');
  if (isTradingSource) {
    const actionType = sourceMetadata.actionType;
    const timeframe = sourceMetadata.timeframe;
    if (typeof actionType !== 'string' || actionType.trim().length === 0) {
      reasons.push('missing_trading_action_type');
    }
    if (typeof timeframe !== 'string' || timeframe.trim().length === 0) {
      reasons.push('missing_trading_timeframe');
    }
  }

  if (params.sourceType === 'rag_document' || params.sourceType === 'rag_media') {
    reasons.push('knowledge_rag_default');
  }

  let score = 1;
  for (const reason of reasons) {
    if (reason === 'knowledge_rag_default') {
      score -= 0.1;
      continue;
    }
    if (reason.startsWith('missing_trading_')) {
      score -= 0.15;
      continue;
    }
    score -= 0.12;
  }
  if (params.sourceType === 'rag_document' || params.sourceType === 'rag_media') {
    score = Math.min(score, 0.55);
  }

  return {
    score: clampQualityScore(score),
    rejectionReasons: reasons,
  };
}

export class TrainingHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly responsePayload: Record<string, unknown>,
  ) {
    super(`Training HTTP error ${status}`);
    this.name = 'TrainingHttpError';
  }
}

function isPgUniqueConstraintViolation(error: unknown, constraintName: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === '23505' && candidate.constraint === constraintName;
}

type TrainingNamespaceProfileRuntime = {
  profileVersion: number;
  isActive: boolean;
  autoCollectEnabled: boolean;
  exists: boolean;
  config: NamespaceProfileConfig;
};

async function resolveTrainingNamespaceProfile(params: {
  db: ReturnType<typeof getDatabase>;
  tenantId: string;
  namespaceId?: string | null;
}): Promise<TrainingNamespaceProfileRuntime> {
  const defaultConfig = await getNamespaceProfileDefaultConfig();
  if (!params.namespaceId) {
    return {
      profileVersion: 1,
      isActive: true,
      autoCollectEnabled: false,
      exists: false,
      config: defaultConfig,
    };
  }

  const profile = await params.db.query.namespaceProfiles.findFirst({
    where: and(
      eq(schema.namespaceProfiles.tenantId, params.tenantId),
      eq(schema.namespaceProfiles.namespaceId, params.namespaceId),
    ),
  });

  if (!profile) {
    return {
      profileVersion: 1,
      isActive: true,
      autoCollectEnabled: true,
      exists: false,
      config: defaultConfig,
    };
  }

  return {
    profileVersion: profile.version,
    isActive: profile.isActive,
    autoCollectEnabled: profile.autoCollectEnabled,
    exists: true,
    config: NamespaceProfileConfigSchema.parse(profile.config),
  };
}

export function createTrainingDataLifecycleService(params: CreateTrainingDataLifecycleServiceParams): {
  collectTrainingDataForTenant: (params: {
    tenantId: string;
    createdBy?: string;
    payload: z.infer<typeof collectTrainingDataPayloadSchema>;
  }) => Promise<{
    trainingData: typeof schema.trainingData.$inferSelect;
    queued: boolean;
    idempotencyKey: string;
    idempotencyHit?: boolean;
    isDuplicate: boolean;
    duplicateOfId: string | null;
    similarityScore: number | null;
  }>;
} {
  const {
    logger,
    db,
    findNamespaceByIdInTenant,
    findAgentByIdInTenant,
    resolveScope,
    enqueueNamespaceProfileReconcileJob,
    enqueueTrainingEmbeddingDedupeJob,
    metrics,
  } = params;

  async function collectTrainingDataForTenant(input: {
    tenantId: string;
    createdBy?: string;
    payload: z.infer<typeof collectTrainingDataPayloadSchema>;
  }): Promise<{
    trainingData: typeof schema.trainingData.$inferSelect;
    queued: boolean;
    idempotencyKey: string;
    idempotencyHit?: boolean;
    isDuplicate: boolean;
    duplicateOfId: string | null;
    similarityScore: number | null;
  }> {
    const body = input.payload;
    const resolvedTenantId = input.tenantId;
    const createdBy = input.createdBy;

    if (body.namespaceId) {
      await validateNamespaceTenantConsistency(
        body.namespaceId,
        resolvedTenantId,
        async (id) => findNamespaceByIdInTenant(resolvedTenantId, id),
      );
    }

    if (body.agentId) {
      const agent = await findAgentByIdInTenant(resolvedTenantId, body.agentId);
      validateTenantConsistency('agent', agent, resolvedTenantId, 'training_data');
    }

    const sourceType = body.sourceType ?? 'manual';
    const namespaceProfile = await resolveTrainingNamespaceProfile({
      db,
      tenantId: resolvedTenantId,
      namespaceId: body.namespaceId ?? null,
    });

    if (!namespaceProfile.exists && body.namespaceId) {
      const runId = crypto.randomUUID();
      const reconcilePayload = trainingNamespaceProfileReconcileQueuePayloadSchema.parse({
        runId,
        idempotencyKey: buildNamespaceProfileReconcileIdempotencyKey({ runId }),
        createdAt: new Date().toISOString(),
      });
      const enqueued = await enqueueNamespaceProfileReconcileJob(reconcilePayload);
      logger.warn(
        {
          tenantId: resolvedTenantId,
          namespaceId: body.namespaceId,
          runId,
          enqueued,
        },
        'Namespace profile ausente; reconcile enfileirado',
      );
    }

    const privacyResult = applyPrivacyPolicy({
      messages: body.messages,
      privacyConfig: namespaceProfile.config.privacy,
    });
    const messagesForStorage = privacyResult.messagesRedacted;

    if (privacyResult.summary.totalMatches > 0) {
      metrics.recordPrivacyRedactions(privacyResult.summary.totalMatches);
    }
    if (privacyResult.action === 'quarantine') {
      metrics.incrementPrivacyQuarantine();
    }

    if (sourceType === 'chat' && body.source === 'chat-auto') {
      if (!namespaceProfile.isActive || !namespaceProfile.autoCollectEnabled || !namespaceProfile.config.autoCollect.enabled) {
        metrics.incrementDataRejected('policy', sourceType);
        throw new TrainingHttpError(403, { error: 'namespace_profile_auto_collect_disabled' });
      }
    }

    if (sourceType === 'chat' && body.source === 'chat-auto' && namespaceProfile.config.autoCollect.requiresUserConsent) {
      const sourceMetadataUserId = typeof body.sourceMetadata?.['userId'] === 'string' ? body.sourceMetadata.userId : null;
      const userIdForConsent = sourceMetadataUserId ?? createdBy ?? null;
      if (!userIdForConsent) {
        metrics.incrementConsentRejected();
        throw new TrainingHttpError(403, { error: 'user_opt_out' });
      }
      const userRecord = await db.query.users.findFirst({
        where: and(
          eq(schema.users.id, userIdForConsent),
          eq(schema.users.tenantId, resolvedTenantId),
        ),
        columns: { preferencias: true },
      });
      const prefs = (userRecord?.preferencias ?? {}) as {
        training?: { allowTrainingUsage?: boolean; allowAutoCollect?: boolean };
      };
      if (prefs.training?.allowTrainingUsage === false || prefs.training?.allowAutoCollect === false) {
        metrics.incrementConsentRejected();
        throw new TrainingHttpError(403, { error: 'user_opt_out' });
      }
    }

    const messagesText = messagesForStorage.map((m) => m.content).join('\n');
    const scope = await resolveScope({
      tenantId: resolvedTenantId,
      namespaceId: body.namespaceId ?? null,
      agentId: body.agentId ?? null,
      domain: body.domain ?? null,
      sourceType: body.sourceType ?? null,
      sourceId: body.sourceId ?? null,
      sourceMetadata: body.sourceMetadata ?? {},
      conversationId: body.conversationId ?? null,
      messagesText,
    });
    metrics.observeScopeConfidence(scope.confidence);

    const effectiveNamespaceId = body.namespaceId ?? scope.namespaceId ?? null;
    const effectiveAgentId = body.agentId ?? scope.agentId ?? null;
    const inferredStatusNotes: string[] = [];
    if (scope.needsHumanReview) {
      inferredStatusNotes.push(
        `Escopo em quarentena automática: confidence=${scope.confidence.toFixed(2)}`,
      );
      metrics.incrementScopeQuarantine(body.sourceType ?? 'unknown', 'low_confidence_or_missing_namespace');
    }
    if (scope.suggestedNewNamespace) {
      metrics.incrementScopeSuggestedNewNamespace(body.sourceType ?? 'unknown');
    }

    const semhash = computeSemHash(messagesText);
    const qualityAssessment = evaluateTrainingQuality({
      sourceType,
      messages: messagesForStorage,
      sourceMetadata: body.sourceMetadata,
    });
    const qualityScore = qualityAssessment.score;
    const idempotencyKey = buildTrainingIdempotencyKey({
      tenantId: resolvedTenantId,
      sourceType,
      sourceId: body.sourceId ?? null,
      semhash,
    });

    const qualityMinScore = namespaceProfile.config.quality.minScore;
    const qualityAutoReject = namespaceProfile.config.quality.autoRejectBelowMin;
    const defaultPurpose = sourceType === 'rag_document' || sourceType === 'rag_media'
      ? 'knowledge_rag'
      : 'behavior_sft';
    const autoRejectedByQuality = qualityAutoReject && qualityScore < qualityMinScore;

    if (autoRejectedByQuality || privacyResult.action === 'reject') {
      const reviewNotes = autoRejectedByQuality
        ? `Auto-rejeitado: qualidade ${qualityScore.toFixed(2)} abaixo do mínimo (${qualityMinScore}).`
        : 'Rejeitado por política de privacidade';
      const processedAt = new Date();
      const [trainingData] = await db.insert(schema.trainingData).values({
        tenantId: resolvedTenantId,
        namespaceId: effectiveNamespaceId,
        agentId: effectiveAgentId,
        conversationId: body.conversationId,
        source: body.source,
        sourceType,
        sourceId: body.sourceId ?? null,
        sourceMetadata: body.sourceMetadata ?? {},
        inferredNamespaceId: scope.namespaceId,
        inferredAgentId: scope.agentId,
        inferredDomain: scope.domain,
        inferenceConfidence: scope.confidence,
        inferenceTrace: scope.trace,
        scopeResolverVersion: 'v1',
        profileVersion: namespaceProfile.profileVersion,
        needsHumanReview: scope.needsHumanReview || !namespaceProfile.exists,
        quarantineReason: !namespaceProfile.exists
          ? 'missing_namespace_profile'
          : scope.needsHumanReview
            ? 'low_confidence_or_missing_namespace'
            : null,
        scopeResolvedAt: new Date(),
        quarantinedAt: scope.needsHumanReview || !namespaceProfile.exists ? new Date() : null,
        messages: messagesForStorage,
        rating: body.rating,
        qualityScore,
        createdBy,
        semhash,
        embedding: null,
        isDuplicate: false,
        duplicateOfId: null,
        similarityScore: null,
        purpose: 'rejected',
        status: 'rejected',
        reviewNotes: [
          reviewNotes,
          !namespaceProfile.exists ? 'Namespace profile ausente; item em modo restritivo.' : null,
          privacyResult.action === 'reject' ? 'privacy_policy_match' : null,
          qualityAssessment.rejectionReasons.length > 0
            ? `quality_reasons:${qualityAssessment.rejectionReasons.join(',')}`
            : null,
          ...inferredStatusNotes,
        ].filter(Boolean).join(' | ') || null,
        processedAt,
        processadoEm: processedAt,
      }).returning();

      metrics.incrementDataCollected(sourceType, 'rejected');
      metrics.observeQualityScore(qualityScore);
      metrics.incrementDataRejected(privacyResult.action === 'reject' ? 'privacy' : 'quality', sourceType);

      await db.insert(schema.trainingLineageEvents).values({
        tenantId: resolvedTenantId,
        namespaceId: effectiveNamespaceId,
        eventType: 'training_data.rejected_policy',
        sourceTable: 'training_data',
        sourceId: trainingData.id,
        producedTable: 'training_data',
        producedId: trainingData.id,
        metadata: {
          sourceType,
          qualityScore,
          minScore: qualityMinScore,
          privacyAction: privacyResult.action,
        },
      });

      logger.info(
        {
          trainingDataId: trainingData.id,
          qualityScore,
          queued: false,
          idempotencyKey,
        },
        'Dados de treinamento rejeitados por qualidade mínima',
      );

      return {
        trainingData,
        queued: false,
        idempotencyKey,
        isDuplicate: false,
        duplicateOfId: null,
        similarityScore: null,
      };
    }

    const sameFingerprintConditions = [
      eq(schema.trainingData.tenantId, resolvedTenantId),
      eq(schema.trainingData.sourceType, sourceType),
      eq(schema.trainingData.semhash, semhash),
    ];

    if (body.sourceId) {
      sameFingerprintConditions.push(eq(schema.trainingData.sourceId, body.sourceId));
    } else {
      sameFingerprintConditions.push(isNull(schema.trainingData.sourceId));
    }

    const existingByFingerprint = await db.query.trainingData.findFirst({
      where: and(...sameFingerprintConditions),
      orderBy: [desc(schema.trainingData.criadoEm)],
    });

    if (existingByFingerprint) {
      const alreadyProcessed = Boolean(existingByFingerprint.embedding && existingByFingerprint.processedAt);
      logger.info(
        {
          trainingDataId: existingByFingerprint.id,
          queued: !alreadyProcessed && existingByFingerprint.status === 'pending',
          idempotencyKey,
        },
        'Requisição idempotente detectada em training_data',
      );

      return {
        trainingData: existingByFingerprint,
        queued: !alreadyProcessed && existingByFingerprint.status === 'pending',
        idempotencyKey,
        idempotencyHit: true,
        isDuplicate: Boolean(existingByFingerprint.isDuplicate),
        duplicateOfId: existingByFingerprint.duplicateOfId,
        similarityScore: existingByFingerprint.similarityScore ?? null,
      };
    }

    let trainingData: typeof schema.trainingData.$inferSelect | null = null;
    try {
      [trainingData] = await db.insert(schema.trainingData).values({
        tenantId: resolvedTenantId,
        namespaceId: effectiveNamespaceId,
        agentId: effectiveAgentId,
        conversationId: body.conversationId,
        source: body.source,
        sourceType,
        sourceId: body.sourceId ?? null,
        sourceMetadata: {
          ...(body.sourceMetadata ?? {}),
          privacySummary: namespaceProfile.config.privacy.logRedactionSummary ? privacyResult.summary : undefined,
          qualityAssessment: {
            score: qualityScore,
            rejectionReasons: qualityAssessment.rejectionReasons,
          },
        },
        inferredNamespaceId: scope.namespaceId,
        inferredAgentId: scope.agentId,
        inferredDomain: scope.domain,
        inferenceConfidence: scope.confidence,
        inferenceTrace: scope.trace,
        scopeResolverVersion: 'v1',
        profileVersion: namespaceProfile.profileVersion,
        needsHumanReview: scope.needsHumanReview
          || !namespaceProfile.exists
          || privacyResult.action === 'quarantine'
          || defaultPurpose === 'knowledge_rag',
        quarantineReason: defaultPurpose === 'knowledge_rag'
          ? 'knowledge_rag_default'
          : privacyResult.action === 'quarantine'
            ? 'privacy_policy_match'
            : !namespaceProfile.exists
              ? 'missing_namespace_profile'
              : scope.needsHumanReview
                ? 'low_confidence_or_missing_namespace'
                : null,
        scopeResolvedAt: new Date(),
        quarantinedAt: scope.needsHumanReview || !namespaceProfile.exists || privacyResult.action === 'quarantine' || defaultPurpose === 'knowledge_rag' ? new Date() : null,
        messages: messagesForStorage,
        rating: body.rating,
        qualityScore,
        createdBy,
        semhash,
        embedding: null,
        isDuplicate: false,
        duplicateOfId: null,
        similarityScore: null,
        purpose: defaultPurpose,
        status: 'pending',
        reviewNotes: [
          ...inferredStatusNotes,
          !namespaceProfile.exists ? 'Namespace profile ausente; reconcile solicitado.' : null,
          privacyResult.action === 'quarantine' ? 'privacy_policy_match' : null,
          defaultPurpose === 'knowledge_rag' ? 'knowledge_rag_default' : null,
          qualityAssessment.rejectionReasons.length > 0
            ? `quality_reasons:${qualityAssessment.rejectionReasons.join(',')}`
            : null,
        ].filter(Boolean).join(' | ') || null,
      }).returning();
    } catch (error) {
      if (!isPgUniqueConstraintViolation(error, TRAINING_DATA_ACTIVE_FINGERPRINT_UNIQUE_INDEX)) {
        throw error;
      }

      const existingAfterConflict = await db.query.trainingData.findFirst({
        where: and(
          ...sameFingerprintConditions,
          inArray(schema.trainingData.status, [...TRAINING_DATA_ACTIVE_STATUSES_FOR_FINGERPRINT]),
        ),
        orderBy: [desc(schema.trainingData.criadoEm)],
      });

      if (!existingAfterConflict) {
        throw error;
      }

      const alreadyProcessed = Boolean(existingAfterConflict.embedding && existingAfterConflict.processedAt);
      logger.warn(
        {
          trainingDataId: existingAfterConflict.id,
          queued: !alreadyProcessed && existingAfterConflict.status === 'pending',
          idempotencyKey,
        },
        'Conflito de fingerprint resolvido por unique index (idempotência concorrente)',
      );

      return {
        trainingData: existingAfterConflict,
        queued: !alreadyProcessed && existingAfterConflict.status === 'pending',
        idempotencyKey,
        idempotencyHit: true,
        isDuplicate: Boolean(existingAfterConflict.isDuplicate),
        duplicateOfId: existingAfterConflict.duplicateOfId,
        similarityScore: existingAfterConflict.similarityScore ?? null,
      };
    }

    if (!trainingData) {
      throw new Error('Falha ao inserir training_data');
    }

    await db.insert(schema.trainingLineageEvents).values({
      tenantId: resolvedTenantId,
      namespaceId: effectiveNamespaceId,
      eventType: privacyResult.action === 'quarantine' || !namespaceProfile.exists || scope.needsHumanReview
        ? 'training_data.quarantined_policy'
        : 'training_data.collected',
      sourceTable: 'training_data',
      sourceId: trainingData.id,
      producedTable: 'training_data',
      producedId: trainingData.id,
      metadata: {
        sourceType,
        qualityScore,
        profileVersion: namespaceProfile.profileVersion,
        privacyAction: privacyResult.action,
      },
    });

    const queuePayload = trainingEmbeddingDedupeQueuePayloadSchema.parse({
      trainingDataId: trainingData.id,
      tenantId: resolvedTenantId,
      namespaceId: effectiveNamespaceId ?? undefined,
      agentId: effectiveAgentId ?? undefined,
      semhash,
      sourceType,
      sourceId: body.sourceId ?? undefined,
      idempotencyKey,
      createdAt: new Date().toISOString(),
    });
    const queued = await enqueueTrainingEmbeddingDedupeJob(queuePayload);

    if (!queued) {
      const processedAt = new Date();
      const canonical = await db.query.trainingData.findFirst({
        where: and(
          ...sameFingerprintConditions,
          ne(schema.trainingData.id, trainingData.id),
        ),
        orderBy: [desc(schema.trainingData.criadoEm)],
      });

      const [updatedDuplicate] = await db.update(schema.trainingData)
        .set({
          isDuplicate: true,
          duplicateOfId: canonical?.id ?? null,
          similarityScore: 1,
          status: 'rejected',
          reviewNotes: [
            'Requisição idempotente duplicada: job já enfileirado para fingerprint idêntico.',
            trainingData.reviewNotes,
          ].filter(Boolean).join(' | '),
          processedAt,
          processadoEm: processedAt,
        })
        .where(eq(schema.trainingData.id, trainingData.id))
        .returning();

      const duplicateRow = updatedDuplicate ?? trainingData;
      metrics.incrementDataCollected(sourceType, 'rejected');
      metrics.incrementDataRejected('duplicate', sourceType);
      metrics.observeQualityScore(qualityScore);
      metrics.incrementDataDuplicates(sourceType);

      logger.info(
        {
          trainingDataId: duplicateRow.id,
          queued: false,
          idempotencyKey,
        },
        'Requisição idempotente duplicada sem novo enqueue',
      );

      return {
        trainingData: duplicateRow,
        queued: false,
        idempotencyKey,
        idempotencyHit: true,
        isDuplicate: true,
        duplicateOfId: duplicateRow.duplicateOfId,
        similarityScore: duplicateRow.similarityScore ?? null,
      };
    }

    metrics.incrementDataCollected(sourceType, 'pending');
    metrics.observeQualityScore(qualityScore);

    logger.info(
      {
        trainingDataId: trainingData.id,
        queued,
        idempotencyKey,
        scope: {
          namespaceId: effectiveNamespaceId,
          agentId: effectiveAgentId,
          inferredNamespaceId: scope.namespaceId,
          inferredAgentId: scope.agentId,
          inferredDomain: scope.domain,
          confidence: scope.confidence,
          needsHumanReview: scope.needsHumanReview,
        },
      },
      'Dados de treinamento coletados',
    );

    return {
      trainingData,
      queued,
      idempotencyKey,
      isDuplicate: false,
      duplicateOfId: null,
      similarityScore: null,
    };
  }

  return {
    collectTrainingDataForTenant,
  };
}
