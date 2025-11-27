// Cliente Wise para Alice Enterprise Platform
// Documentação: https://docs.wise.com/api-docs/
// Produção: Hetzner Cloud com variáveis de ambiente padrão
// Padrões Enterprise: Circuit Breaker, Retry, Timeout (Regra 16)

import { logger } from '@alice/logger';
import CircuitBreaker from 'opossum';

// URLs da API Wise
const WISE_API_URL = process.env.WISE_API_URL || 'https://api.transferwise.com';
const WISE_SANDBOX_URL = 'https://api.sandbox.transferwise.tech';

// Configuração do Circuit Breaker (padrão enterprise)
const CIRCUIT_BREAKER_OPTIONS = {
  timeout: 15000,                    // Timeout de 15 segundos
  errorThresholdPercentage: 50,      // Abre após 50% de falhas
  resetTimeout: 30000,               // Tenta resetar após 30 segundos
  volumeThreshold: 5,                // Mínimo de 5 requisições antes de avaliar
};

// Interface para configuração do cliente
interface WiseClientConfig {
  apiKey: string;
  profileId: string;
  useSandbox: boolean;
}

// Verifica se o Wise está configurado (sem lançar erro)
export function isWiseConfigured(): boolean {
  const apiKey = process.env.WISE_API_KEY;
  const profileId = process.env.WISE_PROFILE_ID;
  return Boolean(apiKey && profileId);
}

// Obtém status do sandbox de forma segura
export function getSandboxStatus(): boolean {
  return process.env.WISE_SANDBOX === 'true' || process.env.NODE_ENV !== 'production';
}

// Obtém Profile ID de forma segura (retorna null se não configurado)
export function getProfileIdSafe(): string | null {
  return process.env.WISE_PROFILE_ID || null;
}

// Obtém configuração do Wise das variáveis de ambiente
function getWiseConfig(): WiseClientConfig {
  const apiKey = process.env.WISE_API_KEY;
  const profileId = process.env.WISE_PROFILE_ID;
  const useSandbox = process.env.WISE_SANDBOX === 'true' || process.env.NODE_ENV !== 'production';

  if (!apiKey) {
    throw new Error('WISE_API_KEY não configurada nas variáveis de ambiente');
  }

  if (!profileId) {
    throw new Error('WISE_PROFILE_ID não configurada nas variáveis de ambiente');
  }

  return { apiKey, profileId, useSandbox };
}

// Obtém URL base da API
function getBaseUrl(): string {
  const config = getWiseConfig();
  return config.useSandbox ? WISE_SANDBOX_URL : WISE_API_URL;
}

// Headers padrão para requisições
function getHeaders(): Record<string, string> {
  const config = getWiseConfig();
  return {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
}

// Interface para parâmetros da requisição Wise
interface WiseRequestParams {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  endpoint: string;
  body?: unknown;
}

// Função interna de requisição HTTP
async function executeWiseRequest<T>(params: WiseRequestParams): Promise<T> {
  const { method, endpoint, body } = params;
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${endpoint}`;
  const headers = getHeaders();

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Wise API error: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<T>;
}

// Circuit Breaker para requisições Wise API
const wiseCircuitBreaker = new CircuitBreaker(executeWiseRequest, CIRCUIT_BREAKER_OPTIONS);

// Eventos do Circuit Breaker para logging
wiseCircuitBreaker.on('open', () => {
  logger.warn('Circuit Breaker Wise ABERTO - muitas falhas detectadas');
});

wiseCircuitBreaker.on('halfOpen', () => {
  logger.info('Circuit Breaker Wise HALF-OPEN - testando recuperação');
});

wiseCircuitBreaker.on('close', () => {
  logger.info('Circuit Breaker Wise FECHADO - serviço recuperado');
});

wiseCircuitBreaker.on('timeout', () => {
  logger.warn('Circuit Breaker Wise TIMEOUT - requisição excedeu tempo limite');
});

wiseCircuitBreaker.on('reject', () => {
  logger.warn('Circuit Breaker Wise REJEITOU requisição - circuito aberto');
});

// Cliente HTTP para API Wise com Circuit Breaker
export async function wiseRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  endpoint: string,
  body?: unknown
): Promise<T> {
  logger.info({ method, endpoint }, 'Requisição Wise API');

  try {
    const result = await wiseCircuitBreaker.fire({ method, endpoint, body }) as T;
    logger.info({ method, endpoint, success: true }, 'Resposta Wise API');
    return result;
  } catch (error) {
    logger.error({ error, method, endpoint }, 'Falha na requisição Wise');
    throw error;
  }
}

// Exporta status do circuit breaker para health check
export function getWiseCircuitBreakerStatus(): {
  state: string;
  stats: { failures: number; successes: number; rejects: number };
} {
  return {
    state: wiseCircuitBreaker.opened ? 'open' : wiseCircuitBreaker.halfOpen ? 'half-open' : 'closed',
    stats: {
      failures: wiseCircuitBreaker.stats.failures,
      successes: wiseCircuitBreaker.stats.successes,
      rejects: wiseCircuitBreaker.stats.rejects,
    },
  };
}

// Obtém o Profile ID configurado
export function getWiseProfileId(): string {
  const config = getWiseConfig();
  return config.profileId;
}

// Verifica se está usando sandbox
export function isWiseSandbox(): boolean {
  const config = getWiseConfig();
  return config.useSandbox;
}

// Valida assinatura de webhook Wise
export function validateWiseWebhook(
  signature: string,
  payload: string,
  webhookSecret: string
): boolean {
  const crypto = require('crypto');
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(payload)
    .digest('hex');
  
  return signature === expectedSignature;
}

// Tipos exportados para uso externo
export type { WiseClientConfig };
