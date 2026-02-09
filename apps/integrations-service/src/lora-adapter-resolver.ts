/**
 * LoRA Adapter Resolver - Alice Enterprise Platform
 *
 * Resolve qual modelo usar nas chamadas LLM: modelo base ou adapter LoRA ativo.
 * Consulta o training-service para saber se há adapter ativo, com cache Redis
 * para minimizar chamadas HTTP entre serviços.
 *
 * Arquitetura:
 * - Cache Redis com TTL 60s para evitar consultas frequentes ao banco
 * - Fallback para modelo base se adapter não disponível
 * - vLLM suporta AWQ + LoRA (confirmado docs oficiais v0.12.0+)
 * - Adapter name: "trading-global" (filesystem resolver do vLLM)
 *
 * Autor: Fillipe Guerra
 * Data: 09 de Fevereiro de 2026
 */

import { createLogger } from '@alice/logger';
import { getRedisClient } from '@alice/shared-utils';
import { Counter, Histogram } from 'prom-client';

const logger = createLogger('lora-adapter-resolver');

// ============================================================================
// Métricas Prometheus
// ============================================================================

/** Contador de resoluções de modelo por resultado (adapter|base|error) */
const loraResolveCounter = new Counter({
  name: 'alice_lora_resolve_total',
  help: 'Total de resoluções de modelo LoRA por resultado',
  labelNames: ['result'] as const,
});

/** Histograma de latência de resolução de adapter */
const loraResolveLatency = new Histogram({
  name: 'alice_lora_resolve_duration_seconds',
  help: 'Latência da resolução de adapter LoRA (incluindo cache/HTTP)',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
});

/** Contador de cache hits/misses */
const loraCacheCounter = new Counter({
  name: 'alice_lora_cache_total',
  help: 'Total de acessos ao cache Redis de adapter LoRA',
  labelNames: ['status'] as const,
});

/** Nome do adapter LoRA ativo no filesystem resolver do vLLM */
const LORA_ADAPTER_NAME = 'trading-global';
/** Chave Redis para cache do adapter ativo */
const REDIS_CACHE_KEY = 'alice:lora:active-adapter';
/** TTL do cache em segundos (consulta ao training-service a cada 60s) */
const CACHE_TTL_SECONDS = 60;
/** URL do training-service para consultar adapter ativo */
const TRAINING_SERVICE_URL = process.env.TRAINING_SERVICE_URL || 'http://alice-training:3004';
/** Secret para comunicação interna entre serviços */
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || '';

interface ActiveAdapterInfo {
  jobId: string;
  adapterName: string;
  adapterPath: string;
  activatedAt: string | null;
  jobName: string;
}

/**
 * Resolve o nome do modelo a usar na chamada LLM.
 * Se houver adapter LoRA ativo, retorna o nome do adapter.
 * Caso contrário, retorna o modelo base fornecido.
 *
 * @param baseModel - Nome do modelo base (ex: "Qwen/Qwen2.5-7B-Instruct-AWQ")
 * @returns Nome do modelo a usar na requisição ao vLLM
 */
export async function resolveModelWithAdapter(baseModel: string): Promise<string> {
  const startTime = performance.now();
  try {
    const adapter = await getActiveAdapterCached();
    const durationSec = (performance.now() - startTime) / 1000;
    loraResolveLatency.observe(durationSec);

    if (adapter) {
      loraResolveCounter.inc({ result: 'adapter' });
      logger.debug({
        adapterName: adapter.adapterName,
        jobId: adapter.jobId,
        baseModel,
        durationMs: Math.round(durationSec * 1000),
      }, 'Usando LoRA adapter ativo para inferência');
      return adapter.adapterName;
    }

    loraResolveCounter.inc({ result: 'base' });
  } catch (error) {
    const durationSec = (performance.now() - startTime) / 1000;
    loraResolveLatency.observe(durationSec);
    loraResolveCounter.inc({ result: 'error' });
    // Fallback para modelo base em caso de erro (cache miss + HTTP failure)
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), baseModel },
      'Falha ao resolver adapter LoRA - usando modelo base como fallback'
    );
  }

  return baseModel;
}

/**
 * Consulta o adapter ativo com cache Redis.
 * Cache miss → consulta HTTP ao training-service → armazena no Redis.
 */
async function getActiveAdapterCached(): Promise<ActiveAdapterInfo | null> {
  const redis = getRedisClient();

  // 1. Verificar cache Redis
  if (redis) {
    try {
      const cached = await redis.get(REDIS_CACHE_KEY);
      if (cached !== null) {
        loraCacheCounter.inc({ status: 'hit' });
        // Cache hit: "null" (string) = sem adapter, JSON = adapter ativo
        if (cached === 'null') {
          return null;
        }
        return JSON.parse(cached) as ActiveAdapterInfo;
      }
      loraCacheCounter.inc({ status: 'miss' });
    } catch (cacheError) {
      loraCacheCounter.inc({ status: 'error' });
      logger.warn(
        { error: cacheError instanceof Error ? cacheError.message : String(cacheError) },
        'Falha ao ler cache Redis de adapter LoRA (continuando com HTTP)'
      );
    }
  }

  // 2. Cache miss - consultar training-service
  const adapter = await fetchActiveAdapterFromTrainingService();

  // 3. Armazenar no cache Redis (mesmo se null, para evitar consultas repetidas)
  if (redis) {
    try {
      const cacheValue = adapter ? JSON.stringify(adapter) : 'null';
      await redis.set(REDIS_CACHE_KEY, cacheValue, { EX: CACHE_TTL_SECONDS });
    } catch (cacheError) {
      logger.warn(
        { error: cacheError instanceof Error ? cacheError.message : String(cacheError) },
        'Falha ao gravar cache Redis de adapter LoRA (não bloqueante)'
      );
    }
  }

  return adapter;
}

/**
 * Consulta HTTP ao training-service para obter adapter ativo.
 * Timeout conservador de 5s para não impactar latência de geração de sinais.
 */
async function fetchActiveAdapterFromTrainingService(): Promise<ActiveAdapterInfo | null> {
  try {
    const response = await fetch(`${TRAINING_SERVICE_URL}/api/training/lora/active`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Secret': INTERNAL_API_SECRET,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status },
        'Resposta não-OK do training-service ao consultar adapter ativo'
      );
      return null;
    }

    const data = await response.json() as { adapter: ActiveAdapterInfo | null };
    return data.adapter ?? null;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Falha ao consultar training-service para adapter LoRA ativo'
    );
    return null;
  }
}

/**
 * Invalida o cache de adapter ativo no Redis.
 * Chamado quando um novo adapter é ativado ou desativado.
 */
export async function invalidateAdapterCache(): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.del(REDIS_CACHE_KEY);
      logger.info('Cache de adapter LoRA invalidado');
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'Falha ao invalidar cache de adapter LoRA'
      );
    }
  }
}

export { LORA_ADAPTER_NAME };
