// Cliente Wise para Alice Enterprise Platform
// Documentação: https://docs.wise.com/api-docs/
// Produção: Hetzner Cloud com variáveis de ambiente padrão
// Padrões Enterprise: Circuit Breaker, Retry, Timeout (Regra 16)
// SEGURANÇA: WISE_SANDBOX deve ser explicitamente configurado (sem fallback NODE_ENV)

import { createLogger } from '@alice/logger';
import crypto from 'crypto';
import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS, createAlicePrometheus } from '@alice/shared-utils';

// Logger padronizado (Regra 2 - Não Duplicar)
const logger = createLogger('wise-client');

// ============================================================================
// MÉTRICAS (Prometheus) - Wise
// ============================================================================
// Inicializado via initWiseMetrics() em apps/integrations-service/src/index.ts
let wiseMetrics: ReturnType<typeof createAlicePrometheus>['metrics'] | null = null;

export function initWiseMetrics(metrics: ReturnType<typeof createAlicePrometheus>['metrics']): void {
  wiseMetrics = metrics;
}

function normalizeWiseOperation(method: string, endpoint: string): string {
  const [path] = endpoint.split('?', 1);
  const normalizedPath = path
    .split('/')
    .map((segment) => {
      if (!segment) return segment;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return ':id';
      if (/^\d+$/.test(segment)) return ':id';
      return segment;
    })
    .join('/');
  return `${method} ${normalizedPath}`;
}

function recordWiseCall(opts: { operation: string; status: 'success' | 'error'; durationSeconds: number }): void {
  if (!wiseMetrics) return;
  wiseMetrics.integrations.callDuration.observe(
    { integration: 'wise', operation: opts.operation },
    opts.durationSeconds
  );
  wiseMetrics.integrations.callsTotal.inc(
    { integration: 'wise', operation: opts.operation, status: opts.status },
    1
  );
}

function recordWiseError(opts: { operation: string; errorType: string }): void {
  if (!wiseMetrics) return;
  wiseMetrics.integrations.errorsTotal.inc(
    { integration: 'wise', operation: opts.operation, error_type: opts.errorType },
    1
  );
}

function classifyWiseError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('timeout')) return 'timeout';
    if (message.includes('breaker')) return 'breaker_open';
    if (message.includes('429')) return 'rate_limit';
    if (message.includes('wise api error')) return 'http_error';
  }
  return 'error';
}

// RESILIÊNCIA: Timeout para chamadas à API Wise (Best Practices 2025)
const WISE_API_TIMEOUT_MS = 30000; // 30 segundos

// URLs da API Wise (docs oficiais)
const WISE_API_URL = process.env.WISE_API_URL || 'https://api.wise.com';
const WISE_SANDBOX_URL = 'https://api.wise-sandbox.com';

// Usa CIRCUIT_BREAKER_PRESETS.wiseApi centralizado (Regra 2 - Não Duplicar)

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
// SEGURANÇA: WISE_SANDBOX DEVE ser explicitamente configurado
// Em produção, se não configurado, assume sandbox para segurança (fail-safe)
export function getSandboxStatus(): boolean {
  const wiseSandbox = process.env.WISE_SANDBOX;
  const isProduction = process.env.NODE_ENV === 'production';
  
  // WISE_SANDBOX deve ser explicitamente 'false' para usar produção
  if (wiseSandbox === 'false') {
    return false; // Produção Wise
  }
  
  if (wiseSandbox === 'true') {
    return true; // Sandbox Wise
  }
  
  // WISE_SANDBOX não configurado
  if (isProduction) {
    logger.warn('WISE_SANDBOX não configurado em produção - usando sandbox por segurança. Configure WISE_SANDBOX=false para usar produção Wise.');
  }
  
  // Default: sandbox para segurança (fail-safe)
  return true;
}

// Obtém Profile ID de forma segura (retorna null se não configurado)
export function getProfileIdSafe(): string | null {
  return process.env.WISE_PROFILE_ID || null;
}

// Obtém configuração do Wise das variáveis de ambiente
function getWiseConfig(): WiseClientConfig {
  const apiKey = process.env.WISE_API_KEY;
  const profileId = process.env.WISE_PROFILE_ID;
  const useSandbox = getSandboxStatus();

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
  headers?: Record<string, string>;
}

function summarizeWiseErrorBody(bodyText: string): string {
  if (!bodyText) return 'Resposta vazia';
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: string;
      error_description?: string;
      message?: string;
      errors?: Array<{ code?: string; message?: string; path?: string }>;
    };
    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      const first = parsed.errors[0];
      const parts = [first.code, first.path, first.message].filter(Boolean);
      return parts.join(' | ') || 'Erro Wise (array)';
    }
    if (parsed.error || parsed.error_description) {
      return [parsed.error, parsed.error_description].filter(Boolean).join(' | ');
    }
    if (parsed.message) {
      return parsed.message;
    }
  } catch {
    // Ignorar parse JSON e usar texto bruto.
  }
  return bodyText.slice(0, 400);
}

// Função interna de requisição HTTP
// CORREÇÃO AUDITORIA 17/12/2025: Adicionado timeout via AbortSignal
async function executeWiseRequest<T>(params: WiseRequestParams): Promise<T> {
  const { method, endpoint, body, headers: extraHeaders } = params;
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${endpoint}`;
  const headers = { ...getHeaders(), ...extraHeaders };

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(WISE_API_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const summary = summarizeWiseErrorBody(errorText);
      throw new Error(`Wise API error: ${response.status} - ${summary}`);
    }

    return response.json() as Promise<T>;
  } catch (error) {
    // Distinguir timeout de outros erros para melhor diagnóstico
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`Timeout ao chamar Wise API: ${endpoint} (${WISE_API_TIMEOUT_MS}ms)`);
    }
    throw error;
  }
}

// Circuit Breaker para requisições Wise API
const wiseCircuitBreaker = createCircuitBreaker(executeWiseRequest, {
  name: 'wise-api',
  ...CIRCUIT_BREAKER_PRESETS.wiseAPI,
});

// Cliente HTTP para API Wise com Circuit Breaker
export async function wiseRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  endpoint: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<T> {
  logger.info({ method, endpoint }, 'Requisição Wise API');
  const operation = normalizeWiseOperation(method, endpoint);
  const start = process.hrtime.bigint();

  try {
    const result = await wiseCircuitBreaker.fire({ method, endpoint, body, headers }) as T;
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    recordWiseCall({ operation, status: 'success', durationSeconds });
    logger.info({ method, endpoint, success: true }, 'Resposta Wise API');
    return result;
  } catch (error) {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    recordWiseCall({ operation, status: 'error', durationSeconds });
    recordWiseError({ operation, errorType: classifyWiseError(error) });
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, method, endpoint }, 'Falha na requisição Wise');
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

const WISE_WEBHOOK_PUBLIC_KEY_PROD = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvO8vXV+JksBzZAY6GhSO
XdoTCfhXaaiZ+qAbtaDBiu2AGkGVpmEygFmWP4Li9m5+Ni85BhVvZOodM9epgW3F
bA5Q1SexvAF1PPjX4JpMstak/QhAgl1qMSqEevL8cmUeTgcMuVWCJmlge9h7B1CS
D4rtlimGZozG39rUBDg6Qt2K+P4wBfLblL0k4C4YUdLnpGYEDIth+i8XsRpFlogx
CAFyH9+knYsDbR43UJ9shtc42Ybd40Afihj8KnYKXzchyQ42aC8aZ/h5hyZ28yVy
Oj3Vos0VdBIs/gAyJ/4yyQFCXYte64I7ssrlbGRaco4nKF3HmaNhxwyKyJafz19e
HwIDAQAB
-----END PUBLIC KEY-----`;

const WISE_WEBHOOK_PUBLIC_KEY_SANDBOX = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwpb91cEYuyJNQepZAVfP
ZIlPZfNUefH+n6w9SW3fykqKu938cR7WadQv87oF2VuT+fDt7kqeRziTmPSUhqPU
ys/V2Q1rlfJuXbE+Gga37t7zwd0egQ+KyOEHQOpcTwKmtZ81ieGHynAQzsn1We3j
wt760MsCPJ7GMT141ByQM+yW1Bx+4SG3IGjXWyqOWrcXsxAvIXkpUD/jK/L958Cg
nZEgz0BSEh0QxYLITnW1lLokSx/dTianWPFEhMC9BgijempgNXHNfcVirg1lPSyg
z7KqoKUN0oHqWLr2U1A+7kqrl6O2nx3CKs1bj1hToT1+p4kcMoHXA7kA+VBLUpEs
VwIDAQAB
-----END PUBLIC KEY-----`;

function getWiseWebhookPublicKey(): string | null {
  if (process.env.WISE_WEBHOOK_PUBLIC_KEY) {
    return process.env.WISE_WEBHOOK_PUBLIC_KEY;
  }
  return getSandboxStatus() ? WISE_WEBHOOK_PUBLIC_KEY_SANDBOX : WISE_WEBHOOK_PUBLIC_KEY_PROD;
}

// Valida assinatura de webhook Wise (RSA + SHA256)
// SEGURANÇA: A assinatura é base64 no header X-Signature-SHA256 (docs oficiais Wise)
export function validateWiseWebhook(
  signature: string | undefined,
  payload: string
): { valid: boolean; reason?: string } {
  if (!signature) {
    return { valid: false, reason: 'SIGNATURE_MISSING' };
  }

  const publicKey = getWiseWebhookPublicKey();
  if (!publicKey) {
    return { valid: false, reason: 'PUBLIC_KEY_MISSING' };
  }

  try {
    const signatureBuffer = Buffer.from(signature, 'base64');
    if (signatureBuffer.length === 0) {
      return { valid: false, reason: 'SIGNATURE_INVALID_FORMAT' };
    }

    const isValid = crypto.verify(
      'RSA-SHA256',
      Buffer.from(payload, 'utf8'),
      publicKey,
      signatureBuffer
    );

    return {
      valid: isValid,
      reason: isValid ? 'VALID' : 'SIGNATURE_MISMATCH',
    };
  } catch (error) {
    logger.error({ error }, 'Erro ao validar assinatura Wise webhook');
    return { valid: false, reason: 'VALIDATION_ERROR' };
  }
}

// Tipos exportados para uso externo
export type { WiseClientConfig };
