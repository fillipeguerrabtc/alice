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
export * from './config.js';
export * from './audit.js';
export * from './metrics.js';
export * from './health.js';
export * from './async-context.js';
export * from './tracing.js';
export * from './express-hardening.js';
export * from './feature-flags.js';
export * from './feature-flags-storage.js';
export * from './agentic-events.js';
export * from './agentic-actions.js';
export * from './prometheus.js';
export * from './shutdown-manager.js';
export * from './redis-cache-adapter.js';
export * from './redis-queue.js';
export * from './openapi.js';
export * from './multi-tenant-validation.js';
export * from './namespace-context-resolver.js';
export * from './route-context-config.js';
export * from './qdrant-client.js';
export * from './gpu-client.js';
export * from './training-dedup.js';
export * from './training-auto-collect.js';
export * from './session-auth.js';
export * from './llm-models.js';
export * from './llm-routing.js';
export * from './llm/llm-gateway-client.js';
export { TRADING_CHANNEL_PREFIX, TRADING_CHANNELS } from './trading-channels.js';
export * from './trading-queues.js';
export * from './training-queues.js';
export * from './training-config.js';
export * from './privacy.js';
export * from './trading-microstructure.js';
export * from './trading/llm-signal-schema.js';
export * from './immutable-audit-ledger.js';
export * from './runtime-announcements.js';

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

export type {
  AgentEvent,
  AgentEventPhase,
  AgentEventStatus,
  RedactionOptions,
} from './agentic-events.js';
export { redactSensitivePayload } from './agentic-events.js';
