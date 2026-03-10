import type { Express, Request, Response } from 'express';
import { and, eq, getDatabase, inArray, schema } from '@alice/database';
import { createLogger } from '@alice/logger';
import {
  requirePermission,
  validateNamespaceTenantConsistency,
  validateTenantConsistency,
} from '@alice/shared-utils';

interface TenantResolutionSuccess {
  ok: true;
  tenantId: string;
}

interface TenantResolutionError {
  ok: false;
  status: number;
  error: string;
}

type ResolveAuthorizedTenantIdFn = (
  req: Request,
  requestedTenantId?: string | null,
) => TenantResolutionSuccess | TenantResolutionError;

type BulkImportItem = {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  rating?: number;
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

type BulkImportPayload = {
  source: string;
  sourceType?: TrainingSourceType;
  namespaceId?: string;
  agentId?: string;
  domain?: string;
  data: BulkImportItem[];
  autoApprove?: boolean;
};

type ScopeResolution = {
  namespaceId: string | null;
  agentId: string | null;
  domain: string | null;
  confidence: number;
  trace: Record<string, unknown> | null;
  needsHumanReview: boolean;
  suggestedNewNamespace?: unknown;
};

type QualityAssessment = {
  score: number;
  rejectionReasons: string[];
};

type TrainingEmbeddingDedupeQueuePayload = {
  trainingDataId: string;
  tenantId: string;
  namespaceId?: string;
  agentId?: string;
  semhash: string;
  sourceType: string;
  sourceId?: string;
  idempotencyKey: string;
  createdAt: string;
};

interface RegisterTrainingBulkImportRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  resolveAuthorizedTenantId: ResolveAuthorizedTenantIdFn;
  parseBulkImportBody: (body: unknown) => BulkImportPayload;
  findNamespaceByIdInTenant: (
    tenantId: string,
    namespaceId: string,
  ) => Promise<{ tenantId: string | null } | undefined>;
  findAgentByIdInTenant: (
    tenantId: string,
    agentId: string,
  ) => Promise<{ tenantId: string | null; namespaceId: string | null } | undefined>;
  computeSemHash: (input: string) => string;
  evaluateTrainingQuality: (params: {
    sourceType: TrainingSourceType;
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    sourceMetadata: Record<string, unknown>;
  }) => QualityAssessment;
  resolveScope: (params: {
    tenantId: string;
    namespaceId: string | null;
    agentId: string | null;
    domain: string | null;
    sourceType: TrainingSourceType;
    sourceMetadata: Record<string, unknown>;
    messagesText: string;
  }) => Promise<ScopeResolution>;
  observeScopeConfidence: (value: number) => void;
  incrementScopeQuarantineTotal: (params: { sourceType: string; reason: string }) => void;
  incrementScopeSuggestedNewNamespaceTotal: (params: { sourceType: string }) => void;
  getTrainingDataMinQuality: () => number;
  buildTrainingIdempotencyKey: (params: {
    tenantId: string;
    sourceType: string;
    sourceId: string | null;
    semhash: string;
  }) => string;
  parseTrainingEmbeddingDedupeQueuePayload: (
    payload: Record<string, unknown>,
  ) => TrainingEmbeddingDedupeQueuePayload;
  enqueueTrainingEmbeddingDedupeJob: (payload: TrainingEmbeddingDedupeQueuePayload) => Promise<boolean>;
}

export function registerTrainingBulkImportRoutes(
  app: Express,
  deps: RegisterTrainingBulkImportRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('training-service');

  app.post('/api/training/bulk-import', requirePermission('training:training_data:write'), async (req: Request, res: Response) => {
    try {
      const tenantResolution = deps.resolveAuthorizedTenantId(req);
      if (!tenantResolution.ok) {
        logger.warn({ path: req.path }, 'Tentativa de bulk-import sem tenant valido');
        return res.status(403).json({ error: 'Tenant nao identificado. Autenticacao obrigatoria.' });
      }

      const tenantId = tenantResolution.tenantId;
      const body = deps.parseBulkImportBody(req.body);
      const sourceTypeForImport = body.sourceType ?? 'external';
      const autoApprove = body.autoApprove ?? false;
      const trainingDataMinQuality = deps.getTrainingDataMinQuality();
      const db = getDatabase();

      if (body.namespaceId) {
        try {
          await validateNamespaceTenantConsistency(
            body.namespaceId,
            tenantId,
            async (id) => deps.findNamespaceByIdInTenant(tenantId, id),
          );
        } catch (validationError) {
          logger.warn({
            tenantId,
            namespaceId: body.namespaceId,
            error: validationError instanceof Error ? validationError.message : String(validationError),
          }, 'Bulk import rejeitado por namespace fora do tenant');
          return res.status(403).json({ error: 'Namespace invalido para o tenant autenticado.' });
        }
      }

      if (body.agentId) {
        const agent = await deps.findAgentByIdInTenant(tenantId, body.agentId);
        try {
          validateTenantConsistency('agent', agent, tenantId, 'training_bulk_import');
        } catch (validationError) {
          logger.warn({
            tenantId,
            agentId: body.agentId,
            error: validationError instanceof Error ? validationError.message : String(validationError),
          }, 'Bulk import rejeitado por agente fora do tenant');
          return res.status(403).json({ error: 'Agente invalido para o tenant autenticado.' });
        }
        if (body.namespaceId && agent?.namespaceId && agent.namespaceId !== body.namespaceId) {
          logger.warn({
            tenantId,
            agentId: body.agentId,
            namespaceId: body.namespaceId,
            agentNamespaceId: agent.namespaceId,
          }, 'Bulk import rejeitado por inconsistencia agentId/namespaceId');
          return res.status(403).json({ error: 'O agente informado nao pertence ao namespace selecionado.' });
        }
      }

      const importedIds: string[] = [];
      const duplicatesSkipped: number[] = [];
      const chunkSize = 100;

      for (let offset = 0; offset < body.data.length; offset += chunkSize) {
        const chunk = body.data.slice(offset, offset + chunkSize);
        const indexedChunk = chunk.map((entry, position) => ({
          entry,
          absoluteIndex: offset + position,
          semhash: deps.computeSemHash(entry.messages.map((message) => message.content).join(' ')),
        }));
        const semhashes = Array.from(new Set(indexedChunk.map((item) => item.semhash)));
        const existingRows = semhashes.length > 0
          ? await db.query.trainingData.findMany({
              where: and(
                eq(schema.trainingData.tenantId, tenantId),
                inArray(schema.trainingData.semhash, semhashes),
              ),
              columns: { semhash: true },
            })
          : [];
        const existingSemhashes = new Set(
          existingRows
            .map((row) => row.semhash)
            .filter((value): value is string => typeof value === 'string' && value.length > 0),
        );

        const enqueuePayloads: Array<{
          trainingDataId: string;
          namespaceId: string | null;
          agentId: string | null;
          semhash: string;
        }> = [];

        await db.transaction(async (tx) => {
          for (const item of indexedChunk) {
            if (existingSemhashes.has(item.semhash)) {
              duplicatesSkipped.push(item.absoluteIndex);
              continue;
            }

            const qualityAssessment = deps.evaluateTrainingQuality({
              sourceType: sourceTypeForImport,
              messages: item.entry.messages.map((message) => ({
                role: message.role,
                content: message.content,
              })),
              sourceMetadata: {
                bulkSource: body.source,
                bulkSourceType: sourceTypeForImport,
              },
            });
            const qualityScore = qualityAssessment.score;
            const scope = await deps.resolveScope({
              tenantId,
              namespaceId: body.namespaceId ?? null,
              agentId: body.agentId ?? null,
              domain: body.domain ?? null,
              sourceType: sourceTypeForImport,
              sourceMetadata: {
                bulkSource: body.source,
                bulkSourceType: sourceTypeForImport,
              },
              messagesText: item.entry.messages.map((message) => message.content).join('\n'),
            });
            deps.observeScopeConfidence(scope.confidence);
            if (scope.needsHumanReview) {
              deps.incrementScopeQuarantineTotal({
                sourceType: sourceTypeForImport,
                reason: 'low_confidence_or_missing_namespace',
              });
            }
            if (scope.suggestedNewNamespace) {
              deps.incrementScopeSuggestedNewNamespaceTotal({
                sourceType: sourceTypeForImport,
              });
            }

            const defaultPurpose = sourceTypeForImport === 'rag_document' || sourceTypeForImport === 'rag_media'
              ? 'knowledge_rag'
              : 'behavior_sft';
            const autoRejectedByQuality = qualityScore < trainingDataMinQuality;
            const status = autoRejectedByQuality
              ? 'rejected'
              : (autoApprove && (item.entry.rating || 0) >= 4 ? 'approved' : 'pending');
            const reviewNotesParts = [
              autoRejectedByQuality
                ? `Auto-rejeitado: qualidade ${qualityScore.toFixed(2)} abaixo do minimo (${trainingDataMinQuality}).`
                : null,
              defaultPurpose === 'knowledge_rag' ? 'knowledge_rag_default' : null,
              qualityAssessment.rejectionReasons.length > 0
                ? `quality_reasons:${qualityAssessment.rejectionReasons.join(',')}`
                : null,
            ].filter((value): value is string => Boolean(value));

            const [inserted] = await tx.insert(schema.trainingData).values({
              tenantId,
              namespaceId: scope.namespaceId,
              agentId: scope.agentId,
              source: `bulk_import:${body.source}`,
              sourceType: sourceTypeForImport,
              sourceMetadata: {
                bulkSource: body.source,
                bulkSourceType: sourceTypeForImport,
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
              profileVersion: 1,
              needsHumanReview: scope.needsHumanReview || defaultPurpose === 'knowledge_rag',
              quarantineReason: scope.needsHumanReview
                ? 'low_confidence_or_missing_namespace'
                : (defaultPurpose === 'knowledge_rag' ? 'knowledge_rag_default' : null),
              scopeResolvedAt: new Date(),
              quarantinedAt: scope.needsHumanReview || defaultPurpose === 'knowledge_rag' ? new Date() : null,
              messages: item.entry.messages,
              rating: item.entry.rating,
              qualityScore,
              status,
              purpose: status === 'rejected' ? 'rejected' : defaultPurpose,
              reviewNotes: reviewNotesParts.length > 0 ? reviewNotesParts.join(' | ') : null,
              semhash: item.semhash,
              embedding: null,
              isDuplicate: false,
            }).returning({ id: schema.trainingData.id });

            importedIds.push(inserted.id);
            existingSemhashes.add(item.semhash);

            if (status !== 'rejected') {
              enqueuePayloads.push({
                trainingDataId: inserted.id,
                namespaceId: scope.namespaceId ?? null,
                agentId: scope.agentId ?? null,
                semhash: item.semhash,
              });
            }
          }
        });

        for (const payload of enqueuePayloads) {
          const idempotencyKey = deps.buildTrainingIdempotencyKey({
            tenantId,
            sourceType: sourceTypeForImport,
            sourceId: null,
            semhash: payload.semhash,
          });
          const queuePayload = deps.parseTrainingEmbeddingDedupeQueuePayload({
            trainingDataId: payload.trainingDataId,
            tenantId,
            namespaceId: payload.namespaceId ?? undefined,
            agentId: payload.agentId ?? undefined,
            semhash: payload.semhash,
            sourceType: sourceTypeForImport,
            sourceId: undefined,
            idempotencyKey,
            createdAt: new Date().toISOString(),
          });
          try {
            await deps.enqueueTrainingEmbeddingDedupeJob(queuePayload);
          } catch (queueError) {
            logger.warn({
              trainingDataId: payload.trainingDataId,
              error: queueError instanceof Error ? queueError.message : String(queueError),
            }, 'Falha ao enfileirar job de dedupe/embedding no bulk import');
          }
        }
      }

      logger.info({
        tenantId,
        source: body.source,
        sourceType: sourceTypeForImport,
        namespaceId: body.namespaceId ?? null,
        agentId: body.agentId ?? null,
        totalReceived: body.data.length,
        imported: importedIds.length,
        duplicatesSkipped: duplicatesSkipped.length,
        autoApprove,
      }, 'Bulk import concluido');

      return res.status(201).json({
        success: true,
        imported: importedIds.length,
        duplicatesSkipped: duplicatesSkipped.length,
        sourceType: sourceTypeForImport,
        ids: importedIds,
      });
    } catch (error) {
      logger.error({ error }, 'Falha no bulk import');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  logger.info('Training bulk import routes registered');
}
