/**
 * Cache de Permissões RBAC - Alice Enterprise Platform
 * 
 * Cache distribuído (Redis) para permissões por tenant.
 * C5 Code Review: Usa CacheAdapter (Redis em produção, in-memory em dev)
 * Documentação em PT-BR (Regra 10 CLAUDE.md).
 * 
 * @module @alice/shared-utils/rbac/cache
 * 
 * ## Uso Planejado (Arquitetura RBAC Enterprise)
 * 
 * Este cache é parte da arquitetura RBAC centralizada. Integração pendente:
 * 
 * 1. **auth-service**: Deve popular o cache ao resolver sessões/permissões
 *    e publicar eventos de invalidação quando roles ou tenants mudarem.
 * 
 * 2. **Microsserviços** (chat, rag, training, integrations): Devem usar
 *    requirePermission() do @alice/shared-utils ao invés de verificações
 *    inline de roles (ex: rolesWithTakeoverPermission.includes()).
 * 
 * 3. **Invalidação**: auth-service deve chamar permissionCache.invalidate()
 *    ou permissionCache.invalidateTenant() em mudanças de permissão.
 * 
 * @see CLAUDE.md - OIDC Provider e 6-level RBAC
 * @see packages/shared-utils/src/rbac/middleware.ts - requirePermission() já implementado
 */

import { createLogger } from '../logger.js';
import { 
  CacheAdapter, 
  createCacheAdapter, 
  initializeRedisCache, 
} from '../redis-cache-adapter.js';

const logger = createLogger('rbac-cache');

/**
 * Entrada no cache de permissões (serializada para Redis)
 */
interface CachedPermissions {
  permissions: string[];
  timestamp: number;
}

/**
 * Configuração do cache
 */
export interface PermissionCacheConfig {
  /** TTL em milissegundos (padrão: 5 minutos) */
  ttlMs?: number;
  /** Prefixo do namespace no cache (padrão: 'rbac-permissions') */
  prefix?: string;
}

/**
 * Cache de permissões por usuário/tenant
 * C5 Code Review: Usa CacheAdapter (Redis em produção, in-memory em dev)
 * Regra 6: fail-fast em produção se Redis indisponível
 */
export class PermissionCache {
  private cacheAdapter: CacheAdapter<CachedPermissions> | null = null;
  private ttlMs: number;
  private prefix: string;
  private initialized = false;

  constructor(config?: PermissionCacheConfig) {
    this.ttlMs = config?.ttlMs || 5 * 60 * 1000;
    this.prefix = config?.prefix || 'rbac-permissions';
  }

  /**
   * Inicializa o cache adapter (deve ser chamado no startup do serviço)
   * Em produção: Redis obrigatório (fail-fast)
   * Em desenvolvimento: fallback para in-memory
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await initializeRedisCache();
      this.cacheAdapter = createCacheAdapter<CachedPermissions>(this.prefix, this.ttlMs);
      this.initialized = true;
      logger.info({ 
        distributed: this.cacheAdapter.isDistributed(), 
        ttlMs: this.ttlMs,
      }, 'Cache de permissões RBAC inicializado');
    } catch (error) {
      logger.fatal({ error: (error as Error).message }, 'Falha ao inicializar cache RBAC');
      throw error;
    }
  }

  /**
   * Verifica se o cache está inicializado
   */
  isInitialized(): boolean {
    return this.initialized && this.cacheAdapter !== null;
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
  async get(userId: string, tenantId?: string): Promise<Set<string> | undefined> {
    if (!this.cacheAdapter) {
      logger.warn('Cache de permissões não inicializado');
      return undefined;
    }

    const key = this.getCacheKey(userId, tenantId);
    const entry = await this.cacheAdapter.get(key);

    if (!entry) {
      return undefined;
    }

    // Verificar TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      await this.cacheAdapter.delete(key);
      return undefined;
    }

    return new Set(entry.permissions);
  }

  /**
   * Armazena permissões no cache
   * 
   * @param userId - ID do usuário
   * @param tenantId - ID do tenant (opcional)
   * @param permissions - Set de permissões
   */
  async set(userId: string, tenantId: string | undefined, permissions: Set<string>): Promise<void> {
    if (!this.cacheAdapter) {
      logger.warn('Cache de permissões não inicializado');
      return;
    }

    const key = this.getCacheKey(userId, tenantId);
    await this.cacheAdapter.set(key, {
      permissions: Array.from(permissions),
      timestamp: Date.now(),
    }, this.ttlMs);
  }

  /**
   * Invalida cache de um usuário
   * 
   * @param userId - ID do usuário
   * @param tenantId - ID do tenant (opcional)
   */
  async invalidate(userId: string, tenantId?: string): Promise<void> {
    if (!this.cacheAdapter) {
      return;
    }

    const key = this.getCacheKey(userId, tenantId);
    await this.cacheAdapter.delete(key);
    logger.debug({ userId, tenantId }, 'Cache de permissões invalidado');
  }

  /**
   * Invalida todo o cache de um tenant
   * 
   * @param tenantId - ID do tenant
   */
  async invalidateTenant(tenantId: string): Promise<void> {
    if (!this.cacheAdapter) {
      return;
    }

    const count = await this.cacheAdapter.deleteByPrefix(tenantId);
    logger.info({ tenantId, entriesRemoved: count }, 'Cache de tenant invalidado');
  }

  /**
   * Limpa todo o cache
   */
  async clear(): Promise<void> {
    if (!this.cacheAdapter) {
      return;
    }

    await this.cacheAdapter.clear();
    logger.info('Cache de permissões limpo');
  }

  /**
   * Obtém estatísticas do cache
   */
  getStats(): { initialized: boolean; distributed: boolean; ttlMs: number } {
    return {
      initialized: this.initialized,
      distributed: this.cacheAdapter?.isDistributed() ?? false,
      ttlMs: this.ttlMs,
    };
  }

  /**
   * Encerra o cache (para graceful shutdown)
   * NOTA: NÃO fecha o cliente Redis aqui - isso é feito por closeRedisCacheClient()
   * em um callback separado para evitar double-close
   */
  async destroy(): Promise<void> {
    this.cacheAdapter = null;
    this.initialized = false;
    logger.info('Cache de permissões encerrado');
  }
}

/**
 * Instância singleton do cache de permissões
 * IMPORTANTE: Chamar permissionCache.initialize() no startup do serviço
 */
export const permissionCache = new PermissionCache();
