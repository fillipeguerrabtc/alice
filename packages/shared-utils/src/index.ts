/**
 * Utilitários Compartilhados - Alice Enterprise Platform
 * 
 * Módulo principal que exporta todos os utilitários.
 * Documentação em PT-BR (Regra 10 CLAUDE.md).
 * 
 * @module @alice/shared-utils
 */

// IMPORTANTE: Importação side-effect para aplicar declarações globais do Express
// Extensões: Express.User extends AuthContext, Express.Request tem tenantId
import './rbac/types.js';

export * from './logger.js';
export * from './circuit-breaker.js';
export * from './audit.js';
export * from './observability/index.js';
export * from './platform/index.js';
export * from './agentic/index.js';
export * from './runtime/index.js';
export * from './training/index.js';
export * from './llm/index.js';
export * from './trading/index.js';
export * from './dashboard/recent-activity.js';

export * as rbac from './rbac/index.js';
export { 
  requireAuth, 
  requirePermission, 
  requireRole, 
  requireSameTenant,
  requireInternalHmacAuth,
  extractAuthContext,
  checkPermission,
  checkPermissionDirect,
  generateInternalAuthHeaders,
  isInternalAuthEnabled,
  initRbacPrometheusMetrics,
  getRbacCacheStats,
  resetRbacCacheStats,
  invalidateUserPermissions,
  invalidateTenantPermissions,
  clearPermissionCache,
  setPermissionResolver,
} from './rbac/middleware.js';
export type { InternalAuthHeaders, RbacPrometheusMetrics } from './rbac/middleware.js';
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
