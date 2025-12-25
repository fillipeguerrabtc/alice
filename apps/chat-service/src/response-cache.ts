/**
 * Response Cache (Greetings Gate) - Alice Enterprise Platform
 * 
 * Sistema de cache para respostas de saudações e mensagens simples.
 * Evita chamadas desnecessárias ao LLM GPU (GPU Manager Service) para mensagens triviais.
 * 
 * Funcionalidades:
 * - Detecção de saudações (PT-BR e EN)
 * - Cache Redis distribuído com TTL configurável
 * - Métricas Prometheus (hits/misses)
 * - Multi-tenant (isolamento por tenantId)
 * - Respostas pré-definidas para saudações comuns
 * 
 * Regra 6 - SEM MOCKS: Cache Redis real (PROIBIDO in-memory em produção)
 * Regra 8 - TypeScript strict, zero any
 * Regra 16 - Circuit breaker e métricas
 * 
 * Autor: Fillipe Guerra
 * Data: 17 de Dezembro de 2025
 */

import { createLogger } from '@alice/logger';
import { getRedisClient, isRedisAvailable } from '@alice/shared-utils';
import { createHash } from 'crypto';

const logger = createLogger('response-cache');

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

/**
 * Parseia variável de ambiente como inteiro com validação robusta
 * CORREÇÃO AUDITORIA 17/12/2025: parseInt sem radix e sem validação de NaN
 * Bug original: parseInt('86400000') sem radix 10 pode interpretar errado em engines antigas
 */
function parseEnvInt(envValue: string | undefined, defaultValue: number, varName: string): number {
  const raw = envValue ?? String(defaultValue);
  const trimmed = raw.trim();
  
  // Regra 6: Rejeitar valores parciais
  if (!/^\d+$/.test(trimmed)) {
    const errorMsg = `${varName} inválido: "${raw}". Deve ser número inteiro positivo.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ varName, rawValue: raw }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, defaultValue }, `${errorMsg} Usando valor padrão.`);
    return defaultValue;
  }
  
  const parsed = parseInt(trimmed, 10);
  
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const errorMsg = `${varName} inválido: "${raw}". Deve ser número inteiro positivo.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ varName, rawValue: raw, parsed }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, parsed, defaultValue }, `${errorMsg} Usando valor padrão.`);
    return defaultValue;
  }
  
  return parsed;
}

/** TTL do cache em ms (default: 24 horas) - CORREÇÃO AUDITORIA 17/12/2025 */
const CACHE_TTL_MS = parseEnvInt(process.env.RESPONSE_CACHE_TTL_MS, 86400000, 'RESPONSE_CACHE_TTL_MS');

/** Prefixo para chaves Redis */
const CACHE_PREFIX = 'alice:response-cache';

/** Habilitar/desabilitar cache */
const CACHE_ENABLED = process.env.RESPONSE_CACHE_ENABLED !== 'false';

// ============================================================================
// PADRÕES DE SAUDAÇÃO (PT-BR e EN)
// ============================================================================

/** Padrões de saudação simples que podem ser cacheadas */
const GREETING_PATTERNS: RegExp[] = [
  // PT-BR
  /^ol[áa]\s*[!.,]?\s*$/i,
  /^oi\s*[!.,]?\s*$/i,
  /^e\s*a[ií]\s*[!.,]?\s*$/i,
  /^fala\s*[!.,]?\s*$/i,
  /^salve\s*[!.,]?\s*$/i,
  /^bom\s+dia\s*[!.,]?\s*$/i,
  /^boa\s+tarde\s*[!.,]?\s*$/i,
  /^boa\s+noite\s*[!.,]?\s*$/i,
  /^tudo\s+(bem|bom|certo)\s*\??\s*$/i,
  /^como\s+vai\s*\??\s*$/i,
  /^beleza\s*\??\s*$/i,
  /^ol[áa],?\s+alice\s*[!.,]?\s*$/i,
  /^oi,?\s+alice\s*[!.,]?\s*$/i,
  // EN
  /^hello\s*[!.,]?\s*$/i,
  /^hi\s*[!.,]?\s*$/i,
  /^hey\s*[!.,]?\s*$/i,
  /^good\s+morning\s*[!.,]?\s*$/i,
  /^good\s+afternoon\s*[!.,]?\s*$/i,
  /^good\s+evening\s*[!.,]?\s*$/i,
  /^what'?s\s+up\s*\??\s*$/i,
  /^how\s+are\s+you\s*\??\s*$/i,
  /^hello,?\s+alice\s*[!.,]?\s*$/i,
  /^hi,?\s+alice\s*[!.,]?\s*$/i,
];

/** Respostas pré-definidas para saudações (rotacionadas) */
const GREETING_RESPONSES_PT: string[] = [
  'Olá! 👋 Como posso ajudar você hoje?',
  'Oi! Estou aqui para ajudar. O que você precisa?',
  'Olá! Fico feliz em falar com você. Em que posso ser útil?',
  'Oi! Sou a Alice, sua assistente de IA. Como posso ajudar?',
  'Olá! Estou à disposição. O que gostaria de saber?',
];

const GREETING_RESPONSES_EN: string[] = [
  'Hello! 👋 How can I help you today?',
  'Hi! I\'m here to help. What do you need?',
  'Hello! I\'m happy to chat with you. How can I assist?',
  'Hi! I\'m Alice, your AI assistant. How can I help?',
  'Hello! I\'m at your service. What would you like to know?',
];

// ============================================================================
// TIPOS
// ============================================================================

/** Entrada de cache */
interface CacheEntry {
  response: string;
  createdAt: string;
  hitCount: number;
  language: 'pt' | 'en';
}

/** Resultado do check de cache */
export interface CacheCheckResult {
  /** 
   * CORREÇÃO 17/12/2025: Separação clara entre cache hit e resposta disponível
   * - cacheHit: true apenas se resposta veio do Redis (cache real)
   * - hasResponse: true se tem resposta (seja do cache ou gerada)
   * Antes: campo "hit" era ambíguo, causando métricas inconsistentes
   */
  cacheHit: boolean;
  /** Indica se uma resposta está disponível (do cache ou gerada) */
  hasResponse: boolean;
  response?: string;
  cacheKey?: string;
  isGreeting: boolean;
  latencyMs: number;
}

/** Métricas de cache */
export interface CacheMetrics {
  hits: number;
  misses: number;
  greetingsDetected: number;
  latencyAvgMs: number;
}

// ============================================================================
// ESTADO DE MÉTRICAS (para Prometheus)
// ============================================================================

let metricsState = {
  hits: 0,
  misses: 0,
  greetingsDetected: 0,
  totalLatencyMs: 0,
  requestCount: 0,
};

// ============================================================================
// FUNÇÕES DE DETECÇÃO
// ============================================================================

/**
 * Detecta o idioma da mensagem
 */
function detectLanguage(text: string): 'pt' | 'en' {
  const ptIndicators = ['olá', 'oi', 'bom dia', 'boa tarde', 'boa noite', 'tudo bem', 'como vai'];
  const lowerText = text.toLowerCase();
  
  for (const indicator of ptIndicators) {
    if (lowerText.includes(indicator)) {
      return 'pt';
    }
  }
  
  return 'en';
}

/**
 * Verifica se a mensagem é uma saudação simples
 * 
 * CORREÇÃO 17/12/2025: Validação defensiva para text undefined/null
 * Evita TypeError: Cannot read properties of undefined (reading 'trim')
 */
export function isGreeting(text: string): boolean {
  // Validação defensiva - se text for undefined/null/vazio, não é saudação
  if (!text || typeof text !== 'string') {
    return false;
  }
  const normalizedText = text.trim().toLowerCase();
  return GREETING_PATTERNS.some(pattern => pattern.test(normalizedText));
}

/**
 * Gera uma resposta de saudação aleatória
 */
function generateGreetingResponse(language: 'pt' | 'en'): string {
  const responses = language === 'pt' ? GREETING_RESPONSES_PT : GREETING_RESPONSES_EN;
  const index = Math.floor(Math.random() * responses.length);
  return responses[index];
}

/**
 * Gera hash da mensagem para uso como chave de cache
 */
function hashMessage(message: string): string {
  const normalized = message.trim().toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

// ============================================================================
// FUNÇÕES DE CACHE REDIS
// ============================================================================

/**
 * Obtém chave completa do cache
 */
function getCacheKey(tenantId: string, messageHash: string): string {
  return `${CACHE_PREFIX}:${tenantId}:${messageHash}`;
}

/**
 * Verifica cache e retorna resposta se encontrada
 */
async function getFromCache(tenantId: string, messageHash: string): Promise<CacheEntry | null> {
  const client = getRedisClient();
  if (!client) {
    logger.debug('Redis não disponível para response cache');
    return null;
  }
  
  try {
    const key = getCacheKey(tenantId, messageHash);
    const data = await client.get(key);
    
    if (!data) {
      return null;
    }
    
    const entry = JSON.parse(data) as CacheEntry;
    
    // Incrementar hit count
    entry.hitCount++;
    await client.setEx(key, Math.ceil(CACHE_TTL_MS / 1000), JSON.stringify(entry));
    
    return entry;
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Erro ao ler response cache');
    return null;
  }
}

/**
 * Salva resposta no cache
 */
async function saveToCache(
  tenantId: string,
  messageHash: string,
  response: string,
  language: 'pt' | 'en'
): Promise<void> {
  const client = getRedisClient();
  if (!client) {
    logger.debug('Redis não disponível para salvar response cache');
    return;
  }
  
  try {
    const key = getCacheKey(tenantId, messageHash);
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

// ============================================================================
// API PÚBLICA
// ============================================================================

/**
 * Verifica cache de respostas para uma mensagem
 * 
 * Fluxo:
 * 1. Verifica se cache está habilitado
 * 2. Detecta se é uma saudação simples
 * 3. Se for saudação, tenta obter do cache Redis
 * 4. Se cache hit, retorna resposta cacheada
 * 5. Se cache miss para saudação, gera resposta e salva no cache
 * 
 * @param tenantId - ID do tenant (multi-tenancy)
 * @param message - Mensagem do usuário
 * @returns Resultado do check de cache
 */
export async function checkResponseCache(
  tenantId: string,
  message: string
): Promise<CacheCheckResult> {
  const startTime = Date.now();
  
  // CORREÇÃO 17/12/2025: Separação clara entre cache hit e resposta disponível
  const result: CacheCheckResult = {
    cacheHit: false,  // true apenas se veio do Redis
    hasResponse: false, // true se tem resposta (cache ou gerada)
    isGreeting: false,
    latencyMs: 0,
  };
  
  // Verificar se cache está habilitado
  if (!CACHE_ENABLED) {
    result.latencyMs = Date.now() - startTime;
    return result;
  }
  
  // Verificar se Redis está disponível
  if (!isRedisAvailable()) {
    logger.debug('Response cache: Redis não disponível');
    result.latencyMs = Date.now() - startTime;
    return result;
  }
  
  // Detectar se é saudação
  const greetingDetected = isGreeting(message);
  result.isGreeting = greetingDetected;
  
  if (greetingDetected) {
    metricsState.greetingsDetected++;
  }
  
  // Se não for saudação, não usar cache (mensagens complexas precisam de LLM)
  if (!greetingDetected) {
    // Não é saudação = não conta como miss (vai para LLM)
    result.latencyMs = Date.now() - startTime;
    updateLatencyMetrics(result.latencyMs);
    return result;
  }
  
  // Gerar hash da mensagem
  const messageHash = hashMessage(message);
  result.cacheKey = getCacheKey(tenantId, messageHash);
  
  // Tentar obter do cache
  const cached = await getFromCache(tenantId, messageHash);
  
  if (cached) {
    // CACHE HIT REAL - resposta veio do Redis
    metricsState.hits++;
    result.cacheHit = true;
    result.hasResponse = true;
    result.response = cached.response;
    
    logger.info({
      tenantId,
      hitCount: cached.hitCount,
      language: cached.language,
    }, 'Response cache HIT - saudação do Redis');
  } else {
    // CACHE MISS - saudação detectada mas não estava no cache
    // Gerar resposta e salvar para próximas vezes
    metricsState.misses++;
    result.cacheHit = false;  // NÃO veio do cache
    result.hasResponse = true; // MAS tem resposta gerada
    
    const language = detectLanguage(message);
    const response = generateGreetingResponse(language);
    
    // Salvar no cache para próximas vezes
    await saveToCache(tenantId, messageHash, response, language);
    
    result.response = response;
    
    logger.info({
      tenantId,
      language,
      generated: true,
    }, 'Response cache MISS - saudação gerada e cacheada');
  }
  
  result.latencyMs = Date.now() - startTime;
  updateLatencyMetrics(result.latencyMs);
  
  return result;
}

/**
 * Atualiza métricas de latência
 */
function updateLatencyMetrics(latencyMs: number): void {
  metricsState.totalLatencyMs += latencyMs;
  metricsState.requestCount++;
}

/**
 * Obtém métricas do cache
 */
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

/**
 * Reseta métricas (para testes)
 */
export function resetCacheMetrics(): void {
  metricsState = {
    hits: 0,
    misses: 0,
    greetingsDetected: 0,
    totalLatencyMs: 0,
    requestCount: 0,
  };
}

/**
 * Limpa cache de um tenant específico
 */
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

/**
 * Verifica se o cache está habilitado e operacional
 */
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
