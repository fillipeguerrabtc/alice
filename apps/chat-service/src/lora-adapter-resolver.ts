/**
 * LoRA Adapter Resolver (Chat Service) - Alice Enterprise Platform
 *
 * Resolve adapter ativo por contexto (tenant/namespace/agent) para cumprir
 * a política de binding obrigatório em fluxos de chat.
 */

import { createLogger } from '@alice/logger';
import { getRedisClient } from '@alice/shared-utils';
import { Counter, Histogram } from 'prom-client';

const logger = createLogger('chat-lora-adapter-resolver');

const loraResolveCounter = new Counter({
  name: 'alice_chat_lora_resolve_total',
  help: 'Total de resoluções de modelo LoRA no chat-service por resultado',
  labelNames: ['result'] as const,
});

const loraResolveLatency = new Histogram({
  name: 'alice_chat_lora_resolve_duration_seconds',
  help: 'Latência de resolução de adapter LoRA no chat-service',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
});

const loraCacheCounter = new Counter({
  name: 'alice_chat_lora_cache_total',
  help: 'Total de acessos ao cache Redis de adapter LoRA no chat-service',
  labelNames: ['status'] as const,
});

const CACHE_TTL_SECONDS = 60;
const TRAINING_SERVICE_URL = process.env.TRAINING_SERVICE_URL || 'http://alice-training:3004';
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || '';
const STRICT_BINDING_POLICY = process.env.LORA_STRICT_BINDING === 'true';

interface ActiveAdapterInfo {
  jobId: string;
  adapterName: string;
  adapterPath: string;
  activatedAt: string | null;
  jobName: string;
}

export interface AdapterResolveContext {
  tenantId?: string;
  namespaceId?: string;
  agentId?: string;
}

export async function resolveModelWithAdapter(baseModel: string, context?: AdapterResolveContext): Promise<string> {
  const startTime = performance.now();
  try {
    const adapter = await resolveAdapterByPolicy(context);
    const durationSec = (performance.now() - startTime) / 1000;
    loraResolveLatency.observe(durationSec);

    if (adapter) {
      loraResolveCounter.inc({ result: 'adapter' });
      logger.debug(
        {
          adapterName: adapter.adapterName,
          jobId: adapter.jobId,
          context,
          baseModel,
          durationMs: Math.round(durationSec * 1000),
        },
        'Usando LoRA adapter ativo no chat-service'
      );
      return adapter.adapterName;
    }

    if (STRICT_BINDING_POLICY && (context?.namespaceId || context?.agentId)) {
      throw new Error('Política estrita LoRA: adapter obrigatório não encontrado para o escopo informado');
    }

    loraResolveCounter.inc({ result: 'base' });
  } catch (error) {
    const durationSec = (performance.now() - startTime) / 1000;
    loraResolveLatency.observe(durationSec);
    loraResolveCounter.inc({ result: 'error' });
    if (STRICT_BINDING_POLICY && (context?.namespaceId || context?.agentId)) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        baseModel,
      },
      'Falha ao resolver adapter LoRA no chat-service - fallback para modelo base'
    );
  }

  return baseModel;
}

async function resolveAdapterByPolicy(context?: AdapterResolveContext): Promise<ActiveAdapterInfo | null> {
  if (!context?.tenantId && !context?.namespaceId && !context?.agentId) {
    return getActiveAdapterCached(undefined);
  }

  if (context?.agentId) {
    const byAgent = await getActiveAdapterCached(context);
    if (byAgent) return byAgent;
  }

  if (context?.namespaceId) {
    const byNamespace = await getActiveAdapterCached({
      tenantId: context.tenantId,
      namespaceId: context.namespaceId,
    });
    if (byNamespace) return byNamespace;
  }

  return null;
}

export function buildCacheKey(context?: AdapterResolveContext): string {
  const tenant = context?.tenantId ?? 'none';
  const namespace = context?.namespaceId ?? 'none';
  const agent = context?.agentId ?? 'none';
  return `alice:chat:lora:active-adapter:${tenant}:${namespace}:${agent}`;
}

async function getActiveAdapterCached(context?: AdapterResolveContext): Promise<ActiveAdapterInfo | null> {
  const redis = getRedisClient();
  const cacheKey = buildCacheKey(context);

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) {
        loraCacheCounter.inc({ status: 'hit' });
        if (cached === 'null') return null;
        return JSON.parse(cached) as ActiveAdapterInfo;
      }
      loraCacheCounter.inc({ status: 'miss' });
    } catch (cacheError) {
      loraCacheCounter.inc({ status: 'error' });
      logger.warn(
        { error: cacheError instanceof Error ? cacheError.message : String(cacheError) },
        'Falha ao ler cache Redis de adapter LoRA no chat-service'
      );
    }
  }

  const adapter = await fetchActiveAdapterFromTrainingService(context);

  if (redis) {
    try {
      const cacheValue = adapter ? JSON.stringify(adapter) : 'null';
      await redis.set(cacheKey, cacheValue, { EX: CACHE_TTL_SECONDS });
    } catch (cacheError) {
      logger.warn(
        { error: cacheError instanceof Error ? cacheError.message : String(cacheError) },
        'Falha ao gravar cache Redis de adapter LoRA no chat-service'
      );
    }
  }

  return adapter;
}

async function fetchActiveAdapterFromTrainingService(context?: AdapterResolveContext): Promise<ActiveAdapterInfo | null> {
  try {
    const query = new URLSearchParams();
    if (context?.tenantId) query.set('tenantId', context.tenantId);
    if (context?.namespaceId) query.set('namespaceId', context.namespaceId);
    if (context?.agentId) query.set('agentId', context.agentId);

    const url = `${TRAINING_SERVICE_URL}/api/training/lora/active${query.size > 0 ? `?${query.toString()}` : ''}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Secret': INTERNAL_API_SECRET,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status, context },
        'Training service retornou status não-OK ao consultar adapter ativo no chat-service'
      );
      return null;
    }

    const data = (await response.json()) as { adapter: ActiveAdapterInfo | null };
    return data.adapter ?? null;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), context },
      'Falha HTTP ao consultar adapter ativo no training-service (chat-service)'
    );
    return null;
  }
}
