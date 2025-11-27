/**
 * Tipos para Sistema RBAC - Alice Enterprise Platform
 * 
 * Define interfaces e tipos para Role-Based Access Control.
 * Documentação em PT-BR (Regra 10 replit.md).
 * 
 * @module @alice/shared-utils/rbac/types
 */

/**
 * Roles disponíveis no sistema (6 níveis hierárquicos)
 * Conforme documentado no replit.md
 */
export type Role =
  | 'super_admin'
  | 'admin'
  | 'manager'
  | 'operator'
  | 'viewer'
  | 'guest';

/**
 * Hierarquia de roles (menor número = maior privilégio)
 */
export const ROLE_HIERARCHY: Record<Role, number> = {
  super_admin: 1,
  admin: 2,
  manager: 3,
  operator: 4,
  viewer: 5,
  guest: 6,
};

/**
 * Descrição das roles em português
 */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  super_admin: 'Super Administrador - Acesso total ao sistema',
  admin: 'Administrador - Acesso total ao tenant',
  manager: 'Gerente - Gerencia namespaces e equipe',
  operator: 'Operador - Opera o sistema no dia a dia',
  viewer: 'Visualizador - Apenas leitura',
  guest: 'Convidado - Acesso mínimo',
};

/**
 * Módulos do sistema
 */
export type Module =
  | 'auth'
  | 'chat'
  | 'rag'
  | 'training'
  | 'integrations'
  | 'admin';

/**
 * Ações possíveis em recursos
 */
export type Action =
  | 'read'
  | 'write'
  | 'delete'
  | 'manage'
  | 'upload'
  | 'sync'
  | 'start'
  | 'cancel';

/**
 * Recurso protegido
 */
export type Resource =
  | 'users'
  | 'roles'
  | 'tenants'
  | 'namespaces'
  | 'agents'
  | 'conversations'
  | 'messages'
  | 'documents'
  | 'training_data'
  | 'fine_tuning_jobs'
  | 'integrations'
  | 'stripe'
  | 'wise'
  | 'erpnext'
  | 'twilio'
  | 'resend'
  | 'audit_logs'
  | 'metrics';

/**
 * Código de permissão no formato module:resource:action
 * Definido como string para flexibilidade (nem todas as combinações existem)
 * 
 * @example 'chat:conversations:read'
 * @example 'rag:documents:upload'
 * @example 'training:fine_tuning_jobs:start'
 */
export type PermissionCode = string;

/**
 * Contexto de autenticação do usuário
 */
export interface AuthContext {
  /** ID do usuário */
  userId: string;
  /** ID do tenant */
  tenantId?: string;
  /** Role do usuário */
  role: Role;
  /** Email do usuário (opcional) */
  email?: string;
  /** Permissões adicionais (opcional) */
  permissions?: PermissionCode[];
}

/**
 * Resultado da verificação de permissão
 */
export interface PermissionCheckResult {
  /** Se tem permissão */
  allowed: boolean;
  /** Motivo da negação (se aplicável) */
  reason?: string;
  /** Permissão verificada */
  permission: PermissionCode;
  /** Role do usuário */
  userRole: Role;
}

/**
 * Opções para o middleware de autorização
 */
export interface AuthorizationOptions {
  /** Se deve verificar tenant (padrão: true) */
  checkTenant?: boolean;
  /** Se deve permitir acesso sem autenticação (padrão: false) */
  allowAnonymous?: boolean;
  /** Roles que podem acessar independente da permissão */
  bypassRoles?: Role[];
  /** Função customizada de verificação */
  customCheck?: (context: AuthContext) => Promise<boolean>;
}

/**
 * Extensão do Request Express para incluir contexto de auth
 * NOTA: Sobrescreve Express.User para compatibilidade com passport
 */
declare global {
  namespace Express {
    interface User extends AuthContext {}
    interface Request {
      tenantId?: string;
    }
  }
}
