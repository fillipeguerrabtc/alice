/**
 * Middleware RBAC - Alice Enterprise Platform
 * 
 * Middleware Express para verificação de permissões.
 * Documentação em PT-BR (Regra 10 CLAUDE.md).
 * 
 * SEGURANÇA: Headers x-user-id/x-user-role REMOVIDOS por vulnerabilidade de spoofing.
 * Autenticação APENAS via sessão autenticada ou token interno assinado (HMAC).
 * 
 * @module @alice/shared-utils/rbac/middleware
 */

import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { createLogger, Logger } from '../logger.js';
import { 
  Role, 
  AuthContext, 
  AuthorizationOptions,
  PermissionCheckResult,
} from './types.js';
import { hasPermission, hasMinimumRole, getRolePermissions } from './permissions.js';
import { permissionCache } from './cache.js';
import { getContextHeaders } from '../async-context.js';

const logger = createLogger('rbac');

/**
 * Resolver de permissões dinâmicas (DB-driven).
 * Pode ser registrado pelos serviços no startup.
 */
export type PermissionResolver = (auth: AuthContext) => Promise<string[]>;

let permissionResolver: PermissionResolver | null = null;

/**
 * Registra um resolver de permissões (ex.: consulta role_permissions no PostgreSQL).
 */
export function setPermissionResolver(resolver: PermissionResolver): void {
  permissionResolver = resolver;
  logger.info('Permission resolver registrado para RBAC');
}

/**
 * Token interno para comunicação service-to-service segura.
 * OBRIGATÓRIO em produção (Regra 14 CLAUDE.md).
 * Em desenvolvimento, permite operação sem token para facilitar testes locais.
 */
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

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
  customRoleId: string | undefined,
  timestamp: string
): boolean {
  if (!INTERNAL_API_SECRET) {
    if (IS_PRODUCTION) {
      logger.error('INTERNAL_API_SECRET não configurado em produção - comunicação interna HMAC desabilitada');
    } else {
      logger.warn('INTERNAL_API_SECRET não configurado - comunicação interna HMAC desabilitada');
    }
    return false;
  }

  const timestampNum = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  const maxAge = 300; // 5 minutos de validade

  if (isNaN(timestampNum) || Math.abs(now - timestampNum) > maxAge) {
    // Evento esperado quando timestamp expira; registrar como informativo (sem WARN).
    logger.info({ timestamp, now, diff: now - timestampNum }, 'Token interno expirado ou timestamp inválido');
    return false;
  }

  const payload = `${userId}:${tenantId || ''}:${role}:${customRoleId || ''}:${timestamp}`;
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
  const internalCustomRoleId = req.headers['x-internal-custom-role-id'] as string | undefined;

  if (internalSignature && internalTimestamp && internalUserId && internalRole) {
    const isValid = validateInternalToken(
      internalSignature,
      internalUserId,
      internalTenantId,
      internalRole,
      internalCustomRoleId,
      internalTimestamp
    );

    if (isValid) {
      logger.debug({ userId: internalUserId, role: internalRole }, 'Autenticação interna validada via HMAC');
      return {
        userId: internalUserId,
        tenantId: internalTenantId,
        role: internalRole,
        customRoleId: internalCustomRoleId,
        roleCodes: [internalRole, ...(internalCustomRoleId ? [`custom:${internalCustomRoleId}`] : [])],
        isSuperAdmin: internalRole === 'super_admin',
      };
    }

    // Evento de segurança (assinatura inválida). Registrar como informativo (sem WARN),
    // mantendo evidência no log estruturado para auditoria/observabilidade.
    logger.info({
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
 * Middleware que requer autenticação interna via HMAC.
 *
 * Usa o mesmo esquema de assinatura gerado por generateInternalAuthHeaders.
 * Anexa AuthContext em req.user para reutilizar middlewares RBAC.
 */
export function requireInternalHmacAuth() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const internalSignature = req.headers['x-internal-signature'] as string;
    const internalTimestamp = req.headers['x-internal-timestamp'] as string;
    const internalUserId = req.headers['x-internal-user-id'] as string;
    const internalTenantId = req.headers['x-internal-tenant-id'] as string | undefined;
    const internalRole = req.headers['x-internal-role'] as Role;
    const internalCustomRoleId = req.headers['x-internal-custom-role-id'] as string | undefined;
    const correlationId = req.headers['x-correlation-id'] as string | undefined;

    if (!internalSignature || !internalTimestamp || !internalUserId || !internalRole) {
      logger.info({
        path: req.path,
        method: req.method,
        ip: req.ip,
        correlationId,
        statusCode: 401,
      }, 'Autenticação interna ausente');
      res.status(401).json({ error: 'Autenticação interna necessária', code: 'INTERNAL_UNAUTHORIZED' });
      return;
    }

    if (!/^\d+$/.test(internalTimestamp)) {
      logger.info({
        path: req.path,
        method: req.method,
        ip: req.ip,
        correlationId,
        statusCode: 401,
      }, 'Timestamp interno inválido');
      res.status(401).json({ error: 'Timestamp interno inválido', code: 'INTERNAL_UNAUTHORIZED' });
      return;
    }

    const isValid = validateInternalToken(
      internalSignature,
      internalUserId,
      internalTenantId,
      internalRole,
      internalCustomRoleId,
      internalTimestamp
    );

    if (!isValid) {
      logger.info({
        userId: internalUserId,
        role: internalRole,
        path: req.path,
        ip: req.ip,
        correlationId,
        statusCode: 401,
      }, 'Falha na autenticação interna HMAC');
      res.status(401).json({ error: 'Token interno inválido', code: 'INTERNAL_UNAUTHORIZED' });
      return;
    }

    const auth: AuthContext = {
      userId: internalUserId,
      tenantId: internalTenantId,
      role: internalRole,
      customRoleId: internalCustomRoleId,
      roleCodes: [internalRole, ...(internalCustomRoleId ? [`custom:${internalCustomRoleId}`] : [])],
      isSuperAdmin: internalRole === 'super_admin',
    };

    req.user = auth;
    req.tenantId = auth.tenantId;
    req.accessContext = auth;
    next();
  };
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

      if (options?.logUnauthorized ?? true) {
        logger.info({
          path: req.path,
          method: req.method,
          ip: req.ip,
          statusCode: 401,
        }, 'Acesso negado - usuário não autenticado');
      }

      res.status(401).json({ 
        error: 'Autenticação necessária',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    req.user = auth;
    req.tenantId = auth.tenantId;
    req.accessContext = auth;
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

      if (options?.logUnauthorized ?? true) {
        logger.info({
          path: req.path,
          method: req.method,
          permission,
          ip: req.ip,
          statusCode: 401,
        }, 'Acesso negado - usuário não autenticado');
      }

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
          req.accessContext = auth;
          return next();
        }
      } catch (error) {
        logger.error({ error, userId: auth.userId }, 'Erro na verificação customizada de permissão');
      }
    }

    const permissions = await getCachedPermissions(auth.userId, auth.tenantId, auth.role);
    const allowed = permissions.has(permission);

    if (!allowed) {
      logger.info({ 
        userId: auth.userId,
        tenantId: auth.tenantId,
        role: auth.role,
        permission,
        path: req.path, 
        method: req.method,
        statusCode: 403,
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
    req.accessContext = auth;
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

      if (options?.logUnauthorized ?? true) {
        logger.info({
          path: req.path,
          method: req.method,
          requiredRole: minRole,
          ip: req.ip,
          statusCode: 401,
        }, 'Acesso negado - usuário não autenticado');
      }

      res.status(401).json({ 
        error: 'Autenticação necessária',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    const hasLevel = hasMinimumRole(auth.role, minRole);

    if (!hasLevel) {
      logger.info({ 
        userId: auth.userId,
        tenantId: auth.tenantId,
        role: auth.role,
        requiredRole: minRole,
        path: req.path, 
        method: req.method,
        statusCode: 403,
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
    req.accessContext = auth;
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
      req.accessContext = auth;
      return next();
    }

    const resourceTenantId = getTenantId(req);
    
    if (resourceTenantId && auth.tenantId !== resourceTenantId) {
      logger.info({ 
        userId: auth.userId,
        userTenantId: auth.tenantId,
        resourceTenantId,
        path: req.path,
        statusCode: 403,
      }, 'Acesso negado - tenant diferente');

      res.status(403).json({ 
        error: 'Acesso não permitido a recursos de outro tenant',
        code: 'TENANT_MISMATCH',
      });
      return;
    }

    req.user = auth;
    req.tenantId = auth.tenantId;
    req.accessContext = auth;
    next();
  };
}

/**
 * Estatísticas do cache RBAC para métricas
 */
interface RbacCacheStats {
  hits: number;
  misses: number;
  invalidations: number;
}

const cacheStats: RbacCacheStats = {
  hits: 0,
  misses: 0,
  invalidations: 0,
};

/**
 * Obtém estatísticas do cache RBAC (para Prometheus)
 */
export function getRbacCacheStats(): RbacCacheStats {
  return { ...cacheStats };
}

/**
 * Reseta estatísticas do cache (para testes)
 */
export function resetRbacCacheStats(): void {
  cacheStats.hits = 0;
  cacheStats.misses = 0;
  cacheStats.invalidations = 0;
}

/**
 * Obtém permissões do usuário com cache.
 * 
 * Implementa cache multi-tenant com TTL para evitar lookups repetidos
 * no PERMISSION_MAP a cada requisição. O cache é invalidado quando
 * roles ou permissões do usuário mudam.
 * 
 * C5 Code Review: Agora async para suportar Redis cache distribuído
 * 
 * @param userId - ID do usuário
 * @param tenantId - ID do tenant (opcional)
 * @param role - Role do usuário
 * @returns Set de permissões do usuário
 */
async function getCachedPermissions(
  userId: string,
  tenantId: string | undefined,
  role: Role
): Promise<Set<string>> {
  // Verificar se cache está inicializado
  if (permissionCache.isInitialized()) {
    const cached = await permissionCache.get(userId, tenantId);
    
    if (cached) {
      cacheStats.hits++;
      updateRbacMetrics('hit', tenantId);
      logger.debug({ userId, tenantId, cacheHit: true }, 'Cache hit para permissões RBAC');
      return cached;
    }
  }
  
  cacheStats.misses++;
  updateRbacMetrics('miss', tenantId);
  
  const basePermissions = getRolePermissions(role);
  let resolvedPermissions: string[] = [];
  if (permissionResolver) {
    try {
      resolvedPermissions = await permissionResolver({ userId, tenantId, role });
    } catch (error) {
      logger.error({ error, userId, tenantId, role }, 'Falha ao resolver permissões via resolver');
      resolvedPermissions = [];
    }
  } else {
    resolvedPermissions = basePermissions;
  }

  if (permissionResolver && resolvedPermissions.length === 0 && basePermissions.length > 0) {
    logger.warn({ userId, tenantId, role }, 'Resolver retornou vazio; aplicando permissões base do PERMISSION_MAP');
  }

  const permissions = new Set([...basePermissions, ...resolvedPermissions]);
  
  // Salvar no cache se inicializado
  if (permissionCache.isInitialized()) {
    await permissionCache.set(userId, tenantId, permissions);
  }
  
  logger.debug({ 
    userId, 
    tenantId, 
    role, 
    permissionCount: permissions.size,
    cacheHit: false,
  }, 'Cache miss - permissões calculadas e armazenadas');
  
  return permissions;
}

/**
 * Verifica permissão programaticamente com cache (sem middleware)
 * 
 * Usa permissionCache para evitar lookups repetidos no PERMISSION_MAP.
 * Cache é multi-tenant e respeita TTL configurado.
 * 
 * C5 Code Review: Agora async para suportar Redis cache distribuído
 * 
 * @param auth - Contexto de autenticação
 * @param permission - Código da permissão
 * @returns Resultado da verificação
 * 
 * @example
 * ```typescript
 * import { checkPermission } from '@alice/shared-utils/rbac';
 * 
 * const result = await checkPermission(
 *   { userId: 'user-123', tenantId: 'tenant-456', role: 'operator' },
 *   'chat:takeover:write'
 * );
 * 
 * if (!result.allowed) {
 *   throw new Error(result.reason);
 * }
 * ```
 */
export async function checkPermission(
  auth: AuthContext,
  permission: string
): Promise<PermissionCheckResult> {
  const permissions = await getCachedPermissions(auth.userId, auth.tenantId, auth.role);
  const allowed = permissions.has(permission);

  return {
    allowed,
    permission,
    userRole: auth.role,
    reason: allowed ? undefined : `Role ${auth.role} não tem permissão ${permission}`,
  };
}

/**
 * Verifica permissão sem cache (para casos especiais)
 * 
 * @param auth - Contexto de autenticação
 * @param permission - Código da permissão
 * @returns Resultado da verificação
 */
export function checkPermissionDirect(
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
 * Invalida cache de permissões de um usuário.
 * 
 * Deve ser chamado quando:
 * - Role do usuário muda
 * - Permissões customizadas são adicionadas/removidas
 * - Usuário é removido do tenant
 * 
 * C5 Code Review: Agora async para suportar Redis cache distribuído
 * 
 * @param userId - ID do usuário
 * @param tenantId - ID do tenant (opcional)
 */
export async function invalidateUserPermissions(userId: string, tenantId?: string): Promise<void> {
  if (permissionCache.isInitialized()) {
    await permissionCache.invalidate(userId, tenantId);
  }
  cacheStats.invalidations++;
  updateRbacMetrics('invalidation', tenantId, 'user_change');
  logger.info({ userId, tenantId }, 'Cache de permissões do usuário invalidado');
}

/**
 * Invalida cache de permissões de todo um tenant.
 * 
 * Deve ser chamado quando:
 * - Configuração de roles do tenant muda
 * - Políticas de permissão são atualizadas
 * 
 * C5 Code Review: Agora async para suportar Redis cache distribuído
 * 
 * @param tenantId - ID do tenant
 */
export async function invalidateTenantPermissions(tenantId: string): Promise<void> {
  if (permissionCache.isInitialized()) {
    await permissionCache.invalidateTenant(tenantId);
  }
  cacheStats.invalidations++;
  updateRbacMetrics('invalidation', tenantId, 'tenant_change');
  logger.info({ tenantId }, 'Cache de permissões do tenant invalidado');
}

/**
 * Limpa todo o cache de permissões.
 * 
 * Deve ser chamado quando:
 * - PERMISSION_MAP é atualizado
 * - Sistema reinicia
 * 
 * C5 Code Review: Agora async para suportar Redis cache distribuído
 */
export async function clearPermissionCache(): Promise<void> {
  if (permissionCache.isInitialized()) {
    await permissionCache.clear();
  }
  cacheStats.invalidations++;
  updateRbacMetrics('invalidation', undefined, 'full_clear');
  logger.info('Cache de permissões limpo completamente');
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
  'x-internal-custom-role-id'?: string;
  'x-correlation-id'?: string;
  'x-request-id'?: string;
  traceparent?: string;
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
  const payload = `${auth.userId}:${auth.tenantId || ''}:${auth.role}:${auth.customRoleId || ''}:${timestamp}`;
  
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
  if (auth.customRoleId) {
    headers['x-internal-custom-role-id'] = auth.customRoleId;
  }

  const contextHeaders = getContextHeaders();
  if (contextHeaders['x-correlation-id']) {
    headers['x-correlation-id'] = contextHeaders['x-correlation-id'];
  }
  if (contextHeaders['x-request-id']) {
    headers['x-request-id'] = contextHeaders['x-request-id'];
  }
  if (contextHeaders.traceparent) {
    headers.traceparent = contextHeaders.traceparent;
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

/**
 * Tipo genérico para métricas RBAC do Prometheus
 * 
 * Reflete EXATAMENTE as assinaturas do prom-client 15.x (verificado em index.d.ts):
 * 
 * Counter.inc:
 *   - inc(value?: number): void;
 *   - inc(labels: LabelValues<T>, value?: number): void;
 * 
 * Histogram.observe:
 *   - observe(value: number): void;
 *   - observe(labels: LabelValues<T>, value: number): void;
 * 
 * Gauge.set:
 *   - set(value: number): void;
 * 
 * (Regra 8 - TypeScript strict, Regra 11 - Melhores Práticas 2025)
 */
export interface RbacPrometheusMetrics {
  /** Cache hits de permissões */
  cacheHitsTotal: {
    inc(value?: number): void;
    inc(labels: Record<string, string | number>, value?: number): void;
  };
  /** Cache misses de permissões */
  cacheMissesTotal: {
    inc(value?: number): void;
    inc(labels: Record<string, string | number>, value?: number): void;
  };
  /** Invalidações de cache */
  cacheInvalidationsTotal: {
    inc(value?: number): void;
    inc(labels: Record<string, string | number>, value?: number): void;
  };
  /** Duração da verificação de permissão */
  checkDuration: {
    observe(value: number): void;
    observe(labels: Record<string, string | number>, value: number): void;
  };
  /** Taxa de cache hit (0-1) */
  cacheHitRate: {
    set(value: number): void;
  };
}

let prometheusMetrics: RbacPrometheusMetrics | null = null;

/**
 * Inicializa métricas Prometheus para o RBAC.
 * 
 * Deve ser chamado uma vez na inicialização do serviço após criar
 * as métricas Prometheus com createAlicePrometheus().
 * 
 * @param metrics - Objeto metrics.rbac do Prometheus
 * 
 * @example
 * ```typescript
 * import { createAlicePrometheus } from '@alice/shared-utils/prometheus';
 * import { initRbacPrometheusMetrics } from '@alice/shared-utils/rbac';
 * 
 * const { metrics } = createAlicePrometheus({ serviceName: 'auth-service' });
 * initRbacPrometheusMetrics(metrics.rbac);
 * ```
 */
export function initRbacPrometheusMetrics(metrics: RbacPrometheusMetrics): void {
  prometheusMetrics = metrics;
  logger.info('Métricas Prometheus RBAC inicializadas');
}

/**
 * Atualiza métricas Prometheus do RBAC.
 * 
 * Chamada internamente pelo cache para reportar hits/misses.
 * Também atualiza a taxa de cache hit.
 * 
 * @internal
 */
export function updateRbacMetrics(
  event: 'hit' | 'miss' | 'invalidation',
  tenantId?: string,
  invalidationReason?: string
): void {
  if (!prometheusMetrics) return;
  
  switch (event) {
    case 'hit':
      prometheusMetrics.cacheHitsTotal.inc({ tenant_id: tenantId || 'unknown' });
      break;
    case 'miss':
      prometheusMetrics.cacheMissesTotal.inc({ tenant_id: tenantId || 'unknown' });
      break;
    case 'invalidation':
      prometheusMetrics.cacheInvalidationsTotal.inc({ reason: invalidationReason || 'manual' });
      break;
  }
  
  // Atualizar taxa de cache hit
  const total = cacheStats.hits + cacheStats.misses;
  if (total > 0) {
    prometheusMetrics.cacheHitRate.set(cacheStats.hits / total);
  }
}

/**
 * Registra duração de verificação de permissão no Prometheus.
 * 
 * @param permission - Código da permissão verificada
 * @param durationSeconds - Duração em segundos
 * @internal
 */
export function recordPermissionCheckDuration(permission: string, durationSeconds: number): void {
  if (!prometheusMetrics) return;
  prometheusMetrics.checkDuration.observe({ permission }, durationSeconds);
}
