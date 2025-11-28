/**
 * Utilitários Compartilhados - Alice Enterprise Platform
 * 
 * Módulo principal que exporta todos os utilitários.
 * Documentação em PT-BR (Regra 10 replit.md).
 * 
 * @module @alice/shared-utils
 */

export * from './logger.js';
export * from './circuit-breaker.js';
export * from './config.js';
export * from './audit.js';
export * from './metrics.js';
export * from './health.js';

export * as rbac from './rbac/index.js';
export { 
  requireAuth, 
  requirePermission, 
  requireRole, 
  requireSameTenant,
  extractAuthContext,
  checkPermission,
  generateInternalAuthHeaders,
  isInternalAuthEnabled,
} from './rbac/middleware.js';
export type { InternalAuthHeaders } from './rbac/middleware.js';
export { 
  hasPermission, 
  hasMinimumRole, 
  getRolePermissions, 
  getPermissionRoles,
  PERMISSION_MAP,
} from './rbac/permissions.js';
export type { 
  Role, 
  PermissionCode, 
  AuthContext,
} from './rbac/types.js';
export { 
  ROLE_HIERARCHY,
  ROLE_DESCRIPTIONS,
} from './rbac/types.js';
export { permissionCache, PermissionCache } from './rbac/cache.js';
