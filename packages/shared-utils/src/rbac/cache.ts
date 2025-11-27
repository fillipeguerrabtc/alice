/**
 * Cache de Permissões RBAC - Alice Enterprise Platform
 * 
 * Cache em memória para permissões por tenant.
 * Documentação em PT-BR (Regra 10 replit.md).
 * 
 * @module @alice/shared-utils/rbac/cache
 */

import { createLogger } from '../logger.js';

const logger = createLogger('rbac-cache');

/**
 * Entrada no cache de permissões
 */
interface CacheEntry {
  permissions: Set<string>;
  timestamp: number;
}

/**
 * Configuração do cache
 */
export interface CacheConfig {
  /** TTL em milissegundos (padrão: 5 minutos) */
  ttlMs?: number;
  /** Tamanho máximo do cache (padrão: 1000 entradas) */
  maxSize?: number;
  /** Intervalo de limpeza em ms (padrão: 1 minuto) */
  cleanupIntervalMs?: number;
}

/**
 * Cache de permissões por usuário/tenant
 */
export class PermissionCache {
  private cache: Map<string, CacheEntry>;
  private ttlMs: number;
  private maxSize: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config?: CacheConfig) {
    this.cache = new Map();
    this.ttlMs = config?.ttlMs || 5 * 60 * 1000;
    this.maxSize = config?.maxSize || 1000;

    const cleanupInterval = config?.cleanupIntervalMs || 60 * 1000;
    this.cleanupInterval = setInterval(() => this.cleanup(), cleanupInterval);
  }

  /**
   * Gera chave do cache
   */
  private getCacheKey(userId: string, tenantId?: string): string {
    return tenantId ? `${tenantId}:${userId}` : userId;
  }

  /**
   * Obtém permissões do cache
   * 
   * @param userId - ID do usuário
   * @param tenantId - ID do tenant (opcional)
   * @returns Set de permissões ou undefined se não encontrado/expirado
   */
  get(userId: string, tenantId?: string): Set<string> | undefined {
    const key = this.getCacheKey(userId, tenantId);
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.permissions;
  }

  /**
   * Armazena permissões no cache
   * 
   * @param userId - ID do usuário
   * @param tenantId - ID do tenant (opcional)
   * @param permissions - Set de permissões
   */
  set(userId: string, tenantId: string | undefined, permissions: Set<string>): void {
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    const key = this.getCacheKey(userId, tenantId);
    this.cache.set(key, {
      permissions,
      timestamp: Date.now(),
    });
  }

  /**
   * Invalida cache de um usuário
   * 
   * @param userId - ID do usuário
   * @param tenantId - ID do tenant (opcional)
   */
  invalidate(userId: string, tenantId?: string): void {
    const key = this.getCacheKey(userId, tenantId);
    this.cache.delete(key);
    logger.debug({ userId, tenantId }, 'Cache de permissões invalidado');
  }

  /**
   * Invalida todo o cache de um tenant
   * 
   * @param tenantId - ID do tenant
   */
  invalidateTenant(tenantId: string): void {
    const prefix = `${tenantId}:`;
    let count = 0;

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }

    logger.info({ tenantId, entriesRemoved: count }, 'Cache de tenant invalidado');
  }

  /**
   * Limpa todo o cache
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    logger.info({ entriesRemoved: size }, 'Cache de permissões limpo');
  }

  /**
   * Remove entradas expiradas
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug({ entriesRemoved: removed }, 'Limpeza de cache executada');
    }
  }

  /**
   * Remove as entradas mais antigas quando o cache está cheio
   */
  private evictOldest(): void {
    let oldest: { key: string; timestamp: number } | null = null;

    for (const [key, entry] of this.cache.entries()) {
      if (!oldest || entry.timestamp < oldest.timestamp) {
        oldest = { key, timestamp: entry.timestamp };
      }
    }

    if (oldest) {
      this.cache.delete(oldest.key);
    }
  }

  /**
   * Obtém estatísticas do cache
   */
  getStats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
    };
  }

  /**
   * Para o timer de limpeza (para testes)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

/**
 * Instância singleton do cache de permissões
 */
export const permissionCache = new PermissionCache();
