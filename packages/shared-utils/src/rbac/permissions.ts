/**
 * Mapa de Permissões RBAC - Alice Enterprise Platform
 * 
 * Define quais roles têm acesso a quais recursos.
 * Documentação em PT-BR (Regra 10 CLAUDE.md).
 * 
 * @module @alice/shared-utils/rbac/permissions
 */

import { Role, ROLE_HIERARCHY } from './types.js';

/**
 * Mapa de permissões: código da permissão → roles permitidas
 * 
 * Formato: 'modulo:recurso:acao': [roles que podem executar]
 */
export const PERMISSION_MAP: Record<string, Role[]> = {
  // ============================================================================
  // AUTH MODULE - Autenticação e usuários
  // ============================================================================
  'auth:users:read': ['super_admin', 'admin'],
  'auth:users:write': ['super_admin', 'admin'],
  'auth:users:delete': ['super_admin'],
  'auth:users:manage': ['super_admin', 'admin'],
  
  'auth:roles:read': ['super_admin', 'admin'],
  'auth:roles:write': ['super_admin'],
  'auth:roles:delete': ['super_admin'],
  'auth:roles:manage': ['super_admin'],
  
  'auth:tenants:read': ['super_admin'],
  'auth:tenants:write': ['super_admin'],
  'auth:tenants:delete': ['super_admin'],
  'auth:tenants:manage': ['super_admin'],
  
  'auth:audit_logs:read': ['super_admin', 'admin'],
  'auth:audit_logs:write': ['super_admin'],
  'auth:audit_logs:delete': ['super_admin'],
  'auth:audit_logs:manage': ['super_admin'],
  
  // Alias para compatibilidade com endpoints que usam formato diferente
  // SEGURANÇA: Permissões DEVEM ser idênticas às originais (auth:audit_logs:*)
  'audit:logs:read': ['super_admin', 'admin'],
  'audit:logs:write': ['super_admin'],
  'audit:logs:delete': ['super_admin'],
  'audit:logs:manage': ['super_admin'],
  
  'auth:metrics:read': ['super_admin', 'admin', 'manager'],
  'auth:metrics:write': ['super_admin'],
  'auth:metrics:delete': ['super_admin'],
  'auth:metrics:manage': ['super_admin'],

  // ============================================================================
  // CHAT MODULE - Conversas e mensagens
  // ============================================================================
  'chat:conversations:read': ['super_admin', 'admin', 'manager', 'operator', 'viewer'],
  'chat:conversations:write': ['super_admin', 'admin', 'manager', 'operator'],
  'chat:conversations:delete': ['super_admin', 'admin', 'manager'],
  'chat:conversations:manage': ['super_admin', 'admin', 'manager'],
  
  'chat:messages:read': ['super_admin', 'admin', 'manager', 'operator', 'viewer'],
  'chat:messages:write': ['super_admin', 'admin', 'manager', 'operator'],
  'chat:messages:delete': ['super_admin', 'admin'],
  'chat:messages:manage': ['super_admin', 'admin'],
  
  // Stats e métricas do chat (dashboard)
  'chat:stats:read': ['super_admin', 'admin', 'manager'],
  'chat:stats:write': ['super_admin', 'admin'],
  'chat:stats:manage': ['super_admin', 'admin'],
  
  'chat:agents:read': ['super_admin', 'admin', 'manager', 'operator', 'viewer'],
  'chat:agents:write': ['super_admin', 'admin', 'manager'],
  'chat:agents:delete': ['super_admin', 'admin'],
  'chat:agents:manage': ['super_admin', 'admin', 'manager'],
  
  'chat:namespaces:read': ['super_admin', 'admin', 'manager', 'operator', 'viewer'],
  'chat:namespaces:write': ['super_admin', 'admin', 'manager'],
  'chat:namespaces:delete': ['super_admin', 'admin'],
  'chat:namespaces:manage': ['super_admin', 'admin', 'manager'],

  // ============================================================================
  // TAKEOVER/HANDOVER MODULE - Controle de conversas humano/IA (FASE 6.5)
  // ============================================================================
  'chat:takeover:read': ['super_admin', 'admin', 'manager', 'operator'],
  'chat:takeover:write': ['super_admin', 'admin', 'manager', 'operator'],
  'chat:takeover:manage': ['super_admin', 'admin', 'manager'],
  'chat:takeover:assign': ['super_admin', 'admin', 'manager'],
  
  'chat:handoff:read': ['super_admin', 'admin', 'manager', 'operator'],
  'chat:handoff:write': ['super_admin', 'admin', 'manager', 'operator'],
  'chat:handoff:manage': ['super_admin', 'admin', 'manager'],
  
  'chat:escalation:read': ['super_admin', 'admin', 'manager', 'operator'],
  'chat:escalation:write': ['super_admin', 'admin', 'manager'],
  'chat:escalation:manage': ['super_admin', 'admin', 'manager'],
  'chat:escalation:resolve': ['super_admin', 'admin', 'manager', 'operator'],
  
  'chat:participants:read': ['super_admin', 'admin', 'manager', 'operator'],
  'chat:participants:write': ['super_admin', 'admin', 'manager'],
  'chat:participants:manage': ['super_admin', 'admin', 'manager'],

  // ============================================================================
  // RAG MODULE - Documentos e busca
  // ============================================================================
  'rag:documents:read': ['super_admin', 'admin', 'manager', 'operator', 'viewer'],
  'rag:documents:write': ['super_admin', 'admin', 'manager', 'operator'],
  'rag:documents:delete': ['super_admin', 'admin', 'manager'],
  'rag:documents:manage': ['super_admin', 'admin', 'manager'],
  'rag:documents:upload': ['super_admin', 'admin', 'manager', 'operator'],
  
  'rag:namespaces:read': ['super_admin', 'admin', 'manager', 'operator', 'viewer'],
  'rag:namespaces:write': ['super_admin', 'admin', 'manager'],
  'rag:namespaces:delete': ['super_admin', 'admin'],
  'rag:namespaces:manage': ['super_admin', 'admin', 'manager'],

  // ============================================================================
  // TRAINING MODULE - Fine-tuning e dados de treino
  // ============================================================================
  'training:training_data:read': ['super_admin', 'admin', 'manager', 'operator'],
  'training:training_data:write': ['super_admin', 'admin', 'manager'],
  'training:training_data:delete': ['super_admin', 'admin'],
  'training:training_data:manage': ['super_admin', 'admin'],
  
  'training:fine_tuning_jobs:read': ['super_admin', 'admin', 'manager', 'operator'],
  'training:fine_tuning_jobs:write': ['super_admin', 'admin'],
  'training:fine_tuning_jobs:delete': ['super_admin', 'admin'],
  'training:fine_tuning_jobs:manage': ['super_admin', 'admin'],
  'training:fine_tuning_jobs:start': ['super_admin', 'admin'],
  'training:fine_tuning_jobs:cancel': ['super_admin', 'admin'],

  // ============================================================================
  // INTEGRATIONS MODULE - Serviços externos
  // ============================================================================
  'integrations:integrations:read': ['super_admin', 'admin', 'manager'],
  'integrations:integrations:write': ['super_admin', 'admin'],
  'integrations:integrations:delete': ['super_admin', 'admin'],
  'integrations:integrations:manage': ['super_admin', 'admin'],
  
  'integrations:stripe:read': ['super_admin', 'admin'],
  'integrations:stripe:write': ['super_admin', 'admin'],
  'integrations:stripe:delete': ['super_admin'],
  'integrations:stripe:manage': ['super_admin', 'admin'],
  'integrations:stripe:sync': ['super_admin', 'admin'],
  
  'integrations:wise:read': ['super_admin', 'admin'],
  'integrations:wise:write': ['super_admin', 'admin'],
  'integrations:wise:delete': ['super_admin'],
  'integrations:wise:manage': ['super_admin', 'admin'],
  'integrations:wise:sync': ['super_admin', 'admin'],
  
  'integrations:erpnext:read': ['super_admin', 'admin', 'manager', 'operator'],
  'integrations:erpnext:write': ['super_admin', 'admin', 'manager'],
  'integrations:erpnext:delete': ['super_admin', 'admin'],
  'integrations:erpnext:manage': ['super_admin', 'admin'],
  'integrations:erpnext:sync': ['super_admin', 'admin', 'manager'],
  
  'integrations:twilio:read': ['super_admin', 'admin', 'manager'],
  'integrations:twilio:write': ['super_admin', 'admin'],
  'integrations:twilio:delete': ['super_admin'],
  'integrations:twilio:manage': ['super_admin', 'admin'],
  
  // Email via Gmail SMTP (30/12/2025) - Substitui Resend
  'integrations:email:read': ['super_admin', 'admin', 'manager'],
  'integrations:email:write': ['super_admin', 'admin'],
  'integrations:email:delete': ['super_admin'],
  'integrations:email:manage': ['super_admin', 'admin'],
  
  // ============================================================================
  // TRADING MODULE - KuCoin Futures BTC Perpetuals (17/12/2025)
  // ============================================================================
  'integrations:trading:read': ['super_admin', 'admin', 'manager', 'operator'],
  'integrations:trading:write': ['super_admin', 'admin', 'manager'],
  'integrations:trading:delete': ['super_admin', 'admin'],
  'integrations:trading:manage': ['super_admin', 'admin'],

  // ============================================================================
  // IMAGE ANALYSIS MODULE - Qwen2.5-VL Vision (ARQUITETURA v4.0.0)
  // NOTA: Alice ANALISA imagens mas NÃO gera. Permissões para upload/aprovação de imagens.
  // ============================================================================
  'images:generate:read': ['super_admin', 'admin', 'manager', 'operator', 'viewer'],
  'images:generate:write': ['super_admin', 'admin', 'manager', 'operator'],
  'images:generate:delete': ['super_admin', 'admin', 'manager'],
  'images:generate:manage': ['super_admin', 'admin', 'manager'],
  
  'images:approve:read': ['super_admin', 'admin', 'manager'],
  'images:approve:write': ['super_admin', 'admin', 'manager'],
  'images:approve:manage': ['super_admin', 'admin'],
  
  'images:training:read': ['super_admin', 'admin'],
  'images:training:write': ['super_admin', 'admin'],
  'images:training:manage': ['super_admin', 'admin'],

  // ============================================================================
  // WISE-ERPNEXT SYNC MODULE (FASE 5.5)
  // ============================================================================
  'integrations:wise_sync:read': ['super_admin', 'admin'],
  'integrations:wise_sync:write': ['super_admin', 'admin'],
  'integrations:wise_sync:delete': ['super_admin'],
  'integrations:wise_sync:manage': ['super_admin', 'admin'],
  'integrations:wise_sync:retry': ['super_admin', 'admin'],
  'integrations:wise_sync:reconcile': ['super_admin', 'admin'],

  // ============================================================================
  // ADMIN MODULE - Administração do sistema
  // ============================================================================
  'admin:users:read': ['super_admin', 'admin'],
  'admin:users:write': ['super_admin', 'admin'],
  'admin:users:delete': ['super_admin'],
  'admin:users:manage': ['super_admin', 'admin'],
  
  'admin:tenants:read': ['super_admin'],
  'admin:tenants:write': ['super_admin'],
  'admin:tenants:delete': ['super_admin'],
  'admin:tenants:manage': ['super_admin'],
  
  'admin:roles:read': ['super_admin'],
  'admin:roles:write': ['super_admin'],
  'admin:roles:delete': ['super_admin'],
  'admin:roles:manage': ['super_admin'],
  
  'admin:audit_logs:read': ['super_admin', 'admin'],
  'admin:audit_logs:write': ['super_admin'],
  'admin:audit_logs:delete': ['super_admin'],
  'admin:audit_logs:manage': ['super_admin'],
  
  'admin:metrics:read': ['super_admin', 'admin'],
  'admin:metrics:write': ['super_admin'],
  'admin:metrics:delete': ['super_admin'],
  'admin:metrics:manage': ['super_admin'],
  
  'admin:namespaces:read': ['super_admin', 'admin', 'manager'],
  'admin:namespaces:write': ['super_admin', 'admin'],
  'admin:namespaces:delete': ['super_admin', 'admin'],
  'admin:namespaces:manage': ['super_admin', 'admin'],
  
  'admin:agents:read': ['super_admin', 'admin', 'manager'],
  'admin:agents:write': ['super_admin', 'admin'],
  'admin:agents:delete': ['super_admin', 'admin'],
  'admin:agents:manage': ['super_admin', 'admin'],
  
  'admin:integrations:read': ['super_admin', 'admin'],
  'admin:integrations:write': ['super_admin', 'admin'],
  'admin:integrations:delete': ['super_admin'],
  'admin:integrations:manage': ['super_admin', 'admin'],
  
  'admin:documents:read': ['super_admin', 'admin', 'manager'],
  'admin:documents:write': ['super_admin', 'admin'],
  'admin:documents:delete': ['super_admin', 'admin'],
  'admin:documents:manage': ['super_admin', 'admin'],
  'admin:documents:upload': ['super_admin', 'admin', 'manager'],
  
  'admin:training_data:read': ['super_admin', 'admin'],
  'admin:training_data:write': ['super_admin', 'admin'],
  'admin:training_data:delete': ['super_admin'],
  'admin:training_data:manage': ['super_admin', 'admin'],
  
  'admin:fine_tuning_jobs:read': ['super_admin', 'admin'],
  'admin:fine_tuning_jobs:write': ['super_admin', 'admin'],
  'admin:fine_tuning_jobs:delete': ['super_admin'],
  'admin:fine_tuning_jobs:manage': ['super_admin', 'admin'],
  'admin:fine_tuning_jobs:start': ['super_admin', 'admin'],
  'admin:fine_tuning_jobs:cancel': ['super_admin', 'admin'],
  
  'admin:conversations:read': ['super_admin', 'admin'],
  'admin:conversations:write': ['super_admin', 'admin'],
  'admin:conversations:delete': ['super_admin', 'admin'],
  'admin:conversations:manage': ['super_admin', 'admin'],
  
  'admin:messages:read': ['super_admin', 'admin'],
  'admin:messages:write': ['super_admin', 'admin'],
  'admin:messages:delete': ['super_admin', 'admin'],
  'admin:messages:manage': ['super_admin', 'admin'],
  
  'admin:stripe:read': ['super_admin', 'admin'],
  'admin:stripe:write': ['super_admin', 'admin'],
  'admin:stripe:delete': ['super_admin'],
  'admin:stripe:manage': ['super_admin', 'admin'],
  'admin:stripe:sync': ['super_admin', 'admin'],
  
  'admin:wise:read': ['super_admin', 'admin'],
  'admin:wise:write': ['super_admin', 'admin'],
  'admin:wise:delete': ['super_admin'],
  'admin:wise:manage': ['super_admin', 'admin'],
  'admin:wise:sync': ['super_admin', 'admin'],
  
  'admin:erpnext:read': ['super_admin', 'admin'],
  'admin:erpnext:write': ['super_admin', 'admin'],
  'admin:erpnext:delete': ['super_admin'],
  'admin:erpnext:manage': ['super_admin', 'admin'],
  'admin:erpnext:sync': ['super_admin', 'admin'],
  
  'admin:twilio:read': ['super_admin', 'admin'],
  'admin:twilio:write': ['super_admin', 'admin'],
  'admin:twilio:delete': ['super_admin'],
  'admin:twilio:manage': ['super_admin', 'admin'],
  
  // Email via Gmail SMTP (30/12/2025) - Substitui Resend
  'admin:email:read': ['super_admin', 'admin'],
  'admin:email:write': ['super_admin', 'admin'],
  'admin:email:delete': ['super_admin'],
  'admin:email:manage': ['super_admin', 'admin'],
};

/**
 * Verifica se uma role tem determinada permissão
 * 
 * @param role - Role do usuário
 * @param permission - Código da permissão
 * @returns true se a role tem a permissão
 */
export function hasPermission(role: Role, permission: string): boolean {
  const allowedRoles = PERMISSION_MAP[permission];
  if (!allowedRoles) {
    return false;
  }
  return allowedRoles.includes(role);
}

/**
 * Verifica se uma role tem nível hierárquico igual ou superior
 * 
 * @param userRole - Role do usuário
 * @param requiredRole - Role mínima requerida
 * @returns true se o usuário tem nível suficiente
 */
export function hasMinimumRole(userRole: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] <= ROLE_HIERARCHY[requiredRole];
}

/**
 * Lista todas as permissões de uma role
 * 
 * @param role - Role a consultar
 * @returns Array de códigos de permissão
 */
export function getRolePermissions(role: Role): string[] {
  const permissions: string[] = [];
  
  for (const [permission, roles] of Object.entries(PERMISSION_MAP)) {
    if (roles.includes(role)) {
      permissions.push(permission);
    }
  }
  
  return permissions;
}

/**
 * Lista todas as roles que têm determinada permissão
 * 
 * @param permission - Código da permissão
 * @returns Array de roles
 */
export function getPermissionRoles(permission: string): Role[] {
  return PERMISSION_MAP[permission] || [];
}
