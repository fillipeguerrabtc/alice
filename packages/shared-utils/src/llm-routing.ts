/**
 * LLM Routing Utilities - Alice Enterprise Platform
 *
 * Fonte única para resolução de modelo com LoRA por escopo
 * (tenant/namespace/agent) com cache Redis e fallback controlado.
 *
 * @module @alice/shared-utils/llm-routing
 */

import { createLogger } from './logger.js';
import { getRedisClient } from './redis-cache-adapter.js';

const logger = createLogger('llm-routing');

const DEFAULT_CACHE_TTL_SECONDS = 60;
const DEFAULT_TRAINING_SERVICE_URL = process.env.TRAINING_SERVICE_URL || 'http://alice-training:3004';
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || '';
const STRICT_BINDING_POLICY = process.env.LORA_STRICT_BINDING === 'true';

export interface LlmScopeContext {
  tenantId?: string;
  namespaceId?: string;
  agentId?: string;
}

export interface ActiveAdapterInfo {
  jobId: string;
  adapterName: string;
  adapterPath: string;
  activatedAt: string | null;
  jobName: string;
}

interface ResolveModelOptions {
  cachePrefix: string;
  strictBinding?: boolean;
  cacheTtlSeconds?: number;
  trainingServiceUrl?: string;
}

interface AdapterLookupOptions {
  cachePrefix: string;
  cacheTtlSeconds: number;
  trainingServiceUrl: string;
}

/**
 * Resolve modelo para chamada LLM:
 * - retorna adapterName quando existe adapter ativo no escopo;
 * - retorna baseModel quando não existe adapter (ou falha não-crítica);
 * - em modo strict lança erro quando contexto exige adapter.
 */
export async function resolveLlmModelByScope(
  baseModel: string,
  context: LlmScopeContext | undefined,
  options: ResolveModelOptions
): Promise<string> {
  const strictBinding = options.strictBinding ?? STRICT_BINDING_POLICY;
  const adapter = await resolveActiveAdapterForScope(context, {
    cachePrefix: options.cachePrefix,
    cacheTtlSeconds: options.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS,
    trainingServiceUrl: options.trainingServiceUrl ?? DEFAULT_TRAINING_SERVICE_URL,
  });

  if (adapter) return adapter.adapterName;

  if (strictBinding && (context?.namespaceId || context?.agentId)) {
    throw new Error('Política estrita LoRA: adapter obrigatório não encontrado para o escopo informado');
  }

  return baseModel;
}

/**
 * Resolve adapter ativo por política:
 * - prioridade 1: agentId
 * - prioridade 2: namespaceId
 * - fallback: sem escopo explícito (tenant/global)
 */
export async function resolveActiveAdapterForScope(
  context: LlmScopeContext | undefined,
  options: AdapterLookupOptions
): Promise<ActiveAdapterInfo | null> {
  if (!context?.tenantId && !context?.namespaceId && !context?.agentId) {
    return getActiveAdapterCached(undefined, options);
  }

  if (context?.agentId) {
    const byAgent = await getActiveAdapterCached(context, options);
    if (byAgent) return byAgent;
  }

  if (context?.namespaceId) {
    const byNamespace = await getActiveAdapterCached(
      { tenantId: context.tenantId, namespaceId: context.namespaceId },
      options
    );
    if (byNamespace) return byNamespace;
  }

  return getActiveAdapterCached({ tenantId: context?.tenantId }, options);
}

export function buildLlmAdapterCacheKey(cachePrefix: string, context?: LlmScopeContext): string {
  const tenant = context?.tenantId ?? 'none';
  const namespace = context?.namespaceId ?? 'none';
  const agent = context?.agentId ?? 'none';
  return `${cachePrefix}:${tenant}:${namespace}:${agent}`;
}

export async function invalidateLlmAdapterCache(cachePrefix: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    const keys = await redis.keys(`${cachePrefix}:*`);
    if (keys.length > 0) {
      await redis.del(keys);
    }
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), cachePrefix },
      'Falha ao invalidar cache de adapter LoRA'
    );
  }
}

async function getActiveAdapterCached(
  context: LlmScopeContext | undefined,
  options: AdapterLookupOptions
): Promise<ActiveAdapterInfo | null> {
  const redis = getRedisClient();
  const cacheKey = buildLlmAdapterCacheKey(options.cachePrefix, context);

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) {
        if (cached === 'null') return null;
        return JSON.parse(cached) as ActiveAdapterInfo;
      }
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error), cacheKey },
        'Falha ao ler cache de adapter LoRA'
      );
    }
  }

  const adapter = await fetchActiveAdapterFromTrainingService(context, options.trainingServiceUrl);

  if (redis) {
    try {
      const cacheValue = adapter ? JSON.stringify(adapter) : 'null';
      await redis.set(cacheKey, cacheValue, { EX: options.cacheTtlSeconds });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error), cacheKey },
        'Falha ao gravar cache de adapter LoRA'
      );
    }
  }

  return adapter;
}

async function fetchActiveAdapterFromTrainingService(
  context: LlmScopeContext | undefined,
  trainingServiceUrl: string
): Promise<ActiveAdapterInfo | null> {
  try {
    const query = new URLSearchParams();
    if (context?.tenantId) query.set('tenantId', context.tenantId);
    if (context?.namespaceId) query.set('namespaceId', context.namespaceId);
    if (context?.agentId) query.set('agentId', context.agentId);
    const url = `${trainingServiceUrl}/api/training/lora/active${query.size > 0 ? `?${query.toString()}` : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Secret': INTERNAL_API_SECRET,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;
    const data = (await response.json()) as { adapter: ActiveAdapterInfo | null };
    return data.adapter ?? null;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), context },
      'Falha HTTP ao consultar adapter ativo no training-service'
    );
    return null;
  }
}
