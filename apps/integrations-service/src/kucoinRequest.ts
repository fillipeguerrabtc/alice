/**
 * KuCoin Request Client - Alice Enterprise Platform
 *
 * Camada compartilhada para autenticação, time sync, circuit breaker e métricas
 * para Futures, Spot e Margin.
 *
 * Regra 6: SEM MOCKS - integrações reais com KuCoin.
 * Regra 8: TypeScript strict.
 * Regra 16: Resiliência com circuit breaker e backoff.
 *
 * Autor: Fillipe Guerra
 * Data: 27 de Janeiro de 2026
 */

import crypto from 'node:crypto';
import { createLogger } from '@alice/logger';
import {
  instrumentCircuitBreaker,
  createProtectedFetch,
  type CIRCUIT_BREAKER_PRESETS,
} from '@alice/shared-utils';
import { createAlicePrometheus } from '@alice/shared-utils';

const logger = createLogger('kucoin-request');

// ============================================================================
// CONFIGURAÇÃO DE CREDENCIAIS (shared)
// ============================================================================
const KUCOIN_PRO_API_KEY = process.env.KUCOIN_PRO_API_KEY;
const KUCOIN_PRO_API_SECRET = process.env.KUCOIN_PRO_API_SECRET;
const KUCOIN_PRO_API_PASSPHRASE = process.env.KUCOIN_PRO_API_PASSPHRASE;
const KUCOIN_PRO_API_KEY_VERSION = (process.env.KUCOIN_PRO_API_KEY_VERSION || '2').trim();
const KUCOIN_TIME_SYNC_INTERVAL_MS = Number(process.env.KUCOIN_TIME_SYNC_INTERVAL_MS || 300_000);

// ============================================================================
// TIPOS
// ============================================================================
export interface KucoinApiResponse<T> {
  code: string;
  msg?: string;
  data: T;
}

type KucoinRequestErrorKind = 'http' | 'api' | 'network' | 'timeout' | 'parse' | 'breaker_open';

export class KucoinRequestError extends Error {
  public readonly kind: KucoinRequestErrorKind;
  public readonly method: string;
  public readonly endpoint: string;
  public readonly status?: number;
  public readonly kucoinCode?: string;
  public readonly retryAfterMs?: number;

  constructor(params: {
    message: string;
    kind: KucoinRequestErrorKind;
    method: string;
    endpoint: string;
    status?: number;
    kucoinCode?: string;
    retryAfterMs?: number;
  }) {
    super(params.message);
    this.name = 'KucoinRequestError';
    this.kind = params.kind;
    this.method = params.method;
    this.endpoint = params.endpoint;
    this.status = params.status;
    this.kucoinCode = params.kucoinCode;
    this.retryAfterMs = params.retryAfterMs;
  }
}

export function isKucoinRequestError(error: unknown): error is KucoinRequestError {
  return error instanceof Error && error.name === 'KucoinRequestError';
}

export function isKucoinTransientError(error: unknown): boolean {
  if (!isKucoinRequestError(error)) return false;
  if (error.kind === 'timeout' || error.kind === 'network' || error.kind === 'breaker_open') return true;
  if (error.kind === 'http' && error.status) {
    return error.status === 429 || (error.status >= 500 && error.status <= 599);
  }
  return false;
}

// ============================================================================
// TIME SYNC (por baseUrl)
// ============================================================================
type TimeSyncState = {
  offsetMs: number;
  lastSyncMs: number;
  inFlight: boolean;
};

const timeSyncState = new Map<string, TimeSyncState>();

function isValidKucoinTimeSyncInterval(intervalMs: number): boolean {
  return Number.isFinite(intervalMs) && intervalMs >= 60_000 && intervalMs <= 3_600_000;
}

async function fetchKucoinServerTimeMs(baseUrl: string): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${baseUrl}/api/v1/timestamp`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`KuCoin timestamp HTTP ${response.status}: ${errorBody}`);
    }
    const data = (await response.json()) as KucoinApiResponse<number>;
    if (data.code !== '200000' || !Number.isFinite(data.data)) {
      throw new Error(`KuCoin timestamp inválido: ${data.code}`);
    }
    return data.data;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureKucoinTimeSync(baseUrl: string): Promise<number> {
  const now = Date.now();
  const intervalMs = isValidKucoinTimeSyncInterval(KUCOIN_TIME_SYNC_INTERVAL_MS)
    ? KUCOIN_TIME_SYNC_INTERVAL_MS
    : 300_000;
  const current = timeSyncState.get(baseUrl) ?? { offsetMs: 0, lastSyncMs: 0, inFlight: false };
  if (current.inFlight) return current.offsetMs;
  if (now - current.lastSyncMs < intervalMs) return current.offsetMs;

  current.inFlight = true;
  timeSyncState.set(baseUrl, current);

  try {
    const serverTime = await fetchKucoinServerTimeMs(baseUrl);
    current.offsetMs = serverTime - Date.now();
    current.lastSyncMs = now;
    logger.info({ baseUrl, offsetMs: current.offsetMs }, 'Sincronização de tempo KuCoin atualizada');
  } catch (error) {
    logger.warn({ baseUrl, error }, 'Falha ao sincronizar horário KuCoin - usando clock local');
  } finally {
    current.inFlight = false;
    timeSyncState.set(baseUrl, current);
  }

  return current.offsetMs;
}

// ============================================================================
// AUTENTICAÇÃO
// ============================================================================
function generateSignature(
  timestamp: string,
  method: string,
  endpoint: string,
  body: string = ''
): string {
  if (!KUCOIN_PRO_API_SECRET) {
    throw new Error('KUCOIN_PRO_API_SECRET não configurada');
  }
  const prehashString = timestamp + method.toUpperCase() + endpoint + body;
  return crypto.createHmac('sha256', KUCOIN_PRO_API_SECRET).update(prehashString).digest('base64');
}

function generatePassphraseSignature(): string {
  if (!KUCOIN_PRO_API_SECRET || !KUCOIN_PRO_API_PASSPHRASE) {
    throw new Error('KUCOIN_PRO_API_SECRET ou KUCOIN_PRO_API_PASSPHRASE não configurada');
  }
  if (KUCOIN_PRO_API_KEY_VERSION === '1') {
    return KUCOIN_PRO_API_PASSPHRASE;
  }
  return crypto.createHmac('sha256', KUCOIN_PRO_API_SECRET).update(KUCOIN_PRO_API_PASSPHRASE).digest('base64');
}

function generateAuthHeaders(
  method: string,
  endpoint: string,
  body: string,
  offsetMs: number
): Record<string, string> {
  if (!KUCOIN_PRO_API_KEY) {
    throw new Error('KUCOIN_PRO_API_KEY não configurada');
  }
  if (!['1', '2', '3'].includes(KUCOIN_PRO_API_KEY_VERSION)) {
    throw new Error(`KUCOIN_PRO_API_KEY_VERSION inválida: ${KUCOIN_PRO_API_KEY_VERSION}`);
  }
  const timestamp = (Date.now() + offsetMs).toString();
  const signature = generateSignature(timestamp, method, endpoint, body);
  const passphrase = generatePassphraseSignature();
  return {
    'KC-API-KEY': KUCOIN_PRO_API_KEY,
    'KC-API-SIGN': signature,
    'KC-API-TIMESTAMP': timestamp,
    'KC-API-PASSPHRASE': passphrase,
    'KC-API-KEY-VERSION': KUCOIN_PRO_API_KEY_VERSION,
    'Content-Type': 'application/json',
  };
}

// ============================================================================
// MÉTRICAS + HTTP EXECUTION
// ============================================================================
function normalizeKucoinOperation(method: string, endpoint: string, prefix: string): string {
  const [path] = endpoint.split('?', 1);
  const normalizedPath = path
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':id';
      if (/^\d+$/.test(seg)) return ':id';
      return seg;
    })
    .join('/');
  return `${prefix} ${method} ${normalizedPath}`;
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(60_000, Math.floor(seconds * 1000));
}

function parseRateLimitResetMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.min(60_000, Math.floor(ms));
}

function computeBackoffMs(attempt: number): number {
  const base = 200;
  const exp = Math.min(2000, base * Math.pow(2, attempt - 1));
  const jitter = Math.floor(Math.random() * 100);
  return exp + jitter;
}

function isCircuitBreakerOpenError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const maybeCode = (err as unknown as { code?: unknown }).code;
  if (maybeCode === 'EOPENBREAKER') return true;
  if (typeof err.message === 'string' && /breaker is open/i.test(err.message)) return true;
  return false;
}

export type KucoinCircuitBreakerStatus = {
  state: 'OPEN' | 'HALF_OPEN' | 'CLOSED';
  failures: number;
  successes: number;
};

export type KucoinRequester = {
  executeRequest<T>(
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    body?: Record<string, unknown>,
    requiresAuth?: boolean
  ): Promise<KucoinApiResponse<T>>;
  initMetrics(metrics: ReturnType<typeof createAlicePrometheus>['metrics']): void;
  getCircuitBreakerStatus(): KucoinCircuitBreakerStatus;
};

export function createKucoinRequester(params: {
  name: string;
  operationPrefix: string;
  baseUrl: string;
  circuitBreakerPreset: typeof CIRCUIT_BREAKER_PRESETS[keyof typeof CIRCUIT_BREAKER_PRESETS];
}): KucoinRequester {
  const { breaker, fetch } = createProtectedFetch({
    name: params.name,
    ...params.circuitBreakerPreset,
  });

  let metricsInitialized = false;
  let kucoinMetrics: ReturnType<typeof createAlicePrometheus>['metrics'] | null = null;

  const initMetrics = (metrics: ReturnType<typeof createAlicePrometheus>['metrics']): void => {
    if (metricsInitialized) return;
    instrumentCircuitBreaker(metrics, params.name, breaker);
    kucoinMetrics = metrics;
    metricsInitialized = true;
  };

  const recordKucoinCall = (opts: { operation: string; status: 'success' | 'error'; durationSeconds: number }): void => {
    if (!kucoinMetrics) return;
    kucoinMetrics.integrations.callDuration.observe(
      { integration: 'kucoin', operation: opts.operation },
      opts.durationSeconds
    );
    kucoinMetrics.integrations.callsTotal.inc(
      { integration: 'kucoin', operation: opts.operation, status: opts.status },
      1
    );
  };

  const recordKucoinError = (opts: { operation: string; errorType: string }): void => {
    if (!kucoinMetrics) return;
    kucoinMetrics.integrations.errorsTotal.inc(
      { integration: 'kucoin', operation: opts.operation, error_type: opts.errorType },
      1
    );
  };

  const executeRequest = async <T>(
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    body?: Record<string, unknown>,
    requiresAuth: boolean = true
  ): Promise<KucoinApiResponse<T>> => {
    const url = `${params.baseUrl}${endpoint}`;
    const bodyString = body ? JSON.stringify(body) : '';
    const operation = normalizeKucoinOperation(method, endpoint, params.operationPrefix);

    let offsetMs = 0;
    if (requiresAuth) {
      offsetMs = await ensureKucoinTimeSync(params.baseUrl);
    }

    const headers: Record<string, string> = requiresAuth
      ? generateAuthHeaders(method, endpoint, bodyString, offsetMs)
      : { 'Content-Type': 'application/json' };

    const maxAttempts = method === 'GET' || method === 'DELETE' ? 3 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const start = process.hrtime.bigint();
        const response = await fetch(url, {
          method,
          headers,
          body: method !== 'GET' ? bodyString : undefined,
        });
        const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;

        if (!response.ok) {
          const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
          const resetMs = parseRateLimitResetMs(response.headers.get('gw-ratelimit-reset'));
          const effectiveRetryMs = Math.max(retryAfterMs ?? 0, resetMs ?? 0) || undefined;
          const errorBody = await response.text().catch(() => '');
          recordKucoinCall({ operation, status: 'error', durationSeconds });
          recordKucoinError({ operation, errorType: `http_${response.status}` });

          const err = new KucoinRequestError({
            kind: 'http',
            method,
            endpoint,
            status: response.status,
            retryAfterMs: effectiveRetryMs,
            message: `KuCoin HTTP ${response.status} (${response.statusText})`,
          });

          const retryable = response.status === 429 || (response.status >= 500 && response.status <= 599);
          if (attempt < maxAttempts && retryable) {
            const waitMs = effectiveRetryMs ?? computeBackoffMs(attempt);
            logger.warn(
              { method, endpoint, attempt, maxAttempts, status: response.status, waitMs, body: errorBody },
              'KuCoin request falhou (HTTP) — retry agendado'
            );
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            continue;
          }

          logger.error(
            { method, endpoint, attempt, status: response.status, statusText: response.statusText, body: errorBody },
            'Erro na requisição KuCoin (HTTP)'
          );
          throw err;
        }

        let data: KucoinApiResponse<T>;
        try {
          data = (await response.json()) as KucoinApiResponse<T>;
        } catch (parseErr) {
          recordKucoinCall({ operation, status: 'error', durationSeconds });
          recordKucoinError({ operation, errorType: 'parse' });
          logger.error({ method, endpoint, attempt, error: parseErr }, 'Falha ao parsear JSON da KuCoin');
          throw new KucoinRequestError({
            kind: 'parse',
            method,
            endpoint,
            message: 'Falha ao parsear resposta JSON da KuCoin',
          });
        }

        if (!data || data.code !== '200000') {
          recordKucoinCall({ operation, status: 'error', durationSeconds });
          recordKucoinError({ operation, errorType: data?.code ?? 'api_unknown' });
          throw new KucoinRequestError({
            kind: 'api',
            method,
            endpoint,
            kucoinCode: data?.code,
            message: data?.msg || `Erro KuCoin: ${data?.code ?? 'unknown'}`,
          });
        }

        recordKucoinCall({ operation, status: 'success', durationSeconds });
        return data;
      } catch (error) {
        if (isCircuitBreakerOpenError(error)) {
          recordKucoinError({ operation, errorType: 'breaker_open' });
          throw new KucoinRequestError({
            kind: 'breaker_open',
            method,
            endpoint,
            message: 'Circuit breaker aberto para KuCoin',
          });
        }
        if (error instanceof KucoinRequestError) {
          throw error;
        }
        recordKucoinError({ operation, errorType: 'network' });
        throw new KucoinRequestError({
          kind: 'network',
          method,
          endpoint,
          message: error instanceof Error ? error.message : 'Erro de rede ao chamar KuCoin',
        });
      }
    }

    throw new KucoinRequestError({
      kind: 'network',
      method,
      endpoint,
      message: 'Falha ao executar request KuCoin',
    });
  };

  return {
    executeRequest,
    initMetrics,
    getCircuitBreakerStatus: () => ({
      state: breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF_OPEN' : 'CLOSED',
      failures: breaker.stats.failures,
      successes: breaker.stats.successes,
    }),
  };
}
