/**
 * GPU Client - Cliente para GPU Manager Service
 * 
 * Cliente TypeScript para fazer requisições ao GPU Manager Service
 * com retry, timeout e tratamento de erros enterprise.
 * 
 * ARQUITETURA GPU (Gate 2):
 * - LLM (texto), Embeddings e Training são serviços locais
 * - Vision e ASR via OpenAI
 * - O tipo do serviço é **capability-based** (modelo-agnóstico) para evitar
 *   mudanças em dashboards/alertas quando os modelos forem trocados.
 * 
 * Autor: Fillipe Guerra
 * Data: 15 de Janeiro de 2026
 */

import { createLogger } from '@alice/logger';

const logger = createLogger('gpu-client');

// BUG FIX 25/12/2025: Container name correto é alice-gpu-manager (definido em docker-compose.prod.yml)
// URL padrão deve corresponder ao container_name, não ao service name
const GPU_MANAGER_URL = process.env.GPU_MANAGER_URL || 'http://alice-gpu-manager:3010';
// BUG FIX 25/12/2025: REGRA 6 - Fail-fast em TODOS os ambientes (não só produção)
// INTERNAL_API_SECRET é obrigatório para autenticação service-to-service
// Validação apenas em produção permite que código continue silenciosamente em desenvolvimento
// com fallback || '' enviando string vazia no header, permitindo requisições não autenticadas
// Solução: Validar fail-fast em todos os ambientes para garantir segurança
function getInternalApiSecretOrThrow(): string {
  const internalApiSecret = process.env.INTERNAL_API_SECRET?.trim();
  if (!internalApiSecret) {
    const message = 'INTERNAL_API_SECRET é obrigatório (Regra 6 - fail-fast) - configure a variável de ambiente';
    logger.error(message);
    throw new Error(message);
  }
  return internalApiSecret;
}

function parseEnvInt(value: string | undefined, defaultValue: number, name: string): number {
  const raw = (value ?? String(defaultValue)).trim();
  if (!/^\d+$/.test(raw)) {
    const message = `${name} inválido: "${raw}". Deve ser inteiro positivo.`;
    logger.error({ name, raw }, message);
    throw new Error(message);
  }
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const message = `${name} inválido: "${raw}". Deve ser inteiro positivo.`;
    logger.error({ name, raw, parsed }, message);
    throw new Error(message);
  }
  return parsed;
}

const GPU_REQUEST_DEFAULT_TIMEOUT_MS = parseEnvInt(
  process.env.GPU_REQUEST_TIMEOUT_MS,
  60000,
  'GPU_REQUEST_TIMEOUT_MS'
);
const GPU_REQUEST_DEFAULT_MAX_RETRIES = parseEnvInt(
  process.env.GPU_REQUEST_MAX_RETRIES,
  3,
  'GPU_REQUEST_MAX_RETRIES'
);
const GPU_REQUEST_FETCH_TIMEOUT_MS = parseEnvInt(
  process.env.GPU_REQUEST_FETCH_TIMEOUT_MS,
  30000,
  'GPU_REQUEST_FETCH_TIMEOUT_MS'
);
const GPU_REQUEST_POLL_INTERVAL_MS = parseEnvInt(
  process.env.GPU_REQUEST_POLL_INTERVAL_MS,
  500,
  'GPU_REQUEST_POLL_INTERVAL_MS'
);
const GPU_REQUEST_POLL_FETCH_TIMEOUT_MS = parseEnvInt(
  process.env.GPU_REQUEST_POLL_FETCH_TIMEOUT_MS,
  5000,
  'GPU_REQUEST_POLL_FETCH_TIMEOUT_MS'
);

/** Prioridades de requisições GPU (maior = mais prioritário) */
export enum GpuRequestPriority {
  CRITICAL = 10,  // Chat em tempo real
  HIGH = 8,       // Trading (time-sensitive)
  MEDIUM = 5,     // Embeddings (RAG)
  LOW = 2,        // Operações batch (treinamento, tarefas auxiliares)
}

/** Tipos de serviços GPU - Gate 2 (LLM separado + Embeddings + Training) */
export enum GpuServiceType {
  LLM = 'llm',                   // LLM (texto) - ex: Qwen2.5 7B (vLLM)
  EMBEDDINGS = 'embeddings',     // Text embeddings (GPU)
  TRAINING = 'training',         // Fine-tuning (QLoRA) - sob demanda
}

export interface GpuRequestOptions {
  serviceType: GpuServiceType;
  endpoint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  priority?: GpuRequestPriority;
  timeout?: number;
  maxRetries?: number;
  metadata?: Record<string, unknown>;
}

export interface GpuResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  latencyMs: number;
  vramUsedGB?: number;
}

/**
 * Enfileira requisição GPU e aguarda resultado
 */
export async function requestGpu(options: GpuRequestOptions): Promise<GpuResponse> {
  const startTime = Date.now();
  const maxWaitTime = options.timeout || GPU_REQUEST_DEFAULT_TIMEOUT_MS;
  const internalApiSecret = getInternalApiSecretOrThrow();
  // BUG FIX 26/12/2025: Timeout individual para cada fetch (30s ou metade do maxWaitTime)
  // Impede que uma única requisição bloqueie indefinidamente além do timeout total
  const fetchTimeout = Math.min(GPU_REQUEST_FETCH_TIMEOUT_MS, Math.floor(maxWaitTime / 2));
  
  try {
    // Enfileirar requisição
    // BUG FIX 26/12/2025: Adicionar AbortSignal.timeout() para garantir timeout individual
    const queueResponse = await fetch(`${GPU_MANAGER_URL}/api/gpu/queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Secret': internalApiSecret,
        ...options.headers,
      },
      body: JSON.stringify({
        serviceType: options.serviceType,
        priority: options.priority || GpuRequestPriority.MEDIUM,
        endpoint: options.endpoint,
        method: options.method || 'POST',
        body: options.body,
        timeout: options.timeout || GPU_REQUEST_DEFAULT_TIMEOUT_MS,
        maxRetries: options.maxRetries || GPU_REQUEST_DEFAULT_MAX_RETRIES,
        metadata: options.metadata,
      }),
      signal: AbortSignal.timeout(fetchTimeout),
    });
    
    if (!queueResponse.ok) {
      const errorText = await queueResponse.text();
      throw new Error(`Erro ao enfileirar requisição GPU: ${queueResponse.status} - ${errorText}`);
    }
    
    const { requestId } = await queueResponse.json() as { requestId: string };
    
    // Polling para obter resultado
    const pollInterval = GPU_REQUEST_POLL_INTERVAL_MS;
    const startPollTime = Date.now();
    // BUG FIX 26/12/2025: Timeout individual para polling (5s) - menor que fetchTimeout
    // Polling é leve e frequente, não precisa de timeout longo
    const pollFetchTimeout = GPU_REQUEST_POLL_FETCH_TIMEOUT_MS;
    
    while (Date.now() - startPollTime < maxWaitTime) {
      // BUG FIX 26/12/2025: Adicionar AbortSignal.timeout() ao fetch do polling
      // Sem isso, um único fetch pode bloquear indefinidamente, excedendo maxWaitTime
      const resultResponse = await fetch(`${GPU_MANAGER_URL}/api/gpu/queue/${requestId}`, {
        headers: {
          'X-Internal-Api-Secret': internalApiSecret,
          ...options.headers,
        },
        signal: AbortSignal.timeout(pollFetchTimeout),
      });
      
      if (resultResponse.status === 404) {
        // Resultado ainda não está pronto, aguardar
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        continue;
      }
      
      if (!resultResponse.ok) {
        const errorText = await resultResponse.text();
        throw new Error(`Erro ao obter resultado GPU: ${resultResponse.status} - ${errorText}`);
      }
      
      const result = await resultResponse.json() as GpuResponse;
      
      if (!result.success) {
        throw new Error(result.error || 'Erro desconhecido no processamento GPU');
      }
      
      logger.info({
        requestId,
        serviceType: options.serviceType,
        latencyMs: result.latencyMs,
        totalLatencyMs: Date.now() - startTime,
      }, 'Requisição GPU concluída');
      
      return result;
    }
    
    throw new Error(`Timeout aguardando resultado GPU (${maxWaitTime}ms)`);
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      serviceType: options.serviceType,
    }, 'Erro ao processar requisição GPU');
    throw error;
  }
}

/**
 * Requisição assíncrona (não aguarda resultado)
 */
export async function requestGpuAsync(options: GpuRequestOptions): Promise<string> {
  const internalApiSecret = getInternalApiSecretOrThrow();
  const queueResponse = await fetch(`${GPU_MANAGER_URL}/api/gpu/queue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Api-Secret': internalApiSecret,
      ...options.headers,
    },
    body: JSON.stringify({
      serviceType: options.serviceType,
      priority: options.priority || GpuRequestPriority.MEDIUM,
      endpoint: options.endpoint,
      method: options.method || 'POST',
      body: options.body,
      timeout: options.timeout || GPU_REQUEST_DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries || GPU_REQUEST_DEFAULT_MAX_RETRIES,
      metadata: options.metadata,
    }),
  });
  
  if (!queueResponse.ok) {
    const errorText = await queueResponse.text();
    throw new Error(`Erro ao enfileirar requisição GPU: ${queueResponse.status} - ${errorText}`);
  }
  
  const { requestId } = await queueResponse.json() as { requestId: string };
  return requestId;
}

/**
 * Obtém resultado de requisição assíncrona
 */
export async function getGpuResult(requestId: string): Promise<GpuResponse | null> {
  const internalApiSecret = getInternalApiSecretOrThrow();
  const response = await fetch(`${GPU_MANAGER_URL}/api/gpu/queue/${requestId}`, {
    headers: {
      'X-Internal-Api-Secret': internalApiSecret,
    },
  });
  
  if (response.status === 404) {
    return null; // Ainda não está pronto
  }
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro ao obter resultado GPU: ${response.status} - ${errorText}`);
  }
  
  return response.json() as Promise<GpuResponse>;
}

/**
 * Requisição GPU com streaming (proxy direto via GPU Manager Service)
 * BUG FIX 25/12/2025: Streaming passa pelo GPU Manager Service para verificação de circuit breaker e VRAM
 * 
 * IMPORTANTE: O GPU Manager Service NÃO faz proxy - ele apenas verifica circuit breaker e VRAM,
 * depois retorna o Response diretamente para que o chat-service possa fazer o proxy.
 */
export async function requestGpuStream(options: GpuRequestOptions): Promise<globalThis.Response> {
  const internalApiSecret = getInternalApiSecretOrThrow();
  // BUG FIX 25/12/2025: O GPU Manager Service não deve fazer proxy - ele deve apenas verificar
  // circuit breaker e VRAM, depois retornar o Response diretamente para que o chat-service possa fazer o proxy.
  // Isso permite que o chat-service leia o stream sem que o body seja consumido.
  
  const response = await fetch(`${GPU_MANAGER_URL}/api/gpu/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Api-Secret': internalApiSecret,
      ...options.headers,
    },
    body: JSON.stringify({
      serviceType: options.serviceType,
      priority: options.priority || GpuRequestPriority.CRITICAL, // Streaming = chat em tempo real = prioridade máxima
      endpoint: options.endpoint,
      method: options.method || 'POST',
      body: options.body,
      timeout: options.timeout || 60000,
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro na requisição GPU streaming: ${response.status} - ${errorText}`);
  }
  
  // BUG FIX 25/12/2025: O GPU Manager Service agora retorna o Response sem consumir o body.
  // O chat-service pode ler o stream diretamente.
  if (!response.body) {
    throw new Error('Resposta de streaming não contém body');
  }
  
  return response;
}
