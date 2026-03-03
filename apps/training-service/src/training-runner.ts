import type { Database } from '@alice/database';
import { and, eq, schema } from '@alice/database';
import { getAllSystemConfig } from '@alice/database/system-config';
import { createLogger } from '@alice/logger';
import {
  TradingLoraHyperparamsSchema,
  type LoraJob,
  type TradingLoraHyperparams,
} from '@alice/shared';
import type { TrainingFineTuningQueuePayload } from '@alice/shared-utils';
import { z } from 'zod';
import {
  processLoraJob,
  setJobError,
  type PreparedDatasetManifest,
} from './lora-job-manager.js';

const runnerLogger = createLogger('training-runner');

const booleanStringSchema = z.string().transform((raw) => {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`Valor booleano invalido: ${raw}`);
});

const trainingConfigShapeSchema = z.object({
  MIN_ONDEMAND_DATASET_SIZE: z.coerce.number().int().min(1),
  MIN_SCHEDULED_DATASET_SIZE_INCREMENTAL: z.coerce.number().int().min(1),
  MIN_SCHEDULED_DATASET_SIZE_FULL: z.coerce.number().int().min(1),
  TRAINING_QUALITY_MIN_RATIO: z.coerce.number().min(0).max(1),
  TRAINING_DATASET_MAX_ROWS: z.coerce.number().int().min(100),
  TRAINING_TRAIN_EVAL_SPLIT_RATIO: z.coerce.number().min(0.5).max(0.99),
  TRAINING_SLICE_STEPS: z.coerce.number().int().min(1),
  TRAINING_GPU_TIMEOUT_MS: z.coerce.number().int().min(1000),
  TRAINING_DEFAULT_HYPERPARAMS_JSON: z.string().min(2),
  TRAINING_PRESET_SAFE_JSON: z.string().min(2).optional(),
  TRAINING_PRESET_STANDARD_JSON: z.string().min(2).optional(),
  TRAINING_PRESET_LARGE_JSON: z.string().min(2).optional(),
  AUTO_LEARNING_CRON_INCREMENTAL: z.string().min(1),
  AUTO_LEARNING_CRON_FULL: z.string().min(1),
  AUTO_LEARNING_INCLUDE_IMAGES: z.string().min(1),
});

export const TrainingHyperparamsOverrideSchema = z.object({
  epochs: z.number().int().positive().optional(),
  learningRate: z.number().positive().optional(),
  batchSize: z.number().int().positive().optional(),
  gradientAccumulationSteps: z.number().int().positive().optional(),
  warmupSteps: z.number().int().nonnegative().optional(),
  maxSeqLen: z.number().int().min(256).max(32768).optional(),
  loraRank: z.number().int().positive().optional(),
  loraAlpha: z.number().positive().optional(),
  loraDropout: z.number().min(0).max(1).optional(),
  lrSchedulerType: z.string().min(1).optional(),
  maxGradNorm: z.number().positive().optional(),
  targetModules: z.array(z.string().min(1)).min(1).optional(),
}).passthrough();

type TrainingHyperparamsOverride = z.infer<typeof TrainingHyperparamsOverrideSchema>;
type HyperparamPresetName = 'safe' | 'standard' | 'large';
type FineTuningJobStatus = 'pending' | 'preparing' | 'training' | 'validating' | 'completed' | 'failed' | 'cancelled';

interface TrainingSystemRuntimeConfig {
  minOndemandDatasetSize: number;
  minScheduledDatasetSizeIncremental: number;
  minScheduledDatasetSizeFull: number;
  qualityMinRatio: number;
  datasetMaxRows: number;
  trainEvalSplitRatio: number;
  sliceSteps: number;
  gpuTimeoutMs: number;
  defaultHyperparams: TradingLoraHyperparams;
  presets: Record<HyperparamPresetName, TradingLoraHyperparams>;
  autoLearningCronIncremental: string;
  autoLearningCronFull: string;
  autoLearningIncludeImagesDefault: boolean;
}

const FrozenRunnerConfigSchema = z.object({
  version: z.literal(1),
  resolvedAt: z.string().datetime(),
  scheduleType: z.string().nullable(),
  minDatasetSize: z.number().int().min(1),
  datasetMaxRows: z.number().int().min(100),
  trainEvalSplitRatio: z.number().min(0.5).max(0.99),
  sliceSteps: z.number().int().min(1),
  gpuTimeoutMs: z.number().int().min(1000),
  seed: z.string().min(1),
  includeImages: z.boolean(),
  includeTradingDataset: z.boolean(),
  qualityMinRatio: z.number().min(0).max(1),
  hyperparameters: TradingLoraHyperparamsSchema,
  scope: z.object({
    namespaceId: z.string().uuid().nullable(),
    agentId: z.string().uuid().nullable(),
    domain: z.string().max(120).nullable(),
  }),
  autoLearning: z.object({
    cronIncremental: z.string().min(1),
    cronFull: z.string().min(1),
    includeImagesDefault: z.boolean(),
  }),
});

type FrozenRunnerConfig = z.infer<typeof FrozenRunnerConfigSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseHyperparamsOverrideFromUnknown(
  value: unknown,
  source: string
): TrainingHyperparamsOverride {
  if (!isRecord(value)) return {};
  const parsed = TrainingHyperparamsOverrideSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Hiperparametros invalidos em ${source}: ${parsed.error.message}`);
  }
  return parsed.data;
}

function parseHyperparamsOverrideFromJson(
  raw: string,
  source: string
): TrainingHyperparamsOverride {
  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`JSON invalido para ${source}: ${message}`);
  }
  return parseHyperparamsOverrideFromUnknown(parsedUnknown, source);
}

function readPresetName(snapshot: Record<string, unknown>): HyperparamPresetName | null {
  const rawPreset = readNullableString(snapshot.hyperparametersPreset)
    ?? readNullableString(snapshot.hyperparameterPreset)
    ?? readNullableString(snapshot.preset);
  if (!rawPreset) return null;
  const normalized = rawPreset.toLowerCase();
  if (normalized === 'safe' || normalized === 'standard' || normalized === 'large') {
    return normalized;
  }
  return null;
}

function mergeHyperparams(
  base: TradingLoraHyperparams,
  overrides: Array<Partial<TradingLoraHyperparams>>
): TradingLoraHyperparams {
  const merged = {
    ...base,
    ...overrides.reduce<Record<string, unknown>>((acc, override) => ({ ...acc, ...override }), {}),
  };
  return TradingLoraHyperparamsSchema.parse(merged);
}

function mapStatusForFineTuning(status: string | undefined): FineTuningJobStatus | null {
  if (!status) return null;
  if (
    status === 'pending'
    || status === 'preparing'
    || status === 'training'
    || status === 'validating'
    || status === 'completed'
    || status === 'failed'
    || status === 'cancelled'
  ) {
    return status;
  }
  return null;
}

function resolveMinDatasetSizeForRun(params: {
  runSource: 'custom_job' | 'on_demand' | 'scheduled';
  scheduleType: string | null;
  runtimeConfig: TrainingSystemRuntimeConfig;
}): number {
  if (params.runSource === 'custom_job' || params.runSource === 'on_demand') {
    return params.runtimeConfig.minOndemandDatasetSize;
  }
  const normalized = (params.scheduleType ?? '').toLowerCase();
  if (normalized === 'complete_fine_tuning' || normalized === 'full') {
    return params.runtimeConfig.minScheduledDatasetSizeFull;
  }
  return params.runtimeConfig.minScheduledDatasetSizeIncremental;
}

export async function loadTrainingSystemRuntimeConfig(): Promise<TrainingSystemRuntimeConfig> {
  const allConfig = await getAllSystemConfig();
  const parsed = trainingConfigShapeSchema.parse({
    MIN_ONDEMAND_DATASET_SIZE: allConfig.MIN_ONDEMAND_DATASET_SIZE,
    MIN_SCHEDULED_DATASET_SIZE_INCREMENTAL: allConfig.MIN_SCHEDULED_DATASET_SIZE_INCREMENTAL,
    MIN_SCHEDULED_DATASET_SIZE_FULL: allConfig.MIN_SCHEDULED_DATASET_SIZE_FULL,
    TRAINING_QUALITY_MIN_RATIO: allConfig.TRAINING_QUALITY_MIN_RATIO,
    TRAINING_DATASET_MAX_ROWS: allConfig.TRAINING_DATASET_MAX_ROWS,
    TRAINING_TRAIN_EVAL_SPLIT_RATIO: allConfig.TRAINING_TRAIN_EVAL_SPLIT_RATIO,
    TRAINING_SLICE_STEPS: allConfig.TRAINING_SLICE_STEPS,
    TRAINING_GPU_TIMEOUT_MS: allConfig.TRAINING_GPU_TIMEOUT_MS,
    TRAINING_DEFAULT_HYPERPARAMS_JSON: allConfig.TRAINING_DEFAULT_HYPERPARAMS_JSON,
    TRAINING_PRESET_SAFE_JSON: allConfig.TRAINING_PRESET_SAFE_JSON,
    TRAINING_PRESET_STANDARD_JSON: allConfig.TRAINING_PRESET_STANDARD_JSON,
    TRAINING_PRESET_LARGE_JSON: allConfig.TRAINING_PRESET_LARGE_JSON,
    AUTO_LEARNING_CRON_INCREMENTAL: allConfig.AUTO_LEARNING_CRON_INCREMENTAL,
    AUTO_LEARNING_CRON_FULL: allConfig.AUTO_LEARNING_CRON_FULL,
    AUTO_LEARNING_INCLUDE_IMAGES: allConfig.AUTO_LEARNING_INCLUDE_IMAGES,
  });

  const schemaDefaults = TradingLoraHyperparamsSchema.parse({});
  const defaultHyperparams = mergeHyperparams(
    schemaDefaults,
    [parseHyperparamsOverrideFromJson(parsed.TRAINING_DEFAULT_HYPERPARAMS_JSON, 'TRAINING_DEFAULT_HYPERPARAMS_JSON')]
  );

  const presetSafe = mergeHyperparams(
    defaultHyperparams,
    parsed.TRAINING_PRESET_SAFE_JSON
      ? [parseHyperparamsOverrideFromJson(parsed.TRAINING_PRESET_SAFE_JSON, 'TRAINING_PRESET_SAFE_JSON')]
      : []
  );
  const presetStandard = mergeHyperparams(
    defaultHyperparams,
    parsed.TRAINING_PRESET_STANDARD_JSON
      ? [parseHyperparamsOverrideFromJson(parsed.TRAINING_PRESET_STANDARD_JSON, 'TRAINING_PRESET_STANDARD_JSON')]
      : []
  );
  const presetLarge = mergeHyperparams(
    defaultHyperparams,
    parsed.TRAINING_PRESET_LARGE_JSON
      ? [parseHyperparamsOverrideFromJson(parsed.TRAINING_PRESET_LARGE_JSON, 'TRAINING_PRESET_LARGE_JSON')]
      : []
  );

  return {
    minOndemandDatasetSize: parsed.MIN_ONDEMAND_DATASET_SIZE,
    minScheduledDatasetSizeIncremental: parsed.MIN_SCHEDULED_DATASET_SIZE_INCREMENTAL,
    minScheduledDatasetSizeFull: parsed.MIN_SCHEDULED_DATASET_SIZE_FULL,
    qualityMinRatio: parsed.TRAINING_QUALITY_MIN_RATIO,
    datasetMaxRows: parsed.TRAINING_DATASET_MAX_ROWS,
    trainEvalSplitRatio: parsed.TRAINING_TRAIN_EVAL_SPLIT_RATIO,
    sliceSteps: parsed.TRAINING_SLICE_STEPS,
    gpuTimeoutMs: parsed.TRAINING_GPU_TIMEOUT_MS,
    defaultHyperparams,
    presets: {
      safe: presetSafe,
      standard: presetStandard,
      large: presetLarge,
    },
    autoLearningCronIncremental: parsed.AUTO_LEARNING_CRON_INCREMENTAL,
    autoLearningCronFull: parsed.AUTO_LEARNING_CRON_FULL,
    autoLearningIncludeImagesDefault: booleanStringSchema.parse(parsed.AUTO_LEARNING_INCLUDE_IMAGES),
  };
}

function buildFrozenRunnerConfig(params: {
  fineTuningJob: typeof schema.fineTuningJobs.$inferSelect;
  loraJob: LoraJob;
  runtimeConfig: TrainingSystemRuntimeConfig;
  snapshot: Record<string, unknown>;
}): FrozenRunnerConfig {
  const snapshotHyperparamsOverride = parseHyperparamsOverrideFromUnknown(
    params.snapshot.hyperparameters,
    'configSnapshot.hyperparameters'
  );
  const fineTuningHyperparamsOverride = parseHyperparamsOverrideFromUnknown(
    params.fineTuningJob.hyperparameters,
    'fine_tuning_jobs.hyperparameters'
  );
  const loraHyperparamsOverride = parseHyperparamsOverrideFromUnknown(
    params.loraJob.hyperparameters,
    'lora_jobs.hyperparameters'
  );
  const presetName = readPresetName(params.snapshot) ?? 'standard';
  const basePreset = params.runtimeConfig.presets[presetName];
  const finalHyperparams = mergeHyperparams(
    params.runtimeConfig.defaultHyperparams,
    [basePreset, loraHyperparamsOverride, fineTuningHyperparamsOverride, snapshotHyperparamsOverride]
  );

  const scheduleType = readNullableString(params.snapshot.scheduleType);
  const minDatasetSize = resolveMinDatasetSizeForRun({
    runSource: params.fineTuningJob.runSource,
    scheduleType,
    runtimeConfig: params.runtimeConfig,
  });
  const defaultIncludeImages = params.fineTuningJob.runSource === 'scheduled'
    ? params.runtimeConfig.autoLearningIncludeImagesDefault
    : false;
  const includeImagesFromSnapshot = params.snapshot.includeImages;
  const includeImages = typeof includeImagesFromSnapshot === 'boolean'
    ? includeImagesFromSnapshot
    : (params.loraJob.includeImages ?? defaultIncludeImages);
  const includeTradingDataset = params.loraJob.includeTradingDataset
    ?? (params.fineTuningJob.runSource !== 'custom_job' && Boolean(params.fineTuningJob.scopeNamespaceId));
  const seed = readNullableString(params.snapshot.seed)
    ?? `${params.fineTuningJob.id}:${params.loraJob.id}`;

  return {
    version: 1,
    resolvedAt: new Date().toISOString(),
    scheduleType,
    minDatasetSize,
    datasetMaxRows: params.runtimeConfig.datasetMaxRows,
    trainEvalSplitRatio: params.runtimeConfig.trainEvalSplitRatio,
    sliceSteps: params.runtimeConfig.sliceSteps,
    gpuTimeoutMs: params.runtimeConfig.gpuTimeoutMs,
    seed,
    includeImages,
    includeTradingDataset,
    qualityMinRatio: params.runtimeConfig.qualityMinRatio,
    hyperparameters: finalHyperparams,
    scope: {
      namespaceId: params.fineTuningJob.scopeNamespaceId ?? null,
      agentId: params.fineTuningJob.scopeAgentId ?? null,
      domain: readNullableString(isRecord(params.snapshot.scope) ? params.snapshot.scope.domain : null),
    },
    autoLearning: {
      cronIncremental: params.runtimeConfig.autoLearningCronIncremental,
      cronFull: params.runtimeConfig.autoLearningCronFull,
      includeImagesDefault: params.runtimeConfig.autoLearningIncludeImagesDefault,
    },
  };
}

export async function runTrainingFineTuningJob(params: {
  db: Database;
  payload: TrainingFineTuningQueuePayload;
  fineTuningJobId: string;
}): Promise<void> {
  let loraJobForError: LoraJob | null = null;
  let fineTuningMetrics: Record<string, unknown> = {};

  try {
    const fineTuningJob = await params.db.query.fineTuningJobs.findFirst({
      where: eq(schema.fineTuningJobs.id, params.fineTuningJobId),
    });
    if (!fineTuningJob) {
      throw new Error(`fine_tuning_jobs nao encontrado: ${params.fineTuningJobId}`);
    }
    if (
      fineTuningJob.status === 'completed'
      || fineTuningJob.status === 'failed'
      || fineTuningJob.status === 'cancelled'
    ) {
      return;
    }
    if (!fineTuningJob.tenantId) {
      throw new Error(`fine_tuning_job sem tenantId: ${fineTuningJob.id}`);
    }
    if (!fineTuningJob.loraJobId) {
      throw new Error(`fine_tuning_job sem loraJobId: ${fineTuningJob.id}`);
    }

    const loraJob = await params.db.query.loraJobs.findFirst({
      where: and(
        eq(schema.loraJobs.id, fineTuningJob.loraJobId),
        eq(schema.loraJobs.tenantId, fineTuningJob.tenantId)
      ),
    });
    if (!loraJob) {
      throw new Error(`lora_job nao encontrado para fine_tuning_job ${fineTuningJob.id}`);
    }
    loraJobForError = loraJob;

    const runtimeConfig = await loadTrainingSystemRuntimeConfig();
    const snapshot = isRecord(fineTuningJob.configSnapshot)
      ? fineTuningJob.configSnapshot
      : {};
    const frozenParse = FrozenRunnerConfigSchema.safeParse(snapshot.runner);
    const runnerConfig = frozenParse.success
      ? frozenParse.data
      : buildFrozenRunnerConfig({
          fineTuningJob,
          loraJob,
          runtimeConfig,
          snapshot,
        });

    let mutableSnapshot: Record<string, unknown> = {
      ...snapshot,
      hyperparameters: runnerConfig.hyperparameters,
      runner: runnerConfig,
    };
    fineTuningMetrics = isRecord(fineTuningJob.metrics) ? fineTuningJob.metrics : {};
    const startedAt = fineTuningJob.iniciadoEm ?? new Date();
    const baseMetrics: Record<string, unknown> = {
      ...fineTuningMetrics,
      runner: {
        runId: params.payload.runId,
        idempotencyKey: params.payload.idempotencyKey,
        loraJobId: loraJob.id,
        startedAt: startedAt.toISOString(),
      },
    };
    fineTuningMetrics = baseMetrics;

    await params.db.update(schema.fineTuningJobs)
      .set({
        status: 'preparing',
        iniciadoEm: startedAt,
        errorMessage: null,
        configSnapshot: mutableSnapshot,
        metrics: fineTuningMetrics,
      })
      .where(eq(schema.fineTuningJobs.id, fineTuningJob.id));

    await processLoraJob(loraJob.id, {
      sliceSteps: runnerConfig.sliceSteps,
      gpuTimeoutMs: runnerConfig.gpuTimeoutMs,
      datasetMaxRows: runnerConfig.datasetMaxRows,
      trainEvalSplitRatio: runnerConfig.trainEvalSplitRatio,
      minDatasetSize: runnerConfig.minDatasetSize,
      seed: runnerConfig.seed,
      includeImages: runnerConfig.includeImages,
      includeTradingDataset: runnerConfig.includeTradingDataset,
      agentId: runnerConfig.scope.agentId ?? undefined,
      domain: runnerConfig.scope.domain ?? undefined,
      hyperparametersOverride: runnerConfig.hyperparameters,
      onDatasetPrepared: async (manifest: PreparedDatasetManifest) => {
        const nowIso = new Date().toISOString();
        mutableSnapshot = {
          ...mutableSnapshot,
          datasetManifest: {
            generatedAt: nowIso,
            seed: runnerConfig.seed,
            trainingRowIds: manifest.trainingRowIds,
            validationRowIds: manifest.validationRowIds,
            trainingDataIds: manifest.trainingDataIds,
            tradingDatasetIds: manifest.datasetIds,
            total: manifest.total,
            training: manifest.training,
            validation: manifest.validation,
          },
        };
        fineTuningMetrics = {
          ...fineTuningMetrics,
          dataset: {
            total: manifest.total,
            training: manifest.training,
            validation: manifest.validation,
            imagesUsed: manifest.imagesUsed,
          },
        };
        await params.db.update(schema.fineTuningJobs)
          .set({
            trainingDataCount: manifest.training,
            validationDataCount: manifest.validation,
            configSnapshot: mutableSnapshot,
            metrics: fineTuningMetrics,
          })
          .where(eq(schema.fineTuningJobs.id, fineTuningJob.id));
      },
      onProgress: async (progress) => {
        const nextStatus = mapStatusForFineTuning(progress.status);
        const nowIso = new Date().toISOString();
        fineTuningMetrics = {
          ...fineTuningMetrics,
          progress: {
            status: progress.status ?? null,
            progress: progress.progress ?? null,
            currentStep: progress.currentStep ?? null,
            totalSteps: progress.totalSteps ?? null,
            updatedAt: nowIso,
          },
          adapterPath: progress.adapterPath ?? (fineTuningMetrics.adapterPath as string | null) ?? null,
        };

        await params.db.update(schema.fineTuningJobs)
          .set({
            status: nextStatus ?? undefined,
            progress: progress.progress ?? undefined,
            resultModel: progress.adapterPath ?? undefined,
            iniciadoEm: nextStatus && nextStatus !== 'pending' ? startedAt : undefined,
            completadoEm: nextStatus === 'completed' ? new Date() : undefined,
            metrics: fineTuningMetrics,
          })
          .where(eq(schema.fineTuningJobs.id, fineTuningJob.id));
      },
    });

    const finalLoraJob = await params.db.query.loraJobs.findFirst({
      where: eq(schema.loraJobs.id, loraJob.id),
      columns: {
        resultAdapterPath: true,
        datasetCount: true,
        validationCount: true,
        metrics: true,
      },
    });
    if (!finalLoraJob?.resultAdapterPath) {
      throw new Error(`Adapter final ausente para lora_job ${loraJob.id}`);
    }

    fineTuningMetrics = {
      ...fineTuningMetrics,
      loraMetrics: isRecord(finalLoraJob.metrics) ? finalLoraJob.metrics : {},
      completedAt: new Date().toISOString(),
    };

    await params.db.update(schema.fineTuningJobs)
      .set({
        status: 'completed',
        progress: 100,
        resultModel: finalLoraJob.resultAdapterPath,
        trainingDataCount: finalLoraJob.datasetCount ?? undefined,
        validationDataCount: finalLoraJob.validationCount ?? undefined,
        completadoEm: new Date(),
        metrics: fineTuningMetrics,
      })
      .where(eq(schema.fineTuningJobs.id, fineTuningJob.id));

    runnerLogger.info(
      {
        fineTuningJobId: fineTuningJob.id,
        loraJobId: loraJob.id,
        resultAdapterPath: finalLoraJob.resultAdapterPath,
      },
      'TrainingRunner concluiu execucao de fine-tuning'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runnerLogger.error(
      {
        fineTuningJobId: params.fineTuningJobId,
        loraJobId: loraJobForError?.id ?? null,
        error: message,
      },
      'TrainingRunner falhou'
    );

    const latestFineTuningJob = await params.db.query.fineTuningJobs.findFirst({
      where: eq(schema.fineTuningJobs.id, params.fineTuningJobId),
      columns: { status: true },
    });

    if (latestFineTuningJob?.status !== 'cancelled') {
      const failedMetrics: Record<string, unknown> = {
        ...fineTuningMetrics,
        failure: {
          message,
          at: new Date().toISOString(),
        },
      };
      await params.db.update(schema.fineTuningJobs)
        .set({
          status: 'failed',
          errorMessage: message,
          completadoEm: new Date(),
          metrics: failedMetrics,
        })
        .where(eq(schema.fineTuningJobs.id, params.fineTuningJobId));
    }

    if (loraJobForError && loraJobForError.status !== 'cancelled') {
      await setJobError(loraJobForError.id, {
        message,
        details: {
          fineTuningJobId: params.fineTuningJobId,
        },
      });
    }
    throw error;
  }
}
