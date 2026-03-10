import type { Database } from '@alice/database';
import { and, desc, eq, schema } from '@alice/database';
import { getAllSystemConfig } from '@alice/database/system-config';
import { createLogger } from '@alice/logger';
import {
  TradingLoraHyperparamsSchema,
  type LoraJob,
  type TradingLoraHyperparams,
} from '@alice/shared';
import {
  getRedisClient,
  type TrainingFineTuningQueuePayload,
} from '@alice/shared-utils';
import { z } from 'zod';
import {
  activateLoraAdapter,
  processLoraJob,
  setJobError,
  type PreparedDatasetManifest,
  type TrainingRunPriority,
} from './lora-job-manager.js';
import { loadTrainingEnterpriseConfig } from './training-config.js';
import {
  resolveFineTuningPromotionStatus,
} from './training-governance.js';
import {
  assertValidModelRegistryScope,
  buildFineTuningScopeCondition,
  buildModelVersionScopeCondition,
} from './model-registry-scope.js';
import {
  acquireTrainingOperationLock,
  buildTrainingScopeOperationLockKey,
  releaseTrainingOperationLock,
} from './training-enterprise-controls.js';

const runnerLogger = createLogger('training-runner');
const TRAINING_AUTO_PROMOTION_LOCK_TTL_SECONDS = 45;

const booleanStringSchema = z.string().transform((raw) => {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`Valor booleano invalido: ${raw}`);
});

const trainingConfigShapeSchema = z.object({
  TRAINING_EVAL_MAX_LOSS: z.coerce.number().positive(),
  TRAINING_AUTO_PROMOTE_SCHEDULED: z.string().min(1),
  TRAINING_PROMOTION_REQUIRE_EVAL_PASSED: z.string().min(1),
  TRAINING_PROMOTION_REQUIRE_APPROVAL_GATES: z.string().min(1),
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
  requireEvalPassedForPromotion: boolean;
  requireApprovalGatesForPromotion: boolean;
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
  runPriority: z.enum(['low', 'normal', 'high']),
  evalMaxLoss: z.number().positive(),
  autoPromoteScheduled: z.boolean(),
  requireEvalPassedForPromotion: z.boolean(),
  requireApprovalGatesForPromotion: z.boolean(),
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

function readRunPriority(snapshot: Record<string, unknown>): TrainingRunPriority | null {
  const rawPriority = readNullableString(snapshot.runPriority)
    ?? readNullableString(snapshot.priority);
  if (!rawPriority) return null;
  const normalized = rawPriority.toLowerCase();
  if (normalized === 'low' || normalized === 'normal' || normalized === 'high') {
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
    TRAINING_PROMOTION_REQUIRE_EVAL_PASSED: allConfig.TRAINING_PROMOTION_REQUIRE_EVAL_PASSED,
    TRAINING_PROMOTION_REQUIRE_APPROVAL_GATES: allConfig.TRAINING_PROMOTION_REQUIRE_APPROVAL_GATES,
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
    requireEvalPassedForPromotion: booleanStringSchema.parse(parsed.TRAINING_PROMOTION_REQUIRE_EVAL_PASSED),
    requireApprovalGatesForPromotion: booleanStringSchema.parse(parsed.TRAINING_PROMOTION_REQUIRE_APPROVAL_GATES),
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
  const defaultRunPriority: TrainingRunPriority = params.fineTuningJob.runSource === 'scheduled'
    ? 'low'
    : 'normal';
  const runPriority = readRunPriority(params.snapshot) ?? defaultRunPriority;
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
    runPriority,
    evalMaxLoss: params.runtimeConfig.evalMaxLoss,
    autoPromoteScheduled: params.runtimeConfig.autoPromoteScheduled,
    requireEvalPassedForPromotion: params.runtimeConfig.requireEvalPassedForPromotion,
    requireApprovalGatesForPromotion: params.runtimeConfig.requireApprovalGatesForPromotion,
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
  metrics: Record<string, unknown>;
}): Promise<void> {
  const loraJobId = params.fineTuningJob.loraJobId;
  if (!loraJobId) {
    throw new Error(`fine_tuning_job sem loraJobId: ${params.fineTuningJob.id}`);
  }
  if (!params.fineTuningJob.tenantId) {
    throw new Error(`fine_tuning_job sem tenantId: ${params.fineTuningJob.id}`);
  }
  const scopedModelRegistry = assertValidModelRegistryScope({
    namespaceId: params.fineTuningJob.scopeNamespaceId,
    agentId: params.fineTuningJob.scopeAgentId,
  });
  const redis = getRedisClient();
  if (!redis) {
    throw new Error(`Redis indisponivel para lock de promocao automatica: ${params.fineTuningJob.id}`);
  }
  const lockKey = buildTrainingScopeOperationLockKey({
    scope: {
      tenantId: params.fineTuningJob.tenantId,
      namespaceId: scopedModelRegistry.namespaceId,
      agentId: scopedModelRegistry.agentId,
    },
    operation: 'promote',
  });
  const lockHandle = await acquireTrainingOperationLock({
    redis,
    key: lockKey,
    ttlSeconds: TRAINING_AUTO_PROMOTION_LOCK_TTL_SECONDS,
  });
  if (!lockHandle) {
    throw new Error(`Promocao automatica em andamento neste escopo: ${params.fineTuningJob.id}`);
  }

  try {
    await params.db.update(schema.fineTuningJobs)
      .set({ promotionStatus: 'activating' })
      .where(eq(schema.fineTuningJobs.id, params.fineTuningJob.id));

    try {
      const activationResult = await activateLoraAdapter(loraJobId, null);
      const modelVersionScopeCondition = buildModelVersionScopeCondition(scopedModelRegistry);
      const fineTuningScopeCondition = buildFineTuningScopeCondition(scopedModelRegistry);

      const [modelVersion] = await params.db.transaction(async (tx) => {
        const latestScopedVersion = await tx.query.modelVersions.findFirst({
          where: and(
            eq(schema.modelVersions.tenantId, params.fineTuningJob.tenantId as string),
            modelVersionScopeCondition
          ),
          orderBy: [desc(schema.modelVersions.version)],
          columns: { version: true },
        });
        const activeScopedVersion = await tx.query.modelVersions.findFirst({
          where: and(
            eq(schema.modelVersions.tenantId, params.fineTuningJob.tenantId as string),
            modelVersionScopeCondition,
            eq(schema.modelVersions.isActive, true)
          ),
          orderBy: [desc(schema.modelVersions.version)],
          columns: { id: true, metrics: true },
        });

        await tx.update(schema.modelVersions)
          .set({
            isActive: false,
            status: 'deprecated',
            deprecadoEm: new Date(),
          })
          .where(and(
            eq(schema.modelVersions.tenantId, params.fineTuningJob.tenantId as string),
            modelVersionScopeCondition,
            eq(schema.modelVersions.isActive, true)
          ));

        await tx.update(schema.fineTuningJobs)
          .set({ promotionStatus: 'archived' })
          .where(and(
            eq(schema.fineTuningJobs.tenantId, params.fineTuningJob.tenantId as string),
            fineTuningScopeCondition,
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
        const baselineMetrics = isRecord(activeScopedVersion?.metrics)
          ? activeScopedVersion.metrics
          : {};

        const [createdVersion] = await tx.insert(schema.modelVersions).values({
          tenantId: params.fineTuningJob.tenantId,
          namespaceId: scopedModelRegistry.namespaceId,
          agentId: scopedModelRegistry.agentId,
          name: `${params.fineTuningJob.name}-v${nextVersion}`,
          version: nextVersion,
          baseModel: params.fineTuningJob.baseModel,
          loraPath: activationResult.adapterPath,
          status: 'active',
          fineTuningJobId: params.fineTuningJob.id,
          trainingDataCount: params.fineTuningJob.trainingDataCount ?? 0,
          imageDataCount,
          metrics: params.metrics,
          baselineMetrics,
          isActive: true,
          ativadoEm: new Date(),
        }).returning();

        await tx.update(schema.fineTuningJobs)
          .set({
            modelVersionId: createdVersion.id,
            promotionStatus: 'active',
          })
          .where(eq(schema.fineTuningJobs.id, params.fineTuningJob.id));

        await tx.insert(schema.auditLogs).values({
          tenantId: params.fineTuningJob.tenantId,
          userId: null,
          acao: 'training_model_promoted',
          recurso: 'fine_tuning_job',
          recursoId: params.fineTuningJob.id,
          detalhes: {
            after: {
              modelVersionId: createdVersion.id,
              promotionStatus: 'active',
            },
            metadata: {
              operation: 'promote',
              trigger: 'auto_scheduled',
              scope: scopedModelRegistry,
              loraJobId,
              previousActiveModelVersionId: activeScopedVersion?.id ?? null,
            },
          },
          ip: null,
          userAgent: null,
        });

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
    } catch (promotionError) {
      await params.db.update(schema.fineTuningJobs)
        .set({
          promotionStatus: 'failed_activation',
          errorMessage: promotionError instanceof Error ? promotionError.message : String(promotionError),
        })
        .where(eq(schema.fineTuningJobs.id, params.fineTuningJob.id));
      throw promotionError;
    }
  } finally {
    await releaseTrainingOperationLock({
      redis,
      handle: lockHandle,
    }).catch((lockError) => {
      runnerLogger.warn(
        { lockKey: lockHandle.key, error: lockError instanceof Error ? lockError.message : String(lockError) },
        'Falha ao liberar lock de promocao automatica'
      );
    });
  }
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
        runPriority: runnerConfig.runPriority,
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
      gpuPriority: runnerConfig.runPriority,
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
            splitPolicy: manifest.splitPolicy,
            manifestHash: manifest.manifestHash,
            trainingRowIds: manifest.trainingRowIds,
            validationRowIds: manifest.validationRowIds,
            holdoutRowIds: manifest.holdoutRowIds,
            datasetRowIds: manifest.datasetIds,
            total: manifest.total,
            training: manifest.training,
            validation: manifest.validation,
            holdout: manifest.holdout,
          },
        };
        fineTuningMetrics = {
          ...fineTuningMetrics,
          dataset: {
            total: manifest.total,
            training: manifest.training,
            validation: manifest.validation,
            holdout: manifest.holdout,
            splitPolicy: manifest.splitPolicy,
            datasetManifestHash: manifest.manifestHash,
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
    const datasetMetrics = isRecord(fineTuningMetrics.dataset)
      ? fineTuningMetrics.dataset
      : {};
    const holdoutCount = typeof datasetMetrics.holdout === 'number'
      ? datasetMetrics.holdout
      : 0;
    const datasetManifestHash = typeof datasetMetrics.datasetManifestHash === 'string'
      ? datasetMetrics.datasetManifestHash
      : null;
    const hasStableEvalArtifact = holdoutCount > 0 && Boolean(datasetManifestHash);
    const evaluationStatus = hasStableEvalArtifact
      ? resolveEvaluationStatus(
          loraMetrics,
          runnerConfig.evalMaxLoss
        )
      : 'failed';
    if (!hasStableEvalArtifact) {
      fineTuningMetrics = {
        ...fineTuningMetrics,
        evaluation: {
          status: 'failed',
          reason: 'missing_holdout_or_dataset_manifest',
          holdoutCount,
          datasetManifestHash,
          at: new Date().toISOString(),
        },
      };
    }
    const autoPromotionBlockedByApprovalGates = (
      fineTuningJob.runSource === 'scheduled'
      && runnerConfig.autoPromoteScheduled
      && runnerConfig.requireApprovalGatesForPromotion
      && evaluationStatus === 'passed'
    );
    if (autoPromotionBlockedByApprovalGates) {
      fineTuningMetrics = {
        ...fineTuningMetrics,
        promotion: {
          autoPromoteScheduled: true,
          status: 'waiting_approvals',
          reason: 'promotion_approval_gates_required',
          at: new Date().toISOString(),
        },
      };
    }
    const autoPromotionEnabled = fineTuningJob.runSource === 'scheduled'
      && runnerConfig.autoPromoteScheduled
      && !autoPromotionBlockedByApprovalGates;
    const promotionStatus = resolveFineTuningPromotionStatus({
      evaluationStatus,
      requireEvalPassedForPromotion: runnerConfig.requireEvalPassedForPromotion,
    });

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
            promotionStatus: 'failed_activation',
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
