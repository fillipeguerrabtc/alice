import { getAllSystemConfig, getSystemConfig } from '@alice/database/system-config';
import { createLogger } from '@alice/logger';
import {
  parseTrainingHyperparamsJson,
  type TrainingHyperparams,
} from '@alice/shared-utils';

const logger = createLogger('training-enterprise-config');

const TRAINING_HYPERPARAMS_SAFE_FALLBACK: TrainingHyperparams = {
  epochs: 3,
  learningRate: 0.0001,
  batchSize: 2,
  maxSeqLen: 1536,
  gradientAccumulationSteps: 2,
  warmupSteps: 0,
  loraRank: 16,
  loraAlpha: 32,
  loraDropout: 0.05,
  lrSchedulerType: 'linear',
  maxGradNorm: 1,
  targetModules: ['q_proj', 'v_proj'],
};

const TRAINING_ENTERPRISE_RAW_DEFAULTS = {
  MIN_ONDEMAND_DATASET_SIZE: '20',
  MIN_SCHEDULED_DATASET_SIZE_INCREMENTAL: '50',
  MIN_SCHEDULED_DATASET_SIZE_FULL: '200',
  TRAINING_QUALITY_MIN_RATIO: '0.60',
  TRAINING_DATASET_MAX_ROWS: '5000',
  TRAINING_TRAIN_EVAL_SPLIT_RATIO: '0.90',
  TRAINING_SLICE_STEPS: '10',
  TRAINING_GPU_TIMEOUT_MS: '120000',
  TRAINING_DEFAULT_HYPERPARAMS_JSON:
    '{"epochs":2,"learningRate":0.0001,"batchSize":2,"maxSeqLen":1536,"gradientAccumulationSteps":4,"warmupSteps":100,"loraRank":16,"loraAlpha":32,"loraDropout":0.05,"lrSchedulerType":"linear","maxGradNorm":1,"targetModules":["q_proj","v_proj"]}',
  TRAINING_PRESET_SAFE_JSON:
    '{"epochs":2,"learningRate":0.0001,"batchSize":2,"maxSeqLen":1536,"gradientAccumulationSteps":4,"warmupSteps":100,"loraRank":16,"loraAlpha":32,"loraDropout":0.05,"lrSchedulerType":"linear","maxGradNorm":1,"targetModules":["q_proj","v_proj"]}',
  TRAINING_PRESET_STANDARD_JSON:
    '{"epochs":3,"learningRate":0.0002,"batchSize":2,"maxSeqLen":1536,"gradientAccumulationSteps":4,"warmupSteps":100,"loraRank":16,"loraAlpha":32,"loraDropout":0.05,"lrSchedulerType":"linear","maxGradNorm":1,"targetModules":["q_proj","v_proj"]}',
  TRAINING_PRESET_LARGE_JSON:
    '{"epochs":1,"learningRate":0.0001,"batchSize":2,"maxSeqLen":1536,"gradientAccumulationSteps":8,"warmupSteps":100,"loraRank":16,"loraAlpha":32,"loraDropout":0.05,"lrSchedulerType":"linear","maxGradNorm":1,"targetModules":["q_proj","v_proj"]}',
} as const;

type TrainingEnterpriseConfigRawKey = keyof typeof TRAINING_ENTERPRISE_RAW_DEFAULTS;

export interface TrainingEnterpriseConfig {
  minOndemandDatasetSize: number;
  minScheduledIncremental: number;
  minScheduledFull: number;
  qualityMinRatio: number;
  datasetMaxRows: number;
  trainEvalSplitRatio: number;
  sliceSteps: number;
  gpuTimeoutMs: number;
  defaultHyperparams: TrainingHyperparams;
  presets: {
    safe: TrainingHyperparams;
    standard: TrainingHyperparams;
    large: TrainingHyperparams;
  };
}

interface ConfigRawValue {
  key: TrainingEnterpriseConfigRawKey;
  raw: string;
  fallbackRaw: string;
  source: 'db' | 'runtime' | 'fallback';
}

function getFallbackRawValue(key: TrainingEnterpriseConfigRawKey): string {
  const fromEnv = process.env[key];
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  return TRAINING_ENTERPRISE_RAW_DEFAULTS[key];
}

function tryParseInteger(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function tryParseFloat(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseIntWithFallback(params: {
  key: TrainingEnterpriseConfigRawKey;
  raw: string;
  fallbackRaw: string;
  source: ConfigRawValue['source'];
  min: number;
  max?: number;
}): number {
  const parsed = tryParseInteger(params.raw);
  const withinRange = parsed !== null
    && parsed >= params.min
    && (params.max === undefined || parsed <= params.max);
  if (withinRange) return parsed;

  logger.warn(
    {
      key: params.key,
      source: params.source,
      raw: params.raw,
      min: params.min,
      max: params.max ?? null,
      fallbackRaw: params.fallbackRaw,
    },
    'Configuracao numerica invalida; aplicando fallback'
  );

  const fallbackParsed = tryParseInteger(params.fallbackRaw);
  const fallbackWithinRange = fallbackParsed !== null
    && fallbackParsed >= params.min
    && (params.max === undefined || fallbackParsed <= params.max);
  if (fallbackWithinRange) return fallbackParsed;

  throw new Error(
    `Config "${params.key}" invalida. Valor: "${params.raw}". Fallback: "${params.fallbackRaw}".`
  );
}

function parseFloatWithFallback(params: {
  key: TrainingEnterpriseConfigRawKey;
  raw: string;
  fallbackRaw: string;
  source: ConfigRawValue['source'];
  min: number;
  max: number;
}): number {
  const parsed = tryParseFloat(params.raw);
  const withinRange = parsed !== null && parsed >= params.min && parsed <= params.max;
  if (withinRange) return parsed;

  logger.warn(
    {
      key: params.key,
      source: params.source,
      raw: params.raw,
      min: params.min,
      max: params.max,
      fallbackRaw: params.fallbackRaw,
    },
    'Configuracao decimal invalida; aplicando fallback'
  );

  const fallbackParsed = tryParseFloat(params.fallbackRaw);
  const fallbackWithinRange =
    fallbackParsed !== null && fallbackParsed >= params.min && fallbackParsed <= params.max;
  if (fallbackWithinRange) return fallbackParsed;

  throw new Error(
    `Config "${params.key}" invalida. Valor: "${params.raw}". Fallback: "${params.fallbackRaw}".`
  );
}

function parseHyperparamsWithSafeFallback(params: ConfigRawValue): TrainingHyperparams {
  try {
    return parseTrainingHyperparamsJson(params.raw);
  } catch (error) {
    logger.warn(
      {
        key: params.key,
        source: params.source,
        raw: params.raw,
        error: error instanceof Error ? error.message : String(error),
      },
      'JSON de hyperparams invalido; aplicando fallback SAFE alinhado ao trainer'
    );
    return { ...TRAINING_HYPERPARAMS_SAFE_FALLBACK };
  }
}

async function readConfigRawValue(
  key: TrainingEnterpriseConfigRawKey,
  allConfig: Record<string, string>
): Promise<ConfigRawValue> {
  const fallbackRaw = getFallbackRawValue(key);
  const fromDb = await getSystemConfig(key);
  if (typeof fromDb === 'string' && fromDb.trim().length > 0) {
    return { key, raw: fromDb, fallbackRaw, source: 'db' };
  }

  const fromRuntime = allConfig[key];
  if (typeof fromRuntime === 'string' && fromRuntime.trim().length > 0) {
    return { key, raw: fromRuntime, fallbackRaw, source: 'runtime' };
  }

  return { key, raw: fallbackRaw, fallbackRaw, source: 'fallback' };
}

export async function loadTrainingEnterpriseConfig(): Promise<TrainingEnterpriseConfig> {
  const allConfig = await getAllSystemConfig();

  const [
    minOndemandDatasetSizeRaw,
    minScheduledIncrementalRaw,
    minScheduledFullRaw,
    qualityMinRatioRaw,
    datasetMaxRowsRaw,
    trainEvalSplitRatioRaw,
    sliceStepsRaw,
    gpuTimeoutMsRaw,
    defaultHyperparamsRaw,
    presetSafeRaw,
    presetStandardRaw,
    presetLargeRaw,
  ] = await Promise.all([
    readConfigRawValue('MIN_ONDEMAND_DATASET_SIZE', allConfig),
    readConfigRawValue('MIN_SCHEDULED_DATASET_SIZE_INCREMENTAL', allConfig),
    readConfigRawValue('MIN_SCHEDULED_DATASET_SIZE_FULL', allConfig),
    readConfigRawValue('TRAINING_QUALITY_MIN_RATIO', allConfig),
    readConfigRawValue('TRAINING_DATASET_MAX_ROWS', allConfig),
    readConfigRawValue('TRAINING_TRAIN_EVAL_SPLIT_RATIO', allConfig),
    readConfigRawValue('TRAINING_SLICE_STEPS', allConfig),
    readConfigRawValue('TRAINING_GPU_TIMEOUT_MS', allConfig),
    readConfigRawValue('TRAINING_DEFAULT_HYPERPARAMS_JSON', allConfig),
    readConfigRawValue('TRAINING_PRESET_SAFE_JSON', allConfig),
    readConfigRawValue('TRAINING_PRESET_STANDARD_JSON', allConfig),
    readConfigRawValue('TRAINING_PRESET_LARGE_JSON', allConfig),
  ]);

  const defaultHyperparams = parseHyperparamsWithSafeFallback(defaultHyperparamsRaw);

  return {
    minOndemandDatasetSize: parseIntWithFallback({
      ...minOndemandDatasetSizeRaw,
      min: 1,
    }),
    minScheduledIncremental: parseIntWithFallback({
      ...minScheduledIncrementalRaw,
      min: 1,
    }),
    minScheduledFull: parseIntWithFallback({
      ...minScheduledFullRaw,
      min: 1,
    }),
    qualityMinRatio: parseFloatWithFallback({
      ...qualityMinRatioRaw,
      min: 0,
      max: 1,
    }),
    datasetMaxRows: parseIntWithFallback({
      ...datasetMaxRowsRaw,
      min: 100,
    }),
    trainEvalSplitRatio: parseFloatWithFallback({
      ...trainEvalSplitRatioRaw,
      min: 0.5,
      max: 0.99,
    }),
    sliceSteps: parseIntWithFallback({
      ...sliceStepsRaw,
      min: 1,
    }),
    gpuTimeoutMs: parseIntWithFallback({
      ...gpuTimeoutMsRaw,
      min: 1000,
    }),
    defaultHyperparams,
    presets: {
      safe: parseHyperparamsWithSafeFallback(presetSafeRaw),
      standard: parseHyperparamsWithSafeFallback(presetStandardRaw),
      large: parseHyperparamsWithSafeFallback(presetLargeRaw),
    },
  };
}
