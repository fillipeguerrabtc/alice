/**
 * Document Processing Queue - Alice Enterprise Platform
 *
 * Redis queue for asynchronous document processing with:
 * - idempotency by documentId
 * - lease/lock on dequeue
 * - retry scheduling using sorted set score
 * - persisted job state sem TTL em estados ativos (queued/processing)
 * - retenção 24h apenas para estados terminais (completed/failed)
 *
 * Author: Fillipe Guerra
 * Data: 28 de Fevereiro de 2026
 */

import { createLogger } from '@alice/logger';
import { getRedisClient, isRedisAvailable } from '@alice/shared-utils';
import { randomUUID } from 'crypto';

const logger = createLogger('document-processing-queue');

const REDIS_PREFIX = 'alice:document-processing';
const QUEUE_KEY = `${REDIS_PREFIX}:queue`;
const JOBS_KEY = `${REDIS_PREFIX}:jobs`;
const DOCUMENT_JOB_INDEX_KEY = `${REDIS_PREFIX}:document-index`;
const LOCK_KEY_PREFIX = `${REDIS_PREFIX}:locks:`;

const JOB_STATE_TTL_SECONDS = 60 * 60 * 24; // 24 hours (somente estado terminal)
const JOB_LEASE_TTL_SECONDS = 60 * 5; // 5 minutes
const MAX_PRIORITY = 10;
const MIN_PRIORITY = 1;

export type DocumentProcessingJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface DocumentProcessingJobPayload {
  jobId: string;
  tenantId: string;
  documentId: string;
  namespaceId: string;
  priority: number;
  correlationId: string;
  attempts: number;
}

export interface DocumentProcessingJob extends DocumentProcessingJobPayload {
  status: DocumentProcessingJobStatus;
  queuedAt: string;
  processingStartedAt?: string;
  completedAt?: string;
  failedAt?: string;
  processingError?: string;
  updatedAt: string;
}

export type DocumentProcessingQueueMetricEvent = 'enqueued' | 'deduped';

let queueMetricObserver: ((event: DocumentProcessingQueueMetricEvent) => void) | null = null;

export function setDocumentProcessingQueueMetricObserver(
  observer: ((event: DocumentProcessingQueueMetricEvent) => void) | null
): void {
  queueMetricObserver = observer;
}

function normalizePriority(priority: number): number {
  const safe = Number.isFinite(priority) ? Math.trunc(priority) : MAX_PRIORITY;
  return Math.max(MIN_PRIORITY, Math.min(MAX_PRIORITY, safe));
}

function buildQueueScore(availableAtMs: number, priority: number): number {
  // First sort by scheduled timestamp, then by priority (1..10).
  return availableAtMs * 100 + normalizePriority(priority);
}

function getJobStateKey(jobId: string): string {
  return `${JOBS_KEY}:${jobId}`;
}

function getDocumentIndexKey(documentId: string): string {
  return `${DOCUMENT_JOB_INDEX_KEY}:${documentId}`;
}

function getLeaseKey(jobId: string): string {
  return `${LOCK_KEY_PREFIX}${jobId}`;
}

function parseJob(raw: string): DocumentProcessingJob | null {
  try {
    return JSON.parse(raw) as DocumentProcessingJob;
  } catch (error) {
    logger.error({ error, rawLength: raw.length }, 'Falha ao parsear estado do job de documento');
    return null;
  }
}

async function persistJobState(
  client: ReturnType<typeof getRedisClient>,
  job: DocumentProcessingJob
): Promise<void> {
  if (!client) {
    throw new Error('Redis nao disponivel');
  }
  const key = getJobStateKey(job.jobId);
  if (job.status === 'completed' || job.status === 'failed') {
    await client.setEx(key, JOB_STATE_TTL_SECONDS, JSON.stringify(job));
    return;
  }
  await client.set(key, JSON.stringify(job));
}

export interface EnqueueDocumentProcessingOptions {
  force?: boolean;
  delayMs?: number;
}

export async function enqueueDocumentProcessingJob(
  payload: DocumentProcessingJobPayload,
  options: EnqueueDocumentProcessingOptions = {}
): Promise<string> {
  const client = getRedisClient();
  if (!client) {
    throw new Error('Redis nao disponivel - document processing queue requer Redis');
  }

  const force = options.force === true;
  const delayMs = Math.max(0, options.delayMs ?? 0);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  if (!force) {
    const existingJobId = await client.get(getDocumentIndexKey(payload.documentId));
    if (existingJobId) {
      const existingJobRaw = await client.get(getJobStateKey(existingJobId));
      if (existingJobRaw) {
        const existingJob = parseJob(existingJobRaw);
        if (existingJob && (existingJob.status === 'queued' || existingJob.status === 'processing')) {
          queueMetricObserver?.('deduped');
          logger.info({
            existingJobId,
            documentId: payload.documentId,
            tenantId: payload.tenantId,
          }, 'Job de documento deduplicado por documentId');
          return existingJobId;
        }
      }
    }
  }

  const jobId = payload.jobId || randomUUID();
  const job: DocumentProcessingJob = {
    ...payload,
    jobId,
    priority: normalizePriority(payload.priority),
    attempts: Math.max(0, payload.attempts),
    status: 'queued',
    queuedAt: nowIso,
    updatedAt: nowIso,
  };

  await persistJobState(client, job);
  await client.set(getDocumentIndexKey(payload.documentId), jobId);
  await client.zAdd(QUEUE_KEY, {
    score: buildQueueScore(now + delayMs, job.priority),
    value: jobId,
  });
  queueMetricObserver?.('enqueued');

  logger.info({
    jobId,
    tenantId: payload.tenantId,
    documentId: payload.documentId,
    namespaceId: payload.namespaceId,
    delayMs,
    force,
  }, 'Job de processamento de documento enfileirado');

  return jobId;
}

export async function dequeueDocumentProcessingJob(): Promise<DocumentProcessingJob | null> {
  const client = getRedisClient();
  if (!client) {
    logger.warn('Redis nao disponivel para dequeue de documento');
    return null;
  }

  const nowScore = buildQueueScore(Date.now(), MAX_PRIORITY);
  const candidates = await client.zRangeByScore(QUEUE_KEY, 0, nowScore, {
    LIMIT: { offset: 0, count: 10 },
  });

  if (candidates.length === 0) {
    return null;
  }

  for (const jobId of candidates) {
    const removed = await client.zRem(QUEUE_KEY, jobId);
    if (removed === 0) {
      continue;
    }

    const raw = await client.get(getJobStateKey(jobId));
    if (!raw) {
      logger.warn({ jobId }, 'Estado do job nao encontrado apos claim do dequeue');
      continue;
    }

    const job = parseJob(raw);
    if (!job) {
      await client.del(getJobStateKey(jobId));
      continue;
    }

    const lock = await client.set(getLeaseKey(jobId), '1', {
      NX: true,
      EX: JOB_LEASE_TTL_SECONDS,
    });
    if (lock !== 'OK') {
      await client.zAdd(QUEUE_KEY, {
        score: buildQueueScore(Date.now() + 1000, job.priority),
        value: jobId,
      });
      logger.warn({ jobId }, 'Lease de job de documento ocupado; job reagendado');
      continue;
    }

    const updated: DocumentProcessingJob = {
      ...job,
      status: 'processing',
      attempts: job.attempts + 1,
      processingStartedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      processingError: undefined,
    };

    await persistJobState(client, updated);

    return updated;
  }

  return null;
}

async function updateJobState(
  jobId: string,
  mutator: (current: DocumentProcessingJob) => DocumentProcessingJob
): Promise<DocumentProcessingJob | null> {
  const client = getRedisClient();
  if (!client) {
    throw new Error('Redis nao disponivel');
  }

  const raw = await client.get(getJobStateKey(jobId));
  if (!raw) {
    return null;
  }

  const current = parseJob(raw);
  if (!current) {
    await client.del(getJobStateKey(jobId));
    return null;
  }

  const next = mutator(current);
  await persistJobState(client, next);
  return next;
}

export async function completeDocumentProcessingJob(jobId: string): Promise<void> {
  const client = getRedisClient();
  if (!client) {
    throw new Error('Redis nao disponivel');
  }

  await updateJobState(jobId, (current) => ({
    ...current,
    status: 'completed',
    completedAt: new Date().toISOString(),
    processingError: undefined,
    updatedAt: new Date().toISOString(),
  }));

  await client.del(getLeaseKey(jobId));
}

export async function failDocumentProcessingJob(jobId: string, errorMessage: string): Promise<void> {
  const client = getRedisClient();
  if (!client) {
    throw new Error('Redis nao disponivel');
  }

  await updateJobState(jobId, (current) => ({
    ...current,
    status: 'failed',
    failedAt: new Date().toISOString(),
    processingError: errorMessage,
    updatedAt: new Date().toISOString(),
  }));

  await client.del(getLeaseKey(jobId));
}

export async function requeueDocumentProcessingJob(
  jobId: string,
  options: { delayMs: number; clearError?: boolean }
): Promise<void> {
  const client = getRedisClient();
  if (!client) {
    throw new Error('Redis nao disponivel');
  }

  const updated = await updateJobState(jobId, (current) => ({
    ...current,
    status: 'queued',
    queuedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    processingError: options.clearError ? undefined : current.processingError,
  }));

  if (!updated) {
    throw new Error(`Job ${jobId} nao encontrado para requeue`);
  }

  await client.zAdd(QUEUE_KEY, {
    score: buildQueueScore(Date.now() + Math.max(0, options.delayMs), updated.priority),
    value: jobId,
  });
  await client.del(getLeaseKey(jobId));
}

export async function getDocumentProcessingJobState(jobId: string): Promise<DocumentProcessingJob | null> {
  const client = getRedisClient();
  if (!client) {
    return null;
  }
  const raw = await client.get(getJobStateKey(jobId));
  if (!raw) {
    return null;
  }
  return parseJob(raw);
}

export async function getDocumentProcessingJobIdForDocument(documentId: string): Promise<string | null> {
  const client = getRedisClient();
  if (!client) {
    return null;
  }

  const normalizedDocumentId = documentId.trim();
  if (!normalizedDocumentId) {
    return null;
  }

  const jobId = await client.get(getDocumentIndexKey(normalizedDocumentId));
  return typeof jobId === 'string' && jobId.trim().length > 0 ? jobId : null;
}

export async function getDocumentProcessingQueueSize(): Promise<number> {
  const client = getRedisClient();
  if (!client) {
    return 0;
  }
  return client.zCard(QUEUE_KEY);
}

export function isDocumentProcessingQueueAvailable(): boolean {
  return isRedisAvailable();
}
