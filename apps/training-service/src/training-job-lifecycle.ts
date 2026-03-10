import { and, eq, getDatabase, not, schema } from '@alice/database';

type FineTuningJobRow = typeof schema.fineTuningJobs.$inferSelect;

interface TrainingJobLifecycleLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
}

interface CreateTrainingJobLifecycleServiceDeps {
  logger: TrainingJobLifecycleLogger;
  resolveFineTuningQueuePriorityFromSnapshot: (
    runSource: 'custom_job' | 'on_demand' | 'scheduled',
    snapshot: unknown,
  ) => 'low' | 'normal' | 'high';
  enqueueTrainingFineTuningRun: (params: {
    fineTuningJobId: string;
    tenantId: string;
    priority: 'low' | 'normal' | 'high';
    requestedBy?: string | null;
  }) => Promise<{ enqueued: boolean; runId: string | null }>;
  cancelLoraJob: (jobId: string) => Promise<void>;
  createHttpError: (status: number, payload: { error: string }) => Error;
}

export function createTrainingJobLifecycleService(deps: CreateTrainingJobLifecycleServiceDeps): {
  resumePendingFineTuningJobs: () => Promise<void>;
  resumePendingLoraJobs: () => Promise<void>;
  cancelFineTuningJobAndLora: (params: {
    fineTuningJob: FineTuningJobRow;
    tenantId: string;
    reason: string;
  }) => Promise<FineTuningJobRow>;
} {
  const db = getDatabase();

  return {
    resumePendingFineTuningJobs: async (): Promise<void> => {
      const pending = await db.query.fineTuningJobs.findMany({
        where: and(
          not(eq(schema.fineTuningJobs.status, 'completed')),
          not(eq(schema.fineTuningJobs.status, 'failed')),
          not(eq(schema.fineTuningJobs.status, 'cancelled')),
        ),
        limit: 10,
      });

      for (const job of pending) {
        if (!job.tenantId) {
          deps.logger.warn({ jobId: job.id }, 'Ignorando reenqueue de fine_tuning_job sem tenantId');
          continue;
        }
        try {
          const enqueueResult = await deps.enqueueTrainingFineTuningRun({
            fineTuningJobId: job.id,
            tenantId: job.tenantId,
            priority: deps.resolveFineTuningQueuePriorityFromSnapshot(job.runSource, job.configSnapshot),
          });
          deps.logger.info(
            {
              jobId: job.id,
              enqueued: enqueueResult.enqueued,
              queueRunId: enqueueResult.runId,
            },
            'fine_tuning_job pendente reenfileirado',
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          deps.logger.error({ jobId: job.id, error: msg }, 'Falha ao reenfileirar fine_tuning_job');
        }
      }
    },

    resumePendingLoraJobs: async (): Promise<void> => {
      const pending = await db.query.loraJobs.findMany({
        where: and(
          not(eq(schema.loraJobs.status, 'completed')),
          not(eq(schema.loraJobs.status, 'failed')),
          not(eq(schema.loraJobs.status, 'cancelled')),
        ),
        limit: 5,
      });

      if (pending.length > 0) {
        deps.logger.info(
          { count: pending.length },
          'lora_jobs pendentes detectados; execucao ocorre via fila de fine_tuning',
        );
      }
    },

    cancelFineTuningJobAndLora: async (params): Promise<FineTuningJobRow> => {
      if (!params.fineTuningJob.loraJobId) {
        throw deps.createHttpError(409, { error: 'Job sem loraJobId vinculado' });
      }

      const linkedLoraJob = await db.query.loraJobs.findFirst({
        where: and(
          eq(schema.loraJobs.id, params.fineTuningJob.loraJobId),
          eq(schema.loraJobs.tenantId, params.tenantId),
        ),
        columns: { id: true, status: true },
      });
      if (!linkedLoraJob) {
        throw deps.createHttpError(404, { error: 'Job LoRA vinculado nao encontrado' });
      }

      if (linkedLoraJob.status === 'completed' || linkedLoraJob.status === 'failed') {
        throw deps.createHttpError(409, {
          error: `Nao e possivel cancelar: job LoRA vinculado ja esta em estado terminal (${linkedLoraJob.status})`,
        });
      }

      if (linkedLoraJob.status !== 'cancelled') {
        await deps.cancelLoraJob(linkedLoraJob.id);
      }

      const [updated] = await db.update(schema.fineTuningJobs)
        .set({
          status: 'cancelled',
          completadoEm: new Date(),
          errorMessage: params.reason,
        })
        .where(and(
          eq(schema.fineTuningJobs.id, params.fineTuningJob.id),
          eq(schema.fineTuningJobs.tenantId, params.tenantId),
        ))
        .returning();

      if (!updated) {
        throw new Error(`Falha ao atualizar status cancelado para fine_tuning_job ${params.fineTuningJob.id}`);
      }

      return updated;
    },
  };
}
