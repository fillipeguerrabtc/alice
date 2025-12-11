/**
 * Factory de Circuit Breakers - Alice Enterprise Platform
 * 
 * Implementa Circuit Breaker pattern conforme Regra 16 (Best Practices 2025).
 * Protege contra falhas em cascata em serviços externos.
 * 
 * SEGURANÇA 2025: Integra AbortController para cancelar requisições HTTP em timeout.
 * Evita resource leaks quando o circuit breaker atinge timeout (Salad Cloud Guide 2025).
 * 
 * @module @alice/shared-utils/circuit-breaker
 */

import CircuitBreaker from 'opossum';
import { createLogger, Logger } from './logger.js';

const logger = createLogger('circuit-breaker');

/**
 * Configuração de Circuit Breaker
 */
export interface CircuitBreakerConfig {
  /** Nome identificador do circuit breaker */
  name: string;
  /** Timeout em ms para cada chamada (padrão: 30000) */
  timeout?: number;
  /** Percentual de erros para abrir o circuito (padrão: 50) */
  errorThresholdPercentage?: number;
  /** Tempo em ms para tentar reconectar (padrão: 30000) */
  resetTimeout?: number;
  /** Volume mínimo de requisições para considerar estatísticas (padrão: 5) */
  volumeThreshold?: number;
  /** Logger customizado */
  logger?: Logger;
}

/**
 * Configurações pré-definidas por tipo de serviço.
 * 
 * REGRA 2 (Não Duplicar): Todos os serviços DEVEM usar estes presets
 * em vez de definir suas próprias opções localmente.
 * 
 * @example
 * ```typescript
 * import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS } from '@alice/shared-utils';
 * 
 * const breaker = createCircuitBreaker(myAsyncFunction, {
 *   name: 'my-service',
 *   ...CIRCUIT_BREAKER_PRESETS.saladLLM,
 * });
 * ```
 */
export const CIRCUIT_BREAKER_PRESETS = {
  /** Serviço LLM Salad Cloud - timeout alto para inferência Llama 4 Maverick */
  saladLLM: {
    timeout: 60000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
  },
  /** FLUX.1 Schnell - geração de imagens (1-3s típico, timeout 30s) */
  fluxImageGen: {
    timeout: 30000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 3,
  },
  /** FLUX deployment management - operações de container (timeout alto) */
  saladDeployment: {
    timeout: 60000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 3,
  },
  /** CLIP ViT-L/14 embeddings - embeddings multimodais 100% local via CPU no Hetzner */
  clipEmbeddings: {
    timeout: 30000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
  },
  /** S3/Object Storage - operações de storage */
  s3Storage: {
    timeout: 30000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
  },
  /** Brave Search API - web search timeout baixo */
  webSearch: {
    timeout: 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 3,
  },
  /** Serviço RAG interno - timeout baixo */
  ragService: {
    timeout: 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 15000,
    volumeThreshold: 3,
  },
  /** Wise API - timeout moderado */
  wiseAPI: {
    timeout: 15000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
  },
  /** ERPNext API - timeout baixo */
  erpnextAPI: {
    timeout: 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
  },
  /** Stripe API - timeout moderado */
  stripeAPI: {
    timeout: 15000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
  },
  /** Twilio API - WhatsApp/SMS */
  twilioAPI: {
    timeout: 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
  },
  /** Resend API - emails transacionais */
  resendAPI: {
    timeout: 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
  },
  /** Health check interno - timeout curto */
  healthCheck: {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 10000,
    volumeThreshold: 3,
  },
  /** Integrations Service - comunicação entre microsserviços */
  integrationsService: {
    timeout: 15000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 3,
  },
  /** OAuth Provider (Google, GitHub) - autenticação externa (Regra 16) */
  oauthProvider: {
    timeout: 15000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
  },
  /** SAML IdP (Azure AD, Okta) - autenticação enterprise (Regra 16) */
  samlProvider: {
    timeout: 20000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
  },
  /** Database Pool - operações de banco de dados (Regra 16) */
  databasePool: {
    timeout: 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 15000,
    volumeThreshold: 5,
  },
  /** Text Embeddings local - multilingual-e5-base (CPU no Hetzner) - 100+ idiomas */
  /** Timeout moderado para serviço local (latência típica: 50-200ms) */
  textEmbeddings: {
    timeout: 30000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
  },
  /** FFmpeg - processamento de vídeo local (timeout alto) */
  ffmpeg: {
    timeout: 120000, // 2 minutos para vídeos longos
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 3,
  },
  /** Whisper - transcrição de áudio (timeout alto) */
  whisper: {
    timeout: 120000, // 2 minutos para áudios longos
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 3,
  },
  /** Default - configuração padrão para novos serviços */
  default: {
    timeout: 30000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
  },
} as const;

export type CircuitBreakerPreset = keyof typeof CIRCUIT_BREAKER_PRESETS;

/**
 * Estatísticas do Circuit Breaker
 */
export interface CircuitBreakerStats {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  successes: number;
  timeouts: number;
  rejects: number;
  fallbacks: number;
}

/**
 * Cria um Circuit Breaker configurado
 * 
 * @param action - Função assíncrona a ser protegida
 * @param config - Configuração do circuit breaker
 * @returns Circuit Breaker configurado
 * 
 * @example
 * ```typescript
 * import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS } from '@alice/shared-utils/circuit-breaker';
 * 
 * const apiCall = async (data: RequestData) => {
 *   const response = await fetch('https://api.example.com', { method: 'POST', body: JSON.stringify(data) });
 *   return response.json();
 * };
 * 
 * const breaker = createCircuitBreaker(apiCall, {
 *   name: 'example-api',
 *   ...CIRCUIT_BREAKER_PRESETS.saladLLM,
 * });
 * 
 * const result = await breaker.fire({ message: 'Hello' });
 * ```
 */
export function createCircuitBreaker<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
  config: CircuitBreakerConfig
): CircuitBreaker<TArgs, TResult> {
  const log = config.logger || logger;
  const name = config.name;

  const options = {
    timeout: config.timeout || 30000,
    errorThresholdPercentage: config.errorThresholdPercentage || 50,
    resetTimeout: config.resetTimeout || 30000,
    volumeThreshold: config.volumeThreshold || 5,
  };

  const breaker = new CircuitBreaker(action, options);

  breaker.on('open', () => {
    log.warn({ circuitBreaker: name, state: 'open' }, 
      `Circuit breaker ${name}: ABERTO - Serviço temporariamente indisponível`);
  });

  breaker.on('halfOpen', () => {
    log.info({ circuitBreaker: name, state: 'half-open' }, 
      `Circuit breaker ${name}: HALF-OPEN - Testando reconexão`);
  });

  breaker.on('close', () => {
    log.info({ circuitBreaker: name, state: 'closed' }, 
      `Circuit breaker ${name}: FECHADO - Serviço funcionando normalmente`);
  });

  breaker.on('fallback', () => {
    log.warn({ circuitBreaker: name }, 
      `Circuit breaker ${name}: Usando fallback`);
  });

  breaker.on('timeout', () => {
    log.warn({ circuitBreaker: name, timeout: options.timeout }, 
      `Circuit breaker ${name}: Timeout atingido`);
  });

  breaker.on('reject', () => {
    log.warn({ circuitBreaker: name }, 
      `Circuit breaker ${name}: Requisição rejeitada - circuito aberto`);
  });

  return breaker;
}

/**
 * Obtém estatísticas do Circuit Breaker
 * 
 * @param breaker - Instância do Circuit Breaker
 * @returns Estatísticas atuais
 */
export function getCircuitBreakerStats(breaker: CircuitBreaker): CircuitBreakerStats {
  let state: 'closed' | 'open' | 'half-open' = 'closed';
  
  if (breaker.opened) {
    state = 'open';
  } else if (breaker.halfOpen) {
    state = 'half-open';
  }

  return {
    state,
    failures: breaker.stats.failures,
    successes: breaker.stats.successes,
    timeouts: breaker.stats.timeouts,
    rejects: breaker.stats.rejects,
    fallbacks: breaker.stats.fallbacks,
  };
}

/**
 * Verifica se o Circuit Breaker está saudável (fechado)
 * 
 * @param breaker - Instância do Circuit Breaker
 * @returns true se o circuito está fechado
 */
export function isCircuitHealthy(breaker: CircuitBreaker): boolean {
  return !breaker.opened && !breaker.halfOpen;
}

/**
 * Opções para fetch com AbortController
 */
export interface AbortableFetchOptions extends RequestInit {
  /** Timeout em ms após o qual a requisição será abortada (padrão: 30000) */
  timeoutMs?: number;
}

/**
 * Wrapper de fetch com AbortController integrado.
 * 
 * SEGURANÇA 2025: Cancela requisições HTTP pendentes quando timeout é atingido.
 * Evita resource leaks em cenários de alta latência (Salad Cloud, APIs externas).
 * 
 * @param url - URL da requisição
 * @param options - Opções de fetch com timeout
 * @returns Response da requisição
 * @throws Error com name='AbortError' se timeout for atingido
 * 
 * @example
 * ```typescript
 * import { fetchWithAbort } from '@alice/shared-utils/circuit-breaker';
 * 
 * const response = await fetchWithAbort('https://api.example.com/data', {
 *   method: 'POST',
 *   body: JSON.stringify({ message: 'Hello' }),
 *   headers: { 'Content-Type': 'application/json' },
 *   timeoutMs: 10000, // 10 segundos
 * });
 * ```
 */
export async function fetchWithAbort(
  url: string,
  options: AbortableFetchOptions = {}
): Promise<Response> {
  const { timeoutMs = 30000, signal: externalSignal, ...fetchOptions } = options;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
    logger.warn({ url, timeoutMs }, 'Requisição abortada por timeout');
  }, timeoutMs);
  
  // Combinar com signal externo se fornecido
  if (externalSignal) {
    externalSignal.addEventListener('abort', () => controller.abort());
  }
  
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Cria uma função fetch protegida por circuit breaker com AbortController.
 * 
 * RECOMENDADO: Use esta função para todas as chamadas HTTP externas (Salad Cloud, APIs).
 * Combina proteção de circuit breaker com cancelamento de requisições.
 * 
 * @param config - Configuração do circuit breaker
 * @returns Objeto com breaker e função fetch protegida
 * 
 * @example
 * ```typescript
 * import { createProtectedFetch, CIRCUIT_BREAKER_PRESETS } from '@alice/shared-utils/circuit-breaker';
 * 
 * const { breaker, fetch: protectedFetch } = createProtectedFetch({
 *   name: 'salad-llm',
 *   ...CIRCUIT_BREAKER_PRESETS.saladLLM,
 * });
 * 
 * const response = await protectedFetch('https://api.salad.com/v1/chat', {
 *   method: 'POST',
 *   body: JSON.stringify({ model: 'llama4-maverick', messages: [] }),
 *   headers: { 'Authorization': 'Bearer xxx' },
 * });
 * ```
 */
export function createProtectedFetch(config: CircuitBreakerConfig): {
  breaker: CircuitBreaker<[string, AbortableFetchOptions?], Response>;
  fetch: (url: string, options?: AbortableFetchOptions) => Promise<Response>;
} {
  const timeoutMs = config.timeout || 30000;
  
  const fetchAction = async (url: string, options: AbortableFetchOptions = {}): Promise<Response> => {
    return fetchWithAbort(url, {
      ...options,
      timeoutMs: options.timeoutMs || timeoutMs,
    });
  };
  
  const breaker = createCircuitBreaker(fetchAction, config);
  
  return {
    breaker,
    fetch: (url: string, options?: AbortableFetchOptions) => breaker.fire(url, options),
  };
}

/**
 * Tipo utilitário para funções que aceitam AbortSignal.
 * Use para criar funções canceláveis integradas com circuit breaker.
 */
export type AbortableFunction<TArgs extends unknown[], TResult> = (
  signal: AbortSignal,
  ...args: TArgs
) => Promise<TResult>;

/**
 * Wraps uma função com AbortController para uso em circuit breaker.
 * 
 * @param fn - Função que aceita AbortSignal como primeiro parâmetro
 * @param timeoutMs - Timeout em ms
 * @returns Função wrapped que pode ser usada com createCircuitBreaker
 * 
 * @example
 * ```typescript
 * const fetchData = async (signal: AbortSignal, id: string) => {
 *   const response = await fetch(`/api/data/${id}`, { signal });
 *   return response.json();
 * };
 * 
 * const abortableAction = wrapWithAbort(fetchData, 30000);
 * const breaker = createCircuitBreaker(abortableAction, { name: 'data-fetcher' });
 * ```
 */
export function wrapWithAbort<TArgs extends unknown[], TResult>(
  fn: AbortableFunction<TArgs, TResult>,
  timeoutMs: number
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    
    try {
      return await fn(controller.signal, ...args);
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

export { CircuitBreaker };
