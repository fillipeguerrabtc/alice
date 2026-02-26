/**
 * LoRA Adapter Resolver (Chat Service) - Alice Enterprise Platform
 *
 * Wrapper do SSOT de roteamento de LoRA em @alice/shared-utils.
 */

import { createLogger } from '@alice/logger';
import { buildLlmAdapterCacheKey, resolveLlmModelByScope } from '@alice/shared-utils';
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

const CACHE_TTL_SECONDS = 60;
const TRAINING_SERVICE_URL = process.env.TRAINING_SERVICE_URL?.trim();
if (!TRAINING_SERVICE_URL) {
  throw new Error('TRAINING_SERVICE_URL é obrigatório para resolver adapter LoRA no chat-service');
}
const STRICT_BINDING_POLICY = process.env.LORA_STRICT_BINDING === 'true';
const CACHE_PREFIX = 'alice:chat:lora:active-adapter';

export interface AdapterResolveContext {
  tenantId?: string;
  namespaceId?: string;
  agentId?: string;
}

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
      logger.debug(
        {
          adapterName: resolvedModel,
          context,
          baseModel,
          durationMs: Math.round(durationSec * 1000),
        },
        'Usando LoRA adapter ativo no chat-service'
      );
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
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        baseModel,
      },
      'Falha ao resolver adapter LoRA no chat-service - fallback para modelo base'
    );
    return baseModel;
  }
}

export function buildCacheKey(context?: AdapterResolveContext): string {
  return buildLlmAdapterCacheKey(CACHE_PREFIX, context);
}
