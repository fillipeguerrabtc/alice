/**
 * Middleware RBAC - Alice Enterprise Platform
 * 
 * Middleware Express para verificação de permissões.
 * Documentação em PT-BR (Regra 10 replit.md).
 * 
 * @module @alice/shared-utils/rbac/middleware
 */

import { Request, Response, NextFunction } from 'express';
import { createLogger, Logger } from '../logger.js';
import { 
  Role, 
  AuthContext, 
  AuthorizationOptions,
  PermissionCheckResult,
} from './types.js';
import { hasPermission, hasMinimumRole } from './permissions.js';

const logger = createLogger('rbac');

/**
 * Extrai contexto de autenticação do request
 * 
 * @param req - Request Express
 * @returns Contexto de autenticação ou undefined
 */
export function extractAuthContext(req: Request): AuthContext | undefined {
  if (req.user) {
    return req.user as AuthContext;
  }

  const userId = req.headers['x-user-id'] as string;
  const tenantId = req.headers['x-tenant-id'] as string;
  const role = req.headers['x-user-role'] as Role;

  if (userId && role) {
    return {
      userId,
      tenantId,
      role,
    };
  }

  return undefined;
}

/**
 * Middleware que requer autenticação
 * 
 * @param options - Opções de autorização
 * @returns Middleware Express
 * 
 * @example
 * ```typescript
 * import { requireAuth } from '@alice/shared-utils/rbac';
 * 
 * app.get('/api/protected', requireAuth(), (req, res) => {
 *   res.json({ user: req.user });
 * });
 * ```
 */
export function requireAuth(options?: AuthorizationOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = extractAuthContext(req);

    if (!auth) {
      if (options?.allowAnonymous) {
        return next();
      }

      logger.warn({ 
        path: req.path, 
        method: req.method,
        ip: req.ip,
      }, 'Acesso negado - usuário não autenticado');

      res.status(401).json({ 
        error: 'Autenticação necessária',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    req.user = auth;
    req.tenantId = auth.tenantId;
    next();
  };
}

/**
 * Middleware que requer uma permissão específica
 * 
 * @param permission - Código da permissão necessária
 * @param options - Opções de autorização
 * @returns Middleware Express
 * 
 * @example
 * ```typescript
 * import { requirePermission } from '@alice/shared-utils/rbac';
 * 
 * app.post('/api/documents', 
 *   requirePermission('rag:documents:upload'),
 *   async (req, res) => {
 *     // Apenas usuários com permissão podem acessar
 *   }
 * );
 * ```
 */
export function requirePermission(
  permission: string,
  options?: AuthorizationOptions
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = extractAuthContext(req);

    if (!auth) {
      if (options?.allowAnonymous) {
        return next();
      }

      logger.warn({ 
        path: req.path, 
        method: req.method,
        permission,
        ip: req.ip,
      }, 'Acesso negado - usuário não autenticado');

      res.status(401).json({ 
        error: 'Autenticação necessária',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    if (options?.bypassRoles?.includes(auth.role)) {
      req.user = auth;
      req.tenantId = auth.tenantId;
      return next();
    }

    if (options?.customCheck) {
      try {
        const allowed = await options.customCheck(auth);
        if (allowed) {
          req.user = auth;
          req.tenantId = auth.tenantId;
          return next();
        }
      } catch (error) {
        logger.error({ error, userId: auth.userId }, 'Erro na verificação customizada de permissão');
      }
    }

    const allowed = hasPermission(auth.role, permission);

    if (!allowed) {
      logger.warn({ 
        userId: auth.userId,
        tenantId: auth.tenantId,
        role: auth.role,
        permission,
        path: req.path, 
        method: req.method,
      }, 'Acesso negado - permissão insuficiente');

      res.status(403).json({ 
        error: 'Permissão insuficiente',
        code: 'FORBIDDEN',
        required: permission,
        userRole: auth.role,
      });
      return;
    }

    req.user = auth;
    req.tenantId = auth.tenantId;
    next();
  };
}

/**
 * Middleware que requer uma role mínima
 * 
 * @param minRole - Role mínima necessária
 * @param options - Opções de autorização
 * @returns Middleware Express
 * 
 * @example
 * ```typescript
 * import { requireRole } from '@alice/shared-utils/rbac';
 * 
 * app.delete('/api/users/:id', 
 *   requireRole('admin'),
 *   async (req, res) => {
 *     // Apenas admin ou super_admin podem acessar
 *   }
 * );
 * ```
 */
export function requireRole(
  minRole: Role,
  options?: AuthorizationOptions
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = extractAuthContext(req);

    if (!auth) {
      if (options?.allowAnonymous) {
        return next();
      }

      logger.warn({ 
        path: req.path, 
        method: req.method,
        requiredRole: minRole,
        ip: req.ip,
      }, 'Acesso negado - usuário não autenticado');

      res.status(401).json({ 
        error: 'Autenticação necessária',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    const hasLevel = hasMinimumRole(auth.role, minRole);

    if (!hasLevel) {
      logger.warn({ 
        userId: auth.userId,
        tenantId: auth.tenantId,
        role: auth.role,
        requiredRole: minRole,
        path: req.path, 
        method: req.method,
      }, 'Acesso negado - nível de acesso insuficiente');

      res.status(403).json({ 
        error: 'Nível de acesso insuficiente',
        code: 'FORBIDDEN',
        requiredRole: minRole,
        userRole: auth.role,
      });
      return;
    }

    req.user = auth;
    req.tenantId = auth.tenantId;
    next();
  };
}

/**
 * Middleware que requer que o usuário seja do mesmo tenant
 * 
 * @param getTenantId - Função para extrair o tenant_id da requisição
 * @returns Middleware Express
 */
export function requireSameTenant(
  getTenantId: (req: Request) => string | undefined
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = extractAuthContext(req);

    if (!auth) {
      res.status(401).json({ 
        error: 'Autenticação necessária',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    if (auth.role === 'super_admin') {
      req.user = auth;
      return next();
    }

    const resourceTenantId = getTenantId(req);
    
    if (resourceTenantId && auth.tenantId !== resourceTenantId) {
      logger.warn({ 
        userId: auth.userId,
        userTenantId: auth.tenantId,
        resourceTenantId,
        path: req.path,
      }, 'Acesso negado - tenant diferente');

      res.status(403).json({ 
        error: 'Acesso não permitido a recursos de outro tenant',
        code: 'TENANT_MISMATCH',
      });
      return;
    }

    req.user = auth;
    req.tenantId = auth.tenantId;
    next();
  };
}

/**
 * Verifica permissão programaticamente (sem middleware)
 * 
 * @param auth - Contexto de autenticação
 * @param permission - Código da permissão
 * @returns Resultado da verificação
 */
export function checkPermission(
  auth: AuthContext,
  permission: string
): PermissionCheckResult {
  const allowed = hasPermission(auth.role, permission);

  return {
    allowed,
    permission,
    userRole: auth.role,
    reason: allowed ? undefined : `Role ${auth.role} não tem permissão ${permission}`,
  };
}

/**
 * Cria um logger de RBAC com contexto do serviço
 * 
 * @param serviceName - Nome do serviço
 * @returns Logger configurado
 */
export function createRbacLogger(serviceName: string): Logger {
  return createLogger(`rbac-${serviceName}`);
}
