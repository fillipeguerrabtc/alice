/**
 * Modulo System Config - Configuracoes editaveis via UI.
 *
 * Valores em DB tem precedencia sobre variaveis de ambiente.
 * Cache em memoria com TTL 60s para reduzir latencia.
 *
 * Chaves:
 * - RAG/Chat: DOCUMENT_MAX_CHUNKS, TRAINING_DOC_MAX_SAMPLES,
 *   TRAINING_CONVERSATION_MAX_MESSAGES, CONVERSATION_SLICE_SIZE
 * - Training: MIN_ONDEMAND_DATASET_SIZE, MIN_SCHEDULED_DATASET_SIZE_INCREMENTAL,
 *   MIN_SCHEDULED_DATASET_SIZE_FULL, TRAINING_QUALITY_MIN_RATIO,
 *   TRAINING_DATASET_MAX_ROWS, TRAINING_TRAIN_EVAL_SPLIT_RATIO,
 *   TRAINING_SLICE_STEPS, TRAINING_GPU_TIMEOUT_MS, TRAINING_DEFAULT_HYPERPARAMS_JSON,
 *   TRAINING_PRESET_SAFE_JSON, TRAINING_PRESET_STANDARD_JSON, TRAINING_PRESET_LARGE_JSON,
 *   TRAINING_EVAL_MAX_LOSS, TRAINING_AUTO_PROMOTE_SCHEDULED,
 *   TRAINING_MAX_INFLIGHT_RUNS_PER_TENANT, TRAINING_PROMOTION_REQUIRE_EVAL_PASSED,
 *   TRAINING_PROMOTION_REQUIRE_DUAL_APPROVAL, TRAINING_PROMOTION_MIN_APPROVALS,
 *   AUTO_LEARNING_CRON_INCREMENTAL, AUTO_LEARNING_CRON_FULL, AUTO_LEARNING_INCLUDE_IMAGES,
 *   maxSeqLen
 */

import { eq } from 'drizzle-orm';
import { getDatabase } from '@alice/database';
import * as schema from '@alice/shared';
import { createLogger } from '@alice/logger';

const logger = createLogger('system-config');

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export const SYSTEM_CONFIG_KNOWN_KEYS = [
  'DOCUMENT_MAX_CHUNKS',
  'TRAINING_DOC_MAX_SAMPLES',
  'TRAINING_CONVERSATION_MAX_MESSAGES',
  'CONVERSATION_SLICE_SIZE',
  'MIN_ONDEMAND_DATASET_SIZE',
  'MIN_SCHEDULED_DATASET_SIZE_INCREMENTAL',
  'MIN_SCHEDULED_DATASET_SIZE_FULL',
  'TRAINING_QUALITY_MIN_RATIO',
  'TRAINING_DATASET_MAX_ROWS',
  'TRAINING_TRAIN_EVAL_SPLIT_RATIO',
  'TRAINING_SLICE_STEPS',
  'TRAINING_GPU_TIMEOUT_MS',
  'TRAINING_DEFAULT_HYPERPARAMS_JSON',
  'TRAINING_PRESET_SAFE_JSON',
  'TRAINING_PRESET_STANDARD_JSON',
  'TRAINING_PRESET_LARGE_JSON',
  'TRAINING_EVAL_MAX_LOSS',
  'TRAINING_AUTO_PROMOTE_SCHEDULED',
  'TRAINING_MAX_INFLIGHT_RUNS_PER_TENANT',
  'TRAINING_PROMOTION_REQUIRE_EVAL_PASSED',
  'TRAINING_PROMOTION_REQUIRE_DUAL_APPROVAL',
  'TRAINING_PROMOTION_MIN_APPROVALS',
  'AUTO_LEARNING_CRON_INCREMENTAL',
  'AUTO_LEARNING_CRON_FULL',
  'AUTO_LEARNING_INCLUDE_IMAGES',
  'maxSeqLen',
] as const;

export type SystemConfigKnownKey = (typeof SYSTEM_CONFIG_KNOWN_KEYS)[number];

function invalidateCache(key?: string): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}

/**
 * Obtem valor de configuracao do DB (com cache 60s).
 * Retorna null se nao existir.
 */
export async function getSystemConfig(key: string): Promise<string | null> {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.value;
  }

  try {
    const db = getDatabase();
    const row = await db
      .select({ value: schema.systemConfig.value })
      .from(schema.systemConfig)
      .where(eq(schema.systemConfig.key, key))
      .limit(1);

    const value = row[0]?.value ?? null;
    if (value !== null) {
      cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return value;
  } catch (error) {
    logger.warn({ key, error }, 'Erro ao ler system_config, usando env como fallback');
    return null;
  }
}

/**
 * Define valor de configuracao no DB.
 * Invalida cache para a chave.
 */
export async function setSystemConfig(key: string, value: string): Promise<void> {
  const db = getDatabase();
  await db
    .insert(schema.systemConfig)
    .values({
      key,
      value,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.systemConfig.key,
      set: {
        value,
        updatedAt: new Date(),
      },
    });

  invalidateCache(key);
}

/**
 * Obtem todas as configuracoes de sistema (DB + chaves conhecidas).
 * Util para API GET que retorna valores atuais (DB ou env).
 */
export async function getAllSystemConfig(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const k of SYSTEM_CONFIG_KNOWN_KEYS) {
    const fromDb = await getSystemConfig(k);
    if (fromDb !== null) {
      result[k] = fromDb;
    } else {
      const envVal = process.env[k];
      result[k] = envVal ?? getEnvDefault(k);
    }
  }
  return result;
}

function getEnvDefault(key: string): string {
  const defaults: Record<string, string> = {
    DOCUMENT_MAX_CHUNKS: '50',
    TRAINING_DOC_MAX_SAMPLES: '50',
    TRAINING_CONVERSATION_MAX_MESSAGES: '50',
    CONVERSATION_SLICE_SIZE: '10',
    MIN_ONDEMAND_DATASET_SIZE: '20',
    MIN_SCHEDULED_DATASET_SIZE_INCREMENTAL: '50',
    MIN_SCHEDULED_DATASET_SIZE_FULL: '200',
    TRAINING_QUALITY_MIN_RATIO: '0.60',
    TRAINING_DATASET_MAX_ROWS: '5000',
    TRAINING_TRAIN_EVAL_SPLIT_RATIO: '0.90',
    TRAINING_SLICE_STEPS: '10',
    TRAINING_GPU_TIMEOUT_MS: '120000',
    TRAINING_DEFAULT_HYPERPARAMS_JSON: JSON.stringify({
      epochs: 2,
      learningRate: 0.0001,
      batchSize: 2,
      maxSeqLen: 1536,
      gradientAccumulationSteps: 4,
      warmupSteps: 100,
      loraRank: 16,
      loraAlpha: 32,
      loraDropout: 0.05,
    }),
    TRAINING_PRESET_SAFE_JSON: JSON.stringify({
      epochs: 2,
      learningRate: 0.0001,
      batchSize: 2,
      maxSeqLen: 1536,
      gradientAccumulationSteps: 4,
      warmupSteps: 100,
      loraRank: 16,
      loraAlpha: 32,
      loraDropout: 0.05,
    }),
    TRAINING_PRESET_STANDARD_JSON: JSON.stringify({
      epochs: 3,
      learningRate: 0.0002,
      batchSize: 2,
      maxSeqLen: 1536,
      gradientAccumulationSteps: 4,
      warmupSteps: 100,
      loraRank: 16,
      loraAlpha: 32,
      loraDropout: 0.05,
    }),
    TRAINING_PRESET_LARGE_JSON: JSON.stringify({
      epochs: 1,
      learningRate: 0.0001,
      batchSize: 2,
      maxSeqLen: 1536,
      gradientAccumulationSteps: 8,
      warmupSteps: 100,
      loraRank: 16,
      loraAlpha: 32,
      loraDropout: 0.05,
    }),
    TRAINING_EVAL_MAX_LOSS: '2.0',
    TRAINING_AUTO_PROMOTE_SCHEDULED: 'false',
    TRAINING_MAX_INFLIGHT_RUNS_PER_TENANT: '5',
    TRAINING_PROMOTION_REQUIRE_EVAL_PASSED: 'true',
    TRAINING_PROMOTION_REQUIRE_DUAL_APPROVAL: 'false',
    TRAINING_PROMOTION_MIN_APPROVALS: '2',
    AUTO_LEARNING_CRON_INCREMENTAL: '0 3 * * 0',
    AUTO_LEARNING_CRON_FULL: '0 1 1,15 * *',
    AUTO_LEARNING_INCLUDE_IMAGES: 'true',
    maxSeqLen: '1536',
  };
  return defaults[key] ?? '';
}
