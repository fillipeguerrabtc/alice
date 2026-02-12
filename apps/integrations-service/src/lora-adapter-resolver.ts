/**
 * LoRA Adapter Resolver - Alice Enterprise Platform
 *
 * Wrapper do SSOT de roteamento de LoRA em @alice/shared-utils.
 */

import { createLogger } from '@alice/logger';
import {
  buildLlmAdapterCacheKey,
  invalidateLlmAdapterCache,
  resolveLlmModelByScope,
} from '@alice/shared-utils';
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

/** TTL do cache em segundos (consulta ao training-service a cada 60s) */
const CACHE_TTL_SECONDS = 60;
/** URL do training-service para consultar adapter ativo */
const TRAINING_SERVICE_URL = process.env.TRAINING_SERVICE_URL || 'http://alice-training:3004';
const STRICT_BINDING_POLICY = process.env.LORA_STRICT_BINDING === 'true';
const CACHE_PREFIX = 'alice:lora:active-adapter';

interface AdapterResolveContext {
  tenantId?: string;
  namespaceId?: string;
  agentId?: string;
}

/**
 * Resolve o nome do modelo a usar na chamada LLM.
 * Se houver adapter LoRA ativo, retorna o nome do adapter.
 * Caso contrário, retorna o modelo base fornecido.
 *
 * @param baseModel - Nome do modelo base (ex: "Qwen/Qwen2.5-7B-Instruct-AWQ")
 * @returns Nome do modelo a usar na requisição ao vLLM
 */
export async function resolveModelWithAdapter(baseModel: string, context?: AdapterResolveContext): Promise<string> {
  const startTime = performance.now();
  try {
    const resolvedModel = await resolveLlmModelByScope(baseModel, context, {
      cachePrefix: CACHE_PREFIX,
      strictBinding: STRICT_BINDING_POLICY,
      cacheTtlSeconds: CACHE_TTL_SECONDS,
      trainingServiceUrl: TRAINING_SERVICE_URL,
    });
    const durationSec = (performance.now() - startTime) / 1000;
    loraResolveLatency.observe(durationSec);

    if (resolvedModel !== baseModel) {
      loraResolveCounter.inc({ result: 'adapter' });
      logger.debug({
        adapterName: resolvedModel,
        context,
        baseModel,
        durationMs: Math.round(durationSec * 1000),
      }, 'Usando LoRA adapter ativo para inferência');
      return resolvedModel;
    }

    loraResolveCounter.inc({ result: 'base' });
    return resolvedModel;
  } catch (error) {
    const durationSec = (performance.now() - startTime) / 1000;
    loraResolveLatency.observe(durationSec);
    loraResolveCounter.inc({ result: 'error' });
    if (STRICT_BINDING_POLICY && (context?.namespaceId || context?.agentId)) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    // Fallback para modelo base apenas quando política estrita não está habilitada
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
export function buildCacheKey(context?: AdapterResolveContext): string {
  return buildLlmAdapterCacheKey(CACHE_PREFIX, context);
}

/**
 * Invalida o cache de adapter ativo no Redis.
 * Chamado quando um novo adapter é ativado ou desativado.
 */
export async function invalidateAdapterCache(): Promise<void> {
  await invalidateLlmAdapterCache(CACHE_PREFIX);
  logger.info('Cache de adapter LoRA invalidado');
}
