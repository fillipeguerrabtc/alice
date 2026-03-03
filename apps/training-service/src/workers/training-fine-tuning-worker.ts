import type { Database } from '@alice/database';
import { and, eq, schema } from '@alice/database';
import {
  getRedisClient,
  RedisStreamQueue,
  TRAINING_FINE_TUNING_QUEUE,
  trainingFineTuningQueuePayloadSchema,
} from '@alice/shared-utils';

type WorkerResultLabel = 'success' | 'missing' | 'skipped_terminal' | 'idempotency_skip' | 'error';

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
const QUEUE_STREAM_MAX_LEN = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createTrainingFineTuningWorker(
  params: CreateTrainingFineTuningWorkerParams
): () => Promise<void> {
  const queue = new RedisStreamQueue(TRAINING_FINE_TUNING_QUEUE, {
    group: 'training-service',
    consumer: `training-fine-tuning-${process.pid}`,
    maxRetries: 3,
    autoClaimCount: 10,
    streamMaxLen: QUEUE_STREAM_MAX_LEN,
  });

  let stopped = false;
  const stopToken = { isStopped: () => stopped };

  const runLoop = async () => {
    const redis = getRedisClient();
    if (!redis) {
      params.logger.warn({ queue: TRAINING_FINE_TUNING_QUEUE }, 'Redis indisponivel para worker de fine-tuning');
      return;
    }

    await queue.consumeLoop(
      redis,
      async (rawPayload) => {
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
                fineTuningJobId: payload.fineTuningJobId,
                error: lockError instanceof Error ? lockError.message : String(lockError),
              },
              'Falha ao liberar lock do worker de fine-tuning'
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
          'Loop do worker de fine-tuning falhou; retomando'
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
