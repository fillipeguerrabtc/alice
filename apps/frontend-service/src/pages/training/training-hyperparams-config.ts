import { frontendLogger } from '@/lib/logger';
import {
  parseTrainingHyperparamsJson as parseSharedTrainingHyperparamsJson,
  type TrainingHyperparams,
} from '../../../../../packages/shared-utils/src/training-config';

export type TrainingHyperparamsPreset = 'safe' | 'standard' | 'large';

export const TRAINING_HYPERPARAMS_SAFE_FALLBACK: TrainingHyperparams = {
  epochs: 2,
  learningRate: 0.0001,
  batchSize: 2,
  maxSeqLen: 1536,
  gradientAccumulationSteps: 4,
  warmupSteps: 100,
  loraRank: 16,
  loraAlpha: 32,
  loraDropout: 0.05,
};

export const TRAINING_HYPERPARAMS_STANDARD_FALLBACK: TrainingHyperparams = {
  epochs: 3,
  learningRate: 0.0002,
  batchSize: 2,
  maxSeqLen: 1536,
  gradientAccumulationSteps: 4,
  warmupSteps: 100,
  loraRank: 16,
  loraAlpha: 32,
  loraDropout: 0.05,
};

export const TRAINING_HYPERPARAMS_LARGE_FALLBACK: TrainingHyperparams = {
  epochs: 1,
  learningRate: 0.0001,
  batchSize: 2,
  maxSeqLen: 1536,
  gradientAccumulationSteps: 8,
  warmupSteps: 100,
  loraRank: 16,
  loraAlpha: 32,
  loraDropout: 0.05,
};

export const TRAINING_SYSTEM_CONFIG_DEFAULTS = {
  MIN_ONDEMAND_DATASET_SIZE: '20',
  MIN_SCHEDULED_DATASET_SIZE_INCREMENTAL: '50',
  MIN_SCHEDULED_DATASET_SIZE_FULL: '200',
  TRAINING_QUALITY_MIN_RATIO: '0.60',
  TRAINING_DATASET_MAX_ROWS: '5000',
  TRAINING_TRAIN_EVAL_SPLIT_RATIO: '0.90',
  TRAINING_SLICE_STEPS: '10',
  TRAINING_GPU_TIMEOUT_MS: '120000',
  maxSeqLen: '1536',
  AUTO_LEARNING_CRON_INCREMENTAL: '0 3 * * 0',
  AUTO_LEARNING_CRON_FULL: '0 1 1,15 * *',
  AUTO_LEARNING_INCLUDE_IMAGES: 'true',
  TRAINING_DEFAULT_HYPERPARAMS_JSON: JSON.stringify(TRAINING_HYPERPARAMS_SAFE_FALLBACK),
  TRAINING_PRESET_SAFE_JSON: JSON.stringify(TRAINING_HYPERPARAMS_SAFE_FALLBACK),
  TRAINING_PRESET_STANDARD_JSON: JSON.stringify(TRAINING_HYPERPARAMS_STANDARD_FALLBACK),
  TRAINING_PRESET_LARGE_JSON: JSON.stringify(TRAINING_HYPERPARAMS_LARGE_FALLBACK),
} as const;

export function parseTrainingHyperparamsConfig(raw: string, key: string): TrainingHyperparams {
  try {
    return parseSharedTrainingHyperparamsJson(raw);
  } catch (error) {
    frontendLogger.warn('Configuracao de hyperparams invalida no system_config; aplicando fallback seguro', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    if (key === 'TRAINING_PRESET_STANDARD_JSON') {
      return { ...TRAINING_HYPERPARAMS_STANDARD_FALLBACK };
    }
    if (key === 'TRAINING_PRESET_LARGE_JSON') {
      return { ...TRAINING_HYPERPARAMS_LARGE_FALLBACK };
    }
    return { ...TRAINING_HYPERPARAMS_SAFE_FALLBACK };
  }
}
