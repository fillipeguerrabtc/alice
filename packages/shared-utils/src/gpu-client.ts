/**
 * GPU Client - Cliente para GPU Manager Service
 * 
 * Cliente TypeScript para fazer requisições ao GPU Manager Service
 * com retry, timeout e tratamento de erros enterprise.
 * 
 * Autor: Fillipe Guerra
 * Data: 25 de Dezembro de 2025
 */

import { createLogger } from '@alice/logger';

const logger = createLogger('gpu-client');

// BUG FIX 25/12/2025: Container name correto é alice-gpu-manager (definido em docker-compose.prod.yml)
// URL padrão deve corresponder ao container_name, não ao service name
const GPU_MANAGER_URL = process.env.GPU_MANAGER_URL || 'http://alice-gpu-manager:3010';
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || '';

/** Prioridades de requisições GPU (maior = mais prioritário) */
export enum GpuRequestPriority {
  CRITICAL = 10,  // Chat em tempo real
  HIGH = 8,       // Trading (time-sensitive)
  MEDIUM = 5,     // Embeddings (RAG)
  LOW = 2,        // Geração de imagens, ASR
}

/** Tipos de serviços GPU */
export enum GpuServiceType {
  MIXTRAL = 'mixtral',           // LLM (Mixtral 8x7B)
  EMBEDDINGS = 'embeddings',     // Qwen3 + OpenCLIP
  FLUX = 'flux',                 // Geração de imagens
  ASR = 'asr',                   // Transcrição de áudio
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
  
  try {
    // Enfileirar requisição
    const queueResponse = await fetch(`${GPU_MANAGER_URL}/api/gpu/queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Secret': INTERNAL_API_SECRET,
        ...options.headers,
      },
      body: JSON.stringify({
        serviceType: options.serviceType,
        priority: options.priority || GpuRequestPriority.MEDIUM,
        endpoint: options.endpoint,
        method: options.method || 'POST',
        body: options.body,
        timeout: options.timeout || 60000,
        maxRetries: options.maxRetries || 3,
        metadata: options.metadata,
      }),
    });
    
    if (!queueResponse.ok) {
      const errorText = await queueResponse.text();
      throw new Error(`Erro ao enfileirar requisição GPU: ${queueResponse.status} - ${errorText}`);
    }
    
    const { requestId } = await queueResponse.json() as { requestId: string };
    
    // Polling para obter resultado
    const pollInterval = 500; // 500ms
    const maxWaitTime = options.timeout || 60000;
    const startPollTime = Date.now();
    
    while (Date.now() - startPollTime < maxWaitTime) {
      const resultResponse = await fetch(`${GPU_MANAGER_URL}/api/gpu/queue/${requestId}`, {
        headers: {
          'X-Internal-Api-Secret': INTERNAL_API_SECRET,
          ...options.headers,
        },
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
      
      const result: GpuResponse = await resultResponse.json();
      
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
  const queueResponse = await fetch(`${GPU_MANAGER_URL}/api/gpu/queue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Api-Secret': INTERNAL_API_SECRET,
      ...options.headers,
    },
    body: JSON.stringify({
      serviceType: options.serviceType,
      priority: options.priority || GpuRequestPriority.MEDIUM,
      endpoint: options.endpoint,
      method: options.method || 'POST',
      body: options.body,
      timeout: options.timeout || 60000,
      maxRetries: options.maxRetries || 3,
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
  const response = await fetch(`${GPU_MANAGER_URL}/api/gpu/queue/${requestId}`, {
    headers: {
      'X-Internal-Api-Secret': INTERNAL_API_SECRET,
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
  // BUG FIX 25/12/2025: O GPU Manager Service não deve fazer proxy - ele deve apenas verificar
  // circuit breaker e VRAM, depois retornar o Response diretamente para que o chat-service possa fazer o proxy.
  // Isso permite que o chat-service leia o stream sem que o body seja consumido.
  
  const response = await fetch(`${GPU_MANAGER_URL}/api/gpu/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Api-Secret': INTERNAL_API_SECRET,
      ...options.headers,
    },
    body: JSON.stringify({
      serviceType: options.serviceType,
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

