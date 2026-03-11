import type { Logger } from 'pino';
import { readOptionalStringEnv } from '@alice/config';
import {
  CIRCUIT_BREAKER_PRESETS,
  createProtectedFetch,
} from '@alice/shared-utils';
import { GpuServiceType } from './gpu-contracts.js';

function resolveGpuServiceUrl(envKey: string, fallbackUrl: string, logger: Logger): string {
  const rawUrl = readOptionalStringEnv(envKey) ?? fallbackUrl;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Protocolo inválido para ${envKey}: ${parsed.protocol}`);
    }
    return rawUrl.replace(/\/+$/, '');
  } catch (error) {
    logger.error({ envKey, rawUrl, error }, 'URL de serviço GPU inválida');
    process.exit(1);
  }
}

export function createGpuServiceClients(logger: Logger): {
  gpuServiceUrls: Record<GpuServiceType, string>;
  protectedFetchByServiceType: Record<GpuServiceType, ReturnType<typeof createProtectedFetch>['fetch']>;
} {
  const gpuServiceUrls: Record<GpuServiceType, string> = {
    [GpuServiceType.LLM]: resolveGpuServiceUrl('LLM_GPU_URL', 'http://gpu-llm:8000', logger),
    [GpuServiceType.EMBEDDINGS]: resolveGpuServiceUrl('EMBEDDINGS_GPU_URL', 'http://gpu-embeddings:8000', logger),
    [GpuServiceType.TRAINING]: resolveGpuServiceUrl('TRAINING_GPU_URL', 'http://gpu-trainer:8000', logger),
  };

  const gpuServiceClients = {
    [GpuServiceType.LLM]: createProtectedFetch({
      name: 'gpu-llm',
      ...CIRCUIT_BREAKER_PRESETS.gpuLLM,
    }),
    [GpuServiceType.EMBEDDINGS]: createProtectedFetch({
      name: 'gpu-embeddings',
      ...CIRCUIT_BREAKER_PRESETS.embeddingsGPU,
    }),
    [GpuServiceType.TRAINING]: createProtectedFetch({
      name: 'gpu-trainer',
      ...CIRCUIT_BREAKER_PRESETS.gpuManager,
    }),
  } as const;

  const protectedFetchByServiceType: Record<GpuServiceType, ReturnType<typeof createProtectedFetch>['fetch']> = {
    [GpuServiceType.LLM]: gpuServiceClients[GpuServiceType.LLM].fetch,
    [GpuServiceType.EMBEDDINGS]: gpuServiceClients[GpuServiceType.EMBEDDINGS].fetch,
    [GpuServiceType.TRAINING]: gpuServiceClients[GpuServiceType.TRAINING].fetch,
  };

  return {
    gpuServiceUrls,
    protectedFetchByServiceType,
  };
}

export function applyStructuredOutputs(params: {
  serviceType: GpuServiceType;
  endpoint: string;
  body?: unknown;
}): unknown {
  if (params.serviceType !== GpuServiceType.LLM) return params.body;
  if (!params.endpoint.includes('/v1/chat/completions')) return params.body;
  if (!params.body || typeof params.body !== 'object' || Array.isArray(params.body)) return params.body;

  const payload = { ...(params.body as Record<string, unknown>) };

  if (payload.extra_body) {
    delete payload.extra_body;
  }

  if (payload.structured_outputs) {
    delete payload.structured_outputs;
  }

  return payload;
}
