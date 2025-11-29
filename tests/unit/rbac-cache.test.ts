/**
 * Testes de Cache RBAC - Alice Enterprise Platform
 * 
 * Valida:
 * - Cache hit/miss behavior
 * - Invalidação de cache por usuário/tenant
 * - Estatísticas de cache (hits, misses, invalidations)
 * - Integração com métricas Prometheus
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PermissionCache,
  permissionCache,
} from '../../packages/shared-utils/src/rbac/cache';
import {
  checkPermission,
  getRbacCacheStats,
  resetRbacCacheStats,
  invalidateUserPermissions,
  invalidateTenantPermissions,
  clearPermissionCache,
  initRbacPrometheusMetrics,
} from '../../packages/shared-utils/src/rbac/middleware';
import type { AuthContext } from '../../packages/shared-utils/src/rbac/types';

describe('RBAC Cache - PermissionCache Comportamento Básico', () => {
  let cache: PermissionCache;

  beforeEach(() => {
    cache = new PermissionCache({ ttlMs: 60000 });
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('Operações básicas', () => {
    it('deve armazenar e recuperar Set de permissões', () => {
      const userId = 'user-123';
      const tenantId = 'tenant-456';
      const permissions = new Set(['perm:a', 'perm:b', 'perm:c']);

      cache.set(userId, tenantId, permissions);
      const result = cache.get(userId, tenantId);

      expect(result).toBeDefined();
      expect(result?.has('perm:a')).toBe(true);
      expect(result?.has('perm:b')).toBe(true);
      expect(result?.has('perm:c')).toBe(true);
    });

    it('deve retornar undefined para cache miss', () => {
      const result = cache.get('unknown-user', 'unknown-tenant');
      expect(result).toBeUndefined();
    });

    it('deve tratar tenant undefined corretamente', () => {
      const userId = 'user-123';
      const permissions = new Set(['system:global:read']);

      cache.set(userId, undefined, permissions);
      const result = cache.get(userId, undefined);

      expect(result).toBeDefined();
      expect(result?.has('system:global:read')).toBe(true);
    });

    it('deve isolar cache por tenant', () => {
      const userId = 'user-123';
      const permsTenantA = new Set(['perm:a']);
      const permsTenantB = new Set(['perm:b']);

      cache.set(userId, 'tenant-A', permsTenantA);
      cache.set(userId, 'tenant-B', permsTenantB);

      expect(cache.get(userId, 'tenant-A')?.has('perm:a')).toBe(true);
      expect(cache.get(userId, 'tenant-A')?.has('perm:b')).toBe(false);
      expect(cache.get(userId, 'tenant-B')?.has('perm:b')).toBe(true);
      expect(cache.get(userId, 'tenant-B')?.has('perm:a')).toBe(false);
    });

    it('deve isolar cache por usuário', () => {
      const tenantId = 'tenant-456';
      const permsUserA = new Set(['perm:a']);
      const permsUserB = new Set(['perm:b']);

      cache.set('user-A', tenantId, permsUserA);
      cache.set('user-B', tenantId, permsUserB);

      expect(cache.get('user-A', tenantId)?.has('perm:a')).toBe(true);
      expect(cache.get('user-B', tenantId)?.has('perm:b')).toBe(true);
    });
  });

  describe('Invalidação', () => {
    it('deve invalidar cache de usuário específico', () => {
      const userId = 'user-123';
      const tenantId = 'tenant-456';

      cache.set(userId, tenantId, new Set(['perm:a', 'perm:b']));
      cache.set('other-user', tenantId, new Set(['perm:a']));

      cache.invalidate(userId, tenantId);

      expect(cache.get(userId, tenantId)).toBeUndefined();
      expect(cache.get('other-user', tenantId)).toBeDefined();
    });

    it('deve invalidar todo o cache de um tenant', () => {
      const tenantId = 'tenant-456';

      cache.set('user-A', tenantId, new Set(['perm:a']));
      cache.set('user-B', tenantId, new Set(['perm:b']));
      cache.set('user-C', 'other-tenant', new Set(['perm:c']));

      cache.invalidateTenant(tenantId);

      expect(cache.get('user-A', tenantId)).toBeUndefined();
      expect(cache.get('user-B', tenantId)).toBeUndefined();
      expect(cache.get('user-C', 'other-tenant')).toBeDefined();
    });

    it('deve limpar todo o cache', () => {
      cache.set('user-A', 'tenant-1', new Set(['perm:a']));
      cache.set('user-B', 'tenant-2', new Set(['perm:b']));
      cache.set('user-C', 'tenant-3', new Set(['perm:c']));

      cache.clear();

      expect(cache.get('user-A', 'tenant-1')).toBeUndefined();
      expect(cache.get('user-B', 'tenant-2')).toBeUndefined();
      expect(cache.get('user-C', 'tenant-3')).toBeUndefined();
    });
  });

  describe('Estatísticas', () => {
    it('deve retornar estatísticas do cache', () => {
      const stats = cache.getStats();

      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('maxSize');
      expect(stats).toHaveProperty('ttlMs');
      expect(typeof stats.size).toBe('number');
      expect(typeof stats.maxSize).toBe('number');
      expect(typeof stats.ttlMs).toBe('number');
    });

    it('deve incrementar tamanho ao adicionar entradas', () => {
      const sizeBefore = cache.getStats().size;
      
      cache.set('user-1', 'tenant-1', new Set(['perm:a']));
      cache.set('user-2', 'tenant-2', new Set(['perm:b']));
      
      expect(cache.getStats().size).toBe(sizeBefore + 2);
    });
  });
});

describe('RBAC Cache - Estatísticas Globais', () => {
  beforeEach(() => {
    resetRbacCacheStats();
    clearPermissionCache();
  });

  afterEach(() => {
    resetRbacCacheStats();
    clearPermissionCache();
  });

  describe('getRbacCacheStats', () => {
    it('deve retornar estatísticas iniciais zeradas após reset', () => {
      const stats = getRbacCacheStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('deve ter estrutura correta', () => {
      const stats = getRbacCacheStats();

      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('invalidations');
    });
  });
});

describe('RBAC Cache - Funções de Invalidação Exportadas', () => {
  beforeEach(() => {
    resetRbacCacheStats();
    clearPermissionCache();
  });

  afterEach(() => {
    resetRbacCacheStats();
    clearPermissionCache();
  });

  describe('invalidateUserPermissions', () => {
    it('deve invalidar cache de usuário via função exportada', () => {
      permissionCache.set('user-test', 'tenant-test', new Set(['perm:test']));
      expect(permissionCache.get('user-test', 'tenant-test')).toBeDefined();

      invalidateUserPermissions('user-test', 'tenant-test');

      expect(permissionCache.get('user-test', 'tenant-test')).toBeUndefined();
    });

    it('deve incrementar contador de invalidações', () => {
      const statsBefore = getRbacCacheStats();
      
      invalidateUserPermissions('user-123', 'tenant-456');
      
      const statsAfter = getRbacCacheStats();
      expect(statsAfter.invalidations).toBeGreaterThan(statsBefore.invalidations);
    });
  });

  describe('invalidateTenantPermissions', () => {
    it('deve invalidar cache de todo o tenant via função exportada', () => {
      permissionCache.set('user-A', 'tenant-X', new Set(['perm:a']));
      permissionCache.set('user-B', 'tenant-X', new Set(['perm:b']));

      invalidateTenantPermissions('tenant-X');

      expect(permissionCache.get('user-A', 'tenant-X')).toBeUndefined();
      expect(permissionCache.get('user-B', 'tenant-X')).toBeUndefined();
    });

    it('deve incrementar contador de invalidações', () => {
      const statsBefore = getRbacCacheStats();
      
      invalidateTenantPermissions('tenant-ABC');
      
      const statsAfter = getRbacCacheStats();
      expect(statsAfter.invalidations).toBeGreaterThan(statsBefore.invalidations);
    });
  });

  describe('clearPermissionCache', () => {
    it('deve limpar todo o cache via função exportada', () => {
      permissionCache.set('user-1', 'tenant-1', new Set(['perm:1']));
      permissionCache.set('user-2', 'tenant-2', new Set(['perm:2']));

      clearPermissionCache();

      expect(permissionCache.get('user-1', 'tenant-1')).toBeUndefined();
      expect(permissionCache.get('user-2', 'tenant-2')).toBeUndefined();
    });

    it('deve incrementar contador de invalidações', () => {
      const statsBefore = getRbacCacheStats();
      
      clearPermissionCache();
      
      const statsAfter = getRbacCacheStats();
      expect(statsAfter.invalidations).toBeGreaterThan(statsBefore.invalidations);
    });
  });
});

describe('RBAC Cache - checkPermission com Cache', () => {
  const mockAuthContext: AuthContext = {
    userId: 'user-cache-test',
    tenantId: 'tenant-cache-test',
    role: 'admin',
    email: 'test@example.com',
  };

  beforeEach(() => {
    resetRbacCacheStats();
    clearPermissionCache();
  });

  afterEach(() => {
    resetRbacCacheStats();
    clearPermissionCache();
  });

  describe('Cache hit/miss behavior', () => {
    it('deve registrar cache miss na primeira verificação', () => {
      const statsBefore = getRbacCacheStats();
      
      checkPermission(mockAuthContext, 'chat:conversations:read');
      
      const statsAfter = getRbacCacheStats();
      expect(statsAfter.misses).toBeGreaterThan(statsBefore.misses);
    });

    it('deve registrar cache hit na segunda verificação', () => {
      checkPermission(mockAuthContext, 'chat:conversations:read');
      
      const statsBefore = getRbacCacheStats();
      
      checkPermission(mockAuthContext, 'chat:conversations:read');
      
      const statsAfter = getRbacCacheStats();
      expect(statsAfter.hits).toBeGreaterThan(statsBefore.hits);
    });

    it('deve retornar resultado consistente do cache', () => {
      const result1 = checkPermission(mockAuthContext, 'chat:conversations:read');
      const result2 = checkPermission(mockAuthContext, 'chat:conversations:read');
      
      expect(result1.allowed).toBe(result2.allowed);
    });

    it('deve respeitar permissões negadas no cache', () => {
      const guestContext: AuthContext = {
        userId: 'user-guest',
        tenantId: 'tenant-guest',
        role: 'guest',
      };

      const result1 = checkPermission(guestContext, 'auth:users:read');
      const result2 = checkPermission(guestContext, 'auth:users:read');
      
      expect(result1.allowed).toBe(false);
      expect(result2.allowed).toBe(false);
    });

    it('deve retornar PermissionCheckResult com estrutura correta', () => {
      const result = checkPermission(mockAuthContext, 'chat:conversations:read');
      
      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('permission');
      expect(result).toHaveProperty('userRole');
      expect(result.permission).toBe('chat:conversations:read');
      expect(result.userRole).toBe('admin');
    });
  });

  describe('Cache invalidation effects', () => {
    it('deve limpar resultado após invalidação de usuário', () => {
      checkPermission(mockAuthContext, 'chat:conversations:read');
      
      invalidateUserPermissions(mockAuthContext.userId, mockAuthContext.tenantId);
      
      const missesBefore = getRbacCacheStats().misses;
      checkPermission(mockAuthContext, 'chat:conversations:read');
      const missesAfter = getRbacCacheStats().misses;
      
      expect(missesAfter).toBeGreaterThan(missesBefore);
    });

    it('deve limpar resultados após invalidação de tenant', () => {
      const user1: AuthContext = { ...mockAuthContext, userId: 'user-1' };
      const user2: AuthContext = { ...mockAuthContext, userId: 'user-2' };

      checkPermission(user1, 'chat:conversations:read');
      checkPermission(user2, 'chat:conversations:read');
      
      invalidateTenantPermissions(mockAuthContext.tenantId!);
      
      const missesBefore = getRbacCacheStats().misses;
      
      checkPermission(user1, 'chat:conversations:read');
      checkPermission(user2, 'chat:conversations:read');
      
      const missesAfter = getRbacCacheStats().misses;
      expect(missesAfter).toBeGreaterThan(missesBefore);
    });
  });
});

describe('RBAC Cache - Métricas Prometheus', () => {
  beforeEach(() => {
    resetRbacCacheStats();
    clearPermissionCache();
  });

  afterEach(() => {
    resetRbacCacheStats();
    clearPermissionCache();
  });

  describe('initRbacPrometheusMetrics', () => {
    it('deve aceitar objeto de métricas válido', () => {
      const mockMetrics = {
        cacheHitsTotal: { inc: vi.fn() },
        cacheMissesTotal: { inc: vi.fn() },
        cacheInvalidationsTotal: { inc: vi.fn() },
        checkDuration: { observe: vi.fn() },
        cacheHitRate: { set: vi.fn() },
      };

      expect(() => initRbacPrometheusMetrics(mockMetrics)).not.toThrow();
    });

    it('deve integrar métricas com operações de cache', () => {
      const mockMetrics = {
        cacheHitsTotal: { inc: vi.fn() },
        cacheMissesTotal: { inc: vi.fn() },
        cacheInvalidationsTotal: { inc: vi.fn() },
        checkDuration: { observe: vi.fn() },
        cacheHitRate: { set: vi.fn() },
      };

      initRbacPrometheusMetrics(mockMetrics);

      const authContext: AuthContext = {
        userId: 'user-metrics-test',
        tenantId: 'tenant-metrics-test',
        role: 'admin',
      };

      checkPermission(authContext, 'chat:conversations:read');

      expect(mockMetrics.cacheMissesTotal.inc).toHaveBeenCalled();
    });
  });
});

describe('RBAC Cache - Cenários de Borda', () => {
  let cache: PermissionCache;

  beforeEach(() => {
    cache = new PermissionCache({ ttlMs: 60000 });
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('Valores especiais', () => {
    it('deve tratar userId vazio', () => {
      cache.set('', 'tenant-123', new Set(['perm:test']));
      expect(cache.get('', 'tenant-123')).toBeDefined();
    });

    it('deve tratar Set de permissões vazio', () => {
      cache.set('user-123', 'tenant-123', new Set());
      const result = cache.get('user-123', 'tenant-123');
      expect(result).toBeDefined();
      expect(result?.size).toBe(0);
    });

    it('deve tratar caracteres especiais em IDs', () => {
      const userId = 'user:with:colons-and_underscores.and.dots';
      const tenantId = 'tenant/with/slashes';
      const permissions = new Set(['module:resource:action:extra']);

      cache.set(userId, tenantId, permissions);
      expect(cache.get(userId, tenantId)).toBeDefined();
    });
  });

  describe('Performance e escalabilidade', () => {
    it('deve suportar múltiplas entradas', () => {
      const numEntries = 100;
      
      for (let i = 0; i < numEntries; i++) {
        cache.set(`user-${i}`, `tenant-${i % 10}`, new Set([`perm:${i % 5}`]));
      }

      for (let i = 0; i < numEntries; i++) {
        const result = cache.get(`user-${i}`, `tenant-${i % 10}`);
        expect(result).toBeDefined();
        expect(result?.has(`perm:${i % 5}`)).toBe(true);
      }
    });

    it('deve invalidar tenant com muitas entradas eficientemente', () => {
      const targetTenant = 'tenant-target';
      
      for (let i = 0; i < 50; i++) {
        cache.set(`user-${i}`, targetTenant, new Set([`perm:${i}`]));
      }
      for (let i = 0; i < 50; i++) {
        cache.set(`user-other-${i}`, 'other-tenant', new Set([`perm:${i}`]));
      }

      cache.invalidateTenant(targetTenant);

      expect(cache.get('user-0', targetTenant)).toBeUndefined();
      expect(cache.get('user-other-0', 'other-tenant')).toBeDefined();
    });
  });
});
