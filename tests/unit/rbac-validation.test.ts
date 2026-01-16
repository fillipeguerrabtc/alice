/**
 * Testes de Validação RBAC - Alice Enterprise Platform
 * Fase 1 Passo 1.5 - Sistema de Controle de Acesso Baseado em Roles
 * 
 * Valida:
 * - Hierarquia de 6 níveis (super_admin → guest)
 * - Matriz de permissões (279 permissões mapeadas)
 * - Funções de autorização
 * - Middleware RBAC
 * - Cache de permissões
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import {
  Role,
  ROLE_HIERARCHY,
  ROLE_DESCRIPTIONS,
  Module,
  Action,
  Resource,
  AuthContext,
  PermissionCheckResult,
  AuthorizationOptions,
} from '../../packages/shared-utils/src/rbac/types';
import {
  PERMISSION_MAP,
  hasPermission,
  hasMinimumRole,
  getRolePermissions,
  getPermissionRoles,
} from '../../packages/shared-utils/src/rbac/permissions';
import {
  extractAuthContext,
  requireAuth,
  requirePermission,
  requireRole,
  requireSameTenant,
  checkPermission,
  checkPermissionDirect,
} from '../../packages/shared-utils/src/rbac/middleware';
import {
  PermissionCache,
  permissionCache,
} from '../../packages/shared-utils/src/rbac/cache';

const FIXED_TIMESTAMP = '2024-01-01T00:00:00.000Z';

const ALL_ROLES: Role[] = ['super_admin', 'admin', 'manager', 'operator', 'viewer', 'guest'];

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    path: '/test',
    method: 'GET',
    ip: '127.0.0.1',
    headers: {},
    user: undefined,
    tenantId: undefined,
    ...overrides,
  } as unknown as Request;
}

function createMockResponse(): Response & { statusCode: number; jsonData: unknown } {
  const res = {
    statusCode: 200,
    jsonData: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: unknown) {
      this.jsonData = data;
      return this;
    },
  };
  return res as Response & { statusCode: number; jsonData: unknown };
}

describe('RBAC - Hierarquia de Roles (6 níveis)', () => {
  describe('ROLE_HIERARCHY', () => {
    it('deve ter exatamente 6 roles definidos', () => {
      expect(Object.keys(ROLE_HIERARCHY)).toHaveLength(6);
    });

    it('deve ter super_admin como role mais privilegiado (nível 1)', () => {
      expect(ROLE_HIERARCHY.super_admin).toBe(1);
    });

    it('deve ter guest como role menos privilegiado (nível 6)', () => {
      expect(ROLE_HIERARCHY.guest).toBe(6);
    });

    it('deve manter ordem hierárquica correta', () => {
      expect(ROLE_HIERARCHY.super_admin).toBeLessThan(ROLE_HIERARCHY.admin);
      expect(ROLE_HIERARCHY.admin).toBeLessThan(ROLE_HIERARCHY.manager);
      expect(ROLE_HIERARCHY.manager).toBeLessThan(ROLE_HIERARCHY.operator);
      expect(ROLE_HIERARCHY.operator).toBeLessThan(ROLE_HIERARCHY.viewer);
      expect(ROLE_HIERARCHY.viewer).toBeLessThan(ROLE_HIERARCHY.guest);
    });

    it('deve ter níveis sequenciais (1 a 6)', () => {
      const levels = Object.values(ROLE_HIERARCHY).sort((a, b) => a - b);
      expect(levels).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('deve ter todas as roles esperadas', () => {
      ALL_ROLES.forEach((role) => {
        expect(ROLE_HIERARCHY[role]).toBeDefined();
      });
    });
  });

  describe('ROLE_DESCRIPTIONS', () => {
    it('deve ter descrição para cada role', () => {
      ALL_ROLES.forEach((role) => {
        expect(ROLE_DESCRIPTIONS[role]).toBeDefined();
        expect(typeof ROLE_DESCRIPTIONS[role]).toBe('string');
        expect(ROLE_DESCRIPTIONS[role].length).toBeGreaterThan(0);
      });
    });

    it('deve ter descrições em português', () => {
      expect(ROLE_DESCRIPTIONS.super_admin).toContain('Super Administrador');
      expect(ROLE_DESCRIPTIONS.admin).toContain('Administrador');
      expect(ROLE_DESCRIPTIONS.manager).toContain('Gerente');
      expect(ROLE_DESCRIPTIONS.operator).toContain('Operador');
      expect(ROLE_DESCRIPTIONS.viewer).toContain('Visualizador');
      expect(ROLE_DESCRIPTIONS.guest).toContain('Convidado');
    });
  });
});

describe('RBAC - Funções de Verificação de Hierarquia', () => {
  describe('hasMinimumRole', () => {
    it('super_admin deve ter nível mínimo para qualquer role', () => {
      ALL_ROLES.forEach((role) => {
        expect(hasMinimumRole('super_admin', role)).toBe(true);
      });
    });

    it('guest deve ter nível mínimo apenas para guest', () => {
      expect(hasMinimumRole('guest', 'guest')).toBe(true);
      expect(hasMinimumRole('guest', 'viewer')).toBe(false);
      expect(hasMinimumRole('guest', 'operator')).toBe(false);
      expect(hasMinimumRole('guest', 'manager')).toBe(false);
      expect(hasMinimumRole('guest', 'admin')).toBe(false);
      expect(hasMinimumRole('guest', 'super_admin')).toBe(false);
    });

    it('admin deve ter nível mínimo para admin e inferiores', () => {
      expect(hasMinimumRole('admin', 'super_admin')).toBe(false);
      expect(hasMinimumRole('admin', 'admin')).toBe(true);
      expect(hasMinimumRole('admin', 'manager')).toBe(true);
      expect(hasMinimumRole('admin', 'operator')).toBe(true);
      expect(hasMinimumRole('admin', 'viewer')).toBe(true);
      expect(hasMinimumRole('admin', 'guest')).toBe(true);
    });

    it('manager deve ter nível mínimo para manager e inferiores', () => {
      expect(hasMinimumRole('manager', 'super_admin')).toBe(false);
      expect(hasMinimumRole('manager', 'admin')).toBe(false);
      expect(hasMinimumRole('manager', 'manager')).toBe(true);
      expect(hasMinimumRole('manager', 'operator')).toBe(true);
      expect(hasMinimumRole('manager', 'viewer')).toBe(true);
      expect(hasMinimumRole('manager', 'guest')).toBe(true);
    });

    it('operator deve ter nível mínimo para operator e inferiores', () => {
      expect(hasMinimumRole('operator', 'super_admin')).toBe(false);
      expect(hasMinimumRole('operator', 'admin')).toBe(false);
      expect(hasMinimumRole('operator', 'manager')).toBe(false);
      expect(hasMinimumRole('operator', 'operator')).toBe(true);
      expect(hasMinimumRole('operator', 'viewer')).toBe(true);
      expect(hasMinimumRole('operator', 'guest')).toBe(true);
    });

    it('viewer deve ter nível mínimo para viewer e inferiores', () => {
      expect(hasMinimumRole('viewer', 'super_admin')).toBe(false);
      expect(hasMinimumRole('viewer', 'admin')).toBe(false);
      expect(hasMinimumRole('viewer', 'manager')).toBe(false);
      expect(hasMinimumRole('viewer', 'operator')).toBe(false);
      expect(hasMinimumRole('viewer', 'viewer')).toBe(true);
      expect(hasMinimumRole('viewer', 'guest')).toBe(true);
    });
  });
});

describe('RBAC - Matriz de Permissões (PERMISSION_MAP)', () => {
  describe('Estrutura do mapa', () => {
    it('deve ter permissões definidas', () => {
      expect(Object.keys(PERMISSION_MAP).length).toBeGreaterThan(0);
    });

    it('todas as permissões devem ter formato module:resource:action', () => {
      Object.keys(PERMISSION_MAP).forEach((permission) => {
        const parts = permission.split(':');
        expect(parts.length).toBeGreaterThanOrEqual(3);
      });
    });

    it('todas as permissões devem ter pelo menos uma role', () => {
      Object.entries(PERMISSION_MAP).forEach(([permission, roles]) => {
        expect(roles.length).toBeGreaterThan(0);
      });
    });

    it('todas as roles nas permissões devem ser válidas', () => {
      Object.values(PERMISSION_MAP).forEach((roles) => {
        roles.forEach((role) => {
          expect(ALL_ROLES).toContain(role);
        });
      });
    });
  });

  describe('Módulo AUTH', () => {
    it('auth:users:read deve ser acessível por super_admin e admin', () => {
      expect(PERMISSION_MAP['auth:users:read']).toContain('super_admin');
      expect(PERMISSION_MAP['auth:users:read']).toContain('admin');
      expect(PERMISSION_MAP['auth:users:read']).not.toContain('guest');
    });

    it('auth:tenants:* deve ser exclusivo de super_admin', () => {
      expect(PERMISSION_MAP['auth:tenants:read']).toEqual(['super_admin']);
      expect(PERMISSION_MAP['auth:tenants:write']).toEqual(['super_admin']);
      expect(PERMISSION_MAP['auth:tenants:delete']).toEqual(['super_admin']);
      expect(PERMISSION_MAP['auth:tenants:manage']).toEqual(['super_admin']);
    });

    it('auth:roles:* deve ser exclusivo de super_admin (exceto read)', () => {
      expect(PERMISSION_MAP['auth:roles:write']).toEqual(['super_admin']);
      expect(PERMISSION_MAP['auth:roles:delete']).toEqual(['super_admin']);
      expect(PERMISSION_MAP['auth:roles:manage']).toEqual(['super_admin']);
    });
  });

  describe('Módulo CHAT', () => {
    it('chat:conversations:read deve ser acessível por roles até viewer', () => {
      const allowed = PERMISSION_MAP['chat:conversations:read'];
      expect(allowed).toContain('super_admin');
      expect(allowed).toContain('admin');
      expect(allowed).toContain('manager');
      expect(allowed).toContain('operator');
      expect(allowed).toContain('viewer');
      expect(allowed).not.toContain('guest');
    });

    it('chat:conversations:delete deve ser restrito a manager+', () => {
      const allowed = PERMISSION_MAP['chat:conversations:delete'];
      expect(allowed).toContain('super_admin');
      expect(allowed).toContain('admin');
      expect(allowed).toContain('manager');
      expect(allowed).not.toContain('operator');
      expect(allowed).not.toContain('viewer');
      expect(allowed).not.toContain('guest');
    });

    it('chat:takeover:* deve existir para controle humano/IA', () => {
      expect(PERMISSION_MAP['chat:takeover:read']).toBeDefined();
      expect(PERMISSION_MAP['chat:takeover:write']).toBeDefined();
      expect(PERMISSION_MAP['chat:takeover:manage']).toBeDefined();
    });
  });

  describe('Módulo RAG', () => {
    it('rag:documents:upload deve permitir operator+', () => {
      const allowed = PERMISSION_MAP['rag:documents:upload'];
      expect(allowed).toContain('super_admin');
      expect(allowed).toContain('admin');
      expect(allowed).toContain('manager');
      expect(allowed).toContain('operator');
      expect(allowed).not.toContain('viewer');
      expect(allowed).not.toContain('guest');
    });

    it('rag:documents:delete deve ser restrito a manager+', () => {
      const allowed = PERMISSION_MAP['rag:documents:delete'];
      expect(allowed).toContain('super_admin');
      expect(allowed).toContain('admin');
      expect(allowed).toContain('manager');
      expect(allowed).not.toContain('operator');
    });
  });

  describe('Módulo TRAINING', () => {
    it('training:fine_tuning_jobs:start deve ser restrito a admin+', () => {
      const allowed = PERMISSION_MAP['training:fine_tuning_jobs:start'];
      expect(allowed).toContain('super_admin');
      expect(allowed).toContain('admin');
      expect(allowed).not.toContain('manager');
      expect(allowed).not.toContain('operator');
    });

    it('training:fine_tuning_jobs:cancel deve ser restrito a admin+', () => {
      const allowed = PERMISSION_MAP['training:fine_tuning_jobs:cancel'];
      expect(allowed).toContain('super_admin');
      expect(allowed).toContain('admin');
      expect(allowed).not.toContain('manager');
    });
  });

  describe('Módulo INTEGRATIONS', () => {
    it('integrations:stripe:* deve ser restrito a admin+', () => {
      expect(PERMISSION_MAP['integrations:stripe:read']).toContain('super_admin');
      expect(PERMISSION_MAP['integrations:stripe:read']).toContain('admin');
      expect(PERMISSION_MAP['integrations:stripe:read']).not.toContain('manager');
    });

    it('integrations:wise_sync:* deve existir para reconciliação', () => {
      expect(PERMISSION_MAP['integrations:wise_sync:read']).toBeDefined();
      expect(PERMISSION_MAP['integrations:wise_sync:reconcile']).toBeDefined();
    });

    it('integrations:erpnext:read deve permitir operator+', () => {
      const allowed = PERMISSION_MAP['integrations:erpnext:read'];
      expect(allowed).toContain('operator');
      expect(allowed).toContain('manager');
      expect(allowed).toContain('admin');
      expect(allowed).toContain('super_admin');
    });
  });

  describe('Módulo ADMIN', () => {
    it('admin:tenants:* deve ser exclusivo de super_admin', () => {
      expect(PERMISSION_MAP['admin:tenants:read']).toEqual(['super_admin']);
      expect(PERMISSION_MAP['admin:tenants:write']).toEqual(['super_admin']);
      expect(PERMISSION_MAP['admin:tenants:delete']).toEqual(['super_admin']);
    });

    it('admin:users:delete deve ser exclusivo de super_admin', () => {
      expect(PERMISSION_MAP['admin:users:delete']).toEqual(['super_admin']);
    });
  });

  // ARQUITETURA 16/01/2026: Alice analisa e gera imagens via OpenAI
  describe('Módulo IMAGES (OpenAI Vision)', () => {
    it('images:generate:* deve existir para upload/aprovação de imagens', () => {
      expect(PERMISSION_MAP['images:generate:read']).toBeDefined();
      expect(PERMISSION_MAP['images:generate:write']).toBeDefined();
    });

    it('images:training:* deve ser restrito a admin+', () => {
      expect(PERMISSION_MAP['images:training:read']).toContain('super_admin');
      expect(PERMISSION_MAP['images:training:read']).toContain('admin');
      expect(PERMISSION_MAP['images:training:read']).not.toContain('manager');
    });
  });
});

describe('RBAC - Funções de Verificação de Permissões', () => {
  describe('hasPermission', () => {
    it('super_admin deve ter todas as permissões mapeadas', () => {
      Object.keys(PERMISSION_MAP).forEach((permission) => {
        if (PERMISSION_MAP[permission].includes('super_admin')) {
          expect(hasPermission('super_admin', permission)).toBe(true);
        }
      });
    });

    it('guest não deve ter permissões críticas', () => {
      expect(hasPermission('guest', 'auth:users:read')).toBe(false);
      expect(hasPermission('guest', 'admin:tenants:read')).toBe(false);
      expect(hasPermission('guest', 'chat:conversations:delete')).toBe(false);
      expect(hasPermission('guest', 'training:fine_tuning_jobs:start')).toBe(false);
    });

    it('deve retornar false para permissões inexistentes', () => {
      expect(hasPermission('super_admin', 'nonexistent:resource:action')).toBe(false);
      expect(hasPermission('admin', 'invalid:permission')).toBe(false);
    });

    it('viewer deve ter apenas permissões de leitura', () => {
      expect(hasPermission('viewer', 'chat:conversations:read')).toBe(true);
      expect(hasPermission('viewer', 'chat:conversations:write')).toBe(false);
      expect(hasPermission('viewer', 'rag:documents:read')).toBe(true);
      expect(hasPermission('viewer', 'rag:documents:upload')).toBe(false);
    });

    it('operator deve ter permissões de operação básica', () => {
      expect(hasPermission('operator', 'chat:conversations:write')).toBe(true);
      expect(hasPermission('operator', 'rag:documents:upload')).toBe(true);
      expect(hasPermission('operator', 'chat:conversations:delete')).toBe(false);
    });
  });

  describe('getRolePermissions', () => {
    it('super_admin deve ter mais permissões que qualquer outro role', () => {
      const superAdminPerms = getRolePermissions('super_admin');
      const adminPerms = getRolePermissions('admin');
      expect(superAdminPerms.length).toBeGreaterThan(adminPerms.length);
    });

    it('guest deve ter zero permissões mapeadas', () => {
      const guestPerms = getRolePermissions('guest');
      expect(guestPerms.length).toBe(0);
    });

    it('cada role deve ter permissões progressivamente menores', () => {
      const superAdminPerms = getRolePermissions('super_admin');
      const adminPerms = getRolePermissions('admin');
      const managerPerms = getRolePermissions('manager');
      const operatorPerms = getRolePermissions('operator');
      const viewerPerms = getRolePermissions('viewer');
      const guestPerms = getRolePermissions('guest');

      expect(superAdminPerms.length).toBeGreaterThanOrEqual(adminPerms.length);
      expect(adminPerms.length).toBeGreaterThanOrEqual(managerPerms.length);
      expect(managerPerms.length).toBeGreaterThanOrEqual(operatorPerms.length);
      expect(operatorPerms.length).toBeGreaterThanOrEqual(viewerPerms.length);
      expect(viewerPerms.length).toBeGreaterThanOrEqual(guestPerms.length);
    });
  });

  describe('getPermissionRoles', () => {
    it('deve retornar roles corretas para auth:tenants:read', () => {
      const roles = getPermissionRoles('auth:tenants:read');
      expect(roles).toEqual(['super_admin']);
    });

    it('deve retornar array vazio para permissão inexistente', () => {
      const roles = getPermissionRoles('nonexistent:permission:code');
      expect(roles).toEqual([]);
    });

    it('deve retornar múltiplas roles para permissões amplas', () => {
      const roles = getPermissionRoles('chat:conversations:read');
      expect(roles.length).toBeGreaterThan(1);
      expect(roles).toContain('super_admin');
      expect(roles).toContain('viewer');
    });
  });
});

describe('RBAC - Middleware de Autorização', () => {
  describe('extractAuthContext', () => {
    it('deve extrair contexto de req.user', () => {
      const authContext: AuthContext = {
        userId: 'user-123',
        tenantId: 'tenant-456',
        role: 'admin',
        email: 'test@example.com',
      };
      const req = createMockRequest({ user: authContext });
      
      const result = extractAuthContext(req);
      expect(result).toEqual(authContext);
    });

    it('deve rejeitar headers não assinados por segurança (OWASP 2025)', () => {
      const req = createMockRequest({
        headers: {
          'x-user-id': 'user-789',
          'x-tenant-id': 'tenant-101',
          'x-user-role': 'manager',
        },
      });
      
      const result = extractAuthContext(req);
      expect(result).toBeUndefined();
    });

    it('deve retornar undefined quando não há contexto', () => {
      const req = createMockRequest();
      const result = extractAuthContext(req);
      expect(result).toBeUndefined();
    });

    it('deve retornar undefined quando headers internos estão incompletos', () => {
      const req = createMockRequest({
        headers: {
          'x-internal-user-id': 'user-123',
        },
      });
      const result = extractAuthContext(req);
      expect(result).toBeUndefined();
    });
  });

  describe('requireAuth', () => {
    it('deve permitir acesso quando autenticado', () => {
      const req = createMockRequest({
        user: { userId: 'user-123', role: 'admin' as Role },
      });
      const res = createMockResponse();
      const next = vi.fn();

      requireAuth()(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    });

    it('deve negar acesso quando não autenticado', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = vi.fn();

      requireAuth()(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      expect(res.jsonData).toHaveProperty('code', 'UNAUTHORIZED');
    });

    it('deve permitir acesso anônimo quando configurado', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const next = vi.fn();

      requireAuth({ allowAnonymous: true })(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('requirePermission', () => {
    it('deve permitir acesso quando tem permissão', async () => {
      const req = createMockRequest({
        user: { userId: 'user-123', role: 'admin' as Role, tenantId: 'tenant-1' },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await requirePermission('auth:users:read')(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    });

    it('deve negar acesso quando não tem permissão', async () => {
      const req = createMockRequest({
        user: { userId: 'user-123', role: 'guest' as Role, tenantId: 'tenant-1' },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await requirePermission('auth:users:read')(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(res.jsonData).toHaveProperty('code', 'FORBIDDEN');
    });

    it('deve permitir bypass para roles específicos', async () => {
      const req = createMockRequest({
        user: { userId: 'user-123', role: 'super_admin' as Role, tenantId: 'tenant-1' },
      });
      const res = createMockResponse();
      const next = vi.fn();

      await requirePermission('nonexistent:permission', { 
        bypassRoles: ['super_admin'] 
      })(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('deve executar verificação customizada', async () => {
      const req = createMockRequest({
        user: { userId: 'user-123', role: 'guest' as Role, tenantId: 'tenant-1' },
      });
      const res = createMockResponse();
      const next = vi.fn();
      const customCheck = vi.fn().mockResolvedValue(true);

      await requirePermission('auth:users:read', { customCheck })(req, res, next);

      expect(customCheck).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });

  describe('requireRole', () => {
    it('deve permitir acesso quando role é suficiente', () => {
      const req = createMockRequest({
        user: { userId: 'user-123', role: 'admin' as Role, tenantId: 'tenant-1' },
      });
      const res = createMockResponse();
      const next = vi.fn();

      requireRole('manager')(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('deve negar acesso quando role é insuficiente', () => {
      const req = createMockRequest({
        user: { userId: 'user-123', role: 'viewer' as Role, tenantId: 'tenant-1' },
      });
      const res = createMockResponse();
      const next = vi.fn();

      requireRole('manager')(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(res.jsonData).toHaveProperty('requiredRole', 'manager');
    });

    it('deve permitir role igual ao mínimo requerido', () => {
      const req = createMockRequest({
        user: { userId: 'user-123', role: 'operator' as Role, tenantId: 'tenant-1' },
      });
      const res = createMockResponse();
      const next = vi.fn();

      requireRole('operator')(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('requireSameTenant', () => {
    it('super_admin deve acessar qualquer tenant', () => {
      const req = createMockRequest({
        user: { userId: 'user-123', role: 'super_admin' as Role, tenantId: 'tenant-1' },
        params: { tenantId: 'tenant-999' },
      });
      const res = createMockResponse();
      const next = vi.fn();

      requireSameTenant((req) => (req as unknown as { params: { tenantId: string } }).params.tenantId)(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('deve negar acesso a tenant diferente para non-super_admin', () => {
      const req = createMockRequest({
        user: { userId: 'user-123', role: 'admin' as Role, tenantId: 'tenant-1' },
        params: { tenantId: 'tenant-999' },
      });
      const res = createMockResponse();
      const next = vi.fn();

      requireSameTenant((req) => (req as unknown as { params: { tenantId: string } }).params.tenantId)(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(res.jsonData).toHaveProperty('code', 'TENANT_MISMATCH');
    });

    it('deve permitir acesso ao próprio tenant', () => {
      const req = createMockRequest({
        user: { userId: 'user-123', role: 'admin' as Role, tenantId: 'tenant-1' },
        params: { tenantId: 'tenant-1' },
      });
      const res = createMockResponse();
      const next = vi.fn();

      requireSameTenant((req) => (req as unknown as { params: { tenantId: string } }).params.tenantId)(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('checkPermission', () => {
    it('deve retornar allowed=true quando tem permissão', () => {
      const auth: AuthContext = {
        userId: 'user-123',
        role: 'admin',
      };

      const result = checkPermissionDirect(auth, 'auth:users:read');

      expect(result.allowed).toBe(true);
      expect(result.permission).toBe('auth:users:read');
      expect(result.userRole).toBe('admin');
      expect(result.reason).toBeUndefined();
    });

    it('deve retornar allowed=false com reason quando não tem permissão', () => {
      const auth: AuthContext = {
        userId: 'user-123',
        role: 'guest',
      };

      const result = checkPermissionDirect(auth, 'auth:users:read');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain('guest');
    });
  });
});

describe('RBAC - Cache de Permissões', () => {
  let cache: PermissionCache;

  beforeEach(async () => {
    cache = new PermissionCache({ ttlMs: 1000 });
    await cache.initialize();
  });

  afterEach(async () => {
    await cache.destroy();
  });

  describe('Operações básicas', () => {
    it('deve armazenar e recuperar permissões', async () => {
      const permissions = new Set(['perm1', 'perm2']);
      await cache.set('user-1', 'tenant-1', permissions);

      const result = await cache.get('user-1', 'tenant-1');
      expect(result).toEqual(permissions);
    });

    it('deve retornar undefined para usuário não encontrado', async () => {
      const result = await cache.get('nonexistent', 'tenant-1');
      expect(result).toBeUndefined();
    });

    it('deve invalidar cache de usuário específico', async () => {
      const permissions = new Set(['perm1']);
      await cache.set('user-1', 'tenant-1', permissions);
      
      await cache.invalidate('user-1', 'tenant-1');
      
      const result = await cache.get('user-1', 'tenant-1');
      expect(result).toBeUndefined();
    });

    it('deve invalidar cache de tenant inteiro', async () => {
      await cache.set('user-1', 'tenant-1', new Set(['perm1']));
      await cache.set('user-2', 'tenant-1', new Set(['perm2']));
      await cache.set('user-3', 'tenant-2', new Set(['perm3']));

      await cache.invalidateTenant('tenant-1');

      expect(await cache.get('user-1', 'tenant-1')).toBeUndefined();
      expect(await cache.get('user-2', 'tenant-1')).toBeUndefined();
      expect(await cache.get('user-3', 'tenant-2')).toBeDefined();
    });

    it('deve limpar todo o cache', async () => {
      await cache.set('user-1', 'tenant-1', new Set(['perm1']));
      await cache.set('user-2', 'tenant-2', new Set(['perm2']));

      await cache.clear();

      expect(await cache.get('user-1', 'tenant-1')).toBeUndefined();
      expect(await cache.get('user-2', 'tenant-2')).toBeUndefined();
    });
  });

  describe('TTL e expiração', () => {
    it('deve expirar entradas após TTL', async () => {
      const shortCache = new PermissionCache({ ttlMs: 50 });
      await shortCache.initialize();
      await shortCache.set('user-1', 'tenant-1', new Set(['perm1']));

      await new Promise(resolve => setTimeout(resolve, 100));

      const result = await shortCache.get('user-1', 'tenant-1');
      expect(result).toBeUndefined();

      await shortCache.destroy();
    });
  });

  describe('Estatísticas', () => {
    it('deve retornar estatísticas corretas', async () => {
      await cache.set('user-1', 'tenant-1', new Set(['perm1']));
      await cache.set('user-2', 'tenant-1', new Set(['perm2']));

      const stats = cache.getStats();

      expect(stats.initialized).toBe(true);
      expect(stats.ttlMs).toBe(1000);
    });
  });
});

describe('RBAC - Cenários de Acesso Enterprise', () => {
  describe('Isolamento Multi-tenant', () => {
    it('usuário deve acessar apenas recursos do próprio tenant', () => {
      const auth: AuthContext = {
        userId: 'user-123',
        tenantId: 'tenant-A',
        role: 'admin',
      };

      expect(checkPermissionDirect(auth, 'auth:users:read').allowed).toBe(true);
    });

    it('super_admin pode atuar em qualquer tenant', () => {
      const auth: AuthContext = {
        userId: 'super-user',
        tenantId: undefined,
        role: 'super_admin',
      };

      expect(checkPermissionDirect(auth, 'auth:tenants:manage').allowed).toBe(true);
      expect(checkPermissionDirect(auth, 'admin:tenants:delete').allowed).toBe(true);
    });
  });

  describe('Fluxo de Takeover/Handover', () => {
    it('operator deve poder executar takeover', () => {
      expect(hasPermission('operator', 'chat:takeover:write')).toBe(true);
    });

    it('viewer não deve poder executar takeover', () => {
      expect(hasPermission('viewer', 'chat:takeover:write')).toBe(false);
    });

    it('manager deve poder gerenciar escalações', () => {
      expect(hasPermission('manager', 'chat:escalation:manage')).toBe(true);
    });
  });

  describe('Fluxo de Fine-tuning', () => {
    it('apenas admin+ pode iniciar fine-tuning jobs', () => {
      expect(hasPermission('super_admin', 'training:fine_tuning_jobs:start')).toBe(true);
      expect(hasPermission('admin', 'training:fine_tuning_jobs:start')).toBe(true);
      expect(hasPermission('manager', 'training:fine_tuning_jobs:start')).toBe(false);
      expect(hasPermission('operator', 'training:fine_tuning_jobs:start')).toBe(false);
    });
  });

  describe('Fluxo de Integrações Financeiras', () => {
    it('Stripe deve ser acessível apenas para admin+', () => {
      expect(hasPermission('admin', 'integrations:stripe:sync')).toBe(true);
      expect(hasPermission('manager', 'integrations:stripe:sync')).toBe(false);
    });

    it('Wise sync deve ser restrito a admin+', () => {
      expect(hasPermission('admin', 'integrations:wise_sync:reconcile')).toBe(true);
      expect(hasPermission('manager', 'integrations:wise_sync:reconcile')).toBe(false);
    });
  });
});
