/**
 * Document Processing Worker - Alice Enterprise Platform
 *
 * Asynchronous worker for RAG document processing:
 * - tenant validation via namespace ownership
 * - enterprise chunking with overlap and max chunks
 * - batch embeddings via GPU Manager
 * - PostgreSQL + Qdrant consistency flow
 * - retry/backoff with idempotent behavior
 *
 * Author: Fillipe Guerra
 * Data: 28 de Fevereiro de 2026
 */

import { createLogger } from '@alice/logger';
import { schema, eq, type Database, validateEmbeddingDimension, EMBEDDING_DIMENSIONS } from '@alice/database';
import {
  requestGpu,
  GpuServiceType,
  GpuRequestPriority,
  isQdrantConfigured,
  deletePointsByFilter,
  upsertPoints,
  TEXT_COLLECTION_NAME,
} from '@alice/shared-utils';
import {
  dequeueDocumentProcessingJob,
  completeDocumentProcessingJob,
  failDocumentProcessingJob,
  requeueDocumentProcessingJob,
  getDocumentProcessingQueueSize,
  type DocumentProcessingJob,
} from '../document-processing-queue.js';

const logger = createLogger('document-processing-worker');

const EMBEDDING_TIMEOUT_MS = 60_000;
const EMBEDDING_BATCH_SIZE = 32;
const MAX_RETRY_BACKOFF_MS = 60_000;

type DocumentProcessingStatus = 'pending' | 'processing' | 'failed' | 'completed';

interface DocumentProcessingWorkerConfig {
  db: Database;
  maxAttempts: number;
  chunkSizeChars: number;
  overlapChars: number;
  maxChunks: number;
  idleMinMs?: number;
  idleMaxMs?: number;
  invalidateRagCacheForTenant: (tenantId: string) => Promise<void>;
}

interface WorkerConfigResolved extends DocumentProcessingWorkerConfig {
  idleMinMs: number;
  idleMaxMs: number;
}

interface ChunkingResult {
  chunks: string[];
  truncated: boolean;
}

interface EmbeddingBatchResponse {
  embeddings?: number[][];
  embedding?: number[];
  model?: string;
  dimension?: number;
  dimensions?: number;
}

let running = false;
let processedCount = 0;
let failedCount = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, 500);
}

function computeRetryBackoffMs(attempt: number): number {
  const safeAttempt = Math.max(1, attempt);
  const raw = 2_000 * 2 ** (safeAttempt - 1);
  return Math.min(raw, MAX_RETRY_BACKOFF_MS);
}

function toMetadataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function mergeMetadata(
  current: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...toMetadataObject(current),
    ...patch,
  };
}

function splitTextIntoChunks(
  text: string,
  chunkSizeChars: number,
  overlapChars: number,
  maxChunks: number
): ChunkingResult {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return { chunks: [], truncated: false };
  }

  const chunks: string[] = [];
  const safeChunkSize = Math.max(50, chunkSizeChars);
  const safeOverlap = Math.max(0, Math.min(overlapChars, safeChunkSize - 1));
  let start = 0;

  while (start < normalized.length && chunks.length < maxChunks) {
    let end = Math.min(start + safeChunkSize, normalized.length);
    if (end < normalized.length) {
      const breakAt = normalized.lastIndexOf(' ', end);
      if (breakAt > start + Math.floor(safeChunkSize * 0.75)) {
        end = breakAt;
      }
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    if (end >= normalized.length) {
      break;
    }

    const nextStart = Math.max(start + 1, end - safeOverlap);
    if (nextStart <= start) {
      break;
    }
    start = nextStart;
  }

  const truncated = start < normalized.length && chunks.length >= maxChunks;
  return { chunks, truncated };
}

async function generateEmbeddingsInBatches(chunks: string[]): Promise<{ embeddings: number[][]; model: string }> {
  const allEmbeddings: number[][] = [];
  let resolvedModel = 'Qwen/Qwen3-Embedding-0.6B';

  for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
    const gpuResponse = await requestGpu({
      serviceType: GpuServiceType.EMBEDDINGS,
      endpoint: '/embed/batch',
      method: 'POST',
      priority: GpuRequestPriority.MEDIUM,
      timeout: EMBEDDING_TIMEOUT_MS,
      body: { texts: batch },
    });

    if (!gpuResponse.success || !gpuResponse.data) {
      throw new Error(gpuResponse.error || 'Falha ao gerar embeddings em batch');
    }

    const data = gpuResponse.data as EmbeddingBatchResponse;
    const batchEmbeddings = data.embeddings ?? (data.embedding ? [data.embedding] : []);
    if (batchEmbeddings.length !== batch.length) {
      throw new Error(
        `Quantidade de embeddings inesperada no batch (${batchEmbeddings.length}/${batch.length})`
      );
    }

    for (const embedding of batchEmbeddings) {
      validateEmbeddingDimension(embedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');
      allEmbeddings.push(embedding);
    }

    if (data.model) {
      resolvedModel = data.model;
    }
  }

  if (allEmbeddings.length !== chunks.length) {
    throw new Error(`Quantidade total de embeddings invalida (${allEmbeddings.length}/${chunks.length})`);
  }

  return { embeddings: allEmbeddings, model: resolvedModel };
}

async function processJob(job: DocumentProcessingJob, config: WorkerConfigResolved): Promise<void> {
  let shouldRetry = false;
  let retryBackoffMs = 0;
  let loadedDocumentMetadata: unknown = {};

  logger.info({
    jobId: job.jobId,
    tenantId: job.tenantId,
    documentId: job.documentId,
    namespaceId: job.namespaceId,
    correlationId: job.correlationId,
    attempt: job.attempts,
  }, 'Iniciando processamento de documento');

  try {
    const document = await config.db.query.documents.findFirst({
      where: eq(schema.documents.id, job.documentId),
      with: { namespace: true },
    });

    if (!document) {
      throw new Error('Documento nao encontrado');
    }
    if (!document.namespace || document.namespace.tenantId !== job.tenantId) {
      throw new Error('Documento nao pertence ao tenant informado');
    }

    loadedDocumentMetadata = document.metadata;

    const existingChunks = await config.db.query.documentChunks.findMany({
      where: eq(schema.documentChunks.documentId, document.id),
      columns: { id: true },
      limit: 1,
    });

    if (document.processado && existingChunks.length > 0) {
      await completeDocumentProcessingJob(job.jobId);
      logger.info({
        jobId: job.jobId,
        documentId: job.documentId,
        tenantId: job.tenantId,
        correlationId: job.correlationId,
      }, 'Documento ja processado; finalizando job de forma idempotente');
      return;
    }

    const processingMetadata = mergeMetadata(document.metadata, {
      processingStatus: 'processing' as DocumentProcessingStatus,
      processingStartedAt: new Date().toISOString(),
      processingError: null,
    });
    await config.db
      .update(schema.documents)
      .set({
        processado: false,
        metadata: processingMetadata,
        atualizadoEm: new Date(),
      })
      .where(eq(schema.documents.id, document.id));

    const chunking = splitTextIntoChunks(
      document.conteudo ?? '',
      config.chunkSizeChars,
      config.overlapChars,
      config.maxChunks
    );

    if (chunking.chunks.length === 0) {
      throw new Error('Documento sem conteudo valido para chunking');
    }

    if (chunking.truncated) {
      logger.warn({
        jobId: job.jobId,
        documentId: document.id,
        chunksGenerated: chunking.chunks.length,
        maxChunks: config.maxChunks,
        correlationId: job.correlationId,
      }, 'Documento truncado por limite maximo de chunks');
    }

    const embeddingResult = await generateEmbeddingsInBatches(chunking.chunks);

    const insertedChunks = await config.db.transaction(async (tx) => {
      await tx.delete(schema.documentChunks).where(eq(schema.documentChunks.documentId, document.id));

      return tx
        .insert(schema.documentChunks)
        .values(
          chunking.chunks.map((chunkContent, index) => ({
            documentId: document.id,
            conteudo: chunkContent,
            posicao: index,
          }))
        )
        .returning({
          id: schema.documentChunks.id,
          conteudo: schema.documentChunks.conteudo,
          posicao: schema.documentChunks.posicao,
        });
    });

    if (!isQdrantConfigured()) {
      throw new Error('Qdrant nao configurado para processamento de documentos');
    }

    await deletePointsByFilter(TEXT_COLLECTION_NAME, {
      must: [
        { key: 'tenantId', match: { value: job.tenantId } },
        { key: 'documentId', match: { value: document.id } },
        { key: 'type', match: { value: 'document_chunk' } },
      ],
    });

    const nowIso = new Date().toISOString();
    await upsertPoints(
      TEXT_COLLECTION_NAME,
      insertedChunks.map((chunk, index) => ({
        id: chunk.id,
        vector: embeddingResult.embeddings[index],
        payload: {
          type: 'document_chunk',
          tenantId: job.tenantId,
          namespaceId: document.namespaceId,
          documentId: document.id,
          conteudo: chunk.conteudo,
          posicao: chunk.posicao,
          document_titulo: document.titulo,
          createdAt: nowIso,
          document_id: document.id,
          document_namespaceId: document.namespaceId,
          criadoEm: nowIso,
        },
      }))
    );

    const completedMetadata = mergeMetadata(processingMetadata, {
      processingStatus: 'completed' as DocumentProcessingStatus,
      processingError: null,
      processedAt: new Date().toISOString(),
      chunksCount: insertedChunks.length,
      embeddingModel: embeddingResult.model,
    });
    await config.db
      .update(schema.documents)
      .set({
        processado: true,
        metadata: completedMetadata,
        atualizadoEm: new Date(),
      })
      .where(eq(schema.documents.id, document.id));

    await completeDocumentProcessingJob(job.jobId);
    processedCount += 1;

    logger.info({
      jobId: job.jobId,
      tenantId: job.tenantId,
      documentId: document.id,
      namespaceId: document.namespaceId,
      chunksCount: insertedChunks.length,
      embeddingModel: embeddingResult.model,
      correlationId: job.correlationId,
      attempt: job.attempts,
    }, 'Documento processado com sucesso');
  } catch (error) {
    failedCount += 1;
    const errorMessage = sanitizeError(error);
    const shouldPersistFailure = job.documentId.length > 0;

    if (shouldPersistFailure) {
      try {
        const latestDocument = await config.db.query.documents.findFirst({
          where: eq(schema.documents.id, job.documentId),
          columns: { metadata: true, id: true },
        });
        if (latestDocument) {
          const failedMetadata = mergeMetadata(latestDocument.metadata ?? loadedDocumentMetadata, {
            processingStatus: 'failed' as DocumentProcessingStatus,
            processingError: errorMessage,
          });
          await config.db
            .update(schema.documents)
            .set({
              processado: false,
              metadata: failedMetadata,
              atualizadoEm: new Date(),
            })
            .where(eq(schema.documents.id, latestDocument.id));
        }
      } catch (metadataError) {
        logger.error({
          jobId: job.jobId,
          documentId: job.documentId,
          tenantId: job.tenantId,
          correlationId: job.correlationId,
          error: sanitizeError(metadataError),
        }, 'Falha ao persistir metadata de erro do documento');
      }
    }

    await failDocumentProcessingJob(job.jobId, errorMessage);

    if (job.attempts < config.maxAttempts) {
      shouldRetry = true;
      retryBackoffMs = computeRetryBackoffMs(job.attempts);
      await requeueDocumentProcessingJob(job.jobId, {
        delayMs: retryBackoffMs,
        clearError: false,
      });
    }

    logger.error({
      jobId: job.jobId,
      tenantId: job.tenantId,
      documentId: job.documentId,
      namespaceId: job.namespaceId,
      correlationId: job.correlationId,
      attempt: job.attempts,
      maxAttempts: config.maxAttempts,
      shouldRetry,
      retryBackoffMs: shouldRetry ? retryBackoffMs : 0,
      error: errorMessage,
    }, 'Falha no processamento de documento');
  } finally {
    try {
      await config.invalidateRagCacheForTenant(job.tenantId);
    } catch (error) {
      logger.warn({
        tenantId: job.tenantId,
        jobId: job.jobId,
        correlationId: job.correlationId,
        error: sanitizeError(error),
      }, 'Falha ao invalidar cache RAG do tenant (nao bloqueante)');
    }
  }
}

async function workerLoop(config: WorkerConfigResolved): Promise<void> {
  let idleDelay = config.idleMinMs;

  while (running) {
    try {
      const job = await dequeueDocumentProcessingJob();
      if (!job) {
        await sleep(idleDelay);
        idleDelay = Math.min(config.idleMaxMs, idleDelay * 2);
        continue;
      }

      idleDelay = config.idleMinMs;
      await processJob(job, config);
    } catch (error) {
      logger.error({ error: sanitizeError(error) }, 'Erro no loop do document-processing-worker');
      await sleep(config.idleMinMs);
    }
  }
}

function resolveConfig(config: DocumentProcessingWorkerConfig): WorkerConfigResolved {
  return {
    ...config,
    idleMinMs: Math.max(200, config.idleMinMs ?? 1_000),
    idleMaxMs: Math.max(1_000, config.idleMaxMs ?? 10_000),
  };
}

export function startDocumentProcessingWorker(config: DocumentProcessingWorkerConfig): void {
  if (running) {
    logger.warn('Document processing worker ja esta rodando');
    return;
  }

  const resolved = resolveConfig(config);
  running = true;

  logger.info({
    maxAttempts: resolved.maxAttempts,
    chunkSizeChars: resolved.chunkSizeChars,
    overlapChars: resolved.overlapChars,
    maxChunks: resolved.maxChunks,
    idleMinMs: resolved.idleMinMs,
    idleMaxMs: resolved.idleMaxMs,
  }, 'Document processing worker iniciado');

  workerLoop(resolved).catch((error) => {
    running = false;
    logger.error({ error: sanitizeError(error) }, 'Document processing worker encerrado por erro');
  });
}

export function stopDocumentProcessingWorker(): void {
  running = false;
  logger.info({ processedCount, failedCount }, 'Document processing worker parado');
}

export interface DocumentProcessingWorkerStatus {
  running: boolean;
  processedCount: number;
  failedCount: number;
  queueSize: number;
}

export async function getDocumentProcessingWorkerStatus(): Promise<DocumentProcessingWorkerStatus> {
  return {
    running,
    processedCount,
    failedCount,
    queueSize: await getDocumentProcessingQueueSize(),
  };
}
