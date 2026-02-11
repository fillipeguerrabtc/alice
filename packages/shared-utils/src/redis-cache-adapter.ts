/**
 * Redis Cache Adapter - Alice Enterprise Platform
 * 
 * Adapter pattern para cache distribuído com Redis.
 * Regra 6 CLAUDE.md: PROIBIDO in-memory em produção.
 * 
 * Features:
 * - Fail-fast em produção se Redis indisponível
 * - Fallback para in-memory apenas em desenvolvimento
 * - TTL configurável
 * - Prefixo por namespace
 * 
 * @module @alice/shared-utils/redis-cache-adapter
 */

import { createClient, RedisClientType } from 'redis';
import { createLogger } from './logger.js';

const logger = createLogger('redis-cache-adapter');

// Cliente Redis singleton
let redisClient: RedisClientType | null = null;

function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Interface do Cache Adapter (Strategy Pattern)
 */
export interface CacheAdapter<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<number>;
  clear(): Promise<void>;
  isDistributed(): boolean;
}

/**
 * Inicializa o cliente Redis de forma lazy
 * Chamada durante startup do serviço
 */
export async function initializeRedisCache(): Promise<boolean> {
  const redisUrl = process.env.REDIS_URL;
  
  if (!redisUrl) {
    if (isProductionEnv()) {
      logger.fatal('REDIS_URL não configurado em produção (Regra 6 - fail-fast)');
      throw new Error('REDIS_URL é obrigatório em produção para cache distribuído');
    }
    // Em dev/test, a ausência de Redis pode ser intencional. Não tratar como warning.
    logger.info('REDIS_URL não configurado - cache distribuído desabilitado (dev/test)');
    return false;
  }
  
  try {
    const client = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 10000,
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            if (isProductionEnv()) {
              logger.fatal('CRÍTICO: Redis indisponível em produção após 10 tentativas - fail-fast (Regra 6)');
              throw new Error('Redis obrigatório em produção para cache distribuído');
            }
            logger.info('Redis: máximo de tentativas atingido (dev/test)');
            return new Error('Max retries reached');
          }
          const delayMs = Math.min(retries * 500, 10000);
          logger.warn({ retries, delayMs }, 'Redis reconectando...');
          return delayMs;
        },
      },
    });
    
    client.on('error', (err) => {
      logger.error({ error: err.message }, 'Erro Redis');
      if (isProductionEnv()) {
        logger.fatal({ error: err.message }, 'CRÍTICO: Erro Redis em produção');
      }
    });
    
    client.on('connect', () => {
      logger.info('Redis conectado para cache distribuído');
    });
    
    await client.connect();
    redisClient = client as RedisClientType;
    return true;
  } catch (error) {
    if (isProductionEnv()) {
      logger.fatal({ error: (error as Error).message }, 'CRÍTICO: Falha ao conectar Redis em produção');
      throw new Error(`Redis obrigatório em produção: ${(error as Error).message}`);
    }
    logger.info({ error: (error as Error).message }, 'Falha ao conectar Redis (dev/test)');
    return false;
  }
}

/**
 * Obtém cliente Redis singleton
 */
export function getRedisClient(): RedisClientType | null {
  return redisClient?.isOpen ? redisClient : null;
}

/**
 * Verifica se Redis está disponível
 */
export function isRedisAvailable(): boolean {
  return redisClient !== null && redisClient.isOpen;
}

/**
 * Redis Cache Adapter - Implementação distribuída
 */
export class RedisCacheAdapter<T> implements CacheAdapter<T> {
  private prefix: string;
  private defaultTtlMs: number;

  constructor(prefix: string, defaultTtlMs: number = 5 * 60 * 1000) {
    this.prefix = prefix;
    this.defaultTtlMs = defaultTtlMs;
  }

  private getFullKey(key: string): string {
    return `cache:${this.prefix}:${key}`;
  }

  async get(key: string): Promise<T | undefined> {
    const client = getRedisClient();
    if (!client) {
      if (isProductionEnv()) {
        logger.error({ key }, 'Redis não disponível para leitura de cache em produção');
      } else {
        logger.debug({ key }, 'Redis não disponível para leitura de cache (dev/test)');
      }
      return undefined;
    }
    
    try {
      const data = await client.get(this.getFullKey(key));
      if (!data) return undefined;
      return JSON.parse(data) as T;
    } catch (error) {
      logger.error({ key, error: (error as Error).message }, 'Erro ao obter do cache Redis');
      return undefined;
    }
  }

  async set(key: string, value: T, ttlMs?: number): Promise<void> {
    const client = getRedisClient();
    if (!client) {
      if (isProductionEnv()) {
        logger.error({ key }, 'Redis não disponível em produção para escrita');
        throw new Error('Redis obrigatório em produção');
      }
      return;
    }
    
    try {
      const ttl = ttlMs ?? this.defaultTtlMs;
      await client.setEx(
        this.getFullKey(key),
        Math.ceil(ttl / 1000),
        JSON.stringify(value)
      );
    } catch (error) {
      logger.error({ key, error: (error as Error).message }, 'Erro ao salvar no cache Redis');
      if (isProductionEnv()) {
        throw error;
      }
    }
  }

  async delete(key: string): Promise<void> {
    const client = getRedisClient();
    if (!client) return;
    
    try {
      await client.del(this.getFullKey(key));
    } catch (error) {
      logger.error({ key, error: (error as Error).message }, 'Erro ao deletar do cache Redis');
    }
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const client = getRedisClient();
    if (!client) return 0;
    
    try {
      const pattern = `cache:${this.prefix}:${prefix}*`;
      const keys = await client.keys(pattern);
      if (keys.length > 0) {
        await client.del(keys);
      }
      return keys.length;
    } catch (error) {
      logger.error({ prefix, error: (error as Error).message }, 'Erro ao deletar por prefixo');
      return 0;
    }
  }

  async clear(): Promise<void> {
    const client = getRedisClient();
    if (!client) return;
    
    try {
      const keys = await client.keys(`cache:${this.prefix}:*`);
      if (keys.length > 0) {
        await client.del(keys);
      }
      logger.info({ prefix: this.prefix, entriesRemoved: keys.length }, 'Cache Redis limpo');
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Erro ao limpar cache Redis');
    }
  }

  isDistributed(): boolean {
    return true;
  }
}

/**
 * In-Memory Cache Adapter - Apenas para desenvolvimento
 */
export class MemoryCacheAdapter<T> implements CacheAdapter<T> {
  private cache: Map<string, { value: T; expiresAt: number }> = new Map();
  private prefix: string;
  private defaultTtlMs: number;
  private cleanupIntervalId: NodeJS.Timeout | null = null;

  constructor(prefix: string, defaultTtlMs: number = 5 * 60 * 1000) {
    this.prefix = prefix;
    this.defaultTtlMs = defaultTtlMs;
    
    // Limpeza periódica de entradas expiradas
    this.cleanupIntervalId = setInterval(() => this.cleanup(), 60 * 1000);
  }

  private getFullKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) {
        this.cache.delete(key);
      }
    }
  }

  async get(key: string): Promise<T | undefined> {
    const fullKey = this.getFullKey(key);
    const entry = this.cache.get(fullKey);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(fullKey);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: T, ttlMs?: number): Promise<void> {
    const ttl = ttlMs ?? this.defaultTtlMs;
    this.cache.set(this.getFullKey(key), {
      value,
      expiresAt: Date.now() + ttl,
    });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(this.getFullKey(key));
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const fullPrefix = `${this.prefix}:${prefix}`;
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(fullPrefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  async clear(): Promise<void> {
    const count = this.cache.size;
    this.cache.clear();
    logger.info({ prefix: this.prefix, entriesRemoved: count }, 'Cache in-memory limpo');
  }

  isDistributed(): boolean {
    return false;
  }

  destroy(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }
}

/**
 * Factory para criar cache adapter apropriado
 * Deve ser chamado APÓS initializeRedisCache()
 * Regra 6: Em produção, sempre Redis; em dev, fallback para memory
 */
export function createCacheAdapter<T>(
  prefix: string,
  ttlMs: number = 5 * 60 * 1000
): CacheAdapter<T> {
  if (isRedisAvailable()) {
    logger.info({ prefix }, 'Usando cache adapter Redis');
    return new RedisCacheAdapter<T>(prefix, ttlMs);
  }
  
  if (isProductionEnv()) {
    logger.fatal({ prefix }, 'Redis não disponível em produção - fail-fast (Regra 6)');
    throw new Error('Redis obrigatório em produção para cache distribuído');
  }
  
  // Cache in-memory é permitido apenas fora de produção (Regra 6).
  // Não tratar como warning: em dev/test isso pode ser intencional.
  logger.info({ prefix }, 'Usando cache adapter in-memory (dev/test)');
  return new MemoryCacheAdapter<T>(prefix, ttlMs);
}

/**
 * Fecha conexão Redis (para graceful shutdown)
 */
export async function closeRedisCacheClient(): Promise<void> {
  if (redisClient?.isOpen) {
    try {
      await redisClient.quit();
      logger.info('Cliente Redis de cache encerrado');
    } catch (error) {
      logger.error({ error }, 'Erro ao encerrar Redis cache');
    }
  }
  redisClient = null;
}
