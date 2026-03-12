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
 *   TRAINING_PROMOTION_REQUIRE_APPROVAL_GATES, TRAINING_PROMOTION_REQUIRE_DUAL_APPROVAL,
 *   TRAINING_PROMOTION_MIN_APPROVALS,
 *   AUTO_LEARNING_CRON_INCREMENTAL, AUTO_LEARNING_CRON_FULL, AUTO_LEARNING_INCLUDE_IMAGES,
 *   maxSeqLen, HYBRID_ROUTING_DEFAULT_POLICY_JSON
 */

import { eq } from 'drizzle-orm';
import { getDatabase } from '@alice/database';
import * as schema from '@alice/shared';
import type { NamespaceProfileConfig } from '@alice/shared';
import { createLogger } from '@alice/logger';
import { z } from 'zod';

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
  'TRAINING_PROMOTION_REQUIRE_APPROVAL_GATES',
  'TRAINING_PROMOTION_REQUIRE_DUAL_APPROVAL',
  'TRAINING_PROMOTION_MIN_APPROVALS',
  'AUTO_LEARNING_CRON_INCREMENTAL',
  'AUTO_LEARNING_CRON_FULL',
  'AUTO_LEARNING_INCLUDE_IMAGES',
  'NAMESPACE_PROFILE_DEFAULT_CONFIG_JSON',
  'HYBRID_ROUTING_DEFAULT_POLICY_JSON',
  'maxSeqLen',
] as const;

export type SystemConfigKnownKey = (typeof SYSTEM_CONFIG_KNOWN_KEYS)[number];

const booleanStringSchema = z.string().transform((raw) => {
  const normalized = raw.trim().toLowerCase();
  if (normalized !== 'true' && normalized !== 'false') {
    throw new Error(`Valor booleano invalido: ${raw}`);
  }
  return normalized;
});

const integerRangeSchema = (min: number, max?: number) => z.string().transform((raw) => {
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < min || (max !== undefined && parsed > max)) {
    throw new Error(`Valor inteiro invalido: ${raw}`);
  }
  return String(parsed);
});

const numberRangeSchema = (min: number, max: number) => z.string().transform((raw) => {
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Valor numerico invalido: ${raw}`);
  }
  return String(parsed);
});

const cronSchema = z.string().transform((raw) => {
  const normalized = raw.trim().replace(/\s+/g, ' ');
  const parts = normalized.split(' ');
  if (parts.length !== 5) {
    throw new Error(`Expressao cron invalida: ${raw}`);
  }
  return normalized;
});

const jsonStringSchema = z.string().transform((raw) => {
  const parsed = JSON.parse(raw);
  return JSON.stringify(parsed);
});

const namespaceProfileDefaultConfigSchema = z.string().transform((raw) => {
  const parsed = JSON.parse(raw);
  const normalized = schema.NamespaceProfileConfigSchema.parse(parsed);
  return JSON.stringify(normalized);
});

const SYSTEM_CONFIG_VALIDATORS: Record<SystemConfigKnownKey, z.ZodType<string>> = {
  DOCUMENT_MAX_CHUNKS: integerRangeSchema(1, 500),
  TRAINING_DOC_MAX_SAMPLES: integerRangeSchema(1, 5000),
  TRAINING_CONVERSATION_MAX_MESSAGES: integerRangeSchema(1, 5000),
  CONVERSATION_SLICE_SIZE: integerRangeSchema(1, 5000),
  MIN_ONDEMAND_DATASET_SIZE: integerRangeSchema(1, 100000),
  MIN_SCHEDULED_DATASET_SIZE_INCREMENTAL: integerRangeSchema(1, 100000),
  MIN_SCHEDULED_DATASET_SIZE_FULL: integerRangeSchema(1, 100000),
  TRAINING_QUALITY_MIN_RATIO: numberRangeSchema(0, 1),
  TRAINING_DATASET_MAX_ROWS: integerRangeSchema(100, 1000000),
  TRAINING_TRAIN_EVAL_SPLIT_RATIO: numberRangeSchema(0.5, 0.99),
  TRAINING_SLICE_STEPS: integerRangeSchema(1, 100000),
  TRAINING_GPU_TIMEOUT_MS: integerRangeSchema(1000, 3600000),
  TRAINING_DEFAULT_HYPERPARAMS_JSON: jsonStringSchema,
  TRAINING_PRESET_SAFE_JSON: jsonStringSchema,
  TRAINING_PRESET_STANDARD_JSON: jsonStringSchema,
  TRAINING_PRESET_LARGE_JSON: jsonStringSchema,
  TRAINING_EVAL_MAX_LOSS: numberRangeSchema(0.0001, 1000),
  TRAINING_AUTO_PROMOTE_SCHEDULED: booleanStringSchema,
  TRAINING_MAX_INFLIGHT_RUNS_PER_TENANT: integerRangeSchema(1, 1000),
  TRAINING_PROMOTION_REQUIRE_EVAL_PASSED: booleanStringSchema,
  TRAINING_PROMOTION_REQUIRE_APPROVAL_GATES: booleanStringSchema,
  TRAINING_PROMOTION_REQUIRE_DUAL_APPROVAL: booleanStringSchema,
  TRAINING_PROMOTION_MIN_APPROVALS: integerRangeSchema(1, 10),
  AUTO_LEARNING_CRON_INCREMENTAL: cronSchema,
  AUTO_LEARNING_CRON_FULL: cronSchema,
  AUTO_LEARNING_INCLUDE_IMAGES: booleanStringSchema,
  NAMESPACE_PROFILE_DEFAULT_CONFIG_JSON: namespaceProfileDefaultConfigSchema,
  HYBRID_ROUTING_DEFAULT_POLICY_JSON: jsonStringSchema,
  maxSeqLen: integerRangeSchema(256, 32768),
};

export function normalizeSystemConfigValue(key: SystemConfigKnownKey, value: string): string {
  const validator = SYSTEM_CONFIG_VALIDATORS[key];
  return validator.parse(value);
}

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
  const normalizedValue = SYSTEM_CONFIG_KNOWN_KEYS.includes(key as SystemConfigKnownKey)
    ? normalizeSystemConfigValue(key as SystemConfigKnownKey, value)
    : value;
  const db = getDatabase();
  await db
    .insert(schema.systemConfig)
    .values({
      key,
      value: normalizedValue,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.systemConfig.key,
      set: {
        value: normalizedValue,
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
  const db = getDatabase();
  const rows = await db
    .select({ key: schema.systemConfig.key, value: schema.systemConfig.value })
    .from(schema.systemConfig);
  const valuesByKey = new Map(rows.map((row) => [row.key, row.value]));

  for (const key of SYSTEM_CONFIG_KNOWN_KEYS) {
    const fromDb = valuesByKey.get(key);
    if (fromDb !== undefined) {
      result[key] = fromDb;
      cache.set(key, { value: fromDb, expiresAt: Date.now() + CACHE_TTL_MS });
      continue;
    }
    const envVal = process.env[key];
    result[key] = envVal ?? getEnvDefault(key);
  }
  return result;
}

export async function getNamespaceProfileDefaultConfig(): Promise<NamespaceProfileConfig> {
  const raw = await getSystemConfig('NAMESPACE_PROFILE_DEFAULT_CONFIG_JSON');
  if (!raw) {
    throw new Error('NAMESPACE_PROFILE_DEFAULT_CONFIG_JSON ausente no system_config');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `JSON inválido em NAMESPACE_PROFILE_DEFAULT_CONFIG_JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return schema.NamespaceProfileConfigSchema.parse(parsed);
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
      lrSchedulerType: 'linear',
      maxGradNorm: 1,
      targetModules: ['q_proj', 'v_proj'],
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
      lrSchedulerType: 'linear',
      maxGradNorm: 1,
      targetModules: ['q_proj', 'v_proj'],
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
      lrSchedulerType: 'linear',
      maxGradNorm: 1,
      targetModules: ['q_proj', 'v_proj'],
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
      lrSchedulerType: 'linear',
      maxGradNorm: 1,
      targetModules: ['q_proj', 'v_proj'],
    }),
    TRAINING_EVAL_MAX_LOSS: '2.0',
    TRAINING_AUTO_PROMOTE_SCHEDULED: 'false',
    TRAINING_MAX_INFLIGHT_RUNS_PER_TENANT: '5',
    TRAINING_PROMOTION_REQUIRE_EVAL_PASSED: 'true',
    TRAINING_PROMOTION_REQUIRE_APPROVAL_GATES: 'true',
    TRAINING_PROMOTION_REQUIRE_DUAL_APPROVAL: 'false',
    TRAINING_PROMOTION_MIN_APPROVALS: '2',
    AUTO_LEARNING_CRON_INCREMENTAL: '0 3 * * 0',
    AUTO_LEARNING_CRON_FULL: '0 1 1,15 * *',
    AUTO_LEARNING_INCLUDE_IMAGES: 'true',
    NAMESPACE_PROFILE_DEFAULT_CONFIG_JSON: JSON.stringify({
      autoCollect: {
        enabled: true,
        requiresUserConsent: true,
        sampling: {
          enabled: true,
          rate: 0.5,
          deterministicKey: 'semhash',
        },
        caps: {
          dailyTenantCap: 1000,
          dailyNamespaceCap: 300,
          dailyUserCap: 100,
        },
        minChars: {
          user: 8,
          assistant: 16,
        },
        alwaysNeedsHumanReview: false,
        rejectIfDuplicate: false,
      },
      privacy: {
        enabled: true,
        rules: [],
        logRedactionSummary: true,
      },
      quality: {
        enabled: true,
        minScore: 0.35,
        autoRejectBelowMin: true,
        ruleBased: {
          enabled: true,
          weights: {
            coherence: 0.25,
            informativeness: 0.35,
            safety: 0.4,
          },
          requiredPatterns: [],
          bannedPatterns: [],
        },
        llmJudge: {
          enabled: false,
          model: 'Qwen/Qwen3-8B-AWQ',
          temperature: 0.1,
          maxTokens: 512,
          promptSystemConfigKey: 'TRAINING_LLM_JUDGE_PROMPT',
          schemaVersion: 'v1',
        },
      },
      dedupe: {
        scope: 'tenant',
        similarityThreshold: 0.95,
      },
      history: {
        relevanceThreshold: 0.12,
        alwaysIncludeCount: 4,
        minMessages: 0,
        fallbackEnabled: false,
        searchLimit: 200,
        searchTokenBudget: 1200,
        searchConversationsLimit: 20,
      },
      sla: {
        syncSeconds: 18,
        streamSeconds: 12,
        websocketSeconds: 12,
        websocketMediaSeconds: 18,
        externalSeconds: 20,
        titleSeconds: 6,
      },
      routing: {
        threshold: 0.08,
        gpuPriority: 'medium',
        promptTokenBudget: 2800,
      },
      llmGovernance: {},
    }),
    HYBRID_ROUTING_DEFAULT_POLICY_JSON: JSON.stringify({
      version: 1,
      enabled: true,
      thresholds: {
        autoAccept: 0.12,
        humanReview: 0.06,
        clusterAutoTagConfidence: 0.9,
        clusterAutoTagMinSize: 8,
      },
      transversalDefault: {
        enabled: true,
        defaultNamespaceSlug: 'default',
        greetingsToDefault: true,
        reuseGateToDefault: true,
        domainExceptionTerms: [
          'trade',
          'trading',
          'btc',
          'bitcoin',
          'eth',
          'ethereum',
          'futuros',
          'alavancagem',
          'leverage',
          'ordem',
          'sinal',
          'position',
          'kucoin',
          'binance',
          'compliance',
          'fiscal',
          'juridico',
          'contabilidade',
        ],
      },
      humanReview: {
        enabled: true,
        queueLowConfidenceRouting: true,
        highRiskRoutes: ['/trading', '/wise'],
      },
      exceptions: [],
    }),
    maxSeqLen: '1536',
  };
  return defaults[key] ?? '';
}
