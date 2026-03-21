/**
 * Response Cache (Greetings Gate) - Alice Enterprise Platform
 */

import { createHash } from 'node:crypto';
import { createLogger } from '@alice/logger';
import { getNodeEnv, readOptionalStringEnv } from '@alice/config';
import { getRedisClient, isRedisAvailable } from '@alice/shared-utils';

const logger = createLogger('response-cache');
const IS_PRODUCTION = getNodeEnv() === 'production';

function parseEnvInt(envValue: string | undefined, defaultValue: number, varName: string): number {
  const raw = envValue ?? String(defaultValue);
  const trimmed = raw.trim();

  if (!/^\d+$/.test(trimmed)) {
    const message = `${varName} invalido: "${raw}". Deve ser inteiro positivo.`;
    if (IS_PRODUCTION) {
      logger.error({ varName, rawValue: raw }, message);
      throw new Error(message);
    }
    logger.warn({ varName, rawValue: raw, defaultValue }, `${message} Usando padrao.`);
    return defaultValue;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const message = `${varName} invalido: "${raw}". Deve ser inteiro positivo.`;
    if (IS_PRODUCTION) {
      logger.error({ varName, rawValue: raw, parsed }, message);
      throw new Error(message);
    }
    logger.warn({ varName, rawValue: raw, parsed, defaultValue }, `${message} Usando padrao.`);
    return defaultValue;
  }

  return parsed;
}

function parseEnvBool(envValue: string | undefined, defaultValue: boolean, varName: string): boolean {
  if (typeof envValue === 'undefined') return defaultValue;
  const normalized = envValue.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;

  const message = `${varName} invalido: "${envValue}". Deve ser "true" ou "false".`;
  if (IS_PRODUCTION) {
    logger.error({ varName, rawValue: envValue }, message);
    throw new Error(message);
  }
  logger.warn({ varName, rawValue: envValue, defaultValue }, `${message} Usando padrao.`);
  return defaultValue;
}

const CACHE_TTL_MS = parseEnvInt(
  readOptionalStringEnv('RESPONSE_CACHE_TTL_MS') ?? undefined,
  86400000,
  'RESPONSE_CACHE_TTL_MS'
);
const CACHE_PREFIX = 'alice:response-cache:v2';
const CACHE_ENABLED = parseEnvBool(
  readOptionalStringEnv('RESPONSE_CACHE_ENABLED') ?? undefined,
  true,
  'RESPONSE_CACHE_ENABLED'
);

const GREETING_PATTERNS: RegExp[] = [
  /^(?:ol[áa]|oi|opa|bora|e ai|fala|salve)(?:,\s*(?:alice|[\p{L}\p{M}'-]{2,40}))?(?:\s*[!.,?]+)?$/iu,
  /^(?:bom dia|boa tarde|boa noite)(?:,?\s*(?:tudo bem|como vai|beleza))?(?:,?\s*(?:alice|[\p{L}\p{M}'-]{2,40}))?(?:\s*[!.,?]+)?$/iu,
  /^(?:ol[áa]|oi|opa),?\s+(?:bom dia|boa tarde|boa noite)(?:\s*[!.,?]+)?$/iu,
  /^(?:tudo bem|tudo bom|tudo certo|como vai|beleza)(?:\s*[!.,?]+)?$/iu,
  /^(?:tudo bem|tudo bom|tudo certo)(?:\s+(?:com\s+(?:voce|vc|tu)|contigo|por\s+(?:ai|aí)|ai|aí))?(?:\s*[!.,?]+)?$/iu,
  /^(?:oi|ol[áa]|opa),?\s+(?:tudo bem|tudo bom|tudo certo)(?:\s+(?:com\s+(?:voce|vc|tu)|contigo|por\s+(?:ai|aí)|ai|aí))?(?:\s*[!.,?]+)?$/iu,
  /^(?:como)\s+(?:voce|vc|tu)\s*(?:esta|ta|vai)(?:\s*[!.,?]+)?$/iu,
  /^(?:e ai|eai)(?:,?\s*)?(?:tudo bem)(?:\s+(?:com\s+(?:voce|vc|tu)|contigo|por\s+(?:ai|aí)|ai|aí))?(?:\s*[!.,?]+)?$/iu,
  /^(?:ol[áa]|oi|opa),?\s+alice(?:\s*[!.,?]+)?$/iu,
  /^(?:hello|hi|hey)(?:,\s*[\p{L}\p{M}'-]{2,40})?(?:\s*[!.,?]+)?$/iu,
  /^(?:good morning|good afternoon|good evening)(?:,\s*[\p{L}\p{M}'-]{2,40})?(?:\s*(?:how are you|what's up))?(?:\s*[!.,?]+)?$/iu,
  /^(?:how are you|what'?s up)(?:\s*[!.,?]+)?$/iu,
  /^(?:hello|hi),?\s+alice(?:\s*[!.,?]+)?$/iu,
];

const NON_GREETING_DOMAIN_TERMS = [
  'trade',
  'trading',
  'buy',
  'sell',
  'btc',
  'eth',
  'kucoin',
  'futuros',
  'ordem',
  'sinal',
  'portfolio',
];

const GREETING_RESPONSES_PT: string[] = [
  'Olá! Tudo certo por aí?',
  'Oi! Como posso ajudar você hoje?',
  'Olá! Que bom falar com você.',
  'Oi! Estou por aqui se você precisar de algo.',
  'Olá! Em que posso ajudar agora?',
];

const GREETING_RESPONSES_EN: string[] = [
  'Hello! How are you doing today?',
  'Hi! How can I help you today?',
  'Hello! Great to hear from you.',
  'Hi! I am here if you need anything.',
  'Hello! What can I help you with now?',
];

interface CacheEntry {
  response: string;
  createdAt: string;
  hitCount: number;
  language: 'pt' | 'en';
}

export interface CacheCheckResult {
  cacheHit: boolean;
  hasResponse: boolean;
  response?: string;
  cacheKey?: string;
  isGreeting: boolean;
  latencyMs: number;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  greetingsDetected: number;
  latencyAvgMs: number;
}

let metricsState = {
  hits: 0,
  misses: 0,
  greetingsDetected: 0,
  totalLatencyMs: 0,
  requestCount: 0,
};

function normalizeGreetingText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'?!.,-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasDomainTerm(text: string): boolean {
  return NON_GREETING_DOMAIN_TERMS.some((term) => text.includes(term));
}

function detectLanguage(text: string): 'pt' | 'en' {
  const normalized = normalizeGreetingText(text);
  const ptIndicators = ['ola', 'oi', 'bom dia', 'boa tarde', 'boa noite', 'tudo bem', 'como vai', 'beleza'];
  return ptIndicators.some((indicator) => normalized.includes(indicator)) ? 'pt' : 'en';
}

function isSafeGreetingResponse(response: string): boolean {
  const normalized = normalizeGreetingText(response);
  if (!normalized || normalized.length < 8 || normalized.length > 220) {
    return false;
  }
  if (hasDomainTerm(normalized)) {
    return false;
  }
  if (/(.)\1{8,}/u.test(normalized)) {
    return false;
  }
  return true;
}

export function isGreeting(text: string): boolean {
  if (!text || typeof text !== 'string') {
    return false;
  }
  const normalized = normalizeGreetingText(text);
  if (!normalized || normalized.length > 120) {
    return false;
  }
  if (hasDomainTerm(normalized)) {
    return false;
  }
  return GREETING_PATTERNS.some((pattern) => pattern.test(normalized));
}

function generateGreetingResponse(language: 'pt' | 'en'): string {
  const responses = language === 'pt' ? GREETING_RESPONSES_PT : GREETING_RESPONSES_EN;
  const index = Math.floor(Math.random() * responses.length);
  return responses[index];
}

function hashMessage(message: string): string {
  const normalized = normalizeGreetingText(message);
  return createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

function getCacheKey(tenantId: string, subjectScope: string, messageHash: string): string {
  return `${CACHE_PREFIX}:${tenantId}:${subjectScope}:${messageHash}`;
}

async function getFromCache(tenantId: string, subjectScope: string, messageHash: string): Promise<CacheEntry | null> {
  const client = getRedisClient();
  if (!client) {
    logger.debug('Redis nao disponivel para response cache');
    return null;
  }

  try {
    const key = getCacheKey(tenantId, subjectScope, messageHash);
    const data = await client.get(key);
    if (!data) {
      return null;
    }

    const entry = JSON.parse(data) as CacheEntry;
    if (!isSafeGreetingResponse(entry.response)) {
      await client.del(key);
      logger.warn({ tenantId, key }, 'Entrada degradada removida do greetings cache');
      return null;
    }

    entry.hitCount += 1;
    await client.setEx(key, Math.ceil(CACHE_TTL_MS / 1000), JSON.stringify(entry));
    return entry;
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Erro ao ler response cache');
    return null;
  }
}

async function saveToCache(
  tenantId: string,
  subjectScope: string,
  messageHash: string,
  response: string,
  language: 'pt' | 'en'
): Promise<void> {
  const client = getRedisClient();
  if (!client) {
    logger.debug('Redis nao disponivel para salvar response cache');
    return;
  }

  if (!isSafeGreetingResponse(response)) {
    logger.warn({ tenantId }, 'Resposta de saudacao descartada antes de salvar no cache');
    return;
  }

  try {
    const key = getCacheKey(tenantId, subjectScope, messageHash);
    const entry: CacheEntry = {
      response,
      createdAt: new Date().toISOString(),
      hitCount: 0,
      language,
    };

    await client.setEx(key, Math.ceil(CACHE_TTL_MS / 1000), JSON.stringify(entry));
    logger.debug({ key, language }, 'Resposta salva no cache');
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Erro ao salvar response cache');
  }
}

export async function checkResponseCache(
  tenantId: string,
  userId: string | undefined,
  message: string,
  options?: {
    enableHybridTransversalDefault?: boolean;
  }
): Promise<CacheCheckResult> {
  const startTime = Date.now();

  const result: CacheCheckResult = {
    cacheHit: false,
    hasResponse: false,
    isGreeting: false,
    latencyMs: 0,
  };

  if (!CACHE_ENABLED) {
    result.latencyMs = Date.now() - startTime;
    return result;
  }
  if (options?.enableHybridTransversalDefault === false) {
    result.latencyMs = Date.now() - startTime;
    return result;
  }

  if (!isRedisAvailable()) {
    logger.debug('Response cache: Redis nao disponivel');
    result.latencyMs = Date.now() - startTime;
    return result;
  }

  const greetingDetected = isGreeting(message);
  result.isGreeting = greetingDetected;

  if (greetingDetected) {
    metricsState.greetingsDetected += 1;
  }

  if (!greetingDetected) {
    result.latencyMs = Date.now() - startTime;
    updateLatencyMetrics(result.latencyMs);
    return result;
  }

  const messageHash = hashMessage(message);
  const subjectScope = userId && userId.trim().length > 0 ? userId : 'anonymous';
  result.cacheKey = getCacheKey(tenantId, subjectScope, messageHash);

  const cached = await getFromCache(tenantId, subjectScope, messageHash);

  if (cached) {
    metricsState.hits += 1;
    result.cacheHit = true;
    result.hasResponse = true;
    result.response = cached.response;

    logger.info({
      tenantId,
      hitCount: cached.hitCount,
      language: cached.language,
    }, 'Response cache HIT - saudacao do Redis');
  } else {
    metricsState.misses += 1;
    result.cacheHit = false;
    result.hasResponse = true;

    const language = detectLanguage(message);
    const response = generateGreetingResponse(language);

    await saveToCache(tenantId, subjectScope, messageHash, response, language);

    result.response = response;

    logger.info({
      tenantId,
      language,
      generated: true,
    }, 'Response cache MISS - saudacao gerada e cacheada');
  }

  result.latencyMs = Date.now() - startTime;
  updateLatencyMetrics(result.latencyMs);

  return result;
}

function updateLatencyMetrics(latencyMs: number): void {
  metricsState.totalLatencyMs += latencyMs;
  metricsState.requestCount += 1;
}

export function getCacheMetrics(): CacheMetrics {
  return {
    hits: metricsState.hits,
    misses: metricsState.misses,
    greetingsDetected: metricsState.greetingsDetected,
    latencyAvgMs: metricsState.requestCount > 0
      ? metricsState.totalLatencyMs / metricsState.requestCount
      : 0,
  };
}

export function resetCacheMetrics(): void {
  metricsState = {
    hits: 0,
    misses: 0,
    greetingsDetected: 0,
    totalLatencyMs: 0,
    requestCount: 0,
  };
}

export async function clearTenantCache(tenantId: string): Promise<number> {
  const client = getRedisClient();
  if (!client) {
    return 0;
  }

  try {
    const pattern = `${CACHE_PREFIX}:${tenantId}:*`;
    const keys = await client.keys(pattern);

    if (keys.length > 0) {
      await client.del(keys);
      logger.info({ tenantId, keysDeleted: keys.length }, 'Cache de tenant limpo');
    }

    return keys.length;
  } catch (error) {
    logger.error({ error: (error as Error).message, tenantId }, 'Erro ao limpar cache de tenant');
    return 0;
  }
}

export function isCacheOperational(): boolean {
  return CACHE_ENABLED && isRedisAvailable();
}

export default {
  checkResponseCache,
  isGreeting,
  getCacheMetrics,
  resetCacheMetrics,
  clearTenantCache,
  isCacheOperational,
};
