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
import { GpuServiceType, GpuRequestPriority } from './index.js';

const logger = createLogger('gpu-client');

const GPU_MANAGER_URL = process.env.GPU_MANAGER_URL || 'http://localhost:3010';

/**
 * DEFAULT_TIMEOUT: Timeout padrão para requisições GPU (ms)
 * Lê GPU_SERVICE_TIMEOUT do ambiente para consistência com gpu-manager-service
 * Default: 60000ms (60s)
 */
const DEFAULT_TIMEOUT = parseInt(process.env.GPU_SERVICE_TIMEOUT || '60000', 10);

// BUG FIX 25/12/2025: INTERNAL_API_SECRET é obrigatório para autenticação service-to-service
// Este arquivo é usado pelo GPU Manager Service para fazer requisições internas a si mesmo
// (polling de resultados de requisições assíncronas)
function getInternalApiSecretOrThrow(): string {
  const internalApiSecret = process.env.INTERNAL_API_SECRET?.trim();
  if (!internalApiSecret) {
    const message = 'INTERNAL_API_SECRET é obrigatório para autenticação service-to-service';
    logger.error(message);
    throw new Error(message);
  }
  return internalApiSecret;
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
  const internalApiSecret = getInternalApiSecretOrThrow();
  
  try {
    // Enfileirar requisição
    // BUG FIX 25/12/2025: Adicionar header X-Internal-Api-Secret para autenticação service-to-service
    // O requireInternalAuth middleware espera este header em todos os endpoints não-health
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
        timeout: options.timeout || DEFAULT_TIMEOUT,
        maxRetries: options.maxRetries || 3,
        metadata: options.metadata,
      }),
    });
    
    if (!queueResponse.ok) {
      // BUG FIX 25/12/2025: Extrair texto de erro para debugging
      // Sem o texto de erro, desenvolvedores não conseguem diagnosticar problemas
      const errorText = await queueResponse.text();
      throw new Error(`Erro ao enfileirar requisição GPU: ${queueResponse.status} - ${errorText}`);
    }
    
    const { requestId } = await queueResponse.json() as { requestId: string };
    
    // Polling para obter resultado
    const pollInterval = 500; // 500ms
    const maxWaitTime = options.timeout || DEFAULT_TIMEOUT;
    const startPollTime = Date.now();
    
    while (Date.now() - startPollTime < maxWaitTime) {
      // BUG FIX 25/12/2025: Adicionar header X-Internal-Api-Secret para autenticação service-to-service
      // O requireInternalAuth middleware espera este header em todos os endpoints não-health
      const resultResponse = await fetch(`${GPU_MANAGER_URL}/api/gpu/queue/${requestId}`, {
        headers: {
          'X-Internal-Api-Secret': internalApiSecret,
          ...options.headers,
        },
      });
      
      if (resultResponse.status === 404) {
        // Resultado ainda não está pronto, aguardar
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        continue;
      }
      
      if (!resultResponse.ok) {
        // BUG FIX 25/12/2025: Extrair texto de erro para debugging
        // Sem o texto de erro, desenvolvedores não conseguem diagnosticar problemas
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
  // BUG FIX 25/12/2025: Adicionar header X-Internal-Api-Secret para autenticação service-to-service
  // O requireInternalAuth middleware espera este header em todos os endpoints não-health
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
      timeout: options.timeout || DEFAULT_TIMEOUT,
      maxRetries: options.maxRetries || 3,
      metadata: options.metadata,
    }),
  });
  
  if (!queueResponse.ok) {
    // BUG FIX 25/12/2025: Extrair texto de erro para debugging
    // Sem o texto de erro, desenvolvedores não conseguem diagnosticar problemas
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
  // BUG FIX 25/12/2025: Adicionar header X-Internal-Api-Secret para autenticação service-to-service
  // O requireInternalAuth middleware espera este header em todos os endpoints não-health
  const response = await fetch(`${GPU_MANAGER_URL}/api/gpu/queue/${requestId}`, {
    headers: {
      'X-Internal-Api-Secret': internalApiSecret,
    },
  });
  
  if (response.status === 404) {
    return null; // Ainda não está pronto
  }
  
  if (!response.ok) {
    // BUG FIX 25/12/2025: Extrair texto de erro para debugging
    // Sem o texto de erro, desenvolvedores não conseguem diagnosticar problemas
    const errorText = await response.text();
    throw new Error(`Erro ao obter resultado GPU: ${response.status} - ${errorText}`);
  }
  
  return response.json() as Promise<GpuResponse>;
}

