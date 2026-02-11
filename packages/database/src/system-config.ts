/**
 * Módulo System Config - Configurações editáveis via UI
 *
 * Valores em DB têm precedência sobre variáveis de ambiente.
 * Cache em memória com TTL 60s para reduzir latência.
 *
 * Chaves: DOCUMENT_MAX_CHUNKS, TRAINING_DOC_MAX_SAMPLES,
 * TRAINING_CONVERSATION_MAX_MESSAGES, CONVERSATION_SLICE_SIZE,
 * MIN_ONDEMAND_DATASET_SIZE, maxSeqLen
 *
 * Ref: docs/TREINAMENTO-LIMITES-E-BOAS-PRATICAS.md
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
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

function invalidateCache(key?: string): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}

/**
 * Obtém valor de configuração do DB (com cache 60s).
 * Retorna null se não existir.
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
 * Define valor de configuração no DB.
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
 * Obtém todas as configurações de sistema (DB + chaves conhecidas).
 * Útil para API GET que retorna valores atuais (DB ou env).
 */
export async function getAllSystemConfig(): Promise<Record<string, string>> {
  const knownKeys = [
    'DOCUMENT_MAX_CHUNKS',
    'TRAINING_DOC_MAX_SAMPLES',
    'TRAINING_CONVERSATION_MAX_MESSAGES',
    'CONVERSATION_SLICE_SIZE',
    'MIN_ONDEMAND_DATASET_SIZE',
    'maxSeqLen',
  ] as const;

  const result: Record<string, string> = {};
  for (const k of knownKeys) {
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
    MIN_ONDEMAND_DATASET_SIZE: '10',
    maxSeqLen: '2048',
  };
  return defaults[key] ?? '';
}
