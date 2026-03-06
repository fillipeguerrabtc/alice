import type { Database } from '@alice/database';
import { and, desc, eq, inArray, ne, schema, sql, toSql } from '@alice/database';
import { NamespaceProfileConfigSchema } from '@alice/shared';
import {
  getRedisClient,
  RedisStreamQueue,
  TRAINING_DATA_POLICY_GATE_QUEUE,
  TRAINING_EMBEDDING_DEDUPE_QUEUE,
  buildTrainingPolicyGateIdempotencyKey,
  trainingEmbeddingDedupeQueuePayloadSchema,
  trainingDataPolicyGateQueuePayloadSchema,
} from '@alice/shared-utils';
import { z } from 'zod';

type WorkerResultLabel = 'success' | 'skipped' | 'missing' | 'idempotency_skip' | 'error';
type DedupeMethodLabel = 'semhash' | 'knn' | 'none';

interface CounterLike<TLabels extends Record<string, string>> {
  inc(labels: TLabels): void;
}

interface HistogramLike {
  startTimer(): () => void;
}

interface WorkerLogger {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
}

interface TrainingEmbeddingDedupeWorkerMetrics {
  jobsTotal: CounterLike<{ result: WorkerResultLabel }>;
  dedupeHitsTotal: CounterLike<{ method: DedupeMethodLabel }>;
  durationSeconds: HistogramLike;
}

interface CreateTrainingEmbeddingDedupeWorkerParams {
  db: Database;
  logger: WorkerLogger;
  metrics: TrainingEmbeddingDedupeWorkerMetrics;
  pollIntervalMs: number;
  similarityThreshold: number;
  generateEmbedding: (text: string) => Promise<number[]>;
}

const TRAINING_DATA_ACTIVE_STATUSES = ['pending', 'approved', 'reserved', 'used'] as const;
const PROCESSING_LOCK_TTL_SECONDS = 600;
const QUEUE_STREAM_MAX_LEN = 20_000;
type EmbeddingColumnType = 'halfvec' | 'vector';

const trainingDataMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
});
const trainingDataMessagesSchema = z.array(trainingDataMessageSchema).min(1);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractMessagesText(messages: unknown): string {
  const parsed = trainingDataMessagesSchema.safeParse(messages);
  if (!parsed.success) {
    throw new Error('training_data.messages inválido para geração de embedding');
  }
  return parsed.data.map((entry) => entry.content).join('\n');
}

function parseSimilarity(raw: unknown): number | null {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

async function queryNearestNeighborByCosine(
  db: Database,
  payload: { tenantId: string; trainingDataId: string; namespaceId?: string | null },
  embeddingVectorSql: string
): Promise<{ id?: unknown; similarity?: unknown } | undefined> {
  const namespaceCondition = payload.namespaceId
    ? sql`AND namespace_id = ${payload.namespaceId}::uuid`
    : sql``;
  try {
    const halfvecResult = await db.execute(sql`
      SELECT id, 1 - (embedding <=> ${embeddingVectorSql}::halfvec) AS similarity
      FROM training_data
      WHERE tenant_id = ${payload.tenantId}::uuid
        AND id <> ${payload.trainingDataId}::uuid
        AND status IN ('pending', 'approved', 'used')
        AND embedding IS NOT NULL
        ${namespaceCondition}
      ORDER BY embedding <=> ${embeddingVectorSql}::halfvec
      LIMIT 1
    `);
    return halfvecResult.rows[0] as { id?: unknown; similarity?: unknown } | undefined;
  } catch {
    const vectorResult = await db.execute(sql`
      SELECT id, 1 - (embedding <=> ${embeddingVectorSql}::vector) AS similarity
      FROM training_data
      WHERE tenant_id = ${payload.tenantId}::uuid
        AND id <> ${payload.trainingDataId}::uuid
        AND status IN ('pending', 'approved', 'used')
        AND embedding IS NOT NULL
        ${namespaceCondition}
      ORDER BY embedding <=> ${embeddingVectorSql}::vector
      LIMIT 1
    `);
    return vectorResult.rows[0] as { id?: unknown; similarity?: unknown } | undefined;
  }
}

let cachedTrainingEmbeddingColumnType: EmbeddingColumnType | null = null;

async function resolveTrainingEmbeddingColumnType(db: Database): Promise<EmbeddingColumnType> {
  if (cachedTrainingEmbeddingColumnType) {
    return cachedTrainingEmbeddingColumnType;
  }

  const result = await db.execute(sql`
    SELECT format_type(a.atttypid, a.atttypmod) AS embedding_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'training_data'
      AND a.attname = 'embedding'
      AND a.attnum > 0
      AND NOT a.attisdropped
    LIMIT 1
  `);

  const embeddingTypeRaw = result.rows[0]?.embedding_type;
  if (typeof embeddingTypeRaw !== 'string') {
    throw new Error('Coluna training_data.embedding não encontrada no PostgreSQL');
  }

  if (embeddingTypeRaw.startsWith('halfvec')) {
    cachedTrainingEmbeddingColumnType = 'halfvec';
    return cachedTrainingEmbeddingColumnType;
  }

  if (embeddingTypeRaw.startsWith('vector')) {
    cachedTrainingEmbeddingColumnType = 'vector';
    return cachedTrainingEmbeddingColumnType;
  }

  throw new Error(`Tipo não suportado para training_data.embedding: ${embeddingTypeRaw}`);
}

export function createTrainingEmbeddingDedupeWorker(
  params: CreateTrainingEmbeddingDedupeWorkerParams
): () => Promise<void> {
  const queue = new RedisStreamQueue(TRAINING_EMBEDDING_DEDUPE_QUEUE, {
    group: 'training-service',
    consumer: `training-embedding-${process.pid}`,
    maxRetries: 3,
    autoClaimCount: 10,
    streamMaxLen: QUEUE_STREAM_MAX_LEN,
  });
  const policyGateQueue = new RedisStreamQueue(TRAINING_DATA_POLICY_GATE_QUEUE, {
    group: 'training-service',
    consumer: `training-policy-gate-enqueue-${process.pid}`,
    maxRetries: 3,
    autoClaimCount: 10,
    streamMaxLen: QUEUE_STREAM_MAX_LEN,
  });

  let stopped = false;
  const stopToken = { isStopped: () => stopped };

  const runLoop = async () => {
    const redis = getRedisClient();
    if (!redis) {
      params.logger.warn(
        { queue: TRAINING_EMBEDDING_DEDUPE_QUEUE },
        'Redis indisponível para worker de dedupe/embedding'
      );
      return;
    }

    await queue.consumeLoop(
      redis,
      async (rawPayload) => {
        const timer = params.metrics.durationSeconds.startTimer();
        const payload = trainingEmbeddingDedupeQueuePayloadSchema.parse(rawPayload);
        const lockKey = `${TRAINING_EMBEDDING_DEDUPE_QUEUE}:processing:${payload.idempotencyKey}`;
        const lock = await redis.set(lockKey, payload.trainingDataId, {
          NX: true,
          EX: PROCESSING_LOCK_TTL_SECONDS,
        });

        if (!lock) {
          params.metrics.jobsTotal.inc({ result: 'idempotency_skip' });
          params.logger.info(
            {
              trainingDataId: payload.trainingDataId,
              idempotencyKey: payload.idempotencyKey,
            },
            'Job duplicado ignorado por lock de idempotência'
          );
          timer();
          return;
        }

        try {
          const current = await params.db.query.trainingData.findFirst({
            where: and(
              eq(schema.trainingData.id, payload.trainingDataId),
              eq(schema.trainingData.tenantId, payload.tenantId)
            ),
            columns: {
              id: true,
              tenantId: true,
              status: true,
              embedding: true,
              messages: true,
              processedAt: true,
            },
          });

          if (!current) {
            params.metrics.jobsTotal.inc({ result: 'missing' });
            params.logger.warn(
              {
                trainingDataId: payload.trainingDataId,
                tenantId: payload.tenantId,
              },
              'training_data não encontrado para processamento de dedupe/embedding'
            );
            return;
          }

          if (current.embedding && current.processedAt) {
            params.metrics.jobsTotal.inc({ result: 'skipped' });
            params.logger.info(
              { trainingDataId: current.id },
              'training_data já processado anteriormente; encerrando job'
            );
            return;
          }

          if (current.status === 'rejected') {
            params.metrics.jobsTotal.inc({ result: 'skipped' });
            params.logger.info(
              { trainingDataId: current.id },
              'training_data rejeitado; processamento de dedupe/embedding ignorado'
            );
            return;
          }

          const messagesText = extractMessagesText(current.messages);
          const embedding = await params.generateEmbedding(messagesText);

          let dedupeScope: 'tenant' | 'namespace' = 'tenant';
          let effectiveSimilarityThreshold = params.similarityThreshold;
          let dedupeNamespaceId: string | null = null;
          if (payload.namespaceId) {
            const namespaceProfile = await params.db.query.namespaceProfiles.findFirst({
              where: and(
                eq(schema.namespaceProfiles.tenantId, payload.tenantId),
                eq(schema.namespaceProfiles.namespaceId, payload.namespaceId)
              ),
            });
            if (namespaceProfile) {
              const parsedConfig = NamespaceProfileConfigSchema.parse(namespaceProfile.config);
              dedupeScope = parsedConfig.dedupe.scope;
              effectiveSimilarityThreshold = parsedConfig.dedupe.similarityThreshold;
            }
            if (dedupeScope === 'namespace') {
              dedupeNamespaceId = payload.namespaceId;
            }
          }

          const exactDuplicateConditions = [
            eq(schema.trainingData.tenantId, payload.tenantId),
            eq(schema.trainingData.semhash, payload.semhash),
            ne(schema.trainingData.id, payload.trainingDataId),
            inArray(schema.trainingData.status, TRAINING_DATA_ACTIVE_STATUSES),
          ];
          if (dedupeNamespaceId) {
            exactDuplicateConditions.push(eq(schema.trainingData.namespaceId, dedupeNamespaceId));
          }
          const exactDuplicate = await params.db.query.trainingData.findFirst({
            where: and(...exactDuplicateConditions),
            columns: { id: true },
            orderBy: [desc(schema.trainingData.criadoEm)],
          });

          let isDuplicate = false;
          let duplicateOfId: string | null = null;
          let similarityScore: number | null = null;
          let dedupeMethod: DedupeMethodLabel = 'none';

          if (exactDuplicate) {
            isDuplicate = true;
            duplicateOfId = exactDuplicate.id;
            similarityScore = 1;
            dedupeMethod = 'semhash';
          } else {
            const embeddingVectorSql = toSql(embedding);
            const nearest = await queryNearestNeighborByCosine(
              params.db,
              { tenantId: payload.tenantId, trainingDataId: payload.trainingDataId, namespaceId: dedupeNamespaceId },
              embeddingVectorSql
            );
            const nearestSimilarity = parseSimilarity(nearest?.similarity);
            if (nearest && typeof nearest.id === 'string' && nearestSimilarity !== null && nearestSimilarity >= effectiveSimilarityThreshold) {
              isDuplicate = true;
              duplicateOfId = nearest.id;
              similarityScore = nearestSimilarity;
              dedupeMethod = 'knn';
            }
          }

          const processedAt = new Date();
          const embeddingColumnType = await resolveTrainingEmbeddingColumnType(params.db);
          const embeddingVectorSql = toSql(embedding);
          const embeddingValueSql = embeddingColumnType === 'halfvec'
            ? sql`${embeddingVectorSql}::halfvec`
            : sql`${embeddingVectorSql}::vector`;

          await params.db.execute(sql`
            UPDATE training_data
            SET
              embedding = ${embeddingValueSql},
              is_duplicate = ${isDuplicate},
              duplicate_of_id = ${duplicateOfId},
              similarity_score = ${similarityScore},
              processed_at = ${processedAt},
              processado_em = ${processedAt}
            WHERE id = ${payload.trainingDataId}::uuid
              AND tenant_id = ${payload.tenantId}::uuid
          `);

          params.metrics.dedupeHitsTotal.inc({ method: dedupeMethod });
          params.metrics.jobsTotal.inc({ result: 'success' });
          const policyPayload = trainingDataPolicyGateQueuePayloadSchema.parse({
            trainingDataId: payload.trainingDataId,
            tenantId: payload.tenantId,
            namespaceId: payload.namespaceId,
            userId: undefined,
            semhash: payload.semhash,
            idempotencyKey: buildTrainingPolicyGateIdempotencyKey({
              tenantId: payload.tenantId,
              trainingDataId: payload.trainingDataId,
              semhash: payload.semhash,
            }),
            createdAt: new Date().toISOString(),
          });
          await policyGateQueue.enqueue(redis, policyPayload, policyPayload.idempotencyKey);
          params.logger.info(
            {
              trainingDataId: payload.trainingDataId,
              dedupeMethod,
              isDuplicate,
              duplicateOfId,
              similarityScore,
              dedupeScope,
              similarityThreshold: effectiveSimilarityThreshold,
            },
            'Job de embedding/dedupe processado com sucesso'
          );
        } catch (error) {
          params.metrics.jobsTotal.inc({ result: 'error' });
          params.logger.error(
            {
              trainingDataId: payload.trainingDataId,
              error: error instanceof Error ? error.message : String(error),
            },
            'Falha ao processar job de embedding/dedupe'
          );
          throw error;
        } finally {
          timer();
          await redis.del(lockKey).catch((lockError) => {
            params.logger.warn(
              {
                trainingDataId: payload.trainingDataId,
                error: lockError instanceof Error ? lockError.message : String(lockError),
              },
              'Falha ao liberar lock de idempotência do worker de dedupe/embedding'
            );
          });
        }
      },
      {
        stopToken,
        idleSleepMs: params.pollIntervalMs,
      }
    );
  };

  void (async () => {
    while (!stopped) {
      try {
        await runLoop();
      } catch (error) {
        params.logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'Loop do worker de dedupe/embedding falhou; retomando'
        );
        await sleep(params.pollIntervalMs);
      }
    }
  })();

  return async () => {
    stopped = true;
    queue.requestStop();
    await sleep(params.pollIntervalMs + 50);
  };
}
