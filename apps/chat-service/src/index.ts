/**
 * Chat Service - Alice Enterprise Platform
 * 
 * Serviço de chat com WebSocket tempo real e integração LLM via GPU Manager Service.
 * Integra com RAG Service para contexto de documentos (Fase 3 - Integração Chat+RAG).
 * Implementa Circuit Breaker pattern (Regra 16 - Best Practices 2025).
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import express from 'express';
import type { Request, Response } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import compression from 'compression';
// CORREÇÃO PR#107 (10/01/2026): Usar prefixo 'node:' para módulos Node.js built-in
// REF: https://nodejs.org/api/esm.html#node-imports
// REF: Best Practices Node.js ESM 2025 - evita conflitos com pacotes npm de mesmo nome
// PROBLEMA: 'require("crypto")' dentro de função causava "Dynamic require not supported" em ESM bundle
import crypto from 'node:crypto';
import { 
  createCircuitBreaker, 
  CIRCUIT_BREAKER_PRESETS, 
  initializeRedisCache,
  // Auth híbrida (WS4): Sessão (cookie) + Bearer JWT (OIDC) com validação local via JWKS
  createSessionAuthMiddleware,
  initializeSessionAuthCache,
  createCacheAdapter,
  closeRedisCacheClient,
  type CacheAdapter,
  setupSwaggerUI,
  CHAT_SERVICE_TAGS,
  requestGpu,
  GpuServiceType,
  GpuRequestPriority,
} from '@alice/shared-utils';
import { chatServicePaths, chatServiceSchemas } from './openapi-specs.js';
import { createLogger } from '@alice/logger';
import { getDatabase, schema, closeDatabasePool, isPoolHealthy, createDrizzleFeatureFlagStorage, getPool } from '@alice/database';
import { 
  createCorrelationMiddleware, 
  createSecurityMiddleware,
  createRateLimiter,
  createErrorHandler,
  createNotFoundHandler,
  asyncHandler,
  requirePermission, 
  requireAuth,
  requireSameTenant,
  generateInternalAuthHeaders,
  isInternalAuthEnabled,
  checkPermission,
  initFeatureFlags,
  createAlicePrometheus,
  initRbacPrometheusMetrics,
  instrumentCircuitBreaker,
  registerShutdownCallback,
  ShutdownPriority,
  permissionCache,
  setPermissionResolver,
  requestGpuStream,
  validateAgentTenantConsistency,
  TRADING_CHANNEL_PREFIX,
  TRADING_CHANNELS,
  PERMISSION_MAP,
  type AgentEvent,
  redactSensitivePayload,
} from '@alice/shared-utils';
import type { AuthContext } from '@alice/shared-utils';
import type { Role } from '@alice/shared-utils';
import { eq, desc, inArray, and, or, lt, sql, not, asc } from '@alice/database';
import { z } from 'zod';
import { ProxyAgent } from 'undici';
import { createClient } from 'redis';
import type { AgenticDetectors } from '@alice/shared';
import { isTradingCommand } from './trading-command-parser.js';
import { 
  buscarContextoRAG, 
  buscarContextoAgentic,
  buscarImagensWeb,
  createDocumentInRAG,
  formatarContextoParaLLM, 
  getRAGBreakerStats,
  getMediaStatus,
  updateDocumentInRAG,
  uploadMediaToRAG,
  classificarConsultaAgentic,
} from './rag-client.js';
import type { MediaUploadResult, RAGContextResponse } from './rag-client.js';
import {
  initOrchestrator,
  getOrCreateConversationState,
  inititateTakeover,
  handbackToBot,
  processAutoEscalation,
  shouldEscalate,
  processLLMResponseForEscalation,
  getPendingHandoffs,
  getUrgentConversations,
  checkSLABreaches,
  updateConversationState,
  ESCALATION_CONFIG,
} from './conversation-orchestrator.js';
// Arquitetura atual (16/01/2026+):
// - GPU local: Texto + Embeddings + ASR
// - Vision e geração de imagens: OpenAI API (somente OPENAI_API_KEY)
import { initTradingOrchestrator } from './trading-orchestrator.js';
// CORREÇÃO 19/12/2025: Remover imports não utilizados (no-unused-vars)
// isGreeting, getCacheMetrics, isCacheOperational estão disponíveis no módulo
// mas são usados internamente via checkResponseCache
import { checkResponseCache } from './response-cache.js';

// Logger centralizado: JSON em produção, pino-pretty em desenvolvimento
const logger = createLogger('chat-service');

const PORT = process.env.PORT || 3002;
const DATABASE_URL = process.env.DATABASE_URL;
// GPU Manager Service (25/12/2025): URL gerenciada por requestGpuStream em @alice/shared-utils
// BUG FIX 26/12/2025: Removida declaração duplicada de GPU_MANAGER_URL - requestGpuStream centraliza o acesso
const corsOriginsEnv = process.env.CORS_ORIGINS;
if (!corsOriginsEnv && process.env.NODE_ENV === 'production') {
  logger.error('CORS_ORIGINS é obrigatório em produção (Regra 6 - fail-fast)');
  process.exit(1);
}
const CORS_ORIGINS = corsOriginsEnv
  ? corsOriginsEnv.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [];

// OpenAI API Key (Vision + geração de imagens)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY && process.env.NODE_ENV === 'production') {
  logger.error('OPENAI_API_KEY é obrigatório em produção (Vision + geração de imagens via OpenAI)');
  process.exit(1);
}
const OPENAI_PROXY = process.env.OPENAI_PROXY ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? null;
const OPENAI_NO_PROXY = process.env.NO_PROXY ?? process.env.no_proxy ?? null;
const OPENAI_VISION_MAX_BYTES = (() => {
  const raw = process.env.OPENAI_VISION_MAX_BYTES;
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.error({ value: raw }, 'OPENAI_VISION_MAX_BYTES inválido - precisa ser número > 0');
    process.exit(1);
  }
  return parsed;
})();
const APP_VERSION = process.env.APP_VERSION?.trim() || null;
const WEB_IMAGE_SEARCH_MAX_RESULTS = parseEnvInt(
  process.env.WEB_IMAGE_SEARCH_MAX_RESULTS,
  3,
  'WEB_IMAGE_SEARCH_MAX_RESULTS'
);
const WEB_IMAGE_MAX_BYTES = parseEnvInt(
  process.env.WEB_IMAGE_MAX_BYTES,
  8 * 1024 * 1024,
  'WEB_IMAGE_MAX_BYTES'
);

const OPENAI_HOSTNAME = 'api.openai.com';
const OPENAI_NO_PROXY_ENTRIES = OPENAI_NO_PROXY
  ? OPENAI_NO_PROXY.split(',').map((entry) => entry.trim()).filter(Boolean)
  : [];

// RequestInit do TS (DOM) não inclui dispatcher. Tipamos como unknown para
// compatibilidade entre undici e undici-types no CI.
type OpenAiDispatcher = unknown;

function isNoProxyMatch(hostname: string, entry: string): boolean {
  if (entry === '*') return true;
  if (entry.startsWith('.')) {
    return hostname.endsWith(entry);
  }
  if (hostname === entry) return true;
  return hostname.endsWith(`.${entry}`);
}

function shouldBypassProxy(hostname: string, entries: string[]): boolean {
  if (!entries.length) return false;
  return entries.some((entry) => isNoProxyMatch(hostname, entry));
}

const OPENAI_PROXY_URL = (() => {
  if (!OPENAI_PROXY) return null;
  try {
    return new URL(OPENAI_PROXY).toString();
  } catch (error) {
    logger.error({ error, value: OPENAI_PROXY }, 'OPENAI_PROXY inválido - URL malformada');
    process.exit(1);
  }
})();

const OPENAI_DISPATCHER: OpenAiDispatcher | undefined = (() => {
  if (!OPENAI_PROXY_URL) return undefined;
  if (shouldBypassProxy(OPENAI_HOSTNAME, OPENAI_NO_PROXY_ENTRIES)) {
    logger.info({ hostname: OPENAI_HOSTNAME }, 'OpenAI sem proxy (NO_PROXY aplicado)');
    return undefined;
  }
  logger.info({ proxy: OPENAI_PROXY_URL }, 'OpenAI configurado com proxy');
  // ProxyAgent vem de undici (runtime) e RequestInit usa undici-types (tipo).
  // Casting via unknown mantém compatibilidade sem perder segurança de tipos.
  return new ProxyAgent(OPENAI_PROXY_URL) as unknown as OpenAiDispatcher;
})();

function withOpenAiDispatcher(init: RequestInit): RequestInit {
  if (!OPENAI_DISPATCHER) return init;
  // O dispatcher é uma extensão do fetch do undici (não existe no RequestInit do TS),
  // então fazemos cast controlado para manter compatibilidade sem perder funcionalidade.
  return { ...init, dispatcher: OPENAI_DISPATCHER } as unknown as RequestInit;
}

// URL do Integrations Service para comunicação cross-service (Regra 15 - Microsserviços)
// REGRA 6: Fail-fast em TODOS os ambientes - variável DEVE estar definida
const INTEGRATIONS_SERVICE_URL = process.env.INTEGRATIONS_SERVICE_URL;
if (!INTEGRATIONS_SERVICE_URL) {
  throw new Error('INTEGRATIONS_SERVICE_URL é obrigatório (Regra 6 - fail-fast)');
}
const INTEGRATIONS_SERVICE_URL_FINAL = INTEGRATIONS_SERVICE_URL;

// URL do Training Service para coleta de dados de treinamento (Regra 15 - Microsserviços)
// REGRA 6: Fail-fast em TODOS os ambientes - variável DEVE estar definida
const TRAINING_SERVICE_URL = process.env.TRAINING_SERVICE_URL;
if (!TRAINING_SERVICE_URL) {
  throw new Error('TRAINING_SERVICE_URL é obrigatório (Regra 6 - fail-fast)');
}
const TRAINING_SERVICE_URL_FINAL = TRAINING_SERVICE_URL;

// SEGURANÇA: Usar req.tenantId populado pelo middleware requireAuth
// Alinhado com Express.js 2025 + OWASP 2025 best practices
const getTenantIdFromRequest = (req: Request): string | undefined => {
  return req.tenantId;
};

if (!DATABASE_URL) {
  logger.error('DATABASE_URL não configurada');
  process.exit(1);
}

// Usar package @alice/database centralizado (node-postgres para produção Hetzner)
const db = getDatabase();

// Inicializar sistema de feature flags com storage PostgreSQL (Regra 16 - Enterprise)
const featureFlagStorage = createDrizzleFeatureFlagStorage();
initFeatureFlags(featureFlagStorage);
logger.info('Sistema de feature flags inicializado');

initOrchestrator(db);
// ARQUITETURA 16/01/2026+: geração e análise de imagens via OpenAI
initTradingOrchestrator(db);

const app = express();

// ============================================================================
// PROMETHEUS: Instrumentação de métricas (Regra 16 - Observability Enterprise)
// ============================================================================
const { metrics, metricsRouter, httpMetricsMiddleware } = createAlicePrometheus({
  serviceName: 'chat-service',
  collectDefaultMetrics: true,
});

// Inicializar métricas RBAC (Regra 16 - Observability Enterprise)
initRbacPrometheusMetrics(metrics.rbac);
logger.info('Métricas RBAC Prometheus inicializadas no chat-service');

type AgenticActionLabel = 'trading' | 'payments' | 'stack_ops' | 'agentic_task' | 'erp';
type AgenticDecisionLabel = 'approve' | 'reject';
type AgenticStatusLabel = 'pending' | 'executed' | 'rejected' | 'failed';

const resolveAgenticActionLabel = (params: {
  pendingCommand?: ParsedTradingCommand;
  pendingTask?: { taskType?: AgenticTaskType };
  pendingIntegration?: { action?: 'payments' | 'stack_ops' | 'erp' };
  fallback?: AgenticActionLabel;
}): AgenticActionLabel => {
  if (params.pendingCommand) {
    return 'trading';
  }
  if (params.pendingIntegration?.action === 'payments') {
    return 'payments';
  }
  if (params.pendingIntegration?.action === 'stack_ops') {
    return 'stack_ops';
  }
  if (params.pendingIntegration?.action === 'erp') {
    return 'erp';
  }
  if (params.pendingTask) {
    return 'agentic_task';
  }
  return params.fallback ?? 'agentic_task';
};

const recordAgenticMetrics = (params: {
  action: AgenticActionLabel;
  status: AgenticStatusLabel;
  decision?: AgenticDecisionLabel;
  startedAt?: Date | null;
}): void => {
  metrics.agentic.actionsTotal.inc({ action: params.action, status: params.status });
  if (params.decision) {
    metrics.agentic.approvalsTotal.inc({ action: params.action, decision: params.decision });
  }
  if (params.startedAt) {
    const durationSeconds = Math.max(0, (Date.now() - params.startedAt.getTime()) / 1000);
    metrics.agentic.actionDuration.observe({ action: params.action, status: params.status }, durationSeconds);
  }
};

// Endpoint /metrics para Prometheus scraper (antes de outros middlewares)
app.use(metricsRouter);

// ============================================================================
// OPENAPI/SWAGGER: Documentação da API (OWASP API9)
// ============================================================================
setupSwaggerUI(app, {
  serviceName: 'chat-service',
  version: '1.0.0',
  description: 'Serviço de chat com WebSocket, LLM streaming e análise de imagens via OpenAI (gpt-4.1).',
  port: Number(PORT),
  tags: CHAT_SERVICE_TAGS,
  paths: chatServicePaths,
  schemas: chatServiceSchemas,
});
logger.info('Swagger UI configurado em /api/docs');

// Middleware para coletar métricas HTTP automaticamente
app.use(httpMetricsMiddleware);

// SEGURANÇA: Desabilitar X-Powered-By header (Express.js 2025 + OWASP API8)
app.disable('x-powered-by');

// SEGURANÇA: Trust proxy = 1 para confiar apenas no primeiro proxy (Traefik)
// Evita bypass de rate limiting (express-rate-limit 2025 best practice)
app.set('trust proxy', 1);

const server = createServer(app);

// ============================================================================
// WEBSOCKET SECURITY (ws v8.18.3 - Best Practices 2025)
// Autenticação completa via sessão PostgreSQL (OWASP API2 2023)
// ============================================================================

// SEGURANÇA: Origin validation allowlist (OWASP WebSocket Security)
const ALLOWED_WEBSOCKET_ORIGINS = process.env.WEBSOCKET_ALLOWED_ORIGINS?.split(',') || CORS_ORIGINS;

// SEGURANÇA: Nome do cookie de sessão (deve coincidir com auth-service)
const SESSION_COOKIE_NAME = 'alice.sid';

// SEGURANÇA: SESSION_SECRET OBRIGATÓRIO em produção (Regra 6 - ZERO soluções temporárias)
// Falha imediata se não configurado em produção (fail-fast enterprise pattern)
const SESSION_SECRET = (() => {
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    logger.error('SESSION_SECRET não configurado em produção - WebSocket desabilitado por segurança');
    throw new Error('SESSION_SECRET é obrigatório em produção');
  }
  // Em desenvolvimento, usa secret de dev com warning (apenas para facilitar testes)
  if (!secret) {
    logger.warn('SESSION_SECRET não configurado - usando secret de desenvolvimento (APENAS PARA DEV)');
    return 'dev-secret-min-32-characters-long!';
  }
  return secret;
})();

// Cache de sessões validadas para evitar queries repetitivas (TTL 5 minutos)
// C4 Code Review: Usa RedisCacheAdapter em produção (Regra 6 - PROIBIDO in-memory em produção)
interface CachedSession {
  userId: string;
  tenantId: string | null;
  role: string;
  expiresAt: number;
}
const SESSION_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

// Cache adapter (Redis em produção, in-memory em dev)
// Inicializado em initializeSessionCache() após initializeRedisCache()
let sessionCacheAdapter: CacheAdapter<CachedSession> | null = null;

/**
 * Inicializa o cache de sessões com Redis (produção) ou in-memory (dev)
 * Regra 6: fail-fast em produção se Redis indisponível
 */
async function initializeSessionCache(): Promise<void> {
  try {
    await initializeRedisCache();
    sessionCacheAdapter = createCacheAdapter<CachedSession>('session', SESSION_CACHE_TTL);
    logger.info({ distributed: sessionCacheAdapter.isDistributed() }, 'Cache de sessões inicializado');
  } catch (error) {
    logger.fatal({ error: (error as Error).message }, 'Falha ao inicializar cache de sessões');
    throw error;
  }
}

/**
 * Inicializa todos os caches (sessões e permissões RBAC)
 * C4/C5 Code Review: Caches Redis em produção (Regra 6)
 */
async function initializeAllCaches(): Promise<void> {
  // Inicializar cache de sessões
  await initializeSessionCache();

  // WS4: sessão HTTP (cookie) + Bearer JWT (OIDC) — cache distribuído para evitar queries repetitivas
  // - Em produção: Redis distribuído é obrigatório (fail-fast dentro de initializeSessionAuthCache)
  // - Em dev/test: cache fica desabilitado (sem in-memory)
  await initializeSessionAuthCache();
  
  // Inicializar cache de permissões RBAC
  // Usa o mesmo cliente Redis já inicializado
  await permissionCache.initialize();
  setPermissionResolver(async (auth: AuthContext) => {
    const db = getDatabase();
    const baseRoleRows = await db.query.userRoles.findMany({
      where: eq(schema.userRoles.userId, auth.userId),
      columns: { role: true },
    });
    let baseRoles = baseRoleRows.map((row) => row.role as Role).filter(Boolean);
    if (baseRoles.length === 0) {
      const fallbackUser = await db.query.users.findFirst({
        where: eq(schema.users.id, auth.userId),
        columns: { role: true },
      });
      if (fallbackUser?.role) {
        baseRoles = [fallbackUser.role as Role];
      }
    }

    const customRoleRows = await db.query.userCustomRoles.findMany({
      where: eq(schema.userCustomRoles.userId, auth.userId),
      with: {
        customRole: {
          columns: { id: true, ativo: true, tenantId: true },
        },
      },
    });
    let customRoleIds = customRoleRows
      .filter((row) => row.customRole?.ativo)
      .filter((row) => !auth.tenantId || row.customRole?.tenantId === auth.tenantId)
      .map((row) => row.customRoleId);
    if (customRoleIds.length === 0) {
      const fallbackUser = await db.query.users.findFirst({
        where: eq(schema.users.id, auth.userId),
        columns: { customRoleId: true },
      });
      const fallbackCustomRoleId = fallbackUser?.customRoleId ?? undefined;
      if (fallbackCustomRoleId) {
        const activeRole = await db.query.customRoles.findFirst({
          where: and(
            eq(schema.customRoles.id, fallbackCustomRoleId),
            eq(schema.customRoles.ativo, true),
            auth.tenantId ? eq(schema.customRoles.tenantId, auth.tenantId) : sql`1=1`
          ),
          columns: { id: true },
        });
        if (activeRole) {
          customRoleIds = [fallbackCustomRoleId];
        }
      }
    }

    const isAdminRole = baseRoles.some((role) => role === 'admin' || role === 'super_admin');
    const rolePermissions = isAdminRole
      ? await db.query.permissions.findMany({ columns: { codigo: true } })
      : baseRoles.length > 0
        ? await db.query.rolePermissions.findMany({
          where: inArray(schema.rolePermissions.role, baseRoles),
          with: { permission: true },
        })
        : [];
    const customRolePermissions = customRoleIds.length > 0
      ? await db.query.customRolePermissions.findMany({
        where: inArray(schema.customRolePermissions.customRoleId, customRoleIds),
        with: { permission: true },
      })
      : [];
    const dbPermissions = rolePermissions
      .map((rp) => ('codigo' in rp ? rp.codigo : (rp as { permission?: { codigo?: string | null } }).permission?.codigo))
      .filter((code): code is string => Boolean(code));
    const customPermissions = customRolePermissions
      .map((rp) => (rp as { permission?: { codigo?: string | null } }).permission?.codigo)
      .filter((code): code is string => Boolean(code));
    const basePermissions = Object.entries(PERMISSION_MAP)
      .filter(([, roles]) => roles.some((role) => baseRoles.includes(role as Role)))
      .map(([code]) => code);
    const resolved = new Set<string>([...dbPermissions, ...customPermissions, ...basePermissions]);
    if (isAdminRole) {
      resolved.add('admin:alice_core:write');
    }
    return Array.from(resolved);
  });
  logger.info({ 
    sessionDistributed: sessionCacheAdapter?.isDistributed() ?? false,
    rbacDistributed: permissionCache.getStats().distributed,
  }, 'Todos os caches inicializados');
}

/**
 * Parseia cookies do header Cookie (RFC 6265)
 * Implementação segura sem dependências externas
 */
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const key = parts[0]?.trim();
    const value = parts.slice(1).join('=').trim();
    if (key && value) {
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
    .createHmac('sha256', SESSION_SECRET)
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
 * Usa cache distribuído (Redis) para evitar queries repetitivas (OWASP API4 - Rate Limiting)
 * C4 Code Review: Cache Redis em produção, in-memory em dev (Regra 6)
 */
async function validateSessionFromDatabase(sessionId: string): Promise<CachedSession | null> {
  // Verificar cache primeiro (async para Redis)
  if (sessionCacheAdapter) {
    const cached = await sessionCacheAdapter.get(sessionId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }
  }
  
  try {
    // Query direta na tabela sessions (connect-pg-simple)
    // CORREÇÃO PR#107 (10/01/2026): Usar getPool() importado, não require() dinâmico
    // require('@alice/database') causava falha silenciosa em ESM bundle
    const pool = getPool();
    const result = await pool.query(
      'SELECT sess FROM sessions WHERE sid = $1 AND expire > NOW()',
      [sessionId]
    );
    
    if (result.rows.length === 0) {
      logger.debug({ sessionId: sessionId.substring(0, 8) + '...' }, 'Sessão não encontrada ou expirada');
      return null;
    }
    
    const sessionData = result.rows[0].sess;
    
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
    
    const user = userResult.rows[0];
    const cachedSession: CachedSession = {
      userId: user.id,
      tenantId: user.tenant_id,
      role: user.role || 'viewer',
      expiresAt: Date.now() + SESSION_CACHE_TTL,
    };
    
    // Armazenar em cache (Redis em produção, in-memory em dev)
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
 * Interface para dados de autenticação WebSocket
 */
interface WebSocketAuthResult {
  authenticated: boolean;
  userId?: string;
  tenantId?: string;
  role?: string;
  error?: string;
}

/**
 * Autentica conexão WebSocket via sessão (OWASP API2 2023)
 * Valida cookie de sessão e carrega dados do usuário do PostgreSQL
 */
async function authenticateWebSocketConnection(
  cookies: string | undefined,
  origin: string | undefined
): Promise<WebSocketAuthResult> {
  // 1. Validar Origin
  if (!verifyWebSocketOrigin(origin)) {
    return { authenticated: false, error: 'Origin not allowed' };
  }
  
  // 2. Parsear cookies
  const parsedCookies = parseCookies(cookies);
  const sessionCookie = parsedCookies[SESSION_COOKIE_NAME];
  
  if (!sessionCookie) {
    logger.debug('WebSocket: Cookie de sessão não encontrado');
    return { authenticated: false, error: 'Session cookie not found' };
  }
  
  // 3. Decodificar e verificar assinatura do cookie
  const sessionId = decodeSessionId(sessionCookie);
  
  if (!sessionId) {
    logger.warn('WebSocket: Cookie de sessão com assinatura inválida');
    return { authenticated: false, error: 'Invalid session signature' };
  }
  
  // 4. Validar sessão no PostgreSQL
  const session = await validateSessionFromDatabase(sessionId);
  
  if (!session) {
    return { authenticated: false, error: 'Session expired or invalid' };
  }
  
  logger.info({ 
    userId: session.userId, 
    tenantId: session.tenantId,
    role: session.role,
  }, 'WebSocket: Conexão autenticada via sessão');
  
  return {
    authenticated: true,
    userId: session.userId,
    tenantId: session.tenantId || undefined,
    role: session.role,
  };
}

function verifyWebSocketOrigin(origin: string | undefined): boolean {
  if (!origin) {
    logger.warn('WebSocket connection attempt without Origin header');
    return false;
  }
  
  // Em desenvolvimento permitir localhost
  if (process.env.NODE_ENV !== 'production') {
    const devPatterns = ['localhost', '127.0.0.1', 'replit.dev', 'repl.co'];
    if (devPatterns.some(pattern => origin.includes(pattern))) {
      return true;
    }
  }
  
  // Em produção, verificar contra allowlist
  const isAllowed = ALLOWED_WEBSOCKET_ORIGINS.some(allowed => {
    const normalizedAllowed = allowed.trim().toLowerCase();
    const normalizedOrigin = origin.toLowerCase();
    return normalizedOrigin === normalizedAllowed || 
           normalizedOrigin.endsWith(normalizedAllowed.replace('https://', '.').replace('http://', '.'));
  });
  
  if (!isAllowed) {
    logger.warn({ origin, allowedOrigins: ALLOWED_WEBSOCKET_ORIGINS }, 'WebSocket connection rejected: origin not in allowlist');
  }
  
  return isAllowed;
}

// Mapa para armazenar auth result durante handshake (entre verifyClient e connection)
const pendingAuthResults = new Map<string, WebSocketAuthResult>();

// SEGURANÇA: TTL para entradas pendentes (evita memory leak/DoS)
// Entradas são removidas após 5 segundos ou quando usadas
const PENDING_AUTH_TTL = 5000;

// Cleanup periódico de entradas expiradas (a cada 30 segundos)
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key] of pendingAuthResults) {
    // Chave contém timestamp: "ip:timestamp"
    const timestamp = parseInt(key.split(':').pop() || '0', 10);
    if (now - timestamp > PENDING_AUTH_TTL) {
      pendingAuthResults.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug({ cleaned, remaining: pendingAuthResults.size }, 'Limpeza de auth results pendentes');
  }
}, 30000);

// SEGURANÇA: maxPayload e ping/pong heartbeat (ws v8.18.3)
// Autenticação completa via sessão PostgreSQL (OWASP API2 2023)
const wss = new WebSocketServer({ 
  server, 
  path: '/ws/chat',
  maxPayload: 10 * 1024 * 1024, // 10MB max payload (OWASP WebSocket Security)
  verifyClient: async (info, callback) => {
    const origin = info.origin || info.req.headers.origin;
    const cookies = info.req.headers.cookie;
    
    // Autenticação assíncrona via sessão
    const authResult = await authenticateWebSocketConnection(cookies, origin);
    
    if (!authResult.authenticated) {
      logger.warn({ 
        origin, 
        error: authResult.error,
        ip: info.req.socket?.remoteAddress,
      }, 'WebSocket: Conexão rejeitada - autenticação falhou');
      callback(false, 401, authResult.error || 'Unauthorized');
      return;
    }
    
    // Armazenar resultado de auth para uso no connection handler
    // Usar IP + timestamp como chave temporária
    const tempKey = `${info.req.socket?.remoteAddress}:${Date.now()}`;
    pendingAuthResults.set(tempKey, authResult);
    
    // Adicionar key ao request para recuperar no connection handler
    (info.req as unknown as { __authKey: string }).__authKey = tempKey;
    
    callback(true);
  },
});

// SEGURANÇA: Ping/Pong heartbeat para detectar conexões mortas (ws v8.18.3)
const HEARTBEAT_INTERVAL = 30000; // 30 segundos
const _CONNECTION_TIMEOUT = 35000; // 35 segundos (reservado para timeout de conexão)

interface ExtendedWebSocket extends WebSocket {
  isAlive?: boolean;
  userId?: string;
  tenantId?: string;
  role?: Role;
  clientKey?: string;
  // Trading subscriptions (17/12/2025)
  tradingSubscriptions?: Set<string>;
  // Observability: evitar double-decrement de gauges
  __activeSessionCounted?: boolean;
}

// Heartbeat para detectar conexões mortas
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    const extWs = ws as ExtendedWebSocket;
    if (extWs.isAlive === false) {
      logger.info({ userId: extWs.userId, tenantId: extWs.tenantId }, 'Terminando conexão WebSocket inativa (heartbeat timeout)');
      return extWs.terminate();
    }
    extWs.isAlive = false;
    extWs.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// ============================================================================
// TRADING BROADCAST (Redis Pub/Sub) - KuCoin real-time
// ============================================================================

type TradingBroadcastMessageType =
  | 'ticker'
  | 'orderbook'
  | 'klines'
  | 'trades'
  | 'orders'
  | 'positions'
  | 'balance'
  | 'control';

interface TradingBroadcastMessage {
  type: TradingBroadcastMessageType;
  symbol?: string;
  tenantId?: string;
  data: unknown;
  timestamp: number;
}

let tradingSubscriber: ReturnType<typeof createClient> | null = null;

function extractTradingSymbol(message: TradingBroadcastMessage): string | null {
  if (message.symbol) return message.symbol.toUpperCase();
  if (message.data && typeof message.data === 'object' && 'symbol' in message.data) {
    const value = (message.data as { symbol?: unknown }).symbol;
    if (typeof value === 'string' && value.trim()) {
      return value.trim().toUpperCase();
    }
  }
  return null;
}

function shouldDeliverTradingMessage(
  extWs: ExtendedWebSocket,
  message: TradingBroadcastMessage,
  symbol: string | null
): boolean {
  if (message.tenantId && extWs.tenantId && message.tenantId !== extWs.tenantId) {
    return false;
  }
  if (message.type === 'control') {
    return true;
  }
  if (!symbol || !extWs.tradingSubscriptions || extWs.tradingSubscriptions.size === 0) {
    return false;
  }
  return extWs.tradingSubscriptions.has(`${message.type}:${symbol}`);
}

function broadcastTradingMessage(message: TradingBroadcastMessage): void {
  const symbol = extractTradingSymbol(message);
  const payload = {
    type: `trading:${message.type}`,
    symbol: symbol ?? message.symbol,
    data: message.data,
    timestamp: message.timestamp,
  };

  wss.clients.forEach((client) => {
    const wsClient = client as ExtendedWebSocket;
    if (client.readyState !== WebSocket.OPEN) return;
    if (!shouldDeliverTradingMessage(wsClient, message, symbol)) return;
    client.send(JSON.stringify(payload));
  });
}

async function initializeTradingBroadcastSubscriber(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('REDIS_URL é obrigatório em produção para broadcast de trading');
    }
    logger.warn('REDIS_URL não configurado - broadcast de trading desabilitado (dev/test)');
    return;
  }

  tradingSubscriber = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
    },
  });

  tradingSubscriber.on('error', (error) => {
    logger.error({ error }, 'Erro no Redis subscriber de trading');
  });

  await tradingSubscriber.connect();

  await tradingSubscriber.pSubscribe(`${TRADING_CHANNEL_PREFIX}:*`, (message) => {
    try {
      const parsed = JSON.parse(message) as TradingBroadcastMessage;
      if (!parsed.type || !parsed.timestamp) {
        logger.warn({ message }, 'Mensagem de trading inválida recebida via Redis');
        return;
      }
      broadcastTradingMessage(parsed);
    } catch (error) {
      logger.error({ error, message }, 'Falha ao processar mensagem de trading');
    }
  });

  logger.info(
    { channels: Object.values(TRADING_CHANNELS).length },
    'Redis subscriber de trading inicializado'
  );
}

// ============================================================================
// IMAGE GENERATION DETECTION (Tarefa 133 - Detectar pedidos de geração de imagem)
// ============================================================================

interface ImageGenerationDetection {
  isImageRequest: boolean;
  prompt: string | null;
  confidence: number;
  reason: string;
}

interface ImageSearchDetection {
  isImageSearch: boolean;
  query: string | null;
  confidence: number;
  reason: string;
}

const IMAGE_KEYWORDS_PT = [
  'gere uma imagem',
  'crie uma imagem',
  'faça uma imagem',
  'gera uma imagem',
  'cria uma imagem',
  'faz uma imagem',
  'desenhe',
  'ilustre',
  'gerar imagem',
  'criar imagem',
  'fazer imagem',
  'gerar uma imagem',
  'criar uma imagem',
  'fazer uma imagem',
  'gerar uma arte',
  'criar uma arte',
  'fazer uma arte',
  'quero uma imagem',
  'preciso de uma imagem',
  'pode criar uma imagem',
  'pode gerar uma imagem',
  'pode fazer uma imagem',
  'pode criar uma arte',
  'pode gerar uma arte',
  'gere um',
  'crie um',
  'desenha',
  'desenhar',
  'ilustra',
  'ilustrar',
  'pintar',
  'renderize',
  'renderizar',
  'visualize',
  'mostre visualmente',
  'gerar uma foto',
  'criar uma foto',
  'gerar uma ilustração',
  'criar uma ilustração',
  'gere uma foto',
  'crie uma foto',
  'gere uma ilustração',
  'crie uma ilustração',
  'criar um logo',
  'crie um logo',
  'gerar um logo',
  'gere um logo',
  'criar logotipo',
  'crie logotipo',
  'gerar logotipo',
  'gere logotipo',
  'criar um banner',
  'crie um banner',
  'gerar um banner',
  'gere um banner',
  'criar uma capa',
  'crie uma capa',
  'gerar uma capa',
  'gere uma capa',
  'criar um avatar',
  'crie um avatar',
  'gerar um avatar',
  'gere um avatar',
  'criar um wallpaper',
  'crie um wallpaper',
  'gerar um wallpaper',
  'gere um wallpaper',
  'criar um ícone',
  'crie um ícone',
  'gerar um ícone',
  'gere um ícone',
  'criar um icone',
  'crie um icone',
  'gerar um icone',
  'gere um icone',
];

const IMAGE_KEYWORDS_EN = [
  'generate an image',
  'create an image',
  'make an image',
  'draw',
  'illustrate',
  'paint',
  'render',
  'generate image',
  'create image',
  'make image',
  'i want an image',
  'i need an image',
  'can you create an image',
  'generate a picture',
  'create a picture',
  'make a picture',
  'generate a',
  'create a picture',
  'draw me',
  'visualize',
  'show me visually',
  'generate a photo',
  'create a photo',
  'generate an illustration',
  'create an illustration',
  'create a logo',
  'generate a logo',
  'make a logo',
  'design a logo',
  'create a banner',
  'generate a banner',
  'make a banner',
  'create a cover',
  'generate a cover',
  'make a cover',
  'create an avatar',
  'generate an avatar',
  'make an avatar',
  'create a wallpaper',
  'generate a wallpaper',
  'make a wallpaper',
  'create an icon',
  'generate an icon',
  'make an icon',
];

const IMAGE_SEARCH_PATTERNS = [
  /\b(buscar|busque|pesquise|procure|encontre|traga|mostre)\s+(?:imagens|fotos|figuras|ilustrações|ilustracoes|ícones|icones|banners|capas|wallpapers|logos)\b/i,
  /\b(imagens|fotos|figuras|ilustrações|ilustracoes|ícones|icones|banners|capas|wallpapers|logos)\s+(?:na|no)\s+(?:internet|web|google|bing)\b/i,
  /\b(imagens|fotos|figuras|ilustrações|ilustracoes|ícones|icones)\s+online\b/i,
  /\b(search|find|look\s+up)\s+(?:images|photos|pictures|illustrations|icons|logos|banners|covers)\b/i,
  /\bgoogle\s+images\b/i,
];

const IMAGE_GENERATION_PATTERNS = [
  /(?:gere|crie|faça|desenhe|ilustre)\s+(?:uma?\s+)?(?:imagem|foto|ilustração|desenho)/i,
  /(?:gere|crie|faça|desenhe|ilustre|renderize|pinte)\s+(?:uma?\s+)?(?:arte|imagem|foto|ilustração|desenho)/i,
  /(?:generate|create|make|draw|illustrate)\s+(?:an?\s+)?(?:image|photo|illustration|drawing)/i,
  /(?:generate|create|make|draw|illustrate|render|paint)\s+(?:an?\s+)?(?:image|photo|illustration|drawing|artwork)/i,
  /(?:quero|preciso|gostaria)\s+(?:de\s+)?(?:ver|uma?\s+)?(?:imagem|foto|ilustração)/i,
  /(?:criar|crie|gerar|gere|desenhar|desenhe|fazer|faça)\s+(?:um[a]?\s+)?(?:logo|logotipo|banner|capa|avatar|wallpaper|ícone|icone)/i,
  /(?:create|generate|make|design|draw|render)\s+(?:an?\s+)?(?:logo|logotype|banner|cover|avatar|wallpaper|icon)/i,
];

const EXPLICIT_WEB_REQUEST_PATTERNS = [
  /\b(pesquis[ae]r?|buscar|busque|procure|consulte)\s+(na|no)\s+(web|internet|google|deep\s*web|deepweb)\b/i,
  /\b(search|look\s+up|google)\s+(on\s+)?(the\s+)?(web|internet)\b/i,
  /\bquero\s+que\s+você\s+(pesquise|busque)\b/i,
];

const EXPLICIT_DEEP_WEB_PATTERNS = [
  /\b(deep\s*web|deepweb|dark\s*web|darkweb)\b/i,
  /\b(onion|\.onion)\b/i,
  /\bpesquis[ae]r?\s+na\s+deep\s*web\b/i,
];

// ============================================================================
// AGENTIC TASK DETECTION (Documentos/Relatórios/Contabilidade/Planejamento)
// ============================================================================

const AGENTIC_TASK_CREATE_KEYWORDS = [
  'criar', 'gerar', 'produzir', 'elaborar', 'montar', 'redigir', 'preparar',
  'create', 'generate', 'produce', 'draft', 'prepare', 'write',
];

const AGENTIC_TASK_UPDATE_KEYWORDS = [
  'atualizar', 'editar', 'modificar', 'revisar', 'ajustar', 'corrigir',
  'update', 'edit', 'modify', 'revise',
];

const AGENTIC_TASK_INTENT_KEYWORDS = [
  'preciso de', 'quero', 'gostaria', 'necessito',
  'i need', 'i want', 'i would like',
];

const AGENTIC_TASK_TYPE_KEYWORDS: Record<AgenticTaskType, string[]> = {
  document: ['documento', 'document', 'memorando', 'minuta'],
  report: ['relatorio', 'relatório', 'report', 'relatório financeiro', 'relatorio financeiro'],
  accounting: ['contabilidade', 'balanco', 'balanço', 'demonstrativo', 'lancamento', 'lançamento', 'conciliacao', 'conciliação'],
  planning: ['planejamento', 'planejamento financeiro', 'plano', 'plan', 'roadmap', 'orcamento', 'orçamento'],
};

const DEFAULT_AGENTIC_DETECTORS: AgenticDetectors = {
  webSearch: {
    keywords: ['pesquisar', 'buscar', 'busque', 'procure', 'consulte', 'search', 'look up', 'google'],
    patterns: EXPLICIT_WEB_REQUEST_PATTERNS.map((pattern) => pattern.toString()),
  },
  deepWeb: {
    keywords: ['deep web', 'deepweb', 'dark web', 'darkweb', 'onion', '.onion'],
    patterns: EXPLICIT_DEEP_WEB_PATTERNS.map((pattern) => pattern.toString()),
  },
  webImageSearch: {
    keywords: ['imagens', 'fotos', 'figuras', 'google images', 'imagens na web', 'image search'],
    patterns: IMAGE_SEARCH_PATTERNS.map((pattern) => pattern.toString()),
  },
  imageGeneration: {
    keywords: [...IMAGE_KEYWORDS_PT, ...IMAGE_KEYWORDS_EN],
    patterns: IMAGE_GENERATION_PATTERNS.map((pattern) => pattern.toString()),
  },
  trading: {
    keywords: ['btc', 'bitcoin', 'trading', 'trade', 'ordem', 'order', 'posição', 'position', 'compra', 'venda', 'buy', 'sell', 'long', 'short', 'futures', 'perpetual', 'alavancagem', 'leverage', 'stop', 'profit', 'loss', 'mercado', 'market', 'kucoin', 'exchange', 'crypto', 'cripto', 'dólar', 'dollar'],
    patterns: [],
  },
  agenticTask: {
    createKeywords: AGENTIC_TASK_CREATE_KEYWORDS,
    updateKeywords: AGENTIC_TASK_UPDATE_KEYWORDS,
    intentKeywords: AGENTIC_TASK_INTENT_KEYWORDS,
    typeKeywords: {
      document: AGENTIC_TASK_TYPE_KEYWORDS.document,
      report: AGENTIC_TASK_TYPE_KEYWORDS.report,
      accounting: AGENTIC_TASK_TYPE_KEYWORDS.accounting,
      planning: AGENTIC_TASK_TYPE_KEYWORDS.planning,
    },
  },
  erp: {
    baseKeywords: ['erp', 'erpnext', 'estoque', 'inventario', 'inventory', 'fatura', 'invoice', 'cliente', 'customer'],
    listItemsKeywords: ['estoque', 'inventario', 'itens', 'items', 'inventory'],
    listCustomersKeywords: ['clientes', 'customers'],
    listInvoicesKeywords: ['faturas', 'invoices', 'invoice'],
    annualBillingKeywords: [
      'faturamento anual',
      'receita anual',
      'vendas anuais',
      'annual revenue',
      'annual billing',
      'yearly revenue',
      'yearly billing',
    ],
    createCustomerKeywords: ['criar cliente', 'cadastrar cliente', 'novo cliente'],
    createInvoiceKeywords: ['criar fatura', 'emitir fatura', 'criar invoice', 'emitir invoice'],
  },
  payments: {
    wiseKeywords: ['wise'],
    wiseRecipientsKeywords: ['destinatario', 'recipient'],
    wiseTransferKeywords: ['transferir', 'transferencia', 'transfer'],
    stripeKeywords: ['stripe'],
    stripePaymentKeywords: ['pagamento', 'payment'],
  },
  stackOps: {
    baseKeywords: ['deploy', 'rollback', 'stack'],
    deployKeywords: ['deploy'],
    rollbackKeywords: ['rollback'],
    dryRunKeywords: ['dry run', 'dry-run'],
    smartDeployKeywords: ['smart deploy', 'smart-deploy'],
    stackKeywords: ['infra', 'alice', 'observability', 'erpnext', 'backup', 'all'],
  },
};

const DETECTOR_LIST_MAX = 200;
const DETECTOR_ITEM_MAX_LENGTH = 160;

function normalizeDetectorList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((value) => String(value ?? '').trim())
    .filter((value) => value.length > 0)
    .filter((value) => value.length <= DETECTOR_ITEM_MAX_LENGTH)
    .slice(0, DETECTOR_LIST_MAX);
}

function normalizeDetectorGroup(
  input: Partial<AgenticDetectors['webSearch']> | null | undefined,
  fallback: AgenticDetectors['webSearch']
): AgenticDetectors['webSearch'] {
  return {
    keywords: normalizeDetectorList(input?.keywords ?? fallback.keywords),
    patterns: normalizeDetectorList(input?.patterns ?? fallback.patterns),
  };
}

function normalizeAgenticDetectors(detectors: Partial<AgenticDetectors> | null | undefined): AgenticDetectors {
  const safe = detectors ?? {};
  return {
    webSearch: normalizeDetectorGroup(safe.webSearch, DEFAULT_AGENTIC_DETECTORS.webSearch),
    deepWeb: normalizeDetectorGroup(safe.deepWeb, DEFAULT_AGENTIC_DETECTORS.deepWeb),
    webImageSearch: normalizeDetectorGroup(safe.webImageSearch, DEFAULT_AGENTIC_DETECTORS.webImageSearch),
    imageGeneration: normalizeDetectorGroup(safe.imageGeneration, DEFAULT_AGENTIC_DETECTORS.imageGeneration),
    trading: normalizeDetectorGroup(safe.trading, DEFAULT_AGENTIC_DETECTORS.trading),
    agenticTask: {
      createKeywords: normalizeDetectorList(safe.agenticTask?.createKeywords ?? DEFAULT_AGENTIC_DETECTORS.agenticTask.createKeywords),
      updateKeywords: normalizeDetectorList(safe.agenticTask?.updateKeywords ?? DEFAULT_AGENTIC_DETECTORS.agenticTask.updateKeywords),
      intentKeywords: normalizeDetectorList(safe.agenticTask?.intentKeywords ?? DEFAULT_AGENTIC_DETECTORS.agenticTask.intentKeywords),
      typeKeywords: {
        document: normalizeDetectorList(safe.agenticTask?.typeKeywords?.document ?? DEFAULT_AGENTIC_DETECTORS.agenticTask.typeKeywords.document),
        report: normalizeDetectorList(safe.agenticTask?.typeKeywords?.report ?? DEFAULT_AGENTIC_DETECTORS.agenticTask.typeKeywords.report),
        accounting: normalizeDetectorList(safe.agenticTask?.typeKeywords?.accounting ?? DEFAULT_AGENTIC_DETECTORS.agenticTask.typeKeywords.accounting),
        planning: normalizeDetectorList(safe.agenticTask?.typeKeywords?.planning ?? DEFAULT_AGENTIC_DETECTORS.agenticTask.typeKeywords.planning),
      },
    },
    erp: {
      baseKeywords: normalizeDetectorList(safe.erp?.baseKeywords ?? DEFAULT_AGENTIC_DETECTORS.erp.baseKeywords),
      listItemsKeywords: normalizeDetectorList(safe.erp?.listItemsKeywords ?? DEFAULT_AGENTIC_DETECTORS.erp.listItemsKeywords),
      listCustomersKeywords: normalizeDetectorList(safe.erp?.listCustomersKeywords ?? DEFAULT_AGENTIC_DETECTORS.erp.listCustomersKeywords),
      listInvoicesKeywords: normalizeDetectorList(safe.erp?.listInvoicesKeywords ?? DEFAULT_AGENTIC_DETECTORS.erp.listInvoicesKeywords),
      annualBillingKeywords: normalizeDetectorList(safe.erp?.annualBillingKeywords ?? DEFAULT_AGENTIC_DETECTORS.erp.annualBillingKeywords),
      createCustomerKeywords: normalizeDetectorList(safe.erp?.createCustomerKeywords ?? DEFAULT_AGENTIC_DETECTORS.erp.createCustomerKeywords),
      createInvoiceKeywords: normalizeDetectorList(safe.erp?.createInvoiceKeywords ?? DEFAULT_AGENTIC_DETECTORS.erp.createInvoiceKeywords),
    },
    payments: {
      wiseKeywords: normalizeDetectorList(safe.payments?.wiseKeywords ?? DEFAULT_AGENTIC_DETECTORS.payments.wiseKeywords),
      wiseRecipientsKeywords: normalizeDetectorList(safe.payments?.wiseRecipientsKeywords ?? DEFAULT_AGENTIC_DETECTORS.payments.wiseRecipientsKeywords),
      wiseTransferKeywords: normalizeDetectorList(safe.payments?.wiseTransferKeywords ?? DEFAULT_AGENTIC_DETECTORS.payments.wiseTransferKeywords),
      stripeKeywords: normalizeDetectorList(safe.payments?.stripeKeywords ?? DEFAULT_AGENTIC_DETECTORS.payments.stripeKeywords),
      stripePaymentKeywords: normalizeDetectorList(safe.payments?.stripePaymentKeywords ?? DEFAULT_AGENTIC_DETECTORS.payments.stripePaymentKeywords),
    },
    stackOps: {
      baseKeywords: normalizeDetectorList(safe.stackOps?.baseKeywords ?? DEFAULT_AGENTIC_DETECTORS.stackOps.baseKeywords),
      deployKeywords: normalizeDetectorList(safe.stackOps?.deployKeywords ?? DEFAULT_AGENTIC_DETECTORS.stackOps.deployKeywords),
      rollbackKeywords: normalizeDetectorList(safe.stackOps?.rollbackKeywords ?? DEFAULT_AGENTIC_DETECTORS.stackOps.rollbackKeywords),
      dryRunKeywords: normalizeDetectorList(safe.stackOps?.dryRunKeywords ?? DEFAULT_AGENTIC_DETECTORS.stackOps.dryRunKeywords),
      smartDeployKeywords: normalizeDetectorList(safe.stackOps?.smartDeployKeywords ?? DEFAULT_AGENTIC_DETECTORS.stackOps.smartDeployKeywords),
      stackKeywords: normalizeDetectorList(safe.stackOps?.stackKeywords ?? DEFAULT_AGENTIC_DETECTORS.stackOps.stackKeywords),
    },
  };
}

function compileDetectorPattern(pattern: string): RegExp | null {
  const trimmed = pattern.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
    const lastSlash = trimmed.lastIndexOf('/');
    const body = trimmed.slice(1, lastSlash);
    const flags = trimmed.slice(lastSlash + 1) || 'i';
    try {
      return new RegExp(body, flags);
    } catch {
      return null;
    }
  }
  try {
    return new RegExp(trimmed, 'i');
  } catch {
    return null;
  }
}

function matchesDetector(message: string, detector: AgenticDetectors['webSearch']): boolean {
  const normalized = normalizeForAgenticDetection(message);
  if (!normalized) return false;
  const keywordMatch = detector.keywords.some((keyword) => normalized.includes(normalizeForAgenticDetection(keyword)));
  if (keywordMatch) return true;
  return detector.patterns.some((pattern) => {
    const compiled = compileDetectorPattern(pattern);
    return compiled ? compiled.test(message) : false;
  });
}

function isTradingCommandWithDetectors(message: string, detectors: AgenticDetectors): boolean {
  const hasCustomDetectors = detectors.trading.keywords.length > 0 || detectors.trading.patterns.length > 0;
  if (!hasCustomDetectors) {
    return false;
  }
  if (!matchesDetector(message, detectors.trading)) {
    return false;
  }
  return isTradingCommand(message);
}

function detectImageGenerationRequest(message: string, detectors: AgenticDetectors): ImageGenerationDetection {
  const lowerMessage = message.toLowerCase().trim();
  const normalizedMessage = normalizeForAgenticDetection(message);
  
  for (const keyword of detectors.imageGeneration.keywords) {
    const keywordLower = keyword.toLowerCase();
    const keywordNormalized = normalizeForAgenticDetection(keyword);
    if (lowerMessage.includes(keywordLower) || normalizedMessage.includes(keywordNormalized)) {
      const prompt = extractImagePrompt(message, keyword);
      return {
        isImageRequest: true,
        prompt,
        confidence: 0.95,
        reason: `Detectado keyword: "${keyword}"`,
      };
    }
  }

  if (matchesDetector(message, detectors.imageGeneration)) {
    for (const pattern of detectors.imageGeneration.patterns) {
      const compiled = compileDetectorPattern(pattern);
      if (!compiled) continue;
      if (compiled.test(message)) {
        return {
          isImageRequest: true,
          prompt: message,
          confidence: 0.85,
          reason: 'Detectado padrão visual configurado',
        };
      }
    }

    for (const pattern of IMAGE_GENERATION_PATTERNS) {
      if (pattern.test(message)) {
        return {
          isImageRequest: true,
          prompt: message,
          confidence: 0.85,
          reason: 'Detectado padrão visual regex',
        };
      }
    }

    if (detectors.imageGeneration.keywords.length > 0) {
      return {
        isImageRequest: true,
        prompt: message,
        confidence: 0.75,
        reason: 'Detectado keyword configurado sem padrão específico',
      };
    }
  }
  
  return {
    isImageRequest: false,
    prompt: null,
    confidence: 0,
    reason: 'Nenhum padrão de geração de imagem detectado',
  };
}

function extractImagePrompt(message: string, keyword: string): string {
  const lowerMessage = message.toLowerCase();
  const keywordIndex = lowerMessage.indexOf(keyword.toLowerCase());
  
  if (keywordIndex !== -1) {
    const afterKeyword = message.slice(keywordIndex + keyword.length).trim();
    if (afterKeyword.length > 5) {
      return afterKeyword.replace(/^(de|of|:|\s)+/i, '').trim();
    }
  }
  
  return message;
}

function detectImageSearchRequest(message: string, detectors: AgenticDetectors): ImageSearchDetection {
  const normalized = message.trim();
  if (!normalized) {
    return {
      isImageSearch: false,
      query: null,
      confidence: 0,
      reason: 'Mensagem vazia',
    };
  }

  if (!matchesDetector(message, detectors.webImageSearch)) {
    return {
      isImageSearch: false,
      query: null,
      confidence: 0,
      reason: 'Nenhum padrão de busca de imagens detectado',
    };
  }

  const cleaned = normalized
    .replace(/^(buscar|busque|pesquise|procure|encontre|traga|mostre)\s+/i, '')
    .replace(/\b(imagens|fotos|figuras|ilustrações|ilustracoes|ícones|icones|banners|capas|wallpapers|logos)\b/gi, '')
    .replace(/\b(na|no|em)\b/gi, ' ')
    .replace(/\b(internet|web|online|google|bing)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    isImageSearch: true,
    query: cleaned.length > 2 ? cleaned : normalized,
    confidence: 0.85,
    reason: 'Detectado padrão de busca de imagens na web',
  };
}

function normalizeForAgenticDetection(message: string): string {
  return message
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function extractAgenticTitle(message: string): string | null {
  const titleMatch = message.match(/t[ií]tulo\s*:\s*(.+)$/i);
  if (!titleMatch || !titleMatch[1]) {
    return null;
  }
  return titleMatch[1].trim();
}

function detectAgenticTaskRequest(message: string, detectors: AgenticDetectors): AgenticTaskDetection {
  const normalized = normalizeForAgenticDetection(message);
  if (!normalized) {
    return { isTaskRequest: false, reason: 'Mensagem vazia' };
  }

  let detectedType: AgenticTaskType | undefined;
  for (const [taskType, keywords] of Object.entries(detectors.agenticTask.typeKeywords)) {
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      detectedType = taskType as AgenticTaskType;
      break;
    }
  }

  if (!detectedType) {
    return { isTaskRequest: false, reason: 'Nenhum tipo de tarefa detectado' };
  }

  const hasCreateIntent = detectors.agenticTask.createKeywords.some((keyword) => normalized.includes(keyword));
  const hasUpdateIntent = detectors.agenticTask.updateKeywords.some((keyword) => normalized.includes(keyword));
  const hasGenericIntent = detectors.agenticTask.intentKeywords.some((keyword) => normalized.includes(keyword));

  if (!hasCreateIntent && !hasUpdateIntent && !hasGenericIntent) {
    return { isTaskRequest: false, reason: 'Sem intenção explícita de tarefa' };
  }

  const uuidMatch = message.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  const title = extractAgenticTitle(message);

  return {
    isTaskRequest: true,
    taskType: detectedType,
    mode: hasUpdateIntent ? 'update' : 'create',
    title: title ?? undefined,
    instructions: message.trim(),
    documentId: uuidMatch?.[0],
    reason: `Tipo detectado: ${detectedType}`,
  };
}

// ============================================================================
// AGENTIC INTEGRATIONS - ERPNext / Pagamentos / Stack Ops / Links
// ============================================================================

type ErpCommand =
  | { type: 'list_items' }
  | { type: 'list_customers' }
  | { type: 'list_invoices' }
  | { type: 'annual_billing'; payload: { customerName: string; year: number }; missing?: string[] }
  | { type: 'create_customer'; payload: { customerName: string; customerType: string; territory: string; email?: string; phone?: string; taxId?: string }; missing?: string[] }
  | { type: 'create_invoice'; payload: { customer: string; items: Array<{ itemCode: string; qty: number; rate: number }>; dueDate?: string }; missing?: string[] };

type PaymentCommand =
  | { type: 'wise_recipients' }
  | { type: 'wise_transfer'; payload: { sourceCurrency: string; targetCurrency: string; sourceAmount: number; recipientId: string; reference?: string }; missing?: string[] }
  | { type: 'stripe_payment_intent'; payload: { amount: number; currency: string; description?: string }; missing?: string[] };

type StackCommand =
  | { type: 'deploy'; stack: 'infra' | 'alice' | 'observability' | 'erpnext' | 'backup' | 'all'; version?: string; dryRun?: boolean; smartDeploy?: boolean }
  | { type: 'rollback'; stack: 'infra' | 'alice' | 'observability' | 'erpnext' | 'backup' | 'all'; version: string; rollbackVersion?: string };

function extractField(message: string, label: string): string | null {
  const regex = new RegExp(`${label}\\s*[:=]\\s*([^\\n]+)`, 'i');
  const match = message.match(regex);
  return match?.[1]?.trim() ?? null;
}

function extractInlineField(message: string, label: string): string | null {
  const regex = new RegExp(`${label}\\s+([^\\n]+)`, 'i');
  const match = message.match(regex);
  return match?.[1]?.trim() ?? null;
}

function normalizeCustomerName(raw: string | null): string | null {
  if (!raw) return null;
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/\s+(ano|year)\s+\d{4}\b.*$/i, '').trim();
  cleaned = cleaned.replace(/\s+em\s+\d{4}\b.*$/i, '').trim();
  return cleaned.length > 0 ? cleaned : null;
}

function extractCustomerName(message: string): string | null {
  const candidate = extractField(message, 'cliente')
    ?? extractInlineField(message, 'cliente')
    ?? extractField(message, 'customer')
    ?? extractInlineField(message, 'customer');
  return normalizeCustomerName(candidate);
}

function extractYearFromMessage(message: string): number | null {
  const match = message.match(/\b(20\d{2})\b/);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractJsonField(message: string, label: string): unknown | null {
  const regex = new RegExp(`${label}\\s*[:=]\\s*(\\{[\\s\\S]+\\}|\\[[\\s\\S]+\\])`, 'i');
  const match = message.match(regex);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function detectErpCommand(message: string, detectors: AgenticDetectors): ErpCommand | null {
  const normalized = normalizeForAgenticDetection(message);
  if (!normalized) return null;

  const erpDetectors = detectors.erp;
  if (erpDetectors.annualBillingKeywords.some((keyword) => normalized.includes(keyword))) {
    const customerName = extractCustomerName(message);
    const year = extractYearFromMessage(message) ?? new Date().getFullYear();
    const missing = [
      !customerName ? 'cliente' : null,
    ].filter(Boolean) as string[];
    return {
      type: 'annual_billing',
      payload: {
        customerName: customerName ?? '',
        year,
      },
      missing: missing.length ? missing : undefined,
    };
  }

  if (erpDetectors.baseKeywords.some((keyword) => normalized.includes(keyword))) {
    if (erpDetectors.listItemsKeywords.some((keyword) => normalized.includes(keyword))) {
      return { type: 'list_items' };
    }
    if (erpDetectors.listCustomersKeywords.some((keyword) => normalized.includes(keyword))) {
      return { type: 'list_customers' };
    }
    if (erpDetectors.listInvoicesKeywords.some((keyword) => normalized.includes(keyword))) {
      return { type: 'list_invoices' };
    }
  }

  if (erpDetectors.createCustomerKeywords.some((keyword) => normalized.includes(keyword))) {
    const customerName = extractField(message, 'nome') ?? extractCustomerName(message);
    const customerType = extractField(message, 'tipo');
    const territory = extractField(message, 'territorio') ?? extractField(message, 'território');
    const email = extractField(message, 'email') ?? undefined;
    const phone = extractField(message, 'telefone') ?? undefined;
    const taxId = extractField(message, 'cpf') ?? extractField(message, 'cnpj') ?? undefined;
    const missing = [
      !customerName ? 'nome' : null,
      !customerType ? 'tipo' : null,
      !territory ? 'territorio' : null,
    ].filter(Boolean) as string[];
    return {
      type: 'create_customer',
      payload: {
        customerName: customerName ?? '',
        customerType: customerType ?? '',
        territory: territory ?? '',
        email,
        phone,
        taxId,
      },
      missing: missing.length ? missing : undefined,
    };
  }

  if (erpDetectors.createInvoiceKeywords.some((keyword) => normalized.includes(keyword))) {
    const customer = extractCustomerName(message);
    const itemsRaw = extractJsonField(message, 'itens') ?? extractJsonField(message, 'items');
    const dueDate = extractField(message, 'vencimento') ?? extractField(message, 'due_date') ?? undefined;
    const items = Array.isArray(itemsRaw)
      ? itemsRaw.map((item) => ({
          itemCode: (item as { item_code?: string; itemCode?: string }).itemCode || (item as { item_code?: string }).item_code || '',
          qty: Number((item as { qty?: number }).qty),
          rate: Number((item as { rate?: number }).rate),
        })).filter((item) => item.itemCode && Number.isFinite(item.qty) && Number.isFinite(item.rate))
      : [];
    const missing = [
      !customer ? 'cliente' : null,
      items.length === 0 ? 'itens' : null,
    ].filter(Boolean) as string[];
    return {
      type: 'create_invoice',
      payload: {
        customer: customer ?? '',
        items,
        dueDate,
      },
      missing: missing.length ? missing : undefined,
    };
  }

  return null;
}

function detectErpIntent(message: string, detectors: AgenticDetectors): boolean {
  const normalized = normalizeForAgenticDetection(message);
  if (!normalized) return false;
  const erpDetectors = detectors.erp;
  const candidateLists = [
    erpDetectors.baseKeywords,
    erpDetectors.listItemsKeywords,
    erpDetectors.listCustomersKeywords,
    erpDetectors.listInvoicesKeywords,
    erpDetectors.annualBillingKeywords,
    erpDetectors.createCustomerKeywords,
    erpDetectors.createInvoiceKeywords,
  ];
  return candidateLists.some((list) => list.some((keyword) => normalized.includes(keyword)));
}

function isErpWriteCommand(command: ErpCommand): command is Extract<ErpCommand, { type: 'create_customer' | 'create_invoice' }> {
  return command.type === 'create_customer' || command.type === 'create_invoice';
}

function buildErpCommandSummary(command: ErpCommand): string {
  if (command.type === 'create_customer') {
    return `ERPNext: criar cliente (${command.payload.customerName || 'sem nome'})`;
  }
  if (command.type === 'create_invoice') {
    const itemCount = command.payload.items?.length ?? 0;
    return `ERPNext: criar fatura (${command.payload.customer} | ${itemCount} itens)`;
  }
  if (command.type === 'annual_billing') {
    return `ERPNext: faturamento anual (${command.payload.customerName || 'sem nome'} | ${command.payload.year})`;
  }
  return 'ERPNext: operação';
}

async function executeErpCommand(params: {
  command: ErpCommand;
  auth: AuthContext;
}): Promise<{ responseContent: string; integrationResult: unknown }> {
  const { command, auth } = params;
  let responseContent = 'Ação ERPNext concluída com sucesso.';
  let integrationResult: unknown = null;

  if (command.type === 'list_items') {
    const result = await callIntegrationsService<{ items: Array<Record<string, unknown>> }>({
      endpoint: '/api/integrations/erpnext/items',
      method: 'GET',
      auth,
    });
    const items = result.items.slice(0, 10).map((item) => {
      const name = String(item.item_name ?? item.name ?? '');
      const group = String(item.item_group ?? '');
      const rate = item.standard_rate ?? '';
      return `- ${name}${group ? ` (${group})` : ''}${rate ? ` - ${rate}` : ''}`;
    });
    responseContent = items.length
      ? `Itens do ERPNext (top 10):\n${items.join('\n')}`
      : 'Nenhum item encontrado no ERPNext.';
    integrationResult = result;
  }

  if (command.type === 'list_customers') {
    const result = await callIntegrationsService<{ customers: Array<Record<string, unknown>> }>({
      endpoint: '/api/integrations/erpnext/customers',
      method: 'GET',
      auth,
    });
    const customers = result.customers.slice(0, 10).map((customer) => {
      const name = String(customer.customer_name ?? customer.name ?? '');
      const type = String(customer.customer_type ?? '');
      return `- ${name}${type ? ` (${type})` : ''}`;
    });
    responseContent = customers.length
      ? `Clientes do ERPNext (top 10):\n${customers.join('\n')}`
      : 'Nenhum cliente encontrado no ERPNext.';
    integrationResult = result;
  }

  if (command.type === 'list_invoices') {
    const result = await callIntegrationsService<{ invoices: Array<Record<string, unknown>> }>({
      endpoint: '/api/integrations/erpnext/invoices',
      method: 'GET',
      auth,
    });
    const invoices = result.invoices.slice(0, 10).map((invoice) => {
      const name = String(invoice.name ?? '');
      const customer = String(invoice.customer ?? '');
      const total = invoice.grand_total ?? '';
      const status = String(invoice.status ?? '');
      return `- ${name} | ${customer} | ${total} | ${status}`;
    });
    responseContent = invoices.length
      ? `Faturas do ERPNext (top 10):\n${invoices.join('\n')}`
      : 'Nenhuma fatura encontrada no ERPNext.';
    integrationResult = result;
  }

  if (command.type === 'annual_billing') {
    const customerParam = encodeURIComponent(command.payload.customerName);
    const yearParam = encodeURIComponent(String(command.payload.year));
    const result = await callIntegrationsService<{
      customer: string;
      year: number;
      total: number;
      currency: string;
      invoiceCount: number;
    }>({
      endpoint: `/api/integrations/erpnext/customer-annual-billing?customer=${customerParam}&year=${yearParam}`,
      method: 'GET',
      auth,
    });
    const currency = result.currency || 'BRL';
    let formattedTotal = `${result.total}`;
    try {
      formattedTotal = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency,
      }).format(result.total);
    } catch {
      formattedTotal = `${result.total} ${currency}`;
    }
    responseContent = `Faturamento anual do cliente ${result.customer} em ${result.year}: ${formattedTotal}. ` +
      `Total de faturas consideradas: ${result.invoiceCount}.`;
    integrationResult = result;
  }

  if (command.type === 'create_customer') {
    const result = await callIntegrationsService<{ customer: Record<string, unknown> }>({
      endpoint: '/api/integrations/erpnext/customers',
      method: 'POST',
      body: command.payload,
      auth,
    });
    responseContent = `Cliente criado no ERPNext: ${command.payload.customerName}.`;
    integrationResult = result;
  }

  if (command.type === 'create_invoice') {
    const result = await callIntegrationsService<{ invoice: Record<string, unknown> }>({
      endpoint: '/api/integrations/erpnext/invoices',
      method: 'POST',
      body: command.payload,
      auth,
    });
    responseContent = `Fatura criada no ERPNext para ${command.payload.customer}.`;
    integrationResult = result;
  }

  return { responseContent, integrationResult };
}

function detectPaymentCommand(message: string, detectors: AgenticDetectors): PaymentCommand | null {
  const normalized = normalizeForAgenticDetection(message);
  if (!normalized) return null;

  const paymentDetectors = detectors.payments;
  if (
    paymentDetectors.wiseKeywords.some((keyword) => normalized.includes(keyword))
    && paymentDetectors.wiseRecipientsKeywords.some((keyword) => normalized.includes(keyword))
  ) {
    return { type: 'wise_recipients' };
  }

  if (
    paymentDetectors.wiseKeywords.some((keyword) => normalized.includes(keyword))
    && paymentDetectors.wiseTransferKeywords.some((keyword) => normalized.includes(keyword))
  ) {
    const sourceCurrency = (extractField(message, 'moeda_origem') ?? extractField(message, 'source_currency') ?? '').toUpperCase();
    const targetCurrency = (extractField(message, 'moeda_destino') ?? extractField(message, 'target_currency') ?? '').toUpperCase();
    const amountRaw = extractField(message, 'valor') ?? extractField(message, 'amount');
    const recipientId = extractField(message, 'destinatario_id') ?? extractField(message, 'recipient_id') ?? '';
    const reference = extractField(message, 'referencia') ?? extractField(message, 'reference') ?? undefined;
    const sourceAmount = amountRaw ? Number(amountRaw.replace(',', '.')) : NaN;
    const missing = [
      !sourceCurrency ? 'moeda_origem' : null,
      !targetCurrency ? 'moeda_destino' : null,
      !Number.isFinite(sourceAmount) ? 'valor' : null,
      !recipientId ? 'destinatario_id' : null,
    ].filter(Boolean) as string[];
    return {
      type: 'wise_transfer',
      payload: {
        sourceCurrency,
        targetCurrency,
        sourceAmount: Number.isFinite(sourceAmount) ? sourceAmount : 0,
        recipientId,
        reference,
      },
      missing: missing.length ? missing : undefined,
    };
  }

  if (
    paymentDetectors.stripeKeywords.some((keyword) => normalized.includes(keyword))
    && paymentDetectors.stripePaymentKeywords.some((keyword) => normalized.includes(keyword))
  ) {
    const amountRaw = extractField(message, 'valor') ?? extractField(message, 'amount');
    const currency = (extractField(message, 'moeda') ?? extractField(message, 'currency') ?? '').toUpperCase();
    const description = extractField(message, 'descricao') ?? extractField(message, 'description') ?? undefined;
    const amount = amountRaw ? Number(amountRaw.replace(',', '.')) : NaN;
    const missing = [
      !Number.isFinite(amount) ? 'valor' : null,
      !currency ? 'moeda' : null,
    ].filter(Boolean) as string[];
    return {
      type: 'stripe_payment_intent',
      payload: {
        amount: Number.isFinite(amount) ? amount : 0,
        currency,
        description,
      },
      missing: missing.length ? missing : undefined,
    };
  }

  return null;
}

function detectStackCommand(message: string, detectors: AgenticDetectors): StackCommand | null {
  const normalized = normalizeForAgenticDetection(message);
  if (!normalized) return null;

  const stackDetectors = detectors.stackOps;
  if (!stackDetectors.baseKeywords.some((keyword) => normalized.includes(keyword))) {
    return null;
  }

  const stackKeywordPattern = stackDetectors.stackKeywords.length > 0
    ? new RegExp(`\\b(${stackDetectors.stackKeywords.join('|')})\\b`, 'i')
    : null;
  const stackMatch = stackKeywordPattern ? normalized.match(stackKeywordPattern) : null;
  const versionMatch = message.match(/\bv\d+\.\d+\.\d+(?:[-.][\w.]+)?\b/i);
  const stack = (stackMatch?.[1]?.toLowerCase() || 'alice') as StackCommand['stack'];
  const dryRun = stackDetectors.dryRunKeywords.some((keyword) => normalized.includes(keyword));
  const smartDeploy = stackDetectors.smartDeployKeywords.some((keyword) => normalized.includes(keyword));

  if (stackDetectors.rollbackKeywords.some((keyword) => normalized.includes(keyword))) {
    const rollbackVersionMatch = message.match(/\brollback\s+v\d+\.\d+\.\d+(?:[-.][\w.]+)?\b/i);
    const rollbackVersion = rollbackVersionMatch?.[0]?.replace(/^rollback\s+/i, '');
    return {
      type: 'rollback',
      stack,
      version: versionMatch?.[0] || '',
      rollbackVersion,
    };
  }

  if (stackDetectors.deployKeywords.some((keyword) => normalized.includes(keyword))) {
    return {
      type: 'deploy',
      stack,
      version: versionMatch?.[0],
      dryRun,
      smartDeploy,
    };
  }

  return null;
}

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
const SUPPORTED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4'] as const;

function resolveSupportedMediaType(mimeType: string): 'image' | 'audio' | null {
  const normalizedMimeType = mimeType.toLowerCase().trim().split(';')[0].trim();
  if (SUPPORTED_IMAGE_TYPES.includes(normalizedMimeType as typeof SUPPORTED_IMAGE_TYPES[number])) {
    return 'image';
  }
  if (SUPPORTED_AUDIO_TYPES.includes(normalizedMimeType as typeof SUPPORTED_AUDIO_TYPES[number])) {
    return 'audio';
  }
  return null;
}

type ActionConfirmationIntent = 'approve' | 'reject';

const ACTION_CONFIRMATION_PATTERNS = {
  approve: [
    /\b(confirmar|confirmo|confirmado|aprovar|aprovado|prosseguir|execute|executar|pode\s+executar|pode\s+prosseguir|ok|pode\s+seguir|sim)\b/i,
  ],
  reject: [
    /\b(cancelar|cancele|cancelado|rejeitar|rejeito|negado|negar|pare|abortar|não|nao|stop)\b/i,
  ],
};

function resolveActionConfirmationIntent(message: string): ActionConfirmationIntent | null {
  const normalized = message.trim();
  if (!normalized) return null;
  const shortInput = normalized.length <= 32;
  if (!shortInput) {
    if (ACTION_CONFIRMATION_PATTERNS.approve.some((pattern) => pattern.test(normalized))) {
      return 'approve';
    }
    if (ACTION_CONFIRMATION_PATTERNS.reject.some((pattern) => pattern.test(normalized))) {
      return 'reject';
    }
    return null;
  }
  if (ACTION_CONFIRMATION_PATTERNS.approve.some((pattern) => pattern.test(normalized))) {
    return 'approve';
  }
  if (ACTION_CONFIRMATION_PATTERNS.reject.some((pattern) => pattern.test(normalized))) {
    return 'reject';
  }
  return null;
}

function isExplicitWebRequest(message: string, detectors: AgenticDetectors): boolean {
  return matchesDetector(message, detectors.webSearch);
}

function isExplicitDeepWebRequest(message: string, detectors: AgenticDetectors): boolean {
  return matchesDetector(message, detectors.deepWeb);
}

type ImageGenerationInput = {
  tenantId: string;
  userId: string;
  prompt: string;
  negativePrompt?: string | null;
  width?: number;
  height?: number;
  conversationId?: string | null;
  messageId?: string | null;
  internalHeaders?: Record<string, string>;
};

async function fetchImageUrlAsBase64(imageUrl: string): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(imageUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Falha ao baixar imagem OpenAI (url): ${response.status} - ${errText}`);
  }

  const contentType = response.headers.get('content-type') || 'image/png';
  if (!contentType.startsWith('image/')) {
    throw new Error(`Conteúdo inválido ao baixar imagem OpenAI: ${contentType}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return { base64: buffer.toString('base64'), mimeType: contentType };
}

async function fetchExternalImageAsBase64(
  imageUrl: string,
  maxBytes: number
): Promise<{ base64: string; mimeType: string; size: number }> {
  const response = await fetch(imageUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Falha ao baixar imagem externa: ${response.status} - ${errText}`);
  }

  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  if (!contentType.startsWith('image/')) {
    throw new Error(`Conteúdo inválido ao baixar imagem externa: ${contentType}`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const parsed = Number(contentLength);
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      throw new Error('Imagem externa excede o limite de tamanho configurado');
    }
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new Error('Imagem externa excede o limite de tamanho configurado');
  }

  return {
    base64: buffer.toString('base64'),
    mimeType: contentType,
    size: buffer.length,
  };
}

function buildWebImageFilename(imageUrl: string, index: number, mimeType: string): string {
  try {
    const url = new URL(imageUrl);
    const pathname = url.pathname.split('/').filter(Boolean).pop();
    if (pathname && pathname.length >= 3) {
      return pathname;
    }
  } catch {
    // Ignorar falha de parse, usar fallback abaixo
  }

  const extension = mimeType.split('/')[1] || 'png';
  return `web-image-${index + 1}.${extension}`;
}

async function generateImageFromPrompt(input: ImageGenerationInput) {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI não configurado - geração de imagens indisponível');
  }

  const width = input.width ?? 1024;
  const height = input.height ?? 1024;
  const size = `${width}x${height}`;
  const composedPrompt = input.negativePrompt && input.negativePrompt.trim().length > 0
    ? `${input.prompt}\n\nNegative prompt: ${input.negativePrompt}`
    : input.prompt;

  const [created] = await db.insert(schema.generatedImages).values({
    tenantId: input.tenantId,
    createdBy: input.userId,
    conversationId: input.conversationId ?? undefined,
    messageId: input.messageId ?? undefined,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt ?? null,
    model: 'gpt-image-1',
    width,
    height,
    status: 'generating',
    approvedForTraining: false,
    usedInFineTuning: false,
    metadata: {
      provider: 'openai',
      api: 'images',
    },
  }).returning();

  if (!created) {
    throw new Error('Falha ao criar registro de geração de imagem');
  }

  const startedAt = Date.now();

  try {
    logger.info({
      imageId: created.id,
      tenantId: input.tenantId,
      size,
      promptLength: input.prompt.length,
    }, 'Iniciando geração de imagem via OpenAI');
    const basePayload = {
      model: 'gpt-image-1',
      prompt: composedPrompt,
      size,
      n: 1,
      output_format: 'png',
    };

    const tryGenerateImage = async (payload: Record<string, unknown>) => {
      const response = await fetch(
        'https://api.openai.com/v1/images/generations',
        withOpenAiDispatcher({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(120000),
        })
      );
      return response;
    };

    const openAiResponse = await tryGenerateImage(basePayload);
    if (!openAiResponse.ok) {
      const errText = await openAiResponse.text().catch(() => '');
      logger.error({
        status: openAiResponse.status,
        requestId: openAiResponse.headers.get('x-request-id'),
        error: errText,
      }, 'OpenAI Images API retornou erro');
      throw new Error(`OpenAI Images error: ${openAiResponse.status} - ${errText}`);
    }

    const payload = await openAiResponse.json() as { data?: Array<{ b64_json?: string; url?: string }> };
    const first = payload?.data?.[0];
    let b64 = first?.b64_json;
    let resolvedMimeType = 'image/png';

    if (!b64 && first?.url) {
      const downloaded = await fetchImageUrlAsBase64(first.url);
      b64 = downloaded.base64;
      resolvedMimeType = downloaded.mimeType;
    }

    if (!b64 || typeof b64 !== 'string' || b64.length < 64) {
      logger.error({
        status: openAiResponse.status,
        requestId: openAiResponse.headers.get('x-request-id'),
        payload,
      }, 'Resposta inválida da OpenAI Images API (b64_json/url ausentes)');
      throw new Error('Resposta inválida da OpenAI Images API (b64_json/url ausentes)');
    }

    const filename = `generated-${created.id}.png`;
    const uploadResult = await uploadMediaToRAG(
      b64,
      filename,
      resolvedMimeType,
      input.tenantId,
      input.prompt,
      input.messageId ?? undefined,
      input.conversationId ?? undefined,
      input.internalHeaders,
    );

    if (!uploadResult?.fileUrl) {
      throw new Error('Falha ao persistir imagem no RAG Service');
    }

    const generationTimeMs = Date.now() - startedAt;

    await db.update(schema.generatedImages)
      .set({
        status: 'completed',
        imageUrl: uploadResult.fileUrl,
        thumbnailPath: uploadResult.thumbnailUrl ?? null,
        generationTimeMs,
        errorMessage: null,
        metadata: {
          ...(created.metadata ?? {}),
          openai: { model: 'gpt-image-1', size },
        },
      })
      .where(eq(schema.generatedImages.id, created.id));

    const updated = await db.query.generatedImages.findFirst({
      where: eq(schema.generatedImages.id, created.id),
    });

    if (!updated) {
      throw new Error('Falha ao buscar registro atualizado da imagem gerada');
    }

    return updated;
  } catch (error) {
    const generationTimeMs = Date.now() - startedAt;
    await db.update(schema.generatedImages)
      .set({
        status: 'failed',
        generationTimeMs,
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      .where(eq(schema.generatedImages.id, created.id));
    throw error;
  }
}

// ============================================================================
// SYSTEM PROMPT DINÂMICO - Configurável via Dashboard Admin (02/01/2026)
// Regra 6 CLAUDE.md: Sem hardcoded - usa instruções do agente quando disponível
// ============================================================================

/**
 * Interface do agente para type safety no system prompt
 */
interface AgentConfig {
  instrucoes?: string | null;
  personalidade?: string | null;
  modeloBase?: string | null;
  temperaturaModelo?: number | null;
  maxTokens?: number | null;
  namespaceId?: string | null;
}

type ConversationWithAgent = typeof schema.conversations.$inferSelect & {
  agent?: AgentConfig | null;
};

interface AssistantSettings {
  systemPrompt?: string | null;
  creatorName?: string | null;
  creatorRule?: string | null;
  ethicsPolicy?: string | null;
  moralPolicy?: string | null;
  legalPolicy?: string | null;
  safetyGuardrails?: string | null;
  nsfwPolicy?: string | null;
  behavior?: string | null;
  mood?: string | null;
  behaviorDirectness?: number | null;
  behaviorProactivity?: number | null;
  moodFormality?: number | null;
  moodEmpathy?: number | null;
  typingSpeedMs?: number | null;
}

/**
 * System prompt padrão usado quando não há agente configurado
 * ou quando o agente não tem instruções definidas.
 * 
 * IMPORTANTE: O prompt instrui a IA a detectar o idioma do usuário
 * e responder no mesmo idioma (não mais hardcoded em português).
 */
const DEFAULT_SYSTEM_PROMPT = `Você é Alice, uma assistente de IA enterprise inteligente e confiável.

REGRAS DE IDIOMA (OBRIGATÓRIO):
- Detecte o idioma da mensagem do usuário
- Responda EXCLUSIVAMENTE no MESMO idioma do usuário
- Não misture idiomas na mesma resposta

GUIDELINES DE COMPORTAMENTO:
- Seja profissional, útil e objetiva
- Se não souber algo, diga com transparência
- Forneça informações precisas e relevantes
- Mantenha tom respeitoso e positivo`;

const DEFAULT_TYPING_SPEED_MS = 100;

const CORE_CAPABILITIES_PROMPT = `CAPACIDADES:
- Você pode acessar a internet (web + deep web) através dos módulos internos da Alice.
- Você pode executar ações na plataforma (trading, relatórios, integrações) quando o usuário solicitar, seguindo permissões e limites de risco.
- Nunca diga que não tem acesso à internet ou execução quando esses módulos estiverem disponíveis. Se um módulo estiver indisponível, explique o motivo técnico e sugira nova tentativa.
- Quando houver SERVER_TIME, a data/hora vem do relógio do servidor (não da web).`;

type CoreDefaults = {
  creatorName: string;
  creatorRule: string;
  ethicsPolicy: string;
  moralPolicy: string;
  legalPolicy: string;
  safetyGuardrails: string;
  nsfwPolicy: string;
};

function resolveCoreSettings(settings?: AssistantSettings | null): {
  core: CoreDefaults;
  missing: string[];
} {
  const creatorName = settings?.creatorName?.trim() || '';
  const creatorRule = settings?.creatorRule?.trim() || '';
  const ethicsPolicy = settings?.ethicsPolicy?.trim() || '';
  const moralPolicy = settings?.moralPolicy?.trim() || '';
  const legalPolicy = settings?.legalPolicy?.trim() || '';
  const safetyGuardrails = settings?.safetyGuardrails?.trim() || '';
  const nsfwPolicy = settings?.nsfwPolicy?.trim() || '';

  const missing: string[] = [];
  if (!creatorName) missing.push('creatorName');
  if (!creatorRule) missing.push('creatorRule');
  if (!ethicsPolicy) missing.push('ethicsPolicy');
  if (!moralPolicy) missing.push('moralPolicy');
  if (!legalPolicy) missing.push('legalPolicy');
  if (!safetyGuardrails) missing.push('safetyGuardrails');
  if (!nsfwPolicy) missing.push('nsfwPolicy');

  return {
    core: {
      creatorName,
      creatorRule,
      ethicsPolicy,
      moralPolicy,
      legalPolicy,
      safetyGuardrails,
      nsfwPolicy,
    },
    missing,
  };
}

function applyCorePolicies(prompt: string, core: CoreDefaults): string {
  let result = prompt;

  if (core.ethicsPolicy) {
    result += `\n\nÉTICA:\n${core.ethicsPolicy}`;
  }
  if (core.moralPolicy) {
    result += `\n\nMORAL:\n${core.moralPolicy}`;
  }
  if (core.legalPolicy) {
    result += `\n\nLEGAL:\n${core.legalPolicy}`;
  }
  if (core.safetyGuardrails) {
    result += `\n\nSEGURANÇA E GUARDRAILS:\n${core.safetyGuardrails}`;
  }
  if (core.nsfwPolicy) {
    result += `\n\nPOLÍTICA NSFW:\n${core.nsfwPolicy}`;
  }

  if (core.creatorRule) {
    result += `\n\n${core.creatorRule}`;
  }

  return result;
}

function applyAssistantSettings(prompt: string, settings?: AssistantSettings | null): string {
  let result = prompt;

  if (settings?.behavior && settings.behavior.trim()) {
    result += `\n\nCOMPORTAMENTO: ${settings.behavior.trim()}`;
  }

  if (settings?.mood && settings.mood.trim()) {
    result += `\n\nTOM: ${settings.mood.trim()}`;
  }

  const traitLines: string[] = [];
  const scaleToLabel = (value: number): string => {
    if (value <= 25) return 'baixo';
    if (value <= 50) return 'moderado';
    if (value <= 75) return 'alto';
    return 'muito alto';
  };

  if (settings?.behaviorDirectness !== null && settings?.behaviorDirectness !== undefined) {
    traitLines.push(`Diretividade: ${scaleToLabel(settings.behaviorDirectness)}`);
  }
  if (settings?.behaviorProactivity !== null && settings?.behaviorProactivity !== undefined) {
    traitLines.push(`Proatividade: ${scaleToLabel(settings.behaviorProactivity)}`);
  }
  if (settings?.moodFormality !== null && settings?.moodFormality !== undefined) {
    traitLines.push(`Formalidade: ${scaleToLabel(settings.moodFormality)}`);
  }
  if (settings?.moodEmpathy !== null && settings?.moodEmpathy !== undefined) {
    traitLines.push(`Empatia: ${scaleToLabel(settings.moodEmpathy)}`);
  }

  if (traitLines.length > 0) {
    result += `\n\nTRAÇOS (0-100):\n- ${traitLines.join('\n- ')}`;
  }

  return result;
}

/**
 * Constrói o system prompt dinâmico baseado na configuração do agente
 * 
 * @param agent - Configuração do agente (opcional)
 * @param assistantSettings - Configuração global da assistente (opcional)
 * @param _userMessage - Mensagem do usuário para detecção de idioma (reservado para uso futuro)
 * @returns System prompt completo
 * 
 * NOTA: A detecção de idioma é feita pelo próprio LLM baseada nas instruções
 * do DEFAULT_SYSTEM_PROMPT. O parâmetro userMessage está reservado para
 * implementação futura de detecção de idioma programática se necessário.
 */
type UserLocationContext = {
  countryCode?: string | null;
  countryName?: string | null;
  region?: string | null;
  city?: string | null;
};

type UserLocaleContext = {
  locale?: string | null;
  timezone?: string | null;
  location?: UserLocationContext | null;
};

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
const resolveLocale = (locale?: string | null) => locale?.trim() || 'pt-BR';

const resolveTimeZone = (timezone?: string | null) => {
  if (timezone) {
    try {
      new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }).format(new Date());
      return timezone;
    } catch {
      // Fallback para timezone padrão caso inválido
    }
  }
  return DEFAULT_TIMEZONE;
};

const formatLocalDateTime = (date: Date, locale: string, timeZone: string) => {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short', timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'short', timeZone: DEFAULT_TIMEZONE }).format(date);
  }
};

const dateQuestionPattern = /(?:data|dia)\s+(?:de\s+)?hoje|que\s+dia\s+é\s+hoje|hoje\s+é|qual\s+a\s+data/i;
const timeQuestionPattern = /\b(que\s+horas|hora\s+agora|hor[aá]rio|horas?|what\s+time|current\s+time|time\s+is\s+it|time\s+now|now\s+time)\b/i;

const isTimeOrDateQuestion = (message: string) => dateQuestionPattern.test(message) || timeQuestionPattern.test(message);

const buildLocationLabel = (location?: UserLocationContext | null) => {
  if (!location) return null;
  const parts = [location.city, location.region, location.countryName || location.countryCode]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0);
  return parts.length > 0 ? parts.join(' - ') : null;
};

async function getUserLocaleContext(
  userId?: string | null,
  tenantId?: string | null
): Promise<UserLocaleContext | undefined> {
  if (!userId) return undefined;
  const userProfile = await db.query.users.findFirst({
    where: and(
      eq(schema.users.id, userId),
      tenantId ? eq(schema.users.tenantId, tenantId) : sql`1=1`
    ),
    columns: {
      idioma: true,
      timezone: true,
      preferencias: true,
    },
  });
  if (!userProfile) {
    return undefined;
  }
  return {
    locale: userProfile.idioma ?? null,
    timezone: userProfile.timezone ?? null,
    location: (userProfile.preferencias as { location?: UserLocationContext } | null | undefined)?.location ?? null,
  };
}

function buildSystemPrompt(
  agent?: AgentConfig | null,
  assistantSettings?: AssistantSettings | null,
  userMessage?: string,
  userContext?: UserLocaleContext
): string {
  let prompt = DEFAULT_SYSTEM_PROMPT;
  const { core: coreSettings, missing } = resolveCoreSettings(assistantSettings);
  if (missing.length > 0) {
    logger.warn({ missing }, 'Core da Alice incompleto no banco (assistant_settings)');
  }

  if (assistantSettings?.systemPrompt && assistantSettings.systemPrompt.trim()) {
    prompt = assistantSettings.systemPrompt.trim();
  }

  if (agent?.instrucoes && agent.instrucoes.trim()) {
    prompt = agent.instrucoes.trim();
  }

  if (agent?.personalidade && agent.personalidade.trim()) {
    prompt += `\n\nPERSONALIDADE: ${agent.personalidade.trim()}`;
  }

  prompt = applyAssistantSettings(prompt, assistantSettings);
  prompt = applyCorePolicies(prompt, coreSettings);

  const normalizedPrompt = prompt.toLowerCase();
  if (!normalizedPrompt.includes('capabilities')
    && !normalizedPrompt.includes('capacidades')
    && !normalizedPrompt.includes('internet')
    && !normalizedPrompt.includes('deep web')
    && !normalizedPrompt.includes('deepweb')) {
    prompt += `\n\n${CORE_CAPABILITIES_PROMPT}`;
  }

  const resolvedLocale = resolveLocale(userContext?.locale);
  const resolvedTimeZone = resolveTimeZone(userContext?.timezone);
  const locationLabel = buildLocationLabel(userContext?.location);

  if (locationLabel && !prompt.toLowerCase().includes('localização')) {
    prompt += `\n\nLOCALIZAÇÃO ATUAL:\n- ${locationLabel}`;
  }

  if (userMessage && isTimeOrDateQuestion(userMessage)) {
    const now = new Date();
    const localTime = formatLocalDateTime(now, resolvedLocale, resolvedTimeZone);
    prompt += `\n\nSERVER_TIME:\n- ISO: ${now.toISOString()}\n- Local: ${localTime}\n- Timezone: ${resolvedTimeZone}`;
  }

  // Adicionar instrução de idioma se não estiver presente
  if (!prompt.toLowerCase().includes('language') &&
      !prompt.toLowerCase().includes('idioma') &&
      !prompt.toLowerCase().includes('língua')) {
    prompt += `\n\nIMPORTANTE: Responda sempre no mesmo idioma da mensagem do usuário, sem misturar idiomas.`;
  }

  return prompt;
}

async function getAssistantSettingsForTenant(tenantId?: string | null): Promise<AssistantSettings | null> {
  if (!tenantId) {
    return null;
  }

  try {
    const settings = await db.query.assistantSettings.findFirst({
      where: eq(schema.assistantSettings.tenantId, tenantId),
    });
    if (!settings) {
      return null;
    }
    return {
      systemPrompt: settings.systemPrompt ?? null,
      creatorName: settings.creatorName ?? null,
      creatorRule: settings.creatorRule ?? null,
      ethicsPolicy: settings.ethicsPolicy ?? null,
      moralPolicy: settings.moralPolicy ?? null,
      legalPolicy: settings.legalPolicy ?? null,
      safetyGuardrails: settings.safetyGuardrails ?? null,
      nsfwPolicy: settings.nsfwPolicy ?? null,
      behavior: settings.behavior ?? null,
      mood: settings.mood ?? null,
      behaviorDirectness: settings.behaviorDirectness ?? null,
      behaviorProactivity: settings.behaviorProactivity ?? null,
      moodFormality: settings.moodFormality ?? null,
      moodEmpathy: settings.moodEmpathy ?? null,
      typingSpeedMs: settings.typingSpeedMs ?? null,
    };
  } catch (error) {
    logger.error({ error, tenantId }, 'Falha ao carregar assistant_settings');
    return null;
  }
}

async function getUserById(userId: string, tenantId: string | null | undefined) {
  return db.query.users.findFirst({
    where: and(
      eq(schema.users.id, userId),
      tenantId ? eq(schema.users.tenantId, tenantId) : sql`1=1`
    ),
  });
}

async function updateUserPreferences(
  userId: string,
  tenantId: string | null | undefined,
  patch: UserPreferencesRecord
): Promise<void> {
  const user = await getUserById(userId, tenantId);
  if (!user) return;
  const currentPrefs = (user.preferencias ?? {}) as UserPreferencesRecord;
  const nextPrefs = { ...currentPrefs, ...patch };
  await db.update(schema.users)
    .set({ preferencias: nextPrefs, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}

async function updateUserPreferredName(
  userId: string,
  tenantId: string | null | undefined,
  preferredName: string | null
): Promise<void> {
  const user = await getUserById(userId, tenantId);
  if (!user) return;
  await db.update(schema.users)
    .set({ preferredName, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
}

async function resolveUserNameContext(
  userId: string,
  tenantId: string | null | undefined
): Promise<UserNameContext> {
  const user = await getUserById(userId, tenantId);
  if (!user) {
    return {
      preferredName: null,
      suggestedName: null,
      shouldAskConfirmation: false,
      promptPending: false,
    };
  }
  const prefs = (user.preferencias ?? {}) as UserPreferencesRecord;
  const preferredName = normalizeUserName(
    typeof user.preferredName === 'string' && user.preferredName.trim().length > 0
      ? user.preferredName
      : typeof prefs.preferredName === 'string'
        ? prefs.preferredName
        : ''
  );
  const suggestedName = typeof prefs.nameSuggested === 'string'
    ? normalizeUserName(prefs.nameSuggested)
    : buildLoginName({ firstName: user.firstName, lastName: user.lastName, email: user.email });
  const promptPending = Boolean(prefs.namePromptPending);
  const context: UserNameContext = {
    preferredName,
    suggestedName,
    shouldAskConfirmation: false,
    promptPending,
  };
  context.shouldAskConfirmation = shouldAskNameConfirmation(context);
  return context;
}

async function handleUserNameUpdate(params: {
  userId: string;
  tenantId: string | null | undefined;
  userMessage: string;
  currentContext: UserNameContext;
}): Promise<UserNameContext> {
  const extractedName = extractNameFromMessage(params.userMessage);
  if (extractedName) {
    await updateUserPreferredName(params.userId, params.tenantId, extractedName);
    await updateUserPreferences(params.userId, params.tenantId, {
      namePromptPending: false,
      nameSuggested: null,
      nameUpdatedAt: new Date().toISOString(),
    });
    return {
      ...params.currentContext,
      preferredName: extractedName,
      shouldAskConfirmation: false,
      promptPending: false,
    };
  }

  if (params.currentContext.promptPending && isNameConfirmation(params.userMessage, params.currentContext.suggestedName)) {
    const confirmedName = params.currentContext.suggestedName;
    if (confirmedName) {
      await updateUserPreferredName(params.userId, params.tenantId, confirmedName);
      await updateUserPreferences(params.userId, params.tenantId, {
        namePromptPending: false,
        nameSuggested: null,
        nameUpdatedAt: new Date().toISOString(),
      });
      return {
        ...params.currentContext,
        preferredName: confirmedName,
        shouldAskConfirmation: false,
        promptPending: false,
      };
    }
  }

  if (params.currentContext.promptPending) {
    const normalizedCandidate = normalizeUserName(params.userMessage);
    const lower = params.userMessage.trim().toLowerCase();
    const isConfirmation = isNameConfirmation(params.userMessage, params.currentContext.suggestedName);
    const invalidCandidates = new Set([
      'sim', 'ok', 'pode', 'pode sim', 'isso', 'isso mesmo', 'claro', 'tanto faz',
      'não', 'nao', 'prefiro', 'obrigado', 'obrigada', 'valeu',
    ]);
    const looksLikePlainName = Boolean(
      normalizedCandidate &&
      normalizedCandidate.length <= 40 &&
      !/[0-9]/.test(normalizedCandidate) &&
      !invalidCandidates.has(lower) &&
      !isConfirmation &&
      !/(pode|usar|chamar|nome)\b/i.test(lower) &&
      !/[?]/.test(lower)
    );
    if (looksLikePlainName) {
      await updateUserPreferredName(params.userId, params.tenantId, normalizedCandidate);
      await updateUserPreferences(params.userId, params.tenantId, {
        namePromptPending: false,
        nameSuggested: null,
        nameUpdatedAt: new Date().toISOString(),
      });
      return {
        ...params.currentContext,
        preferredName: normalizedCandidate,
        shouldAskConfirmation: false,
        promptPending: false,
      };
    }
  }

  return params.currentContext;
}

async function markNamePromptPending(
  userId: string,
  tenantId: string | null | undefined,
  context: UserNameContext
): Promise<void> {
  if (!context.shouldAskConfirmation || !context.suggestedName) return;
  await updateUserPreferences(userId, tenantId, {
    namePromptPending: true,
    nameSuggested: context.suggestedName,
    namePromptedAt: new Date().toISOString(),
  });
}

function appendUserNamePolicy(
  prompt: string,
  context: UserNameContext,
  usage?: UserNameUsageContext
): string {
  const name = context.preferredName || context.suggestedName;
  if (!name) return prompt;
  const usageLines = [
    `Nome base: ${name}`,
    'Use o nome apenas em saudações iniciais/finais, respostas importantes e em conclusões de atividades críticas.',
    'Use o nome quando o usuário perguntar sobre o próprio nome.',
    'Não use o nome em todas as mensagens.',
  ];
  if (usage?.isFirstResponse) {
    usageLines.push('Esta é a primeira resposta da conversa: cumprimente o usuário pelo nome.');
  }
  if (usage?.shouldGreet && !usage?.isFirstResponse) {
    const hours = usage?.hoursSinceLast;
    usageLines.push(`Usuário retornou após ${hours ?? 1}h: cumprimente e diga algo acolhedor (ex.: “que bom que você voltou”).`);
  }
  return `${prompt}\n\nNOME DO USUÁRIO:\n- ${usageLines.join('\n- ')}`;
}

function appendNameConfirmationInstruction(prompt: string, context: UserNameContext): string {
  if (!context.shouldAskConfirmation || !context.suggestedName) return prompt;
  return `${prompt}\n\nIMPORTANTE: Pergunte se o usuário prefere ser chamado de "${context.suggestedName}" ou se prefere outro nome.`;
}

function appendNameConfirmationQuestion(response: string, context: UserNameContext): string {
  if (!context.shouldAskConfirmation || !context.suggestedName) return response;
  return `${response}\n\nPosso te chamar de ${context.suggestedName} ou você prefere outro nome?`;
}

function applyUserNameToGreeting(response: string, context: UserNameContext): string {
  const name = context.preferredName || context.suggestedName;
  if (!name) return response;
  const normalizedResponse = response.toLowerCase();
  if (normalizedResponse.includes(name.toLowerCase())) {
    return response;
  }
  return response.replace(/^(\s*(?:ol[áa]|oi|hello|hi)[^,!\n]*)/i, `$1, ${name}`);
}

// ============================================================================
// CIRCUIT BREAKER - GPU Manager Service LLM API (Regra 16 - Best Practices 2025)
// Usa CIRCUIT_BREAKER_PRESETS centralizado (Regra 2 - Não Duplicar)
// ============================================================================

// Timeout para chamadas LLM (30 segundos para não-streaming)
// BUG FIX 26/12/2025: LLM_STREAM_TIMEOUT removido - streaming usa timeout do GPU Manager Service
const LLM_SYNC_TIMEOUT = 30000;

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMResponse {
  choices: Array<{
    message: { content: string };
    delta?: { content?: string };
  }>;
}

// ============================================================================
// TÍTULOS DE CONVERSA (LLM) - Enterprise Auto-Title
// ============================================================================
const TITLE_MAX_CHARS = 120;
const TITLE_MIN_CHARS = 4;
const TITLE_SYSTEM_PROMPT = `Você é um gerador de títulos de conversa.
Gere um título curto, específico e relacionado ao conteúdo.
Regras:
- Responda SOMENTE com o título (sem aspas, sem emojis, sem lista).
- Use a mesma língua da conversa.
- Máximo de 8 palavras.`;

function sanitizeConversationTitle(raw: string): string {
  const firstLine = raw.split('\n')[0] ?? '';
  const trimmed = firstLine.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  const normalized = trimmed.replace(/\s+/g, ' ').trim();
  if (normalized.length <= TITLE_MAX_CHARS) {
    return normalized;
  }
  return normalized.slice(0, TITLE_MAX_CHARS).trim();
}

async function generateConversationTitle(params: {
  userMessage: string;
  assistantResponse?: string | null;
}): Promise<string | null> {
  const userMessage = params.userMessage?.trim();
  if (!userMessage) {
    return null;
  }

  const context = params.assistantResponse?.trim()
    ? `${userMessage}\n\nResposta:\n${params.assistantResponse.trim()}`
    : userMessage;

  try {
    const titleResponse = await callLlamaAPI(
      [
        { role: 'system', content: TITLE_SYSTEM_PROMPT },
        { role: 'user', content: context },
      ],
      false,
      {
        temperature: 0.2,
        maxTokens: 24,
      },
      getAdaptiveGpuPriority('title', 'general')
    );
    const rawTitle = String(titleResponse || '').trim();
    if (!rawTitle || rawTitle === LLM_FALLBACK_MESSAGE) {
      return null;
    }

    const sanitized = sanitizeConversationTitle(rawTitle);
    if (sanitized.length < TITLE_MIN_CHARS) {
      return null;
    }
    return sanitized;
  } catch (error) {
    logger.warn({ error }, 'Falha ao gerar título automático da conversa');
    return null;
  }
}

async function ensureConversationTitle(params: {
  conversationId: string;
  userMessage: string;
  assistantResponse?: string | null;
}): Promise<void> {
  const title = await generateConversationTitle(params);
  if (!title) {
    return;
  }

  const [updated] = await db.update(schema.conversations)
    .set({
      titulo: title,
      atualizadoEm: new Date(),
    })
    .where(
      and(
        eq(schema.conversations.id, params.conversationId),
        or(
          sql`${schema.conversations.titulo} is null`,
          eq(schema.conversations.titulo, 'Nova Conversa')
        )
      )
    )
    .returning();

  if (updated) {
    logger.info({ conversationId: params.conversationId, title }, 'Título automático aplicado à conversa');
  }
}

/**
 * Configuração de parâmetros LLM para chamadas de inferência
 * 
 * BUG FIX 02/01/2026: Valores agora vêm da configuração do agente, não hardcoded
 */
interface LLMConfig {
  /** Temperatura do modelo (0-2). Default: 0.7 */
  temperature?: number;
  /** Limite máximo de tokens na resposta (saída). Default: 2048 */
  maxTokens?: number;
  /** Modelo a ser usado. Default: Qwen/Qwen2.5-7B-Instruct-AWQ */
  model?: string;
}

interface LLMRequest {
  messages: LLMMessage[];
  stream: boolean;
  config?: LLMConfig;
  priority?: GpuRequestPriority;
}

// Valores padrão centralizados (Regra 2 - Não Duplicar)
// Arquitetura atual (16/01/2026+): GPU local = Texto + Embeddings + ASR (Vision via OpenAI)
const DEFAULT_LLM_CONFIG: Required<LLMConfig> = {
  temperature: 0.7,
  // Default de saída (max_tokens). Observação: `MAX_MODEL_LEN` do vLLM pode ser maior (ex.: 8192).
  maxTokens: 2048,
  model: 'Qwen/Qwen2.5-7B-Instruct-AWQ',
};

function parseEnvInt(value: string | undefined, defaultValue: number, name: string): number {
  const raw = (value ?? String(defaultValue)).trim();
  if (!/^\d+$/.test(raw)) {
    const message = `${name} inválido: "${raw}". Deve ser inteiro positivo.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ name, raw }, message);
      throw new Error(message);
    }
    logger.warn({ name, raw, defaultValue }, `${message} Usando valor padrão.`);
    return defaultValue;
  }
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const message = `${name} inválido: "${raw}". Deve ser inteiro positivo.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ name, raw, parsed }, message);
      throw new Error(message);
    }
    logger.warn({ name, raw, parsed, defaultValue }, `${message} Usando valor padrão.`);
    return defaultValue;
  }
  return parsed;
}

function parseEnvNonNegativeInt(value: string | undefined, defaultValue: number, name: string): number {
  const raw = (value ?? String(defaultValue)).trim();
  if (!/^\d+$/.test(raw)) {
    const message = `${name} inválido: "${raw}". Deve ser inteiro >= 0.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ name, raw }, message);
      throw new Error(message);
    }
    logger.warn({ name, raw, defaultValue }, `${message} Usando valor padrão.`);
    return defaultValue;
  }
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    const message = `${name} inválido: "${raw}". Deve ser inteiro >= 0.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ name, raw, parsed }, message);
      throw new Error(message);
    }
    logger.warn({ name, raw, parsed, defaultValue }, `${message} Usando valor padrão.`);
    return defaultValue;
  }
  return parsed;
}

function parseEnvFloat(value: string | undefined, defaultValue: number, name: string): number {
  const raw = (value ?? String(defaultValue)).trim().replace(',', '.');
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    const message = `${name} inválido: "${raw}". Deve ser número entre 0 e 1 (ex: 0.12).`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ name, raw, parsed }, message);
      throw new Error(message);
    }
    logger.warn({ name, raw, parsed, defaultValue }, `${message} Usando valor padrão.`);
    return defaultValue;
  }
  return parsed;
}

function parseEnvBool(value: string | undefined, defaultValue: boolean, name: string): boolean {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  const message = `${name} inválido: "${value}". Deve ser 'true' ou 'false'.`;
  if (process.env.NODE_ENV === 'production') {
    logger.error({ name, raw: value }, message);
    throw new Error(message);
  }
  logger.warn({ name, raw: value, defaultValue }, `${message} Usando valor padrão.`);
  return defaultValue;
}
type LlmSource =
  | 'sync'
  | 'stream'
  | 'websocket'
  | 'websocket-media'
  | 'external-channel'
  | 'title';

type LlmContextProfile = 'trading' | 'general' | 'analysis';

const MIN_LLM_OUTPUT_TOKENS = parseEnvInt(
  process.env.LLM_MIN_OUTPUT_TOKENS,
  256,
  'LLM_MIN_OUTPUT_TOKENS'
);
const LLM_DYNAMIC_PROMPT_T1 = parseEnvInt(
  process.env.LLM_DYNAMIC_PROMPT_T1,
  1600,
  'LLM_DYNAMIC_PROMPT_T1'
);
const LLM_DYNAMIC_PROMPT_T2 = parseEnvInt(
  process.env.LLM_DYNAMIC_PROMPT_T2,
  2200,
  'LLM_DYNAMIC_PROMPT_T2'
);
const LLM_DYNAMIC_PROMPT_T3 = parseEnvInt(
  process.env.LLM_DYNAMIC_PROMPT_T3,
  2800,
  'LLM_DYNAMIC_PROMPT_T3'
);
const LLM_DYNAMIC_PROMPT_T4 = parseEnvInt(
  process.env.LLM_DYNAMIC_PROMPT_T4,
  3600,
  'LLM_DYNAMIC_PROMPT_T4'
);
const LLM_DYNAMIC_MAX_TOKENS_T1 = parseEnvInt(
  process.env.LLM_DYNAMIC_MAX_TOKENS_T1,
  1536,
  'LLM_DYNAMIC_MAX_TOKENS_T1'
);
const LLM_DYNAMIC_MAX_TOKENS_T2 = parseEnvInt(
  process.env.LLM_DYNAMIC_MAX_TOKENS_T2,
  1024,
  'LLM_DYNAMIC_MAX_TOKENS_T2'
);
const LLM_DYNAMIC_MAX_TOKENS_T3 = parseEnvInt(
  process.env.LLM_DYNAMIC_MAX_TOKENS_T3,
  768,
  'LLM_DYNAMIC_MAX_TOKENS_T3'
);
const LLM_DYNAMIC_MAX_TOKENS_T4 = parseEnvInt(
  process.env.LLM_DYNAMIC_MAX_TOKENS_T4,
  512,
  'LLM_DYNAMIC_MAX_TOKENS_T4'
);
const CHAT_HISTORY_FETCH_LIMIT = parseEnvInt(
  process.env.CHAT_HISTORY_FETCH_LIMIT,
  10,
  'CHAT_HISTORY_FETCH_LIMIT'
);
const CHAT_HISTORY_ALWAYS_INCLUDE_TRADING = parseEnvInt(
  process.env.CHAT_HISTORY_ALWAYS_INCLUDE_TRADING,
  6,
  'CHAT_HISTORY_ALWAYS_INCLUDE_TRADING'
);
const CHAT_HISTORY_ALWAYS_INCLUDE_GENERAL = parseEnvInt(
  process.env.CHAT_HISTORY_ALWAYS_INCLUDE_GENERAL,
  4,
  'CHAT_HISTORY_ALWAYS_INCLUDE_GENERAL'
);
const CHAT_HISTORY_MIN_MESSAGES_TRADING = parseEnvNonNegativeInt(
  process.env.CHAT_HISTORY_MIN_MESSAGES_TRADING,
  0,
  'CHAT_HISTORY_MIN_MESSAGES_TRADING'
);
const CHAT_HISTORY_MIN_MESSAGES_GENERAL = parseEnvNonNegativeInt(
  process.env.CHAT_HISTORY_MIN_MESSAGES_GENERAL,
  0,
  'CHAT_HISTORY_MIN_MESSAGES_GENERAL'
);
const CHAT_HISTORY_RELEVANCE_THRESHOLD_TRADING = parseEnvFloat(
  process.env.CHAT_HISTORY_RELEVANCE_THRESHOLD_TRADING,
  0.08,
  'CHAT_HISTORY_RELEVANCE_THRESHOLD_TRADING'
);
const CHAT_HISTORY_RELEVANCE_THRESHOLD_GENERAL = parseEnvFloat(
  process.env.CHAT_HISTORY_RELEVANCE_THRESHOLD_GENERAL,
  0.12,
  'CHAT_HISTORY_RELEVANCE_THRESHOLD_GENERAL'
);
const CHAT_HISTORY_FALLBACK_ENABLED = parseEnvBool(
  process.env.CHAT_HISTORY_FALLBACK_ENABLED,
  false,
  'CHAT_HISTORY_FALLBACK_ENABLED'
);
const CHAT_HISTORY_SEARCH_LIMIT = parseEnvInt(
  process.env.CHAT_HISTORY_SEARCH_LIMIT,
  200,
  'CHAT_HISTORY_SEARCH_LIMIT'
);
const CHAT_HISTORY_SEARCH_TOKEN_BUDGET = parseEnvInt(
  process.env.CHAT_HISTORY_SEARCH_TOKEN_BUDGET,
  1200,
  'CHAT_HISTORY_SEARCH_TOKEN_BUDGET'
);
const CHAT_HISTORY_SEARCH_CONVERSATIONS_LIMIT = parseEnvInt(
  process.env.CHAT_HISTORY_SEARCH_CONVERSATIONS_LIMIT,
  20,
  'CHAT_HISTORY_SEARCH_CONVERSATIONS_LIMIT'
);
const CHAT_MEMORY_RELEVANCE_THRESHOLD = parseEnvFloat(
  process.env.CHAT_MEMORY_RELEVANCE_THRESHOLD,
  0.1,
  'CHAT_MEMORY_RELEVANCE_THRESHOLD'
);
const CHAT_MEMORY_IMPORTANCE_KEYWORDS = [
  'importante', 'crítico', 'critico', 'essencial', 'prioridade', 'urgente',
  'risco', 'risks', 'compliance', 'regra', 'política', 'politica', 'sla',
  'acordo', 'contrato', 'financeiro', 'financeira', 'pagamento', 'taxa',
  'exposição', 'exposicao', 'limite', 'liquidação', 'liquidacao',
  'trading', 'ordem', 'alavancagem', 'stop', 'take profit', 'kucoin',
] as const;

function validateDynamicTokenTiers(): void {
  const thresholdValues = [
    LLM_DYNAMIC_PROMPT_T1,
    LLM_DYNAMIC_PROMPT_T2,
    LLM_DYNAMIC_PROMPT_T3,
    LLM_DYNAMIC_PROMPT_T4,
  ];
  const tokenCaps = [
    LLM_DYNAMIC_MAX_TOKENS_T1,
    LLM_DYNAMIC_MAX_TOKENS_T2,
    LLM_DYNAMIC_MAX_TOKENS_T3,
    LLM_DYNAMIC_MAX_TOKENS_T4,
  ];
  const isThresholdsAscending = thresholdValues.every((value, index, arr) => index === 0 || value > arr[index - 1]);
  const isCapsDescending = tokenCaps.every((value, index, arr) => index === 0 || value < arr[index - 1]);
  if (isThresholdsAscending && isCapsDescending) {
    return;
  }
  const message = 'Configuração inválida dos tiers de tokens (thresholds devem subir e caps devem descer).';
  if (process.env.NODE_ENV === 'production') {
    logger.error({ thresholdValues, tokenCaps }, message);
    throw new Error(message);
  }
  logger.warn({ thresholdValues, tokenCaps }, `${message} Usando valores configurados mesmo assim.`);
}

validateDynamicTokenTiers();
const LLM_TOKENS_PER_SECOND = parseEnvInt(
  process.env.LLM_TOKENS_PER_SECOND,
  40,
  'LLM_TOKENS_PER_SECOND'
);
const TRAINING_AUTO_COLLECT_CHAT = parseEnvBool(
  process.env.TRAINING_AUTO_COLLECT_CHAT,
  true,
  'TRAINING_AUTO_COLLECT_CHAT'
);
const TRAINING_CONVERSATION_MAX_MESSAGES = parseEnvInt(
  process.env.TRAINING_CONVERSATION_MAX_MESSAGES,
  20,
  'TRAINING_CONVERSATION_MAX_MESSAGES'
);
const SLA_SECONDS_STREAM = parseEnvInt(process.env.SLA_SECONDS_STREAM, 12, 'SLA_SECONDS_STREAM');
const SLA_SECONDS_SYNC = parseEnvInt(process.env.SLA_SECONDS_SYNC, 18, 'SLA_SECONDS_SYNC');
const SLA_SECONDS_WEBSOCKET = parseEnvInt(process.env.SLA_SECONDS_WEBSOCKET, 12, 'SLA_SECONDS_WEBSOCKET');
const SLA_SECONDS_MEDIA = parseEnvInt(process.env.SLA_SECONDS_MEDIA, 18, 'SLA_SECONDS_MEDIA');
const SLA_SECONDS_EXTERNAL = parseEnvInt(process.env.SLA_SECONDS_EXTERNAL, 20, 'SLA_SECONDS_EXTERNAL');
const SLA_SECONDS_TITLE = parseEnvInt(process.env.SLA_SECONDS_TITLE, 6, 'SLA_SECONDS_TITLE');

function getSlaTargetSeconds(source: LlmSource, profile: LlmContextProfile): number {
  const base = (() => {
    switch (source) {
      case 'stream':
        return SLA_SECONDS_STREAM;
      case 'websocket':
        return SLA_SECONDS_WEBSOCKET;
      case 'websocket-media':
        return SLA_SECONDS_MEDIA;
      case 'external-channel':
        return SLA_SECONDS_EXTERNAL;
      case 'title':
        return SLA_SECONDS_TITLE;
      case 'sync':
      default:
        return SLA_SECONDS_SYNC;
    }
  })();

  if (profile === 'trading') {
    return Math.max(6, Math.floor(base * 0.8));
  }
  if (profile === 'analysis') {
    return Math.min(30, Math.ceil(base * 1.2));
  }
  return base;
}

function detectContextProfile(userMessage: string): LlmContextProfile {
  const normalized = userMessage.toLowerCase();
  const tradingKeywords = [
    'buy', 'sell', 'long', 'short', 'btc', 'eth', 'alavancagem', 'stop loss',
    'take profit', 'kucoin', 'futuros', 'ordem', 'limit', 'market', 'scalping',
  ];
  if (tradingKeywords.some((k) => normalized.includes(k))) {
    return 'trading';
  }
  if (normalized.length > 1200 || /analis|estrat|relat|compar|detalh/.test(normalized)) {
    return 'analysis';
  }
  return 'general';
}

type UserNameContext = {
  preferredName: string | null;
  suggestedName: string | null;
  shouldAskConfirmation: boolean;
  promptPending: boolean;
};

type UserNameUsageContext = {
  isFirstResponse: boolean;
  shouldGreet: boolean;
  hoursSinceLast: number | null;
};

type UserPreferencesRecord = Record<string, unknown>;

function buildEmptyUserNameContext(): UserNameContext {
  return {
    preferredName: null,
    suggestedName: null,
    shouldAskConfirmation: false,
    promptPending: false,
  };
}

function normalizeUserName(value: string): string | null {
  const cleaned = value
    .replace(/[^\p{L}\p{M}\s'.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length < 2 || cleaned.length > 60) return null;
  return cleaned;
}

function buildLoginName(user: { firstName?: string | null; lastName?: string | null; email?: string | null }): string | null {
  const firstName = user.firstName?.trim() ?? '';
  const lastName = user.lastName?.trim() ?? '';
  const combined = `${firstName} ${lastName}`.trim();
  if (combined.length >= 2) return combined;
  const emailLocal = user.email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim();
  return emailLocal && emailLocal.length >= 2 ? emailLocal : null;
}

function parseMessageTimestamp(value: unknown): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function resolveUserNameUsageContext(params: {
  previousMessages: Array<{ criadoEm?: Date | string | null; isFromUser?: boolean | null; conteudo?: string | null }>;
  conversationCreated: boolean;
}): UserNameUsageContext {
  const previousMessages = params.previousMessages ?? [];
  const hasAssistantHistory = previousMessages.some((msg) => !msg.isFromUser && Boolean(msg.conteudo));
  const isFirstResponse = params.conversationCreated || !hasAssistantHistory;
  const lastMessageTimestamp = previousMessages.length > 0 ? parseMessageTimestamp(previousMessages[0]?.criadoEm) : null;
  const hoursSinceLast = lastMessageTimestamp
    ? (Date.now() - lastMessageTimestamp) / (1000 * 60 * 60)
    : null;
  const shouldGreet = isFirstResponse || (hoursSinceLast !== null && hoursSinceLast >= 1);
  return {
    isFirstResponse,
    shouldGreet,
    hoursSinceLast: hoursSinceLast !== null ? Number(hoursSinceLast.toFixed(2)) : null,
  };
}

function extractNameFromMessage(message: string): string | null {
  const patterns = [
    /(?:meu nome é|me chamo|pode me chamar de|me chama de|prefiro ser chamado(?:a)? de)\s+([^\n.,!?]{2,60})/i,
    /(?:prefiro|prefiro que)\s+(?:ser\s+)?(?:chamado(?:a)?\s+de\s+)?([^\n.,!?]{2,60})/i,
    /(?:my name is|call me)\s+([^\n.,!?]{2,60})/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match?.[1]) continue;
    const normalized = normalizeUserName(match[1]);
    if (normalized) return normalized;
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildNamePattern(name: string): string {
  return escapeRegExp(name).replace(/\s+/g, '\\s+');
}

function hasNameNegation(message: string, suggestedLower: string): boolean {
  const namePattern = buildNamePattern(suggestedLower);
  const patterns = [
    new RegExp(`\\b(n[aã]o)\\s*,?\\s*${namePattern}\\b`),
    new RegExp(`\\b${namePattern}\\b\\s*,?\\s*n[aã]o\\b`),
    new RegExp(`\\b(n[aã]o)\\b[^.!?]{0,40}\\b(cham\\w*|usar|nome)\\b[^.!?]{0,20}\\b${namePattern}\\b`),
    new RegExp(`\\b(n[aã]o)\\b[^.!?]{0,40}\\b${namePattern}\\b[^.!?]{0,20}\\b(cham\\w*|usar|nome)\\b`),
    new RegExp(`\\b(prefiro|quero|gostaria)\\b[^.!?]{0,40}\\b(outro|outra)\\b\\s+nome\\b`),
  ];
  return patterns.some((pattern) => pattern.test(message));
}

function isNameConfirmation(message: string, suggestedName: string | null): boolean {
  if (!suggestedName) return false;
  const normalized = message.toLowerCase().trim();
  if (!normalized) return false;
  const hasSuggested = normalized.includes(suggestedName.toLowerCase());
  if (hasSuggested && hasNameNegation(normalized, suggestedName.toLowerCase())) {
    return false;
  }
  if (hasSuggested) return true;
  if (/^(sim|ok|pode|pode sim|isso|isso mesmo|claro|tanto faz|pode chamar)\b/i.test(normalized)) {
    return true;
  }
  return /(pode|pode sim|claro).*(usar|chamar|nome)\b/i.test(normalized);
}

function shouldAskNameConfirmation(context: UserNameContext): boolean {
  if (context.preferredName) return false;
  if (!context.suggestedName) return false;
  if (context.promptPending) return false;
  return true;
}

function isMemorySearchIntent(message: string): boolean {
  const normalized = message.toLowerCase();
  return /lembra|hist[oó]rico|conversa anterior|você disse|voce disse|falamos|disse antes|qual foi|qual era|o que combinamos|meu nome|qual é meu nome|qual e meu nome|como você me chama|como voce me chama/i.test(normalized);
}

function buildMemorySearchBlock(history: StoredMessage[], userMessage: string, maxTokens: number): string | null {
  if (maxTokens <= 0 || history.length === 0) return null;
  const normalizedUser = userMessage.trim().toLowerCase();
  const candidates = history
    .map((msg, index) => {
      const content = msg.conteudo?.trim();
      if (!content) return null;
      const score = computeRelevanceScore(content, normalizedUser);
      const isImportant = CHAT_MEMORY_IMPORTANCE_KEYWORDS.some((keyword) =>
        content.toLowerCase().includes(keyword)
      );
      return {
        index,
        content,
        score,
        isImportant,
        isFromUser: msg.isFromUser,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item) => item.score >= CHAT_MEMORY_RELEVANCE_THRESHOLD || item.isImportant);

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.isImportant !== b.isImportant) return a.isImportant ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  const selected: string[] = [];
  let usedTokens = 0;
  for (const item of candidates) {
    const prefix = item.isFromUser ? 'Usuário' : 'Alice';
    const entry = `${prefix}: ${item.content}`;
    const entryTokens = estimateTokensFromText(entry);
    if (usedTokens + entryTokens > maxTokens) break;
    selected.push(entry);
    usedTokens += entryTokens;
  }

  if (selected.length === 0) return null;
  return selected.join('\n');
}

async function fetchUserMemoryHistory(params: {
  userId?: string | null;
  tenantId?: string | null;
  conversationId: string;
  limit: number;
}): Promise<StoredMessage[]> {
  if (!params.userId || !params.tenantId) {
    const fallback = await db.query.messages.findMany({
      where: eq(schema.messages.conversationId, params.conversationId),
      orderBy: [desc(schema.messages.criadoEm)],
      limit: params.limit,
    });
    return normalizeStoredMessages(fallback);
  }

  const conversations = await db.query.conversations.findMany({
    where: and(
      eq(schema.conversations.userId, params.userId),
      eq(schema.conversations.tenantId, params.tenantId)
    ),
    orderBy: [desc(schema.conversations.atualizadoEm)],
    limit: CHAT_HISTORY_SEARCH_CONVERSATIONS_LIMIT,
  });
  const conversationIds = conversations.map((conv) => conv.id);
  if (conversationIds.length === 0) {
    return [];
  }
  const messages = await db.query.messages.findMany({
    where: inArray(schema.messages.conversationId, conversationIds),
    orderBy: [desc(schema.messages.criadoEm)],
    limit: params.limit,
  });
  return normalizeStoredMessages(messages);
}

function getPromptTokenBudget(source: LlmSource, profile: LlmContextProfile): number {
  const slaSeconds = getSlaTargetSeconds(source, profile);
  const budget = Math.floor(slaSeconds * 120);
  if (profile === 'trading') {
    return Math.min(2800, Math.max(900, Math.floor(budget * 0.75)));
  }
  if (profile === 'analysis') {
    return Math.min(3600, Math.max(1400, Math.floor(budget * 1.1)));
  }
  return Math.min(3200, Math.max(1200, budget));
}

function getGpuPriority(source: LlmSource, profile: LlmContextProfile): GpuRequestPriority {
  if (profile === 'trading') {
    return GpuRequestPriority.CRITICAL;
  }
  switch (source) {
    case 'title':
      return GpuRequestPriority.LOW;
    case 'external-channel':
    case 'websocket-media':
      return GpuRequestPriority.HIGH;
    case 'stream':
    case 'websocket':
      return GpuRequestPriority.CRITICAL;
    case 'sync':
    default:
      return GpuRequestPriority.CRITICAL;
  }
}

function getAdaptiveGpuPriority(source: LlmSource, profile: LlmContextProfile): GpuRequestPriority {
  const base = getGpuPriority(source, profile);
  if (base === GpuRequestPriority.CRITICAL) return base;
  if (gpuManagerBreaker.opened || gpuManagerBreaker.halfOpen) {
    if (source === 'title') return GpuRequestPriority.LOW;
    if (source === 'external-channel') return GpuRequestPriority.MEDIUM;
    if (source === 'websocket-media') return GpuRequestPriority.MEDIUM;
  }
  return base;
}

function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateTokensFromMessages(messages: LLMMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokensFromText(msg.content || ''), 0);
}

function recordLlmTokenUsage(params: { model: string; promptTokens: number; generatedTokens?: number }): void {
  const { model, promptTokens, generatedTokens } = params;
  if (promptTokens > 0) {
    metrics.llm.tokensPrompt.inc({ model }, promptTokens);
  }
  if (generatedTokens && generatedTokens > 0) {
    metrics.llm.tokensGenerated.inc({ model }, generatedTokens);
  }
}

function recordRagRelevance(tenantId: string | null | undefined, ragResult: RAGContextResponse | null): void {
  if (!tenantId || !ragResult?.sources?.length) {
    return;
  }
  const avg = ragResult.sources.reduce((sum, source) => sum + source.similarity, 0) / ragResult.sources.length;
  if (!Number.isFinite(avg)) {
    return;
  }
  const normalized = Math.max(0, Math.min(1, avg));
  metrics.rag.relevanceScore.set({ tenant_id: tenantId }, normalized);
}

function recordRagSearchMetrics(params: {
  tenantId: string | null | undefined;
  ragResult: RAGContextResponse | null;
  latencyMs?: number;
  endpoint: string;
}): void {
  const { tenantId, ragResult, latencyMs, endpoint } = params;
  if (tenantId && typeof latencyMs === 'number' && latencyMs >= 0) {
    metrics.rag.searchDuration.observe({ tenant_id: tenantId }, latencyMs / 1000);
  }
  if (ragResult?.sources?.length) {
    metrics.rag.effectiveK.observe({ endpoint }, ragResult.sources.length);
  }
}

function computeDynamicMaxTokens(baseMax: number, promptTokens: number): number {
  let dynamicMax = baseMax;
  if (promptTokens > LLM_DYNAMIC_PROMPT_T4) {
    dynamicMax = Math.min(dynamicMax, LLM_DYNAMIC_MAX_TOKENS_T4);
  } else if (promptTokens > LLM_DYNAMIC_PROMPT_T3) {
    dynamicMax = Math.min(dynamicMax, LLM_DYNAMIC_MAX_TOKENS_T3);
  } else if (promptTokens > LLM_DYNAMIC_PROMPT_T2) {
    dynamicMax = Math.min(dynamicMax, LLM_DYNAMIC_MAX_TOKENS_T2);
  } else if (promptTokens > LLM_DYNAMIC_PROMPT_T1) {
    dynamicMax = Math.min(dynamicMax, LLM_DYNAMIC_MAX_TOKENS_T1);
  }
  return Math.max(MIN_LLM_OUTPUT_TOKENS, dynamicMax);
}

function applyDynamicTokenBudget(
  llmConfig: LLMConfig,
  llmMessages: LLMMessage[],
  context: { conversationId?: string; source: LlmSource; profile: LlmContextProfile }
): LLMConfig {
  const baseMaxTokens = llmConfig.maxTokens ?? DEFAULT_LLM_CONFIG.maxTokens;
  const baseTemperature = llmConfig.temperature ?? DEFAULT_LLM_CONFIG.temperature;
  const promptTokens = estimateTokensFromMessages(llmMessages);
  const slaSeconds = getSlaTargetSeconds(context.source, context.profile);
  const slaMaxTokens = Math.max(MIN_LLM_OUTPUT_TOKENS, Math.floor(slaSeconds * LLM_TOKENS_PER_SECOND));
  const dynamicMaxTokens = Math.min(
    computeDynamicMaxTokens(baseMaxTokens, promptTokens),
    slaMaxTokens
  );
  const adjustedTemperature = (() => {
    if (context.profile === 'trading') {
      return Math.min(baseTemperature, 0.3);
    }
    if (context.profile === 'analysis') {
      return Math.min(baseTemperature, 0.6);
    }
    return baseTemperature;
  })();

  if (dynamicMaxTokens !== baseMaxTokens) {
    logger.info({
      ...context,
      promptTokens,
      slaSeconds,
      profile: context.profile,
      slaMaxTokens,
      baseMaxTokens,
      dynamicMaxTokens,
    }, 'Budget dinâmico de tokens aplicado');
  }

  return {
    ...llmConfig,
    maxTokens: dynamicMaxTokens,
    temperature: adjustedTemperature,
  };
}

function getAdaptiveRagParams(
  query: string,
  historyCount: number
): { limit: number; threshold: number } {
  const length = query.trim().length;
  let limit = 5;
  let threshold = 0.7;

  if (length > 800) {
    limit = 4;
    threshold = 0.72;
  }
  if (length > 1200) {
    limit = 3;
    threshold = 0.75;
  }
  if (length > 1800) {
    limit = 2;
    threshold = 0.8;
  }
  if (length > 2600) {
    limit = 1;
    threshold = 0.85;
  }

  if (historyCount > 8) {
    limit = Math.max(1, limit - 1);
  }

  return { limit, threshold };
}

type StoredMessage = { isFromUser: boolean; conteudo: string | null };

function normalizeStoredMessages(
  messages: Array<{ isFromUser: boolean | null; conteudo: string | null }>
): StoredMessage[] {
  return messages.map((msg) => ({
    isFromUser: Boolean(msg.isFromUser),
    conteudo: msg.conteudo,
  }));
}

function tokenizeForRelevance(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9áéíóúãõç]+/i)
    .filter((t) => t.length >= 3);
}

function toTokenSet(tokens: string[]): Set<string> {
  return new Set(tokens);
}

function buildBigrams(tokens: string[]): Set<string> {
  return new Set(
    tokens.slice(0, -1).map((t, idx) => `${t} ${tokens[idx + 1]}`)
  );
}

function computeRelevanceScore(message: string, userMessage: string): number {
  const messageTokens = tokenizeForRelevance(message);
  const userTokens = tokenizeForRelevance(userMessage);
  if (messageTokens.length === 0 || userTokens.length === 0) return 0;
  const messageTokenSet = toTokenSet(messageTokens);
  const userTokenSet = toTokenSet(userTokens);
  const messageBigrams = buildBigrams(messageTokens);
  const userBigrams = buildBigrams(userTokens);
  let overlap = 0;
  for (const token of messageTokenSet) {
    if (userTokenSet.has(token)) overlap += 1;
  }
  let bigramOverlap = 0;
  for (const bigram of messageBigrams) {
    if (userBigrams.has(bigram)) bigramOverlap += 1;
  }
  const unigramScore = overlap / Math.max(1, userTokenSet.size);
  const bigramScore = bigramOverlap / Math.max(1, userBigrams.size);
  return (unigramScore * 0.7) + (bigramScore * 0.3);
}

function buildRoutingText(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const ROUTING_TRADING_KEYWORDS = [
  'trading', 'trade', 'finanças', 'finance', 'investimento', 'invest', 'portfolio',
  'ações', 'stocks', 'futuros', 'futures', 'alavancagem', 'leverage', 'kucoin',
  'order', 'ordem', 'stop loss', 'take profit', 'btc', 'eth', 'market', 'limit',
] as const;

function computeRoutingScore(text: string, userMessage: string, profile: LlmContextProfile): number {
  const base = computeRelevanceScore(text, userMessage);
  if (profile !== 'trading') return base;
  const normalized = text.toLowerCase();
  const hasTradingKeyword = ROUTING_TRADING_KEYWORDS.some((k) => normalized.includes(k));
  const boost = hasTradingKeyword ? 0.06 : 0;
  return Math.min(1, base + boost);
}

function getRoutingThreshold(profile: LlmContextProfile): number {
  if (profile === 'trading') return 0.06;
  if (profile === 'analysis') return 0.1;
  return 0.12;
}

async function resolveSemanticRoute(params: {
  tenantId: string;
  userMessage: string;
}): Promise<{ agentId?: string; namespaceId?: string; score: number; source: 'agent' | 'namespace' | 'none'; profile: LlmContextProfile }> {
  const profile = detectContextProfile(params.userMessage);
  const threshold = getRoutingThreshold(profile);

  const agents = await db.query.agents.findMany({
    where: and(
      eq(schema.agents.tenantId, params.tenantId),
      eq(schema.agents.status, 'active')
    ),
  });

  let bestAgent: { id: string; namespaceId?: string | null; score: number } | null = null;
  for (const agent of agents) {
    const text = buildRoutingText([
      agent.nome,
      agent.slug,
      agent.descricao,
      agent.personalidade,
      agent.instrucoes,
      agent.capacidades ? agent.capacidades.join(' ') : null,
    ]);
    if (!text) continue;
    const score = computeRoutingScore(text, params.userMessage, profile);
    if (!bestAgent || score > bestAgent.score) {
      bestAgent = { id: agent.id, namespaceId: agent.namespaceId, score };
    }
  }

  if (bestAgent && bestAgent.score >= threshold) {
    let resolvedNamespaceId = bestAgent.namespaceId ?? undefined;
    if (!resolvedNamespaceId) {
      const namespaces = await db.query.namespaces.findMany({
        where: and(
          eq(schema.namespaces.tenantId, params.tenantId),
          eq(schema.namespaces.ativo, true)
        ),
      });
      let bestNamespace: { id: string; score: number } | null = null;
      for (const namespace of namespaces) {
        const text = buildRoutingText([
          namespace.nome,
          namespace.slug,
          namespace.descricao,
          namespace.contextoSistema,
        ]);
        if (!text) continue;
        const score = computeRoutingScore(text, params.userMessage, profile);
        if (!bestNamespace || score > bestNamespace.score) {
          bestNamespace = { id: namespace.id, score };
        }
      }
      if (bestNamespace && bestNamespace.score >= threshold) {
        resolvedNamespaceId = bestNamespace.id;
      }
    }
    return {
      agentId: bestAgent.id,
      namespaceId: resolvedNamespaceId,
      score: bestAgent.score,
      source: 'agent',
      profile,
    };
  }

  const namespaces = await db.query.namespaces.findMany({
    where: and(
      eq(schema.namespaces.tenantId, params.tenantId),
      eq(schema.namespaces.ativo, true)
    ),
  });

  let bestNamespace: { id: string; score: number } | null = null;
  for (const namespace of namespaces) {
    const text = buildRoutingText([
      namespace.nome,
      namespace.slug,
      namespace.descricao,
      namespace.contextoSistema,
    ]);
    if (!text) continue;
    const score = computeRoutingScore(text, params.userMessage, profile);
    if (!bestNamespace || score > bestNamespace.score) {
      bestNamespace = { id: namespace.id, score };
    }
  }

  if (bestNamespace && bestNamespace.score >= threshold) {
    const namespaceAgents = agents.filter((agent) => agent.namespaceId === bestNamespace.id);
    let bestAgentInNamespace: { id: string; score: number } | null = null;
    for (const agent of namespaceAgents) {
      const text = buildRoutingText([
        agent.nome,
        agent.slug,
        agent.descricao,
        agent.personalidade,
        agent.instrucoes,
        agent.capacidades ? agent.capacidades.join(' ') : null,
      ]);
      if (!text) continue;
      const score = computeRoutingScore(text, params.userMessage, profile);
      if (!bestAgentInNamespace || score > bestAgentInNamespace.score) {
        bestAgentInNamespace = { id: agent.id, score };
      }
    }
    return {
      agentId: bestAgentInNamespace?.id,
      namespaceId: bestNamespace.id,
      score: bestNamespace.score,
      source: 'namespace',
      profile,
    };
  }

  return { score: 0, source: 'none', profile };
}

function buildInternalServiceHeaders(params: { userId: string; tenantId: string; role: Role; customRoleId?: string | null }): Record<string, string> {
  const internal = generateInternalAuthHeaders({
    userId: params.userId,
    tenantId: params.tenantId,
    role: params.role,
    customRoleId: params.customRoleId ?? undefined,
  });
  const headers: Record<string, string> = {
    'X-Internal-Signature': internal['x-internal-signature'],
    'X-Internal-Timestamp': internal['x-internal-timestamp'],
    'X-Internal-User-Id': internal['x-internal-user-id'],
    'X-Internal-Role': internal['x-internal-role'],
  };
  if (internal['x-internal-tenant-id']) {
    headers['X-Internal-Tenant-Id'] = internal['x-internal-tenant-id'];
  }
  if (internal['x-internal-custom-role-id']) {
    headers['X-Internal-Custom-Role-Id'] = internal['x-internal-custom-role-id'];
  }
  return headers;
}

async function collectTrainingSample(params: {
  tenantId: string;
  namespaceId: string;
  conversationId?: string;
  source: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  rating?: number;
  userId: string;
  role: Role;
}): Promise<void> {
  if (!TRAINING_SERVICE_URL_FINAL) {
    logger.warn('TRAINING_SERVICE_URL não configurado - coleta de treinamento ignorada');
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const headers = buildInternalServiceHeaders({
      userId: params.userId,
      tenantId: params.tenantId,
      role: params.role,
    });

    const response = await fetch(`${TRAINING_SERVICE_URL_FINAL}/api/training/data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({
        tenantId: params.tenantId,
        namespaceId: params.namespaceId,
        conversationId: params.conversationId,
        source: params.source,
        messages: params.messages,
        rating: params.rating,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({
        status: response.status,
        error: errorText,
        source: params.source,
      }, 'Falha ao coletar dados de treinamento');
      return;
    }

    const trainingData = await response.json() as { trainingData?: { id: string }; isDuplicate?: boolean };
    logger.info({
      trainingDataId: trainingData.trainingData?.id,
      isDuplicate: trainingData.isDuplicate,
      source: params.source,
    }, 'Coleta de treinamento enviada');
  } catch (error) {
    logger.error({ error, source: params.source }, 'Erro ao coletar dados de treinamento');
  } finally {
    clearTimeout(timeoutId);
  }
}

function shouldAutoCollectTraining(params: {
  profile: LlmContextProfile;
  namespaceId?: string | null;
  userMessage: string;
  assistantResponse: string;
}): boolean {
  if (!TRAINING_AUTO_COLLECT_CHAT) return false;
  if (!params.namespaceId) return false;
  if (params.profile !== 'trading') return false;
  if (params.userMessage.trim().length === 0 || params.assistantResponse.trim().length === 0) return false;
  return true;
}

function buildHistoryMessages(
  history: StoredMessage[],
  maxTokens: number,
  userMessage: string,
  profile: LlmContextProfile
): LLMMessage[] {
  if (maxTokens <= 0) return [];
  const selected: LLMMessage[] = [];
  let totalTokens = 0;
  const relevanceThreshold = profile === 'trading'
    ? CHAT_HISTORY_RELEVANCE_THRESHOLD_TRADING
    : CHAT_HISTORY_RELEVANCE_THRESHOLD_GENERAL;
  const alwaysIncludeCount = profile === 'trading'
    ? CHAT_HISTORY_ALWAYS_INCLUDE_TRADING
    : CHAT_HISTORY_ALWAYS_INCLUDE_GENERAL;
  const minMessages = profile === 'trading'
    ? CHAT_HISTORY_MIN_MESSAGES_TRADING
    : CHAT_HISTORY_MIN_MESSAGES_GENERAL;
  const normalizedUser = userMessage.trim().toLowerCase();

  for (let i = 0; i < history.length; i += 1) {
    const msg = history[i];
    const content = msg.conteudo?.trim();
    if (!content) continue;
    const tokens = estimateTokensFromText(content);
    const isRecent = i < alwaysIncludeCount;
    const score = computeRelevanceScore(content, normalizedUser);
    const shouldInclude = isRecent || score >= relevanceThreshold || (minMessages > 0 && selected.length < minMessages);
    if (!shouldInclude) continue;
    if (totalTokens + tokens > maxTokens) {
      if (totalTokens === 0) {
        selected.push({
          role: msg.isFromUser ? 'user' : 'assistant',
          content,
        });
      }
      break;
    }
    selected.push({
      role: msg.isFromUser ? 'user' : 'assistant',
      content,
    });
    totalTokens += tokens;
  }

  if (selected.length === 0 && CHAT_HISTORY_FALLBACK_ENABLED && history.length > 0) {
    const fallback = history[0];
    const fallbackContent = fallback.conteudo?.trim();
    if (fallbackContent) {
      const tokens = estimateTokensFromText(fallbackContent);
      if (tokens <= maxTokens) {
        selected.push({
          role: fallback.isFromUser ? 'user' : 'assistant',
          content: fallbackContent,
        });
      }
    }
  }

  return selected.reverse();
}

function buildPromptMessages(params: {
  systemPrompt: string;
  userMessage: string;
  history: StoredMessage[];
  source: LlmSource;
}): LLMMessage[] {
  const profile = detectContextProfile(params.userMessage);
  const maxPromptTokens = getPromptTokenBudget(params.source, profile);
  const systemTokens = estimateTokensFromText(params.systemPrompt);
  const userTokens = estimateTokensFromText(params.userMessage);
  const remaining = Math.max(0, maxPromptTokens - systemTokens - userTokens);
  const historyMessages = buildHistoryMessages(params.history, remaining, params.userMessage, profile);

  const messages: LLMMessage[] = [
    { role: 'system', content: params.systemPrompt },
    ...historyMessages,
    { role: 'user', content: params.userMessage },
  ];

  return messages.filter((msg) => msg.content && msg.content.trim().length > 0);
}

function dropLeadingDuplicateUserMessage(
  history: StoredMessage[],
  userMessage: string
): StoredMessage[] {
  if (history.length === 0) return history;
  const first = history[0];
  if (!first.isFromUser) return history;
  const normalizedHistory = (first.conteudo || '').trim().toLowerCase();
  const normalizedUser = userMessage.trim().toLowerCase();
  if (normalizedHistory === normalizedUser) {
    return history.slice(1);
  }
  return history;
}

const REUSE_INTROS_PT = [
  'Você já perguntou isso há pouco. Segue a mesma resposta:',
  'A pergunta se repetiu. Mantendo consistência, segue a resposta anterior:',
  'Repetindo a resposta para manter a continuidade:',
] as const;

const GREETING_HINTS_PT = [
  'Se quiser, posso ajudar com algo específico.',
  'Se preferir, posso continuar de onde paramos.',
  'Me diga em que posso ajudar agora.',
] as const;

function pickDeterministicIntro(seed: string, options: readonly string[]): string {
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  const index = parseInt(hash.slice(0, 8), 16) % options.length;
  return options[index];
}

function buildReuseResponse(baseResponse: string, seed: string): string {
  const intro = pickDeterministicIntro(seed, REUSE_INTROS_PT);
  const normalizedBase = baseResponse.trim().toLowerCase();
  const normalizedIntro = intro.toLowerCase();
  if (normalizedBase.startsWith(normalizedIntro)) {
    return baseResponse;
  }
  return `${intro}\n\n${baseResponse}`;
}

function buildGreetingResponse(baseResponse: string, seed: string, shouldAugment: boolean): string {
  if (!shouldAugment) {
    return baseResponse;
  }
  const hint = pickDeterministicIntro(seed, GREETING_HINTS_PT);
  if (baseResponse.includes(hint)) {
    return baseResponse;
  }
  return `${baseResponse}\n\n${hint}`;
}

// ============================================================================
// Gate 2: SSOT de modelos suportados para Agents (LLM texto)
// ============================================================================
const ALLOWED_AGENT_LLM_MODEL_NAMES = [
  'Qwen2.5-7B-Instruct-AWQ',
] as const;

const LEGACY_AGENT_LLM_MODEL_NAMES = [
  'Mistral-7B-Instruct',
  'Mistral-7B-Instruct-AWQ',
  'Qwen2.5-VL-7B',
  'Qwen2.5-VL-7B-AWQ',
  'Qwen2.5-VL-7B-Instruct-AWQ',
  'Mixtral-8x7B',
] as const;

async function countAgentsWithUnsupportedLlmModel(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.agents)
    .where(
      and(
        sql`${schema.agents.modeloBase} is not null`,
        sql`${schema.agents.modeloBase} not in (${sql.join(
          ALLOWED_AGENT_LLM_MODEL_NAMES.map((v) => sql`${v}`),
          sql`, `
        )})`
      )
    );
  return Number(row?.count ?? 0);
}

class ClientInputError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, opts: { statusCode?: number; code?: string } = {}) {
    super(message);
    this.name = 'ClientInputError';
    this.statusCode = opts.statusCode ?? 400;
    this.code = opts.code ?? 'CLIENT_INPUT_ERROR';
  }
}

/**
 * Extrai configuração LLM de um agente
 * Usa valores padrão se agente não tiver configuração
 * 
 * @param agent - Agente opcional com configurações de modelo
 * @returns Configuração LLM para usar nas chamadas
 */
function getAgentLLMConfig(agent?: AgentConfig | null): LLMConfig {
  if (!agent) return {};
  
  return {
    temperature: agent.temperaturaModelo ?? undefined,
    maxTokens: agent.maxTokens ?? undefined,
    model: agent.modeloBase ? mapModelNameToGpuModel(agent.modeloBase) : undefined,
  };
}

/**
 * Mapeia nome amigável do modelo para o nome usado pelo runtime GPU (vLLM/OpenAI).
 * Gate 2: LLM (texto) usa Qwen2.5 7B AWQ; Vision via OpenAI.
 * 
 * @param modelName - Nome do modelo no banco (ex: "Qwen2.5-7B-Instruct-AWQ")
 * @returns Nome do modelo para o runtime (ex: repo Hugging Face)
 */
function mapModelNameToGpuModel(modelName: string): string {
  const normalized = modelName.trim();
  const modelMap: Record<string, string> = {
    // Texto (produção): Qwen2.5 7B Instruct (AWQ)
    'Qwen2.5-7B-Instruct-AWQ': 'Qwen/Qwen2.5-7B-Instruct-AWQ',
  };
  
  const mapped = modelMap[normalized];
  if (mapped) return mapped;

  // Não é permitido aceitar modelos legados e fazer "swap" silencioso.
  const isLegacy = (LEGACY_AGENT_LLM_MODEL_NAMES as readonly string[]).includes(normalized);
  logger.warn({ modelName: normalized }, 'modeloBase inválido para LLM (Gate 2)');
  throw new ClientInputError(
    isLegacy
      ? `modeloBase '${normalized}' é legado e não é suportado para LLM (texto) no Gate 2. ` +
          `Aplique a migração '0016_gate2_migrate_legacy_agent_models.sql' e/ou atualize o agente para 'Qwen2.5-7B-Instruct-AWQ'.`
      : `modeloBase '${normalized}' não é suportado para LLM (texto) no Gate 2. ` +
          `Atualize o agente para 'Qwen2.5-7B-Instruct-AWQ'.`,
    { code: isLegacy ? 'LEGACY_AGENT_LLM_MODEL' : 'INVALID_AGENT_LLM_MODEL' },
  );
}

const DEFAULT_VISION_IMAGE_PROMPT =
  'Você é um assistente especializado em Trading, Finanças, Contabilidade e Matemática. ' +
  'Analise a imagem enviada. Se for um gráfico (candles, indicadores), descreva padrões, tendência, suportes/resistências, ' +
  'possíveis sinais e riscos. Se houver texto na imagem, transcreva o que for legível. ' +
  'Se a imagem não for de trading, descreva objetivamente o conteúdo. Responda em PT-BR.';

type OpenAIResponsesApiResponse = {
  id?: string;
  model?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

function extractOutputTextFromResponsesApi(resp: OpenAIResponsesApiResponse | undefined): string | null {
  const output = resp?.output;
  if (!output || !Array.isArray(output)) return null;
  const parts: string[] = [];
  for (const item of output) {
    const content = item?.content;
    if (!content || !Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type === 'output_text' && typeof c.text === 'string' && c.text.trim().length > 0) {
        parts.push(c.text);
      }
    }
  }
  const joined = parts.join('\n').trim();
  return joined.length > 0 ? joined : null;
}

async function analyzeImageWithOpenAI(params: {
  imageDataUri: string;
  question: string;
}): Promise<{ text: string; model: string }> {
  const question = params.question.trim().length > 0 ? params.question.trim() : 'Descreva e analise esta imagem.';

  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY não configurada - Vision via OpenAI é obrigatória');
  }

  const imageBytes = Buffer.byteLength(params.imageDataUri, 'utf8');
  const imageKb = Math.round(imageBytes / 1024);
  logger.debug({ imageBytes, imageKb }, 'Tamanho do payload de imagem (Vision)');
  if (OPENAI_VISION_MAX_BYTES && imageBytes > OPENAI_VISION_MAX_BYTES) {
    throw new Error('Imagem excede o limite configurado para análise (OPENAI_VISION_MAX_BYTES)');
  }

  const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
  let response: globalThis.Response | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    response = await fetch(
      'https://api.openai.com/v1/responses',
      withOpenAiDispatcher({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4.1',
          max_output_tokens: 800,
          input: [
            {
              role: 'developer',
              content: [{ type: 'input_text', text: DEFAULT_VISION_IMAGE_PROMPT }],
            },
            {
              role: 'user',
              content: [
                { type: 'input_text', text: question },
                { type: 'input_image', image_url: params.imageDataUri, detail: 'auto' },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(60000),
      })
    );

    if (response.ok) {
      break;
    }

    const errText = await response.text().catch(() => '');
    const shouldRetry = retryableStatuses.has(response.status) && attempt < 2;
    logger.warn({
      status: response.status,
      requestId: response.headers.get('x-request-id'),
      error: errText,
      attempt,
      shouldRetry,
    }, 'OpenAI Vision retornou erro');

    if (!shouldRetry) {
      throw new Error(`OpenAI Vision error: ${response.status} - ${errText}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (!response || !response.ok) {
    throw new Error('OpenAI Vision falhou após tentativas de retry');
  }

  const payload = (await response.json()) as OpenAIResponsesApiResponse;
  const content = extractOutputTextFromResponsesApi(payload);
  if (!payload?.id || !payload?.model || !content) {
    throw new Error('Resposta inválida da OpenAI Responses API (Vision)');
  }

  return { text: content, model: payload.model };
}

async function callLlamaAPIInternal(request: LLMRequest): Promise<globalThis.Response> {
  // BUG FIX 25/12/2025: callLlamaAPIInternal NÃO suporta streaming
  // Streaming deve ser feito diretamente no endpoint/handler (ex: /api/chat/stream, WebSocket)
  // porque o GPU Manager Service consome o body ao fazer proxy, então não podemos retornar
  // um Response que possa ser lido via streamResponse()
  if (request.stream) {
    throw new Error('callLlamaAPIInternal não suporta streaming - use proxy direto no endpoint');
  }
  
  const timeout = LLM_SYNC_TIMEOUT;
  
  // BUG FIX 02/01/2026: Usar configuração do agente ou valores padrão
  const config = request.config || {};
  const temperature = config.temperature ?? DEFAULT_LLM_CONFIG.temperature;
  const maxTokens = config.maxTokens ?? DEFAULT_LLM_CONFIG.maxTokens;
  const model = config.model || DEFAULT_LLM_CONFIG.model;
  const priority = request.priority ?? GpuRequestPriority.CRITICAL;
  
  // Não-streaming: usar GPU Manager Service (fila priorizada, monitoramento VRAM)
  {
    // Não-streaming: usar GPU Manager Service (fila priorizada, monitoramento VRAM)
    try {
      // Gate 2: LLM (texto) via GPU Manager
      const gpuResponse = await requestGpu({
        serviceType: GpuServiceType.LLM,
        endpoint: '/v1/chat/completions',
        method: 'POST',
        priority,
        timeout,
        body: {
          model,
          messages: request.messages,
          max_tokens: maxTokens,
          temperature,
          stream: false,
        },
      });

      if (!gpuResponse.success || !gpuResponse.data) {
        throw new Error(gpuResponse.error || 'Erro desconhecido na API LLM');
      }

      // BUG FIX 25/12/2025: Validar estrutura da resposta antes de type assertion
      // BUG FIX 25/12/2025: typeof null === 'object' em JavaScript, então precisa verificar explicitamente
      // A verificação anterior (!gpuResponse.data) já deveria pegar null, mas adicionar verificação explícita
      // torna o código mais defensivo e previne crashes caso a verificação anterior falhe
      if (gpuResponse.data === null || typeof gpuResponse.data !== 'object' || Array.isArray(gpuResponse.data)) {
        throw new Error('Resposta inválida do GPU Manager: data não é um objeto válido');
      }
      
      const responseData = gpuResponse.data as LLMResponse;
      
      // Validar estrutura esperada
      if (!responseData.choices || !Array.isArray(responseData.choices) || responseData.choices.length === 0) {
        throw new Error('Resposta inválida do GPU Manager: choices não encontrado ou vazio');
      }
      
      return new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Timeout')) {
        logger.warn({ timeout }, 'Chamada LLM abortada por timeout');
        throw new Error(`Timeout de ${timeout / 1000}s excedido na chamada LLM`);
      }
      throw error;
    }
  }
}

const gpuManagerBreaker = createCircuitBreaker(callLlamaAPIInternal, {
  name: 'gpu-manager-llm',
  ...CIRCUIT_BREAKER_PRESETS.gpuLLM,
});

// Instrumentar circuit breaker com métricas Prometheus
instrumentCircuitBreaker(metrics, 'gpu-manager-llm', gpuManagerBreaker as unknown as Parameters<typeof instrumentCircuitBreaker>[2]);

// Mensagem de fallback quando LLM está indisponível (graceful degradation)
const LLM_FALLBACK_MESSAGE = 'Desculpe, estou temporariamente indisponível. Por favor, tente novamente em alguns instantes. Se o problema persistir, entre em contato com o suporte.';

// BUG FIX 26/12/2025: streamFallback removido - não usado com arquitetura GPU Manager Service
// Fallback agora é tratado diretamente no handler com mensagem de erro apropriada

/**
 * Chama a API LLM via GPU Manager Service
 * 
 * @param messages - Array de mensagens no formato LLM
 * @param stream - Se true, retorna async generator (NÃO SUPORTADO - use proxy direto)
 * @param config - Configuração opcional do LLM (temperatura, maxTokens, modelo)
 * 
 * BUG FIX 02/01/2026: Agora aceita configuração do agente para temperatura e maxTokens
 */
async function callLlamaAPI(
  messages: LLMMessage[],
  stream = false,
  config?: LLMConfig,
  priority?: GpuRequestPriority
): Promise<string | AsyncGenerator<string>> {
  // BUG FIX 25/12/2025: callLlamaAPI NÃO suporta streaming
  // Streaming deve ser feito diretamente no endpoint/handler usando proxy direto do GPU Manager Service
  // porque o GPU Manager Service consome o body ao fazer proxy
  if (stream) {
    throw new Error('callLlamaAPI não suporta streaming - use proxy direto no endpoint/handler');
  }
  
  const model = config?.model || DEFAULT_LLM_CONFIG.model;
  try {
    const response = await gpuManagerBreaker.fire({ messages, stream: false, config, priority }) as globalThis.Response;
    const data = await response.json() as LLMResponse;
    const content = data.choices[0]?.message?.content || '';
    recordLlmTokenUsage({
      model,
      promptTokens: estimateTokensFromMessages(messages),
      generatedTokens: estimateTokensFromText(content),
    });
    return content;
  } catch (error) {
    // RESILIÊNCIA: Graceful degradation quando LLM está indisponível (Best Practices 2025)
    // Retorna mensagem amigável ao invés de erro técnico
    if (error instanceof Error) {
      if (error.message.includes('Breaker is open')) {
        logger.warn('Circuit breaker aberto - LLM temporariamente indisponível');
        return LLM_FALLBACK_MESSAGE;
      }
      if (error.message.includes('Timeout') || error.name === 'AbortError') {
        logger.warn({ error: error.message }, 'Timeout na chamada LLM');
        return LLM_FALLBACK_MESSAGE;
      }
    }
    logger.error({ error }, 'Erro inesperado na chamada LLM');
    return LLM_FALLBACK_MESSAGE;
  }
}

/**
 * BUG FIX 25/12/2025: streamResponse NÃO deve ser usado - GPU Manager Service consome o body
 * Esta função está mantida apenas para compatibilidade, mas NÃO deve ser chamada
 * Para streaming, use proxyStreamFromGpuManager() que faz proxy direto do GPU Manager Service
 */
// BUG FIX 26/12/2025: Função removida - GPU Manager Service consome o body diretamente
// Para streaming, use proxyStreamFromGpuManager() que faz proxy direto do GPU Manager Service
// Função streamResponse removida pois não é mais necessária com a arquitetura GPU Manager Service

/**
 * Faz proxy do stream do GPU Manager Service para WebSocket ou HTTP SSE
 * BUG FIX 25/12/2025: Função reutilizável para streaming via GPU Manager Service
 * BUG FIX 02/01/2026: Agora aceita configuração do agente para temperatura e maxTokens
 * 
 * @param llmMessages Mensagens para enviar ao LLM
 * @param onChunk Callback chamado para cada chunk de conteúdo (para WebSocket: ws.send)
 * @param onDone Callback chamado quando stream termina (para WebSocket: salvar mensagem)
 *                 BUG FIX 25/12/2025: Suporta callbacks async para operações de banco de dados
 *                 BUG FIX 25/12/2025: Recebe fullResponse como parâmetro para evitar closure sobre variável vazia
 * @param config Configuração opcional do LLM (temperatura, maxTokens, modelo)
 * @returns Promise que resolve com a resposta completa (concatenada)
 */
async function proxyStreamFromGpuManager(
  llmMessages: LLMMessage[],
  onChunk: (content: string) => void,
  onDone?: (fullResponse: string) => Promise<void> | void,
  config?: LLMConfig,
  priority: GpuRequestPriority = GpuRequestPriority.CRITICAL
): Promise<string> {
  // BUG FIX 02/01/2026: Usar configuração do agente ou valores padrão
  const temperature = config?.temperature ?? DEFAULT_LLM_CONFIG.temperature;
  const maxTokens = config?.maxTokens ?? DEFAULT_LLM_CONFIG.maxTokens;
  const model = config?.model || DEFAULT_LLM_CONFIG.model;

  // ============================================================================
  // MÉTRICAS LLM (enterprise, modelo-agnóstico)
  // ============================================================================
  const llmType = 'chat';
  const startNs = process.hrtime.bigint();
  let observedTtft = false;
  let requestStatus: 'success' | 'error' | 'fallback' = 'error';
  const promptTokens = estimateTokensFromMessages(llmMessages);
  let generatedTokensRecorded = false;
  
  // BUG FIX 26/12/2025: Usar requestGpuStream centralizado de @alice/shared-utils
  // Remove duplicação de GPU_MANAGER_URL e validação de INTERNAL_API_SECRET
  // requestGpuStream já faz fail-fast da secret e usa a URL correta
  // Gate 2: LLM (texto) via GPU Manager
  // CRITICAL FIX 13/01/2026: Tratamento graceful de falha de GPU
  let gpuResponse;
  try {
    gpuResponse = await requestGpuStream({
      serviceType: GpuServiceType.LLM,
      priority, // Prioridade configurável por tipo de mensagem
      endpoint: '/v1/chat/completions',
      method: 'POST',
      body: {
        model,
        messages: llmMessages,
        max_tokens: maxTokens,
        temperature,
        stream: true,
      },
      timeout: 60000,
    });
    recordLlmTokenUsage({ model, promptTokens });
  } catch (gpuError) {
    logger.error({ 
      error: gpuError instanceof Error ? gpuError.message : String(gpuError),
      stack: gpuError instanceof Error ? gpuError.stack : undefined,
    }, 'GPU Manager Service indisponível');
    
    // CORREÇÃO 13/01/2026: Retornar mensagem amigável ao invés de crashar
    // GPU pode estar reiniciando após correção de bugs (ex: vLLM profile_run crash)
    const errorMessage = 'Desculpe, o serviço de LLM está temporariamente indisponível. ' +
      'Por favor, tente novamente em alguns minutos.';
    
    // Enviar mensagem de erro via chunk callback
    onChunk(errorMessage);

    // Métricas: fallback (serviço indisponível)
    requestStatus = 'fallback';
    metrics.llm.fallbacksTotal.inc({ reason: 'gpu_unavailable' });
    metrics.llm.requestsTotal.inc({ model, type: llmType, status: requestStatus });
    metrics.llm.inferenceDuration.observe({ model, type: llmType }, Number(process.hrtime.bigint() - startNs) / 1e9);
    
    // Chamar onDone com a mensagem de erro completa
    if (onDone) {
      try {
        await onDone(errorMessage);
      } catch (onDoneError) {
        logger.error({ error: onDoneError }, 'Erro ao executar callback onDone durante tratamento de erro de GPU');
      }
    }
    
    // Retornar mensagem de erro ao invés de lançar exceção
    return errorMessage;
  }
  
  // BUG FIX 25/12/2025: Fazer proxy do stream diretamente do GPU Manager Service
  // requestGpuStream já validou response.ok e response.body
  const reader = gpuResponse.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullResponse = '';
  let onDoneCalled = false; // Guard para garantir que onDone seja chamado apenas uma vez
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      // BUG FIX 25/12/2025: Flag para indicar que [DONE] foi encontrado
      // Não retornar imediatamente - processar todas as linhas antes para não perder chunks
      let foundDone = false;
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            foundDone = true;
            // Não retornar imediatamente - continuar processando linhas restantes
            // para garantir que nenhum chunk seja perdido
            continue;
          }
          
          try {
            const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              // TTFT: observar apenas no primeiro token útil do stream
              if (!observedTtft) {
                const ttftSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
                metrics.llm.ttftDuration.observe({ model, type: llmType }, ttftSeconds);
                observedTtft = true;
              }
              fullResponse += content;
              onChunk(content);
            }
          } catch {
            // Ignorar erros de parse de linhas inválidas
          }
        }
      }
      
      // Se [DONE] foi encontrado, chamar onDone e retornar após processar todas as linhas
      if (foundDone) {
        if (onDone && !onDoneCalled) {
          onDoneCalled = true;
          await onDone(fullResponse);
        }
        requestStatus = 'success';
        if (!generatedTokensRecorded) {
          recordLlmTokenUsage({
            model,
            promptTokens: 0,
            generatedTokens: estimateTokensFromText(fullResponse),
          });
          generatedTokensRecorded = true;
        }
        metrics.llm.requestsTotal.inc({ model, type: llmType, status: requestStatus });
        metrics.llm.inferenceDuration.observe({ model, type: llmType }, Number(process.hrtime.bigint() - startNs) / 1e9);
        return fullResponse;
      }
    }
    
    // BUG FIX 25/12/2025: Aguardar callback async para evitar race conditions
    // Callback pode fazer operações de banco de dados que precisam ser completadas
    // BUG FIX 25/12/2025: Passar fullResponse como parâmetro para evitar closure sobre variável vazia
    if (onDone && !onDoneCalled) {
      onDoneCalled = true;
      await onDone(fullResponse);
    }
    requestStatus = 'success';
    if (!generatedTokensRecorded) {
      recordLlmTokenUsage({
        model,
        promptTokens: 0,
        generatedTokens: estimateTokensFromText(fullResponse),
      });
      generatedTokensRecorded = true;
    }
    metrics.llm.requestsTotal.inc({ model, type: llmType, status: requestStatus });
    metrics.llm.inferenceDuration.observe({ model, type: llmType }, Number(process.hrtime.bigint() - startNs) / 1e9);
    return fullResponse;
  } catch (error) {
    logger.error({ error }, 'Erro ao fazer proxy de stream do GPU Manager Service');
    // BUG FIX 25/12/2025: Garantir que onDone seja chamado mesmo em caso de erro
    // Importante para HTTP SSE onde onDone fecha a resposta (res.end())
    // Sem isso, o cliente HTTP fica pendurado indefinidamente
    if (onDone && !onDoneCalled) {
      onDoneCalled = true;
      try {
        await onDone(fullResponse); // Passar fullResponse parcial (pode estar vazio em caso de erro precoce)
      } catch (onDoneError) {
        logger.error({ error: onDoneError }, 'Erro ao executar callback onDone durante tratamento de erro');
      }
    }

    // Métricas: erro no streaming
    requestStatus = 'error';
    metrics.llm.requestsTotal.inc({ model, type: llmType, status: requestStatus });
    metrics.llm.inferenceDuration.observe({ model, type: llmType }, Number(process.hrtime.bigint() - startNs) / 1e9);
    throw error;
  } finally {
    // BUG FIX 25/12/2025: Garantir que reader seja liberado SEMPRE, mesmo em caso de erro ou early return
    // O finally block sempre executa, mesmo quando há return statements dentro do try block
    // Isso garante que o lock do ReadableStream seja sempre liberado, prevenindo vazamentos de recursos
    try {
      reader.releaseLock();
    } catch (releaseError) {
      // Se releaseLock() falhar (ex: já foi liberado ou reader foi cancelado), apenas logar
      // Não propagar erro para não mascarar erros originais
      logger.warn({ error: releaseError }, 'Erro ao liberar lock do reader (pode já estar liberado)');
    }
  }
}

// ============================================================================
// CIRCUIT BREAKER - Integrations Service (Regra 16 - Best Practices 2025)
// Usado para comunicação cross-service segura (envio WhatsApp, etc.)
// SEGURANÇA: Autenticação HMAC obrigatória para chamadas internas (OWASP 2025)
// ============================================================================

interface IntegrationsWhatsAppRequest {
  to: string;
  message: string;
  conversationId?: string;
  mediaUrl?: string;
  tenantId?: string;
  userId?: string;
}

interface IntegrationsWhatsAppResponse {
  success: boolean;
  messageSid?: string;
  error?: string;
}

// Usa CIRCUIT_BREAKER_PRESETS.integrationsService (Regra 2 - Não Duplicar)

// Timeout para chamadas cross-service (15 segundos - Best Practices 2025)
const CROSS_SERVICE_TIMEOUT = 15000;

async function sendWhatsAppMessageInternal(
  request: IntegrationsWhatsAppRequest
): Promise<IntegrationsWhatsAppResponse> {
  // SEGURANÇA: AbortController com timeout para prevenir requisições penduradas (Regra 16)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CROSS_SERVICE_TIMEOUT);
  
  try {
    // SEGURANÇA: Gerar headers HMAC para autenticação service-to-service (OWASP 2025)
    // Se INTERNAL_API_SECRET não configurado, logs warning mas continua (graceful degradation em dev)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    if (isInternalAuthEnabled() && request.userId && request.tenantId) {
      // Service-to-service usa role 'super_admin' para acesso privilegiado
      const internalHeaders = generateInternalAuthHeaders({
        userId: request.userId,
        tenantId: request.tenantId,
        role: 'super_admin',
      });
      // Adiciona headers HMAC ao objeto
      headers['x-internal-signature'] = internalHeaders['x-internal-signature'];
      headers['x-internal-timestamp'] = internalHeaders['x-internal-timestamp'];
      headers['x-internal-user-id'] = internalHeaders['x-internal-user-id'];
      headers['x-internal-role'] = internalHeaders['x-internal-role'];
      if (internalHeaders['x-internal-tenant-id']) {
        headers['x-internal-tenant-id'] = internalHeaders['x-internal-tenant-id'];
      }
    } else if (process.env.NODE_ENV === 'production') {
      // Em produção, autenticação é OBRIGATÓRIA
      logger.warn({
        hasSecret: isInternalAuthEnabled(),
        hasUserId: !!request.userId,
        hasTenantId: !!request.tenantId,
      }, 'Chamada cross-service sem autenticação HMAC em produção');
    }
    
    const response = await fetch(`${INTEGRATIONS_SERVICE_URL_FINAL}/api/integrations/twilio/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        to: request.to,
        message: request.message,
        conversationId: request.conversationId,
        mediaUrl: request.mediaUrl,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro ao enviar WhatsApp via Integrations Service: ${errorText}`);
    }

    return await response.json() as IntegrationsWhatsAppResponse;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn('Chamada ao Integrations Service abortada por timeout');
      throw new Error('Timeout na comunicação com Integrations Service');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

const integrationsServiceBreaker = createCircuitBreaker(sendWhatsAppMessageInternal, {
  name: 'integrations-service',
  ...CIRCUIT_BREAKER_PRESETS.integrationsService,
});

/**
 * Envia mensagem via WhatsApp através do Integrations Service
 * Usa circuit breaker para resiliência (Regra 16)
 * 
 * @param to - Número de telefone do destinatário
 * @param message - Conteúdo da mensagem
 * @param conversationId - ID da conversa (opcional, para persistência)
 * @returns Resultado do envio com messageSid do Twilio
 */
async function sendWhatsAppMessage(
  to: string, 
  message: string, 
  conversationId?: string
): Promise<IntegrationsWhatsAppResponse> {
  try {
    const result = await integrationsServiceBreaker.fire({
      to,
      message,
      conversationId,
    }) as IntegrationsWhatsAppResponse;
    
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      logger.warn('Circuit breaker aberto - Integrations Service indisponível');
      return {
        success: false,
        error: 'Serviço de WhatsApp temporariamente indisponível. Tente novamente em alguns segundos.',
      };
    }
    
    logger.error({ error }, 'Erro ao enviar mensagem WhatsApp');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  }
}

/**
 * Retorna estatísticas do circuit breaker do Integrations Service
 * Usado no endpoint /api/chat/health para monitoramento completo
 */
function getIntegrationsBreakerStats() {
  return {
    state: integrationsServiceBreaker.opened ? 'open' : (integrationsServiceBreaker.halfOpen ? 'half-open' : 'closed'),
    stats: integrationsServiceBreaker.stats,
  };
}

// ============================================================================
// TRADING INTEGRATION - Integrations Service (Regra 6 - Enterprise Real)
// ============================================================================

interface TradingCommandResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

type AgenticTaskType = 'document' | 'report' | 'accounting' | 'planning';
type AgenticTaskMode = 'create' | 'update';

interface AgenticTaskDetection {
  isTaskRequest: boolean;
  taskType?: AgenticTaskType;
  mode?: AgenticTaskMode;
  title?: string;
  instructions?: string;
  documentId?: string;
  reason?: string;
}

/**
 * Tipo de comando de trading (importado do parser)
 */
type TradingCommandType =
  | 'buy'
  | 'sell'
  | 'close_position'
  | 'cancel_order'
  | 'status'
  | 'positions'
  | 'orders'
  | 'pause_trading'
  | 'resume_trading'
  | 'takeover'
  | 'handback'
  | 'set_stop_loss'
  | 'set_take_profit'
  | 'unknown';

type ConversationApprovalPolicy = 'always_confirm' | 'confirm_risky' | 'never_confirm';
type TradingCommandRisk = 'low' | 'medium' | 'high';

interface ParsedTradingCommand {
  type: TradingCommandType;
  isTrading: boolean;
  amount?: number;
  symbol?: string;
  orderId?: string;
  price?: number;
  leverage?: number;
  stopLoss?: number;
  takeProfit?: number;
  /** Direção da ordem (buy/sell) - CORREÇÃO 18/12/2025: Campo adicionado para stop orders */
  side?: 'buy' | 'sell';
  /** Tipo de posição (long/short) */
  positionType?: 'long' | 'short';
  confidence: number;
  rawText: string;
  matchedPattern?: string;
}

function getTradingCommandRisk(command: ParsedTradingCommand): TradingCommandRisk {
  switch (command.type) {
    case 'status':
    case 'positions':
    case 'orders':
      return 'low';
    case 'pause_trading':
    case 'resume_trading':
    case 'takeover':
    case 'handback':
      return 'medium';
    case 'buy':
    case 'sell':
    case 'close_position':
    case 'cancel_order':
    case 'set_stop_loss':
    case 'set_take_profit':
    case 'unknown':
    default:
      return 'high';
  }
}

function shouldRequireTradingConfirmation(
  command: ParsedTradingCommand,
  policy: ConversationApprovalPolicy
): boolean {
  void getTradingCommandRisk(command);
  void policy;
  // Regra enterprise: qualquer operação de trading exige aprovação explícita.
  return true;
}

function shouldRequireAgenticConfirmation(
  taskType: AgenticTaskType,
  mode: AgenticTaskMode,
  policy: ConversationApprovalPolicy
): boolean {
  void taskType;
  void policy;
  // Regra enterprise: qualquer ação de escrita/modificação exige aprovação explícita.
  return mode === 'create' || mode === 'update';
}

/**
 * Gera hint amigável para campos faltando em comandos de trading
 * 
 * CORREÇÃO 17/12/2025: Adicionado para ajudar usuário quando comando está incompleto
 * Ex: "cancele ordem" sem orderId → sugere formato correto
 * 
 * @param commandType - Tipo do comando
 * @param missingFields - Campos que faltam
 * @param language - Idioma da resposta
 * @returns String com dica para o usuário
 */
function getValidationHint(
  commandType: string, 
  missingFields: string[], 
  language: 'pt' | 'en'
): string {
  const hints: Record<string, Record<string, { pt: string; en: string }>> = {
    buy: {
      amount: {
        pt: 'Especifique a quantidade. Ex: "compre 0.01 BTC"',
        en: 'Specify the amount. Ex: "buy 0.01 BTC"',
      },
    },
    sell: {
      amount: {
        pt: 'Especifique a quantidade. Ex: "venda 0.01 BTC"',
        en: 'Specify the amount. Ex: "sell 0.01 BTC"',
      },
    },
    cancel_order: {
      orderId: {
        pt: 'Especifique o ID da ordem. Ex: "cancele ordem abc12345-..."',
        en: 'Specify the order ID. Ex: "cancel order abc12345-..."',
      },
    },
    set_stop_loss: {
      stopLoss: {
        pt: 'Especifique o preço. Ex: "stop loss em 45000"',
        en: 'Specify the price. Ex: "stop loss at 45000"',
      },
    },
    set_take_profit: {
      takeProfit: {
        pt: 'Especifique o preço. Ex: "take profit em 50000"',
        en: 'Specify the price. Ex: "take profit at 50000"',
      },
    },
  };

  // Tentar encontrar hint específico para o campo faltando
  for (const field of missingFields) {
    if (hints[commandType]?.[field]) {
      return hints[commandType][field][language];
    }
  }

  // Hint genérico
  const generic = {
    pt: `Campos necessários: ${missingFields.join(', ')}`,
    en: `Required fields: ${missingFields.join(', ')}`,
  };
  return generic[language];
}

/**
 * Executa comando de trading via Integrations Service
 * Regra 6 CLAUDE.md: Integração real enterprise (PROIBIDO stubs/mocks)
 * Regra 16 CLAUDE.md: Circuit breaker para resiliência
 * 
 * @param userId - ID do usuário
 * @param tenantId - ID do tenant
 * @param command - Comando parseado
 * @returns Resultado da execução
 */
async function executeTradingCommand(
  userId: string,
  tenantId: string,
  command: ParsedTradingCommand
): Promise<TradingCommandResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CROSS_SERVICE_TIMEOUT);

  try {
    // Gerar headers de autenticação service-to-service
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (isInternalAuthEnabled()) {
      const internalHeaders = generateInternalAuthHeaders({
        userId,
        tenantId,
        role: 'super_admin', // Service-to-service usa role privilegiada
      });
      headers['x-internal-signature'] = internalHeaders['x-internal-signature'];
      headers['x-internal-timestamp'] = internalHeaders['x-internal-timestamp'];
      headers['x-internal-user-id'] = internalHeaders['x-internal-user-id'];
      headers['x-internal-role'] = internalHeaders['x-internal-role'];
      if (internalHeaders['x-internal-tenant-id']) {
        headers['x-internal-tenant-id'] = internalHeaders['x-internal-tenant-id'];
      }
    }

    // Mapear comando para endpoint e payload do Integrations Service
    let endpoint = '';
    let method = 'GET';
    let body: Record<string, unknown> | undefined;

    switch (command.type) {
      case 'buy':
      case 'sell':
        endpoint = '/api/integrations/trading/orders';
        method = 'POST';
        body = {
          side: command.type,
          orderType: 'market',
          size: command.amount || 0.001, // Mínimo BTC
          symbol: command.symbol || 'XBTUSDTM',
          leverage: command.leverage,
          stopLoss: command.stopLoss,
          takeProfit: command.takeProfit,
        };
        break;

      case 'close_position':
        endpoint = '/api/integrations/trading/positions';
        method = 'DELETE';
        body = { symbol: command.symbol || 'XBTUSDTM' };
        break;

      case 'cancel_order':
        endpoint = `/api/integrations/trading/orders/${command.orderId || ''}`;
        method = 'DELETE';
        break;

      case 'status':
        endpoint = '/api/integrations/trading/status';
        break;

      case 'positions':
        endpoint = '/api/integrations/trading/positions';
        break;

      case 'orders':
        endpoint = '/api/integrations/trading/orders';
        break;

      case 'set_stop_loss':
      case 'set_take_profit':
        // CORREÇÃO AUDITORIA 17/12/2025: Usar endpoint correto POST /api/v1/st-orders da KuCoin
        // Conforme documentação oficial: https://www.kucoin.com/docs-new/rest/futures-trading/orders/add-take-profit-and-stop-loss-order
        // Endpoint correto no integrations-service: POST /api/integrations/trading/stop-orders
        endpoint = '/api/integrations/trading/stop-orders';
        method = 'POST';
        {
          // CORREÇÃO AUDITORIA 17/12/2025: Determinar side correto baseado na posição
          // BUG: command.side era sempre undefined, causando fallback incorreto para 'sell'
          // - Para LONG positions: stop/TP fecha com SELL
          // - Para SHORT positions: stop/TP fecha com BUY
          let determinedSide: 'buy' | 'sell' = command.side || 'sell';
          
          // Se side não foi especificado no comando, tentar inferir da posição atual
          if (!command.side) {
            try {
              // Buscar posições atuais para determinar o side correto
              const positionsUrl = `${INTEGRATIONS_SERVICE_URL_FINAL}/api/integrations/trading/positions`;
              const positionsResponse = await fetch(positionsUrl, {
                method: 'GET',
                headers,
                signal: AbortSignal.timeout(10000), // 10s timeout para consulta
              });
              
              if (positionsResponse.ok) {
                const positionsData = await positionsResponse.json() as { success: boolean; data: Array<{ symbol: string; currentQty: number }> };
                if (positionsData.success && positionsData.data) {
                  const symbol = command.symbol || 'XBTUSDTM';
                  const position = positionsData.data.find(p => p.symbol === symbol);
                  
                  if (position && position.currentQty !== 0) {
                    // currentQty > 0 = LONG position → fechar com SELL
                    // currentQty < 0 = SHORT position → fechar com BUY
                    determinedSide = position.currentQty > 0 ? 'sell' : 'buy';
                    logger.debug({
                      symbol,
                      currentQty: position.currentQty,
                      determinedSide,
                    }, 'Side inferido da posição atual para stop order');
                  }
                }
              }
            } catch (positionError) {
              // Se falhar a consulta, manter o fallback (sell)
              // Isso é seguro porque a maioria das posições são long
              logger.warn(
                { error: positionError instanceof Error ? positionError.message : 'Erro desconhecido' },
                'Falha ao consultar posição para inferir side, usando fallback sell'
              );
            }
          }
          
          body = {
            symbol: command.symbol || 'XBTUSDTM',
            side: determinedSide,
            size: command.amount || 1,
            stopLoss: command.stopLoss,
            takeProfit: command.takeProfit,
            leverage: command.leverage,
          };
        }
        break;

      case 'pause_trading':
      case 'resume_trading':
      case 'takeover':
      case 'handback':
        endpoint = '/api/integrations/trading/control';
        method = 'POST';
        body = {
          action: command.type === 'pause_trading' || command.type === 'takeover' ? 'takeover' : 'handback',
          reason: `Comando via chat: ${command.rawText}`,
        };
        break;

      default:
        return {
          success: false,
          error: `Comando não suportado: ${command.type}`,
        };
    }

    const url = `${INTEGRATIONS_SERVICE_URL_FINAL}${endpoint}`;
    
    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };

    // CORREÇÃO AUDITORIA 17/12/2025: Incluir DELETE na lista de métodos que enviam body
    // Bug: close_position usava DELETE com body mas body era descartado silenciosamente
    // porque a condição só permitia POST, PUT, PATCH. O servidor nunca recebia o symbol
    // da posição a fechar. DELETE com body é suportado por APIs modernas (RFC 7231 não proíbe).
    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;
      try {
        const errorJson = JSON.parse(errorText) as { error?: string };
        errorMessage = errorJson.error || errorText;
      } catch {
        errorMessage = errorText;
      }
      
      return {
        success: false,
        error: `Erro no trading: ${errorMessage}`,
      };
    }

    const data = await response.json() as Record<string, unknown>;
    
    return {
      success: true,
      data,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn({ command: command.type }, 'Chamada de trading abortada por timeout');
      return {
        success: false,
        error: 'Timeout na comunicação com o serviço de trading',
      };
    }

    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ command: command.type, error: errorMessage }, 'Erro ao executar comando de trading');
    
    return {
      success: false,
      error: errorMessage,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callIntegrationsService<T>(params: {
  endpoint: string;
  method: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  auth: AuthContext;
}): Promise<T> {
  const internalHeaders = buildInternalServiceHeaders({
    userId: params.auth.userId,
    tenantId: params.auth.tenantId ?? '',
    role: params.auth.role,
    customRoleId: params.auth.customRoleId,
  });

  const response = await fetch(`${INTEGRATIONS_SERVICE_URL_FINAL}${params.endpoint}`, {
    method: params.method,
    headers: {
      'Content-Type': 'application/json',
      ...internalHeaders,
    },
    body: params.body ? JSON.stringify(params.body) : undefined,
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Integrations error: ${response.status} - ${errText}`);
  }

  return response.json() as Promise<T>;
}

// ============================================================================
// AGENTIC TASKS - Documentos/Relatórios/Contabilidade/Planejamento
// ============================================================================

const AGENTIC_TASK_TITLES: Record<AgenticTaskType, string> = {
  document: 'Documento',
  report: 'Relatório',
  accounting: 'Documento Contábil',
  planning: 'Planejamento',
};

function buildAgenticTaskTitle(taskType: AgenticTaskType, titleOverride?: string): string {
  if (titleOverride && titleOverride.trim().length > 0) {
    return titleOverride.trim();
  }
  const dateLabel = new Date().toISOString().split('T')[0];
  return `${AGENTIC_TASK_TITLES[taskType]} ${dateLabel}`;
}

async function resolveAgenticDocumentId(params: {
  tenantId: string;
  conversationId?: string | null;
  explicitDocumentId?: string;
}): Promise<string | null> {
  if (params.explicitDocumentId) {
    return params.explicitDocumentId;
  }

  if (!params.conversationId) {
    return null;
  }

  const recentTasks = await db.query.agenticTasks.findMany({
    where: and(
      eq(schema.agenticTasks.tenantId, params.tenantId),
      eq(schema.agenticTasks.conversationId, params.conversationId)
    ),
    orderBy: [desc(schema.agenticTasks.createdAt)],
    limit: 5,
  });

  for (const task of recentTasks) {
    const docId = (task.result as { documentId?: string } | null | undefined)?.documentId;
    if (docId) {
      return docId;
    }
  }

  return null;
}

async function executeAgenticTask(params: {
  tenantId: string;
  userId: string;
  role: Role;
  conversationId?: string | null;
  namespaceId?: string | null;
  agentId?: string | null;
  actionRequestId?: string | null;
  taskType: AgenticTaskType;
  mode: AgenticTaskMode;
  instructions: string;
  title?: string;
  documentId?: string;
  sourceMessageId?: string;
}): Promise<{ success: boolean; taskId?: string; documentId?: string; title?: string; error?: string }> {
  const startedAt = new Date();
  const resolvedTitle = buildAgenticTaskTitle(params.taskType, params.title);

  const [taskRecord] = await db.insert(schema.agenticTasks).values({
    tenantId: params.tenantId,
    conversationId: params.conversationId ?? undefined,
    actionRequestId: params.actionRequestId ?? undefined,
    userId: params.userId,
    agentId: params.agentId ?? undefined,
    type: params.taskType,
    status: 'processing',
    payload: {
      taskType: params.taskType,
      title: resolvedTitle,
      instructions: params.instructions,
      sourceMessageId: params.sourceMessageId,
    },
    startedAt,
    updatedAt: startedAt,
  }).returning();

  if (!taskRecord) {
    return { success: false, error: 'Falha ao registrar tarefa agentic' };
  }

  try {
    const assistantSettings = await getAssistantSettingsForTenant(params.tenantId);
    const agentConfig = params.agentId ? await db.query.agents.findFirst({ where: eq(schema.agents.id, params.agentId) }) : null;
    let systemPrompt = buildSystemPrompt(agentConfig ?? null, assistantSettings, params.instructions);

    systemPrompt += '\n\nREGRAS PARA TAREFAS:\n' +
      '- Gere conteúdo profissional, estruturado e verificável.\n' +
      '- Use Markdown com seções e listas quando apropriado.\n' +
      '- Se dados específicos forem necessários e não fornecidos, destaque premissas claramente.\n' +
      '- Não use placeholders ou informações inventadas.\n';

    const taskLabel = AGENTIC_TASK_TITLES[params.taskType];
    const taskAction = params.mode === 'update' ? 'ATUALIZAR' : 'CRIAR';
    const taskInstructions = [
      `${taskAction} ${taskLabel.toUpperCase()}.`,
      `Título: ${resolvedTitle}.`,
      `Instruções do usuário: ${params.instructions}`,
    ].join('\n');

    const content = await callLlamaAPI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: taskInstructions },
    ], false);

    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('Conteúdo vazio retornado pelo LLM para tarefa agentic');
    }

    const internalHeaders = buildInternalServiceHeaders({
      userId: params.userId,
      tenantId: params.tenantId,
      role: params.role,
    });

    let documentId = params.documentId;
    if (params.mode === 'update') {
      const resolvedDocumentId = await resolveAgenticDocumentId({
        tenantId: params.tenantId,
        conversationId: params.conversationId ?? undefined,
        explicitDocumentId: params.documentId,
      });
      if (!resolvedDocumentId) {
        throw new Error('Documento alvo não encontrado para atualização. Informe o ID do documento.');
      }
      documentId = resolvedDocumentId;
      const updateResult = await updateDocumentInRAG({
        documentId: resolvedDocumentId,
        title: resolvedTitle,
        content,
        tenantId: params.tenantId,
        userId: params.userId,
        role: params.role,
        namespaceId: params.namespaceId ?? undefined,
        internalHeaders,
      });
      documentId = updateResult.document.id;
    } else {
      const createResult = await createDocumentInRAG({
        title: resolvedTitle,
        content,
        tenantId: params.tenantId,
        userId: params.userId,
        role: params.role,
        namespaceId: params.namespaceId ?? undefined,
        internalHeaders,
      });
      documentId = createResult.document.id;
    }

    await db.update(schema.agenticTasks)
      .set({
        status: 'completed',
        result: {
          documentId,
          title: resolvedTitle,
        },
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.agenticTasks.id, taskRecord.id));

    return { success: true, taskId: taskRecord.id, documentId, title: resolvedTitle };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await db.update(schema.agenticTasks)
      .set({
        status: 'failed',
        error: errorMessage,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.agenticTasks.id, taskRecord.id));

    return { success: false, taskId: taskRecord.id, error: errorMessage };
  }
}

// SEGURANÇA: Helmet com CSP/HSTS enterprise (Express.js 2025 + OWASP 2023)
app.use(createSecurityMiddleware({
  contentSecurityPolicy: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV !== 'production',
}));

// OBSERVABILITY: Correlation ID middleware para rastreamento distribuído (Node.js 20 LTS 2025)
// Propaga correlation IDs entre microsserviços e injeta nos logs automaticamente
app.use(createCorrelationMiddleware({ serviceName: 'chat-service' }));

// PERFORMANCE: Compression para reduzir tamanho de respostas (Express.js 2025)
// SSE nao deve ser comprimido para garantir streaming em tempo real.
app.use(compression({
  filter: (req, res) => {
    const acceptHeader = req.headers.accept ?? '';
    if (typeof acceptHeader === 'string' && acceptHeader.includes('text/event-stream')) {
      return false;
    }
    if (req.path === '/api/chat/stream') {
      return false;
    }
    return compression.filter(req, res);
  },
}));

app.use(cors({
  origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : false,
  credentials: CORS_ORIGINS.length > 0,
}));

// SEGURANÇA: Rate limiting multi-tenant (express-rate-limit 2025)
app.use(createRateLimiter({
  windowMs: 60 * 1000,
  max: 100,
  skipRoutes: ['/api/chat/health', '/api/chat/stats'],
  serviceName: 'chat-service',
}));

// SEGURANÇA: Limites de payload para prevenir DoS (OWASP API4)
app.use(express.json({ limit: '10mb' }));

// =============================================================================
// MIDDLEWARE: Autenticação via Sessão (cookie) + Bearer JWT OIDC (WS4)
// =============================================================================
// CORREÇÃO PR#107 (10/01/2026): Requisições HTTP precisam de validação de sessão
// PROBLEMA: alice-chat não tinha middleware para processar cookie de sessão
//           do alice-auth, causando 401 em todas as requisições autenticadas.
// SOLUÇÃO (SSOT): usar middleware compartilhado de @alice/shared-utils para:
// - Validar cookie de sessão (PostgreSQL sessions)
// - Aceitar Bearer JWT (OIDC) com validação local via JWKS (iss/aud/claims)
// REF: CLAUDE.md Regra 7 (Diagnóstico de causa raiz)
// =============================================================================
app.use(createSessionAuthMiddleware({
  pool: getPool(),
  publicPaths: ['/api/chat/health', '/live', '/ready', '/metrics'],
}));

app.get('/api/chat/health', async (_req: Request, res: Response) => {
  const llmCircuitState = gpuManagerBreaker.opened ? 'open' : (gpuManagerBreaker.halfOpen ? 'half-open' : 'closed');
  const ragStats = getRAGBreakerStats();
  const integrationsStats = getIntegrationsBreakerStats();
  
  // Status degradado se qualquer circuit breaker crítico estiver aberto
  const overallStatus = (llmCircuitState === 'open' || integrationsStats.state === 'open') ? 'degraded' : 'ok';
  
  let invalidAgentsCount: number | null = null;
  try {
    // Best-effort: não pode quebrar health endpoint
    invalidAgentsCount = await countAgentsWithUnsupportedLlmModel();
  } catch (error) {
    logger.warn({ error }, 'Falha ao checar agentes com modeloBase inválido (health)');
    invalidAgentsCount = null;
  }

  // Gate 2: LLM (texto) model-agnóstico por capability
  res.json({ 
    status: overallStatus, 
    service: 'chat-service',
    timestamp: new Date().toISOString(),
    llmProvider: 'gpu-manager-service',
    model: DEFAULT_LLM_CONFIG.model,
    agents: {
      allowedModels: ALLOWED_AGENT_LLM_MODEL_NAMES,
      invalidModelCount: invalidAgentsCount,
    },
    circuitBreakers: {
      llm: {
        state: llmCircuitState,
        stats: {
          failures: gpuManagerBreaker.stats.failures,
          successes: gpuManagerBreaker.stats.successes,
          timeouts: gpuManagerBreaker.stats.timeouts,
        },
      },
      rag: ragStats,
      integrations: integrationsStats,
    },
  });
});

app.get('/api/chat/version', (_req: Request, res: Response) => {
  res.json({
    version: APP_VERSION,
    service: 'chat-service',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// KUBERNETES PROBES: /ready e /live (Regra 16 - Best Practices 2025)
// /live: Processo está vivo? Se não, Kubernetes reinicia o container
// /ready: Pronto para tráfego? Verifica conexão com PostgreSQL e LLM circuit breaker
// ============================================================================

// Liveness probe - verificação simples que o processo responde
app.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ 
    status: 'alive', 
    service: 'chat-service',
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe - verifica se PostgreSQL e LLM estão acessíveis
app.get('/ready', async (_req: Request, res: Response) => {
  try {
    const dbHealthy = await isPoolHealthy();
    const llmReady = !gpuManagerBreaker.opened;
    const invalidAgentsCount = dbHealthy ? await countAgentsWithUnsupportedLlmModel() : 0;
    
    // Chat precisa de PostgreSQL obrigatoriamente, LLM pode estar em degraded mode
    const allReady = dbHealthy;
    
    if (allReady) {
      res.status(200).json({
        status: 'ready',
        service: 'chat-service',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgresql: 'ready',
          llm: llmReady ? 'ready' : 'circuit_open',
          agents: invalidAgentsCount > 0 ? 'legacy_models_present' : 'ready',
        },
        warnings: invalidAgentsCount > 0 ? [{
          code: 'LEGACY_AGENT_LLM_MODEL',
          message:
            `Detectados ${invalidAgentsCount} agentes com modeloBase não suportado para LLM (texto) no Gate 2. ` +
            `Aplique a migração '0016_gate2_migrate_legacy_agent_models.sql'.`,
        }] : [],
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        service: 'chat-service',
        reason: 'PostgreSQL não está acessível',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgresql: dbHealthy ? 'ready' : 'not_ready',
          llm: llmReady ? 'ready' : 'circuit_open',
          agents: 'unknown',
        },
      });
    }
  } catch (error) {
    logger.error({ error }, 'Erro ao verificar readiness');
    res.status(503).json({
      status: 'not_ready',
      service: 'chat-service',
      reason: 'Erro ao verificar dependências',
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/chat/stats', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:stats:read'), async (req: Request, res: Response) => {
  try {
    // SEGURANÇA: Usar req.tenantId populado pelo middleware requireAuth/requireSameTenant
    const tenantId = req.tenantId;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // RBAC: Filtrar dados apenas do tenant do usuário (multi-tenancy seguro)
    const allConversations = await db.query.conversations.findMany({
      with: { agent: { with: { namespace: true } } },
    });
    const tenantConversations = allConversations.filter(c => 
      c.agent?.namespace?.tenantId === tenantId
    );
    
    const allDocuments = await db.query.documents.findMany({
      with: { namespace: true },
    });
    const tenantDocuments = allDocuments.filter(d => 
      d.namespace?.tenantId === tenantId
    );
    
    // NOTA: trainingData tem tenantId diretamente (não precisa de join com namespace)
    const allTraining = await db.query.trainingData.findMany();
    const tenantTraining = allTraining.filter(t => t.tenantId === tenantId);
    
    // Obter mensagens das conversas do tenant
    const conversationIds = tenantConversations.map(c => c.id);
    const allMessages = conversationIds.length > 0
      ? await db.query.messages.findMany({
          where: inArray(schema.messages.conversationId, conversationIds),
        })
      : [];

    const currentConversations = tenantConversations.filter(c => 
      c.criadoEm && new Date(c.criadoEm) >= weekAgo
    ).length;
    const previousConversations = tenantConversations.filter(c => 
      c.criadoEm && new Date(c.criadoEm) >= twoWeeksAgo && new Date(c.criadoEm) < weekAgo
    ).length;

    const currentDocuments = tenantDocuments.filter(d => 
      d.criadoEm && new Date(d.criadoEm) >= weekAgo
    ).length;
    const previousDocuments = tenantDocuments.filter(d => 
      d.criadoEm && new Date(d.criadoEm) >= twoWeeksAgo && new Date(d.criadoEm) < weekAgo
    ).length;

    const currentTraining = tenantTraining.filter(t => 
      t.criadoEm && new Date(t.criadoEm) >= weekAgo
    ).length;
    const previousTraining = tenantTraining.filter(t => 
      t.criadoEm && new Date(t.criadoEm) >= twoWeeksAgo && new Date(t.criadoEm) < weekAgo
    ).length;

    const totalTokens = allMessages.reduce((sum, m) => sum + (m.tokensUsados || 0), 0);
    const currentTokens = allMessages
      .filter(m => m.criadoEm && new Date(m.criadoEm) >= weekAgo)
      .reduce((sum, m) => sum + (m.tokensUsados || 0), 0);
    const previousTokens = allMessages
      .filter(m => m.criadoEm && new Date(m.criadoEm) >= twoWeeksAgo && new Date(m.criadoEm) < weekAgo)
      .reduce((sum, m) => sum + (m.tokensUsados || 0), 0);

    const calcTrend = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    res.json({
      conversations: tenantConversations.length,
      documents: tenantDocuments.length,
      trainingData: tenantTraining.length,
      tokensUsed: totalTokens,
      trend: {
        conversations: calcTrend(currentConversations, previousConversations),
        documents: calcTrend(currentDocuments, previousDocuments),
        trainingData: calcTrend(currentTraining, previousTraining),
        tokensUsed: calcTrend(currentTokens, previousTokens),
      },
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar estatísticas');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/chat/usage', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:stats:read'), async (req: Request, res: Response) => {
  try {
    // SEGURANÇA: Usar req.tenantId populado pelo middleware requireAuth/requireSameTenant
    const tenantId = req.tenantId;
    const today = new Date();
    const usageData = [];

    // RBAC: Filtrar conversas apenas do tenant do usuário
    const allConversationsRaw = await db.query.conversations.findMany({
      with: { agent: { with: { namespace: true } } },
    });
    const tenantConversations = allConversationsRaw.filter(c => 
      c.agent?.namespace?.tenantId === tenantId
    );
    
    // Obter mensagens das conversas do tenant
    const conversationIds = tenantConversations.map(c => c.id);
    const tenantMessages = conversationIds.length > 0
      ? await db.query.messages.findMany({
          where: inArray(schema.messages.conversationId, conversationIds),
        })
      : [];
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));
      const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

      const dayConversations = tenantConversations.filter(c => 
        c.criadoEm && new Date(c.criadoEm) >= startOfDay && new Date(c.criadoEm) <= endOfDay
      ).length;

      const dayMessages = tenantMessages.filter(m =>
        m.criadoEm && new Date(m.criadoEm) >= startOfDay && new Date(m.criadoEm) <= endOfDay
      );
      const dayTokens = dayMessages.reduce((sum, m) => sum + (m.tokensUsados || 0), 0);
      
      usageData.push({
        date: dateStr,
        conversations: dayConversations,
        tokens: dayTokens,
      });
    }
    
    res.json(usageData);
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar dados de uso');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

const conversationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursorUpdatedAt: z.string().optional(),
  cursorId: z.string().uuid().optional(),
});

const approvalPolicySchema = z.enum(['always_confirm', 'confirm_risky', 'never_confirm']);
const approvalPolicyUpdateSchema = z.object({
  approvalPolicy: approvalPolicySchema,
});

const conversationDeleteParamsSchema = z.object({
  id: z.string().uuid(),
});

const conversationBulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

app.get('/api/chat/conversations', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:conversations:read'), async (req: Request, res: Response) => {
  // SEGURANÇA: Usar req.user populado pelo middleware ao invés de header direto
  const auth = req.user;
  const tenantId = req.tenantId;
  
  if (!auth?.userId) {
    return res.status(401).json({ error: 'ID do usuário necessário' });
  }

  const userId = auth.userId;

  try {
    const queryResult = conversationListQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
    }

    const limit = queryResult.data.limit ?? 50;
    const cursorUpdatedAtRaw = queryResult.data.cursorUpdatedAt;
    const cursorId = queryResult.data.cursorId;
    const cursorUpdatedAt = cursorUpdatedAtRaw ? new Date(cursorUpdatedAtRaw) : null;

    if (cursorUpdatedAtRaw && Number.isNaN(cursorUpdatedAt?.getTime())) {
      return res.status(400).json({ error: 'cursorUpdatedAt inválido' });
    }

    const baseFilters = [
      eq(schema.conversations.userId, userId),
      tenantId ? eq(schema.conversations.tenantId, tenantId) : undefined,
      not(eq(schema.conversations.status, 'deleted')),
    ].filter(Boolean);

    const cursorFilters = cursorUpdatedAt && cursorId
      ? or(
          lt(schema.conversations.atualizadoEm, cursorUpdatedAt),
          and(
            eq(schema.conversations.atualizadoEm, cursorUpdatedAt),
            lt(schema.conversations.id, cursorId)
          )
        )
      : undefined;

    const whereClause = cursorFilters
      ? and(...baseFilters, cursorFilters)
      : and(...baseFilters);

    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.conversations)
      .where(and(...baseFilters));

    const conversations = await db.query.conversations.findMany({
      where: whereClause,
      orderBy: [desc(schema.conversations.atualizadoEm), desc(schema.conversations.id)],
      limit: limit + 1,
      with: {
        agent: {
          columns: {
            id: true,
            nome: true,
            avatar: true,
            slug: true,
          },
        },
      },
    });

    const hasMore = conversations.length > limit;
    const items = hasMore ? conversations.slice(0, limit) : conversations;
    const lastItem = items[items.length - 1];
    const nextCursor = hasMore && lastItem
      ? {
          updatedAt: (lastItem.atualizadoEm ?? lastItem.criadoEm ?? new Date()).toISOString(),
          id: lastItem.id,
        }
      : null;

    res.json({
      conversations: items,
      nextCursor,
      hasMore,
      total: Number(countRow?.count ?? 0),
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar conversas');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.delete(
  '/api/chat/conversations/:id',
  requireAuth(),
  requireSameTenant(getTenantIdFromRequest),
  requirePermission('chat:conversations:delete'),
  async (req: Request, res: Response) => {
    const paramsResult = conversationDeleteParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return res.status(400).json({ error: 'ID de conversa inválido', details: paramsResult.error.format() });
    }

    const userId = req.user?.userId;
    const tenantId = req.tenantId;
    if (!userId) {
      return res.status(401).json({ error: 'Autenticação necessária' });
    }

    const { id } = paramsResult.data;
    try {
      let conversationFound = false;

      await db.transaction(async (tx) => {
        const conversation = await tx.query.conversations.findFirst({
          where: and(
            eq(schema.conversations.id, id),
            eq(schema.conversations.userId, userId),
            tenantId ? eq(schema.conversations.tenantId, tenantId) : undefined,
            not(eq(schema.conversations.status, 'deleted'))
          ),
        });

        if (!conversation) {
          return;
        }

        conversationFound = true;
        await tx.delete(schema.messages).where(eq(schema.messages.conversationId, id));
        await tx.update(schema.conversations)
          .set({ status: 'deleted', atualizadoEm: new Date() })
          .where(eq(schema.conversations.id, id));
      });

      if (!conversationFound) {
        return res.status(404).json({ error: 'Conversa não encontrada' });
      }

      res.json({ success: true, conversationId: id });
    } catch (error) {
      logger.error({ error, conversationId: id }, 'Falha ao excluir conversa');
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }
);

app.post(
  '/api/chat/conversations/bulk-delete',
  requireAuth(),
  requireSameTenant(getTenantIdFromRequest),
  requirePermission('chat:conversations:delete'),
  async (req: Request, res: Response) => {
    const bodyResult = conversationBulkDeleteSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({ error: 'Input inválido', details: bodyResult.error.format() });
    }

    const userId = req.user?.userId;
    const tenantId = req.tenantId;
    if (!userId) {
      return res.status(401).json({ error: 'Autenticação necessária' });
    }

    const ids = bodyResult.data.ids;
    try {
      let allowedIds: string[] = [];

      await db.transaction(async (tx) => {
        const conversations = await tx.query.conversations.findMany({
          where: and(
            inArray(schema.conversations.id, ids),
            eq(schema.conversations.userId, userId),
            tenantId ? eq(schema.conversations.tenantId, tenantId) : undefined,
            not(eq(schema.conversations.status, 'deleted'))
          ),
        });
        allowedIds = conversations.map((conv) => conv.id);
        if (allowedIds.length === 0) {
          return;
        }

        await tx.delete(schema.messages).where(inArray(schema.messages.conversationId, allowedIds));
        await tx.update(schema.conversations)
          .set({ status: 'deleted', atualizadoEm: new Date() })
          .where(inArray(schema.conversations.id, allowedIds));
      });

      if (allowedIds.length === 0) {
        return res.json({ success: true, deleted: 0, skipped: ids.length });
      }

      res.json({ success: true, deleted: allowedIds.length, skipped: ids.length - allowedIds.length });
    } catch (error) {
      logger.error({ error }, 'Falha ao excluir conversas em lote');
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }
);

app.post(
  '/api/chat/conversations/delete-all',
  requireAuth(),
  requireSameTenant(getTenantIdFromRequest),
  requirePermission('chat:conversations:delete'),
  async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    const tenantId = req.tenantId;
    if (!userId) {
      return res.status(401).json({ error: 'Autenticação necessária' });
    }

    try {
      let ids: string[] = [];

      await db.transaction(async (tx) => {
        const conversations = await tx.query.conversations.findMany({
          where: and(
            eq(schema.conversations.userId, userId),
            tenantId ? eq(schema.conversations.tenantId, tenantId) : undefined,
            not(eq(schema.conversations.status, 'deleted'))
          ),
        });
        ids = conversations.map((conv) => conv.id);
        if (ids.length === 0) {
          return;
        }

        await tx.delete(schema.messages).where(inArray(schema.messages.conversationId, ids));
        await tx.update(schema.conversations)
          .set({ status: 'deleted', atualizadoEm: new Date() })
          .where(inArray(schema.conversations.id, ids));
      });

      if (ids.length === 0) {
        return res.json({ success: true, deleted: 0 });
      }

      res.json({ success: true, deleted: ids.length });
    } catch (error) {
      logger.error({ error }, 'Falha ao excluir todas as conversas do usuário');
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }
);

// ============================================================================
// SCHEMAS ZOD PARA WEBSOCKET (OWASP API3 - Input Validation Enterprise)
// ============================================================================
const wsMessageSchema = z.object({
  type: z.enum([
    'chat', 
    'typing', 
    'ping', 
    'subscribe', 
    'unsubscribe',
    // Trading messages (17/12/2025)
    'trading:subscribe',
    'trading:unsubscribe',
    'trading:command',
  ]),
  conversationId: z.string().uuid().optional(),
  content: z.string().max(10000).optional(),
  namespaceId: z.string().uuid().optional(),
  // Trading fields (17/12/2025)
  channel: z.enum(['ticker', 'orderbook', 'klines', 'trades', 'orders', 'positions', 'balance', 'control']).optional(),
  symbol: z.string().max(20).optional(),
  interval: z.string().max(10).optional(),
});

const _wsAgentMessageSchema = z.object({
  type: z.enum(['takeover_message', 'takeover_note', 'handback', 'ping', 'subscribe']),
  conversationId: z.string().uuid().optional(),
  content: z.string().max(10000).optional(),
  tenantId: z.string().uuid().optional(),
});

const createConversationSchema = z.object({
  agentId: z.string().uuid().optional(),
  namespaceId: z.string().uuid().optional(),
  titulo: z.string().optional(),
});

app.post('/api/chat/conversations', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:conversations:write'), async (req: Request, res: Response) => {
  // SEGURANÇA: Usar req.user populado pelo middleware ao invés de header direto
  const auth = req.user;
  const tenantId = req.tenantId;
  
  if (!auth?.userId) {
    return res.status(401).json({ error: 'ID do usuário necessário' });
  }
  if (!tenantId) {
    return res.status(403).json({ error: 'Acesso negado: usuário não associado a um tenant' });
  }

  const userId = auth.userId;

  try {
    const body = createConversationSchema.parse(req.body);

    const [conversation] = await db.insert(schema.conversations).values({
      tenantId,
      userId,
      agentId: body.agentId,
      namespaceId: body.namespaceId,
      titulo: body.titulo || 'Nova Conversa',
    }).returning();

    logger.info({ conversationId: conversation.id, userId }, 'Conversa criada');
    res.json({ conversation });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar conversa');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/chat/conversations/:id/messages', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:messages:read'), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID de conversa inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  const tenantId = req.tenantId;

  if (!tenantId) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }

  try {
    const messages = await db.query.messages.findMany({
      where: eq(schema.messages.conversationId, id),
      orderBy: [schema.messages.criadoEm],
      with: {
        user: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            preferredName: true,
            email: true,
            profileImageUrl: true,
          },
        },
        agent: {
          columns: {
            id: true,
            nome: true,
            avatar: true,
            slug: true,
          },
        },
      },
    });

    const generatedImageIds = messages.flatMap((message) => {
      const metadata = message.metadata as { generatedImages?: string[] } | null | undefined;
      if (!metadata || !Array.isArray(metadata.generatedImages)) {
        return [];
      }
      return metadata.generatedImages.filter((imageId): imageId is string => typeof imageId === 'string' && imageId.length > 0);
    });
    const uniqueGeneratedImageIds = Array.from(new Set(generatedImageIds));
    const generatedImages = uniqueGeneratedImageIds.length > 0
      ? await db.query.generatedImages.findMany({
          where: and(
            eq(schema.generatedImages.tenantId, tenantId),
            inArray(schema.generatedImages.id, uniqueGeneratedImageIds)
          ),
        })
      : [];
    const generatedImageMap = new Map(generatedImages.map((image) => [image.id, image]));

    const messagesWithGeneratedImages = messages.map((message) => {
      const metadata = message.metadata as { generatedImages?: string[] } | null | undefined;
      const imageId = metadata?.generatedImages?.[0];
      if (!imageId) {
        return message;
      }
      const image = generatedImageMap.get(imageId);
      if (!image) {
        return message;
      }
      return {
        ...message,
        generatedImage: {
          id: image.id,
          prompt: image.prompt,
          imageUrl: image.imageUrl ?? undefined,
          imagePath: image.imagePath ?? undefined,
          status: image.status === 'generating' ? 'processing' : image.status,
          width: image.width ?? undefined,
          height: image.height ?? undefined,
          feedbackScore: image.feedbackScore ?? undefined,
        },
      };
    });

    res.json({ messages: messagesWithGeneratedImages });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar mensagens');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/chat/conversations/:id/training/collect', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('training:training_data:write'), async (req: Request, res: Response) => {
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID de conversa inválido', details: paramsResult.error.format() });
  }
  const bodyResult = collectConversationTrainingSchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({ error: 'Input inválido', details: bodyResult.error.format() });
  }

  const tenantId = req.tenantId;
  const userId = req.user?.userId;
  const userRole = req.user?.role as Role | undefined;
  if (!tenantId || !userId || !userRole) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }

  const { id } = paramsResult.data;
  const { namespaceId: requestedNamespaceId, maxMessages } = bodyResult.data;
  const limit = maxMessages ?? TRAINING_CONVERSATION_MAX_MESSAGES;

  try {
    const conversation = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, id),
      with: { agent: true },
    });

    if (!conversation || conversation.tenantId !== tenantId) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    const namespaceId = requestedNamespaceId || conversation.namespaceId || conversation.agent?.namespaceId;
    if (!namespaceId) {
      return res.status(400).json({ error: 'Namespace obrigatório para coleta de treinamento' });
    }

    const namespace = await db.query.namespaces.findFirst({
      where: eq(schema.namespaces.id, namespaceId),
    });
    if (!namespace || namespace.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Namespace inválido para o tenant' });
    }

    const recentMessages = await db.query.messages.findMany({
      where: eq(schema.messages.conversationId, id),
      orderBy: [desc(schema.messages.criadoEm)],
      limit,
    });
    const ordered = [...recentMessages].reverse();

    if (ordered.length < 2) {
      return res.status(400).json({ error: 'Conversa não possui mensagens suficientes' });
    }

    const trainingMessages = ordered
      .filter((msg) => msg.conteudo && msg.conteudo.trim().length > 0)
      .map((msg) => ({
        role: (msg.isFromUser ? 'user' : 'assistant') as 'user' | 'assistant',
        content: msg.conteudo as string,
      }));

    if (trainingMessages.length < 2) {
      return res.status(400).json({ error: 'Conversa não possui conteúdo válido para treinamento' });
    }

    await collectTrainingSample({
      tenantId,
      namespaceId,
      conversationId: id,
      source: 'chat-curated',
      messages: trainingMessages,
      userId,
      role: userRole,
    });

    res.json({ success: true, messages: trainingMessages.length, namespaceId });
  } catch (error) {
    logger.error({ error, conversationId: id }, 'Falha ao coletar treinamento da conversa');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

const sendMessageSchema = z.object({
  conteudo: z.string().min(1),
  // ATUALIZADO 23/12/2025: Removido 'video' (muito pesado para GPU)
  // BUG FIX 23/12/2025: Removido 'document' do enum - documentos devem ser enviados via RAG service endpoints
  // (/api/rag/documents/upload ou /api/media/upload), não como tipos de mensagem de chat.
  // O WebSocket handler só processa 'image' e 'audio' (linhas 2957-2986), então aceitar 'document'
  // criaria experiência confusa onde mensagens seriam validadas mas nunca processadas.
  // O database schema (messageTypeEnum) mantém 'document' para compatibilidade com mensagens existentes,
  // mas a API não aceita mais este valor para novas mensagens.
  tipo: z.enum(['text', 'image', 'audio', 'mixed']).default('text'),
});

const collectConversationTrainingSchema = z.object({
  namespaceId: z.string().uuid().optional(),
  maxMessages: z.number().int().min(2).max(100).optional(),
});

const streamMediaAttachmentSchema = z.object({
  id: z.string().uuid().optional(),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(150),
  file: z.string().min(1).optional(),
  uploadId: z.string().uuid().optional(),
  fileUrl: z.string().min(1).optional(),
  size: z.number().int().min(1).optional(),
}).refine((data) => Boolean(data.file) || Boolean(data.uploadId), {
  message: 'Arquivo de mídia obrigatório',
});

// OWASP API3 - Schemas Zod para validação de input em todas as rotas
const streamMessageSchema = z.object({
  message: z.string().min(1).max(32000).optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().min(1).max(32000),
  })).min(1).max(50).optional(),
  conversationId: z.string().uuid().optional(),
  namespaceId: z.string().uuid().optional(),
  mediaAttachments: z.array(streamMediaAttachmentSchema).min(1).max(5).optional(),
}).refine((data) => Boolean(data.message) || Boolean(data.messages?.length) || Boolean(data.mediaAttachments?.length), {
  message: 'Mensagem do usuário obrigatória',
});

const takeoverNoteSchema = z.object({
  notes: z.string().max(2000).optional(),
});

const handbackSchema = z.object({
  resolutionNotes: z.string().max(2000).optional(),
});

const takeoverMessageSchema = z.object({
  content: z.string().min(1).max(4000),
});

const imageScoreSchema = z.object({
  score: z.number().int().min(1).max(5),
});

const imageApproveSchema = z.object({
  approved: z.boolean(),
});

// Schema para rating de mensagens de texto (GAP CRÍTICO #1 - Sistema de Aprendizado)
const messageRatingSchema = z.object({
  rating: z.number().int().min(1).max(5),
  isPositive: z.boolean().optional(), // ThumbsUp/ThumbsDown convertido para rating
});

app.post('/api/chat/conversations/:id/messages', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:messages:write'), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID de conversa inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  
  // SEGURANÇA: Usar req.user populado pelo middleware ao invés de header direto
  const userId = req.user?.userId;
  const userRole = req.user?.role as Role | undefined;
  const tenantId = req.tenantId;

  if (!userId || !userRole || !tenantId) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }

  try {
    const body = sendMessageSchema.parse(req.body);

    const conversation = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, id),
      with: { agent: true },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }

    const [userMessage] = await db.insert(schema.messages).values({
      conversationId: id,
      userId,
      conteudo: body.conteudo,
      tipo: body.tipo,
      isFromUser: true,
    }).returning();

    const agent = conversation.agent as AgentConfig | null;
    const assistantSettings = await getAssistantSettingsForTenant(req.tenantId);
    const userProfile = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: {
        idioma: true,
        timezone: true,
        preferencias: true,
      },
    });
    const userLocaleContext: UserLocaleContext | undefined = userProfile
      ? {
          locale: userProfile.idioma ?? null,
          timezone: userProfile.timezone ?? null,
          location: (userProfile.preferencias as { location?: UserLocationContext } | null | undefined)?.location ?? null,
        }
      : undefined;
    const baseNameContext = await resolveUserNameContext(userId, tenantId);
    const nameContext = await handleUserNameUpdate({
      userId,
      tenantId,
      userMessage: body.conteudo,
      currentContext: baseNameContext,
    });
    const previousMessages = await db.query.messages.findMany({
      where: eq(schema.messages.conversationId, id),
      orderBy: [desc(schema.messages.criadoEm)],
      limit: CHAT_HISTORY_FETCH_LIMIT,
    });
    const storedPreviousMessages = normalizeStoredMessages(previousMessages);
    const nameUsageContext = resolveUserNameUsageContext({
      previousMessages,
      conversationCreated: false,
    });

    let systemPrompt = buildSystemPrompt(agent, assistantSettings, body.conteudo, userLocaleContext);
    systemPrompt = appendUserNamePolicy(systemPrompt, nameContext, nameUsageContext);
    systemPrompt = appendNameConfirmationInstruction(systemPrompt, nameContext);
    if (nameContext.shouldAskConfirmation) {
      await markNamePromptPending(userId, tenantId, nameContext);
    }

    const ragStartTime = Date.now();
    const ragParams = getAdaptiveRagParams(body.conteudo, previousMessages.length);
    const ragResult = await buscarContextoRAG(
      body.conteudo,
      conversation.namespaceId || undefined,
      ragParams.limit,
      ragParams.threshold,
      { userId, tenantId, role: userRole }
    );
    const ragLatency = Date.now() - ragStartTime;
    recordRagRelevance(tenantId, ragResult);
    recordRagSearchMetrics({ tenantId, ragResult, latencyMs: ragLatency, endpoint: 'chat-sync' });
    
    if (ragResult && ragResult.context) {
      systemPrompt += formatarContextoParaLLM(ragResult);
      logger.info({ 
        conversationId: id, 
        ragChunks: ragResult.sources.length,
        ragLatencyMs: ragLatency,
      }, 'Contexto RAG injetado no prompt');
    }

    if (isMemorySearchIntent(body.conteudo)) {
      const memoryHistory = await fetchUserMemoryHistory({
        userId,
        tenantId,
        conversationId: id,
        limit: CHAT_HISTORY_SEARCH_LIMIT,
      });
      const memoryBlock = buildMemorySearchBlock(
        memoryHistory,
        body.conteudo,
        CHAT_HISTORY_SEARCH_TOKEN_BUDGET
      );
      if (memoryBlock) {
        systemPrompt += `\n\nHISTÓRICO RELEVANTE (memória solicitada):\n${memoryBlock}`;
      }
    }

    const historyForPrompt = dropLeadingDuplicateUserMessage(storedPreviousMessages, body.conteudo);
    const llmMessages = buildPromptMessages({
      systemPrompt,
      userMessage: body.conteudo,
      history: historyForPrompt,
      source: 'sync',
    });

    // BUG FIX 02/01/2026: Extrair configuração LLM do agente para uso nas chamadas
    const syncProfile = detectContextProfile(body.conteudo);
    const llmConfig = applyDynamicTokenBudget(
      getAgentLLMConfig(agent),
      llmMessages,
      { conversationId: id, source: 'sync', profile: syncProfile }
    );

    const llmStartTime = Date.now();
    const response = await callLlamaAPI(
      llmMessages,
      false,
      llmConfig,
      getAdaptiveGpuPriority('sync', syncProfile)
    );
    const llmLatency = Date.now() - llmStartTime;
    const totalLatency = Date.now() - ragStartTime;

    const [assistantMessage] = await db.insert(schema.messages).values({
      conversationId: id,
      agentId: conversation.agentId,
      conteudo: response as string,
      tipo: 'text',
      isFromUser: false,
      latenciaMs: totalLatency,
    }).returning();

    await db.update(schema.conversations)
      .set({ 
        totalMensagens: (conversation.totalMensagens || 0) + 2,
        ultimaMensagemEm: new Date(),
        atualizadoEm: new Date(),
      })
      .where(eq(schema.conversations.id, id));

    try {
      await ensureConversationTitle({
        conversationId: id,
        userMessage: body.conteudo,
        assistantResponse: response as string,
      });
    } catch (titleError) {
      logger.warn({ error: titleError, conversationId: id }, 'Falha ao aplicar título automático (sync)');
    }

    if (shouldAutoCollectTraining({
      profile: syncProfile,
      namespaceId: conversation.namespaceId || conversation.agent?.namespaceId,
      userMessage: body.conteudo,
      assistantResponse: response as string,
    })) {
      void collectTrainingSample({
        tenantId,
        namespaceId: (conversation.namespaceId || conversation.agent?.namespaceId) as string,
        conversationId: id,
        source: 'chat-auto',
        messages: [
          { role: 'user', content: body.conteudo },
          { role: 'assistant', content: response as string },
        ],
        userId,
        role: userRole,
      });
    }

    logger.info({ 
      conversationId: id, 
      ragLatencyMs: ragLatency,
      llmLatencyMs: llmLatency,
      totalLatencyMs: totalLatency,
      usedRag: !!ragResult?.context,
    }, 'Mensagem processada com integração RAG');
    
    const userRecord = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        email: true,
        profileImageUrl: true,
      },
    });
    const agentRecord = conversation.agent
      ? {
        id: conversation.agent.id,
        nome: conversation.agent.nome,
        avatar: conversation.agent.avatar,
        slug: conversation.agent.slug,
      }
      : null;

    res.json({
      userMessage: { ...userMessage, user: userRecord },
      assistantMessage: { ...assistantMessage, agent: agentRecord },
      ragSources: ragResult?.sources || [],
    });
  } catch (error) {
    if (error instanceof ClientInputError) {
      logger.warn({ code: error.code, message: error.message }, 'Requisição inválida (configuração de agente/modelo)');
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    logger.error({ error }, 'Falha ao enviar mensagem');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/chat/stream', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:messages:write'), async (req: Request, res: Response) => {
  // OWASP API3 - Validação Zod obrigatória
  const parseResult = streamMessageSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Input inválido' });
  }
  const { messages: inputMessages, conversationId: _conversationId, namespaceId, message, mediaAttachments } = parseResult.data;
  const userId = req.user?.userId;
  const tenantId = req.tenantId;

  if (!userId || !tenantId) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }

  try {
    const userProfile = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: {
        idioma: true,
        timezone: true,
        preferencias: true,
      },
    });
    const userLocaleContext: UserLocaleContext | undefined = userProfile
      ? {
          locale: userProfile.idioma ?? null,
          timezone: userProfile.timezone ?? null,
          location: (userProfile.preferencias as { location?: UserLocationContext } | null | undefined)?.location ?? null,
        }
      : undefined;

    const agenticSettings = await getOrCreateAgenticSettings(tenantId);
    const agenticDetectors = normalizeAgenticDetectors(agenticSettings.detectors);
    const hasMediaAttachments = Array.isArray(mediaAttachments) && mediaAttachments.length > 0;
    const lastUserMessageContent = message?.trim().length
      ? message.trim()
      : inputMessages?.filter(m => m.role === 'user').pop()?.content?.trim();
    const mediaFallbackContent = hasMediaAttachments
      ? mediaAttachments
        .map((attachment) => {
          const resolvedType = resolveSupportedMediaType(attachment.mimeType);
          const label = resolvedType ? resolvedType.toUpperCase() : 'MIDIA';
          return `[${label}] ${attachment.filename}`;
        })
        .join(' | ')
      : undefined;
    const normalizedUserMessageContent = lastUserMessageContent || mediaFallbackContent;
    if (!normalizedUserMessageContent) {
      return res.status(400).json({ error: 'Mensagem do usuário obrigatória' });
    }
    const userMessageContent = normalizedUserMessageContent;
    const baseNameContext = await resolveUserNameContext(userId, tenantId);
    const nameContext = await handleUserNameUpdate({
      userId,
      tenantId,
      userMessage: userMessageContent,
      currentContext: baseNameContext,
    });
    if (nameContext.shouldAskConfirmation) {
      await markNamePromptPending(userId, tenantId, nameContext);
    }

    const imageDetection = !hasMediaAttachments
      ? detectImageGenerationRequest(userMessageContent, agenticDetectors)
      : { isImageRequest: false, prompt: null, confidence: 0, reason: 'Mensagem com mídia anexada' };

    let conversationId = _conversationId;
    let conversation: ConversationWithAgent | null = null;
    let conversationCreated = false;

    if (conversationId) {
      const existingConversation = await db.query.conversations.findFirst({
        where: eq(schema.conversations.id, conversationId),
        with: { agent: true },
      });

      if (!existingConversation || existingConversation.userId !== userId) {
        return res.status(404).json({ error: 'Conversa não encontrada' });
      }
      conversation = existingConversation;
    } else {
      const route = await resolveSemanticRoute({
        tenantId,
        userMessage: userMessageContent,
      });
      const [created] = await db.insert(schema.conversations).values({
        tenantId,
        userId,
        agentId: route.agentId,
        namespaceId: route.namespaceId ?? namespaceId,
        titulo: 'Nova Conversa',
        metadata: {
          routing: {
            source: route.source,
            score: route.score,
            profile: route.profile,
          },
        },
      }).returning();

      if (!created) {
        throw new Error('Falha ao criar conversa - resultado do banco de dados inválido');
      }

      const createdWithAgent = await db.query.conversations.findFirst({
        where: eq(schema.conversations.id, created.id),
        with: { agent: true },
      });

      conversation = createdWithAgent ?? created;
      conversationId = created.id;
      conversationCreated = true;
    }

    const preparedMediaAttachments = hasMediaAttachments
      ? mediaAttachments.map((attachment) => {
        const resolvedType = resolveSupportedMediaType(attachment.mimeType);
        if (!resolvedType) {
          throw new ClientInputError(
            `Tipo de arquivo não suportado: ${attachment.mimeType}. Tipos suportados: imagens (${SUPPORTED_IMAGE_TYPES.join(', ')}) e áudio (${SUPPORTED_AUDIO_TYPES.join(', ')}).`,
            { statusCode: 400, code: 'UNSUPPORTED_MEDIA_TYPE' }
          );
        }
        if (attachment.uploadId && resolvedType !== 'audio') {
          throw new ClientInputError(
            'Uploads pré-processados são suportados apenas para áudio.',
            { statusCode: 400, code: 'PREUPLOADED_MEDIA_UNSUPPORTED' }
          );
        }
        if (!attachment.file && !attachment.uploadId) {
          throw new ClientInputError(
            'Arquivo de mídia obrigatório.',
            { statusCode: 400, code: 'MISSING_MEDIA_FILE' }
          );
        }
        let resolvedSize: number;
        if (attachment.file) {
          resolvedSize = Buffer.from(attachment.file, 'base64').length;
        } else if (typeof attachment.size === 'number') {
          resolvedSize = attachment.size;
        } else {
          throw new ClientInputError(
            'Tamanho do arquivo obrigatório para mídia pré-processada.',
            { statusCode: 400, code: 'MISSING_MEDIA_SIZE' }
          );
        }
        return {
          id: attachment.id ?? crypto.randomUUID(),
          type: resolvedType,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          file: attachment.file,
          uploadId: attachment.uploadId,
          fileUrl: attachment.fileUrl,
          size: resolvedSize,
        };
      })
      : [];

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    if (conversationCreated && conversationId) {
      res.write(`data: ${JSON.stringify({ type: 'conversation', conversationId })}\n\n`);
    }

    const writeStatus = (stage: string) => {
      if (res.headersSent && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'status', stage })}\n\n`);
      }
    };

    const resolvePhaseForStage = (stage: string): AgentEvent['phase'] => {
      if (stage === 'llm' || stage === 'writing') return 'llm';
      if (stage === 'finalizing') return 'finalizing';
      if (stage === 'media') return 'tool';
      return 'planning';
    };

    const emitAgentEvent = (event: Omit<AgentEvent, 'id' | 'ts' | 'payload'> & { payload?: unknown }) => {
      if (!res.headersSent || res.writableEnded) return;
      const { payload: rawPayload, ...rest } = event;
      const payload = redactSensitivePayload(rawPayload);
      const data: AgentEvent = {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        ...rest,
        ...(payload ? { payload } : {}),
      };
      res.write(`data: ${JSON.stringify({ type: 'agent_event', data })}\n\n`);
    };

    writeStatus('preparing');
    emitAgentEvent({
      phase: resolvePhaseForStage('preparing'),
      action: 'preparing',
      status: 'start',
      message: 'Preparando resposta',
      correlationId: conversationId ?? undefined,
      payload: {
        hasMediaAttachments,
        mediaCount: preparedMediaAttachments.length,
        hasConversation: Boolean(conversationId),
      },
    });
    if (conversationCreated) {
      writeStatus('routing');
      emitAgentEvent({
        phase: resolvePhaseForStage('routing'),
        action: 'routing',
        status: 'in_progress',
        message: 'Roteando conversa',
        correlationId: conversationId ?? undefined,
      });
    }

    writeStatus('history');
    const historyStart = Date.now();
    const previousMessages = conversationId
      ? await db.query.messages.findMany({
        where: eq(schema.messages.conversationId, conversationId),
        orderBy: [desc(schema.messages.criadoEm)],
        limit: CHAT_HISTORY_FETCH_LIMIT,
      })
      : [];
    emitAgentEvent({
      phase: resolvePhaseForStage('history'),
      action: 'history',
      status: 'success',
      message: 'Histórico carregado',
      durationMs: Date.now() - historyStart,
      correlationId: conversationId ?? undefined,
      payload: { messages: previousMessages.length },
    });
    const storedPreviousMessages = normalizeStoredMessages(previousMessages);
    const nameUsageContext = resolveUserNameUsageContext({
      previousMessages,
      conversationCreated,
    });

    const messageType = hasMediaAttachments
      ? (preparedMediaAttachments.length === 1 ? preparedMediaAttachments[0].type : 'mixed')
      : 'text';
    const [userMessage] = await db.insert(schema.messages).values({
      conversationId,
      userId,
      conteudo: userMessageContent,
      tipo: messageType,
      isFromUser: true,
      anexos: hasMediaAttachments
        ? preparedMediaAttachments.map((attachment) => ({
          id: attachment.id,
          type: attachment.type,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
        }))
        : [],
    }).returning();

    const normalizeContent = (text: string) => text.trim().toLowerCase();

    if (hasMediaAttachments) {
      writeStatus('media');
      emitAgentEvent({
        phase: resolvePhaseForStage('media'),
        action: 'media_processing',
        status: 'start',
        message: 'Processando mídia',
        correlationId: conversationId ?? undefined,
        payload: {
          attachments: preparedMediaAttachments.map((attachment) => ({
            id: attachment.id,
            type: attachment.type,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            size: attachment.size,
            uploadId: attachment.uploadId,
          })),
        },
      });
      const mediaSafeTenantId = conversation?.tenantId || tenantId;
      if (!mediaSafeTenantId) {
        res.write(`data: ${JSON.stringify({ error: 'Tenant inválido para upload de mídia.' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      const internalHeaders = buildInternalServiceHeaders({
        userId,
        tenantId: mediaSafeTenantId,
        role: (req.user?.role as Role) || 'guest',
      });

      const updatedAttachments: Array<{
        id: string;
        type: 'image' | 'audio';
        filename: string;
        mimeType: string;
        size: number;
        url?: string;
        thumbnailUrl?: string;
        uploadId?: string;
        processingStatus?: string;
        transcription?: string;
        visionDescription?: string;
        visionModel?: string;
      }> = [];
      const visionSummaries: string[] = [];
      const hasAudioAttachments = preparedMediaAttachments.some((attachment) => attachment.type === 'audio');

      for (const attachment of preparedMediaAttachments) {
        let visionDescriptionForRag: string | undefined;
        let visionModelForRag: string | undefined;
        if (attachment.type === 'image') {
          try {
            if (!attachment.file) {
              throw new Error('Arquivo de imagem ausente para análise');
            }
            const imageDataUri = `data:${attachment.mimeType};base64,${attachment.file}`;
            const analysis = await analyzeImageWithOpenAI({
              imageDataUri,
              question: userMessageContent || 'Descreva e analise esta imagem.',
            });
            visionDescriptionForRag = analysis.text;
            visionModelForRag = analysis.model;
            if (analysis.text?.trim()) {
              visionSummaries.push(`Arquivo ${attachment.filename}: ${analysis.text}`);
            }
          } catch (visionErr) {
            logger.error(
              { error: visionErr instanceof Error ? visionErr.message : String(visionErr) },
              'Falha ao analisar imagem via OpenAI Vision (stream)'
            );
          }
        }

        let uploadResult: MediaUploadResult | null = null;
        if (attachment.uploadId) {
          uploadResult = await getMediaStatus(attachment.uploadId, mediaSafeTenantId, internalHeaders);
        } else {
          const attachmentFile = attachment.file;
          if (!attachmentFile) {
            throw new Error('Arquivo de mídia ausente para upload');
          }
          uploadResult = await uploadMediaToRAG(
            attachmentFile,
            attachment.filename,
            attachment.mimeType,
            mediaSafeTenantId,
            visionDescriptionForRag,
            userMessage.id,
            conversationId,
            internalHeaders
          );
        }

        if (!uploadResult) {
          res.write(`data: ${JSON.stringify({ error: 'Falha ao processar mídia. Tente novamente.' })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        updatedAttachments.push({
          id: attachment.id,
          type: attachment.type,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          url: uploadResult.fileUrl,
          thumbnailUrl: uploadResult.thumbnailUrl,
          uploadId: uploadResult.uploadId,
          processingStatus: uploadResult.processingStatus,
          transcription: uploadResult.transcription,
          visionDescription: visionDescriptionForRag,
          visionModel: visionModelForRag,
        });
      }

      await db.update(schema.messages)
        .set({
          anexos: updatedAttachments.map((attachment) => ({
            id: attachment.id,
            type: attachment.type,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            size: attachment.size,
            url: attachment.url,
            thumbnailUrl: attachment.thumbnailUrl,
            uploadId: attachment.uploadId,
            transcription: attachment.transcription,
            visionDescription: attachment.visionDescription,
            visionModel: attachment.visionModel,
          })),
        })
        .where(eq(schema.messages.id, userMessage.id));

      res.write(`data: ${JSON.stringify({
        type: 'media_uploaded',
        attachments: updatedAttachments,
      })}\n\n`);

      const agent = conversation?.agent as AgentConfig | null;
      const assistantSettings = await getAssistantSettingsForTenant(tenantId);
      let systemPrompt = buildSystemPrompt(agent, assistantSettings, userMessageContent, userLocaleContext);
      systemPrompt = appendUserNamePolicy(systemPrompt, nameContext, nameUsageContext);
      systemPrompt = appendNameConfirmationInstruction(systemPrompt, nameContext);
      let userContent = userMessageContent;

      if (visionSummaries.length > 0) {
        systemPrompt += `\n\n[ANÁLISE VISUAL (OpenAI Vision)]\n${visionSummaries.join('\n\n')}\n[/ANÁLISE VISUAL (OpenAI Vision)]\n`;
        if (!userContent) {
          userContent = 'Com base na análise visual acima, explique a imagem e possíveis implicações para trading.';
        }
      } else if (preparedMediaAttachments.some((attachment) => attachment.type === 'image')) {
        systemPrompt += '\n\nO usuário enviou uma imagem, mas a análise visual (OpenAI Vision) está indisponível no momento.';
        if (!userContent) {
          userContent = 'Recebi a imagem. No momento, não consegui analisar visualmente. Descreva o que deseja avaliar.';
        }
      }

      if (hasAudioAttachments) {
        const transcriptions = updatedAttachments
          .filter((attachment) => attachment.type === 'audio' && attachment.transcription)
          .map((attachment) => `[${attachment.filename}] ${attachment.transcription}`);
        if (transcriptions.length > 0) {
          userContent = `[Transcrição do áudio]\n${transcriptions.join('\n')}\n\n${userContent}`;
        } else {
          systemPrompt += '\n\nO usuário enviou um áudio que está sendo processado.';
          if (!userContent) {
            userContent = 'Recebi seu áudio. Estou processando a transcrição.';
          }
        }
      }

      const namespaceIdForMedia = namespaceId || conversation?.namespaceId || conversation?.agent?.namespaceId;
      const ragQuery = visionSummaries.length > 0
        ? `${visionSummaries.join('\n\n')}\n\nPergunta do usuário:\n${userContent}`
        : userContent;
      const ragParams = getAdaptiveRagParams(ragQuery, 0);
      const ragStart = Date.now();
      const ragResult = await buscarContextoRAG(
        ragQuery,
        namespaceIdForMedia || undefined,
        ragParams.limit,
        ragParams.threshold,
        { userId, tenantId, role: req.user?.role as Role }
      );
      emitAgentEvent({
        phase: 'tool',
        action: 'rag_internal',
        status: 'success',
        message: 'RAG interno concluído',
        durationMs: Date.now() - ragStart,
        correlationId: conversationId ?? undefined,
        payload: {
          namespaceId: namespaceIdForMedia,
          limit: ragParams.limit,
          threshold: ragParams.threshold,
          sources: ragResult?.sources?.length ?? 0,
        },
      });
      recordRagRelevance(tenantId, ragResult);
      if (ragResult?.context) {
        systemPrompt += formatarContextoParaLLM(ragResult);
        res.write(`data: ${JSON.stringify({ type: 'sources', sources: { internal: ragResult.sources || [] } })}\n\n`);
      }

      writeStatus('prompt');
      const promptStart = Date.now();
      emitAgentEvent({
        phase: 'planning',
        action: 'prompt_build',
        status: 'start',
        message: 'Construindo prompt para midia',
        correlationId: conversationId ?? undefined,
        payload: {
          historyMessages: storedPreviousMessages.length,
          mediaAttachments: preparedMediaAttachments.length,
          visionSummaries: visionSummaries.length,
        },
      });
      const mediaMessages = buildPromptMessages({
        systemPrompt,
        userMessage: userContent,
        history: storedPreviousMessages,
        source: 'stream',
      });
      emitAgentEvent({
        phase: 'planning',
        action: 'prompt_build',
        status: 'success',
        message: 'Prompt de midia pronto',
        durationMs: Date.now() - promptStart,
        correlationId: conversationId ?? undefined,
        payload: {
          totalMessages: mediaMessages.length,
        },
      });

      let assistantResponse = '';
      let assistantPersisted = false;
      try {
        writeStatus('llm');
        const llmStartAt = Date.now();
        const mediaProfile = detectContextProfile(userContent);
        const llmConfig = applyDynamicTokenBudget(
          getAgentLLMConfig(agent),
          mediaMessages,
          { conversationId, source: 'stream', profile: mediaProfile }
        );
        emitAgentEvent({
          phase: 'llm',
          action: 'llm_stream',
          status: 'start',
          message: 'Iniciando geração',
          correlationId: conversationId ?? undefined,
          payload: {
            model: llmConfig.model,
            maxTokens: llmConfig.maxTokens,
            temperature: llmConfig.temperature,
          },
        });
        let lastProgressAt = 0;
        let lastProgressChars = 0;
        const emitWritingProgress = () => {
          const now = Date.now();
          const chars = assistantResponse.length;
          const charsDelta = chars - lastProgressChars;
          if (now - lastProgressAt < 1200 && charsDelta < 160) return;
          lastProgressAt = now;
          lastProgressChars = chars;
          emitAgentEvent({
            phase: 'llm',
            action: 'writing',
            status: 'in_progress',
            message: `Escrevendo resposta (${chars} caracteres)`,
            correlationId: conversationId ?? undefined,
            payload: {
              chars,
            },
          });
        };
        await proxyStreamFromGpuManager(
          mediaMessages,
          (content) => {
            if (content) {
              assistantResponse += content;
            }
            if (content) {
              emitWritingProgress();
            }
            try {
              if (res.headersSent && !res.writableEnded) {
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
            } catch (writeError) {
              logger.warn({ error: writeError, conversationId }, 'Erro ao escrever chunk SSE (mídia) - cliente pode ter desconectado');
            }
          },
          async () => {
            emitAgentEvent({
              phase: 'llm',
              action: 'llm_stream',
              status: 'success',
              message: 'Geração concluída',
              durationMs: Date.now() - llmStartAt,
              correlationId: conversationId ?? undefined,
              payload: {
                responseLength: assistantResponse.length,
              },
            });
            if (!assistantPersisted && conversationId && userMessage) {
              assistantPersisted = true;
              if (assistantResponse.trim().length > 0) {
                const persistStartedAt = Date.now();
                emitAgentEvent({
                  phase: 'finalizing',
                  action: 'persist_message',
                  status: 'start',
                  message: 'Persistindo resposta',
                  correlationId: conversationId ?? undefined,
                });
                const [assistantMessage] = await db.insert(schema.messages).values({
                  conversationId,
                  agentId: conversation?.agentId,
                  conteudo: assistantResponse,
                  tipo: 'text',
                  isFromUser: false,
                }).returning();

                await db.update(schema.conversations)
                  .set({
                    totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
                    ultimaMensagemEm: new Date(),
                    atualizadoEm: new Date(),
                  })
                  .where(eq(schema.conversations.id, conversationId));

                try {
                  await ensureConversationTitle({
                    conversationId,
                    userMessage: userContent,
                    assistantResponse: assistantResponse,
                  });
                } catch (titleError) {
                  logger.warn({ error: titleError, conversationId }, 'Falha ao aplicar título automático (stream mídia)');
                }

                const streamUserRole = req.user?.role as Role | undefined;
                if (streamUserRole && shouldAutoCollectTraining({
                  profile: mediaProfile,
                  namespaceId: namespaceIdForMedia,
                  userMessage: userContent,
                  assistantResponse: assistantResponse,
                })) {
                  void collectTrainingSample({
                    tenantId,
                    namespaceId: namespaceIdForMedia as string,
                    conversationId,
                    source: 'chat-auto',
                    messages: [
                      { role: 'user', content: userContent },
                      { role: 'assistant', content: assistantResponse },
                    ],
                    userId,
                    role: streamUserRole,
                  });
                }

                res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
                emitAgentEvent({
                  phase: 'finalizing',
                  action: 'persist_message',
                  status: 'success',
                  message: 'Resposta persistida',
                  durationMs: Date.now() - persistStartedAt,
                  correlationId: conversationId ?? undefined,
                  payload: {
                    messageId: assistantMessage?.id,
                  },
                });
              } else {
                await db.update(schema.conversations)
                  .set({
                    totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 1`,
                    ultimaMensagemEm: new Date(),
                    atualizadoEm: new Date(),
                  })
                  .where(eq(schema.conversations.id, conversationId));
              }
            }

            if (!res.writableEnded) {
              writeStatus('finalizing');
              emitAgentEvent({
                phase: 'finalizing',
                action: 'finalizing',
                status: 'success',
                message: 'Resposta finalizada',
                correlationId: conversationId ?? undefined,
              });
              res.write('data: [DONE]\n\n');
              res.end();
            }
          },
          llmConfig,
          getAdaptiveGpuPriority('stream', mediaProfile)
        );
      } catch (streamError) {
        logger.error({ error: streamError }, 'Erro no streaming de mídia (stream)');
        emitAgentEvent({
          phase: 'llm',
          action: 'llm_stream',
          status: 'error',
          message: 'Falha ao gerar resposta',
          correlationId: conversationId ?? undefined,
          payload: {
            error: streamError instanceof Error ? streamError.message : String(streamError),
          },
        });
        if (res.headersSent && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: 'Erro ao processar mídia' })}\n\n`);
          res.end();
        }
      }
      return;
    }

    if (!imageDetection.isImageRequest) {
      // ============================================================================
      // GREETINGS GATE (Redis cache) - evita GPU para saudações simples
      // ============================================================================
      writeStatus('greeting');
      const cacheStart = Date.now();
      emitAgentEvent({
        phase: 'planning',
        action: 'greeting_gate',
        status: 'start',
        message: 'Avaliando saudacao (cache)',
        correlationId: conversationId ?? undefined,
      });
      const cacheResult = await checkResponseCache(tenantId, userMessageContent);
      emitAgentEvent({
        phase: 'planning',
        action: 'greeting_cache',
        status: cacheResult.hasResponse ? 'success' : 'skipped',
        message: cacheResult.hasResponse ? 'Saudacao encontrada no cache' : 'Sem saudacao em cache',
        durationMs: Date.now() - cacheStart,
        correlationId: conversationId ?? undefined,
        payload: {
          hasResponse: cacheResult.hasResponse,
          cacheHit: cacheResult.cacheHit,
          latencyMs: cacheResult.latencyMs,
          isGreeting: cacheResult.isGreeting,
        },
      });
      if (cacheResult.hasResponse && cacheResult.response) {
        const lastAssistantMessage = previousMessages.find((msg) => !msg.isFromUser && msg.conteudo);
        const shouldAugmentGreeting = Boolean(
          lastAssistantMessage?.conteudo &&
          normalizeContent(lastAssistantMessage.conteudo) === normalizeContent(cacheResult.response)
        );
        emitAgentEvent({
          phase: 'planning',
          action: 'greeting_compose',
          status: 'in_progress',
          message: 'Montando resposta de saudacao',
          correlationId: conversationId ?? undefined,
          payload: {
            shouldAugment: shouldAugmentGreeting,
          },
        });
        const greetingSeed = `${tenantId}:${userMessageContent}:${lastAssistantMessage?.id || 'first'}`;
        let greetingResponse = buildGreetingResponse(
          cacheResult.response,
          greetingSeed,
          shouldAugmentGreeting
        );
        greetingResponse = applyUserNameToGreeting(greetingResponse, nameContext);
        greetingResponse = appendNameConfirmationQuestion(greetingResponse, nameContext);
        const persistStartedAt = Date.now();
        emitAgentEvent({
          phase: 'finalizing',
          action: 'persist_message',
          status: 'start',
          message: 'Persistindo resposta de saudacao',
          correlationId: conversationId ?? undefined,
        });
        const [assistantMessage] = await db.insert(schema.messages).values({
          conversationId,
          agentId: conversation?.agentId ?? undefined,
          conteudo: greetingResponse,
          tipo: 'text',
          isFromUser: false,
          metadata: {
            source: 'response-cache',
            cacheKey: cacheResult.cacheKey,
            isGreeting: cacheResult.isGreeting,
          },
        }).returning();

        await db.update(schema.conversations)
          .set({
            totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
            ultimaMensagemEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        try {
          await ensureConversationTitle({
            conversationId,
            userMessage: userMessageContent,
            assistantResponse: greetingResponse,
          });
        } catch (titleError) {
          logger.warn({ error: titleError, conversationId }, 'Falha ao aplicar título automático (greetings gate)');
        }

        res.write(`data: ${JSON.stringify({ content: greetingResponse })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
        emitAgentEvent({
          phase: 'finalizing',
          action: 'persist_message',
          status: 'success',
          message: 'Resposta de saudacao persistida',
          durationMs: Date.now() - persistStartedAt,
          correlationId: conversationId ?? undefined,
          payload: {
            messageId: assistantMessage?.id,
          },
        });
        emitAgentEvent({
          phase: 'finalizing',
          action: 'finalizing',
          status: 'success',
          message: 'Resposta finalizada',
          correlationId: conversationId ?? undefined,
        });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      // ============================================================================
      // REUSE GATE (deduplicação na própria conversa)
      // ============================================================================
      writeStatus('reuse');
      emitAgentEvent({
        phase: 'planning',
        action: 'reuse_gate',
        status: 'start',
        message: 'Verificando deduplicacao de conversa',
        correlationId: conversationId ?? undefined,
      });
      const lastUserIndex = previousMessages.findIndex((msg) => msg.isFromUser);
      const lastUserInHistory = lastUserIndex >= 0 ? previousMessages[lastUserIndex] : undefined;
      if (lastUserInHistory?.conteudo &&
          normalizeContent(lastUserInHistory.conteudo) === normalizeContent(userMessageContent)) {
        const assistantAfterLastUser = previousMessages.find((msg, idx) => idx < lastUserIndex && !msg.isFromUser);
        if (assistantAfterLastUser?.conteudo) {
          const reuseSeed = `${tenantId}:${userMessageContent}:${assistantAfterLastUser.id}`;
          const reuseResponse = buildReuseResponse(assistantAfterLastUser.conteudo, reuseSeed);
          const persistStartedAt = Date.now();
          emitAgentEvent({
            phase: 'finalizing',
            action: 'persist_message',
            status: 'start',
            message: 'Persistindo resposta reutilizada',
            correlationId: conversationId ?? undefined,
          });
          const [assistantMessage] = await db.insert(schema.messages).values({
            conversationId,
            agentId: conversation?.agentId ?? undefined,
            conteudo: reuseResponse,
            tipo: 'text',
            isFromUser: false,
            metadata: {
              source: 'reuse-gate',
              reusedMessageId: assistantAfterLastUser.id,
            },
          }).returning();

          await db.update(schema.conversations)
            .set({
              totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
              ultimaMensagemEm: new Date(),
              atualizadoEm: new Date(),
            })
            .where(eq(schema.conversations.id, conversationId));

          try {
            await ensureConversationTitle({
              conversationId,
              userMessage: userMessageContent,
              assistantResponse: reuseResponse,
            });
          } catch (titleError) {
            logger.warn({ error: titleError, conversationId }, 'Falha ao aplicar título automático (reuse gate)');
          }

          res.write(`data: ${JSON.stringify({ content: reuseResponse })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
          emitAgentEvent({
            phase: 'finalizing',
            action: 'persist_message',
            status: 'success',
            message: 'Resposta reutilizada persistida',
            durationMs: Date.now() - persistStartedAt,
            correlationId: conversationId ?? undefined,
            payload: {
              messageId: assistantMessage?.id,
            },
          });
          emitAgentEvent({
            phase: 'finalizing',
            action: 'finalizing',
            status: 'success',
            message: 'Resposta finalizada',
            correlationId: conversationId ?? undefined,
          });
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
      }
      emitAgentEvent({
        phase: 'planning',
        action: 'reuse_gate',
        status: 'skipped',
        message: 'Nenhuma resposta reutilizavel encontrada',
        correlationId: conversationId ?? undefined,
      });
    }

    const imageSearchDetection = detectImageSearchRequest(userMessageContent, agenticDetectors);
    if (imageSearchDetection.isImageSearch && imageSearchDetection.query) {
      const userRole = req.user?.role as Role | undefined;
      const imageSearchStart = Date.now();
      emitAgentEvent({
        phase: 'tool',
        action: 'web_image_search',
        status: 'start',
        message: 'Buscando imagens na web',
        correlationId: conversationId ?? undefined,
        payload: {
          query: imageSearchDetection.query,
          confidence: imageSearchDetection.confidence,
        },
      });

      if (!agenticSettings.webEnabled) {
        res.write(`data: ${JSON.stringify({ error: 'Busca na internet está desativada nas configurações do tenant.' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (!userRole) {
        res.write(`data: ${JSON.stringify({ error: 'Permissão insuficiente para buscar imagens.' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const permissionCheck = await checkPermission(
        { userId, tenantId, role: userRole },
        'images:search:read'
      );
      if (!permissionCheck.allowed) {
        res.write(`data: ${JSON.stringify({ error: 'Você não possui permissão para buscar imagens na web.' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const internalHeaders = buildInternalServiceHeaders({
        userId,
        tenantId,
        role: userRole,
      });

      try {
        const webImages = await buscarImagensWeb({
          query: imageSearchDetection.query,
          limit: WEB_IMAGE_SEARCH_MAX_RESULTS,
          auth: { userId, tenantId, role: userRole },
        });

        if (!webImages.length) {
          const responseContent = 'Não encontrei imagens na web para esse pedido agora.';
          const [assistantMessage] = await db.insert(schema.messages).values({
            conversationId,
            agentId: conversation?.agentId ?? undefined,
            conteudo: responseContent,
            tipo: 'text',
            isFromUser: false,
            anexos: [],
            metadata: {
              webImageSearch: {
                query: imageSearchDetection.query,
                results: 0,
              },
            },
          }).returning();

          await db.update(schema.conversations)
            .set({
              totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
              ultimaMensagemEm: new Date(),
              atualizadoEm: new Date(),
            })
            .where(eq(schema.conversations.id, conversationId));

          await ensureConversationTitle({
            conversationId,
            userMessage: userMessageContent,
            assistantResponse: responseContent,
          });

          res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        const responseContent = 'Encontrei imagens na web para você.';
        const [assistantMessage] = await db.insert(schema.messages).values({
          conversationId,
          agentId: conversation?.agentId ?? undefined,
          conteudo: responseContent,
          tipo: 'text',
          isFromUser: false,
          anexos: [],
          metadata: {
            webImageSearch: {
              query: imageSearchDetection.query,
              results: webImages.length,
            },
          },
        }).returning();

        if (!assistantMessage) {
          throw new Error('Falha ao criar mensagem de imagens web');
        }

        const attachments: Array<{
          id: string;
          type: 'image';
          filename: string;
          mimeType: string;
          size: number;
          url?: string;
          thumbnailUrl?: string;
        }> = [];
        let downloadedCount = 0;

        for (const [index, image] of webImages.entries()) {
          try {
            const downloaded = await fetchExternalImageAsBase64(image.imageUrl, WEB_IMAGE_MAX_BYTES);
            const filename = buildWebImageFilename(image.imageUrl, index, downloaded.mimeType);
            const uploadResult = await uploadMediaToRAG(
              downloaded.base64,
              filename,
              downloaded.mimeType,
              tenantId,
              `Imagem encontrada na web. Fonte: ${image.sourceUrl ?? image.imageUrl}`,
              assistantMessage.id,
              conversationId,
              internalHeaders
            );

            if (!uploadResult?.fileUrl) {
              logger.warn({ imageUrl: image.imageUrl }, 'Upload de imagem web falhou');
              continue;
            }

            downloadedCount += 1;
            attachments.push({
              id: uploadResult.uploadId,
              type: 'image',
              filename,
              mimeType: downloaded.mimeType,
              size: downloaded.size,
              url: uploadResult.fileUrl,
              thumbnailUrl: uploadResult.thumbnailUrl,
            });
          } catch (downloadError) {
            logger.warn(
              { error: downloadError, imageUrl: image.imageUrl },
              'Falha ao baixar imagem web'
            );
          }
        }

        if (!attachments.length) {
          const fallbackContent = 'Não consegui baixar imagens válidas da web neste momento.';
          await db.update(schema.messages)
            .set({ conteudo: fallbackContent })
            .where(eq(schema.messages.id, assistantMessage.id));

          res.write(`data: ${JSON.stringify({ content: fallbackContent })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage.id })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        await db.update(schema.messages)
          .set({ anexos: attachments })
          .where(eq(schema.messages.id, assistantMessage.id));

        await db.update(schema.conversations)
          .set({
            totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
            ultimaMensagemEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        await ensureConversationTitle({
          conversationId,
          userMessage: userMessageContent,
          assistantResponse: responseContent,
        });

        emitAgentEvent({
          phase: 'tool',
          action: 'web_image_search',
          status: 'success',
          message: 'Busca de imagens web concluída',
          durationMs: Date.now() - imageSearchStart,
          correlationId: conversationId ?? undefined,
          payload: {
            downloaded: downloadedCount,
            stored: attachments.length,
          },
        });

        res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
        res.write(`data: ${JSON.stringify({
          type: 'web_image_results',
          message: { ...assistantMessage, anexos: attachments },
        })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage.id })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      } catch (searchError) {
        const resolvedError = searchError instanceof Error ? searchError.message : String(searchError);
        logger.error({ error: resolvedError }, 'Falha na busca de imagens web (stream)');
        res.write(`data: ${JSON.stringify({ error: 'Falha ao buscar imagens na web.' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
    }

    if (imageDetection.isImageRequest && imageDetection.prompt) {
      logger.info({
        conversationId,
        prompt: imageDetection.prompt,
        confidence: imageDetection.confidence,
        reason: imageDetection.reason,
      }, 'Pedido de geração de imagem detectado (stream) - OpenAI Images');
      const imageStartAt = Date.now();
      emitAgentEvent({
        phase: 'tool',
        action: 'image_generation',
        status: 'start',
        message: 'Gerando imagem via OpenAI',
        correlationId: conversationId ?? undefined,
        payload: {
          promptLength: imageDetection.prompt.length,
          confidence: imageDetection.confidence,
        },
      });
      const userRole = req.user?.role as Role | undefined;
      if (!userRole) {
        emitAgentEvent({
          phase: 'approval',
          action: 'image_generation',
          status: 'rejected',
          message: 'Permissão insuficiente para gerar imagens',
          correlationId: conversationId ?? undefined,
        });
        res.write(`data: ${JSON.stringify({ error: 'Permissão insuficiente para gerar imagens.' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      const internalHeaders = buildInternalServiceHeaders({
        userId,
        tenantId,
        role: userRole,
      });
      const permissionCheck = await checkPermission(
        { userId, tenantId, role: userRole },
        'images:generate:write'
      );
      if (!permissionCheck.allowed) {
        emitAgentEvent({
          phase: 'approval',
          action: 'image_generation',
          status: 'rejected',
          message: 'Permissão negada para gerar imagens',
          correlationId: conversationId ?? undefined,
        });
        res.write(`data: ${JSON.stringify({ error: 'Você não possui permissão para gerar imagens.' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      try {
        const generatedImage = await generateImageFromPrompt({
          tenantId,
          userId,
          prompt: imageDetection.prompt,
          conversationId,
          messageId: userMessage.id,
          internalHeaders,
        });

        const [assistantMessage] = await db.insert(schema.messages).values({
          conversationId,
          agentId: conversation?.agentId ?? undefined,
          conteudo: 'Imagem gerada.',
          tipo: 'text',
          isFromUser: false,
          metadata: {
            generatedImages: [generatedImage.id],
            model: generatedImage.model ?? undefined,
          },
        }).returning();

        await db.update(schema.conversations)
          .set({
            totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
            ultimaMensagemEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        await ensureConversationTitle({
          conversationId,
          userMessage: userMessageContent,
          assistantResponse: 'Imagem gerada.',
        });

        const generatedImagePayload = {
          id: generatedImage.id,
          prompt: generatedImage.prompt,
          imageUrl: generatedImage.imageUrl ?? undefined,
          imagePath: generatedImage.imagePath ?? undefined,
          status: generatedImage.status === 'generating' ? 'processing' : generatedImage.status,
          width: generatedImage.width ?? undefined,
          height: generatedImage.height ?? undefined,
          feedbackScore: generatedImage.feedbackScore ?? undefined,
        };
        emitAgentEvent({
          phase: 'tool',
          action: 'image_generation',
          status: 'success',
          message: 'Imagem gerada com sucesso',
          durationMs: Date.now() - imageStartAt,
          correlationId: conversationId ?? undefined,
          payload: {
            imageId: generatedImage.id,
            status: generatedImage.status,
            hasUrl: Boolean(generatedImage.imageUrl || generatedImage.imagePath),
          },
        });

        res.write(`data: ${JSON.stringify({
          type: 'generated_image',
          content: null,
          generatedImage: generatedImagePayload,
          message: {
            ...assistantMessage,
            generatedImage: generatedImagePayload,
          },
        })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      } catch (imageError) {
        const resolvedError = imageError instanceof Error ? imageError.message : String(imageError);
        logger.error({
          errorMessage: resolvedError,
          stack: imageError instanceof Error ? imageError.stack : undefined,
          conversationId,
        }, 'Falha ao gerar imagem via OpenAI (stream)');
        emitAgentEvent({
          phase: 'tool',
          action: 'image_generation',
          status: 'error',
          message: 'Falha ao gerar imagem via OpenAI',
          durationMs: Date.now() - imageStartAt,
          correlationId: conversationId ?? undefined,
          payload: {
            error: resolvedError,
          },
        });
        res.write(`data: ${JSON.stringify({
          error: 'Falha ao gerar imagem. Verifique a configuração e tente novamente.',
          code: 'OPENAI_IMAGE_ERROR',
        })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
    }

    const { parseTradingCommand, getCommandDescription, validateCommand } = await import('./trading-command-parser.js');
    const { canExecuteTradingCommand } = await import('./trading-orchestrator.js');

    const pendingAction = await db.query.actionRequests.findFirst({
      where: and(
        eq(schema.actionRequests.tenantId, tenantId),
        eq(schema.actionRequests.conversationId, conversationId),
        eq(schema.actionRequests.status, 'pending')
      ),
      orderBy: desc(schema.actionRequests.criadoEm),
    });

    if (pendingAction) {
      const intent = resolveActionConfirmationIntent(userMessageContent);
      if (intent) {
        const payload = (pendingAction.payload ?? {}) as {
          command?: ParsedTradingCommand;
          summary?: string;
          sourceMessageId?: string;
          integration?: {
            action?: 'payments' | 'stack_ops' | 'erp';
            operation?: string;
            params?: Record<string, unknown>;
          };
          task?: {
            taskType?: AgenticTaskType;
            mode?: AgenticTaskMode;
            title?: string;
            instructions?: string;
            documentId?: string;
          };
        };
        const pendingCommand = payload.command;
        const pendingTask = payload.task;
        const pendingIntegration = payload.integration;
        const isAgenticAction = ['document', 'report', 'accounting', 'planning'].includes(pendingAction.type);
        const actionLabel = resolveAgenticActionLabel({
          pendingCommand,
          pendingTask,
          pendingIntegration,
          fallback: isAgenticAction ? 'agentic_task' : undefined,
        });
        const actionStartedAt = pendingAction.criadoEm ?? null;
        if (!pendingCommand && !pendingTask && !pendingIntegration) {
          await db.update(schema.actionRequests)
            .set({
              status: 'failed',
              resolutionNote: 'Payload sem comando ou tarefa válida',
              resolvidoEm: new Date(),
              atualizadoEm: new Date(),
            })
            .where(eq(schema.actionRequests.id, pendingAction.id));

          recordAgenticMetrics({
            action: actionLabel,
            status: 'failed',
            startedAt: actionStartedAt,
          });

          const responseContent = 'Não foi possível localizar os detalhes da ação pendente. Por favor, envie a solicitação novamente.';
          const [assistantMessage] = await db.insert(schema.messages).values({
            conversationId,
            agentId: conversation?.agentId ?? undefined,
            conteudo: responseContent,
            tipo: 'text',
            isFromUser: false,
            metadata: {
              actionRequestId: pendingAction.id,
              actionStatus: 'failed',
            },
          }).returning();

          await db.update(schema.conversations)
            .set({
              totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
              ultimaMensagemEm: new Date(),
              atualizadoEm: new Date(),
            })
            .where(eq(schema.conversations.id, conversationId));

          res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        if (intent === 'reject') {
          await db.update(schema.actionRequests)
            .set({
              status: 'rejected',
              resolvedBy: userId,
              resolutionNote: 'Ação rejeitada pelo usuário',
              resolvidoEm: new Date(),
              atualizadoEm: new Date(),
            })
            .where(eq(schema.actionRequests.id, pendingAction.id));

          emitAgentEvent({
            phase: 'approval',
            action: actionLabel,
            status: 'rejected',
            message: 'Ação rejeitada',
            correlationId: conversationId ?? undefined,
            payload: {
              actionRequestId: pendingAction.id,
            },
          });
          recordAgenticMetrics({
            action: actionLabel,
            status: 'rejected',
            decision: 'reject',
            startedAt: actionStartedAt,
          });

          const responseContent = 'Ação cancelada conforme solicitado.';
          const [assistantMessage] = await db.insert(schema.messages).values({
            conversationId,
            agentId: conversation?.agentId ?? undefined,
            conteudo: responseContent,
            tipo: 'text',
            isFromUser: false,
            metadata: {
              actionRequestId: pendingAction.id,
              tradingCommand: pendingCommand,
              actionStatus: 'rejected',
            },
          }).returning();

          await db.update(schema.conversations)
            .set({
              totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
              ultimaMensagemEm: new Date(),
              atualizadoEm: new Date(),
            })
            .where(eq(schema.conversations.id, conversationId));

          res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        if (pendingIntegration && intent === 'approve') {
          const userRole = (req.user?.role as Role) || 'guest';
          const authContext: AuthContext = {
            userId,
            tenantId,
            role: userRole,
            customRoleId: req.user?.customRoleId ?? undefined,
          };
          try {
            const approvalStart = Date.now();
            emitAgentEvent({
              phase: 'approval',
              action: actionLabel,
              status: 'approved',
              message: 'Ação aprovada, executando',
              correlationId: conversationId ?? undefined,
              payload: {
                actionRequestId: pendingAction.id,
                operation: pendingIntegration.operation,
              },
            });
            let responseContent = 'Ação executada com sucesso.';
            let integrationResult: unknown = null;

            if (pendingIntegration.action === 'payments') {
              if (pendingIntegration.operation === 'wise_transfer') {
                const params = pendingIntegration.params as {
                  sourceCurrency: string;
                  targetCurrency: string;
                  sourceAmount: number;
                  recipientId: string;
                  reference?: string;
                };
                const quote = await callIntegrationsService<{ quote: { id: string } }>({
                  endpoint: '/api/integrations/wise/quotes',
                  method: 'POST',
                  body: {
                    sourceCurrency: params.sourceCurrency,
                    targetCurrency: params.targetCurrency,
                    sourceAmount: params.sourceAmount,
                  },
                  auth: authContext,
                });
                const transfer = await callIntegrationsService<{ transfer: unknown }>({
                  endpoint: '/api/integrations/wise/transfers',
                  method: 'POST',
                  body: {
                    quoteId: quote.quote.id,
                    targetRecipientId: params.recipientId,
                    reference: params.reference,
                  },
                  auth: authContext,
                });
                integrationResult = transfer;
                responseContent = 'Transferência Wise criada com sucesso.';
              }

              if (pendingIntegration.operation === 'stripe_payment_intent') {
                const params = pendingIntegration.params as {
                  amount: number;
                  currency: string;
                  description?: string;
                };
                const intentResult = await callIntegrationsService<{ paymentIntent: unknown }>({
                  endpoint: '/api/integrations/stripe/create-payment-intent',
                  method: 'POST',
                  body: {
                    amount: params.amount,
                    currency: params.currency,
                    description: params.description,
                  },
                  auth: authContext,
                });
                integrationResult = intentResult;
                responseContent = 'Payment Intent Stripe criada com sucesso.';
              }
            }

            if (pendingIntegration.action === 'stack_ops' && pendingIntegration.operation === 'deploy_stack') {
              const params = pendingIntegration.params as Record<string, unknown>;
              integrationResult = await callIntegrationsService({
                endpoint: '/api/integrations/github/deploy-stack',
                method: 'POST',
                body: params,
                auth: authContext,
              });
              responseContent = 'Workflow de deploy disparado no GitHub Actions.';
            }

            if (pendingIntegration.action === 'erp') {
              if (pendingIntegration.operation === 'create_customer') {
                const params = pendingIntegration.params as {
                  customerName: string;
                  customerType: string;
                  territory: string;
                  email?: string;
                  phone?: string;
                  taxId?: string;
                };
                const erpResult = await executeErpCommand({
                  command: { type: 'create_customer', payload: params },
                  auth: authContext,
                });
                responseContent = erpResult.responseContent;
                integrationResult = erpResult.integrationResult;
              }

              if (pendingIntegration.operation === 'create_invoice') {
                const params = pendingIntegration.params as {
                  customer: string;
                  items: Array<{ itemCode: string; qty: number; rate: number }>;
                  dueDate?: string;
                };
                const erpResult = await executeErpCommand({
                  command: { type: 'create_invoice', payload: params },
                  auth: authContext,
                });
                responseContent = erpResult.responseContent;
                integrationResult = erpResult.integrationResult;
              }
            }

            await db.update(schema.actionRequests)
              .set({
                status: 'executed',
                resolvedBy: userId,
                resolutionNote: 'Executado com sucesso',
                resolvidoEm: new Date(),
                atualizadoEm: new Date(),
              })
              .where(eq(schema.actionRequests.id, pendingAction.id));

            recordAgenticMetrics({
              action: actionLabel,
              status: 'executed',
              decision: 'approve',
              startedAt: actionStartedAt,
            });
            emitAgentEvent({
              phase: 'execution',
              action: actionLabel,
              status: 'success',
              message: 'Ação executada com sucesso',
              durationMs: Date.now() - approvalStart,
              correlationId: conversationId ?? undefined,
              payload: {
                actionRequestId: pendingAction.id,
                operation: pendingIntegration.operation,
              },
            });

            const [assistantMessage] = await db.insert(schema.messages).values({
              conversationId,
              agentId: conversation?.agentId ?? undefined,
              conteudo: responseContent,
              tipo: 'text',
              isFromUser: false,
              metadata: {
                actionRequestId: pendingAction.id,
                integrationResult,
                actionStatus: 'executed',
              },
            }).returning();

            await db.update(schema.conversations)
              .set({
                totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
                ultimaMensagemEm: new Date(),
                atualizadoEm: new Date(),
              })
              .where(eq(schema.conversations.id, conversationId));

            res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          } catch (integrationError) {
            const errorMessage = integrationError instanceof Error ? integrationError.message : 'Erro desconhecido';
            await db.update(schema.actionRequests)
              .set({
                status: 'failed',
                resolutionNote: errorMessage,
                resolvidoEm: new Date(),
                atualizadoEm: new Date(),
              })
              .where(eq(schema.actionRequests.id, pendingAction.id));

            recordAgenticMetrics({
              action: actionLabel,
              status: 'failed',
              decision: 'approve',
              startedAt: actionStartedAt,
            });
            emitAgentEvent({
              phase: 'execution',
              action: actionLabel,
              status: 'error',
              message: 'Falha ao executar ação',
              correlationId: conversationId ?? undefined,
              payload: {
                actionRequestId: pendingAction.id,
                operation: pendingIntegration.operation,
                error: errorMessage,
              },
            });

            res.write(`data: ${JSON.stringify({ error: `Erro ao executar a ação pendente: ${errorMessage}` })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
        }

        if (isAgenticAction) {
          try {
            await db.update(schema.actionRequests)
              .set({
                status: 'approved',
                resolvedBy: userId,
                resolutionNote: 'Ação aprovada pelo usuário',
                atualizadoEm: new Date(),
              })
              .where(eq(schema.actionRequests.id, pendingAction.id));

            const taskType = (pendingTask?.taskType ?? pendingAction.type) as AgenticTaskType;
            const mode = pendingTask?.mode ?? 'create';
            const taskResult = await executeAgenticTask({
              tenantId,
              userId,
              role: req.user?.role as Role,
              conversationId,
              namespaceId: conversation?.namespaceId ?? namespaceId,
              agentId: conversation?.agentId ?? undefined,
              actionRequestId: pendingAction.id,
              taskType,
              mode,
              instructions: pendingTask?.instructions ?? userMessageContent,
              title: pendingTask?.title,
              documentId: pendingTask?.documentId,
              sourceMessageId: payload.sourceMessageId,
            });

            const verb = mode === 'update' ? 'atualizado' : 'criado';
            const responseContent = taskResult.success
              ? `Tarefa concluída com sucesso. Documento ${verb} ${taskResult.documentId ? `(${taskResult.documentId})` : ''}.`
              : `Falha ao executar a tarefa: ${taskResult.error || 'erro desconhecido'}.`;

            await db.update(schema.actionRequests)
              .set({
                status: taskResult.success ? 'executed' : 'failed',
                resolutionNote: taskResult.success ? 'Executado com sucesso' : (taskResult.error || 'Falha na execução'),
                resolvidoEm: new Date(),
                atualizadoEm: new Date(),
              })
              .where(eq(schema.actionRequests.id, pendingAction.id));

            recordAgenticMetrics({
              action: actionLabel,
              status: taskResult.success ? 'executed' : 'failed',
              decision: 'approve',
              startedAt: actionStartedAt,
            });

            const [assistantMessage] = await db.insert(schema.messages).values({
              conversationId,
              agentId: conversation?.agentId ?? undefined,
              conteudo: responseContent,
              tipo: 'text',
              isFromUser: false,
              metadata: {
                actionRequestId: pendingAction.id,
                actionStatus: taskResult.success ? 'executed' : 'failed',
                agenticTask: taskResult,
              },
            }).returning();

            await db.update(schema.conversations)
              .set({
                totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
                ultimaMensagemEm: new Date(),
                atualizadoEm: new Date(),
              })
              .where(eq(schema.conversations.id, conversationId));

            res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          } catch (taskError) {
            const errorMessage = taskError instanceof Error ? taskError.message : 'Erro desconhecido';
            await db.update(schema.actionRequests)
              .set({
                status: 'failed',
                resolutionNote: errorMessage,
                resolvidoEm: new Date(),
                atualizadoEm: new Date(),
              })
              .where(eq(schema.actionRequests.id, pendingAction.id));

            recordAgenticMetrics({
              action: actionLabel,
              status: 'failed',
              decision: 'approve',
              startedAt: actionStartedAt,
            });

            res.write(`data: ${JSON.stringify({ error: `Erro ao executar tarefa: ${errorMessage}` })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
        }

        const canExecute = await canExecuteTradingCommand(tenantId, 'user');
        if (!canExecute.canExecute) {
          await db.update(schema.actionRequests)
            .set({
              status: 'failed',
              resolutionNote: canExecute.reason ?? 'Trading bloqueado no momento da confirmação',
              resolvidoEm: new Date(),
              atualizadoEm: new Date(),
            })
            .where(eq(schema.actionRequests.id, pendingAction.id));

          recordAgenticMetrics({
            action: actionLabel,
            status: 'failed',
            decision: 'approve',
            startedAt: actionStartedAt,
          });

          const responseContent = `Não foi possível executar a ação: ${canExecute.reason ?? 'trading bloqueado no momento da confirmação'}.`;
          const [assistantMessage] = await db.insert(schema.messages).values({
            conversationId,
            agentId: conversation?.agentId ?? undefined,
            conteudo: responseContent,
            tipo: 'text',
            isFromUser: false,
            metadata: {
              actionRequestId: pendingAction.id,
              tradingCommand: pendingCommand,
              actionStatus: 'failed',
              reason: canExecute.reason ?? null,
            },
          }).returning();

          await db.update(schema.conversations)
            .set({
              totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
              ultimaMensagemEm: new Date(),
              atualizadoEm: new Date(),
            })
            .where(eq(schema.conversations.id, conversationId));

          res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        try {
          await db.update(schema.actionRequests)
            .set({
              status: 'approved',
              resolvedBy: userId,
              resolutionNote: 'Ação aprovada pelo usuário',
              atualizadoEm: new Date(),
            })
            .where(eq(schema.actionRequests.id, pendingAction.id));

          if (!pendingCommand) {
            throw new Error('Comando de trading pendente não encontrado');
          }
          const tradingCommand = pendingCommand;
          const result = await executeTradingCommand(userId, tenantId, tradingCommand);
          const description = getCommandDescription(tradingCommand, 'pt');
          const responseContent = result.success
            ? `Ação executada: ${description}.`
            : `Falha ao executar a ação (${description}): ${result.error || 'erro desconhecido'}.`;

          await db.update(schema.actionRequests)
            .set({
              status: result.success ? 'executed' : 'failed',
              resolutionNote: result.success ? 'Executado com sucesso' : (result.error || 'Falha na execução'),
              resolvidoEm: new Date(),
              atualizadoEm: new Date(),
            })
            .where(eq(schema.actionRequests.id, pendingAction.id));

          recordAgenticMetrics({
            action: actionLabel,
            status: result.success ? 'executed' : 'failed',
            decision: 'approve',
            startedAt: actionStartedAt,
          });

          const [assistantMessage] = await db.insert(schema.messages).values({
            conversationId,
            agentId: conversation?.agentId ?? undefined,
            conteudo: responseContent,
            tipo: 'text',
            isFromUser: false,
            metadata: {
              actionRequestId: pendingAction.id,
              tradingCommand: tradingCommand,
              tradingResult: result,
              actionStatus: result.success ? 'executed' : 'failed',
            },
          }).returning();

          await db.update(schema.conversations)
            .set({
              totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
              ultimaMensagemEm: new Date(),
              atualizadoEm: new Date(),
            })
            .where(eq(schema.conversations.id, conversationId));

          res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        } catch (commandError) {
          const errorMessage = commandError instanceof Error ? commandError.message : 'Erro desconhecido';
          await db.update(schema.actionRequests)
            .set({
              status: 'failed',
              resolutionNote: errorMessage,
              resolvidoEm: new Date(),
              atualizadoEm: new Date(),
            })
            .where(eq(schema.actionRequests.id, pendingAction.id));

          recordAgenticMetrics({
            action: actionLabel,
            status: 'failed',
            decision: 'approve',
            startedAt: actionStartedAt,
          });

          res.write(`data: ${JSON.stringify({ error: `Erro ao executar a ação pendente: ${errorMessage}` })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
      }

      const pendingAgenticDetection = detectAgenticTaskRequest(userMessageContent, agenticDetectors);
      const pendingPaymentCommand = detectPaymentCommand(userMessageContent, agenticDetectors);
      const pendingErpCommand = detectErpCommand(userMessageContent, agenticDetectors);
      if (
        isTradingCommandWithDetectors(userMessageContent, agenticDetectors)
        || pendingAgenticDetection.isTaskRequest
        || Boolean(pendingPaymentCommand)
        || Boolean(pendingErpCommand)
      ) {
        const responseContent = 'Existe uma ação pendente aguardando confirmação. Responda "confirmar" para executar ou "cancelar" para abortar.';
        const [assistantMessage] = await db.insert(schema.messages).values({
          conversationId,
          agentId: conversation?.agentId ?? undefined,
          conteudo: responseContent,
          tipo: 'text',
          isFromUser: false,
          metadata: {
            actionRequestId: pendingAction.id,
            actionStatus: 'pending',
          },
        }).returning();

        await db.update(schema.conversations)
          .set({
            totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
            ultimaMensagemEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
    }

    if (isTradingCommandWithDetectors(userMessageContent, agenticDetectors)) {
      if (!agenticSettings.tradingEnabled) {
        const responseContent = 'Trading está desativado nas configurações do tenant.';
        const [assistantMessage] = await db.insert(schema.messages).values({
          conversationId,
          agentId: conversation?.agentId ?? undefined,
          conteudo: responseContent,
          tipo: 'text',
          isFromUser: false,
          metadata: {
            tradingDisabled: true,
          },
        }).returning();

        await db.update(schema.conversations)
          .set({
            totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
            ultimaMensagemEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      const conversationState = await getOrCreateConversationState(conversationId);
      const approvalPolicy = (conversationState.approvalPolicy ?? 'never_confirm') as ConversationApprovalPolicy;
      const parsedCommand = parseTradingCommand(userMessageContent);
      const validation = validateCommand(parsedCommand);

      if (!validation.valid) {
        const hint = getValidationHint(parsedCommand.type, validation.missingFields, 'pt');
        const responseContent = `Comando de trading incompleto. ${hint}`;
        const [assistantMessage] = await db.insert(schema.messages).values({
          conversationId,
          agentId: conversation?.agentId ?? undefined,
          conteudo: responseContent,
          tipo: 'text',
          isFromUser: false,
          metadata: {
            tradingCommand: parsedCommand,
            validationError: true,
            missingFields: validation.missingFields,
          },
        }).returning();

        await db.update(schema.conversations)
          .set({
            totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
            ultimaMensagemEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const canExecute = await canExecuteTradingCommand(tenantId, 'user');
      if (!canExecute.canExecute) {
        const responseContent = `Trading bloqueado: ${canExecute.reason || 'permite operação apenas após habilitar o trading e configurar risco.'}`;
        const [assistantMessage] = await db.insert(schema.messages).values({
          conversationId,
          agentId: conversation?.agentId ?? undefined,
          conteudo: responseContent,
          tipo: 'text',
          isFromUser: false,
          metadata: {
            tradingCommand: parsedCommand,
            blocked: true,
            reason: canExecute.reason ?? null,
          },
        }).returning();

        await db.update(schema.conversations)
          .set({
            totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
            ultimaMensagemEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (shouldRequireTradingConfirmation(parsedCommand, approvalPolicy)) {
        const description = getCommandDescription(parsedCommand, 'pt');
        const [actionRequest] = await db.insert(schema.actionRequests).values({
          tenantId,
          conversationId,
          userId,
          agentId: conversation?.agentId ?? undefined,
          type: 'trading',
          status: 'pending',
          payload: {
            action: 'trading',
            summary: description,
            command: parsedCommand as unknown as Record<string, unknown>,
            approvalPolicy,
          },
        }).returning();

        recordAgenticMetrics({
          action: 'trading',
          status: 'pending',
        });

        const responseContent = `Para executar a ação de trading (${description}), preciso de confirmação explícita.\nResponda "confirmar" para executar ou "cancelar" para abortar.`;
        const [assistantMessage] = await db.insert(schema.messages).values({
          conversationId,
          agentId: conversation?.agentId ?? undefined,
          conteudo: responseContent,
          tipo: 'text',
          isFromUser: false,
          metadata: {
            actionRequestId: actionRequest?.id,
            tradingCommand: parsedCommand,
            actionStatus: 'pending',
            requiresConfirmation: true,
          },
        }).returning();

        await db.update(schema.conversations)
          .set({
            totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
            ultimaMensagemEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      try {
        const result = await executeTradingCommand(userId, tenantId, parsedCommand);
        const description = getCommandDescription(parsedCommand, 'pt');
        const responseContent = result.success
          ? `Comando de trading executado: ${description}.`
          : `Falha ao executar comando de trading (${description}): ${result.error || 'erro desconhecido'}.`;

        const [assistantMessage] = await db.insert(schema.messages).values({
          conversationId,
          agentId: conversation?.agentId ?? undefined,
          conteudo: responseContent,
          tipo: 'text',
          isFromUser: false,
          metadata: {
            tradingCommand: parsedCommand,
            tradingResult: result,
          },
        }).returning();

        await db.update(schema.conversations)
          .set({
            totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
            ultimaMensagemEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        try {
          await ensureConversationTitle({
            conversationId,
            userMessage: userMessageContent,
            assistantResponse: responseContent,
          });
        } catch (titleError) {
          logger.warn({ error: titleError, conversationId }, 'Falha ao aplicar título automático (trading command)');
        }

        res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      } catch (commandError) {
        const errorMessage = commandError instanceof Error ? commandError.message : 'Erro desconhecido';
        logger.error({ error: errorMessage, command: parsedCommand.type }, 'Falha ao executar comando de trading (stream)');
        res.write(`data: ${JSON.stringify({ error: `Erro ao executar comando de trading: ${errorMessage}` })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
    }

    const authContext: AuthContext = {
      userId,
      tenantId,
      role: (req.user?.role as Role) || 'guest',
      customRoleId: req.user?.customRoleId ?? undefined,
    };

    const linksRequest = normalizeForAgenticDetection(userMessageContent).includes('links')
      || normalizeForAgenticDetection(userMessageContent).includes('acessos')
      || normalizeForAgenticDetection(userMessageContent).includes('urls');
    const platformLinks = normalizeAgenticLinks(agenticSettings.platformLinks);
    if (linksRequest && platformLinks.length > 0) {
      const linksSummary = platformLinks
        .map((link) => `- ${link.name}: ${link.url}${link.description ? ` (${link.description})` : ''}`)
        .join('\n');
      const responseContent = `Links configurados para operações agentic:\n${linksSummary}`;
      const [assistantMessage] = await db.insert(schema.messages).values({
        conversationId,
        agentId: conversation?.agentId ?? undefined,
        conteudo: responseContent,
        tipo: 'text',
        isFromUser: false,
        metadata: {
          agenticLinks: true,
        },
      }).returning();

      await db.update(schema.conversations)
        .set({
          totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
          ultimaMensagemEm: new Date(),
          atualizadoEm: new Date(),
        })
        .where(eq(schema.conversations.id, conversationId));

      res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const erpCommand = detectErpCommand(userMessageContent, agenticDetectors);
    if (erpCommand) {
      if ((erpCommand.type === 'list_items' || erpCommand.type === 'list_customers' || erpCommand.type === 'list_invoices' || erpCommand.type === 'annual_billing') && !agenticSettings.erpReadEnabled) {
        res.write(`data: ${JSON.stringify({ error: 'ERPNext leitura está desativada nas configurações do tenant.' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      if ((erpCommand.type === 'create_customer' || erpCommand.type === 'create_invoice') && !agenticSettings.erpWriteEnabled) {
        res.write(`data: ${JSON.stringify({ error: 'ERPNext escrita está desativada nas configurações do tenant.' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const permissionCheck = await checkPermission(
        authContext,
        erpCommand.type === 'list_items'
        || erpCommand.type === 'list_customers'
        || erpCommand.type === 'list_invoices'
        || erpCommand.type === 'annual_billing'
          ? 'integrations:erpnext:read'
          : 'integrations:erpnext:write'
      );
      if (!permissionCheck.allowed) {
        res.write(`data: ${JSON.stringify({ error: 'Você não possui permissão para operar o ERPNext.' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if ('missing' in erpCommand && erpCommand.missing?.length) {
        const responseContent = `Para executar a ação no ERPNext, preciso dos campos: ${erpCommand.missing.join(', ')}.\nExemplo: nome: Empresa X | tipo: Company | territorio: Brasil`;
        const [assistantMessage] = await db.insert(schema.messages).values({
          conversationId,
          agentId: conversation?.agentId ?? undefined,
          conteudo: responseContent,
          tipo: 'text',
          isFromUser: false,
          metadata: {
            erpCommand,
            validationError: true,
          },
        }).returning();

        await db.update(schema.conversations)
          .set({
            totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
            ultimaMensagemEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const erpSummary = buildErpCommandSummary(erpCommand);

      if (isErpWriteCommand(erpCommand)) {
        const [actionRequest] = await db.insert(schema.actionRequests).values({
          tenantId,
          conversationId,
          userId,
          agentId: conversation?.agentId ?? undefined,
          type: 'integration',
          status: 'pending',
          payload: {
            action: 'erp',
            summary: erpSummary,
            integration: {
              action: 'erp',
              operation: erpCommand.type,
              params: erpCommand.payload,
            },
            sourceMessageId: userMessage.id,
          },
        }).returning();

        recordAgenticMetrics({
          action: 'erp',
          status: 'pending',
        });

        const responseContent = `Para executar a operação (${erpSummary}), preciso de confirmação explícita.\nResponda "confirmar" para executar ou "cancelar" para abortar.`;
        const [assistantMessage] = await db.insert(schema.messages).values({
          conversationId,
          agentId: conversation?.agentId ?? undefined,
          conteudo: responseContent,
          tipo: 'text',
          isFromUser: false,
          metadata: {
            actionRequestId: actionRequest?.id,
            actionStatus: 'pending',
            requiresConfirmation: true,
          },
        }).returning();

        await db.update(schema.conversations)
          .set({
            totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
            ultimaMensagemEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      try {
        const { responseContent, integrationResult } = await executeErpCommand({
          command: erpCommand,
          auth: authContext,
        });

        const [actionRequest] = await db.insert(schema.actionRequests).values({
          tenantId,
          conversationId,
          userId,
          agentId: conversation?.agentId ?? undefined,
          type: 'integration',
          status: 'executed',
          payload: {
            action: 'erp',
            summary: erpSummary,
            operation: erpCommand.type,
            params: 'payload' in erpCommand ? erpCommand.payload : undefined,
            result: integrationResult,
          },
          resolvedBy: userId,
          resolvidoEm: new Date(),
          atualizadoEm: new Date(),
        }).returning();

        recordAgenticMetrics({
          action: 'erp',
          status: 'executed',
        });

        const [assistantMessage] = await db.insert(schema.messages).values({
          conversationId,
          agentId: conversation?.agentId ?? undefined,
          conteudo: responseContent,
          tipo: 'text',
          isFromUser: false,
          metadata: {
            actionRequestId: actionRequest?.id,
            erpCommand,
            actionStatus: 'executed',
          },
        }).returning();

        await db.update(schema.conversations)
          .set({
            totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
            ultimaMensagemEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      } catch (erpError) {
        const errorMessage = erpError instanceof Error ? erpError.message : 'Erro desconhecido';
        recordAgenticMetrics({
          action: 'erp',
          status: 'failed',
        });
        res.write(`data: ${JSON.stringify({ error: `Erro ao executar operação ERPNext: ${errorMessage}` })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
    }

    if (!erpCommand && detectErpIntent(userMessageContent, agenticDetectors)) {
      const responseContent = [
        'Não consegui identificar uma operação válida no ERPNext para esse pedido.',
        'Consigo executar: listar clientes, listar itens, listar faturas, criar cliente, criar fatura e faturamento anual do cliente.',
        'Exemplo: "faturamento anual do cliente Palmer Productions Ltd. ano 2025".',
      ].join(' ');
      const [assistantMessage] = await db.insert(schema.messages).values({
        conversationId,
        agentId: conversation?.agentId ?? undefined,
        conteudo: responseContent,
        tipo: 'text',
        isFromUser: false,
        metadata: {
          erpCommand: 'unsupported',
        },
      }).returning();

      await db.update(schema.conversations)
        .set({
          totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
          ultimaMensagemEm: new Date(),
          atualizadoEm: new Date(),
        })
        .where(eq(schema.conversations.id, conversationId));

      res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const paymentCommand = detectPaymentCommand(userMessageContent, agenticDetectors);
    if (paymentCommand) {
      if (!agenticSettings.paymentsEnabled) {
        res.write(`data: ${JSON.stringify({ error: 'Pagamentos estão desativados nas configurações do tenant.' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const permissionCheck = await checkPermission(
        authContext,
        paymentCommand.type === 'stripe_payment_intent'
          ? 'integrations:stripe:write'
          : paymentCommand.type === 'wise_recipients'
            ? 'integrations:wise:read'
            : 'integrations:wise:write'
      );
      if (!permissionCheck.allowed) {
        res.write(`data: ${JSON.stringify({ error: 'Você não possui permissão para executar pagamentos.' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (paymentCommand.type === 'wise_recipients') {
        try {
          const result = await callIntegrationsService<{ recipients: Array<Record<string, unknown>> }>({
            endpoint: '/api/integrations/wise/recipients',
            method: 'GET',
            auth: authContext,
          });
          const recipients = result.recipients.slice(0, 10).map((recipient) => {
            const name = String(recipient.name ?? recipient.fullName ?? recipient.accountHolderName ?? '');
            const id = String(recipient.id ?? recipient.recipientId ?? '');
            return `- ${name} (${id})`;
          });
          const responseContent = recipients.length
            ? `Destinatários Wise (top 10):\n${recipients.join('\n')}`
            : 'Nenhum destinatário Wise encontrado.';

          const [actionRequest] = await db.insert(schema.actionRequests).values({
            tenantId,
            conversationId,
            userId,
            agentId: conversation?.agentId ?? undefined,
            type: 'integration',
            status: 'executed',
            payload: {
              action: 'payments',
              summary: 'Listagem de destinatários Wise',
              result,
            },
            resolvedBy: userId,
            resolvidoEm: new Date(),
            atualizadoEm: new Date(),
          }).returning();

          recordAgenticMetrics({
            action: 'payments',
            status: 'executed',
          });

          const [assistantMessage] = await db.insert(schema.messages).values({
            conversationId,
            agentId: conversation?.agentId ?? undefined,
            conteudo: responseContent,
            tipo: 'text',
            isFromUser: false,
            metadata: {
              actionRequestId: actionRequest?.id,
              actionStatus: 'executed',
            },
          }).returning();

          await db.update(schema.conversations)
            .set({
              totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
              ultimaMensagemEm: new Date(),
              atualizadoEm: new Date(),
            })
            .where(eq(schema.conversations.id, conversationId));

          res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        } catch (paymentError) {
          const errorMessage = paymentError instanceof Error ? paymentError.message : 'Erro desconhecido';
          recordAgenticMetrics({
            action: 'payments',
            status: 'failed',
          });
          res.write(`data: ${JSON.stringify({ error: `Erro ao consultar destinatários Wise: ${errorMessage}` })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
      }

      if ('missing' in paymentCommand && paymentCommand.missing?.length) {
        const responseContent = `Para executar o pagamento, preciso dos campos: ${paymentCommand.missing.join(', ')}.`;
        const [assistantMessage] = await db.insert(schema.messages).values({
          conversationId,
          agentId: conversation?.agentId ?? undefined,
          conteudo: responseContent,
          tipo: 'text',
          isFromUser: false,
          metadata: {
            paymentCommand,
            validationError: true,
          },
        }).returning();

        await db.update(schema.conversations)
          .set({
            totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
            ultimaMensagemEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const summary = paymentCommand.type === 'wise_transfer'
        ? `Transferência Wise (${paymentCommand.payload.sourceAmount} ${paymentCommand.payload.sourceCurrency} → ${paymentCommand.payload.targetCurrency})`
        : `Pagamento Stripe (${paymentCommand.payload.amount} ${paymentCommand.payload.currency})`;

      if (!agenticSettings.financialApprovalRequired) {
        try {
          let result: unknown = null;
          if (paymentCommand.type === 'wise_transfer') {
            const quote = await callIntegrationsService<{ quote: { id: string } }>({
              endpoint: '/api/integrations/wise/quotes',
              method: 'POST',
              body: {
                sourceCurrency: paymentCommand.payload.sourceCurrency,
                targetCurrency: paymentCommand.payload.targetCurrency,
                sourceAmount: paymentCommand.payload.sourceAmount,
              },
              auth: authContext,
            });
            result = await callIntegrationsService({
              endpoint: '/api/integrations/wise/transfers',
              method: 'POST',
              body: {
                quoteId: quote.quote.id,
                targetRecipientId: paymentCommand.payload.recipientId,
                reference: paymentCommand.payload.reference,
              },
              auth: authContext,
            });
          }

          if (paymentCommand.type === 'stripe_payment_intent') {
            result = await callIntegrationsService({
              endpoint: '/api/integrations/stripe/create-payment-intent',
              method: 'POST',
              body: {
                amount: paymentCommand.payload.amount,
                currency: paymentCommand.payload.currency,
                description: paymentCommand.payload.description,
              },
              auth: authContext,
            });
          }

          const [actionRequest] = await db.insert(schema.actionRequests).values({
            tenantId,
            conversationId,
            userId,
            agentId: conversation?.agentId ?? undefined,
            type: 'integration',
            status: 'executed',
            payload: {
              action: 'payments',
              summary,
              result,
            },
            resolvedBy: userId,
            resolvidoEm: new Date(),
            atualizadoEm: new Date(),
          }).returning();

          recordAgenticMetrics({
            action: 'payments',
            status: 'executed',
          });

          const responseContent = `Pagamento executado: ${summary}.`;
          const [assistantMessage] = await db.insert(schema.messages).values({
            conversationId,
            agentId: conversation?.agentId ?? undefined,
            conteudo: responseContent,
            tipo: 'text',
            isFromUser: false,
            metadata: {
              actionRequestId: actionRequest?.id,
              actionStatus: 'executed',
            },
          }).returning();

          await db.update(schema.conversations)
            .set({
              totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
              ultimaMensagemEm: new Date(),
              atualizadoEm: new Date(),
            })
            .where(eq(schema.conversations.id, conversationId));

          res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        } catch (paymentError) {
          const errorMessage = paymentError instanceof Error ? paymentError.message : 'Erro desconhecido';
          recordAgenticMetrics({
            action: 'payments',
            status: 'failed',
          });
          res.write(`data: ${JSON.stringify({ error: `Erro ao executar pagamento: ${errorMessage}` })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
      }

      const [actionRequest] = await db.insert(schema.actionRequests).values({
        tenantId,
        conversationId,
        userId,
        agentId: conversation?.agentId ?? undefined,
        type: 'integration',
        status: 'pending',
        payload: {
          action: 'payments',
          summary,
          integration: {
            action: 'payments',
            operation: paymentCommand.type,
            params: paymentCommand.payload,
          },
        },
      }).returning();

      recordAgenticMetrics({
        action: 'payments',
        status: 'pending',
      });

      const responseContent = `Para executar o pagamento (${summary}), preciso de confirmação explícita.\nResponda "confirmar" para executar ou "cancelar" para abortar.`;
      const [assistantMessage] = await db.insert(schema.messages).values({
        conversationId,
        agentId: conversation?.agentId ?? undefined,
        conteudo: responseContent,
        tipo: 'text',
        isFromUser: false,
        metadata: {
          actionRequestId: actionRequest?.id,
          actionStatus: 'pending',
          requiresConfirmation: true,
        },
      }).returning();

      await db.update(schema.conversations)
        .set({
          totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
          ultimaMensagemEm: new Date(),
          atualizadoEm: new Date(),
        })
        .where(eq(schema.conversations.id, conversationId));

      res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const stackCommand = detectStackCommand(userMessageContent, agenticDetectors);
    if (stackCommand) {
      if (!agenticSettings.stackOpsEnabled) {
        res.write(`data: ${JSON.stringify({ error: 'Stack ops está desativado nas configurações do tenant.' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      const permissionCheck = await checkPermission(authContext, 'admin:alice_core:write');
      if (!permissionCheck.allowed) {
        res.write(`data: ${JSON.stringify({ error: 'Você não possui permissão para operar stacks.' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (stackCommand.type === 'deploy' && !stackCommand.version) {
        const responseContent = 'Informe a versão para deploy. Exemplo: "deploy stack alice v1.2.3".';
        const [assistantMessage] = await db.insert(schema.messages).values({
          conversationId,
          agentId: conversation?.agentId ?? undefined,
          conteudo: responseContent,
          tipo: 'text',
          isFromUser: false,
          metadata: {
            stackCommand,
            validationError: true,
          },
        }).returning();

        await db.update(schema.conversations)
          .set({
            totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
            ultimaMensagemEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (stackCommand.type === 'rollback' && !stackCommand.version) {
        const responseContent = 'Informe a versão alvo para rollback. Exemplo: "rollback stack alice v1.2.3".';
        const [assistantMessage] = await db.insert(schema.messages).values({
          conversationId,
          agentId: conversation?.agentId ?? undefined,
          conteudo: responseContent,
          tipo: 'text',
          isFromUser: false,
          metadata: {
            stackCommand,
            validationError: true,
          },
        }).returning();

        await db.update(schema.conversations)
          .set({
            totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
            ultimaMensagemEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const payload = stackCommand.type === 'deploy'
        ? {
            stack: stackCommand.stack,
            version: stackCommand.version,
            rollback: false,
            dryRun: stackCommand.dryRun ?? false,
            smartDeploy: stackCommand.smartDeploy ?? false,
          }
        : {
            stack: stackCommand.stack,
            version: stackCommand.version,
            rollback: true,
            rollbackVersion: stackCommand.rollbackVersion ?? stackCommand.version,
            dryRun: false,
            smartDeploy: false,
          };

      const summary = stackCommand.type === 'deploy'
        ? `Deploy ${payload.stack} (${payload.version})`
        : `Rollback ${payload.stack} (${payload.rollbackVersion || payload.version})`;

      const [actionRequest] = await db.insert(schema.actionRequests).values({
        tenantId,
        conversationId,
        userId,
        agentId: conversation?.agentId ?? undefined,
        type: 'integration',
        status: 'pending',
        payload: {
          action: 'stack_ops',
          summary,
          integration: {
            action: 'stack_ops',
            operation: 'deploy_stack',
            params: payload,
          },
        },
      }).returning();

      recordAgenticMetrics({
        action: 'stack_ops',
        status: 'pending',
      });

      const responseContent = `Para executar a operação (${summary}), preciso de confirmação explícita.\nResponda "confirmar" para executar ou "cancelar" para abortar.`;
      const [assistantMessage] = await db.insert(schema.messages).values({
        conversationId,
        agentId: conversation?.agentId ?? undefined,
        conteudo: responseContent,
        tipo: 'text',
        isFromUser: false,
        metadata: {
          actionRequestId: actionRequest?.id,
          actionStatus: 'pending',
          requiresConfirmation: true,
        },
      }).returning();

      await db.update(schema.conversations)
        .set({
          totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
          ultimaMensagemEm: new Date(),
          atualizadoEm: new Date(),
        })
        .where(eq(schema.conversations.id, conversationId));

      res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

      const agenticDetection = detectAgenticTaskRequest(userMessageContent, agenticDetectors);
      if (agenticDetection.isTaskRequest && agenticDetection.taskType && agenticDetection.instructions) {
        const conversationState = await getOrCreateConversationState(conversationId);
        const approvalPolicy = (conversationState.approvalPolicy ?? 'never_confirm') as ConversationApprovalPolicy;
        const requiresConfirmation = shouldRequireAgenticConfirmation(
          agenticDetection.taskType,
          agenticDetection.mode ?? 'create',
          approvalPolicy
        );
        const taskTitle = buildAgenticTaskTitle(agenticDetection.taskType, agenticDetection.title);
        const taskSummary = `${AGENTIC_TASK_TITLES[agenticDetection.taskType]}: ${taskTitle}`;

        if (requiresConfirmation) {
          const [actionRequest] = await db.insert(schema.actionRequests).values({
            tenantId,
            conversationId,
            userId,
            agentId: conversation?.agentId ?? undefined,
            type: agenticDetection.taskType,
            status: 'pending',
            payload: {
              action: 'agentic_task',
              summary: taskSummary,
              task: {
                taskType: agenticDetection.taskType,
                mode: agenticDetection.mode ?? 'create',
                title: taskTitle,
                instructions: agenticDetection.instructions,
                documentId: agenticDetection.documentId,
              },
              sourceMessageId: userMessage.id,
            },
          }).returning();

          recordAgenticMetrics({
            action: 'agentic_task',
            status: 'pending',
          });

          const responseContent = `Para executar a tarefa (${taskSummary}), preciso de confirmação explícita.\nResponda "confirmar" para executar ou "cancelar" para abortar.`;
          const [assistantMessage] = await db.insert(schema.messages).values({
            conversationId,
            agentId: conversation?.agentId ?? undefined,
            conteudo: responseContent,
            tipo: 'text',
            isFromUser: false,
            metadata: {
              actionRequestId: actionRequest?.id,
              actionStatus: 'pending',
              requiresConfirmation: true,
            },
          }).returning();

          await db.update(schema.conversations)
            .set({
              totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
              ultimaMensagemEm: new Date(),
              atualizadoEm: new Date(),
            })
            .where(eq(schema.conversations.id, conversationId));

          res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        const agenticTaskStart = Date.now();
        emitAgentEvent({
          phase: 'execution',
          action: 'agentic_task',
          status: 'start',
          message: 'Executando tarefa agentic',
          correlationId: conversationId ?? undefined,
          payload: {
            taskType: agenticDetection.taskType,
            mode: agenticDetection.mode ?? 'create',
            documentId: agenticDetection.documentId,
          },
        });
        const taskResult = await executeAgenticTask({
          tenantId,
          userId,
          role: req.user?.role as Role,
          conversationId,
          namespaceId: conversation?.namespaceId ?? namespaceId,
          agentId: conversation?.agentId ?? undefined,
          taskType: agenticDetection.taskType,
          mode: agenticDetection.mode ?? 'create',
          instructions: agenticDetection.instructions,
          title: taskTitle,
          documentId: agenticDetection.documentId,
          sourceMessageId: userMessage.id,
        });
        emitAgentEvent({
          phase: 'execution',
          action: 'agentic_task',
          status: taskResult.success ? 'success' : 'error',
          message: taskResult.success ? 'Tarefa agentic concluída' : 'Falha na tarefa agentic',
          durationMs: Date.now() - agenticTaskStart,
          correlationId: conversationId ?? undefined,
          payload: {
            taskType: agenticDetection.taskType,
            mode: agenticDetection.mode ?? 'create',
            documentId: taskResult.documentId ?? agenticDetection.documentId,
          },
        });

        const verb = (agenticDetection.mode ?? 'create') === 'update' ? 'atualizado' : 'criado';
        const responseContent = taskResult.success
          ? `Tarefa concluída com sucesso. Documento ${verb} ${taskResult.documentId ? `(${taskResult.documentId})` : ''}.`
          : `Falha ao executar a tarefa (${taskSummary}): ${taskResult.error || 'erro desconhecido'}.`;

        recordAgenticMetrics({
          action: 'agentic_task',
          status: taskResult.success ? 'executed' : 'failed',
        });

        const [assistantMessage] = await db.insert(schema.messages).values({
          conversationId,
          agentId: conversation?.agentId ?? undefined,
          conteudo: responseContent,
          tipo: 'text',
          isFromUser: false,
          metadata: {
            agenticTask: taskResult,
          },
        }).returning();

        await db.update(schema.conversations)
          .set({
            totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
            ultimaMensagemEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const agent = conversation?.agent ?? null;
      const ragParams = getAdaptiveRagParams(userMessageContent, previousMessages.length);
      const explicitDeepWebRequest = isExplicitDeepWebRequest(userMessageContent, agenticDetectors);
      const explicitWebRequest = isExplicitWebRequest(userMessageContent, agenticDetectors) || explicitDeepWebRequest;
      const ragInternalStart = Date.now();
      const classificationStartedAt = Date.now();
      const [assistantSettings, ragResult, ragClassification] = await Promise.all([
        getAssistantSettingsForTenant(tenantId),
        (async () => {
          writeStatus('rag_internal');
          emitAgentEvent({
            phase: 'tool',
            action: 'rag_internal',
            status: 'start',
            message: 'Buscando contexto interno',
            correlationId: conversationId ?? undefined,
            payload: {
              limit: ragParams.limit,
              threshold: ragParams.threshold,
              namespaceId: conversation?.namespaceId || namespaceId,
            },
          });
          return buscarContextoRAG(
            userMessageContent,
            conversation?.namespaceId || namespaceId,
            ragParams.limit,
            ragParams.threshold,
            { userId, tenantId, role: req.user?.role as Role }
          );
        })(),
        classificarConsultaAgentic({
          query: userMessageContent,
          auth: { userId, tenantId, role: req.user?.role as Role },
        }),
      ]);
      emitAgentEvent({
        phase: 'tool',
        action: 'rag_internal',
        status: 'success',
        message: 'Contexto interno disponível',
        durationMs: Date.now() - ragInternalStart,
        correlationId: conversationId ?? undefined,
        payload: {
          sources: ragResult?.sources?.length ?? 0,
        },
      });
      recordRagRelevance(tenantId, ragResult);

      if (ragClassification?.classification) {
        emitAgentEvent({
          phase: 'planning',
          action: 'query_classification',
          status: 'success',
        message: `Classificacao concluida: ${ragClassification.classification.type}`,
          durationMs: Date.now() - classificationStartedAt,
          correlationId: conversationId ?? undefined,
          payload: {
            type: ragClassification.classification.type,
            confidence: ragClassification.classification.confidence,
            webMode: ragClassification.classification.webMode,
            webSearchAvailable: ragClassification.webSearchAvailable,
            reason: ragClassification.classification.reason,
          },
        });
      }

      let systemPrompt = buildSystemPrompt(agent, assistantSettings, userMessageContent, userLocaleContext);
      systemPrompt = appendUserNamePolicy(systemPrompt, nameContext, nameUsageContext);
      systemPrompt = appendNameConfirmationInstruction(systemPrompt, nameContext);
      let ragSources: Array<{ documentId: string; titulo: string; similarity: number }> = [];
      let webSources: Array<{ title: string; url: string }> = [];
      const classificationWebMode = ragClassification?.classification?.webMode;
      let memorySearchApplied = false;

      if (ragResult && ragResult.context) {
        systemPrompt += formatarContextoParaLLM(ragResult);
        ragSources = ragResult.sources;
        logger.info({ 
          ragChunks: ragResult.sources.length,
          namespaceId,
        }, 'Contexto RAG injetado no streaming');
      }

      if (isMemorySearchIntent(userMessageContent)) {
        const memoryHistory = await fetchUserMemoryHistory({
          userId,
          tenantId,
          conversationId,
          limit: CHAT_HISTORY_SEARCH_LIMIT,
        });
        const memoryBlock = buildMemorySearchBlock(
          memoryHistory,
          userMessageContent,
          CHAT_HISTORY_SEARCH_TOKEN_BUDGET
        );
        if (memoryBlock) {
          memorySearchApplied = true;
          systemPrompt += `\n\nHISTÓRICO RELEVANTE (memória solicitada):\n${memoryBlock}`;
        }
      }

      const shouldUseWeb = agenticSettings.webEnabled && (
        explicitWebRequest
          ? ragClassification?.webSearchAvailable !== false
          : Boolean(
              ragClassification?.webSearchAvailable &&
              ragClassification?.classification?.type &&
              ragClassification.classification.type !== 'internal'
            )
      );

      emitAgentEvent({
        phase: 'planning',
        action: 'web_decision',
        status: shouldUseWeb ? 'success' : 'skipped',
        message: shouldUseWeb
          ? 'Busca web habilitada para esta consulta'
          : 'Busca web nao necessaria para esta consulta',
        correlationId: conversationId ?? undefined,
        payload: {
          explicitWebRequest,
          explicitDeepWebRequest,
          classificationType: ragClassification?.classification?.type,
          webSearchAvailable: ragClassification?.webSearchAvailable,
          webEnabled: agenticSettings.webEnabled,
          decision: shouldUseWeb ? 'use_web' : 'skip_web',
        },
      });

      if (explicitWebRequest && !shouldUseWeb) {
        const responseContent = agenticSettings.webEnabled
          ? 'Não consegui acessar a busca na internet agora. Tente novamente em instantes.'
          : 'Busca na internet está desativada nas configurações do tenant.';
        const [assistantMessage] = await db.insert(schema.messages).values({
          conversationId,
          agentId: conversation?.agentId ?? undefined,
          conteudo: responseContent,
          tipo: 'text',
          isFromUser: false,
          metadata: {
            webSearchAvailable: ragClassification?.webSearchAvailable ?? null,
            webEnabled: agenticSettings.webEnabled,
            reason: 'web_search_unavailable',
          },
        }).returning();

        await db.update(schema.conversations)
          .set({
            totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
            ultimaMensagemEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        try {
          await ensureConversationTitle({
            conversationId,
            userMessage: userMessageContent,
            assistantResponse: responseContent,
          });
        } catch (titleError) {
          logger.warn({ error: titleError, conversationId }, 'Falha ao aplicar título automático (web indisponível)');
        }

        res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      if (shouldUseWeb) {
        writeStatus('rag_web');
        const webSearchStart = Date.now();
        emitAgentEvent({
          phase: 'tool',
          action: 'rag_web',
          status: 'start',
          message: 'Buscando na web',
          correlationId: conversationId ?? undefined,
          payload: {
            forceMode: explicitWebRequest || explicitDeepWebRequest ? 'web' : undefined,
            webMode: explicitDeepWebRequest ? 'deepweb' : (classificationWebMode === 'deepweb' ? 'deepweb' : undefined),
            limit: ragParams.limit,
          },
        });
        const agenticResult = await buscarContextoAgentic({
          query: userMessageContent,
          namespaceId: conversation?.namespaceId || namespaceId,
          forceMode: explicitWebRequest || explicitDeepWebRequest ? 'web' : undefined,
          webMode: explicitDeepWebRequest ? 'deepweb' : (classificationWebMode === 'deepweb' ? 'deepweb' : undefined),
          limit: ragParams.limit,
          auth: {
            userId,
            tenantId,
            role: req.user?.role as Role,
          },
        });
        emitAgentEvent({
          phase: 'tool',
          action: 'rag_web',
          status: agenticResult?.context ? 'success' : 'error',
          message: agenticResult?.context ? 'Busca web concluída' : 'Busca web sem resultado',
          durationMs: Date.now() - webSearchStart,
          correlationId: conversationId ?? undefined,
          payload: {
            sources: agenticResult?.sources?.web?.length ?? 0,
          },
        });

        if (explicitWebRequest && !agenticResult?.context) {
          const responseContent = 'Não consegui acessar a busca na internet agora. Tente novamente em instantes.';
          const [assistantMessage] = await db.insert(schema.messages).values({
            conversationId,
            agentId: conversation?.agentId ?? undefined,
            conteudo: responseContent,
            tipo: 'text',
            isFromUser: false,
            metadata: {
              webSearchAvailable: ragClassification?.webSearchAvailable ?? null,
              webEnabled: agenticSettings.webEnabled,
              reason: 'web_search_failed',
            },
          }).returning();

          await db.update(schema.conversations)
            .set({
              totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
              ultimaMensagemEm: new Date(),
              atualizadoEm: new Date(),
            })
            .where(eq(schema.conversations.id, conversationId));

          res.write(`data: ${JSON.stringify({ content: responseContent })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        if (agenticResult?.context) {
          systemPrompt += `\n\n[CONTEXTO WEB]\n${agenticResult.context}\n[/CONTEXTO WEB]\n\n`;
          webSources = agenticResult.sources?.web || [];
        }
      }
    
    writeStatus('prompt');
    const promptStart = Date.now();
    emitAgentEvent({
      phase: 'planning',
      action: 'prompt_build',
      status: 'start',
      message: 'Construindo prompt final',
      correlationId: conversationId ?? undefined,
      payload: {
        historyMessages: storedPreviousMessages.length,
        ragSources: ragSources.length,
        webSources: webSources.length,
        memorySearchApplied,
      },
    });
    const llmMessages = buildPromptMessages({
      systemPrompt,
      userMessage: userMessageContent,
      history: storedPreviousMessages,
      source: 'stream',
    });
    emitAgentEvent({
      phase: 'planning',
      action: 'prompt_build',
      status: 'success',
      message: 'Prompt final pronto',
      durationMs: Date.now() - promptStart,
      correlationId: conversationId ?? undefined,
      payload: {
        totalMessages: llmMessages.length,
      },
    });

    if (ragSources.length > 0 || webSources.length > 0) {
      res.write(`data: ${JSON.stringify({ type: 'sources', sources: { internal: ragSources, web: webSources } })}\n\n`);
    }

    // BUG FIX 25/12/2025: Usar função auxiliar para proxy de stream do GPU Manager Service
    let assistantResponse = '';
    let assistantPersisted = false;

    try {
      writeStatus('llm');
      const llmStartAt = Date.now();
      const streamProfile = detectContextProfile(userMessageContent);
      const llmConfig = applyDynamicTokenBudget(
        getAgentLLMConfig(agent),
        llmMessages,
        { conversationId, source: 'stream', profile: streamProfile }
      );
      emitAgentEvent({
        phase: 'llm',
        action: 'llm_stream',
        status: 'start',
        message: 'Iniciando geração',
        correlationId: conversationId ?? undefined,
        payload: {
          model: llmConfig.model,
          maxTokens: llmConfig.maxTokens,
          temperature: llmConfig.temperature,
        },
      });
      let lastProgressAt = 0;
      let lastProgressChars = 0;
      const emitWritingProgress = () => {
        const now = Date.now();
        const chars = assistantResponse.length;
        const charsDelta = chars - lastProgressChars;
        if (now - lastProgressAt < 1200 && charsDelta < 160) return;
        lastProgressAt = now;
        lastProgressChars = chars;
        emitAgentEvent({
          phase: 'llm',
          action: 'writing',
          status: 'in_progress',
          message: `Escrevendo resposta (${chars} caracteres)`,
          correlationId: conversationId ?? undefined,
          payload: {
            chars,
          },
        });
      };
      await proxyStreamFromGpuManager(
        llmMessages,
        (content) => {
          if (content) {
            assistantResponse += content;
          }
          if (content) {
            emitWritingProgress();
          }
          // BUG FIX 25/12/2025: Envolver res.write() em try-catch para tratamento gracioso de clientes desconectados
          // Se cliente desconectar durante streaming, erro não deve interromper processamento do stream
          try {
            if (res.headersSent && !res.writableEnded) {
              res.write(`data: ${JSON.stringify({ content })}\n\n`);
            } else {
              logger.debug({ conversationId: req.params.id }, 'Response fechada durante streaming SSE - ignorando chunk');
            }
          } catch (writeError) {
            // Cliente desconectado - logar mas não interromper processamento do stream
            // onDone callback ainda será executado para garantir que stream seja finalizado corretamente
            logger.warn({ error: writeError, conversationId: req.params.id }, 'Erro ao escrever chunk SSE - cliente pode ter desconectado');
          }
        },
        async (_responseText: string) => {
          emitAgentEvent({
            phase: 'llm',
            action: 'llm_stream',
            status: 'success',
            message: 'Geração concluída',
            durationMs: Date.now() - llmStartAt,
            correlationId: conversationId ?? undefined,
            payload: { responseLength: assistantResponse.length },
          });
          // HTTP SSE: não precisa do responseText, apenas fecha a conexão
          // BUG FIX 25/12/2025: onDone sempre será chamado (mesmo em caso de erro)
          // Garantir que não tentamos fechar resposta já fechada
          // BUG FIX 25/12/2025: Usar AND (&&) ao invés de OR (||) - só escrever se headers foram enviados E resposta não foi finalizada
          // BUG FIX 25/12/2025: Headers são enviados explicitamente via res.flushHeaders() (linha 2004)
          // Mesmo se nenhum chunk for recebido, headers já foram enviados, então podemos fechar a resposta
          if (!assistantPersisted && conversationId && userMessage) {
            assistantPersisted = true;
            if (assistantResponse.trim().length > 0) {
              const persistStartedAt = Date.now();
              emitAgentEvent({
                phase: 'finalizing',
                action: 'persist_message',
                status: 'start',
                message: 'Persistindo resposta',
                correlationId: conversationId ?? undefined,
              });
              const [assistantMessage] = await db.insert(schema.messages).values({
                conversationId,
                agentId: conversation?.agentId,
                conteudo: assistantResponse,
                tipo: 'text',
                isFromUser: false,
              }).returning();

              await db.update(schema.conversations)
                .set({
                  totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
                  ultimaMensagemEm: new Date(),
                  atualizadoEm: new Date(),
                })
                .where(eq(schema.conversations.id, conversationId));

              try {
                await ensureConversationTitle({
                  conversationId,
                  userMessage: userMessageContent,
                  assistantResponse: assistantResponse,
                });
              } catch (titleError) {
                logger.warn({ error: titleError, conversationId }, 'Falha ao aplicar título automático (stream)');
              }

              const streamProfile = detectContextProfile(userMessageContent);
              const streamUserRole = req.user?.role as Role | undefined;
              if (streamUserRole && shouldAutoCollectTraining({
                profile: streamProfile,
                namespaceId: conversation?.namespaceId || conversation?.agent?.namespaceId,
                userMessage: userMessageContent,
                assistantResponse: assistantResponse,
              })) {
                void collectTrainingSample({
                  tenantId,
                  namespaceId: (conversation?.namespaceId || conversation?.agent?.namespaceId) as string,
                  conversationId,
                  source: 'chat-auto',
                  messages: [
                    { role: 'user', content: userMessageContent },
                    { role: 'assistant', content: assistantResponse },
                  ],
                  userId,
                  role: streamUserRole,
                });
              }

              res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
              emitAgentEvent({
                phase: 'finalizing',
                action: 'persist_message',
                status: 'success',
                message: 'Resposta persistida',
                durationMs: Date.now() - persistStartedAt,
                correlationId: conversationId ?? undefined,
                payload: {
                  messageId: assistantMessage?.id,
                },
              });
            } else {
              await db.update(schema.conversations)
                .set({
                  totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 1`,
                  ultimaMensagemEm: new Date(),
                  atualizadoEm: new Date(),
                })
                .where(eq(schema.conversations.id, conversationId));

              try {
                await ensureConversationTitle({
                  conversationId,
                  userMessage: userMessageContent,
                  assistantResponse: assistantResponse,
                });
              } catch (titleError) {
                logger.warn({ error: titleError, conversationId }, 'Falha ao aplicar título automático (stream sem resposta)');
              }
            }
          }

          if (!res.writableEnded) {
            try {
              // Se nenhum dado foi enviado, enviar [DONE] para fechar o stream corretamente
              if (!res.headersSent) {
                // Headers ainda não enviados (edge case), enviar agora
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.flushHeaders();
              }
              writeStatus('finalizing');
              emitAgentEvent({
                phase: 'finalizing',
                action: 'finalizing',
                status: 'success',
                message: 'Resposta finalizada',
                correlationId: conversationId ?? undefined,
              });
              res.write('data: [DONE]\n\n');
              res.end();
            } catch (endError) {
              // BUG FIX 25/12/2025: Propagar erro de fechamento de resposta para visibilidade
              // Erros em res.write()/res.end() indicam problemas críticos (ex: cliente desconectado)
              // Logar em nível error para monitoramento e propagar para que seja capturado pelo handler externo
              logger.error({ error: endError }, 'Erro ao fechar resposta SSE - possível desconexão do cliente ou erro de rede');
              // Propagar erro para que seja visível em sistemas de monitoramento
              // O erro será capturado pelo catch do proxyStreamFromGpuManager e re-lançado
              throw endError;
            }
          }
        },
        llmConfig,
        getAdaptiveGpuPriority('stream', streamProfile)
      );
    } catch (streamError) {
      logger.error({ 
        error: streamError instanceof Error ? streamError.message : String(streamError),
        stack: streamError instanceof Error ? streamError.stack : undefined 
      }, 'Erro no streaming do GPU Manager Service');
      emitAgentEvent({
        phase: 'llm',
        action: 'llm_stream',
        status: 'error',
        message: 'Falha ao gerar resposta',
        correlationId: conversationId ?? undefined,
        payload: {
          error: streamError instanceof Error ? streamError.message : String(streamError),
        },
      });
      // BUG FIX 25/12/2025: onDone já foi chamado no catch interno de proxyStreamFromGpuManager
      // Mas pode ter fechado a resposta com [DONE] ao invés de erro
      // Tentar enviar mensagem de erro apenas se resposta ainda estiver aberta
      // BUG FIX 25/12/2025: Usar AND (&&) ao invés de OR (||) - só escrever se headers foram enviados E resposta não foi finalizada
      // Para SSE, headers já foram enviados (linha 2000), então verificamos apenas se resposta não foi finalizada
      if (res.headersSent && !res.writableEnded) {
        try {
          res.write(`data: ${JSON.stringify({ error: 'Erro ao processar mensagem' })}\n\n`);
          res.end();
        } catch (endError) {
          // Resposta já fechada (provavelmente por onDone), ignorar
          logger.debug({ error: endError }, 'Resposta já fechada por onDone callback');
        }
      }
    }
  } catch (error) {
    if (error instanceof ClientInputError) {
      if (!res.headersSent) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: error.message, code: error.code })}\n\n`);
        res.end();
      }
      return;
    }
    logger.error({ error }, 'Erro no streaming');
    // BUG FIX 25/12/2025: Verificar se resposta ainda não foi fechada antes de escrever
    // O onDone callback pode ter fechado a resposta com res.end() (linha 2069)
    // Tentar escrever em resposta já fechada causa erro
    if (res.headersSent && !res.writableEnded) {
      try {
        res.write(`data: ${JSON.stringify({ error: 'Erro ao processar mensagem' })}\n\n`);
        res.end();
      } catch (endError) {
        // Resposta já fechada (provavelmente por onDone), ignorar
        logger.debug({ error: endError }, 'Resposta já fechada - não é possível enviar erro');
      }
    }
  }
});

// ============================================================================
// WEBSOCKET RATE LIMITING (Enterprise-Grade - Regra 16 CLAUDE.md)
// Implementa sliding window com cooldown progressivo após bloqueio
// ============================================================================

interface WsRateLimitState {
  timestamps: number[];
  blocked: boolean;
  blockUntil: number;
  cooldownMultiplier: number;
  lastActivity: number;
  sessionId: number; // Token único para validar timers após reconexão
}

const WS_RATE_LIMIT = {
  windowMs: 60000,
  maxMessages: 60,
  blockDurationMs: 60000,
  maxCooldownMultiplier: 4,
  cooldownDecayMs: 300000,
};

const wsRateLimits = new Map<string, WsRateLimitState>();
// Mapa para guardar timers de cooldown decay - corrige memory leak no disconnect
const wsCooldownTimers = new Map<string, NodeJS.Timeout>();
// Contador global para gerar sessionIds únicos
let wsSessionIdCounter = 0;

function checkWsRateLimit(clientKey: string): { allowed: boolean; remaining: number; retryAfter?: number } {
  const now = Date.now();
  let state = wsRateLimits.get(clientKey);
  
  if (!state) {
    wsSessionIdCounter += 1;
    state = { 
      timestamps: [], 
      blocked: false, 
      blockUntil: 0, 
      cooldownMultiplier: 1, 
      lastActivity: now,
      sessionId: wsSessionIdCounter,
    };
    wsRateLimits.set(clientKey, state);
  }
  
  state.lastActivity = now;
  
  if (state.blocked) {
    if (now < state.blockUntil) {
      return { allowed: false, remaining: 0, retryAfter: Math.ceil((state.blockUntil - now) / 1000) };
    }
    state.blocked = false;
    state.timestamps = [];
    state.cooldownMultiplier = Math.min(state.cooldownMultiplier * 2, WS_RATE_LIMIT.maxCooldownMultiplier);
    logger.info({ clientKey, cooldownMultiplier: state.cooldownMultiplier }, 'WebSocket rate limit desbloqueado - cooldown progressivo ativo');
  }
  
  const windowStart = now - WS_RATE_LIMIT.windowMs;
  state.timestamps = state.timestamps.filter(t => t > windowStart);
  
  const effectiveMaxMessages = Math.ceil(WS_RATE_LIMIT.maxMessages / state.cooldownMultiplier);
  
  if (state.timestamps.length >= effectiveMaxMessages) {
    state.blocked = true;
    state.blockUntil = now + WS_RATE_LIMIT.blockDurationMs;
    logger.warn({ clientKey, messageCount: state.timestamps.length, effectiveMaxMessages }, 'WebSocket rate limit excedido - cliente bloqueado');
    return { allowed: false, remaining: 0, retryAfter: WS_RATE_LIMIT.blockDurationMs / 1000 };
  }
  
  state.timestamps.push(now);
  
  // Cooldown decay com timer cancelável (corrige memory leak no disconnect)
  // Usa sessionId para invalidar callbacks de sessões antigas após reconexão rápida
  if (state.cooldownMultiplier > 1 && state.timestamps.length === 1) {
    // Cancelar timer anterior se existir
    const existingTimer = wsCooldownTimers.get(clientKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Capturar sessionId atual para validação no callback
    const timerSessionId = state.sessionId;
    
    const decayTimer = setTimeout(() => {
      const currentState = wsRateLimits.get(clientKey);
      // Validar que o state pertence à mesma sessão (evita bug de reconexão rápida)
      if (currentState && currentState.sessionId === timerSessionId) {
        if (!currentState.blocked && currentState.cooldownMultiplier > 1) {
          currentState.cooldownMultiplier = Math.max(1, currentState.cooldownMultiplier / 2);
          logger.info({ clientKey, cooldownMultiplier: currentState.cooldownMultiplier, sessionId: timerSessionId }, 'WebSocket cooldown reduzido por bom comportamento');
        }
        // Limpar referência do timer após execução válida
        wsCooldownTimers.delete(clientKey);
      } else {
        // Timer obsoleto - sessão diferente ou cliente desconectado e reconectado
        logger.debug({ clientKey, timerSessionId, currentSessionId: currentState?.sessionId }, 'Timer de cooldown ignorado - sessão inválida');
      }
    }, WS_RATE_LIMIT.cooldownDecayMs);
    
    wsCooldownTimers.set(clientKey, decayTimer);
  }
  
  return { allowed: true, remaining: effectiveMaxMessages - state.timestamps.length };
}

function cleanupWsRateLimit(clientKey: string) {
  // Cancelar timer de cooldown decay pendente (evita memory leak)
  const pendingTimer = wsCooldownTimers.get(clientKey);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    wsCooldownTimers.delete(clientKey);
    logger.debug({ clientKey }, 'Timer de cooldown decay cancelado no disconnect');
  }
  wsRateLimits.delete(clientKey);
}

const rateLimitCleanupInterval = setInterval(() => {
  const now = Date.now();
  const inactivityThreshold = WS_RATE_LIMIT.windowMs * 5;
  
  for (const [key, state] of wsRateLimits.entries()) {
    const inactiveTime = now - state.lastActivity;
    const isInactive = inactiveTime > inactivityThreshold;
    const blockExpired = state.blocked && now >= state.blockUntil;
    const canRemove = isInactive || (blockExpired && state.timestamps.length === 0);
    
    if (canRemove) {
      wsRateLimits.delete(key);
      logger.debug({ clientKey: key, reason: isInactive ? 'inactivity' : 'block_expired' }, 'Rate limit state removido');
    }
  }
}, 300000);

// Mapa keyed por tenantId:userId para evitar colisão cross-tenant
const wsClients = new Map<string, WebSocket>();
const getClientKey = (tenantId: string, userId: string) => `${tenantId}:${userId}`;

// ============================================================================
// MAPA DE AGENTES CONECTADOS (HANDOVER/TAKEOVER REAL-TIME)
// Permite notificações em tempo real para agentes humanos
// ============================================================================
interface AgentConnection {
  ws: WebSocket;
  userId: string;
  tenantId: string;
  subscribedConversations: Set<string>;
}
const wsAgentClients = new Map<string, AgentConnection>();

/**
 * Notifica agentes conectados sobre eventos de handover
 * Respeita isolamento de tenant e inscrições de conversas específicas
 * Usado para atualizar TakeoverPanel em tempo real
 * 
 * SEGURANÇA (OWASP + Regra 16):
 * - Filtra por tenantId para isolamento multi-tenant
 * - Respeita subscribedConversations quando agente se inscreve em conversas específicas
 * - Para eventos 'new_handoff', notifica TODOS os agentes do tenant (para pickup)
 * - Para eventos 'new_message', notifica apenas agentes inscritos na conversa
 */
function notifyAgentsAboutEvent(
  eventType: 'new_handoff' | 'new_message' | 'sla_warning' | 'handback',
  data: {
    conversationId: string;
    tenantId?: string;
    message?: string;
    from?: string;
    trigger?: string;
    priority?: string;
    reason?: string;
  }
) {
  // CRÍTICO: tenantId é obrigatório para isolamento multi-tenant
  if (!data.tenantId) {
    logger.warn({
      eventType,
      conversationId: data.conversationId,
    }, 'Notificação ignorada - tenantId ausente (violaria isolamento multi-tenant)');
    return;
  }
  
  let notifiedCount = 0;
  
  for (const [key, agent] of wsAgentClients.entries()) {
    // SEGURANÇA: Filtrar por tenant (isolamento obrigatório)
    if (agent.tenantId !== data.tenantId) {
      continue;
    }
    
    // Para 'new_message', verificar se agente está inscrito na conversa
    // Isso evita spam de notificações para agentes não interessados
    if (eventType === 'new_message') {
      // Se agente tem inscrições específicas, verificar se esta conversa está incluída
      if (agent.subscribedConversations.size > 0 && 
          !agent.subscribedConversations.has(data.conversationId)) {
        continue;
      }
    }
    
    try {
      agent.ws.send(JSON.stringify({
        type: 'agent_notification',
        event: eventType,
        data: {
          conversationId: data.conversationId,
          message: data.message,
          from: data.from,
          trigger: data.trigger,
          priority: data.priority,
          // Não incluir tenantId na resposta (já está implícito na conexão)
        },
        timestamp: new Date().toISOString(),
      }));
      
      notifiedCount++;
      
      logger.debug({ 
        agentKey: key, 
        eventType, 
        conversationId: data.conversationId,
      }, 'Agente notificado sobre evento');
    } catch (error) {
      logger.warn({ error, agentKey: key }, 'Falha ao notificar agente');
      wsAgentClients.delete(key);
    }
  }
  
  if (notifiedCount === 0 && eventType === 'new_handoff') {
    logger.warn({
      eventType,
      conversationId: data.conversationId,
      tenantId: data.tenantId,
    }, 'Nenhum agente online para receber handoff - SLA pode ser impactado');
  }
}

wss.on('connection', (ws, req) => {
  // Cast para ExtendedWebSocket para suportar heartbeat
  const extWs = ws as ExtendedWebSocket;
  
  // SEGURANÇA: Recuperar dados de autenticação do verifyClient (OWASP API2 2023)
  // Não confiar em query params - usar dados validados do handshake
  const authKey = (req as unknown as { __authKey?: string }).__authKey;
  let authResult: WebSocketAuthResult | undefined;
  
  if (authKey) {
    authResult = pendingAuthResults.get(authKey);
    pendingAuthResults.delete(authKey); // Limpar após uso (one-time use)
  }
  
  // Se autenticação não foi encontrada, rejeitar conexão
  // (não deveria acontecer se verifyClient funcionou, mas é defense-in-depth)
  if (!authResult?.authenticated || !authResult.userId) {
    logger.warn({ ip: req.socket?.remoteAddress }, 'WebSocket: Conexão sem autenticação válida - rejeitando');
    ws.close(4001, 'Autenticação inválida');
    return;
  }
  
  // Usar dados AUTENTICADOS (do cookie de sessão validado) em vez de query params
  const userId = authResult.userId;
  const tenantId = authResult.tenantId;
  
  if (!tenantId) {
    logger.warn({ userId }, 'WebSocket: Usuário autenticado mas sem tenantId - rejeitando');
    ws.close(4002, 'Tenant ID obrigatório para conexão WebSocket');
    return;
  }

  const clientKey = getClientKey(tenantId, userId);
  
  // SEGURANÇA: Configurar heartbeat (ws v8.18.3)
  extWs.isAlive = true;
  extWs.userId = userId;
  extWs.tenantId = tenantId;
  extWs.role = authResult.role as Role | undefined;
  extWs.clientKey = clientKey;
  
  // Responder ao pong mantém conexão viva
  extWs.on('pong', () => {
    extWs.isAlive = true;
  });
  
  wsClients.set(clientKey, ws);
  logger.info({ 
    userId, 
    tenantId, 
    clientKey,
    role: authResult.role,
  }, 'Cliente WebSocket conectado (autenticado via sessão)');

  // ============================================================================
  // MÉTRICAS LLM: Sessões ativas (modelo-agnóstico)
  // ============================================================================
  if (!extWs.__activeSessionCounted) {
    metrics.llm.activeSessions.inc();
    extWs.__activeSessionCounted = true;
  }

  ws.on('message', async (data) => {
    try {
      const rateLimitCheck = checkWsRateLimit(clientKey);
      if (!rateLimitCheck.allowed) {
        ws.send(JSON.stringify({ 
          type: 'rate_limited', 
          error: 'Limite de mensagens excedido',
          retryAfter: rateLimitCheck.retryAfter,
        }));
        return;
      }

      // OWASP API3 - Validação Zod obrigatória para mensagens WebSocket
      const rawMessage = JSON.parse(data.toString());
      const parseResult = wsMessageSchema.safeParse(rawMessage);
      
      if (!parseResult.success) {
        logger.warn({ 
          errors: parseResult.error.errors,
          userId,
          tenantId,
        }, 'WebSocket: Mensagem inválida rejeitada por validação Zod');
        ws.send(JSON.stringify({ 
          type: 'error', 
          error: 'Formato de mensagem inválido',
          details: parseResult.error.errors.map(e => e.message),
        }));
        return;
      }
      
      const userRole = extWs.role;
      const safeUserRole: Role = userRole ?? 'guest';
      const emitAgentEventWs = (event: Omit<AgentEvent, 'id' | 'ts' | 'payload'> & { payload?: unknown }) => {
        if (ws.readyState !== ws.OPEN) return;
        const { payload: rawPayload, ...rest } = event;
        const payload = redactSensitivePayload(rawPayload);
        const data: AgentEvent = {
          id: crypto.randomUUID(),
          ts: new Date().toISOString(),
          ...rest,
          ...(payload ? { payload } : {}),
        };
        ws.send(JSON.stringify({ type: 'agent_event', data }));
      };

      // CORREÇÃO 17/12/2025: Type assertion alinhada com schema Zod
      // content é opcional no schema (z.string().optional())
      const message = parseResult.data as {
        type: string;
        conversationId?: string;
        content?: string;  // CORREÇÃO: era 'content: string' - causava TypeError quando undefined
        namespaceId?: string;
        // Trading fields (17/12/2025)
        channel?: string;
        symbol?: string;
        interval?: string;
      };

      // ========================================================================
      // TRADING WEBSOCKET HANDLERS (17/12/2025)
      // Permite subscription para dados de trading em tempo real
      // ========================================================================
      
      if (message.type === 'trading:subscribe') {
        // Registrar subscription de trading para este cliente
        const tradingChannel = message.channel || 'ticker';
        const symbol = message.symbol || 'XBTUSDTM';
        
        // Armazenar subscription no extWs para broadcast posterior
        if (!extWs.tradingSubscriptions) {
          extWs.tradingSubscriptions = new Set();
        }
        extWs.tradingSubscriptions.add(`${tradingChannel}:${symbol}`);
        
        ws.send(JSON.stringify({
          type: 'trading:subscribed',
          channel: tradingChannel,
          symbol,
          timestamp: new Date().toISOString(),
        }));
        
        logger.debug({ userId, tenantId, channel: tradingChannel, symbol }, 'Cliente inscrito em canal de trading');
        return;
      }
      
      if (message.type === 'trading:unsubscribe') {
        const tradingChannel = message.channel || 'ticker';
        const symbol = message.symbol || 'XBTUSDTM';
        
        if (extWs.tradingSubscriptions) {
          extWs.tradingSubscriptions.delete(`${tradingChannel}:${symbol}`);
        }
        
        ws.send(JSON.stringify({
          type: 'trading:unsubscribed',
          channel: tradingChannel,
          symbol,
        }));
        
        logger.debug({ userId, tenantId, channel: tradingChannel, symbol }, 'Cliente desinscrito de canal de trading');
        return;
      }
      
      if (message.type === 'trading:command') {
        // Processar comando de trading via chat
        // Importar parser dinamicamente para evitar circular deps
        const { parseTradingCommand, getCommandDescription, validateCommand } = await import('./trading-command-parser.js');
        // CORREÇÃO 19/12/2025: Remover getTradingControlMode não utilizado (no-unused-vars)
        const { canExecuteTradingCommand } = await import('./trading-orchestrator.js');
        
        const agenticSettings = await getOrCreateAgenticSettings(tenantId);
        const agenticDetectors = normalizeAgenticDetectors(agenticSettings.detectors);
        const content = message.content || '';
        
        if (!agenticSettings.tradingEnabled) {
          ws.send(JSON.stringify({
            type: 'trading:error',
            error: 'Trading está desativado nas configurações do tenant.',
          }));
          return;
        }

        if (!isTradingCommandWithDetectors(content, agenticDetectors)) {
          ws.send(JSON.stringify({
            type: 'trading:error',
            error: 'Comando de trading não reconhecido',
            hint: 'Tente: "compre 0.01 BTC", "venda 0.01 BTC", "status trading", "minhas posições"',
          }));
          return;
        }
        
        const parsed = parseTradingCommand(content);
        
        // CORREÇÃO 17/12/2025: Validar campos obrigatórios ANTES de executar
        // Bug: comandos sem dados obrigatórios (ex: "cancele a ordem" sem orderId)
        // chegavam ao backend causando requests inválidos (DELETE /orders/)
        const validation = validateCommand(parsed);
        if (!validation.valid) {
          ws.send(JSON.stringify({
            type: 'trading:validation_error',
            error: 'Comando incompleto - dados obrigatórios faltando',
            missingFields: validation.missingFields,
            command: getCommandDescription(parsed, 'pt'),
            hint: getValidationHint(parsed.type, validation.missingFields, 'pt'),
          }));
          logger.warn({ 
            userId, 
            tenantId, 
            commandType: parsed.type, 
            missingFields: validation.missingFields 
          }, 'Comando de trading rejeitado por validação - campos obrigatórios faltando');
          return;
        }
        
        const canExecute = await canExecuteTradingCommand(tenantId, 'user');
        
        if (!canExecute.canExecute) {
          ws.send(JSON.stringify({
            type: 'trading:blocked',
            reason: canExecute.reason,
            command: getCommandDescription(parsed, 'pt'),
          }));
          return;
        }
        
        // Encaminhar comando para integrations-service via HTTP
        // Regra 6 CLAUDE.md: Integração real enterprise (PROIBIDO stubs/mocks)
        ws.send(JSON.stringify({
          type: 'trading:command_received',
          command: parsed,
          description: getCommandDescription(parsed, 'pt'),
          status: 'processing',
        }));
        
        logger.info({ userId, tenantId, command: parsed.type, confidence: parsed.confidence }, 'Comando de trading recebido via WebSocket');
        
        // Executar comando de trading via integrations-service
        try {
          const result = await executeTradingCommand(userId, tenantId, parsed);
          
          ws.send(JSON.stringify({
            type: 'trading:command_result',
            command: parsed.type,
            success: result.success,
            data: result.data,
            error: result.error,
            description: getCommandDescription(parsed, 'pt'),
          }));
          
          logger.info({ 
            userId, 
            tenantId, 
            command: parsed.type, 
            success: result.success,
          }, 'Comando de trading executado');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
          
          ws.send(JSON.stringify({
            type: 'trading:command_error',
            command: parsed.type,
            error: errorMessage,
            description: getCommandDescription(parsed, 'pt'),
          }));
          
          logger.error({ 
            userId, 
            tenantId, 
            command: parsed.type, 
            error: errorMessage,
          }, 'Erro ao executar comando de trading');
        }
        return;
      }

      if (message.type === 'chat') {
        const ragStartTime = Date.now();
        
        // VALIDAÇÃO OBRIGATÓRIA: conversationId é necessário para mensagens de chat
        // CORREÇÃO 18/12/2025: Garantir que conversationId existe antes de usar
        if (!message.conversationId) {
          ws.send(JSON.stringify({
            type: 'error',
            error: 'conversationId é obrigatório para mensagens de chat',
          }));
          return;
        }
        
        // Variável validada como string (não undefined)
        const conversationId = message.conversationId;
        
        // CORREÇÃO 18/12/2025: Definir messageContent cedo (antes de shouldEscalate)
        // message.content é opcional no schema, usar fallback vazio
        const messageContent = message.content ?? '';
        const baseNameContext = await resolveUserNameContext(userId, tenantId);
        const nameContext = await handleUserNameUpdate({
          userId,
          tenantId,
          userMessage: messageContent,
          currentContext: baseNameContext,
        });
        if (nameContext.shouldAskConfirmation) {
          await markNamePromptPending(userId, tenantId, nameContext);
        }
        
        // ========================================================================
        // FASE 1: VERIFICAÇÕES PRÉ-INSERT (CRÍTICO para handover correto!)
        // Verificar conversa, tenant, estado e escalação ANTES de persistir mensagem
        // Isso garante que mensagens escaladas não sejam tratadas como bot-handled
        // ========================================================================
        
        // Buscar conversa e validar tenant
        const conversation = await db.query.conversations.findFirst({
          where: eq(schema.conversations.id, conversationId),
          with: { 
            agent: {
              with: {
                namespace: true,
              },
            },
          },
        });
        
        if (!conversation) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            error: 'Conversa não encontrada' 
          }));
          return;
        }

        // Verificar isolamento multi-tenant (SEGURANÇA - derivar tenantId da conversa)
        // CRÍTICO: Conversa DEVE ter namespace configurado para operações seguras
        const conversationTenantId = conversation?.agent?.namespace?.tenantId;
        
        if (!conversationTenantId) {
          logger.warn({ 
            conversationId,
            hasAgent: !!conversation.agent,
            hasNamespace: !!conversation.agent?.namespace,
          }, 'Conversa sem namespace/tenant configurado - operação bloqueada');
          ws.send(JSON.stringify({ 
            type: 'error', 
            error: 'Conversa não está configurada corretamente. Entre em contato com o suporte.' 
          }));
          return;
        }
        
        if (conversationTenantId !== tenantId) {
          logger.warn({ 
            tenantId, 
            conversationTenantId, 
            conversationId,
          }, 'Tentativa de envio cross-tenant bloqueada');
          ws.send(JSON.stringify({ 
            type: 'error', 
            error: 'Acesso negado: conversa não pertence ao tenant' 
          }));
          return;
        }
        
        // Usar tenantId derivado da conversa (SEMPRE da fonte confiável)
        const safeTenantId = conversationTenantId;
        
        // Verificar estado da conversa ANTES de inserir mensagem
        const conversationState = await getOrCreateConversationState(conversationId);
        
        // Se já está em modo humano, apenas encaminhar para agente (sem LLM)
        if (conversationState.controlMode === 'human') {
          // Salvar mensagem do usuário com metadata indicando modo humano
          const inserted = await db.insert(schema.messages).values({
            conversationId,
            userId,
            conteudo: messageContent,
            tipo: 'text',
            isFromUser: true,
            metadata: { 
              handledBy: 'human',
              assignedAgentId: conversationState.assignedAgentId,
            },
          }).returning();
          
          // BUG FIX 25/12/2025: Verificação defensiva - .returning() deve retornar pelo menos um elemento
          // Previne crash se array estiver vazio (edge case durante erros de banco/transações)
          if (!inserted || inserted.length === 0 || !inserted[0]) {
            logger.error({ conversationId }, 'Falha ao salvar mensagem de takeover - .returning() retornou array vazio ou undefined');
            throw new Error('Falha ao salvar mensagem de takeover - resultado do banco de dados inválido');
          }
          
          const userMsg = inserted[0];
          
          ws.send(JSON.stringify({ type: 'message', data: userMsg }));
          ws.send(JSON.stringify({
            type: 'human_mode',
            message: 'Sua mensagem foi enviada para o atendente humano.',
            assignedAgentId: conversationState.assignedAgentId,
          }));
          
          // Notificar agente sobre nova mensagem (usando tenantId derivado da conversa)
          notifyAgentsAboutEvent('new_message', {
            conversationId,
            tenantId: safeTenantId,
            message: messageContent,
            from: 'websocket',
          });
          
          return;
        }

        // ========================================================================
        // VERIFICAÇÃO DE HANDOVER AUTOMÁTICO (ANTES de inserir mensagem!)
        // Verifica se mensagem deve triggerar escalação para agente humano
        // ========================================================================
        const escalationContext = await shouldEscalate(conversationId, messageContent);
        
        if (escalationContext) {
          // Processar escalação automática
          const escalationResult = await processAutoEscalation(escalationContext);
          
          // Salvar mensagem do usuário com metadata indicando escalação
          const inserted = await db.insert(schema.messages).values({
            conversationId,
            userId,
            conteudo: messageContent,
            tipo: 'text',
            isFromUser: true,
            metadata: { 
              escalated: true,
              escalationTrigger: escalationContext.trigger,
              handledBy: 'escalation',
            },
          }).returning();
          
          // BUG FIX 25/12/2025: Verificação defensiva - .returning() deve retornar pelo menos um elemento
          // Previne crash se array estiver vazio (edge case durante erros de banco/transações)
          if (!inserted || inserted.length === 0 || !inserted[0]) {
            logger.error({ conversationId }, 'Falha ao salvar mensagem de escalation - .returning() retornou array vazio ou undefined');
            throw new Error('Falha ao salvar mensagem de escalation - resultado do banco de dados inválido');
          }
          
          const userMsg = inserted[0];
          
          ws.send(JSON.stringify({ type: 'message', data: userMsg }));
          
          logger.info({
            conversationId,
            trigger: escalationContext.trigger,
            userId,
            tenantId: safeTenantId,
            success: escalationResult.success,
          }, 'Escalação automática processada via WebSocket');
          
          // Notificar usuário sobre escalação
          ws.send(JSON.stringify({
            type: 'escalation',
            trigger: escalationContext.trigger,
            message: 'Sua conversa foi encaminhada para um atendente humano. Por favor, aguarde.',
            sentiment: escalationContext.sentiment,
            confidence: escalationContext.confidence,
          }));
          
          // Notificar agentes conectados em tempo real (usando tenantId derivado)
          notifyAgentsAboutEvent('new_handoff', {
            conversationId,
            tenantId: safeTenantId,
            message: messageContent,
            trigger: escalationContext.trigger,
            priority: 'high',
          });
          
          // Salvar mensagem do sistema informando escalação
          await db.insert(schema.messages).values({
            conversationId,
            conteudo: `[Sistema] Conversa escalada automaticamente. Trigger: ${escalationContext.trigger}`,
            tipo: 'text',
            isFromUser: false,
            metadata: {
              systemMessage: true,
              escalationTrigger: escalationContext.trigger,
              sentiment: escalationContext.sentiment,
              confidence: escalationContext.confidence,
            },
          });
          
          return; // CRÍTICO: Parar aqui - não processar com LLM
        }
        
        // ========================================================================
        // FASE 2: FLUXO NORMAL (Bot responde via LLM)
        // Apenas chegamos aqui se não houve escalação nem modo humano
        // ========================================================================
        
        // Agora é seguro inserir a mensagem do usuário (será processada pelo bot)
        const inserted = await db.insert(schema.messages).values({
          conversationId,
          userId,
          conteudo: messageContent,
          tipo: 'text',
          isFromUser: true,
          metadata: { handledBy: 'bot' },
        }).returning();
        
        // BUG FIX 25/12/2025: Verificação defensiva - .returning() deve retornar pelo menos um elemento
        // Previne crash se array estiver vazio (edge case durante erros de banco/transações)
        if (!inserted || inserted.length === 0 || !inserted[0]) {
          logger.error({ conversationId, userId }, 'Falha ao salvar mensagem do usuário - .returning() retornou array vazio ou undefined');
          throw new Error('Falha ao salvar mensagem do usuário - resultado do banco de dados inválido');
        }
        
        const userMsg = inserted[0];

        ws.send(JSON.stringify({ type: 'message', data: userMsg }));

        const agenticSettings = await getOrCreateAgenticSettings(safeTenantId);
        const agenticDetectors = normalizeAgenticDetectors(agenticSettings.detectors);
        const imageSearchDetection = detectImageSearchRequest(messageContent, agenticDetectors);
        if (imageSearchDetection.isImageSearch && imageSearchDetection.query) {
          if (!agenticSettings.webEnabled) {
            ws.send(JSON.stringify({
              type: 'error',
              error: 'Busca na internet está desativada nas configurações do tenant.',
            }));
            return;
          }

          if (!userRole) {
            ws.send(JSON.stringify({
              type: 'error',
              error: 'Permissão insuficiente para buscar imagens.',
            }));
            return;
          }

          const permissionCheck = await checkPermission(
            { userId, tenantId: safeTenantId, role: userRole },
            'images:search:read'
          );
          if (!permissionCheck.allowed) {
            ws.send(JSON.stringify({
              type: 'error',
              error: 'Você não possui permissão para buscar imagens na web.',
            }));
            return;
          }

          try {
            const webImages = await buscarImagensWeb({
              query: imageSearchDetection.query,
              limit: WEB_IMAGE_SEARCH_MAX_RESULTS,
              auth: { userId, tenantId: safeTenantId, role: userRole },
            });

            if (!webImages.length) {
              const responseContent = 'Não encontrei imagens na web para esse pedido agora.';
              const [assistantMessage] = await db.insert(schema.messages).values({
                conversationId,
                agentId: conversation?.agentId ?? undefined,
                conteudo: responseContent,
                tipo: 'text',
                isFromUser: false,
                anexos: [],
              }).returning();

              await db.update(schema.conversations)
                .set({
                  totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
                  ultimaMensagemEm: new Date(),
                  atualizadoEm: new Date(),
                })
                .where(eq(schema.conversations.id, conversationId));

              await ensureConversationTitle({
                conversationId,
                userMessage: messageContent,
                assistantResponse: responseContent,
              });

              ws.send(JSON.stringify({ type: 'message', data: assistantMessage }));
              return;
            }

            const responseContent = 'Encontrei imagens na web para você.';
            const [assistantMessage] = await db.insert(schema.messages).values({
              conversationId,
              agentId: conversation?.agentId ?? undefined,
              conteudo: responseContent,
              tipo: 'text',
              isFromUser: false,
              anexos: [],
            }).returning();

            if (!assistantMessage) {
              throw new Error('Falha ao criar mensagem de imagens web');
            }

            const internalHeaders = buildInternalServiceHeaders({
              userId,
              tenantId: safeTenantId,
              role: userRole,
            });

            const attachments: Array<{
              id: string;
              type: 'image';
              filename: string;
              mimeType: string;
              size: number;
              url?: string;
              thumbnailUrl?: string;
            }> = [];

            for (const [index, image] of webImages.entries()) {
              try {
                const downloaded = await fetchExternalImageAsBase64(image.imageUrl, WEB_IMAGE_MAX_BYTES);
                const filename = buildWebImageFilename(image.imageUrl, index, downloaded.mimeType);
                const uploadResult = await uploadMediaToRAG(
                  downloaded.base64,
                  filename,
                  downloaded.mimeType,
                  safeTenantId,
                  `Imagem encontrada na web. Fonte: ${image.sourceUrl ?? image.imageUrl}`,
                  assistantMessage.id,
                  conversationId,
                  internalHeaders
                );

                if (!uploadResult?.fileUrl) {
                  continue;
                }

                attachments.push({
                  id: uploadResult.uploadId,
                  type: 'image',
                  filename,
                  mimeType: downloaded.mimeType,
                  size: downloaded.size,
                  url: uploadResult.fileUrl,
                  thumbnailUrl: uploadResult.thumbnailUrl,
                });
              } catch (downloadError) {
                logger.warn(
                  { error: downloadError, imageUrl: image.imageUrl },
                  'Falha ao baixar imagem web (websocket)'
                );
              }
            }

            if (!attachments.length) {
              const fallbackContent = 'Não consegui baixar imagens válidas da web neste momento.';
              await db.update(schema.messages)
                .set({ conteudo: fallbackContent })
                .where(eq(schema.messages.id, assistantMessage.id));
              await db.update(schema.conversations)
                .set({
                  totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
                  ultimaMensagemEm: new Date(),
                  atualizadoEm: new Date(),
                })
                .where(eq(schema.conversations.id, conversationId));

              await ensureConversationTitle({
                conversationId,
                userMessage: messageContent,
                assistantResponse: fallbackContent,
              });

              ws.send(JSON.stringify({ type: 'message', data: { ...assistantMessage, conteudo: fallbackContent } }));
              return;
            }

            await db.update(schema.messages)
              .set({ anexos: attachments })
              .where(eq(schema.messages.id, assistantMessage.id));

            await db.update(schema.conversations)
              .set({
                totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
                ultimaMensagemEm: new Date(),
                atualizadoEm: new Date(),
              })
              .where(eq(schema.conversations.id, conversationId));

            await ensureConversationTitle({
              conversationId,
              userMessage: messageContent,
              assistantResponse: responseContent,
            });

            ws.send(JSON.stringify({ type: 'message', data: { ...assistantMessage, anexos: attachments } }));
            return;
          } catch (error) {
            logger.error({ error }, 'Falha ao buscar imagens na web (websocket)');
            ws.send(JSON.stringify({
              type: 'error',
              error: 'Falha ao buscar imagens na web. Tente novamente em instantes.',
            }));
            return;
          }
        }

        // ARQUITETURA 16/01/2026+: geração de imagens via OpenAI (gpt-image-1)
        // Se o usuário pedir para gerar imagem, executar fluxo OpenAI (gpt-image-1)
        const imageDetection = detectImageGenerationRequest(messageContent, agenticDetectors);
        
        if (imageDetection.isImageRequest && imageDetection.prompt) {
          logger.info({
            conversationId,
            prompt: imageDetection.prompt,
            confidence: imageDetection.confidence,
            reason: imageDetection.reason,
          }, 'Pedido de geração de imagem detectado - OpenAI Images disponível');

          if (!userRole) {
            ws.send(JSON.stringify({ 
              type: 'error', 
              error: 'Permissão insuficiente para gerar imagens.' 
            }));
            return;
          }

          const internalHeaders = buildInternalServiceHeaders({
            userId,
            tenantId: safeTenantId,
            role: userRole,
          });

          const permissionCheck = await checkPermission(
            { userId, tenantId: safeTenantId, role: userRole },
            'images:generate:write'
          );

          if (!permissionCheck.allowed) {
            ws.send(JSON.stringify({ 
              type: 'error', 
              error: 'Você não possui permissão para gerar imagens.' 
            }));
            return;
          }

          if (!conversationId) {
            ws.send(JSON.stringify({ 
              type: 'error', 
              error: 'Conversa inválida para geração de imagem.' 
            }));
            return;
          }

          try {
            const generatedImage = await generateImageFromPrompt({
              tenantId: safeTenantId,
              userId,
              prompt: imageDetection.prompt,
              conversationId,
              messageId: userMsg.id,
              internalHeaders,
            });

            const inserted = await db.insert(schema.messages).values({
              conversationId,
              agentId: conversation?.agentId ?? undefined,
              conteudo: 'Imagem gerada com sucesso via OpenAI.',
              tipo: 'text',
              isFromUser: false,
              metadata: {
                generatedImages: [generatedImage.id],
                model: generatedImage.model ?? undefined,
              },
            }).returning();

            if (!inserted || inserted.length === 0 || !inserted[0]) {
              logger.error({ conversationId }, 'Falha ao salvar mensagem de imagem gerada - .returning() retornou array vazio ou undefined');
              throw new Error('Falha ao salvar mensagem de imagem gerada - resultado do banco de dados inválido');
            }

            const infoMsg = inserted[0];
            const messagePayload = {
              ...infoMsg,
              generatedImage: {
                id: generatedImage.id,
                prompt: generatedImage.prompt,
                imageUrl: generatedImage.imageUrl ?? undefined,
                imagePath: generatedImage.imagePath ?? undefined,
                status: generatedImage.status === 'generating' ? 'processing' : generatedImage.status,
                width: generatedImage.width ?? undefined,
                height: generatedImage.height ?? undefined,
                feedbackScore: generatedImage.feedbackScore ?? undefined,
              },
            };

            try {
              await ensureConversationTitle({
                conversationId,
                userMessage: messageContent,
                assistantResponse: 'Imagem gerada com sucesso via OpenAI.',
              });
            } catch (titleError) {
              logger.warn({ error: titleError, conversationId }, 'Falha ao aplicar título automático (imagem)');
            }

            ws.send(JSON.stringify({ type: 'message', data: messagePayload }));
            ws.send(JSON.stringify({ type: 'complete', data: messagePayload }));
          } catch (error) {
            logger.error({
              errorMessage: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
              conversationId,
            }, 'Falha ao gerar imagem via OpenAI');
            ws.send(JSON.stringify({ 
              type: 'error', 
              error: 'Falha ao gerar imagem via OpenAI. Tente novamente em instantes.' 
            }));
          }

          return;
        }

        // ========================================================================
        // RESPONSE CACHE / GREETINGS GATE (17/12/2025)
        // Verifica se a mensagem é uma saudação simples que pode ser respondida
        // sem chamar o LLM GPU. Economiza custos e reduz latência.
        // Autor: Fillipe Guerra
        // CORREÇÃO 17/12/2025: Validar content antes de verificar cache
        // Schema define content como opcional (z.string().optional())
        // CORREÇÃO 18/12/2025: messageContent já definido no início do bloco
        // ========================================================================
        const cacheResult = await checkResponseCache(safeTenantId, messageContent);
        
        // Incrementar métricas Prometheus
        if (cacheResult.isGreeting) {
          metrics.responseCache.greetingsDetected.inc({ tenant_id: safeTenantId });
        }
        
        // CORREÇÃO 17/12/2025: Métricas separadas para cache hit e miss
        // cacheHit = resposta veio do Redis | hasResponse = tem resposta disponível
        if (cacheResult.hasResponse && cacheResult.response) {
          // Incrementar métrica correta baseado em se veio do cache ou foi gerada
          if (cacheResult.cacheHit) {
            metrics.responseCache.hitsTotal.inc({ tenant_id: safeTenantId });
          } else {
            metrics.responseCache.missesTotal.inc({ tenant_id: safeTenantId });
          }
          metrics.responseCache.checkDuration.observe(
            { tenant_id: safeTenantId }, 
            cacheResult.latencyMs / 1000
          );
          
          const cacheLatency = cacheResult.latencyMs;
          
          // Salvar resposta no banco
          let cachedResponse = cacheResult.response;
          cachedResponse = applyUserNameToGreeting(cachedResponse, nameContext);
          cachedResponse = appendNameConfirmationQuestion(cachedResponse, nameContext);
          const inserted = await db.insert(schema.messages).values({
            conversationId,
            agentId: conversation?.agentId,
            conteudo: cachedResponse,
            tipo: 'text',
            isFromUser: false,
            latenciaMs: cacheLatency,
            metadata: { 
              source: 'response-cache',
              cacheKey: cacheResult.cacheKey,
              isGreeting: true,
            },
          }).returning();
          
          // BUG FIX 25/12/2025: Verificação defensiva - .returning() deve retornar pelo menos um elemento
          // Previne crash se array estiver vazio (edge case durante erros de banco/transações)
          if (!inserted || inserted.length === 0 || !inserted[0]) {
            logger.error({ conversationId, userId }, 'Falha ao salvar mensagem de cache - .returning() retornou array vazio ou undefined');
            throw new Error('Falha ao salvar mensagem de cache - resultado do banco de dados inválido');
          }
          
          const cachedMsg = inserted[0];

          try {
            await ensureConversationTitle({
              conversationId,
              userMessage: messageContent,
              assistantResponse: cachedResponse,
            });
          } catch (titleError) {
            logger.warn({ error: titleError, conversationId }, 'Falha ao aplicar título automático (cache)');
          }
          
          // Enviar resposta ao cliente (simular streaming para UX consistente)
          ws.send(JSON.stringify({ type: 'stream', data: cachedResponse }));
          ws.send(JSON.stringify({ 
            type: 'complete', 
            data: cachedMsg,
            metrics: {
              cacheHit: cacheResult.cacheHit,  // true se veio do Redis, false se foi gerada
              cacheLatencyMs: cacheLatency,
              source: 'response-cache',
            },
          }));
          
          logger.info({
            conversationId,
            tenantId: safeTenantId,
            cacheLatencyMs: cacheLatency,
            isGreeting: true,
            cacheHit: cacheResult.cacheHit,
          }, cacheResult.cacheHit 
            ? 'Resposta servida do cache Redis (Greetings Gate) - sem GPU'
            : 'Saudação gerada e cacheada (Greetings Gate) - sem GPU');
          
          return; // Não continuar para LLM
        }
        // Se não tem resposta do cache (não é saudação), continuar para LLM
        // Métricas já foram registradas no bloco acima quando hasResponse=true

        const agent = conversation?.agent as AgentConfig | null;
        const assistantSettings = await getAssistantSettingsForTenant(safeTenantId);
        const userLocaleContext = await getUserLocaleContext(userId, safeTenantId);
        let systemPrompt = buildSystemPrompt(agent, assistantSettings, messageContent, userLocaleContext);
        systemPrompt = appendUserNamePolicy(systemPrompt, nameContext);
        systemPrompt = appendNameConfirmationInstruction(systemPrompt, nameContext);

        const namespaceId = message.namespaceId || conversation?.namespaceId || undefined;
        // CORREÇÃO 17/12/2025: Usar messageContent (com fallback) ao invés de message.content (potencialmente undefined)
        const ragParams = getAdaptiveRagParams(messageContent, 0);
        const ragWsStart = Date.now();
        emitAgentEventWs({
          phase: 'tool',
          action: 'rag_internal',
          status: 'start',
          message: 'Buscando contexto interno',
          correlationId: conversationId ?? undefined,
          payload: {
            limit: ragParams.limit,
            threshold: ragParams.threshold,
            namespaceId,
          },
        });
        const ragResult = await buscarContextoRAG(
          messageContent,
          namespaceId,
          ragParams.limit,
          ragParams.threshold,
          { userId, tenantId: safeTenantId, role: safeUserRole }
        );
        const ragLatency = Date.now() - ragStartTime;
        emitAgentEventWs({
          phase: 'tool',
          action: 'rag_internal',
          status: 'success',
          message: 'Contexto interno disponível',
          durationMs: Date.now() - ragWsStart,
          correlationId: conversationId ?? undefined,
          payload: {
            sources: ragResult?.sources?.length ?? 0,
          },
        });
        recordRagRelevance(safeTenantId, ragResult);
        recordRagSearchMetrics({ tenantId: safeTenantId, ragResult, latencyMs: ragLatency, endpoint: 'chat-ws' });
        
        if (ragResult && ragResult.context) {
          systemPrompt += formatarContextoParaLLM(ragResult);
          
          ws.send(JSON.stringify({ 
            type: 'sources', 
            data: ragResult.sources,
            ragLatencyMs: ragLatency,
          }));
          
          logger.info({ 
            conversationId,
            ragChunks: ragResult.sources.length,
            ragLatencyMs: ragLatency,
            namespaceId,
          }, 'Contexto RAG injetado via WebSocket');
        }

        if (isMemorySearchIntent(messageContent)) {
          const memoryHistory = await fetchUserMemoryHistory({
            userId,
            tenantId: safeTenantId,
            conversationId,
            limit: CHAT_HISTORY_SEARCH_LIMIT,
          });
          const memoryBlock = buildMemorySearchBlock(
            memoryHistory,
            messageContent,
            CHAT_HISTORY_SEARCH_TOKEN_BUDGET
          );
          if (memoryBlock) {
            systemPrompt += `\n\nHISTÓRICO RELEVANTE (memória solicitada):\n${memoryBlock}`;
          }
        }

        const llmStartTime = Date.now();
        // BUG FIX 25/12/2025: Usar proxyStreamFromGpuManager para streaming via GPU Manager Service
        const llmMessages = buildPromptMessages({
          systemPrompt,
          userMessage: messageContent,
          history: [],
          source: 'websocket',
        });

        // BUG FIX 02/01/2026: Extrair configuração LLM do agente para uso nas chamadas
        const websocketProfile = detectContextProfile(messageContent);
        const llmConfig = applyDynamicTokenBudget(
          getAgentLLMConfig(agent),
          llmMessages,
          { conversationId, source: 'websocket', profile: websocketProfile }
        );
        
        // BUG FIX 26/12/2025: Prefixado com _ - resultado não usado pois callback onDone usa responseText diretamente
        let _fullResponse = '';
        try {
          emitAgentEventWs({
            phase: 'llm',
            action: 'llm_stream',
            status: 'start',
            message: 'Iniciando geração',
            correlationId: conversationId ?? undefined,
            payload: {
              model: llmConfig.model,
              maxTokens: llmConfig.maxTokens,
              temperature: llmConfig.temperature,
            },
          });
          _fullResponse = await proxyStreamFromGpuManager(
            llmMessages,
            (content) => {
              // BUG FIX 25/12/2025: Envolver ws.send() em try-catch para tratamento gracioso de clientes desconectados
              // Se WebSocket estiver fechado durante streaming, erro não deve interromper processamento do stream
              try {
                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: 'stream', data: content }));
                } else {
                  logger.debug({ conversationId, readyState: ws.readyState }, 'WebSocket fechado durante streaming - ignorando chunk');
                }
              } catch (sendError) {
                // Cliente desconectado - logar mas não interromper processamento do stream
                // onDone callback ainda será executado para salvar mensagem completa no banco
                logger.warn({ error: sendError, conversationId }, 'Erro ao enviar chunk via WebSocket - cliente pode ter desconectado');
              }
            },
            async (responseText: string) => {
              emitAgentEventWs({
                phase: 'llm',
                action: 'llm_stream',
                status: 'success',
                message: 'Geração concluída',
                durationMs: Date.now() - llmStartTime,
                correlationId: conversationId ?? undefined,
                payload: {
                  responseLength: responseText.length,
                },
              });
              // BUG FIX 25/12/2025: Usar responseText do parâmetro ao invés de fullResponse do closure
              // fullResponse do escopo externo está vazio quando callback executa
              // Salvar resposta do assistente APÓS o stream completo
              const llmLatency = Date.now() - llmStartTime;
              const totalLatency = Date.now() - ragStartTime;
              
              const inserted = await db.insert(schema.messages).values({
                conversationId,
                agentId: conversation?.agentId,
                conteudo: responseText,
                tipo: 'text',
                isFromUser: false,
                latenciaMs: totalLatency,
              }).returning();
              
              // BUG FIX 25/12/2025: Verificação defensiva - .returning() deve retornar pelo menos um elemento
              // Previne crash se array estiver vazio (edge case durante erros de banco/transações)
              if (!inserted || inserted.length === 0 || !inserted[0]) {
                logger.error({ conversationId }, 'Falha ao salvar mensagem do assistente - .returning() retornou array vazio ou undefined');
                throw new Error('Falha ao salvar mensagem do assistente - resultado do banco de dados inválido');
              }
              
              const assistantMsg = inserted[0];

              try {
                await ensureConversationTitle({
                  conversationId,
                  userMessage: messageContent,
                  assistantResponse: responseText,
                });
              } catch (titleError) {
                logger.warn({ error: titleError, conversationId }, 'Falha ao aplicar título automático (websocket)');
              }

              const websocketProfile = detectContextProfile(messageContent);
              if (userRole && shouldAutoCollectTraining({
                profile: websocketProfile,
                namespaceId: conversation?.namespaceId || conversation?.agent?.namespaceId,
                userMessage: messageContent,
                assistantResponse: responseText,
              })) {
                void collectTrainingSample({
                  tenantId: safeTenantId,
                  namespaceId: (conversation?.namespaceId || conversation?.agent?.namespaceId) as string,
                  conversationId,
                  source: 'chat-auto',
                  messages: [
                    { role: 'user', content: messageContent },
                    { role: 'assistant', content: responseText },
                  ],
                  userId,
                  role: userRole,
                });
              }

              // BUG FIX 25/12/2025: Envolver ws.send() em try-catch para tratamento gracioso de clientes desconectados
              // Mesmo se cliente desconectou, mensagem já foi salva no banco (integridade de dados)
              try {
                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ 
                    type: 'complete', 
                    data: assistantMsg,
                    metrics: {
                      ragLatencyMs: ragLatency,
                      llmLatencyMs: llmLatency,
                      totalLatencyMs: totalLatency,
                      usedRag: !!ragResult?.context,
                      ragChunks: ragResult?.sources?.length || 0,
                    },
                  }));
                } else {
                  logger.debug({ conversationId, readyState: ws.readyState }, 'WebSocket fechado ao enviar mensagem completa - mensagem salva no banco');
                }
              } catch (sendError) {
                // Cliente desconectado - mensagem já foi salva no banco, apenas logar
                logger.warn({ error: sendError, conversationId, messageId: assistantMsg.id }, 'Erro ao enviar mensagem completa via WebSocket - mensagem salva no banco');
              }
              
              logger.info({
                conversationId,
                ragLatencyMs: ragLatency,
                llmLatencyMs: llmLatency,
                totalLatencyMs: totalLatency,
                usedRag: !!ragResult?.context,
              }, 'Mensagem WebSocket processada com integração RAG');
              
              // ======================================================================
              // ANÁLISE PÓS-RESPOSTA: Verificar se LLM deu resposta de baixa confiança
              // Se sim, incrementa fallback counter e pode escalar automaticamente
              // (LLM atual não retorna confidence score - usamos indicadores proxy)
              // ======================================================================
              const postResponseEscalation = await processLLMResponseForEscalation(
                conversationId,
                responseText
              );
              
              if (postResponseEscalation) {
                // LLM atingiu limite de respostas de baixa confiança - escalar
                const _escalationResult = await processAutoEscalation(postResponseEscalation);
                
                ws.send(JSON.stringify({
                  type: 'escalation',
                  trigger: postResponseEscalation.trigger,
                  message: 'A conversa foi encaminhada para um atendente humano devido a respostas inconclusivas.',
                  confidence: postResponseEscalation.confidence,
                  fallbackCount: postResponseEscalation.fallbackCount,
                }));
                
                // Notificar agentes conectados
                notifyAgentsAboutEvent('new_handoff', {
                  conversationId,
                  tenantId: safeTenantId,
                  trigger: postResponseEscalation.trigger,
                  priority: 'medium',
                  reason: 'low_confidence_responses',
                });
                
                logger.info({
                  conversationId,
                  trigger: postResponseEscalation.trigger,
                  fallbackCount: postResponseEscalation.fallbackCount,
                  confidence: postResponseEscalation.confidence,
                }, 'Escalação automática após resposta de baixa confiança do LLM');
              }
            },
            llmConfig, // BUG FIX 02/01/2026: Passar configuração do agente
            getAdaptiveGpuPriority('websocket', websocketProfile)
          );
        } catch (streamError) {
          logger.error({ error: streamError }, 'Erro no streaming WebSocket');
          if (streamError instanceof ClientInputError) {
            ws.send(JSON.stringify({ type: 'error', error: streamError.message, code: streamError.code }));
            return;
          }
          ws.send(JSON.stringify({ type: 'error', error: 'Falha ao processar mensagem' }));
          return;
        }
      }
      
      // ========================================================================
      // HANDLER MULTIMODAL (FASE 9 - Upload de mídia via WebSocket)
      // IMPORTANTE: LLM texto (Qwen2.5 7B) é SOMENTE TEXTO - não processa imagens diretamente
      // Para imagens: usa RAG com descrição OpenAI Vision + embeddings de texto (Qwen3)
      // Para áudio/vídeo: usa transcrição (texto) + RAG
      // ========================================================================
      else if (message.type === 'media') {
        const mediaMessage = message as {
          type: 'media';
          conversationId: string;
          content?: string;
          namespaceId?: string;
          media: {
            file: string; // base64
            filename: string;
            mimeType: string;
          };
        };

        if (!mediaMessage.media?.file || !mediaMessage.media?.filename || !mediaMessage.media?.mimeType) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            error: 'Dados de mídia incompletos. Envie file (base64), filename e mimeType.' 
          }));
          return;
        }

        const conversation = await db.query.conversations.findFirst({
          where: eq(schema.conversations.id, mediaMessage.conversationId),
          with: { 
            agent: {
              with: {
                namespace: true,
              },
            },
          },
        });

        if (!conversation) {
          ws.send(JSON.stringify({ type: 'error', error: 'Conversa não encontrada' }));
          return;
        }

        // Verificar se a conversa pertence ao tenant correto
        // CRÍTICO: Conversa DEVE ter namespace configurado para operações seguras
        const mediaConversationTenantId = conversation.agent?.namespace?.tenantId;
        
        if (!mediaConversationTenantId) {
          logger.warn({ 
            conversationId: mediaMessage.conversationId,
            hasAgent: !!conversation.agent,
            hasNamespace: !!conversation.agent?.namespace,
          }, 'Conversa sem namespace/tenant configurado - upload bloqueado');
          ws.send(JSON.stringify({ 
            type: 'error', 
            error: 'Conversa não está configurada corretamente. Entre em contato com o suporte.' 
          }));
          return;
        }
        
        if (mediaConversationTenantId !== tenantId) {
          logger.warn({ 
            tenantId, 
            mediaConversationTenantId, 
            conversationId: mediaMessage.conversationId,
          }, 'Tentativa de upload cross-tenant bloqueada');
          ws.send(JSON.stringify({ 
            type: 'error', 
            error: 'Acesso negado: conversa não pertence ao tenant' 
          }));
          return;
        }

        const baseNameContext = await resolveUserNameContext(userId, tenantId);
        const nameContext = await handleUserNameUpdate({
          userId,
          tenantId,
          userMessage: mediaMessage.content ?? '',
          currentContext: baseNameContext,
        });
        if (nameContext.shouldAskConfirmation) {
          await markNamePromptPending(userId, tenantId, nameContext);
        }
        
        // Usar tenantId derivado da conversa (SEMPRE da fonte confiável)
        const mediaSafeTenantId = mediaConversationTenantId;
        const wsInternalHeaders = buildInternalServiceHeaders({
          userId,
          tenantId: mediaSafeTenantId,
          role: (userRole || 'guest') as Role,
        });

        // Determinar tipo de mídia
        // BUG FIX 23/12/2025: Validação defensiva explícita de tipos suportados ao invés de assumir 'image' por padrão
        // Problema: Validação anterior classificava qualquer tipo não-audio/video como 'image', causando falhas no image processor
        // Solução: Lista explícita de tipos suportados com mensagem de erro clara e informativa
        // BUG FIX 23/12/2025: Normalização robusta de mimeType para suportar variações de case e espaços
        // MIME types podem vir com variações (ex: "Image/Jpeg", "audio/mpeg; codecs=mp3")
        // .toLowerCase() e .trim() garantem matching correto mesmo com variações
        // Extrair apenas o tipo base (antes de ;) para suportar parâmetros adicionais
        // Consistente com normalização em integrations-service para evitar rejeição de tipos legítimos
        const resolvedMediaType = resolveSupportedMediaType(mediaMessage.media.mimeType);
        
        // Validação defensiva: apenas tipos explicitamente suportados são aceitos
        if (!resolvedMediaType) {
          logger.warn({ 
            normalizedMimeType: mediaMessage.media.mimeType.toLowerCase().trim().split(';')[0].trim(),
            originalMimeType: mediaMessage.media.mimeType,
            filename: mediaMessage.media.filename,
            conversationId: mediaMessage.conversationId,
            supportedTypes: {
              image: SUPPORTED_IMAGE_TYPES,
              audio: SUPPORTED_AUDIO_TYPES,
            },
          }, 'Tipo de mídia não suportado via WebSocket - rejeitado');
          ws.send(JSON.stringify({ 
            type: 'media_error',
            error: `Tipo de arquivo não suportado: ${mediaMessage.media.mimeType}. Tipos suportados: imagens (${SUPPORTED_IMAGE_TYPES.join(', ')}) e áudio (${SUPPORTED_AUDIO_TYPES.join(', ')}).`,
          }));
          return;
        }

        // BUG FIX 23/12/2025: Type narrowing após validação para garantir type safety
        // Após o early return acima, TypeScript não infere automaticamente que mediaType não é null
        // Criar variável não-nullable para garantir type safety em todas as operações subsequentes
        const validatedMediaType: 'image' | 'audio' = resolvedMediaType;

        ws.send(JSON.stringify({ 
          type: 'media_uploading',
          filename: mediaMessage.media.filename,
          mediaType: validatedMediaType,
        }));

        // Salvar mensagem do usuário com referência à mídia
        const mediaId = crypto.randomUUID();
        const inserted = await db.insert(schema.messages).values({
          conversationId: mediaMessage.conversationId,
          userId,
          conteudo: mediaMessage.content || `[${validatedMediaType.toUpperCase()}] ${mediaMessage.media.filename}`,
          tipo: validatedMediaType,
          isFromUser: true,
          anexos: [{
            id: mediaId,
            type: validatedMediaType,
            filename: mediaMessage.media.filename,
            mimeType: mediaMessage.media.mimeType,
            size: Buffer.from(mediaMessage.media.file, 'base64').length,
          }],
        }).returning();
        
        // BUG FIX 25/12/2025: Verificação defensiva - .returning() deve retornar pelo menos um elemento
        // Previne crash se array estiver vazio (edge case durante erros de banco/transações)
        if (!inserted || inserted.length === 0 || !inserted[0]) {
          logger.error({ conversationId: mediaMessage.conversationId, userId }, 'Falha ao salvar mensagem de mídia - .returning() retornou array vazio ou undefined');
          throw new Error('Falha ao salvar mensagem de mídia - resultado do banco de dados inválido');
        }
        
        const userMsg = inserted[0];

        ws.send(JSON.stringify({ type: 'message', data: userMsg }));

        // Upload para RAG Service (processamento assíncrono)
        // Usar tenantId derivado da conversa (mais seguro)
        // Para imagem, gerar uma descrição/análise via OpenAI Vision e armazenar no RAG (metadados),
        // evitando duplicação e permitindo auditoria/observabilidade do pipeline.
        let visionDescriptionForRag: string | undefined;
        let visionModelForRag: string | undefined;
        if (validatedMediaType === 'image') {
          try {
            const imageDataUri = `data:${mediaMessage.media.mimeType};base64,${mediaMessage.media.file}`;
            const analysis = await analyzeImageWithOpenAI({
              imageDataUri,
              question: mediaMessage.content || 'Descreva e analise esta imagem.',
            });
            visionDescriptionForRag = analysis.text;
            visionModelForRag = analysis.model;
          } catch (visionErr) {
            logger.error(
              { error: visionErr instanceof Error ? visionErr.message : String(visionErr) },
              'Falha ao analisar imagem via OpenAI Vision'
            );
          }
        }

        const uploadResult = await uploadMediaToRAG(
          mediaMessage.media.file,
          mediaMessage.media.filename,
          mediaMessage.media.mimeType,
          mediaSafeTenantId,
          visionDescriptionForRag,
          userMsg.id,
          mediaMessage.conversationId,
          wsInternalHeaders,
        );

        if (!uploadResult) {
          ws.send(JSON.stringify({ 
            type: 'media_error',
            error: 'Falha ao processar mídia. Tente novamente.',
          }));
          return;
        }

        // Atualizar anexos da mensagem com ID do upload
        await db.update(schema.messages)
          .set({
            anexos: [{
              id: mediaId,
              type: validatedMediaType,
              filename: mediaMessage.media.filename,
              mimeType: mediaMessage.media.mimeType,
              size: Buffer.from(mediaMessage.media.file, 'base64').length,
              url: uploadResult.fileUrl,
              thumbnailUrl: uploadResult.thumbnailUrl,
              visionDescription: visionDescriptionForRag,
              visionModel: visionModelForRag,
            }],
          })
          .where(eq(schema.messages.id, userMsg.id));

        ws.send(JSON.stringify({ 
          type: 'media_uploaded',
          uploadId: uploadResult.uploadId,
          fileUrl: uploadResult.fileUrl,
          thumbnailUrl: uploadResult.thumbnailUrl,
          processingStatus: uploadResult.processingStatus,
        }));

        // Preparar prompt para LLM texto (Qwen2.5 7B é SOMENTE TEXTO)
        // Não processa imagens diretamente - usar RAG + OpenAI Vision
        const agent = conversation.agent as AgentConfig | null;
        const assistantSettings = await getAssistantSettingsForTenant(tenantId);
        const userLocaleContext = await getUserLocaleContext(userId, tenantId);
        let systemPrompt = buildSystemPrompt(agent, assistantSettings, mediaMessage.content, userLocaleContext);
        systemPrompt = appendUserNamePolicy(systemPrompt, nameContext);
        systemPrompt = appendNameConfirmationInstruction(systemPrompt, nameContext);
        
        // Para imagens: usa RAG com embeddings de texto a partir da descrição OpenAI Vision
        // Para áudio: usar transcrição quando disponível
        let userContent = mediaMessage.content || '';
        
        // BUG FIX 23/12/2025: Usar validatedMediaType consistentemente em todo o código
        // Após validação e type narrowing, usar apenas validatedMediaType para garantir type safety
        if (validatedMediaType === 'image') {
          // Gate 2: OpenAI Vision fornece análise visual; LLM (texto) usa essa análise para responder com stream.
          if (visionDescriptionForRag && visionDescriptionForRag.trim().length > 0) {
            systemPrompt += `\n\n[ANÁLISE VISUAL (OpenAI Vision)]\n${visionDescriptionForRag}\n[/ANÁLISE VISUAL (OpenAI Vision)]\n`;
            userContent = userContent || 'Com base na análise visual acima, explique a imagem e possíveis implicações para trading.';
          } else {
            systemPrompt += '\n\nO usuário enviou uma imagem, mas a análise visual (OpenAI Vision) está indisponível no momento.';
            userContent = userContent || 'Recebi a imagem. No momento, não consegui analisar visualmente. Descreva o que deseja avaliar.';
          }
        } else if (validatedMediaType === 'audio') {
          // Aguardar transcrição se disponível
          if (uploadResult.transcription) {
            userContent = `[Transcrição do áudio]: ${uploadResult.transcription}\n\n${userContent}`;
          } else {
            systemPrompt += '\n\nO usuário enviou um áudio que está sendo processado.';
            userContent = userContent || 'Recebi seu áudio. Estou processando a transcrição.';
          }
        }
        // REMOVIDO 23/12/2025: Processamento de vídeo desabilitado (muito pesado para GPU)
        // Plataforma suporta apenas: texto, áudio e imagem

        // Buscar contexto RAG
        const namespaceId = mediaMessage.namespaceId || conversation.namespaceId || undefined;
        const ragQuery =
          validatedMediaType === 'image' && visionDescriptionForRag
            ? `${visionDescriptionForRag}\n\nPergunta do usuário:\n${userContent}`
            : userContent;
        const ragParams = getAdaptiveRagParams(ragQuery, 0);
        const ragResult = await buscarContextoRAG(
          ragQuery,
          namespaceId,
          ragParams.limit,
          ragParams.threshold,
          { userId, tenantId, role: safeUserRole }
        );
        recordRagRelevance(tenantId, ragResult);
        
        if (ragResult?.context) {
          systemPrompt += formatarContextoParaLLM(ragResult);
          
          ws.send(JSON.stringify({ 
            type: 'sources', 
            data: ragResult.sources,
          }));
        }

        // BUG FIX 25/12/2025: Chamar LLM com streaming via proxyStreamFromGpuManager
        const llmStartTime = Date.now();
        
        // BUG FIX 02/01/2026: Extrair configuração LLM do agente para uso nas chamadas
        const mediaProfile = detectContextProfile(userContent);
        const mediaLlmConfig = applyDynamicTokenBudget(
          getAgentLLMConfig(agent),
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          { conversationId: mediaMessage.conversationId, source: 'websocket-media', profile: mediaProfile }
        );
        
        // LLM texto (Qwen2.5 7B) é SOMENTE TEXTO
        // Não envia imagens diretamente - usa contexto RAG via OpenAI Vision + embeddings de texto
        const llmMessages = buildPromptMessages({
          systemPrompt,
          userMessage: userContent,
          history: [],
          source: 'websocket-media',
        });

        // BUG FIX 26/12/2025: Prefixado com _ - resultado não usado pois callback onDone usa responseText diretamente
        let _fullResponse = '';
        try {
          _fullResponse = await proxyStreamFromGpuManager(
            llmMessages,
            (content) => {
              // BUG FIX 25/12/2025: Envolver ws.send() em try-catch para tratamento gracioso de clientes desconectados
              // Se WebSocket estiver fechado durante streaming, erro não deve interromper processamento do stream
              try {
                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ type: 'stream', data: content }));
                } else {
                  logger.debug({ conversationId: mediaMessage.conversationId, readyState: ws.readyState }, 'WebSocket fechado durante streaming (mídia) - ignorando chunk');
                }
              } catch (sendError) {
                // Cliente desconectado - logar mas não interromper processamento do stream
                // onDone callback ainda será executado para salvar mensagem completa no banco
                logger.warn({ error: sendError, conversationId: mediaMessage.conversationId }, 'Erro ao enviar chunk via WebSocket (mídia) - cliente pode ter desconectado');
              }
            },
            async (responseText: string) => {
              // BUG FIX 25/12/2025: Usar responseText do parâmetro ao invés de fullResponse do closure
              // fullResponse do escopo externo está vazio quando callback executa
              // Salvar resposta do assistente APÓS o stream completo
              const llmLatency = Date.now() - llmStartTime;
              
              const inserted = await db.insert(schema.messages).values({
                conversationId: mediaMessage.conversationId,
                agentId: conversation.agentId,
                conteudo: responseText,
                tipo: 'text',
                isFromUser: false,
                latenciaMs: llmLatency,
              }).returning();
              
              // BUG FIX 25/12/2025: Verificação defensiva - .returning() deve retornar pelo menos um elemento
              // Previne crash se array estiver vazio (edge case durante erros de banco/transações)
              if (!inserted || inserted.length === 0 || !inserted[0]) {
                logger.error({ conversationId: mediaMessage.conversationId }, 'Falha ao salvar mensagem do assistente (mídia) - .returning() retornou array vazio ou undefined');
                throw new Error('Falha ao salvar mensagem do assistente (mídia) - resultado do banco de dados inválido');
              }
              
              const assistantMsg = inserted[0];

              try {
                await ensureConversationTitle({
                  conversationId: mediaMessage.conversationId,
                  userMessage: mediaMessage.content || `[${validatedMediaType.toUpperCase()}] ${mediaMessage.media.filename}`,
                  assistantResponse: responseText,
                });
              } catch (titleError) {
                logger.warn({ error: titleError, conversationId: mediaMessage.conversationId }, 'Falha ao aplicar título automático (mídia)');
              }

              // BUG FIX 25/12/2025: Envolver ws.send() em try-catch para tratamento gracioso de clientes desconectados
              // Mesmo se cliente desconectou, mensagem já foi salva no banco (integridade de dados)
              try {
                if (ws.readyState === ws.OPEN) {
                  ws.send(JSON.stringify({ 
                    type: 'complete', 
                    data: assistantMsg,
                    metrics: {
                      llmLatencyMs: llmLatency,
                      mediaType: validatedMediaType,
                      uploadId: uploadResult.uploadId,
                      usedRag: !!ragResult?.context,
                    },
                  }));
                } else {
                  logger.debug({ conversationId: mediaMessage.conversationId, readyState: ws.readyState }, 'WebSocket fechado ao enviar mensagem completa (mídia) - mensagem salva no banco');
                }
              } catch (sendError) {
                // Cliente desconectado - mensagem já foi salva no banco, apenas logar
                logger.warn({ error: sendError, conversationId: mediaMessage.conversationId, messageId: assistantMsg.id }, 'Erro ao enviar mensagem completa via WebSocket (mídia) - mensagem salva no banco');
              }

              logger.info({
                conversationId: mediaMessage.conversationId,
                uploadId: uploadResult.uploadId,
                mediaType: validatedMediaType,
                llmLatencyMs: llmLatency,
              }, 'Mensagem multimodal processada via WebSocket');
            },
            mediaLlmConfig, // BUG FIX 02/01/2026: Passar configuração do agente
            getAdaptiveGpuPriority('websocket-media', mediaProfile)
          );
        } catch (streamError) {
          logger.error({ error: streamError }, 'Erro no streaming WebSocket');
          if (streamError instanceof ClientInputError) {
            ws.send(JSON.stringify({ type: 'error', error: streamError.message, code: streamError.code }));
            return;
          }
          ws.send(JSON.stringify({ type: 'error', error: 'Falha ao processar mensagem' }));
          return;
        }
      }
    } catch (error) {
      logger.error({ error }, 'Erro na mensagem WebSocket');
      if (error instanceof ClientInputError) {
        ws.send(JSON.stringify({ type: 'error', error: error.message, code: error.code }));
        return;
      }
      ws.send(JSON.stringify({ type: 'error', error: 'Falha ao processar mensagem' }));
    }
  });

  ws.on('close', () => {
    if (extWs.__activeSessionCounted) {
      metrics.llm.activeSessions.dec();
      extWs.__activeSessionCounted = false;
    }
    wsClients.delete(clientKey);
    cleanupWsRateLimit(clientKey);
    logger.info({ userId, tenantId, clientKey }, 'Cliente WebSocket desconectado');
  });
});

// ============================================================================
// WEBSOCKET PARA AGENTES (TAKEOVER/HANDOVER REAL-TIME)
// Permite que agentes recebam notificações em tempo real sobre:
// - Novas escalações (new_handoff)
// - Mensagens de usuários em conversas humanas (new_message)
// - Alertas de SLA (sla_warning)
// - Handbacks (handback)
// ============================================================================
const agentWss = new WebSocketServer({ noServer: true });

// Atualizar upgrade handler para suportar dois WebSocket servers
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', 'ws://localhost').pathname;
  
  if (pathname === '/ws/agent') {
    // Conexão de agente para TakeoverPanel
    agentWss.handleUpgrade(request, socket, head, (ws) => {
      agentWss.emit('connection', ws, request);
    });
  } else {
    // Conexão de cliente normal (chat)
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

agentWss.on('connection', async (ws, req) => {
  const urlParams = new URL(req.url || '', 'ws://localhost').searchParams;
  const agentId = urlParams.get('agentId');
  const claimedTenantId = urlParams.get('tenantId');
  
  if (!agentId) {
    ws.close(4001, 'ID do agente necessário');
    return;
  }
  
  if (!claimedTenantId) {
    ws.close(4002, 'Tenant ID obrigatório para conexão de agente');
    return;
  }
  
  // ========================================================================
  // SEGURANÇA: Validar que o agente pertence ao tenant especificado
  // OWASP API Security - Não confiar em tenantId passado via URL
  // Derivar tenantId do agente no banco de dados
  // ========================================================================
  try {
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, agentId),
    });
    
    if (!user) {
      logger.warn({ agentId, claimedTenantId }, 'Agente não encontrado no banco de dados');
      ws.close(4003, 'Agente não encontrado');
      return;
    }
    
    // Derivar tenantId do agente (verificação de segurança)
    const safeTenantId = user.tenantId;
    
    if (!safeTenantId) {
      logger.warn({ agentId }, 'Agente sem tenant associado');
      ws.close(4004, 'Agente sem tenant associado');
      return;
    }
    
    // Verificar se o tenant reivindicado corresponde ao tenant real do agente
    if (claimedTenantId !== safeTenantId) {
      logger.warn({ 
        agentId, 
        claimedTenantId, 
        actualTenantId: safeTenantId,
      }, 'Tentativa de conexão WebSocket com tenant incorreto - possível ataque');
      ws.close(4005, 'Tenant inválido para este agente');
      return;
    }
    
    // Verificar permissão de takeover via RBAC centralizado (Regra 2 - NÃO DUPLICAR)
    // Usa checkPermission do @alice/shared-utils com cache de permissões
    const userRole = user.role as Role;
    
    if (!userRole) {
      logger.warn({ agentId, safeTenantId }, 'Agente sem role definida');
      ws.close(4006, 'Sem permissão para takeover');
      return;
    }
    
    // C5 Code Review: checkPermission agora é async (Redis cache distribuído)
    const permissionCheck = await checkPermission(
      { userId: agentId, tenantId: safeTenantId, role: userRole },
      'chat:takeover:write'
    );
    
    if (!permissionCheck.allowed) {
      logger.warn({ 
        agentId, 
        safeTenantId, 
        role: userRole,
        reason: permissionCheck.reason,
      }, 'Agente sem permissão de takeover');
      ws.close(4006, 'Sem permissão para takeover');
      return;
    }
    
    const agentKey = `${safeTenantId}:${agentId}`;
    
    // Registrar agente conectado (usando tenantId derivado do banco)
    wsAgentClients.set(agentKey, {
      ws,
      userId: agentId,
      tenantId: safeTenantId, // Usar tenantId derivado, não o reivindicado
      subscribedConversations: new Set(),
    });
    
    logger.info({ agentId, tenantId: safeTenantId, agentKey }, 'Agente conectado ao WebSocket de takeover');
    
    // Enviar confirmação de conexão
    ws.send(JSON.stringify({
      type: 'connected',
      agentId,
      tenantId: safeTenantId, // Usar tenantId derivado
      timestamp: new Date().toISOString(),
    }));
    // Handlers de eventos ficam dentro do try pois precisam do agentKey e safeTenantId
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString()) as {
          type: string;
          conversationId?: string;
        };
        
        // Agente pode se inscrever para receber notificações de conversas específicas
        if (message.type === 'subscribe' && message.conversationId) {
          const agent = wsAgentClients.get(agentKey);
          if (agent) {
            agent.subscribedConversations.add(message.conversationId);
            ws.send(JSON.stringify({
              type: 'subscribed',
              conversationId: message.conversationId,
            }));
            logger.debug({ agentKey, conversationId: message.conversationId }, 'Agente inscrito em conversa');
          }
        }
        
        // Agente pode se desinscrever de conversas
        if (message.type === 'unsubscribe' && message.conversationId) {
          const agent = wsAgentClients.get(agentKey);
          if (agent) {
            agent.subscribedConversations.delete(message.conversationId);
            ws.send(JSON.stringify({
              type: 'unsubscribed',
              conversationId: message.conversationId,
            }));
          }
        }
        
        // Ping/pong para manter conexão viva
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }
      } catch (error) {
        logger.error({ error }, 'Erro ao processar mensagem de agente WebSocket');
      }
    });
    
    ws.on('close', () => {
      wsAgentClients.delete(agentKey);
      logger.info({ agentId, tenantId: safeTenantId, agentKey }, 'Agente desconectado do WebSocket de takeover');
    });
    
    ws.on('error', (error) => {
      logger.error({ error, agentKey }, 'Erro no WebSocket do agente');
      wsAgentClients.delete(agentKey);
    });
  } catch (error) {
    logger.error({ error, agentId }, 'Erro ao validar agente para WebSocket');
    ws.close(4000, 'Erro interno de autenticação');
    return;
  }
});

// ============================================================================
// TAKEOVER/HANDOVER ROUTES (FASE 6.5)
// ============================================================================

app.get('/api/chat/conversations/:id/state', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:takeover:read'), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID de conversa inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  
  try {
    const state = await getOrCreateConversationState(id);
    res.json({ state });
  } catch (error) {
    logger.error({ error, conversationId: id }, 'Erro ao buscar estado da conversa');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/chat/conversations/:id/approval-policy', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:conversations:read'), async (req: Request, res: Response) => {
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID de conversa inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;

  try {
    const state = await getOrCreateConversationState(id);
    res.json({
      approvalPolicy: state.approvalPolicy ?? 'never_confirm',
      allowWebSearchWithoutApproval: true,
    });
  } catch (error) {
    logger.error({ error, conversationId: id }, 'Erro ao buscar política de aprovação da conversa');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.patch('/api/chat/conversations/:id/approval-policy', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:conversations:manage'), async (req: Request, res: Response) => {
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID de conversa inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;

  const bodyResult = approvalPolicyUpdateSchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({ error: 'Política de aprovação inválida', details: bodyResult.error.format() });
  }

  try {
    const updated = await updateConversationState(id, {
      approvalPolicy: bodyResult.data.approvalPolicy,
    });
    res.json({
      approvalPolicy: updated.approvalPolicy ?? 'never_confirm',
      allowWebSearchWithoutApproval: true,
    });
  } catch (error) {
    logger.error({ error, conversationId: id }, 'Erro ao atualizar política de aprovação da conversa');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/chat/conversations/:id/takeover', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:takeover:write'), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID de conversa inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  
  // SEGURANÇA: Usar req.user populado pelo middleware ao invés de header direto
  const agentId = req.user?.userId;
  
  // OWASP API3 - Validação Zod obrigatória
  const parseResult = takeoverNoteSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Input inválido' });
  }
  const { notes } = parseResult.data;
  
  if (!agentId) {
    return res.status(401).json({ error: 'ID do agente necessário' });
  }
  
  try {
    const result = await inititateTakeover(id, agentId, notes);
    
    if (result.success) {
      res.json({ 
        message: 'Takeover realizado com sucesso',
        ...result,
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    logger.error({ error, conversationId: id, agentId }, 'Erro ao realizar takeover');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/chat/conversations/:id/handback', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:handoff:write'), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID de conversa inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  
  // SEGURANÇA: Usar req.user populado pelo middleware ao invés de header direto
  const agentId = req.user?.userId;
  
  // OWASP API3 - Validação Zod obrigatória
  const parseResult = handbackSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Input inválido' });
  }
  const { resolutionNotes } = parseResult.data;
  
  if (!agentId) {
    return res.status(401).json({ error: 'ID do agente necessário' });
  }
  
  try {
    const result = await handbackToBot(id, agentId, resolutionNotes);
    
    if (result.success) {
      res.json({ 
        message: 'Controle devolvido para IA com sucesso',
        ...result,
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    logger.error({ error, conversationId: id, agentId }, 'Erro ao devolver controle para IA');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/chat/pending-handoffs', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:takeover:read'), async (req: Request, res: Response) => {
  try {
    // SEGURANÇA: Validar tenantId obrigatório para isolamento multi-tenant (Regra 6 CLAUDE.md)
    const tenantId = req.tenantId;
    if (!tenantId) {
      logger.warn({ userId: req.user?.userId }, 'Tentativa de acesso a pending-handoffs sem tenantId');
      return res.status(403).json({ error: 'Acesso negado: usuário não associado a um tenant' });
    }
    
    const pending = await getPendingHandoffs(tenantId);
    const now = Date.now();
    const conversations = pending.map((state) => ({
      id: state.conversationId,
      priority: state.slaBreached ? 'high' : state.slaDeadline ? 'medium' : 'low',
      waitTime: state.pendingSince ? Math.max(0, Math.floor((now - new Date(state.pendingSince).getTime()) / 1000)) : 0,
    }));
    res.json({ conversations });
  } catch (error) {
    logger.error({ error }, 'Erro ao listar handoffs pendentes');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// OWASP API3: Schema para validação de query params de takeover conversations
// Inclui 'all' como opção válida para indicar "sem filtro"
const takeoverConversationsQuerySchema = z.object({
  status: z.enum(['all', 'bot', 'human', 'pending_takeover']).optional(),
  channel: z.enum(['all', 'web', 'whatsapp', 'sms', 'email']).optional(),
  priority: z.enum(['all', 'high', 'medium', 'low']).optional(),
});

app.get('/api/takeover/conversations', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:takeover:read'), async (req: Request, res: Response) => {
  // OWASP API3: Validação estrita de query params - rejeita inputs inválidos
  const queryResult = takeoverConversationsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }
  const { status, channel, priority } = queryResult.data;
  
  try {
    const allConversations = await db.query.conversations.findMany({
      with: {
        messages: {
          orderBy: [desc(schema.messages.criadoEm)],
          limit: 1,
        },
        user: true,
      },
      orderBy: [desc(schema.conversations.ultimaMensagemEm)],
    });
    
    const allStates = await db.query.conversationStates.findMany();
    const statesMap = new Map(allStates.map(s => [s.conversationId, s]));
    
    let conversations = allConversations.map(conv => {
      const state = statesMap.get(conv.id);
      const lastMessage = conv.messages?.[0];
      
      let slaStatus: 'ok' | 'at_risk' | 'breached' = 'ok';
      if (state?.slaBreached) {
        slaStatus = 'breached';
      } else if (state?.slaDeadline) {
        const deadline = new Date(state.slaDeadline);
        const now = new Date();
        const minutesRemaining = (deadline.getTime() - now.getTime()) / 60000;
        if (minutesRemaining < 10) slaStatus = 'at_risk';
      }
      
      let calculatedPriority: 'high' | 'medium' | 'low' = 'medium';
      if (state?.slaBreached || slaStatus === 'at_risk') {
        calculatedPriority = 'high';
      } else if ((state?.sentimentScore ?? 0) < -0.3) {
        calculatedPriority = 'high';
      }
      
      const metadata = conv.metadata as { canal?: string } | null;
      
      return {
        id: conv.id,
        titulo: conv.titulo,
        userId: conv.userId,
        canal: metadata?.canal || 'web',
        status: state?.controlMode || 'bot',
        assignedAgentId: state?.assignedAgentId,
        confidenceScore: state?.confidenceScore,
        sentimentScore: state?.sentimentScore,
        fallbackCount: state?.fallbackCount,
        slaDeadline: state?.slaDeadline,
        slaBreached: state?.slaBreached,
        slaStatus,
        priority: calculatedPriority,
        pendingSince: state?.pendingSince,
        ultimaMensagemEm: conv.ultimaMensagemEm,
        totalMensagens: conv.totalMensagens,
        lastMessage: lastMessage ? {
          conteudo: lastMessage.conteudo,
          isFromUser: lastMessage.isFromUser,
          criadoEm: lastMessage.criadoEm,
        } : null,
        user: conv.user ? {
          id: conv.user.id,
          email: conv.user.email,
          firstName: conv.user.firstName,
          lastName: conv.user.lastName,
        } : null,
      };
    });
    
    const summary = {
      pending: conversations.filter(c => c.status === 'pending_handoff').length,
      human: conversations.filter(c => c.status === 'human').length,
      bot: conversations.filter(c => c.status === 'bot').length,
      slaBreached: conversations.filter(c => c.slaBreached).length,
      atRisk: conversations.filter(c => c.slaStatus === 'at_risk').length,
    };
    
    if (status && status !== 'all') {
      conversations = conversations.filter(c => c.status === status);
    }
    if (channel && channel !== 'all') {
      conversations = conversations.filter(c => c.canal === channel);
    }
    if (priority && priority !== 'all') {
      conversations = conversations.filter(c => c.priority === priority);
    }
    
    res.json({ 
      conversations,
      total: conversations.length,
      summary,
    });
  } catch (error) {
    logger.error({ error }, 'Erro ao listar conversas para takeover');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/takeover/conversations/:id/message', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:takeover:write'), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID de conversa inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  
  // SEGURANÇA: Usar req.user populado pelo middleware ao invés de header direto
  const agentId = req.user?.userId;
  
  // OWASP API3 - Validação Zod obrigatória
  const parseResult = takeoverMessageSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Input inválido' });
  }
  const { content } = parseResult.data;
  
  if (!agentId) {
    return res.status(401).json({ error: 'ID do agente necessário' });
  }
  
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: 'Conteúdo da mensagem necessário' });
  }
  
  try {
    const state = await getOrCreateConversationState(id);
    
    if (state.controlMode !== 'human') {
      return res.status(400).json({ 
        error: 'Conversa não está em modo humano. Faça takeover primeiro.',
        currentMode: state.controlMode,
      });
    }
    
    if (state.assignedAgentId !== agentId) {
      return res.status(403).json({ 
        error: 'Você não é o agente atribuído a esta conversa',
        assignedAgentId: state.assignedAgentId,
      });
    }
    
    // ========================================================================
    // FASE 1: Buscar conversa com usuário para identificar canal e telefone
    // Suporta Web (WebSocket) e WhatsApp (Twilio) - Regra 15 Microsserviços
    // ========================================================================
    const conversation = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, id),
      with: {
        user: true,
      },
    });
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }
    
    // Identificar canal da conversa via metadata
    const conversationMetadata = conversation.metadata as { canal?: string } | null;
    const channel = conversationMetadata?.canal || 'web';
    const userPhone = conversation.user?.telefone;
    const userId = conversation.userId;
    
    // ========================================================================
    // FASE 2: Salvar mensagem no banco com metadata de canal
    // ========================================================================
    const [message] = await db.insert(schema.messages).values({
      conversationId: id,
      userId: agentId,
      conteudo: content.trim(),
      tipo: 'text',
      isFromUser: false,
      metadata: {
        channel,
        sentByAgent: true,
        agentId,
      },
    }).returning();
    
    await db.update(schema.conversations)
      .set({
        ultimaMensagemEm: new Date(),
        atualizadoEm: new Date(),
      })
      .where(eq(schema.conversations.id, id));
    
    // ========================================================================
    // FASE 3: Entregar mensagem ao cliente conforme canal
    // WhatsApp: Chamar Integrations Service via circuit breaker
    // Web: Notificar via WebSocket em tempo real
    // ========================================================================
    let deliveryResult: { 
      delivered: boolean; 
      channel: string; 
      messageSid?: string; 
      error?: string;
    } = { delivered: false, channel };
    
    if (channel === 'whatsapp') {
      // Canal WhatsApp: Enviar via Integrations Service (Twilio)
      if (!userPhone) {
        logger.warn({ 
          conversationId: id, 
          userId,
        }, 'Usuário sem telefone cadastrado - mensagem salva mas não enviada via WhatsApp');
        
        deliveryResult = {
          delivered: false,
          channel: 'whatsapp',
          error: 'Telefone do usuário não cadastrado',
        };
      } else {
        // Enviar via circuit breaker (Regra 16)
        const whatsappResult = await sendWhatsAppMessage(userPhone, content.trim(), id);
        
        if (whatsappResult.success) {
          deliveryResult = {
            delivered: true,
            channel: 'whatsapp',
            messageSid: whatsappResult.messageSid,
          };
          
          logger.info({
            conversationId: id,
            agentId,
            messageId: message.id,
            messageSid: whatsappResult.messageSid,
            userPhone,
          }, 'Mensagem humana enviada via WhatsApp');
        } else {
          deliveryResult = {
            delivered: false,
            channel: 'whatsapp',
            error: whatsappResult.error,
          };
          
          logger.warn({
            conversationId: id,
            agentId,
            error: whatsappResult.error,
          }, 'Falha ao enviar mensagem via WhatsApp - mensagem salva no banco');
        }
      }
    } else {
      // Canal Web: Notificar via WebSocket
      // Buscar conexão do usuário e enviar mensagem em tempo real
      if (userId && conversation.user?.tenantId) {
        const clientKey = getClientKey(conversation.user.tenantId, userId);
        const userWs = wsClients.get(clientKey);
        
        if (userWs && userWs.readyState === WebSocket.OPEN) {
          userWs.send(JSON.stringify({
            type: 'agent_message',
            data: {
              id: message.id,
              conversationId: id,
              conteudo: content.trim(),
              isFromUser: false,
              agentId,
              criadoEm: message.criadoEm,
            },
          }));
          
          deliveryResult = {
            delivered: true,
            channel: 'web',
          };
          
          logger.info({
            conversationId: id,
            agentId,
            messageId: message.id,
            userId,
          }, 'Mensagem humana enviada via WebSocket');
        } else {
          // Usuário não conectado - mensagem será carregada no próximo acesso
          deliveryResult = {
            delivered: false,
            channel: 'web',
            error: 'Usuário não conectado ao WebSocket',
          };
          
          logger.info({
            conversationId: id,
            agentId,
            messageId: message.id,
          }, 'Mensagem humana salva - usuário offline, receberá ao reconectar');
        }
      } else {
        deliveryResult = {
          delivered: false,
          channel: 'web',
          error: 'Conversa sem usuário ou tenant associado',
        };
      }
    }
    
    res.json({ 
      message,
      success: true,
      delivery: deliveryResult,
    });
  } catch (error) {
    logger.error({ error, conversationId: id, agentId }, 'Erro ao enviar mensagem humana');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// OWASP API3: Schema para validação de query params
// Valida estritamente ao invés de sanitizar - rejeita inputs inválidos
const urgentConversationsQuerySchema = z.object({
  minutes: z.string()
    .regex(/^\d+$/, 'minutes deve ser um número inteiro positivo')
    .optional()
    .refine((val) => {
      if (val === undefined) return true;
      const num = parseInt(val, 10);
      return !isNaN(num) && num >= 1 && num <= 1440;
    }, { message: 'minutes deve estar entre 1 e 1440' }),
});

const SLA_URGENT_THRESHOLD_MINUTES = 10;
const WEEKLY_LOOKBACK_DAYS = 7;

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWeekdayLabel(date: Date): string {
  const labels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return labels[date.getDay()] ?? 'N/D';
}

function calculateSuccessRate(stats: {
  successes?: number;
  failures?: number;
  timeouts?: number;
  rejects?: number;
}): number {
  const successes = stats.successes ?? 0;
  const failures = stats.failures ?? 0;
  const timeouts = stats.timeouts ?? 0;
  const rejects = stats.rejects ?? 0;
  const total = successes + failures + timeouts + rejects;
  if (total === 0) return 100;
  return Math.round((successes / total) * 100);
}

// OWASP API3: Schema para listagem de imagens geradas
const generatedImagesQuerySchema = z.object({
  status: z.enum(['pending', 'generating', 'completed', 'failed', 'all'])
    .optional()
    .default('all'),
  approved: z.enum(['true', 'false', 'pending', 'all'])
    .optional(),
  limit: z.string()
    .regex(/^\d+$/, 'limit deve ser numérico')
    .optional()
    .default('20')
    .transform(Number)
    .refine(n => n >= 1 && n <= 100, 'limit deve ser entre 1 e 100'),
  offset: z.string()
    .regex(/^\d+$/, 'offset deve ser numérico')
    .optional()
    .default('0')
    .transform(Number)
    .refine(n => n >= 0, 'offset deve ser >= 0'),
});

// OWASP API3: Schema para validação de parâmetros de rota (req.params)
// Previne injection e garante formato UUID válido
const uuidParamSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
});

// Schema para parâmetros de rota com nome de serviço (reservado para uso futuro)
const _serviceNameParamSchema = z.object({
  name: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Nome deve conter apenas letras minúsculas, números e hífens'),
});

// ============================================================================
// API CRUD DE NAMESPACES (Contextos de Negócio)
// ============================================================================

const namespaceSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres').max(255),
  slug: z.string().min(2).max(100).regex(/^[a-zA-Z0-9-]+$/, 'Slug deve conter apenas letras, números e hífens'),
  descricao: z.string().max(2000).optional().nullable(),
  cor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor deve ser um HEX válido').optional().nullable(),
  icone: z.string().max(50).optional().nullable(),
  contextoSistema: z.string().max(20000).optional().nullable(),
  ordem: z.number().int().min(0).max(9999).optional().nullable(),
  ativo: z.boolean().optional().nullable(),
});

const updateNamespaceSchema = namespaceSchema.partial();

function normalizeNamespaceSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

app.get('/api/chat/urgent-conversations', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:takeover:read'), async (req: Request, res: Response) => {
  // OWASP API3: Validação estrita de query params - rejeita inputs inválidos
  const queryResult = urgentConversationsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }
  const minutesThreshold = queryResult.data.minutes ? parseInt(queryResult.data.minutes, 10) : 10;
  
  // SEGURANÇA: Validar tenantId obrigatório para isolamento multi-tenant (Regra 6 CLAUDE.md)
  const tenantId = req.tenantId;
  if (!tenantId) {
    logger.warn({ userId: req.user?.userId }, 'Tentativa de acesso a urgent-conversations sem tenantId');
    return res.status(403).json({ error: 'Acesso negado: usuário não associado a um tenant' });
  }
  
  try {
    const urgent = await getUrgentConversations(tenantId, minutesThreshold);
    const conversations = urgent.map((state) => ({
      id: state.conversationId,
      reason: state.slaBreached ? 'SLA expirado' : 'SLA próximo do vencimento',
    }));
    res.json({ conversations });
  } catch (error) {
    logger.error({ error }, 'Erro ao listar conversas urgentes');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/chat/takeover-stats', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:stats:read'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    logger.warn({ userId: req.user?.userId }, 'Tentativa de acesso a takeover-stats sem tenantId');
    return res.status(403).json({ error: 'Acesso negado: usuário não associado a um tenant' });
  }

  try {
    const urgentThreshold = new Date();
    urgentThreshold.setMinutes(urgentThreshold.getMinutes() + SLA_URGENT_THRESHOLD_MINUTES);

    const [pendingRow] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.conversationStates)
      .innerJoin(
        schema.conversations,
        eq(schema.conversationStates.conversationId, schema.conversations.id)
      )
      .where(and(
        eq(schema.conversationStates.controlMode, 'pending_handoff'),
        eq(schema.conversations.tenantId, tenantId)
      ));

    const [activeAgentsRow] = await db
      .select({ total: sql<number>`count(distinct ${schema.conversationStates.assignedAgentId})` })
      .from(schema.conversationStates)
      .innerJoin(
        schema.conversations,
        eq(schema.conversationStates.conversationId, schema.conversations.id)
      )
      .where(and(
        eq(schema.conversationStates.controlMode, 'human'),
        eq(schema.conversations.tenantId, tenantId),
        sql`${schema.conversationStates.assignedAgentId} is not null`
      ));

    const [urgentRow] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.conversationStates)
      .innerJoin(
        schema.conversations,
        eq(schema.conversationStates.conversationId, schema.conversations.id)
      )
      .where(and(
        eq(schema.conversationStates.controlMode, 'pending_handoff'),
        eq(schema.conversations.tenantId, tenantId),
        or(
          eq(schema.conversationStates.slaBreached, true),
          lt(schema.conversationStates.slaDeadline, urgentThreshold)
        )
      ));

    const lastResponder = sql`COALESCE(${schema.conversationStates.lastHumanMessage}, ${schema.conversationStates.lastBotMessage})`;
    const [avgResponseRow] = await db
      .select({
        avgSeconds: sql<number>`avg(extract(epoch from (${lastResponder} - ${schema.conversationStates.lastCustomerMessage})))`,
      })
      .from(schema.conversationStates)
      .innerJoin(
        schema.conversations,
        eq(schema.conversationStates.conversationId, schema.conversations.id)
      )
      .where(and(
        eq(schema.conversations.tenantId, tenantId),
        sql`${schema.conversationStates.lastCustomerMessage} is not null`,
        sql`${lastResponder} is not null`,
        sql`${lastResponder} >= ${schema.conversationStates.lastCustomerMessage}`
      ));

    const [resolvedByHumanRow] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.conversationEscalations)
      .innerJoin(
        schema.conversations,
        eq(schema.conversationEscalations.conversationId, schema.conversations.id)
      )
      .where(and(
        eq(schema.conversations.tenantId, tenantId),
        sql`${schema.conversationEscalations.resolvedAt} is not null`,
        sql`${schema.conversationEscalations.handledBy} is not null`
      ));

    const [resolvedByAiRow] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.conversationEscalations)
      .innerJoin(
        schema.conversations,
        eq(schema.conversationEscalations.conversationId, schema.conversations.id)
      )
      .where(and(
        eq(schema.conversations.tenantId, tenantId),
        sql`${schema.conversationEscalations.resolvedAt} is not null`,
        sql`${schema.conversationEscalations.handledBy} is null`
      ));

    res.json({
      pendingHandoffs: Number(pendingRow?.total ?? 0),
      activeHumanAgents: Number(activeAgentsRow?.total ?? 0),
      urgentConversations: Number(urgentRow?.total ?? 0),
      avgResponseTime: Number(avgResponseRow?.avgSeconds ?? 0),
      resolvedByAI: Number(resolvedByAiRow?.total ?? 0),
      resolvedByHuman: Number(resolvedByHumanRow?.total ?? 0),
    });
  } catch (error) {
    logger.error({ error, tenantId }, 'Erro ao calcular takeover-stats');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/chat/sla-metrics', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:stats:read'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    logger.warn({ userId: req.user?.userId }, 'Tentativa de acesso a sla-metrics sem tenantId');
    return res.status(403).json({ error: 'Acesso negado: usuário não associado a um tenant' });
  }

  try {
    const now = new Date();
    const urgentThreshold = new Date();
    urgentThreshold.setMinutes(urgentThreshold.getMinutes() + SLA_URGENT_THRESHOLD_MINUTES);

    const [breachedRow] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.conversationStates)
      .innerJoin(
        schema.conversations,
        eq(schema.conversationStates.conversationId, schema.conversations.id)
      )
      .where(and(
        eq(schema.conversationStates.controlMode, 'pending_handoff'),
        eq(schema.conversationStates.slaBreached, true),
        eq(schema.conversations.tenantId, tenantId)
      ));

    const [atRiskRow] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.conversationStates)
      .innerJoin(
        schema.conversations,
        eq(schema.conversationStates.conversationId, schema.conversations.id)
      )
      .where(and(
        eq(schema.conversationStates.controlMode, 'pending_handoff'),
        eq(schema.conversationStates.slaBreached, false),
        eq(schema.conversations.tenantId, tenantId),
        sql`${schema.conversationStates.slaDeadline} is not null`,
        sql`${schema.conversationStates.slaDeadline} <= ${urgentThreshold}`,
        sql`${schema.conversationStates.slaDeadline} >= ${now}`
      ));

    const [onTrackRow] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.conversationStates)
      .innerJoin(
        schema.conversations,
        eq(schema.conversationStates.conversationId, schema.conversations.id)
      )
      .where(and(
        eq(schema.conversationStates.controlMode, 'pending_handoff'),
        eq(schema.conversationStates.slaBreached, false),
        eq(schema.conversations.tenantId, tenantId),
        sql`${schema.conversationStates.slaDeadline} is not null`,
        sql`${schema.conversationStates.slaDeadline} > ${urgentThreshold}`
      ));

    const responseWindowStart = new Date();
    responseWindowStart.setDate(responseWindowStart.getDate() - WEEKLY_LOOKBACK_DAYS);

    const responseTimes = await db
      .select({
        conversationId: schema.messages.conversationId,
        firstCustomer: sql<Date | null>`min(case when ${schema.messages.isFromUser} = true then ${schema.messages.criadoEm} end)`,
        firstAgent: sql<Date | null>`min(case when ${schema.messages.isFromUser} = false then ${schema.messages.criadoEm} end)`,
      })
      .from(schema.messages)
      .innerJoin(
        schema.conversations,
        eq(schema.messages.conversationId, schema.conversations.id)
      )
      .where(and(
        eq(schema.conversations.tenantId, tenantId),
        sql`${schema.messages.criadoEm} >= ${responseWindowStart}`
      ))
      .groupBy(schema.messages.conversationId);

    let responseSum = 0;
    let responseCount = 0;
    for (const row of responseTimes) {
      if (!row.firstCustomer || !row.firstAgent) continue;
      const deltaSeconds = (row.firstAgent.getTime() - row.firstCustomer.getTime()) / 1000;
      if (deltaSeconds >= 0) {
        responseSum += deltaSeconds;
        responseCount += 1;
      }
    }
    const avgFirstResponseTime = responseCount > 0 ? responseSum / responseCount : 0;

    const resolutionTimes = await db
      .select({
        createdAt: schema.conversationEscalations.criadoEm,
        resolvedAt: schema.conversationEscalations.resolvedAt,
      })
      .from(schema.conversationEscalations)
      .innerJoin(
        schema.conversations,
        eq(schema.conversationEscalations.conversationId, schema.conversations.id)
      )
      .where(and(
        eq(schema.conversations.tenantId, tenantId),
        sql`${schema.conversationEscalations.resolvedAt} is not null`,
        sql`${schema.conversationEscalations.criadoEm} >= ${responseWindowStart}`
      ));

    let resolutionSum = 0;
    let resolutionCount = 0;
    for (const row of resolutionTimes) {
      if (!row.resolvedAt || !row.createdAt) continue;
      const deltaSeconds = (row.resolvedAt.getTime() - row.createdAt.getTime()) / 1000;
      if (deltaSeconds >= 0) {
        resolutionSum += deltaSeconds;
        resolutionCount += 1;
      }
    }
    const avgResolutionTime = resolutionCount > 0 ? resolutionSum / resolutionCount : 0;

    res.json({
      breachedCount: Number(breachedRow?.total ?? 0),
      atRiskCount: Number(atRiskRow?.total ?? 0),
      onTrackCount: Number(onTrackRow?.total ?? 0),
      avgFirstResponseTime,
      avgResolutionTime,
    });
  } catch (error) {
    logger.error({ error, tenantId }, 'Erro ao calcular sla-metrics');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/chat/circuit-breakers', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:stats:read'), (_req: Request, res: Response) => {
  const llmState = gpuManagerBreaker.opened ? 'open' : (gpuManagerBreaker.halfOpen ? 'half-open' : 'closed');
  const ragStats = getRAGBreakerStats();
  const integrationsStats = getIntegrationsBreakerStats();

  const llmStats = gpuManagerBreaker.stats;
  const llmSuccessRate = calculateSuccessRate({
    successes: llmStats.successes,
    failures: llmStats.failures,
    timeouts: llmStats.timeouts,
    rejects: llmStats.rejects,
  });
  const ragSuccessRate = calculateSuccessRate({
    successes: ragStats.successes,
    failures: ragStats.failures,
    timeouts: ragStats.timeouts,
    rejects: ragStats.rejects,
  });
  const integrationsSuccessRate = calculateSuccessRate({
    successes: integrationsStats.stats.successes,
    failures: integrationsStats.stats.failures,
    timeouts: integrationsStats.stats.timeouts,
    rejects: integrationsStats.stats.rejects,
  });

  res.json({
    breakers: [
      {
        name: 'LLM (GPU Manager Service)',
        status: llmState,
        failures: llmStats.failures,
        successRate: llmSuccessRate,
      },
      {
        name: 'RAG Embeddings',
        status: ragStats.state,
        failures: ragStats.failures,
        successRate: ragSuccessRate,
      },
      {
        name: 'Integrations Service',
        status: integrationsStats.state,
        failures: integrationsStats.stats.failures,
        successRate: integrationsSuccessRate,
      },
    ],
  });
});

app.get('/api/chat/conversations/weekly', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:stats:read'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    logger.warn({ userId: req.user?.userId }, 'Tentativa de acesso a conversations/weekly sem tenantId');
    return res.status(403).json({ error: 'Acesso negado: usuário não associado a um tenant' });
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - (WEEKLY_LOOKBACK_DAYS - 1));

    const conversations = await db
      .select({
        id: schema.conversations.id,
        criadoEm: schema.conversations.criadoEm,
      })
      .from(schema.conversations)
      .where(and(
        eq(schema.conversations.tenantId, tenantId),
        sql`${schema.conversations.criadoEm} >= ${startDate}`
      ));

    const conversationIds = conversations.map((conversation) => conversation.id);
    const states = conversationIds.length > 0
      ? await db
        .select({
          conversationId: schema.conversationStates.conversationId,
          controlMode: schema.conversationStates.controlMode,
          assignedAgentId: schema.conversationStates.assignedAgentId,
        })
        .from(schema.conversationStates)
        .where(inArray(schema.conversationStates.conversationId, conversationIds))
      : [];

    const stateMap = new Map(states.map((state) => [state.conversationId, state]));

    const dailyBuckets = new Map<string, { name: string; ai: number; human: number }>();
    for (let i = 0; i < WEEKLY_LOOKBACK_DAYS; i += 1) {
      const current = new Date(startDate);
      current.setDate(startDate.getDate() + i);
      const key = formatDateKey(current);
      dailyBuckets.set(key, {
        name: getWeekdayLabel(current),
        ai: 0,
        human: 0,
      });
    }

    for (const conversation of conversations) {
      if (!conversation.criadoEm) continue;
      const createdAt = new Date(conversation.criadoEm);
      const key = formatDateKey(createdAt);
      const bucket = dailyBuckets.get(key);
      if (!bucket) continue;

      const state = stateMap.get(conversation.id);
      const isHuman = state?.controlMode === 'human'
        || state?.controlMode === 'pending_handoff'
        || Boolean(state?.assignedAgentId);

      if (isHuman) {
        bucket.human += 1;
      } else {
        bucket.ai += 1;
      }
    }

    res.json({
      data: Array.from(dailyBuckets.values()),
    });
  } catch (error) {
    logger.error({ error, tenantId }, 'Erro ao calcular conversas semanais');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/chat/check-sla', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:escalation:manage'), async (req: Request, res: Response) => {
  // SEGURANÇA: Validar tenantId obrigatório para isolamento multi-tenant (Regra 6 CLAUDE.md)
  const tenantId = req.tenantId;
  if (!tenantId) {
    logger.warn({ userId: req.user?.userId }, 'Tentativa de check-sla sem tenantId');
    return res.status(403).json({ error: 'Acesso negado: usuário não associado a um tenant' });
  }
  
  try {
    const breachedCount = await checkSLABreaches(tenantId);
    res.json({ breachedCount, message: `${breachedCount} SLAs violados processados` });
  } catch (error) {
    logger.error({ error }, 'Erro ao verificar SLAs');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/chat/escalation-config', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:escalation:read'), (_req: Request, res: Response) => {
  res.json(ESCALATION_CONFIG);
});

// ============================================================================
// CRUD de namespaces
// ============================================================================

app.get('/api/namespaces', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:namespaces:read'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(403).json({ error: 'Acesso negado: usuário não associado a um tenant' });
  }

  try {
    const namespaces = await db.query.namespaces.findMany({
      where: and(
        eq(schema.namespaces.tenantId, tenantId),
        eq(schema.namespaces.ativo, true)
      ),
      orderBy: [asc(schema.namespaces.ordem), asc(schema.namespaces.nome)],
    });
    const namespaceIds = namespaces.map((namespace) => namespace.id);
    const agentsCountRows = namespaceIds.length
      ? await db
        .select({
          namespaceId: schema.agents.namespaceId,
          total: sql<number>`count(*)`,
        })
        .from(schema.agents)
        .where(and(
          eq(schema.agents.tenantId, tenantId),
          inArray(schema.agents.namespaceId, namespaceIds)
        ))
        .groupBy(schema.agents.namespaceId)
      : [];

    const documentsCountRows = namespaceIds.length
      ? await db
        .select({
          namespaceId: schema.documents.namespaceId,
          total: sql<number>`count(*)`,
        })
        .from(schema.documents)
        .where(inArray(schema.documents.namespaceId, namespaceIds))
        .groupBy(schema.documents.namespaceId)
      : [];

    const agentsCountMap = new Map(
      agentsCountRows.map((row) => [row.namespaceId ?? '', Number(row.total)])
    );
    const documentsCountMap = new Map(
      documentsCountRows.map((row) => [row.namespaceId ?? '', Number(row.total)])
    );
    const usersCountRows = namespaceIds.length
      ? await db
        .select({
          namespaceId: schema.conversations.namespaceId,
          total: sql<number>`count(distinct ${schema.conversations.userId})`,
        })
        .from(schema.conversations)
        .where(and(
          eq(schema.conversations.tenantId, tenantId),
          inArray(schema.conversations.namespaceId, namespaceIds)
        ))
        .groupBy(schema.conversations.namespaceId)
      : [];
    const usersCountMap = new Map(
      usersCountRows.map((row) => [row.namespaceId ?? '', Number(row.total)])
    );

    res.json(namespaces.map((namespace) => ({
      ...namespace,
      agentsCount: agentsCountMap.get(namespace.id) ?? 0,
      documentsCount: documentsCountMap.get(namespace.id) ?? 0,
      usersCount: usersCountMap.get(namespace.id) ?? 0,
    })));
  } catch (error) {
    logger.error({ error, tenantId }, 'Erro ao listar namespaces');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/namespaces', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:namespaces:write'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(403).json({ error: 'Acesso negado: usuário não associado a um tenant' });
  }

  const parseResult = namespaceSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: parseResult.error.format() });
  }

  const data = parseResult.data;
  const normalizedSlug = normalizeNamespaceSlug(data.slug);
  if (normalizedSlug.length < 2) {
    return res.status(400).json({ error: 'Slug inválido após normalização' });
  }

  try {
    const slugConflict = await db.query.namespaces.findFirst({
      where: and(
        eq(schema.namespaces.slug, normalizedSlug),
        eq(schema.namespaces.tenantId, tenantId)
      ),
    });

    if (slugConflict) {
      return res.status(409).json({ error: 'Já existe um namespace com este slug' });
    }

    const [createdNamespace] = await db.insert(schema.namespaces)
      .values({
        tenantId,
        nome: data.nome.trim(),
        slug: normalizedSlug,
        descricao: data.descricao ?? null,
        cor: data.cor ?? '#3B82F6',
        icone: data.icone ?? null,
        contextoSistema: data.contextoSistema ?? null,
        ordem: data.ordem ?? 0,
        ativo: data.ativo ?? true,
        atualizadoEm: new Date(),
      })
      .returning();

    logger.info({ namespaceId: createdNamespace.id, tenantId }, 'Namespace criado');
    res.status(201).json(createdNamespace);
  } catch (error) {
    logger.error({ error, tenantId }, 'Erro ao criar namespace');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.patch('/api/namespaces/:id', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:namespaces:write'), async (req: Request, res: Response) => {
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID de namespace inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  const tenantId = req.tenantId;

  if (!tenantId) {
    return res.status(403).json({ error: 'Acesso negado: usuário não associado a um tenant' });
  }

  const parseResult = updateNamespaceSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: parseResult.error.format() });
  }
  const data = parseResult.data;

  try {
    const existingNamespace = await db.query.namespaces.findFirst({
      where: eq(schema.namespaces.id, id),
    });

    if (!existingNamespace || existingNamespace.tenantId !== tenantId) {
      return res.status(404).json({ error: 'Namespace não encontrado' });
    }

    let normalizedSlug: string | undefined;
    if (data.slug) {
      normalizedSlug = normalizeNamespaceSlug(data.slug);
      if (normalizedSlug.length < 2) {
        return res.status(400).json({ error: 'Slug inválido após normalização' });
      }
      if (normalizedSlug !== existingNamespace.slug) {
        const slugConflict = await db.query.namespaces.findFirst({
          where: and(
            eq(schema.namespaces.slug, normalizedSlug),
            eq(schema.namespaces.tenantId, tenantId),
            not(eq(schema.namespaces.id, id))
          ),
        });
        if (slugConflict) {
          return res.status(409).json({ error: 'Já existe um namespace com este slug' });
        }
      }
    }

    const updatePayload = {
      ...data,
      nome: data.nome?.trim(),
      slug: normalizedSlug ?? data.slug,
      atualizadoEm: new Date(),
    };

    const [updatedNamespace] = await db.update(schema.namespaces)
      .set(updatePayload)
      .where(eq(schema.namespaces.id, id))
      .returning();

    logger.info({ namespaceId: id, tenantId, updates: Object.keys(data) }, 'Namespace atualizado');
    res.json(updatedNamespace);
  } catch (error) {
    logger.error({ error, namespaceId: id }, 'Erro ao atualizar namespace');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.delete('/api/namespaces/:id', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:namespaces:delete'), async (req: Request, res: Response) => {
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID de namespace inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  const tenantId = req.tenantId;

  if (!tenantId) {
    return res.status(403).json({ error: 'Acesso negado: usuário não associado a um tenant' });
  }

  try {
    const existingNamespace = await db.query.namespaces.findFirst({
      where: eq(schema.namespaces.id, id),
    });

    if (!existingNamespace || existingNamespace.tenantId !== tenantId) {
      return res.status(404).json({ error: 'Namespace não encontrado' });
    }

    const namespaceInUse =
      await db.query.agents.findFirst({ where: eq(schema.agents.namespaceId, id) })
      || await db.query.documents.findFirst({ where: eq(schema.documents.namespaceId, id) })
      || await db.query.conversations.findFirst({ where: eq(schema.conversations.namespaceId, id) });

    if (namespaceInUse) {
      const [disabledNamespace] = await db.update(schema.namespaces)
        .set({ ativo: false, atualizadoEm: new Date() })
        .where(eq(schema.namespaces.id, id))
        .returning();

      logger.info({ namespaceId: id, tenantId }, 'Namespace marcado como inativo (em uso)');
      return res.json({ message: 'Namespace marcado como inativo (em uso)', namespace: disabledNamespace });
    }

    await db.delete(schema.namespaces).where(eq(schema.namespaces.id, id));
    logger.info({ namespaceId: id, tenantId }, 'Namespace excluído');
    res.status(204).send();
  } catch (error) {
    logger.error({ error, namespaceId: id }, 'Erro ao excluir namespace');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// API CRUD DE AGENTES (ASSISTENTES IA)
// Permite configurar identidade, personalidade e instruções da IA via dashboard
// Regra 6 CLAUDE.md: Implementação enterprise-grade com validação completa
// ============================================================================

// Schema de validação para criação/atualização de agentes
const agentModelNameSchema = z.enum([
  // Gate 2 (LLM texto)
  'Qwen2.5-7B-Instruct-AWQ',
] as const);

const createAgentSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres').max(255),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, 'Slug deve conter apenas letras minúsculas, números e hífens'),
  descricao: z.string().max(2000).optional().nullable(),
  personalidade: z.string().max(5000).optional().nullable(),
  instrucoes: z.string().max(10000).optional().nullable(),
  avatar: z.string().url().optional().nullable(),
  capacidades: z.array(z.string()).optional().nullable(),
  modeloBase: agentModelNameSchema.optional().default('Qwen2.5-7B-Instruct-AWQ'),
  temperaturaModelo: z.number().min(0).max(2).optional().default(0.7),
  // Gate 2: max_tokens deve respeitar max-model-len do stack (2048)
  maxTokens: z.number().int().min(100).max(2048).optional().default(2048),
  status: z.enum(['active', 'training', 'paused', 'deprecated']).optional().default('active'),
  namespaceId: z.string().uuid().optional().nullable(),
});

const updateAgentSchema = createAgentSchema.partial();

type AgentModelOption = {
  value: string;
  label: string;
  description: string;
};

function buildAgentModelOptionsResponse(opts: {
  allowedModels: readonly string[];
  defaults: { modeloBase: string; temperaturaModelo: number; maxTokens: number };
  maxTokensMin: number;
}): {
  models: AgentModelOption[];
  defaults: { modeloBase: string; temperaturaModelo: number; maxTokens: number };
  constraints: { maxTokensMin: number; maxTokensMax: number };
} {
  const models: AgentModelOption[] = opts.allowedModels.map((value) => {
    if (value === 'Qwen2.5-7B-Instruct-AWQ') {
      return {
        value,
        label: 'Qwen2.5 7B Instruct (AWQ)',
        description: 'Gate 2 LLM (texto) - vLLM (AWQ 4-bit)',
      };
    }
    return { value, label: value, description: '' };
  });

  return {
    models,
    defaults: opts.defaults,
    constraints: {
      maxTokensMin: opts.maxTokensMin,
      maxTokensMax: opts.defaults.maxTokens,
    },
  };
}

/**
 * GET /api/agents/model-options
 *
 * SSOT para UI (evita hardcode no frontend):
 * - Modelos LLM suportados para Agents (Gate 2)
 * - Defaults/limites coerentes com runtime (MAX_MODEL_LEN / budgets)
 */
app.get('/api/agents/model-options', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:agents:read'), (_req: Request, res: Response) => {
  res.json(
    buildAgentModelOptionsResponse({
      allowedModels: agentModelNameSchema.options,
      defaults: {
        modeloBase: 'Qwen2.5-7B-Instruct-AWQ',
        temperaturaModelo: DEFAULT_LLM_CONFIG.temperature,
        maxTokens: DEFAULT_LLM_CONFIG.maxTokens,
      },
      maxTokensMin: 100,
    })
  );
});

// ============================================================================
// ASSISTANT SETTINGS (System Prompt / Comportamento / Humor)
// ============================================================================

const optionalTextWithMin = (min: number, max: number) =>
  z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      return value.trim();
    },
    z.union([z.literal(''), z.string().min(min).max(max)]).optional().nullable()
  );

const assistantSettingsSchema = z.object({
  systemPrompt: optionalTextWithMin(10, 20000),
  creatorName: optionalTextWithMin(2, 200),
  creatorRule: optionalTextWithMin(10, 5000),
  ethicsPolicy: optionalTextWithMin(10, 5000),
  moralPolicy: optionalTextWithMin(10, 5000),
  legalPolicy: optionalTextWithMin(10, 5000),
  safetyGuardrails: optionalTextWithMin(10, 8000),
  nsfwPolicy: optionalTextWithMin(10, 5000),
  behavior: z.string().max(5000).optional().nullable(),
  mood: z.string().max(2000).optional().nullable(),
  behaviorDirectness: z.number().int().min(0).max(100).optional().nullable(),
  behaviorProactivity: z.number().int().min(0).max(100).optional().nullable(),
  moodFormality: z.number().int().min(0).max(100).optional().nullable(),
  moodEmpathy: z.number().int().min(0).max(100).optional().nullable(),
  typingSpeedMs: z.number().int().min(100).max(5000).optional().nullable(),
});

const agenticLinkSchema = z.object({
  id: z.string().min(4).optional().nullable(),
  name: z.string().min(2).max(120),
  url: z.string().url(),
  description: z.string().max(500).optional().nullable(),
  tags: z.array(z.string().min(1).max(40)).optional().nullable(),
});

const detectorGroupSchema = z.object({
  keywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
  patterns: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
});

const agenticDetectorsSchema = z.object({
  webSearch: detectorGroupSchema,
  deepWeb: detectorGroupSchema,
  webImageSearch: detectorGroupSchema,
  imageGeneration: detectorGroupSchema,
  trading: detectorGroupSchema,
  agenticTask: z.object({
    createKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
    updateKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
    intentKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
    typeKeywords: z.object({
      document: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
      report: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
      accounting: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
      planning: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
    }),
  }),
  erp: z.object({
    baseKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
    listItemsKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
    listCustomersKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
    listInvoicesKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
      annualBillingKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
    createCustomerKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
    createInvoiceKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
  }),
  payments: z.object({
    wiseKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
    wiseRecipientsKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
    wiseTransferKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
    stripeKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
    stripePaymentKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
  }),
  stackOps: z.object({
    baseKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
    deployKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
    rollbackKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
    dryRunKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
    smartDeployKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
    stackKeywords: z.array(z.string().min(1).max(DETECTOR_ITEM_MAX_LENGTH)).max(DETECTOR_LIST_MAX),
  }),
});

const agenticSettingsSchema = z.object({
  webEnabled: z.boolean(),
  erpReadEnabled: z.boolean(),
  erpWriteEnabled: z.boolean(),
  tradingEnabled: z.boolean(),
  paymentsEnabled: z.boolean(),
  stackOpsEnabled: z.boolean(),
  financialApprovalRequired: z.boolean(),
  detectors: agenticDetectorsSchema.optional().default(DEFAULT_AGENTIC_DETECTORS),
  platformLinks: z.array(agenticLinkSchema).max(100),
});

const DEFAULT_AGENTIC_SETTINGS = {
  webEnabled: true,
  erpReadEnabled: true,
  erpWriteEnabled: true,
  tradingEnabled: true,
  paymentsEnabled: true,
  stackOpsEnabled: true,
  financialApprovalRequired: true,
  detectors: DEFAULT_AGENTIC_DETECTORS,
  platformLinks: [] as Array<z.infer<typeof agenticLinkSchema>>,
};

type AgenticLink = {
  id: string;
  name: string;
  url: string;
  description?: string;
  tags?: string[];
};

function normalizeAgenticLinks(
  links: Array<z.infer<typeof agenticLinkSchema>> | null | undefined
): AgenticLink[] {
  return (links ?? [])
    .filter((link) => Boolean(link?.name && link?.url))
    .map((link) => ({
      id: link.id ?? crypto.randomUUID(),
      name: link.name.trim(),
      url: link.url.trim(),
      description: link.description?.trim() || undefined,
      tags: (link.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
    }));
}

async function getOrCreateAgenticSettings(tenantId: string) {
  const existing = await db.query.agenticSettings.findFirst({
    where: eq(schema.agenticSettings.tenantId, tenantId),
  });
  if (existing) {
    return {
      ...existing,
      platformLinks: normalizeAgenticLinks(existing.platformLinks ?? []),
      detectors: normalizeAgenticDetectors(existing.detectors ?? {}),
    };
  }
  const [created] = await db.insert(schema.agenticSettings).values({
    tenantId,
    ...DEFAULT_AGENTIC_SETTINGS,
    platformLinks: [],
  }).returning();
  if (!created) {
    throw new Error('Falha ao criar agentic_settings');
  }
  return {
    ...created,
    detectors: normalizeAgenticDetectors(created.detectors ?? {}),
  };
}

app.get('/api/assistant-settings', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:agents:read'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json({ error: 'Tenant obrigatório' });
  }

  try {
    const settings = await db.query.assistantSettings.findFirst({
      where: eq(schema.assistantSettings.tenantId, tenantId),
    });
    const { core: coreSettings, missing } = resolveCoreSettings(settings);

    res.json({
      settings,
      defaults: {
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        creatorName: '',
        creatorRule: '',
        ethicsPolicy: '',
        moralPolicy: '',
        legalPolicy: '',
        safetyGuardrails: '',
        nsfwPolicy: '',
        behavior: null,
        mood: null,
        behaviorDirectness: 50,
        behaviorProactivity: 50,
        moodFormality: 50,
        moodEmpathy: 70,
        typingSpeedMs: DEFAULT_TYPING_SPEED_MS,
      },
      enforced: {
        creator: coreSettings?.creatorName ?? '',
        creatorRule: coreSettings?.creatorRule ?? '',
        ethicsPolicy: coreSettings?.ethicsPolicy ?? '',
        moralPolicy: coreSettings?.moralPolicy ?? '',
        legalPolicy: coreSettings?.legalPolicy ?? '',
        safetyGuardrails: coreSettings?.safetyGuardrails ?? '',
        nsfwPolicy: coreSettings?.nsfwPolicy ?? '',
      },
      missingCoreFields: missing,
    });
  } catch (error) {
    logger.error({ error, tenantId }, 'Falha ao buscar assistant_settings');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.patch('/api/assistant-settings', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('admin:alice_core:write'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  const userId = req.user?.userId;

  if (!tenantId || !userId) {
    return res.status(401).json({ error: 'Tenant e usuário obrigatórios' });
  }

  const parseResult = assistantSettingsSchema.safeParse(req.body);
  if (!parseResult.success) {
    logger.warn({ errors: parseResult.error.flatten() }, 'Input inválido em /api/assistant-settings');
    return res.status(400).json({ error: 'Input inválido', details: parseResult.error.format() });
  }

  try {
    const payload = {
      systemPrompt: parseResult.data.systemPrompt?.trim() || null,
      creatorName: parseResult.data.creatorName?.trim() || null,
      creatorRule: parseResult.data.creatorRule?.trim() || null,
      ethicsPolicy: parseResult.data.ethicsPolicy?.trim() || null,
      moralPolicy: parseResult.data.moralPolicy?.trim() || null,
      legalPolicy: parseResult.data.legalPolicy?.trim() || null,
      safetyGuardrails: parseResult.data.safetyGuardrails?.trim() || null,
      nsfwPolicy: parseResult.data.nsfwPolicy?.trim() || null,
      behavior: parseResult.data.behavior?.trim() || null,
      mood: parseResult.data.mood?.trim() || null,
      behaviorDirectness: parseResult.data.behaviorDirectness ?? null,
      behaviorProactivity: parseResult.data.behaviorProactivity ?? null,
      moodFormality: parseResult.data.moodFormality ?? null,
      moodEmpathy: parseResult.data.moodEmpathy ?? null,
      typingSpeedMs: parseResult.data.typingSpeedMs ?? null,
      updatedBy: userId,
    };

    const [settings] = await db.insert(schema.assistantSettings)
      .values({
        tenantId,
        createdBy: userId,
        ...payload,
      })
      .onConflictDoUpdate({
        target: schema.assistantSettings.tenantId,
        set: payload,
      })
      .returning();

    res.json({ settings });
  } catch (error) {
    logger.error({ error, tenantId }, 'Falha ao atualizar assistant_settings');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// AGENTIC SETTINGS (Links + políticas por tenant)
// ============================================================================

app.get('/api/agentic/settings', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('admin:alice_core:write'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json({ error: 'Tenant obrigatório' });
  }

  try {
    const settings = await getOrCreateAgenticSettings(tenantId);
    res.json({
      settings: {
        ...settings,
        platformLinks: normalizeAgenticLinks(settings.platformLinks),
        detectors: normalizeAgenticDetectors(settings.detectors),
      },
      defaults: DEFAULT_AGENTIC_SETTINGS,
    });
  } catch (error) {
    logger.error({ error, tenantId }, 'Falha ao buscar agentic_settings');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.patch('/api/agentic/settings', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('admin:alice_core:write'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json({ error: 'Tenant obrigatório' });
  }

  const parseResult = agenticSettingsSchema.safeParse(req.body);
  if (!parseResult.success) {
    logger.warn({ errors: parseResult.error.flatten() }, 'Input inválido em /api/agentic/settings');
    return res.status(400).json({ error: 'Input inválido', details: parseResult.error.format() });
  }

  try {
    const links = normalizeAgenticLinks(parseResult.data.platformLinks);
    const payload = {
      ...parseResult.data,
      platformLinks: links,
      detectors: normalizeAgenticDetectors(parseResult.data.detectors),
      atualizadoEm: new Date(),
    };
    const [settings] = await db.insert(schema.agenticSettings)
      .values({
        tenantId,
        ...payload,
      })
      .onConflictDoUpdate({
        target: schema.agenticSettings.tenantId,
        set: payload,
      })
      .returning();

    res.json({ settings });
  } catch (error) {
    logger.error({ error, tenantId }, 'Falha ao atualizar agentic_settings');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * GET /api/agents
 * Lista todos os agentes do tenant atual
 * Isolamento multi-tenant via tenantId do usuário autenticado
 */
app.get('/api/agents', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:agents:read'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  
  if (!tenantId) {
    return res.status(403).json({ error: 'Acesso negado: usuário não associado a um tenant' });
  }
  
  try {
    const agents = await db.query.agents.findMany({
      where: eq(schema.agents.tenantId, tenantId),
      orderBy: [desc(schema.agents.criadoEm)],
    });
    
    res.json(agents);
  } catch (error) {
    logger.error({ error, tenantId }, 'Erro ao listar agentes');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * GET /api/agents/:id
 * Obtém um agente específico pelo ID
 * Verifica se pertence ao tenant do usuário
 */
app.get('/api/agents/:id', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:agents:read'), async (req: Request, res: Response) => {
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID de agente inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  const tenantId = req.tenantId;
  
  if (!tenantId) {
    return res.status(403).json({ error: 'Acesso negado: usuário não associado a um tenant' });
  }
  
  try {
    const agent = await db.query.agents.findFirst({
      where: eq(schema.agents.id, id),
    });
    
    if (!agent) {
      return res.status(404).json({ error: 'Agente não encontrado' });
    }
    
    // SEGURANÇA: Verificar isolamento multi-tenant
    if (agent.tenantId !== tenantId) {
      logger.warn({ agentId: id, requestTenantId: tenantId, agentTenantId: agent.tenantId }, 'Tentativa de acesso cross-tenant a agente');
      return res.status(404).json({ error: 'Agente não encontrado' });
    }
    
    res.json(agent);
  } catch (error) {
    logger.error({ error, agentId: id }, 'Erro ao buscar agente');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * POST /api/agents
 * Cria um novo agente para o tenant
 */
app.post('/api/agents', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:agents:write'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  
  if (!tenantId) {
    return res.status(403).json({ error: 'Acesso negado: usuário não associado a um tenant' });
  }
  
  const parseResult = createAgentSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: parseResult.error.format() });
  }
  
  const data = parseResult.data;
  
  try {
    // Verificar se slug já existe no tenant
    // CORREÇÃO 02/01/2026: Filtrar por AMBOS slug E tenantId na query (evita race condition multi-tenant)
    const existingAgent = await db.query.agents.findFirst({
      where: and(
        eq(schema.agents.slug, data.slug),
        eq(schema.agents.tenantId, tenantId)
      ),
    });
    
    if (existingAgent) {
      return res.status(409).json({ error: 'Já existe um agente com este slug' });
    }
    
    // SEGURANÇA: Validar que namespaceId pertence ao mesmo tenant (previne cross-tenant attack)
    // Conforme documentação em packages/shared/src/schema.ts: "tenantId DEVE ser igual ao tenantId do namespace referenciado"
    try {
      await validateAgentTenantConsistency(
        data.namespaceId,
        tenantId,
        async (id) => db.query.namespaces.findFirst({ where: eq(schema.namespaces.id, id) })
      );
    } catch (validationError) {
      logger.warn({ tenantId, namespaceId: data.namespaceId, error: validationError }, 'Tentativa de associar agente a namespace de outro tenant');
      return res.status(403).json({ error: 'Namespace não encontrado ou não pertence ao seu tenant' });
    }
    
    const [agent] = await db.insert(schema.agents).values({
      tenantId,
      nome: data.nome,
      slug: data.slug,
      descricao: data.descricao,
      personalidade: data.personalidade,
      instrucoes: data.instrucoes,
      avatar: data.avatar,
      capacidades: data.capacidades,
      modeloBase: data.modeloBase,
      temperaturaModelo: data.temperaturaModelo,
      maxTokens: data.maxTokens,
      status: data.status,
      namespaceId: data.namespaceId,
    }).returning();
    
    logger.info({ agentId: agent.id, tenantId, nome: agent.nome }, 'Agente criado');
    res.status(201).json(agent);
  } catch (error) {
    logger.error({ error, tenantId }, 'Erro ao criar agente');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * PATCH /api/agents/:id
 * Atualiza um agente existente
 * Verifica se pertence ao tenant do usuário
 */
app.patch('/api/agents/:id', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:agents:write'), async (req: Request, res: Response) => {
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID de agente inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  const tenantId = req.tenantId;
  
  if (!tenantId) {
    return res.status(403).json({ error: 'Acesso negado: usuário não associado a um tenant' });
  }
  
  const parseResult = updateAgentSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Dados inválidos', details: parseResult.error.format() });
  }
  
  const data = parseResult.data;
  
  try {
    // Verificar se agente existe e pertence ao tenant
    const existingAgent = await db.query.agents.findFirst({
      where: eq(schema.agents.id, id),
    });
    
    if (!existingAgent) {
      return res.status(404).json({ error: 'Agente não encontrado' });
    }
    
    if (existingAgent.tenantId !== tenantId) {
      logger.warn({ agentId: id, requestTenantId: tenantId, agentTenantId: existingAgent.tenantId }, 'Tentativa de atualização cross-tenant de agente');
      return res.status(404).json({ error: 'Agente não encontrado' });
    }
    
    // Se está alterando o slug, verificar se novo slug já existe
    // CORREÇÃO 02/01/2026: Filtrar por AMBOS slug E tenantId na query (evita race condition multi-tenant)
    if (data.slug && data.slug !== existingAgent.slug) {
      const slugConflict = await db.query.agents.findFirst({
        where: and(
          eq(schema.agents.slug, data.slug),
          eq(schema.agents.tenantId, tenantId)
        ),
      });
      
      if (slugConflict) {
        return res.status(409).json({ error: 'Já existe um agente com este slug' });
      }
    }
    
    // SEGURANÇA: Se namespaceId está sendo atualizado, validar que pertence ao mesmo tenant
    // Conforme documentação em packages/shared/src/schema.ts: "tenantId DEVE ser igual ao tenantId do namespace referenciado"
    if (data.namespaceId !== undefined) {
      try {
        await validateAgentTenantConsistency(
          data.namespaceId,
          tenantId,
          async (id) => db.query.namespaces.findFirst({ where: eq(schema.namespaces.id, id) })
        );
      } catch (validationError) {
        logger.warn({ tenantId, namespaceId: data.namespaceId, agentId: id, error: validationError }, 'Tentativa de associar agente a namespace de outro tenant');
        return res.status(403).json({ error: 'Namespace não encontrado ou não pertence ao seu tenant' });
      }
    }
    
    const [updatedAgent] = await db.update(schema.agents)
      .set({
        ...data,
        atualizadoEm: new Date(),
      })
      .where(eq(schema.agents.id, id))
      .returning();
    
    logger.info({ agentId: id, tenantId, updates: Object.keys(data) }, 'Agente atualizado');
    res.json(updatedAgent);
  } catch (error) {
    logger.error({ error, agentId: id }, 'Erro ao atualizar agente');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * DELETE /api/agents/:id
 * Exclui um agente
 * Verifica se pertence ao tenant do usuário
 */
app.delete('/api/agents/:id', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:agents:delete'), async (req: Request, res: Response) => {
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID de agente inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  const tenantId = req.tenantId;
  
  if (!tenantId) {
    return res.status(403).json({ error: 'Acesso negado: usuário não associado a um tenant' });
  }
  
  try {
    // Verificar se agente existe e pertence ao tenant
    const existingAgent = await db.query.agents.findFirst({
      where: eq(schema.agents.id, id),
    });
    
    if (!existingAgent) {
      return res.status(404).json({ error: 'Agente não encontrado' });
    }
    
    if (existingAgent.tenantId !== tenantId) {
      logger.warn({ agentId: id, requestTenantId: tenantId, agentTenantId: existingAgent.tenantId }, 'Tentativa de exclusão cross-tenant de agente');
      return res.status(404).json({ error: 'Agente não encontrado' });
    }
    
    // Verificar se agente está em uso em conversas ativas
    const conversationsUsingAgent = await db.query.conversations.findFirst({
      where: eq(schema.conversations.agentId, id),
    });
    
    if (conversationsUsingAgent) {
      // Soft delete - apenas marcar como deprecated
      const [deprecatedAgent] = await db.update(schema.agents)
        .set({ status: 'deprecated', atualizadoEm: new Date() })
        .where(eq(schema.agents.id, id))
        .returning();
      
      logger.info({ agentId: id, tenantId }, 'Agente marcado como deprecated (em uso em conversas)');
      return res.json({ message: 'Agente marcado como deprecated (em uso em conversas)', agent: deprecatedAgent });
    }
    
    // Hard delete se não estiver em uso
    await db.delete(schema.agents).where(eq(schema.agents.id, id));
    
    logger.info({ agentId: id, tenantId }, 'Agente excluído');
    res.status(204).send();
  } catch (error) {
    logger.error({ error, agentId: id }, 'Erro ao excluir agente');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// ROTAS DE INTEGRAÇÃO CROSS-SERVICE (HANDOVER/TAKEOVER)
// Usadas pelo integrations-service para WhatsApp e outros canais
// ============================================================================

// Zod schemas para validação (OWASP API3)
// SEGURANÇA: Schema para canais externos força role='user' (impede spoofing de assistant)
const messageFromChannelSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().min(1).max(8000),
  // Role para canais externos - validação estrita
  role: z.enum(['user']).default('user'), // APENAS 'user' permitido em canais externos
  channel: z.enum(['whatsapp', 'web', 'sms', 'email']).default('web'),
});

const notifyAgentSchema = z.object({
  conversationId: z.string().uuid(),
  type: z.enum(['new_message', 'escalation', 'sla_warning']),
  message: z.string().max(4000).optional(),
  from: z.string().max(100).optional(),
  trigger: z.string().max(100).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
});

/**
 * POST /api/chat/message
 * 
 * Processa mensagem de canais externos (WhatsApp, SMS, etc.)
 * Inclui verificação de handover automático via shouldEscalate()
 * 
 * SEGURANÇA (OWASP + Regra 16):
 * - Apenas role='user' permitido (impede spoofing de assistant/system)
 * - tenantId derivado da conversa (não confia no header X-Tenant-Id)
 * - Verificação de escalação ANTES de persistir mensagem
 * 
 * Usado pelo integrations-service para processar mensagens com LLM
 */
app.post('/api/chat/message', asyncHandler(async (req: Request, res: Response) => {
  // OWASP API3 - Validação Zod obrigatória
  const parseResult = messageFromChannelSchema.safeParse(req.body);
  if (!parseResult.success) {
    logger.warn({ errors: parseResult.error.flatten() }, 'Input inválido em /api/chat/message');
    return res.status(400).json({ error: 'Input inválido' });
  }
  
  const { conversationId, content, channel } = parseResult.data;
  // role é sempre 'user' após validação Zod (isFromUser sempre true)
  
  try {
    // ========================================================================
    // FASE 1: VERIFICAÇÕES PRÉ-INSERT (CRÍTICO para handover correto!)
    // ========================================================================
    
    // Buscar conversa com agent e namespace para derivar tenantId
    const conversation = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, conversationId),
      with: { 
        agent: {
          with: {
            namespace: true,
          },
        },
      },
    });
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }
    
    // SEGURANÇA: Derivar tenantId da conversa (não confiar no header)
    const safeTenantId = (conversation.agent as { namespace?: { tenantId?: string } })
      ?.namespace?.tenantId;
    
    if (!safeTenantId) {
      logger.warn({ conversationId }, 'Conversa sem tenant associado');
    }
    
    // Verificar estado da conversa ANTES de inserir mensagem
    const state = await getOrCreateConversationState(conversationId);
    
    // Se já está em modo humano, apenas encaminhar para agente (sem LLM)
    if (state.controlMode === 'human') {
      // Salvar mensagem do usuário com metadata indicando modo humano
      const [userMessage] = await db.insert(schema.messages).values({
        conversationId,
        conteudo: content,
        tipo: 'text',
        isFromUser: true, // Sempre true (role forçado a 'user')
        metadata: { 
          channel, 
          handledBy: 'human',
          assignedAgentId: state.assignedAgentId,
        },
      }).returning();
      
      // Notificar agente sobre nova mensagem (usando tenantId derivado)
      notifyAgentsAboutEvent('new_message', {
        conversationId,
        tenantId: safeTenantId,
        message: content,
        from: channel,
      });
      
      return res.json({
        humanMode: true,
        response: null,
        userMessage,
      });
    }
    
    // ========================================================================
    // VERIFICAÇÃO DE HANDOVER AUTOMÁTICO (ANTES de persistir mensagem!)
    // ========================================================================
    const escalationContext = await shouldEscalate(conversationId, content);
    
    if (escalationContext) {
      // Processar escalação automática
      const escalationResult = await processAutoEscalation(escalationContext);
      
      // Salvar mensagem do usuário com metadata indicando escalação
      const [userMessage] = await db.insert(schema.messages).values({
        conversationId,
        conteudo: content,
        tipo: 'text',
        isFromUser: true, // Sempre true (role forçado a 'user')
        metadata: { 
          channel, 
          escalated: true,
          escalationTrigger: escalationContext.trigger,
          handledBy: 'escalation',
        },
      }).returning();
      
      logger.info({
        conversationId,
        trigger: escalationContext.trigger,
        channel,
        tenantId: safeTenantId,
        success: escalationResult.success,
      }, 'Escalação automática processada via canal externo');
      
      // Notificar agentes conectados em tempo real (usando tenantId derivado)
      notifyAgentsAboutEvent('new_handoff', {
        conversationId,
        tenantId: safeTenantId,
        message: content,
        trigger: escalationContext.trigger,
        priority: 'high',
      });
      
      return res.json({
        escalated: true,
        trigger: escalationContext.trigger,
        response: 'Um de nossos atendentes irá auxiliá-lo em breve. Por favor, aguarde.',
        userMessage,
      });
    }
    
    // ========================================================================
    // FASE 2: FLUXO NORMAL (Bot responde via LLM)
    // Apenas chegamos aqui se não houve escalação nem modo humano
    // ========================================================================
    
    // Salvar mensagem do usuário (será processada pelo bot)
    const [userMessage] = await db.insert(schema.messages).values({
      conversationId,
      conteudo: content,
      tipo: 'text',
      isFromUser: true, // Sempre true (role forçado a 'user')
      metadata: { channel, handledBy: 'bot' },
    }).returning();
    
    // Processar mensagem com LLM
    const agent = conversation.agent as AgentConfig | null;
    const assistantSettings = await getAssistantSettingsForTenant(conversation.tenantId || req.tenantId);
    const userIdForName = req.user?.userId as string | undefined;
    const baseNameContext = userIdForName
      ? await resolveUserNameContext(userIdForName, req.tenantId)
      : buildEmptyUserNameContext();
    const nameContext = userIdForName
      ? await handleUserNameUpdate({
        userId: userIdForName,
        tenantId: req.tenantId,
        userMessage: content,
        currentContext: baseNameContext,
      })
      : baseNameContext;
    if (userIdForName && nameContext.shouldAskConfirmation) {
      await markNamePromptPending(userIdForName, req.tenantId, nameContext);
    }
    const userLocaleContext = await getUserLocaleContext(req.user?.userId ?? null, req.tenantId ?? null);
    let systemPrompt = buildSystemPrompt(agent, assistantSettings, content, userLocaleContext);
    systemPrompt = appendUserNamePolicy(systemPrompt, nameContext);
    systemPrompt = appendNameConfirmationInstruction(systemPrompt, nameContext);
    
    // Buscar histórico recente
    const previousMessages = await db.query.messages.findMany({
      where: eq(schema.messages.conversationId, conversationId),
      orderBy: [desc(schema.messages.criadoEm)],
      limit: CHAT_HISTORY_FETCH_LIMIT,
    });
    const storedPreviousMessages = normalizeStoredMessages(previousMessages);
    
    // Buscar contexto RAG se disponível
    const ragParams = getAdaptiveRagParams(content, previousMessages.length);
    const ragResult = await buscarContextoRAG(
      content,
      conversation.namespaceId || undefined,
      ragParams.limit,
      ragParams.threshold,
      { userId: req.user?.userId as string, tenantId: req.tenantId as string, role: req.user?.role as Role }
    );
    recordRagRelevance(req.tenantId, ragResult);
    if (ragResult && ragResult.context) {
      systemPrompt += formatarContextoParaLLM(ragResult);
    }

    if (isMemorySearchIntent(content)) {
      const memoryHistory = await fetchUserMemoryHistory({
        userId: req.user?.userId,
        tenantId: req.tenantId,
        conversationId,
        limit: CHAT_HISTORY_SEARCH_LIMIT,
      });
      const memoryBlock = buildMemorySearchBlock(
        memoryHistory,
        content,
        CHAT_HISTORY_SEARCH_TOKEN_BUDGET
      );
      if (memoryBlock) {
        systemPrompt += `\n\nHISTÓRICO RELEVANTE (memória solicitada):\n${memoryBlock}`;
      }
    }
    
    const historyForPrompt = dropLeadingDuplicateUserMessage(storedPreviousMessages, content);
    const llmMessages = buildPromptMessages({
      systemPrompt,
      userMessage: content,
      history: historyForPrompt,
      source: 'external-channel',
    });
    
    // BUG FIX 02/01/2026: Extrair configuração LLM do agente para uso nas chamadas
    const externalProfile = detectContextProfile(content);
    const externalChannelLlmConfig = applyDynamicTokenBudget(
      getAgentLLMConfig(agent),
      llmMessages,
      { conversationId, source: 'external-channel', profile: externalProfile }
    );
    
    const llmStartTime = Date.now();
    const llmResponse = await callLlamaAPI(
      llmMessages,
      false,
      externalChannelLlmConfig,
      getAdaptiveGpuPriority('external-channel', externalProfile)
    );
    const llmLatency = Date.now() - llmStartTime;
    
    // Salvar resposta do bot
    const [botMessage] = await db.insert(schema.messages).values({
      conversationId,
      agentId: conversation.agentId,
      conteudo: llmResponse as string,
      tipo: 'text',
      isFromUser: false,
      latenciaMs: llmLatency,
      metadata: { channel, generatedBy: 'llm' },
    }).returning();
    
    // Atualizar conversa
    await db.update(schema.conversations)
      .set({
        totalMensagens: (conversation.totalMensagens || 0) + 2,
        ultimaMensagemEm: new Date(),
        atualizadoEm: new Date(),
      })
      .where(eq(schema.conversations.id, conversationId));
    
    logger.info({
      conversationId,
      channel,
      llmLatencyMs: llmLatency,
      usedRag: !!ragResult?.context,
    }, 'Mensagem processada via canal externo');
    
    res.json({
      response: llmResponse,
      userMessage,
      botMessage,
      ragSources: ragResult?.sources || [],
    });
  } catch (error) {
    if (error instanceof ClientInputError) {
      logger.warn({ code: error.code, message: error.message, conversationId, channel }, 'Requisição inválida (canal externo)');
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    logger.error({ error, conversationId, channel }, 'Erro ao processar mensagem de canal externo');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}));

/**
 * POST /api/chat/notify-agent
 * 
 * Notifica agentes humanos sobre novos eventos (mensagens, escalações, SLA)
 * Usado pelo integrations-service para notificar agentes sobre WhatsApp, etc.
 * 
 * SEGURANÇA (OWASP + Regra 16):
 * - tenantId derivado da conversa (não confia no header X-Tenant-Id)
 * - Previne data leak cross-tenant
 */
app.post('/api/chat/notify-agent', asyncHandler(async (req: Request, res: Response) => {
  // OWASP API3 - Validação Zod obrigatória
  const parseResult = notifyAgentSchema.safeParse(req.body);
  if (!parseResult.success) {
    logger.warn({ errors: parseResult.error.flatten() }, 'Input inválido em /api/chat/notify-agent');
    return res.status(400).json({ error: 'Input inválido' });
  }
  
  const { conversationId, type, message, from, trigger, priority } = parseResult.data;
  
  try {
    // SEGURANÇA: Derivar tenantId da conversa (não confiar no header)
    const conversation = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, conversationId),
      with: { 
        agent: {
          with: {
            namespace: true,
          },
        },
      },
    });
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversa não encontrada' });
    }
    
    const safeTenantId = (conversation.agent as { namespace?: { tenantId?: string } })
      ?.namespace?.tenantId;
    
    if (!safeTenantId) {
      logger.warn({ conversationId }, 'Conversa sem tenant associado - notificação pode falhar');
    }
    
    // Mapear tipo para evento
    const eventType = type === 'escalation' ? 'new_handoff' : 
                      type === 'sla_warning' ? 'sla_warning' : 'new_message';
    
    // Notificar todos os agentes conectados (usando tenantId derivado)
    notifyAgentsAboutEvent(eventType, {
      conversationId,
      tenantId: safeTenantId,
      message,
      from,
      trigger,
      priority,
    });
    
    logger.info({
      conversationId,
      eventType,
      tenantId: safeTenantId,
      connectedAgents: wsAgentClients.size,
    }, 'Agentes notificados via API');
    
    res.json({
      success: true,
      notifiedAgents: wsAgentClients.size,
    });
  } catch (error) {
    logger.error({ error, conversationId }, 'Erro ao notificar agentes');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}));

// ============================================================================
// IMAGE ROUTES - OpenAI (Vision + geração) - Arquitetura 16/01/2026+
// ============================================================================

const imageGenerationSchema = z.object({
  prompt: z.string().min(1).max(2000),
  negativePrompt: z.string().max(1000).optional(),
  width: z.number().int().min(1024).max(1536).default(1024),
  height: z.number().int().min(1024).max(1536).default(1024),
}).superRefine((value, ctx) => {
  const size = `${value.width}x${value.height}`;
  const allowed = new Set(['1024x1024', '1536x1024', '1024x1536']);
  if (!allowed.has(size)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Tamanho inválido. Use 1024x1024, 1536x1024 ou 1024x1536.',
      path: ['width'],
    });
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Tamanho inválido. Use 1024x1024, 1536x1024 ou 1024x1536.',
      path: ['height'],
    });
  }
});

app.post('/api/chat/images/generate', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('images:generate:write'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  const userId = req.user?.userId;

  if (!tenantId || !userId) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }

  const parseResult = imageGenerationSchema.safeParse(req.body);
  if (!parseResult.success) {
    logger.warn({ errors: parseResult.error.flatten() }, 'Input inválido em /api/chat/images/generate');
    return res.status(400).json({ error: 'Input inválido' });
  }

  if (!OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OpenAI não configurado', code: 'OPENAI_NOT_CONFIGURED' });
  }

  const { prompt, negativePrompt, width, height } = parseResult.data;
  const internalHeaders = buildInternalServiceHeaders({
    userId,
    tenantId,
    role: req.user?.role ?? 'guest',
  });

  try {
    const image = await generateImageFromPrompt({
      tenantId,
      userId,
      prompt,
      negativePrompt,
      width,
      height,
      internalHeaders,
    });
    res.json({ image });
  } catch (error) {
    logger.error({ error }, 'Erro ao gerar imagem via OpenAI');
    res.status(502).json({ error: 'Falha ao gerar imagem', details: error instanceof Error ? error.message : 'Erro desconhecido' });
  }
});

app.post('/api/chat/images/:id/rate', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('images:generate:write'), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID de imagem inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  
  // SEGURANÇA: Usar req.tenantId populado pelo middleware
  const tenantId = req.tenantId;
  
  // OWASP API3 - Validação Zod obrigatória
  const parseResult = imageScoreSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Input inválido' });
  }
  const { score } = parseResult.data;
  
  if (!tenantId) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }
  
  try {
    const image = await db.query.generatedImages.findFirst({
      where: eq(schema.generatedImages.id, id),
    });
    
    if (!image || image.tenantId !== tenantId) {
      return res.status(404).json({ error: 'Imagem não encontrada' });
    }
    
    // ARQUITETURA v4.0.0: Usar db diretamente (image-generation-client removido)
    await db.update(schema.generatedImages)
      .set({ feedbackScore: score })
      .where(eq(schema.generatedImages.id, id));
    
    logger.info({ imageId: id, score }, 'Feedback de imagem registrado');
    res.json({ message: 'Feedback registrado com sucesso' });
  } catch (error) {
    logger.error({ error, imageId: id }, 'Erro ao registrar feedback');
    res.status(500).json({ error: 'Erro ao registrar feedback' });
  }
});

app.post('/api/chat/images/:id/approve', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('images:approve:write'), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID de imagem inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  
  // SEGURANÇA: Usar req.tenantId populado pelo middleware
  const tenantId = req.tenantId;
  
  // OWASP API3 - Validação Zod obrigatória
  const parseResult = imageApproveSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Input inválido' });
  }
  const { approved } = parseResult.data;
  
  if (!tenantId) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }
  
  try {
    const image = await db.query.generatedImages.findFirst({
      where: eq(schema.generatedImages.id, id),
    });
    
    if (!image || image.tenantId !== tenantId) {
      return res.status(404).json({ error: 'Imagem não encontrada' });
    }
    
    // ARQUITETURA v4.0.0: Usar db diretamente (image-generation-client removido)
    await db.update(schema.generatedImages)
      .set({ approvedForTraining: approved })
      .where(eq(schema.generatedImages.id, id));
    
    logger.info({ imageId: id, approved }, 'Status de aprovação para treinamento atualizado');
    res.json({ message: `Imagem ${approved ? 'aprovada' : 'reprovada'} para treinamento` });
  } catch (error) {
    logger.error({ error, imageId: id }, 'Erro ao aprovar imagem');
    res.status(500).json({ error: 'Erro ao aprovar imagem' });
  }
});

// ARQUITETURA v4.0.0: Stats simplificado (image-generation-client removido)
app.get('/api/chat/images/stats', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('images:generate:read'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Autenticação necessária' });
    }

    type GeneratedImage = typeof schema.generatedImages.$inferSelect;
    const images = await db.query.generatedImages.findMany({
      where: eq(schema.generatedImages.tenantId, tenantId),
    }) as GeneratedImage[];
    
    const completed = images.filter((img: GeneratedImage) => img.status === 'completed');
    const ratedImages = images.filter(
      (img: GeneratedImage) => typeof img.feedbackScore === 'number' && (img.feedbackScore ?? 0) > 0
    );
    const avgGenerationTime = completed.length > 0
      ? completed.reduce((sum: number, img: GeneratedImage) => sum + (img.generationTimeMs || 0), 0) / completed.length
      : 0;
    const avgRating = ratedImages.length > 0
      ? ratedImages.reduce((sum: number, img: GeneratedImage) => sum + (img.feedbackScore || 0), 0) / ratedImages.length
      : 0;
    
    const stats = {
      totalGenerated: images.length,
      approved: images.filter((img: GeneratedImage) => img.approvedForTraining).length,
      pending: images.filter((img: GeneratedImage) => img.status === 'pending' || img.status === 'generating').length,
      inTraining: images.filter((img: GeneratedImage) => img.usedInFineTuning).length,
      avgRating: Number(avgRating.toFixed(1)),
      total: images.length,
      completed: completed.length,
      failed: images.filter((img: GeneratedImage) => img.status === 'failed').length,
      approvedForTraining: images.filter((img: GeneratedImage) => img.approvedForTraining).length,
      usedInFineTuning: images.filter((img: GeneratedImage) => img.usedInFineTuning).length,
      averageGenerationTimeMs: Math.round(avgGenerationTime),
      // ARQUITETURA v4.0.0: Circuit breaker removido (geração de imagens não disponível)
      note: 'Geração de imagens via OpenAI (gpt-image-1) e análise via OpenAI Vision (gpt-4.1)',
    };
    
    res.json(stats);
  } catch (error) {
    logger.error({ error }, 'Erro ao buscar estatísticas de imagens');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/chat/images', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('images:generate:read'), async (req: Request, res: Response) => {
  // SEGURANÇA: Usar req.tenantId populado pelo middleware
  const tenantId = req.tenantId;
  
  if (!tenantId) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }
  
  // OWASP API3: Validação Zod obrigatória de query params
  const queryResult = generatedImagesQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    logger.warn({ errors: queryResult.error.flatten() }, 'Input inválido em /api/chat/images');
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }
  
  const { status, approved, limit: pageLimit, offset: pageOffset } = queryResult.data;
  
  try {
    let images = await db.query.generatedImages.findMany({
      where: eq(schema.generatedImages.tenantId, tenantId),
      orderBy: [desc(schema.generatedImages.criadoEm)],
      with: {
        conversation: true,
      },
    });
    
    if (status && status !== 'all') {
      images = images.filter(img => img.status === status);
    }
    
    if (approved === 'true') {
      images = images.filter(img => img.approvedForTraining === true);
    } else if (approved === 'false') {
      images = images.filter(img => img.approvedForTraining === false);
    } else if (approved === 'pending') {
      images = images.filter(img => img.approvedForTraining === null);
    }
    
    const total = images.length;
    
    images = images.slice(pageOffset, pageOffset + pageLimit);
    
    res.json({
      images,
      total,
      offset: pageOffset,
      limit: pageLimit,
    });
  } catch (error) {
    logger.error({ error }, 'Erro ao listar imagens');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/chat/images/:id', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('images:generate:read'), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    logger.warn({ errors: paramsResult.error.flatten() }, 'ID inválido em /api/chat/images/:id');
    return res.status(400).json({ error: 'ID inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  
  // SEGURANÇA: Usar req.tenantId populado pelo middleware
  const tenantId = req.tenantId;
  
  if (!tenantId) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }
  
  try {
    const image = await db.query.generatedImages.findFirst({
      where: eq(schema.generatedImages.id, id),
      with: {
        conversation: true,
      },
    });
    
    if (!image) {
      return res.status(404).json({ error: 'Imagem não encontrada' });
    }
    
    if (image.tenantId !== tenantId) {
      logger.warn({ imageId: id, requestedBy: tenantId, ownedBy: image.tenantId }, 'Tentativa de acesso a imagem de outro tenant');
      return res.status(404).json({ error: 'Imagem não encontrada' });
    }
    
    res.json({ image });
  } catch (error) {
    logger.error({ error, imageId: id }, 'Erro ao buscar imagem');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// MESSAGE RATING ROUTES (GAP CRÍTICO #1 - Sistema de Aprendizado)
// Coleta dados de treinamento quando usuários avaliam mensagens de texto
// Alice é MULTIMODAL: coleta dados de texto, imagens, áudio, vídeo
// ============================================================================

/**
 * Endpoint para rating de mensagens de texto
 * Quando rating >= 4, coleta dados para treinamento via training-service
 * 
 * REGRA 6: Enterprise-grade - integração real com training-service
 * Alice MULTIMODAL: suporta texto, imagens, áudio, vídeo para aprendizado
 */
app.post('/api/chat/messages/:id/rate', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:messages:write'), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID de mensagem inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  
  // SEGURANÇA: Usar req.tenantId populado pelo middleware
  const tenantId = req.tenantId;
  
  // OWASP API3 - Validação Zod obrigatória
  const parseResult = messageRatingSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Input inválido', details: parseResult.error.format() });
  }
  const { rating, isPositive } = parseResult.data;
  
  // Converter isPositive para rating se fornecido
  const finalRating = isPositive !== undefined ? (isPositive ? 5 : 1) : rating;
  
  if (!tenantId) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }
  
  try {
    // Buscar mensagem e verificar tenant
    const message = await db.query.messages.findFirst({
      where: eq(schema.messages.id, id),
      with: {
        conversation: {
          with: {
            agent: {
              with: {
                namespace: true,
              },
            },
          },
        },
      },
    });
    
    if (!message) {
      return res.status(404).json({ error: 'Mensagem não encontrada' });
    }
    
    // Verificar se mensagem pertence ao tenant correto
    const messageTenantId = message.conversation?.agent?.namespace?.tenantId;
    if (!messageTenantId || messageTenantId !== tenantId) {
      logger.warn({ messageId: id, requestedBy: tenantId, ownedBy: messageTenantId }, 'Tentativa de rating de mensagem de outro tenant');
      return res.status(404).json({ error: 'Mensagem não encontrada' });
    }
    
    // Salvar rating na mensagem (metadata)
    await db.update(schema.messages)
      .set({
        metadata: {
          ...(message.metadata as Record<string, unknown> || {}),
          rating: finalRating,
          ratedAt: new Date().toISOString(),
        },
      })
      .where(eq(schema.messages.id, id));
    
    // Se rating >= 4, coletar dados para treinamento (GAP CRÍTICO #1)
    if (finalRating >= 4 && message.conversationId && messageTenantId) {
      try {
        // Buscar mensagens da conversa em torno da mensagem avaliada
        // CORREÇÃO BUG #1: Buscar mensagens próximas à mensagem avaliada, não apenas últimas 10
        // Isso garante que encontramos o par user/assistant correto mesmo se a mensagem for antiga
        // VALIDAÇÃO TYPESCRIPT: criadoEm pode ser null, usar Date.now() como fallback
        const messageTimestamp = message.criadoEm ? new Date(message.criadoEm) : new Date();
        const conversationMessages = await db.query.messages.findMany({
          where: eq(schema.messages.conversationId, message.conversationId),
          orderBy: [desc(schema.messages.criadoEm)],
          limit: 50, // Buscar mais mensagens para garantir que encontramos o par correto
        });
        
        // Encontrar par user/assistant mais recente
        let userMessage: typeof schema.messages.$inferSelect | undefined;
        let assistantMessage: typeof schema.messages.$inferSelect | undefined;
        
        // Se a mensagem avaliada é do assistente, buscar mensagem do usuário anterior
        if (!message.isFromUser) {
          assistantMessage = message;
          // Buscar última mensagem do usuário antes desta (ordenar por timestamp)
          // CORREÇÃO BUG #1: Buscar em todas as mensagens, não apenas nas últimas 10
          // VALIDAÇÃO TYPESCRIPT: filtrar nulls e validar antes de comparar timestamps
          const userMessages = conversationMessages
            .filter(m => m.isFromUser && m.criadoEm && new Date(m.criadoEm) < messageTimestamp)
            .sort((a, b) => {
              if (!a.criadoEm || !b.criadoEm) return 0;
              return new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime();
            });
          userMessage = userMessages[0]; // Mensagem do usuário mais recente antes da resposta
        } else {
          // Se é do usuário, buscar resposta do assistente seguinte
          userMessage = message;
          // CORREÇÃO BUG #1: Buscar em todas as mensagens, não apenas nas últimas 10
          // VALIDAÇÃO TYPESCRIPT: filtrar nulls e validar antes de comparar timestamps
          const assistantMessages = conversationMessages
            .filter(m => !m.isFromUser && m.criadoEm && new Date(m.criadoEm) > messageTimestamp)
            .sort((a, b) => {
              if (!a.criadoEm || !b.criadoEm) return 0;
              return new Date(a.criadoEm).getTime() - new Date(b.criadoEm).getTime();
            });
          assistantMessage = assistantMessages[0]; // Resposta do assistente mais próxima após a mensagem do usuário
        }
        
        // Se temos par user/assistant, coletar para treinamento
        if (userMessage && assistantMessage && userMessage.conteudo && assistantMessage.conteudo) {
          const namespaceId = message.conversation?.namespaceId || message.conversation?.agent?.namespaceId;
          if (!namespaceId) {
            logger.warn({ messageId: id, conversationId: message.conversationId }, 'Namespace ausente para coleta de treinamento');
            return res.json({ success: true, rating: finalRating });
          }
          
          // Chamar training-service para coletar dados
          // REGRA 6: Integração real com training-service (sem mocks)
          // Alice MULTIMODAL: coleta dados de texto, imagens, áudio, vídeo para aprendizado
          const internalHeaders = generateInternalAuthHeaders({
            userId: req.user?.userId || '',
            tenantId: messageTenantId,
            role: req.user?.role || ('guest' as Role),
          });
          
          // RESILIÊNCIA: AbortController com timeout para prevenir hang
          const trainingController = new AbortController();
          const trainingTimeoutId = setTimeout(() => trainingController.abort(), 10000); // 10s timeout
          
          try {
            const trainingResponse = await fetch(`${TRAINING_SERVICE_URL_FINAL}/api/training/data`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Internal-Signature': internalHeaders['x-internal-signature'],
                'X-Internal-Timestamp': internalHeaders['x-internal-timestamp'],
                'X-Internal-User-Id': req.user?.userId || '',
                'X-Internal-Tenant-Id': messageTenantId,
                'X-Internal-Role': req.user?.role || 'guest',
              },
              body: JSON.stringify({
                tenantId: messageTenantId,
                namespaceId: namespaceId || undefined,
                conversationId: message.conversationId,
                source: 'chat', // Fonte: chat web
                messages: [
                  { role: 'user', content: userMessage.conteudo },
                  { role: 'assistant', content: assistantMessage.conteudo },
                ],
                rating: finalRating,
              }),
              signal: trainingController.signal,
            });
            
            if (!trainingResponse.ok) {
              const errorText = await trainingResponse.text();
              logger.error({ 
                messageId: id, 
                status: trainingResponse.status,
                error: errorText,
              }, 'Falha ao coletar dados de treinamento');
            } else {
              const trainingData = await trainingResponse.json() as { trainingData?: { id: string }; isDuplicate?: boolean };
              logger.info({ 
                messageId: id, 
                trainingDataId: trainingData.trainingData?.id,
                isDuplicate: trainingData.isDuplicate,
                rating: finalRating,
              }, 'Dados de treinamento coletados com sucesso');
            }
          } finally {
            clearTimeout(trainingTimeoutId);
          }
        }
      } catch (trainingError) {
        // Não falhar o endpoint se coleta de treinamento falhar (não crítico)
        logger.error({ error: trainingError, messageId: id }, 'Erro ao coletar dados de treinamento (não crítico)');
      }
    }
    
    res.json({ 
      message: 'Feedback registrado com sucesso',
      rating: finalRating,
      collectedForTraining: finalRating >= 4,
    });
  } catch (error) {
    logger.error({ error, messageId: id }, 'Erro ao registrar feedback de mensagem');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// MIDDLEWARE: Not Found + Error Handler (Express.js 2025)
// ============================================================================

// Not Found handler (antes do error handler)
app.use(createNotFoundHandler({ serviceName: 'chat-service' }));

// Error handler global (OWASP 2023 + Express.js 2025)
app.use(createErrorHandler({ 
  serviceName: 'chat-service', 
  logger,
  includeStackInDev: true,
}));

// C4/C5 Code Review: Inicializar todos os caches (Redis em produção, in-memory em dev)
// Regra 6: fail-fast em produção se Redis indisponível
(async () => {
  try {
    await initializeAllCaches();
    await initializeTradingBroadcastSubscriber();
    server.listen(PORT, () => {
      logger.info({ 
        port: PORT, 
        llmConfigured: true, // GPU Manager Service gerencia LLM
        circuitBreaker: 'enabled',
        sessionCacheDistributed: sessionCacheAdapter?.isDistributed() ?? false,
        rbacCacheDistributed: permissionCache.getStats().distributed,
      }, 'Chat service iniciado com Circuit Breaker e caches distribuídos');
    });
  } catch (error) {
    logger.fatal({ error: (error as Error).message }, 'Falha ao iniciar chat-service');
    process.exit(1);
  }
})();

// SEGURANÇA: Timeouts para prevenir conexões pendentes (Node.js 20 LTS Best Practices)
server.timeout = 120000; // 120s para LLM streaming (respostas longas)
server.keepAliveTimeout = 65000; // 65s (maior que ALB timeout padrão de 60s)
server.headersTimeout = 66000; // Ligeiramente maior que keepAliveTimeout

// ============================================================================
// GRACEFUL SHUTDOWN (Enterprise-Grade - Regra 16 CLAUDE.md)
// ShutdownManager centralizado elimina duplicação de listeners (Regra 6)
// Ordem: Intervals → WebSocket → HTTP server → Database pool
// ============================================================================

registerShutdownCallback(
  'chat-background-intervals',
  async () => {
    logger.info('Limpando background intervals...');
    clearInterval(heartbeatInterval);
    clearInterval(rateLimitCleanupInterval);
    logger.info('Background intervals limpos');
  },
  { priority: ShutdownPriority.BACKGROUND_JOBS }
);

registerShutdownCallback(
  'chat-websocket-server',
  async () => {
    logger.info('Encerrando WebSocket server...');
    await new Promise<void>((resolve) => {
      wss.close(() => {
        logger.info('WebSocket server fechado');
        resolve();
      });
    });
  },
  { priority: ShutdownPriority.WEBSOCKET }
);

registerShutdownCallback(
  'chat-http-server',
  async () => {
    logger.info('Encerrando HTTP server...');
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          logger.error({ error: err }, 'Erro ao fechar HTTP server');
          reject(err);
        } else {
          logger.info('HTTP server encerrado com sucesso');
          resolve();
        }
      });
    });
  },
  { priority: ShutdownPriority.HTTP_SERVER }
);

// C4/C5 Code Review: Encerrar caches Redis antes do database
registerShutdownCallback(
  'chat-permission-cache',
  async () => {
    logger.info('Encerrando cache de permissões RBAC...');
    await permissionCache.destroy();
    logger.info('Cache de permissões encerrado');
  },
  { priority: ShutdownPriority.BACKGROUND_JOBS - 5 } // Antes do Redis client
);

registerShutdownCallback(
  'chat-trading-broadcast',
  async () => {
    if (!tradingSubscriber) return;
    logger.info('Encerrando Redis subscriber de trading...');
    await tradingSubscriber.quit();
    tradingSubscriber = null;
    logger.info('Redis subscriber de trading encerrado');
  },
  { priority: ShutdownPriority.BACKGROUND_JOBS - 8 } // Antes do Redis cache
);

registerShutdownCallback(
  'chat-redis-cache',
  async () => {
    logger.info('Encerrando cliente Redis cache...');
    await closeRedisCacheClient();
    logger.info('Cliente Redis cache encerrado');
  },
  { priority: ShutdownPriority.BACKGROUND_JOBS - 10 } // Antes do database, após permission cache
);

registerShutdownCallback(
  'chat-database-pool',
  async () => {
    logger.info('Encerrando pool de conexões database...');
    await closeDatabasePool();
    logger.info('Pool de conexões encerrado com sucesso');
  },
  { priority: ShutdownPriority.DATABASE }
);
