import type { Database } from '@alice/database';
import { and, eq, schema } from '@alice/database';
import {
  getRedisClient,
  RedisStreamQueue,
  TRAINING_FINE_TUNING_QUEUE,
  TRAINING_FINE_TUNING_QUEUE_HIGH,
  TRAINING_FINE_TUNING_QUEUE_NORMAL,
  TRAINING_FINE_TUNING_QUEUE_LOW,
  trainingFineTuningQueuePayloadSchema,
} from '@alice/shared-utils';

type WorkerResultLabel =
  | 'success'
  | 'missing'
  | 'skipped_terminal'
  | 'idempotency_skip'
  | 'active_slot_busy'
  | 'error';

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

interface TrainingFineTuningWorkerMetrics {
  jobsTotal: CounterLike<{ result: WorkerResultLabel }>;
  durationSeconds: HistogramLike;
}

interface CreateTrainingFineTuningWorkerParams {
  db: Database;
  logger: WorkerLogger;
  metrics: TrainingFineTuningWorkerMetrics;
  pollIntervalMs: number;
  processJob?: (
    job: typeof schema.fineTuningJobs.$inferSelect,
    payload: ReturnType<typeof trainingFineTuningQueuePayloadSchema.parse>
  ) => Promise<void>;
}

const PROCESSING_LOCK_TTL_SECONDS = 900;
const ACTIVE_SLOT_LOCK_KEY = `${TRAINING_FINE_TUNING_QUEUE}:active-slot`;
const ACTIVE_SLOT_LOCK_TTL_SECONDS = 1800;
const ACTIVE_SLOT_LOCK_RENEW_INTERVAL_MS = 30_000;
const QUEUE_STREAM_MAX_LEN = 20_000;
const PRIORITY_SCAN_PATTERN = [0, 0, 1, 0, 1, 2] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshActiveSlotLock(
  redis: NonNullable<ReturnType<typeof getRedisClient>>,
  lockToken: string
): Promise<boolean> {
  const result = await redis.eval(
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) else return 0 end",
    { keys: [ACTIVE_SLOT_LOCK_KEY], arguments: [lockToken, String(ACTIVE_SLOT_LOCK_TTL_SECONDS)] }
  );
  return Number(result) === 1;
}

async function releaseActiveSlotLock(
  redis: NonNullable<ReturnType<typeof getRedisClient>>,
  lockToken: string
): Promise<void> {
  await redis.eval(
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
    { keys: [ACTIVE_SLOT_LOCK_KEY], arguments: [lockToken] }
  );
}

export function buildPriorityQueueScanOrder<T>(queues: T[], cycleIndex: number): T[] {
  if (queues.length <= 1) return queues;
  const normalizedCycle = Number.isFinite(cycleIndex) && cycleIndex >= 0
    ? Math.floor(cycleIndex)
    : 0;
  const primaryIndex = PRIORITY_SCAN_PATTERN[normalizedCycle % PRIORITY_SCAN_PATTERN.length] ?? 0;
  const boundedPrimary = Math.max(0, Math.min(primaryIndex, queues.length - 1));
  const primaryQueue = queues[boundedPrimary];
  const remainder = queues.filter((_, index) => index !== boundedPrimary);
  return [primaryQueue, ...remainder];
}

export function createTrainingFineTuningWorker(
  params: CreateTrainingFineTuningWorkerParams
): () => Promise<void> {
  const queues = [
    {
      name: TRAINING_FINE_TUNING_QUEUE_HIGH,
      queue: new RedisStreamQueue(TRAINING_FINE_TUNING_QUEUE_HIGH, {
        group: 'training-service',
        consumer: `training-fine-tuning-high-${process.pid}`,
        maxRetries: 3,
        autoClaimCount: 10,
        streamMaxLen: QUEUE_STREAM_MAX_LEN,
      }),
    },
    {
      name: TRAINING_FINE_TUNING_QUEUE_NORMAL,
      queue: new RedisStreamQueue(TRAINING_FINE_TUNING_QUEUE_NORMAL, {
        group: 'training-service',
        consumer: `training-fine-tuning-normal-${process.pid}`,
        maxRetries: 3,
        autoClaimCount: 10,
        streamMaxLen: QUEUE_STREAM_MAX_LEN,
      }),
    },
    {
      name: TRAINING_FINE_TUNING_QUEUE_LOW,
      queue: new RedisStreamQueue(TRAINING_FINE_TUNING_QUEUE_LOW, {
        group: 'training-service',
        consumer: `training-fine-tuning-low-${process.pid}`,
        maxRetries: 3,
        autoClaimCount: 10,
        streamMaxLen: QUEUE_STREAM_MAX_LEN,
      }),
    },
  ];

  let stopped = false;
  let cycleIndex = 0;

  const runLoop = async () => {
    const redis = getRedisClient();
    if (!redis) {
      params.logger.warn(
        {
          queues: queues.map((item) => item.name),
        },
        'Redis indisponivel para worker de fine-tuning'
      );
      return;
    }

    while (!stopped) {
      const activeLockToken = `${process.pid}:${cycleIndex}:${Date.now()}`;
      const acquiredActiveSlot = await redis.set(ACTIVE_SLOT_LOCK_KEY, activeLockToken, {
        NX: true,
        EX: ACTIVE_SLOT_LOCK_TTL_SECONDS,
      });
      if (!acquiredActiveSlot) {
        params.metrics.jobsTotal.inc({ result: 'active_slot_busy' });
        await sleep(params.pollIntervalMs);
        continue;
      }

      let activeLockLost = false;
      const activeLockRefreshTimer = setInterval(() => {
        void (async () => {
          try {
            const renewed = await refreshActiveSlotLock(redis, activeLockToken);
            if (!renewed) {
              activeLockLost = true;
              params.logger.warn(
                { lockKey: ACTIVE_SLOT_LOCK_KEY },
                'Lock de slot ativo perdido durante processamento de fine-tuning'
              );
            }
          } catch (error) {
            activeLockLost = true;
            params.logger.warn(
              { lockKey: ACTIVE_SLOT_LOCK_KEY, error: error instanceof Error ? error.message : String(error) },
              'Falha ao renovar lock de slot ativo'
            );
          }
        })();
      }, ACTIVE_SLOT_LOCK_RENEW_INTERVAL_MS);
      activeLockRefreshTimer.unref?.();

      try {
      let processedOne = false;
      const scanOrder = buildPriorityQueueScanOrder(queues, cycleIndex);
      cycleIndex += 1;

      for (const queueEntry of scanOrder) {
        if (activeLockLost) {
          break;
        }
        const processed = await queueEntry.queue.consumeOnce(redis, async (rawPayload) => {
          const timer = params.metrics.durationSeconds.startTimer();
          const payload = trainingFineTuningQueuePayloadSchema.parse(rawPayload);
          const lockKey = `${TRAINING_FINE_TUNING_QUEUE}:processing:${payload.fineTuningJobId}`;
          const lock = await redis.set(lockKey, payload.idempotencyKey, {
            NX: true,
            EX: PROCESSING_LOCK_TTL_SECONDS,
          });

          if (!lock) {
            params.metrics.jobsTotal.inc({ result: 'idempotency_skip' });
            params.logger.info(
              {
                queue: queueEntry.name,
                fineTuningJobId: payload.fineTuningJobId,
                idempotencyKey: payload.idempotencyKey,
              },
              'Job de fine-tuning ignorado por lock de idempotencia'
            );
            timer();
            return;
          }

          try {
            const job = await params.db.query.fineTuningJobs.findFirst({
              where: and(
                eq(schema.fineTuningJobs.id, payload.fineTuningJobId),
                eq(schema.fineTuningJobs.tenantId, payload.tenantId)
              ),
            });

            if (!job) {
              params.metrics.jobsTotal.inc({ result: 'missing' });
              params.logger.warn(
                {
                  queue: queueEntry.name,
                  fineTuningJobId: payload.fineTuningJobId,
                  tenantId: payload.tenantId,
                },
                'fine_tuning_jobs nao encontrado para processamento'
              );
              return;
            }

            if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
              params.metrics.jobsTotal.inc({ result: 'skipped_terminal' });
              params.logger.info(
                {
                  queue: queueEntry.name,
                  fineTuningJobId: payload.fineTuningJobId,
                  status: job.status,
                },
                'Job de fine-tuning em estado terminal; processamento ignorado'
              );
              return;
            }

            if (params.processJob) {
              await params.processJob(job, payload);
            } else {
              params.logger.info(
                {
                  queue: queueEntry.name,
                  fineTuningJobId: payload.fineTuningJobId,
                  runId: payload.runId,
                  status: job.status,
                },
                'Worker de fine-tuning recebeu job (skeleton)'
              );
            }

            params.metrics.jobsTotal.inc({ result: 'success' });
          } catch (error) {
            params.metrics.jobsTotal.inc({ result: 'error' });
            params.logger.error(
              {
                queue: queueEntry.name,
                fineTuningJobId: payload.fineTuningJobId,
                error: error instanceof Error ? error.message : String(error),
              },
              'Falha ao processar job de fine-tuning'
            );
            throw error;
          } finally {
            timer();
            await redis.del(lockKey).catch((lockError) => {
              params.logger.warn(
                {
                  queue: queueEntry.name,
                  fineTuningJobId: payload.fineTuningJobId,
                  error: lockError instanceof Error ? lockError.message : String(lockError),
                },
                'Falha ao liberar lock do worker de fine-tuning'
              );
            });
          }
        });

        if (processed) {
          processedOne = true;
          break;
        }

        if (stopped) break;
      }

      if (!processedOne) {
        await sleep(params.pollIntervalMs);
      }
      } finally {
        clearInterval(activeLockRefreshTimer);
        await releaseActiveSlotLock(redis, activeLockToken).catch((error) => {
          params.logger.warn(
            { lockKey: ACTIVE_SLOT_LOCK_KEY, error: error instanceof Error ? error.message : String(error) },
            'Falha ao liberar lock de slot ativo'
          );
        });
      }
    }
  };

  void (async () => {
    while (!stopped) {
      try {
        await runLoop();
      } catch (error) {
        params.logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'Loop do worker de fine-tuning falhou; retomando'
        );
        await sleep(params.pollIntervalMs);
      }
    }
  })();

  return async () => {
    stopped = true;
    for (const queueEntry of queues) {
      queueEntry.queue.requestStop();
    }
    await sleep(params.pollIntervalMs + 50);
  };
}
