/**
 * Factory de Circuit Breakers - Alice Enterprise Platform
 * 
 * Implementa Circuit Breaker pattern conforme Regra 16 (Best Practices 2025).
 * Protege contra falhas em cascata em serviços externos.
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
 * Configurações pré-definidas por tipo de serviço
 */
export const CIRCUIT_BREAKER_PRESETS = {
  /** Serviço LLM Salad Cloud - timeout alto para inferência */
  saladLLM: {
    timeout: 60000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
  },
  /** Serviço de Embeddings - timeout moderado */
  saladEmbeddings: {
    timeout: 30000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
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
  /** Twilio API */
  twilioAPI: {
    timeout: 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
  },
  /** Resend API */
  resendAPI: {
    timeout: 10000,
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

export { CircuitBreaker };
