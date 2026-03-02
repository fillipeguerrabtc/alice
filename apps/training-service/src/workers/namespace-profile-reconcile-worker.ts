import type { Database } from '@alice/database';
import { and, eq, isNotNull, isNull, schema } from '@alice/database';
import { getSystemConfig } from '@alice/database/system-config';
import { NamespaceProfileConfigSchema } from '@alice/shared';
import {
  getRedisClient,
  RedisStreamQueue,
  TRAINING_NAMESPACE_PROFILE_RECONCILE_QUEUE,
  trainingNamespaceProfileReconcileQueuePayloadSchema,
} from '@alice/shared-utils';

type WorkerResultLabel = 'success' | 'idempotency_skip' | 'error';

interface CounterLike<TLabels extends Record<string, string>> {
  inc(labels: TLabels): void;
}

interface CounterPlainLike {
  inc(value?: number): void;
}

interface HistogramLike {
  startTimer(): () => void;
}

interface WorkerLogger {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
}

interface NamespaceProfileReconcileWorkerMetrics {
  jobsTotal: CounterLike<{ result: WorkerResultLabel }>;
  reconcileCreatedTotal: CounterPlainLike;
  reconcileMissingTotal: CounterPlainLike;
  durationSeconds: HistogramLike;
}

interface CreateNamespaceProfileReconcileWorkerParams {
  db: Database;
  logger: WorkerLogger;
  metrics: NamespaceProfileReconcileWorkerMetrics;
  pollIntervalMs: number;
}

const PROCESSING_LOCK_TTL_SECONDS = 600;
const QUEUE_STREAM_MAX_LEN = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadDefaultNamespaceProfileConfig() {
  const raw = await getSystemConfig('NAMESPACE_PROFILE_DEFAULT_CONFIG_JSON');
  if (!raw) {
    throw new Error('system_config NAMESPACE_PROFILE_DEFAULT_CONFIG_JSON ausente');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `JSON inválido em NAMESPACE_PROFILE_DEFAULT_CONFIG_JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return NamespaceProfileConfigSchema.parse(parsed);
}

export function createNamespaceProfileReconcileWorker(
  params: CreateNamespaceProfileReconcileWorkerParams
): () => Promise<void> {
  const queue = new RedisStreamQueue(TRAINING_NAMESPACE_PROFILE_RECONCILE_QUEUE, {
    group: 'training-service',
    consumer: `training-namespace-profile-reconcile-${process.pid}`,
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
        { queue: TRAINING_NAMESPACE_PROFILE_RECONCILE_QUEUE },
        'Redis indisponível para worker de reconciliação de namespace_profiles'
      );
      return;
    }

    await queue.consumeLoop(
      redis,
      async (rawPayload) => {
        const timer = params.metrics.durationSeconds.startTimer();
        const payload = trainingNamespaceProfileReconcileQueuePayloadSchema.parse(rawPayload);
        const lockKey = `${TRAINING_NAMESPACE_PROFILE_RECONCILE_QUEUE}:processing:${payload.idempotencyKey}`;
        const lock = await redis.set(lockKey, payload.runId, {
          NX: true,
          EX: PROCESSING_LOCK_TTL_SECONDS,
        });

        if (!lock) {
          params.metrics.jobsTotal.inc({ result: 'idempotency_skip' });
          params.logger.info(
            { runId: payload.runId, idempotencyKey: payload.idempotencyKey },
            'Reconciliação de namespace_profiles ignorada por lock de idempotência'
          );
          timer();
          return;
        }

        try {
          const defaultConfig = await loadDefaultNamespaceProfileConfig();

          const missing = await params.db
            .select({
              tenantId: schema.namespaces.tenantId,
              namespaceId: schema.namespaces.id,
            })
            .from(schema.namespaces)
            .leftJoin(
              schema.namespaceProfiles,
              and(
                eq(schema.namespaceProfiles.namespaceId, schema.namespaces.id),
                eq(schema.namespaceProfiles.tenantId, schema.namespaces.tenantId)
              )
            )
            .where(
              and(
                isNotNull(schema.namespaces.tenantId),
                isNull(schema.namespaceProfiles.id)
              )
            );

          const missingCount = missing.length;
          if (missingCount > 0) {
            params.metrics.reconcileMissingTotal.inc(missingCount);
          }

          if (missingCount === 0) {
            params.metrics.jobsTotal.inc({ result: 'success' });
            params.logger.info(
              { runId: payload.runId, missingCount: 0 },
              'Reconciliação concluída sem namespaces pendentes'
            );
            return;
          }

          const toInsert = missing
            .filter((item): item is { tenantId: string; namespaceId: string } => Boolean(item.tenantId))
            .map((item) => ({
              tenantId: item.tenantId,
              namespaceId: item.namespaceId,
              version: 1,
              isActive: true,
              autoCollectEnabled: true,
              config: defaultConfig,
            }));

          const inserted = await params.db
            .insert(schema.namespaceProfiles)
            .values(toInsert)
            .onConflictDoNothing()
            .returning({
              id: schema.namespaceProfiles.id,
              tenantId: schema.namespaceProfiles.tenantId,
              namespaceId: schema.namespaceProfiles.namespaceId,
              version: schema.namespaceProfiles.version,
            });

          const createdCount = inserted.length;
          if (createdCount > 0) {
            params.metrics.reconcileCreatedTotal.inc(createdCount);

            await params.db.insert(schema.trainingLineageEvents).values(
              inserted.map((entry) => ({
                tenantId: entry.tenantId,
                namespaceId: entry.namespaceId,
                eventType: 'namespace_profile.reconcile_created',
                sourceTable: 'namespaces',
                sourceId: entry.namespaceId,
                producedTable: 'namespace_profiles',
                producedId: entry.id,
                metadata: {
                  runId: payload.runId,
                  namespaceId: entry.namespaceId,
                  version: entry.version,
                },
              }))
            );
          }

          params.metrics.jobsTotal.inc({ result: 'success' });
          params.logger.info(
            {
              runId: payload.runId,
              missingCount,
              createdCount,
            },
            'Reconciliação de namespace_profiles concluída'
          );
        } catch (error) {
          params.metrics.jobsTotal.inc({ result: 'error' });
          params.logger.error(
            {
              runId: payload.runId,
              error: error instanceof Error ? error.message : String(error),
            },
            'Falha no worker de reconciliação de namespace_profiles'
          );
          throw error;
        } finally {
          timer();
          await redis.del(lockKey).catch((lockError) => {
            params.logger.warn(
              {
                runId: payload.runId,
                error: lockError instanceof Error ? lockError.message : String(lockError),
              },
              'Falha ao liberar lock do worker de reconciliação de namespace_profiles'
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
          'Loop do worker de reconciliação de namespace_profiles falhou; retomando'
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
