/**
 * Testes de Cache RBAC - Alice Enterprise Platform
 * 
 * Valida:
 * - Cache hit/miss behavior
 * - Invalidação de cache por usuário/tenant
 * - Estatísticas de cache (hits, misses, invalidations)
 * - Integração com métricas Prometheus
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PermissionCache,
  permissionCache,
} from '../../packages/shared-utils/src/rbac/cache';
import {
  checkPermission,
  checkPermissionDirect,
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

  beforeEach(async () => {
    cache = new PermissionCache({ ttlMs: 60000 });
    await cache.initialize();
  });

  afterEach(async () => {
    await cache.destroy();
  });

  describe('Operações básicas', () => {
    it('deve armazenar e recuperar Set de permissões', async () => {
      const userId = 'user-123';
      const tenantId = 'tenant-456';
      const permissions = new Set(['perm:a', 'perm:b', 'perm:c']);

      await cache.set(userId, tenantId, permissions);
      const result = await cache.get(userId, tenantId);

      expect(result).toBeDefined();
      expect(result?.has('perm:a')).toBe(true);
      expect(result?.has('perm:b')).toBe(true);
      expect(result?.has('perm:c')).toBe(true);
    });

    it('deve retornar undefined para cache miss', async () => {
      const result = await cache.get('unknown-user', 'unknown-tenant');
      expect(result).toBeUndefined();
    });

    it('deve tratar tenant undefined corretamente', async () => {
      const userId = 'user-123';
      const permissions = new Set(['system:global:read']);

      await cache.set(userId, undefined, permissions);
      const result = await cache.get(userId, undefined);

      expect(result).toBeDefined();
      expect(result?.has('system:global:read')).toBe(true);
    });

    it('deve isolar cache por tenant', async () => {
      const userId = 'user-123';
      const permsTenantA = new Set(['perm:a']);
      const permsTenantB = new Set(['perm:b']);

      await cache.set(userId, 'tenant-A', permsTenantA);
      await cache.set(userId, 'tenant-B', permsTenantB);

      const resultA = await cache.get(userId, 'tenant-A');
      const resultB = await cache.get(userId, 'tenant-B');
      
      expect(resultA?.has('perm:a')).toBe(true);
      expect(resultA?.has('perm:b')).toBe(false);
      expect(resultB?.has('perm:b')).toBe(true);
      expect(resultB?.has('perm:a')).toBe(false);
    });

    it('deve isolar cache por usuário', async () => {
      const tenantId = 'tenant-456';
      const permsUserA = new Set(['perm:a']);
      const permsUserB = new Set(['perm:b']);

      await cache.set('user-A', tenantId, permsUserA);
      await cache.set('user-B', tenantId, permsUserB);

      const resultA = await cache.get('user-A', tenantId);
      const resultB = await cache.get('user-B', tenantId);
      
      expect(resultA?.has('perm:a')).toBe(true);
      expect(resultB?.has('perm:b')).toBe(true);
    });
  });

  describe('Invalidação', () => {
    it('deve invalidar cache de usuário específico', async () => {
      const userId = 'user-123';
      const tenantId = 'tenant-456';

      await cache.set(userId, tenantId, new Set(['perm:a', 'perm:b']));
      await cache.set('other-user', tenantId, new Set(['perm:a']));

      await cache.invalidate(userId, tenantId);

      expect(await cache.get(userId, tenantId)).toBeUndefined();
      expect(await cache.get('other-user', tenantId)).toBeDefined();
    });

    it('deve invalidar todo o cache de um tenant', async () => {
      const tenantId = 'tenant-456';

      await cache.set('user-A', tenantId, new Set(['perm:a']));
      await cache.set('user-B', tenantId, new Set(['perm:b']));
      await cache.set('user-C', 'other-tenant', new Set(['perm:c']));

      await cache.invalidateTenant(tenantId);

      expect(await cache.get('user-A', tenantId)).toBeUndefined();
      expect(await cache.get('user-B', tenantId)).toBeUndefined();
      expect(await cache.get('user-C', 'other-tenant')).toBeDefined();
    });

    it('deve limpar todo o cache', async () => {
      await cache.set('user-A', 'tenant-1', new Set(['perm:a']));
      await cache.set('user-B', 'tenant-2', new Set(['perm:b']));
      await cache.set('user-C', 'tenant-3', new Set(['perm:c']));

      await cache.clear();

      expect(await cache.get('user-A', 'tenant-1')).toBeUndefined();
      expect(await cache.get('user-B', 'tenant-2')).toBeUndefined();
      expect(await cache.get('user-C', 'tenant-3')).toBeUndefined();
    });
  });

  describe('Estatísticas', () => {
    it('deve retornar estatísticas do cache', () => {
      const stats = cache.getStats();

      expect(stats).toHaveProperty('initialized');
      expect(stats).toHaveProperty('ttlMs');
      expect(stats).toHaveProperty('distributed');
      expect(stats.ttlMs).toBe(60000);
    });

    it('deve indicar cache inicializado', () => {
      const stats = cache.getStats();
      expect(stats.initialized).toBe(true);
    });
  });
});

describe('RBAC Cache - Estatísticas Globais', () => {
  beforeEach(async () => {
    resetRbacCacheStats();
    await clearPermissionCache();
  });

  afterEach(async () => {
    resetRbacCacheStats();
    await clearPermissionCache();
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
  beforeEach(async () => {
    resetRbacCacheStats();
    await clearPermissionCache();
    await permissionCache.initialize();
  });

  afterEach(async () => {
    resetRbacCacheStats();
    await clearPermissionCache();
  });

  describe('invalidateUserPermissions', () => {
    it('deve invalidar cache de usuário via função exportada', async () => {
      await permissionCache.set('user-test', 'tenant-test', new Set(['perm:test']));
      expect(await permissionCache.get('user-test', 'tenant-test')).toBeDefined();

      await invalidateUserPermissions('user-test', 'tenant-test');

      expect(await permissionCache.get('user-test', 'tenant-test')).toBeUndefined();
    });

    it('deve incrementar contador de invalidações', async () => {
      const statsBefore = getRbacCacheStats();
      
      await invalidateUserPermissions('user-123', 'tenant-456');
      
      const statsAfter = getRbacCacheStats();
      expect(statsAfter.invalidations).toBeGreaterThan(statsBefore.invalidations);
    });
  });

  describe('invalidateTenantPermissions', () => {
    it('deve invalidar cache de todo o tenant via função exportada', async () => {
      await permissionCache.set('user-A', 'tenant-X', new Set(['perm:a']));
      await permissionCache.set('user-B', 'tenant-X', new Set(['perm:b']));

      await invalidateTenantPermissions('tenant-X');

      expect(await permissionCache.get('user-A', 'tenant-X')).toBeUndefined();
      expect(await permissionCache.get('user-B', 'tenant-X')).toBeUndefined();
    });

    it('deve incrementar contador de invalidações', async () => {
      const statsBefore = getRbacCacheStats();
      
      await invalidateTenantPermissions('tenant-ABC');
      
      const statsAfter = getRbacCacheStats();
      expect(statsAfter.invalidations).toBeGreaterThan(statsBefore.invalidations);
    });
  });

  describe('clearPermissionCache', () => {
    it('deve limpar todo o cache via função exportada', async () => {
      await permissionCache.set('user-1', 'tenant-1', new Set(['perm:1']));
      await permissionCache.set('user-2', 'tenant-2', new Set(['perm:2']));

      await clearPermissionCache();

      expect(await permissionCache.get('user-1', 'tenant-1')).toBeUndefined();
      expect(await permissionCache.get('user-2', 'tenant-2')).toBeUndefined();
    });

    it('deve incrementar contador de invalidações', async () => {
      const statsBefore = getRbacCacheStats();
      
      await clearPermissionCache();
      
      const statsAfter = getRbacCacheStats();
      expect(statsAfter.invalidations).toBeGreaterThan(statsBefore.invalidations);
    });
  });
});

describe('RBAC Cache - checkPermissionDirect (síncrono)', () => {
  const mockAuthContext: AuthContext = {
    userId: 'user-cache-test',
    tenantId: 'tenant-cache-test',
    role: 'admin',
    email: 'test@example.com',
  };

  describe('Verificação de permissões direta (sem cache assíncrono)', () => {
    it('deve retornar resultado consistente', () => {
      const result1 = checkPermissionDirect(mockAuthContext, 'chat:conversations:read');
      const result2 = checkPermissionDirect(mockAuthContext, 'chat:conversations:read');
      
      expect(result1.allowed).toBe(result2.allowed);
    });

    it('deve respeitar permissões negadas', () => {
      const guestContext: AuthContext = {
        userId: 'user-guest',
        tenantId: 'tenant-guest',
        role: 'guest',
      };

      const result1 = checkPermissionDirect(guestContext, 'auth:users:read');
      const result2 = checkPermissionDirect(guestContext, 'auth:users:read');
      
      expect(result1.allowed).toBe(false);
      expect(result2.allowed).toBe(false);
    });

    it('deve retornar PermissionCheckResult com estrutura correta', () => {
      const result = checkPermissionDirect(mockAuthContext, 'chat:conversations:read');
      
      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('permission');
      expect(result).toHaveProperty('userRole');
      expect(result.permission).toBe('chat:conversations:read');
      expect(result.userRole).toBe('admin');
    });
  });
});

describe('RBAC Cache - Métricas Prometheus', () => {
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

    it('deve permitir registro de métricas sem erros', () => {
      const mockMetrics = {
        cacheHitsTotal: { inc: vi.fn() },
        cacheMissesTotal: { inc: vi.fn() },
        cacheInvalidationsTotal: { inc: vi.fn() },
        checkDuration: { observe: vi.fn() },
        cacheHitRate: { set: vi.fn() },
      };

      expect(() => initRbacPrometheusMetrics(mockMetrics)).not.toThrow();
      
      const result = checkPermissionDirect(
        { userId: 'user-test', tenantId: 'tenant-test', role: 'admin' },
        'chat:conversations:read'
      );
      
      expect(result.allowed).toBe(true);
    });
  });
});

describe('RBAC Cache - Cenários de Borda', () => {
  let cache: PermissionCache;

  beforeEach(async () => {
    cache = new PermissionCache({ ttlMs: 60000 });
    await cache.initialize();
  });

  afterEach(async () => {
    await cache.destroy();
  });

  describe('Valores especiais', () => {
    it('deve tratar userId vazio', async () => {
      await cache.set('', 'tenant-123', new Set(['perm:test']));
      expect(await cache.get('', 'tenant-123')).toBeDefined();
    });

    it('deve tratar Set de permissões vazio', async () => {
      await cache.set('user-123', 'tenant-123', new Set());
      const result = await cache.get('user-123', 'tenant-123');
      expect(result).toBeDefined();
      expect(result?.size).toBe(0);
    });

    it('deve tratar caracteres especiais em IDs', async () => {
      const userId = 'user:with:colons-and_underscores.and.dots';
      const tenantId = 'tenant/with/slashes';
      const permissions = new Set(['module:resource:action:extra']);

      await cache.set(userId, tenantId, permissions);
      expect(await cache.get(userId, tenantId)).toBeDefined();
    });
  });

  describe('Performance e escalabilidade', () => {
    it('deve suportar múltiplas entradas', async () => {
      const numEntries = 100;
      
      for (let i = 0; i < numEntries; i++) {
        await cache.set(`user-${i}`, `tenant-${i % 10}`, new Set([`perm:${i % 5}`]));
      }

      for (let i = 0; i < numEntries; i++) {
        const result = await cache.get(`user-${i}`, `tenant-${i % 10}`);
        expect(result).toBeDefined();
        expect(result?.has(`perm:${i % 5}`)).toBe(true);
      }
    });

    it('deve invalidar tenant com muitas entradas eficientemente', async () => {
      const targetTenant = 'tenant-target';
      
      for (let i = 0; i < 50; i++) {
        await cache.set(`user-${i}`, targetTenant, new Set([`perm:${i}`]));
      }
      for (let i = 0; i < 50; i++) {
        await cache.set(`user-other-${i}`, 'other-tenant', new Set([`perm:${i}`]));
      }

      await cache.invalidateTenant(targetTenant);

      expect(await cache.get('user-0', targetTenant)).toBeUndefined();
      expect(await cache.get('user-other-0', 'other-tenant')).toBeDefined();
    });
  });
});
