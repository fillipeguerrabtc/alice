/**
 * Session Authentication Middleware - Alice Enterprise Platform
 * 
 * Middleware compartilhado para validação de sessão via cookie PostgreSQL.
 * Usado por microsserviços que precisam autenticar requisições HTTP.
 * 
 * ARQUITETURA:
 * - alice-auth: Cria sessões via Passport.js + connect-pg-simple
 * - Outros serviços: Validam sessões via este middleware
 * - Cache Redis para performance (evita queries repetitivas)
 * 
 * CORREÇÃO PR#107 (10/01/2026):
 * PROBLEMA: Microsserviços (chat, rag, etc) não tinham middleware para
 *           validar cookie de sessão do alice-auth, causando 401.
 * SOLUÇÃO: Módulo compartilhado de validação de sessão.
 * 
 * REF: CLAUDE.md Regra 6 (Enterprise-grade)
 * REF: CLAUDE.md Regra 7 (Diagnóstico de causa raiz)
 * 
 * Autor: Fillipe Guerra
 * Data: 10 de Janeiro de 2026
 */

import type { Request, Response, NextFunction } from 'express';
// CORREÇÃO PR#107 (10/01/2026): Usar prefixo 'node:' para módulos Node.js built-in
// REF: https://nodejs.org/api/esm.html#node-imports
// REF: Best Practices Node.js ESM 2025 - evita conflitos com pacotes npm de mesmo nome
import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { getNodeEnv, readOptionalStringEnv } from '@alice/config';
import { createLogger } from './logger.js';
import { createCacheAdapter, type CacheAdapter } from './redis-cache-adapter.js';
import type { Role } from './rbac/types.js';

const logger = createLogger('session-auth');

// Configuração via variáveis de ambiente
const NODE_ENV = getNodeEnv();
const IS_PRODUCTION = NODE_ENV === 'production';
const SESSION_SECRET = readOptionalStringEnv('SESSION_SECRET');
const SESSION_COOKIE_NAME = readOptionalStringEnv('SESSION_COOKIE_NAME') ?? 'alice.sid';
const SESSION_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

// IMPORTANTE (DEV): o auth-service usa esse mesmo default quando SESSION_SECRET não está definido.
// Precisamos manter compatibilidade em desenvolvimento entre microsserviços.
const DEV_SESSION_SECRET = 'dev-secret-min-32-characters-long!';
let warnedDevSessionSecret = false;

function assertSessionAuthRuntimeConfig(): void {
  if (IS_PRODUCTION && (!SESSION_SECRET || SESSION_SECRET.length < 64)) {
    const message = 'CRITICAL: SESSION_SECRET é OBRIGATÓRIO em produção e deve ter >= 64 caracteres.';
    logger.error(message);
    throw new Error(message);
  }
}

function getSessionSecretForCookieValidation(): string {
  if (SESSION_SECRET && SESSION_SECRET.length > 0) return SESSION_SECRET;
  if (IS_PRODUCTION) {
    throw new Error('SESSION_SECRET ausente em produção para validação de cookie');
  }
  if (!warnedDevSessionSecret) {
    warnedDevSessionSecret = true;
    logger.warn('SESSION_SECRET não configurado - usando secret de desenvolvimento (APENAS PARA DEV)');
  }
  return DEV_SESSION_SECRET;
}

// OIDC JWT (híbrido): validação local via JWKS (sem introspection/in-memory)
const OIDC_ISSUER = readOptionalStringEnv('OIDC_ISSUER') ?? undefined;
const OIDC_API_AUDIENCE = readOptionalStringEnv('OIDC_API_AUDIENCE') ?? undefined;
let remoteJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getRemoteJwks(): ReturnType<typeof createRemoteJWKSet> | null {
  if (!OIDC_ISSUER) return null;
  if (!remoteJwks) {
    // Endpoint definido pelo auth-service: GET /.well-known/jwks.json
    remoteJwks = createRemoteJWKSet(new URL(`${OIDC_ISSUER.replace(/\/$/, '')}/.well-known/jwks.json`));
  }
  return remoteJwks;
}

async function tryAuthenticateViaBearer(req: Request): Promise<void> {
  if (req.user) return;

  const authz = req.headers.authorization;
  if (!authz?.startsWith('Bearer ')) return;

  const jwks = getRemoteJwks();
  if (!jwks) {
    logger.info({ path: req.path }, 'Bearer token recebido mas OIDC_ISSUER não configurado');
    return;
  }

  // Segurança: audience obrigatório em produção para evitar tokens “de outros clients” serem aceitos.
  if (IS_PRODUCTION && !OIDC_API_AUDIENCE) {
    logger.error({ path: req.path }, 'OIDC_API_AUDIENCE é obrigatório em produção para validar Bearer tokens');
    return;
  }

  try {
    const token = authz.slice('Bearer '.length).trim();
    const verifyOptions = {
      issuer: OIDC_ISSUER,
      ...(OIDC_API_AUDIENCE ? { audience: OIDC_API_AUDIENCE } : {}),
    } as const;

    const { payload } = await jwtVerify(token, jwks, verifyOptions);

    const sub = payload.sub;
    const role = (payload as JWTPayload & { role?: unknown }).role;
    const tenantId = (payload as JWTPayload & { tenant_id?: unknown }).tenant_id;

    if (typeof sub !== 'string' || !sub) {
      logger.info({ path: req.path }, 'Bearer token inválido: sub ausente');
      return;
    }
    if (typeof role !== 'string' || !role) {
      logger.info({ path: req.path, sub }, 'Bearer token inválido: role ausente');
      return;
    }
    if (typeof tenantId !== 'string' || !tenantId) {
      logger.info({ path: req.path, sub }, 'Bearer token inválido: tenant_id ausente');
      return;
    }

    req.user = {
      userId: sub,
      tenantId,
      role: role as Role,
    };
    req.tenantId = tenantId;
  } catch (error) {
    logger.info({ error: (error as Error).message, path: req.path }, 'Falha ao validar Bearer token (OIDC)');
  }
}

/**
 * Dados da sessão cacheada
 */
interface CachedSession {
  userId: string;
  tenantId: string | null;
  role: string;
  expiresAt: number;
}

// Cache adapter (Redis em produção, in-memory em dev)
let sessionCacheAdapter: CacheAdapter<CachedSession> | null = null;

/**
 * Inicializa o cache de sessões (chamar após initializeRedisCache)
 */
export async function initializeSessionAuthCache(): Promise<void> {
  assertSessionAuthRuntimeConfig();

  try {
    const adapter = createCacheAdapter<CachedSession>('session-auth', SESSION_CACHE_TTL);
    if (!adapter.isDistributed()) {
      // Regra do projeto: evitar in-memory. Em dev/test, apenas desabilitamos cache.
      if (IS_PRODUCTION) {
        const message = 'CRITICAL: Cache distribuído (Redis) é obrigatório em produção para session-auth.';
        logger.error(message);
        throw new Error(message);
      }
      sessionCacheAdapter = null;
      logger.info('Cache de sessões HTTP desabilitado (Redis indisponível em dev/test)');
      return;
    }
    sessionCacheAdapter = adapter;
    logger.info({ distributed: sessionCacheAdapter.isDistributed() }, 'Cache de sessões HTTP inicializado');
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Falha ao inicializar cache de sessões HTTP');
    if (IS_PRODUCTION) {
      throw error;
    }
    sessionCacheAdapter = null;
  }
}

/**
 * Parseia header de cookie em objeto key-value
 * 
 * CORREÇÃO PR#107: Valores de cookie podem conter '=' (comum em base64)
 * Exemplo: alice.sid=s:abc123.xyz==
 * Com split('=')[1] perderia os '==' finais, causando falha na validação
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  
  cookieHeader.split(';').forEach(cookie => {
    const trimmed = cookie.trim();
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex);
      const value = trimmed.slice(eqIndex + 1);
      cookies[key] = decodeURIComponent(value);
    }
  });
  
  return cookies;
}

/**
 * Decodifica session ID do cookie assinado (connect.sid format)
 * O cookie é assinado com HMAC-SHA256 no formato s:sessionId.signature
 */
function decodeSessionId(signedCookie: string): string | null {
  if (!signedCookie.startsWith('s:')) {
    return null;
  }
  
  const value = signedCookie.slice(2);
  const dotIndex = value.lastIndexOf('.');
  
  if (dotIndex === -1) {
    return null;
  }
  
  const sessionId = value.slice(0, dotIndex);
  const signature = value.slice(dotIndex + 1);
  
  // Verificar assinatura HMAC-SHA256
  // CORREÇÃO PR#107 (10/01/2026): Assinatura deve ser base64 NORMAL, não base64url!
  // cookie-signature (usado por express-session) usa base64 normal com padding removido
  // REF: https://www.npmjs.com/package/cookie-signature
  // ERRADO: .replace(/\+/g, '-').replace(/\//g, '_') - isso é base64url
  // CORRETO: apenas remover padding '='
  const expectedSignature = crypto
    .createHmac('sha256', getSessionSecretForCookieValidation())
    .update(sessionId)
    .digest('base64')
    .replace(/=+$/, '');
  
  // Comparação timing-safe para prevenir timing attacks
  try {
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    
    if (signatureBuffer.length !== expectedBuffer.length) {
      return null;
    }
    
    if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return null;
    }
  } catch {
    return null;
  }
  
  return sessionId;
}

/**
 * Valida sessão no PostgreSQL e retorna dados do usuário
 * Usa cache distribuído (Redis) para evitar queries repetitivas
 * 
 * @param sessionId - ID da sessão
 * @param pool - Pool de conexões PostgreSQL
 */
async function validateSessionFromDatabase(
  sessionId: string,
  pool: { query: (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }
): Promise<CachedSession | null> {
  // Verificar cache primeiro
  if (sessionCacheAdapter) {
    const cached = await sessionCacheAdapter.get(sessionId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }
  }
  
  try {
    // Query direta na tabela sessions (connect-pg-simple)
    const result = await pool.query(
      'SELECT sess FROM sessions WHERE sid = $1 AND expire > NOW()',
      [sessionId]
    );
    
    if (result.rows.length === 0) {
      logger.debug({ sessionId: sessionId.substring(0, 8) + '...' }, 'Sessão não encontrada ou expirada');
      return null;
    }
    
    const sessionData = result.rows[0].sess as { passport?: { user?: string } };
    
    // Estrutura da sessão passport: { passport: { user: userId } }
    const passportData = sessionData?.passport;
    if (!passportData?.user) {
      logger.debug({ sessionId: sessionId.substring(0, 8) + '...' }, 'Sessão sem usuário autenticado');
      return null;
    }
    
    const userId = passportData.user;
    
    // Buscar dados completos do usuário no banco
    const userResult = await pool.query(
      'SELECT id, tenant_id, role FROM users WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      logger.warn({ userId }, 'Usuário da sessão não encontrado no banco');
      return null;
    }
    
    const user = userResult.rows[0] as { id: string; tenant_id: string | null; role: string };
    const cachedSession: CachedSession = {
      userId: user.id,
      tenantId: user.tenant_id,
      role: user.role || 'viewer',
      expiresAt: Date.now() + SESSION_CACHE_TTL,
    };
    
    // Armazenar em cache
    if (sessionCacheAdapter) {
      await sessionCacheAdapter.set(sessionId, cachedSession, SESSION_CACHE_TTL);
    }
    
    return cachedSession;
  } catch (error) {
    logger.error({ error, sessionId: sessionId.substring(0, 8) + '...' }, 'Erro ao validar sessão no banco');
    return null;
  }
}

/**
 * Opções para o middleware de sessão
 */
interface SessionAuthMiddlewareOptions {
  /** Pool de conexões PostgreSQL */
  pool: { query: (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
  /** Rotas públicas que não precisam de autenticação */
  publicPaths?: string[];
}

/**
 * Cria middleware Express para autenticação via cookie de sessão PostgreSQL
 * 
 * @example
 * ```typescript
 * import { createSessionAuthMiddleware } from '@alice/shared-utils';
 * import { getPool } from '@alice/database';
 * 
 * app.use(createSessionAuthMiddleware({
 *   pool: getPool(),
 *   publicPaths: ['/api/chat/health', '/live', '/ready', '/metrics'],
 * }));
 * ```
 */
export function createSessionAuthMiddleware(options: SessionAuthMiddlewareOptions) {
  const { pool, publicPaths = [] } = options;
  
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    // Skip para rotas públicas
    if (publicPaths.some(path => req.path.startsWith(path))) {
      return next();
    }

    // Extrair cookie de sessão
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) {
      await tryAuthenticateViaBearer(req);
      return next(); // Deixar requireAuth() retornar 401 se necessário
    }

    const cookies = parseCookies(cookieHeader);
    const sessionCookie = cookies[SESSION_COOKIE_NAME];
    
    if (!sessionCookie) {
      await tryAuthenticateViaBearer(req);
      return next();
    }

    // Decodificar e validar assinatura
    const sessionId = decodeSessionId(sessionCookie);
    if (!sessionId) {
      logger.debug({ path: req.path }, 'Cookie de sessão com assinatura inválida');
      return next();
    }

    // Validar sessão no PostgreSQL (com cache Redis)
    const session = await validateSessionFromDatabase(sessionId, pool);
    if (!session) {
      return next();
    }

    // Popular req.user para uso pelo requireAuth() e outros middlewares
    req.user = {
      userId: session.userId,
      tenantId: session.tenantId ?? undefined, // null → undefined
      role: session.role as Role,
    };
    req.tenantId = session.tenantId ?? undefined;

    logger.debug({
      userId: session.userId,
      tenantId: session.tenantId,
      role: session.role,
      path: req.path,
    }, 'Sessão HTTP validada via cookie PostgreSQL');

    next();
  };
}
