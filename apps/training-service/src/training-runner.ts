import type { Database } from '@alice/database';
import { and, desc, eq, isNull, schema } from '@alice/database';
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
  activateLoraAdapter,
  processLoraJob,
  setJobError,
  type PreparedDatasetManifest,
} from './lora-job-manager.js';
import { loadTrainingEnterpriseConfig } from './training-config.js';

const runnerLogger = createLogger('training-runner');

const booleanStringSchema = z.string().transform((raw) => {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`Valor booleano invalido: ${raw}`);
});

const trainingConfigShapeSchema = z.object({
  TRAINING_EVAL_MAX_LOSS: z.coerce.number().positive(),
  TRAINING_AUTO_PROMOTE_SCHEDULED: z.string().min(1),
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
  evalMaxLoss: number;
  autoPromoteScheduled: boolean;
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
  evalMaxLoss: z.number().positive(),
  autoPromoteScheduled: z.boolean(),
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

function resolveEvaluationStatus(
  metrics: Record<string, unknown>,
  maxEvalLoss: number
): 'passed' | 'failed' | 'skipped' {
  const evalLossRaw = metrics.eval_loss ?? metrics.evalLoss ?? null;
  const perplexityRaw = metrics.perplexity ?? null;
  if (typeof evalLossRaw === 'number' && Number.isFinite(evalLossRaw)) {
    return evalLossRaw <= maxEvalLoss ? 'passed' : 'failed';
  }
  if (
    typeof perplexityRaw === 'number'
    && Number.isFinite(perplexityRaw)
    && perplexityRaw > 0
  ) {
    const inferredLoss = Math.log(perplexityRaw);
    return inferredLoss <= maxEvalLoss ? 'passed' : 'failed';
  }
  return 'skipped';
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
  const [allConfig, enterpriseConfig] = await Promise.all([
    getAllSystemConfig(),
    loadTrainingEnterpriseConfig(),
  ]);
  const parsed = trainingConfigShapeSchema.parse({
    TRAINING_EVAL_MAX_LOSS: allConfig.TRAINING_EVAL_MAX_LOSS,
    TRAINING_AUTO_PROMOTE_SCHEDULED: allConfig.TRAINING_AUTO_PROMOTE_SCHEDULED,
    AUTO_LEARNING_CRON_INCREMENTAL: allConfig.AUTO_LEARNING_CRON_INCREMENTAL,
    AUTO_LEARNING_CRON_FULL: allConfig.AUTO_LEARNING_CRON_FULL,
    AUTO_LEARNING_INCLUDE_IMAGES: allConfig.AUTO_LEARNING_INCLUDE_IMAGES,
  });

  const schemaDefaults = TradingLoraHyperparamsSchema.parse({});
  const defaultHyperparams = mergeHyperparams(
    schemaDefaults,
    [enterpriseConfig.defaultHyperparams]
  );

  const presetSafe = mergeHyperparams(
    defaultHyperparams,
    [enterpriseConfig.presets.safe]
  );
  const presetStandard = mergeHyperparams(
    defaultHyperparams,
    [enterpriseConfig.presets.standard]
  );
  const presetLarge = mergeHyperparams(
    defaultHyperparams,
    [enterpriseConfig.presets.large]
  );

  return {
    minOndemandDatasetSize: enterpriseConfig.minOndemandDatasetSize,
    minScheduledDatasetSizeIncremental: enterpriseConfig.minScheduledIncremental,
    minScheduledDatasetSizeFull: enterpriseConfig.minScheduledFull,
    qualityMinRatio: enterpriseConfig.qualityMinRatio,
    datasetMaxRows: enterpriseConfig.datasetMaxRows,
    trainEvalSplitRatio: enterpriseConfig.trainEvalSplitRatio,
    sliceSteps: enterpriseConfig.sliceSteps,
    gpuTimeoutMs: enterpriseConfig.gpuTimeoutMs,
    evalMaxLoss: parsed.TRAINING_EVAL_MAX_LOSS,
    autoPromoteScheduled: booleanStringSchema.parse(parsed.TRAINING_AUTO_PROMOTE_SCHEDULED),
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
    evalMaxLoss: params.runtimeConfig.evalMaxLoss,
    autoPromoteScheduled: params.runtimeConfig.autoPromoteScheduled,
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

async function promoteFineTuningJobAsActive(params: {
  db: Database;
  fineTuningJob: typeof schema.fineTuningJobs.$inferSelect;
  resultAdapterPath: string;
  metrics: Record<string, unknown>;
}): Promise<void> {
  const loraJobId = params.fineTuningJob.loraJobId;
  if (!loraJobId) {
    throw new Error(`fine_tuning_job sem loraJobId: ${params.fineTuningJob.id}`);
  }
  if (!params.fineTuningJob.tenantId) {
    throw new Error(`fine_tuning_job sem tenantId: ${params.fineTuningJob.id}`);
  }

  const activationResult = await activateLoraAdapter(loraJobId, null);

  const namespaceCondition = params.fineTuningJob.scopeNamespaceId
    ? eq(schema.modelVersions.namespaceId, params.fineTuningJob.scopeNamespaceId)
    : isNull(schema.modelVersions.namespaceId);

  const fineTuningScopeConditions = [
    eq(schema.fineTuningJobs.tenantId, params.fineTuningJob.tenantId),
    params.fineTuningJob.scopeNamespaceId
      ? eq(schema.fineTuningJobs.scopeNamespaceId, params.fineTuningJob.scopeNamespaceId)
      : isNull(schema.fineTuningJobs.scopeNamespaceId),
    params.fineTuningJob.scopeAgentId
      ? eq(schema.fineTuningJobs.scopeAgentId, params.fineTuningJob.scopeAgentId)
      : isNull(schema.fineTuningJobs.scopeAgentId),
  ];

  const [modelVersion] = await params.db.transaction(async (tx) => {
    const latestScopedVersion = await tx.query.modelVersions.findFirst({
      where: and(
        eq(schema.modelVersions.tenantId, params.fineTuningJob.tenantId as string),
        namespaceCondition
      ),
      orderBy: [desc(schema.modelVersions.version)],
      columns: { version: true },
    });

    await tx.update(schema.modelVersions)
      .set({
        isActive: false,
        status: 'deprecated',
        deprecadoEm: new Date(),
      })
      .where(and(
        eq(schema.modelVersions.tenantId, params.fineTuningJob.tenantId as string),
        namespaceCondition,
        eq(schema.modelVersions.isActive, true)
      ));

    await tx.update(schema.fineTuningJobs)
      .set({ promotionStatus: 'staged' })
      .where(and(
        ...fineTuningScopeConditions,
        eq(schema.fineTuningJobs.promotionStatus, 'active')
      ));

    const nextVersion = (latestScopedVersion?.version ?? 0) + 1;
    const datasetMetrics = typeof params.metrics.dataset === 'object' && params.metrics.dataset !== null
      ? (params.metrics.dataset as Record<string, unknown>)
      : {};
    const imagesUsedRaw = datasetMetrics.imagesUsed;
    const imageDataCount = typeof imagesUsedRaw === 'number' && Number.isFinite(imagesUsedRaw)
      ? imagesUsedRaw
      : 0;

    const [createdVersion] = await tx.insert(schema.modelVersions).values({
      tenantId: params.fineTuningJob.tenantId,
      namespaceId: params.fineTuningJob.scopeNamespaceId ?? null,
      name: `${params.fineTuningJob.name}-v${nextVersion}`,
      version: nextVersion,
      baseModel: params.fineTuningJob.baseModel,
      loraPath: activationResult.adapterPath ?? params.resultAdapterPath,
      status: 'active',
      fineTuningJobId: params.fineTuningJob.id,
      trainingDataCount: params.fineTuningJob.trainingDataCount ?? 0,
      imageDataCount,
      metrics: params.metrics,
      baselineMetrics: {},
      isActive: true,
      ativadoEm: new Date(),
    }).returning();

    await tx.update(schema.fineTuningJobs)
      .set({
        modelVersionId: createdVersion.id,
        promotionStatus: 'active',
      })
      .where(eq(schema.fineTuningJobs.id, params.fineTuningJob.id));

    return [createdVersion];
  });

  runnerLogger.info(
    {
      fineTuningJobId: params.fineTuningJob.id,
      loraJobId,
      modelVersionId: modelVersion.id,
    },
    'Promocao automatica de modelo concluida'
  );
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
            evaluationStatus: nextStatus === 'validating' ? 'running' : undefined,
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
    const loraMetrics = isRecord(finalLoraJob.metrics) ? finalLoraJob.metrics : {};
    const evaluationStatus = resolveEvaluationStatus(
      loraMetrics,
      runnerConfig.evalMaxLoss
    );
    const autoPromotionEnabled = fineTuningJob.runSource === 'scheduled'
      && runnerConfig.autoPromoteScheduled;
    const promotionStatus =
      autoPromotionEnabled && evaluationStatus !== 'passed'
        ? 'rejected'
        : (evaluationStatus === 'failed' ? 'rejected' : 'candidate');

    await params.db.update(schema.fineTuningJobs)
      .set({
        status: 'completed',
        progress: 100,
        resultModel: finalLoraJob.resultAdapterPath,
        trainingDataCount: finalLoraJob.datasetCount ?? undefined,
        validationDataCount: finalLoraJob.validationCount ?? undefined,
        completadoEm: new Date(),
        metrics: fineTuningMetrics,
        evaluationStatus,
        promotionStatus,
      })
      .where(eq(schema.fineTuningJobs.id, fineTuningJob.id));

    if (autoPromotionEnabled && evaluationStatus === 'passed') {
      try {
        await promoteFineTuningJobAsActive({
          db: params.db,
          fineTuningJob,
          resultAdapterPath: finalLoraJob.resultAdapterPath,
          metrics: fineTuningMetrics,
        });
      } catch (promotionError) {
        const message = promotionError instanceof Error
          ? promotionError.message
          : String(promotionError);
        fineTuningMetrics = {
          ...fineTuningMetrics,
          promotion: {
            autoPromoteScheduled: true,
            status: 'failed',
            error: message,
            at: new Date().toISOString(),
          },
        };
        await params.db.update(schema.fineTuningJobs)
          .set({
            metrics: fineTuningMetrics,
            promotionStatus: 'rejected',
          })
          .where(eq(schema.fineTuningJobs.id, fineTuningJob.id));

        runnerLogger.error(
          { fineTuningJobId: fineTuningJob.id, error: message },
          'Promocao automatica de modelo falhou'
        );
      }
    }

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
          evaluationStatus: 'failed',
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
