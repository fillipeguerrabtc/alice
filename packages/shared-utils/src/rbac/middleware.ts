/**
 * Middleware RBAC - Alice Enterprise Platform
 * 
 * Middleware Express para verificação de permissões.
 * Documentação em PT-BR (Regra 10 replit.md).
 * 
 * SEGURANÇA: Headers x-user-id/x-user-role REMOVIDOS por vulnerabilidade de spoofing.
 * Autenticação APENAS via sessão autenticada ou token interno assinado (HMAC).
 * 
 * @module @alice/shared-utils/rbac/middleware
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
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
 * Token interno para comunicação service-to-service segura.
 * DEVE ser configurado via variável de ambiente em produção.
 */
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || '';

/**
 * Valida token HMAC para comunicação interna entre serviços.
 * 
 * O token deve ser gerado com: HMAC-SHA256(payload, INTERNAL_API_SECRET)
 * onde payload = `${userId}:${tenantId}:${role}:${timestamp}`
 * 
 * @param signature - Assinatura HMAC do header X-Internal-Signature
 * @param userId - ID do usuário
 * @param tenantId - ID do tenant
 * @param role - Role do usuário
 * @param timestamp - Timestamp Unix (segundos)
 * @returns true se válido e não expirado
 */
function validateInternalToken(
  signature: string,
  userId: string,
  tenantId: string | undefined,
  role: string,
  timestamp: string
): boolean {
  if (!INTERNAL_API_SECRET) {
    logger.error('INTERNAL_API_SECRET não configurado - comunicação interna desabilitada');
    return false;
  }

  const timestampNum = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  const maxAge = 300; // 5 minutos de validade

  if (isNaN(timestampNum) || Math.abs(now - timestampNum) > maxAge) {
    logger.warn({ timestamp, now, diff: now - timestampNum }, 'Token interno expirado ou timestamp inválido');
    return false;
  }

  const payload = `${userId}:${tenantId || ''}:${role}:${timestamp}`;
  const expectedSignature = crypto
    .createHmac('sha256', INTERNAL_API_SECRET)
    .update(payload)
    .digest('hex');

  // Comparação timing-safe para evitar timing attacks (OWASP 2025)
  if (signature.length !== expectedSignature.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'utf8'),
    Buffer.from(expectedSignature, 'utf8')
  );
}

/**
 * Extrai contexto de autenticação do request.
 * 
 * SEGURANÇA: Apenas duas fontes de autenticação são aceitas:
 * 1. req.user (sessão autenticada via passport/express-session)
 * 2. Headers internos com assinatura HMAC válida (service-to-service)
 * 
 * REMOVIDO: Headers x-user-id/x-user-role sem assinatura (vulnerabilidade crítica)
 * 
 * @param req - Request Express
 * @returns Contexto de autenticação ou undefined
 */
export function extractAuthContext(req: Request): AuthContext | undefined {
  // 1. Sessão autenticada (fonte primária - OAuth/SAML/Local)
  if (req.user) {
    return req.user as AuthContext;
  }

  // 2. Token interno assinado para service-to-service (API Gateway -> Microservices)
  const internalSignature = req.headers['x-internal-signature'] as string;
  const internalTimestamp = req.headers['x-internal-timestamp'] as string;
  const internalUserId = req.headers['x-internal-user-id'] as string;
  const internalTenantId = req.headers['x-internal-tenant-id'] as string | undefined;
  const internalRole = req.headers['x-internal-role'] as Role;

  if (internalSignature && internalTimestamp && internalUserId && internalRole) {
    const isValid = validateInternalToken(
      internalSignature,
      internalUserId,
      internalTenantId,
      internalRole,
      internalTimestamp
    );

    if (isValid) {
      logger.debug({ userId: internalUserId, role: internalRole }, 'Autenticação interna validada via HMAC');
      return {
        userId: internalUserId,
        tenantId: internalTenantId,
        role: internalRole,
      };
    }

    logger.warn({
      userId: internalUserId,
      ip: req.ip,
      path: req.path,
    }, 'Tentativa de autenticação interna com assinatura inválida');
  }

  // REMOVIDO: Headers não assinados (x-user-id, x-user-role) 
  // Eram aceitos sem validação, permitindo privilege escalation trivial
  
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

/**
 * Headers para comunicação interna segura entre serviços.
 * Usado para propagar contexto de autenticação via API Gateway.
 */
export interface InternalAuthHeaders {
  'x-internal-signature': string;
  'x-internal-timestamp': string;
  'x-internal-user-id': string;
  'x-internal-tenant-id'?: string;
  'x-internal-role': string;
}

/**
 * Gera headers assinados para comunicação service-to-service.
 * 
 * SEGURANÇA: Usa HMAC-SHA256 com INTERNAL_API_SECRET para assinar o contexto.
 * Os headers gerados têm validade de 5 minutos.
 * 
 * @param auth - Contexto de autenticação do usuário
 * @returns Headers para incluir na requisição interna
 * @throws Error se INTERNAL_API_SECRET não estiver configurado
 * 
 * @example
 * ```typescript
 * import { generateInternalAuthHeaders } from '@alice/shared-utils/rbac';
 * 
 * const headers = generateInternalAuthHeaders({
 *   userId: 'user-123',
 *   tenantId: 'tenant-456',
 *   role: 'admin',
 * });
 * 
 * await fetch('http://rag-service/api/search', {
 *   headers: {
 *     ...headers,
 *     'Content-Type': 'application/json',
 *   },
 * });
 * ```
 */
export function generateInternalAuthHeaders(auth: AuthContext): InternalAuthHeaders {
  if (!INTERNAL_API_SECRET) {
    throw new Error('INTERNAL_API_SECRET não configurado - comunicação interna não disponível');
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = `${auth.userId}:${auth.tenantId || ''}:${auth.role}:${timestamp}`;
  
  const signature = crypto
    .createHmac('sha256', INTERNAL_API_SECRET)
    .update(payload)
    .digest('hex');

  const headers: InternalAuthHeaders = {
    'x-internal-signature': signature,
    'x-internal-timestamp': timestamp,
    'x-internal-user-id': auth.userId,
    'x-internal-role': auth.role,
  };

  if (auth.tenantId) {
    headers['x-internal-tenant-id'] = auth.tenantId;
  }

  return headers;
}

/**
 * Verifica se a comunicação interna segura está disponível.
 * 
 * @returns true se INTERNAL_API_SECRET está configurado
 */
export function isInternalAuthEnabled(): boolean {
  return !!INTERNAL_API_SECRET;
}
