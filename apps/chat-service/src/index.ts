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
  requestGpuStream,
  validateAgentTenantConsistency,
} from '@alice/shared-utils';
import type { Role } from '@alice/shared-utils';
import { eq, desc, inArray, and, or, lt, sql } from '@alice/database';
import { z } from 'zod';
import { 
  buscarContextoRAG, 
  buscarContextoAgentic,
  formatarContextoParaLLM, 
  getRAGBreakerStats,
  uploadMediaToRAG,
} from './rag-client.js';
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
// IMAGE GENERATION DETECTION (Tarefa 133 - Detectar pedidos de geração de imagem)
// ============================================================================

interface ImageGenerationDetection {
  isImageRequest: boolean;
  prompt: string | null;
  confidence: number;
  reason: string;
}

const IMAGE_KEYWORDS_PT = [
  'gere uma imagem',
  'crie uma imagem',
  'faça uma imagem',
  'desenhe',
  'ilustre',
  'gerar imagem',
  'criar imagem',
  'fazer imagem',
  'quero uma imagem',
  'preciso de uma imagem',
  'pode criar uma imagem',
  'gere um',
  'crie um',
  'desenha',
  'ilustra',
  'visualize',
  'mostre visualmente',
  'gerar uma foto',
  'criar uma foto',
  'gerar uma ilustração',
  'criar uma ilustração',
];

const IMAGE_KEYWORDS_EN = [
  'generate an image',
  'create an image',
  'make an image',
  'draw',
  'illustrate',
  'generate image',
  'create image',
  'make image',
  'i want an image',
  'i need an image',
  'can you create an image',
  'generate a',
  'create a picture',
  'draw me',
  'visualize',
  'show me visually',
  'generate a photo',
  'create a photo',
  'generate an illustration',
  'create an illustration',
];

function detectImageGenerationRequest(message: string): ImageGenerationDetection {
  const lowerMessage = message.toLowerCase().trim();
  
  for (const keyword of IMAGE_KEYWORDS_PT) {
    if (lowerMessage.includes(keyword)) {
      const prompt = extractImagePrompt(message, keyword);
      return {
        isImageRequest: true,
        prompt,
        confidence: 0.95,
        reason: `Detectado keyword PT: "${keyword}"`,
      };
    }
  }
  
  for (const keyword of IMAGE_KEYWORDS_EN) {
    if (lowerMessage.includes(keyword)) {
      const prompt = extractImagePrompt(message, keyword);
      return {
        isImageRequest: true,
        prompt,
        confidence: 0.95,
        reason: `Detectado keyword EN: "${keyword}"`,
      };
    }
  }
  
  const visualPatterns = [
    /(?:gere|crie|faça|desenhe|ilustre)\s+(?:uma?\s+)?(?:imagem|foto|ilustração|desenho)/i,
    /(?:generate|create|make|draw|illustrate)\s+(?:an?\s+)?(?:image|photo|illustration|drawing)/i,
    /(?:quero|preciso|gostaria)\s+(?:de\s+)?(?:ver|uma?\s+)?(?:imagem|foto|ilustração)/i,
  ];
  
  for (const pattern of visualPatterns) {
    if (pattern.test(message)) {
      return {
        isImageRequest: true,
        prompt: message,
        confidence: 0.85,
        reason: 'Detectado padrão visual regex',
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

type ImageGenerationInput = {
  tenantId: string;
  userId: string;
  prompt: string;
  negativePrompt?: string | null;
  width?: number;
  height?: number;
  conversationId?: string | null;
  messageId?: string | null;
};

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
    const openAiResponse = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: composedPrompt,
        size,
        n: 1,
        response_format: 'b64_json',
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!openAiResponse.ok) {
      const errText = await openAiResponse.text().catch(() => '');
      throw new Error(`OpenAI Images error: ${openAiResponse.status} - ${errText}`);
    }

    const payload = await openAiResponse.json() as { data?: Array<{ b64_json?: string }> };
    const b64 = payload?.data?.[0]?.b64_json;
    if (!b64 || typeof b64 !== 'string' || b64.length < 64) {
      throw new Error('Resposta inválida da OpenAI Images API (b64_json ausente)');
    }

    const filename = `generated-${created.id}.png`;
    const uploadResult = await uploadMediaToRAG(
      b64,
      filename,
      'image/png',
      input.tenantId,
      input.prompt,
      input.messageId ?? undefined,
      input.conversationId ?? undefined,
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
}

interface AssistantSettings {
  systemPrompt?: string | null;
  behavior?: string | null;
  mood?: string | null;
  behaviorDirectness?: number | null;
  behaviorProactivity?: number | null;
  moodFormality?: number | null;
  moodEmpathy?: number | null;
}

/**
 * System prompt padrão usado quando não há agente configurado
 * ou quando o agente não tem instruções definidas.
 * 
 * IMPORTANTE: O prompt instrui a IA a detectar o idioma do usuário
 * e responder no mesmo idioma (não mais hardcoded em português).
 */
const DEFAULT_SYSTEM_PROMPT = `You are Alice, an intelligent and helpful enterprise AI assistant.

IMPORTANT LANGUAGE RULES:
- ALWAYS detect the language of the user's message
- ALWAYS respond in the SAME language as the user's message
- If the user writes in Portuguese, respond in Portuguese
- If the user writes in English, respond in English
- If the user writes in Spanish, respond in Spanish
- And so on for any language

BEHAVIOR GUIDELINES:
- Be professional, helpful, and concise
- If you don't know something, say so honestly
- Provide accurate and relevant information
- Be respectful and maintain a positive tone`;

const CREATOR_PROMPT_RULE = `CREATOR IDENTITY RULES:
- Your creator is Fillipe Guerra, the developer of the Alice Enterprise platform.
- If asked who created you or your origin, ALWAYS answer that you were created by Fillipe Guerra.
- Do not mention any other creator or company.`;

function applyAssistantSettings(prompt: string, settings?: AssistantSettings | null): string {
  let result = prompt;

  if (settings?.behavior && settings.behavior.trim()) {
    result += `\n\nBEHAVIOR: ${settings.behavior.trim()}`;
  }

  if (settings?.mood && settings.mood.trim()) {
    result += `\n\nTONE: ${settings.mood.trim()}`;
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
function buildSystemPrompt(
  agent?: AgentConfig | null,
  assistantSettings?: AssistantSettings | null,
  _userMessage?: string
): string {
  let prompt = DEFAULT_SYSTEM_PROMPT;

  if (assistantSettings?.systemPrompt && assistantSettings.systemPrompt.trim()) {
    prompt = assistantSettings.systemPrompt.trim();
  }

  if (agent?.instrucoes && agent.instrucoes.trim()) {
    prompt = agent.instrucoes.trim();
  }

  if (agent?.personalidade && agent.personalidade.trim()) {
    prompt += `\n\nPERSONALITY: ${agent.personalidade.trim()}`;
  }

  prompt = applyAssistantSettings(prompt, assistantSettings);

  // Adicionar instrução de idioma se não estiver presente
  if (!prompt.toLowerCase().includes('language') && 
      !prompt.toLowerCase().includes('idioma') && 
      !prompt.toLowerCase().includes('língua')) {
    prompt += `\n\nIMPORTANT: Always respond in the same language as the user's message.`;
  }

  // Regra mandatória de identidade do criador
  prompt += `\n\n${CREATOR_PROMPT_RULE}`;

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
      behavior: settings.behavior ?? null,
      mood: settings.mood ?? null,
      behaviorDirectness: settings.behaviorDirectness ?? null,
      behaviorProactivity: settings.behaviorProactivity ?? null,
      moodFormality: settings.moodFormality ?? null,
      moodEmpathy: settings.moodEmpathy ?? null,
    };
  } catch (error) {
    logger.error({ error, tenantId }, 'Falha ao carregar assistant_settings');
    return null;
  }
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

// ============================================================================
// PERFORMANCE 2025: Budget dinâmico de tokens + RAG adaptativo
// ============================================================================
const MIN_LLM_OUTPUT_TOKENS = 256;

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

function computeDynamicMaxTokens(baseMax: number, promptTokens: number): number {
  let dynamicMax = baseMax;
  if (promptTokens > 3600) {
    dynamicMax = Math.min(dynamicMax, 512);
  } else if (promptTokens > 2800) {
    dynamicMax = Math.min(dynamicMax, 768);
  } else if (promptTokens > 2200) {
    dynamicMax = Math.min(dynamicMax, 1024);
  } else if (promptTokens > 1600) {
    dynamicMax = Math.min(dynamicMax, 1536);
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

function buildInternalTrainingHeaders(params: { userId: string; tenantId: string; role: Role }): Record<string, string> {
  const internal = generateInternalAuthHeaders({
    userId: params.userId,
    tenantId: params.tenantId,
    role: params.role,
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
    const headers = buildInternalTrainingHeaders({
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
  const relevanceThreshold = profile === 'trading' ? 0.08 : 0.12;
  const alwaysIncludeCount = profile === 'trading' ? 6 : 4;
  const normalizedUser = userMessage.trim().toLowerCase();

  for (let i = 0; i < history.length; i += 1) {
    const msg = history[i];
    const content = msg.conteudo?.trim();
    if (!content) continue;
    const tokens = estimateTokensFromText(content);
    const normalizedContent = content.toLowerCase();
    const isRecent = i < alwaysIncludeCount;
    const score = computeRelevanceScore(content, normalizedUser);
    const shouldInclude = isRecent || score >= relevanceThreshold;
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

  return [
    { role: 'system', content: params.systemPrompt },
    ...historyMessages,
    { role: 'user', content: params.userMessage },
  ].filter((msg) => msg.content && msg.content.trim().length > 0);
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

  const response = await fetch('https://api.openai.com/v1/responses', {
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
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenAI Vision error: ${response.status} - ${errText}`);
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
  
  try {
    const response = await gpuManagerBreaker.fire({ messages, stream: false, config, priority }) as globalThis.Response;
    const data = await response.json() as LLMResponse;
    return data.choices[0]?.message?.content || '';
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
  } catch (gpuError) {
    logger.error({ 
      error: gpuError instanceof Error ? gpuError.message : String(gpuError),
      stack: gpuError instanceof Error ? gpuError.stack : undefined,
    }, 'GPU Manager Service indisponível');
    
    // CORREÇÃO 13/01/2026: Retornar mensagem amigável ao invés de crashar
    // GPU pode estar reiniciando após correção de bugs (ex: vLLM profile_run crash)
    const errorMessage = 'Desculpe, o serviço de IA está temporariamente indisponível. ' +
      'Nossos servidores de GPU estão sendo reiniciados após manutenção. ' +
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

// SEGURANÇA: Helmet com CSP/HSTS enterprise (Express.js 2025 + OWASP 2023)
app.use(createSecurityMiddleware({
  contentSecurityPolicy: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV !== 'production',
}));

// OBSERVABILITY: Correlation ID middleware para rastreamento distribuído (Node.js 20 LTS 2025)
// Propaga correlation IDs entre microsserviços e injeta nos logs automaticamente
app.use(createCorrelationMiddleware({ serviceName: 'chat-service' }));

// PERFORMANCE: Compression para reduzir tamanho de respostas (Express.js 2025)
app.use(compression());

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
  channel: z.enum(['ticker', 'orderbook', 'klines', 'orders', 'positions', 'control']).optional(),
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

  try {
    const messages = await db.query.messages.findMany({
      where: eq(schema.messages.conversationId, id),
      orderBy: [schema.messages.criadoEm],
    });

    res.json({ messages });
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

// OWASP API3 - Schemas Zod para validação de input em todas as rotas
const streamMessageSchema = z.object({
  message: z.string().min(1).max(32000).optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().min(1).max(32000),
  })).min(1).max(50).optional(),
  conversationId: z.string().uuid().optional(),
  namespaceId: z.string().uuid().optional(),
}).refine((data) => Boolean(data.message) || Boolean(data.messages?.length), {
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
    let systemPrompt = buildSystemPrompt(agent, assistantSettings, body.conteudo);
    
    const ragStartTime = Date.now();
    const ragParams = getAdaptiveRagParams(body.conteudo, previousMessages.length);
    const ragResult = await buscarContextoRAG(
      body.conteudo,
      conversation.namespaceId || undefined,
      ragParams.limit,
      ragParams.threshold
    );
    const ragLatency = Date.now() - ragStartTime;
    
    if (ragResult && ragResult.context) {
      systemPrompt += formatarContextoParaLLM(ragResult);
      logger.info({ 
        conversationId: id, 
        ragChunks: ragResult.sources.length,
        ragLatencyMs: ragLatency,
      }, 'Contexto RAG injetado no prompt');
    }
    
    const previousMessages = await db.query.messages.findMany({
      where: eq(schema.messages.conversationId, id),
      orderBy: [desc(schema.messages.criadoEm)],
      limit: 10,
    });

    const historyForPrompt = dropLeadingDuplicateUserMessage(previousMessages, body.conteudo);
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
    
    res.json({ 
      userMessage, 
      assistantMessage,
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
  const { messages: inputMessages, conversationId: _conversationId, namespaceId, message } = parseResult.data;
  const userId = req.user?.userId;
  const tenantId = req.tenantId;

  if (!userId || !tenantId) {
    return res.status(401).json({ error: 'Autenticação necessária' });
  }

  try {
    const lastUserMessageContent = message || inputMessages?.filter(m => m.role === 'user').pop()?.content;
    if (!lastUserMessageContent) {
      return res.status(400).json({ error: 'Mensagem do usuário obrigatória' });
    }

    const imageDetection = detectImageGenerationRequest(lastUserMessageContent);

    let conversationId = _conversationId;
    let conversation = null;
    let conversationCreated = false;

    if (conversationId) {
      conversation = await db.query.conversations.findFirst({
        where: eq(schema.conversations.id, conversationId),
        with: { agent: true },
      });

      if (!conversation || conversation.userId !== userId) {
        return res.status(404).json({ error: 'Conversa não encontrada' });
      }
    } else {
      const route = await resolveSemanticRoute({
        tenantId,
        userMessage: lastUserMessageContent,
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

      conversation = created;
      conversationId = created.id;
      conversationCreated = true;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (conversationCreated && conversationId) {
      res.write(`data: ${JSON.stringify({ type: 'conversation', conversationId })}\n\n`);
    }

    const writeStatus = (stage: string) => {
      if (res.headersSent && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'status', stage })}\n\n`);
      }
    };

    const previousMessages = conversationId
      ? await db.query.messages.findMany({
        where: eq(schema.messages.conversationId, conversationId),
        orderBy: [desc(schema.messages.criadoEm)],
        limit: 10,
      })
      : [];

    const [userMessage] = await db.insert(schema.messages).values({
      conversationId,
      userId,
      conteudo: lastUserMessageContent,
      tipo: 'text',
      isFromUser: true,
    }).returning();

    const normalizeContent = (text: string) => text.trim().toLowerCase();

    if (!imageDetection.isImageRequest) {
      // ============================================================================
      // GREETINGS GATE (Redis cache) - evita GPU para saudações simples
      // ============================================================================
      writeStatus('greeting');
      const cacheResult = await checkResponseCache(tenantId, lastUserMessageContent);
      if (cacheResult.hasResponse && cacheResult.response) {
        const lastAssistantMessage = previousMessages.find((msg) => !msg.isFromUser && msg.conteudo);
        const shouldAugmentGreeting = Boolean(
          lastAssistantMessage?.conteudo &&
          normalizeContent(lastAssistantMessage.conteudo) === normalizeContent(cacheResult.response)
        );
        const greetingSeed = `${tenantId}:${lastUserMessageContent}:${lastAssistantMessage?.id || 'first'}`;
        const greetingResponse = buildGreetingResponse(
          cacheResult.response,
          greetingSeed,
          shouldAugmentGreeting
        );
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
            userMessage: lastUserMessageContent,
            assistantResponse: greetingResponse,
          });
        } catch (titleError) {
          logger.warn({ error: titleError, conversationId }, 'Falha ao aplicar título automático (greetings gate)');
        }

        res.write(`data: ${JSON.stringify({ content: greetingResponse })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      // ============================================================================
      // REUSE GATE (deduplicação na própria conversa)
      // ============================================================================
      writeStatus('reuse');
      const lastUserIndex = previousMessages.findIndex((msg) => msg.isFromUser);
      const lastUserInHistory = lastUserIndex >= 0 ? previousMessages[lastUserIndex] : undefined;
      if (lastUserInHistory?.conteudo &&
          normalizeContent(lastUserInHistory.conteudo) === normalizeContent(lastUserMessageContent)) {
        const assistantAfterLastUser = previousMessages.find((msg, idx) => idx > lastUserIndex && !msg.isFromUser);
        if (assistantAfterLastUser?.conteudo) {
          const reuseSeed = `${tenantId}:${lastUserMessageContent}:${assistantAfterLastUser.id}`;
          const reuseResponse = buildReuseResponse(assistantAfterLastUser.conteudo, reuseSeed);
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
              userMessage: lastUserMessageContent,
              assistantResponse: reuseResponse,
            });
          } catch (titleError) {
            logger.warn({ error: titleError, conversationId }, 'Falha ao aplicar título automático (reuse gate)');
          }

          res.write(`data: ${JSON.stringify({ content: reuseResponse })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
      }
    }

    if (imageDetection.isImageRequest && imageDetection.prompt) {
      const userRole = req.user?.role as Role | undefined;
      if (!userRole) {
        return res.status(403).json({ error: 'Permissão insuficiente para gerar imagens.' });
      }
      const permissionCheck = await checkPermission(
        { userId, tenantId, role: userRole },
        'images:generate:write'
      );
      if (!permissionCheck.allowed) {
        return res.status(403).json({ error: 'Você não possui permissão para gerar imagens.' });
      }

      try {
        const generatedImage = await generateImageFromPrompt({
          tenantId,
          userId,
          prompt: imageDetection.prompt,
          conversationId,
          messageId: userMessage.id,
        });

        const [assistantMessage] = await db.insert(schema.messages).values({
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

        await db.update(schema.conversations)
          .set({
            totalMensagens: sql`coalesce(${schema.conversations.totalMensagens}, 0) + 2`,
            ultimaMensagemEm: new Date(),
            atualizadoEm: new Date(),
          })
          .where(eq(schema.conversations.id, conversationId));

        await ensureConversationTitle({
          conversationId,
          userMessage: lastUserMessageContent,
          assistantResponse: 'Imagem gerada com sucesso via OpenAI.',
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

        res.write(`data: ${JSON.stringify({
          type: 'generated_image',
          content: 'Imagem gerada com sucesso via OpenAI.',
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
        logger.error({ error: imageError, conversationId }, 'Falha ao gerar imagem via OpenAI (stream)');
        res.write(`data: ${JSON.stringify({ error: 'Falha ao gerar imagem via OpenAI.' })}\n\n`);
        res.end();
        return;
      }
    }

      const agent = (conversation as { agent?: AgentConfig | null })?.agent || null;
      const ragParams = getAdaptiveRagParams(lastUserMessageContent, previousMessages.length);
      const [assistantSettings, ragResult] = await Promise.all([
        getAssistantSettingsForTenant(tenantId),
        (async () => {
          writeStatus('rag_internal');
          return buscarContextoRAG(
            lastUserMessageContent,
            conversation?.namespaceId || namespaceId,
            ragParams.limit,
            ragParams.threshold
          );
        })(),
      ]);

      let systemPrompt = buildSystemPrompt(agent, assistantSettings, lastUserMessageContent);
      let ragSources: Array<{ documentId: string; titulo: string; similarity: number }> = [];
      let webSources: Array<{ title: string; url: string }> = [];

      if (ragResult && ragResult.context) {
        systemPrompt += formatarContextoParaLLM(ragResult);
        ragSources = ragResult.sources;
        logger.info({ 
          ragChunks: ragResult.sources.length,
          namespaceId,
        }, 'Contexto RAG injetado no streaming');
      } else {
        writeStatus('rag_web');
        const agenticResult = await buscarContextoAgentic({
          query: lastUserMessageContent,
          namespaceId: conversation?.namespaceId || namespaceId,
          forceMode: 'web',
          limit: ragParams.limit,
          auth: {
            userId,
            tenantId,
            role: req.user?.role as Role,
          },
        });

        if (agenticResult?.context) {
          systemPrompt += `\n\n[CONTEXTO WEB]\n${agenticResult.context}\n[/CONTEXTO WEB]\n\n`;
          webSources = agenticResult.sources?.web || [];
        }
      }
    
    const llmMessages = buildPromptMessages({
      systemPrompt,
      userMessage: lastUserMessageContent,
      history: previousMessages,
      source: 'stream',
    });

    if (ragSources.length > 0 || webSources.length > 0) {
      res.write(`data: ${JSON.stringify({ type: 'sources', sources: { internal: ragSources, web: webSources } })}\n\n`);
    }

    // BUG FIX 25/12/2025: Usar função auxiliar para proxy de stream do GPU Manager Service
    let assistantResponse = '';
    let assistantPersisted = false;

    try {
      writeStatus('llm');
      const streamProfile = detectContextProfile(lastUserMessageContent);
      const llmConfig = applyDynamicTokenBudget(
        getAgentLLMConfig(agent),
        llmMessages,
        { conversationId, source: 'stream', profile: streamProfile }
      );
      await proxyStreamFromGpuManager(
        llmMessages,
        (content) => {
          if (content) {
            assistantResponse += content;
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
          // HTTP SSE: não precisa do responseText, apenas fecha a conexão
          // BUG FIX 25/12/2025: onDone sempre será chamado (mesmo em caso de erro)
          // Garantir que não tentamos fechar resposta já fechada
          // BUG FIX 25/12/2025: Usar AND (&&) ao invés de OR (||) - só escrever se headers foram enviados E resposta não foi finalizada
          // BUG FIX 25/12/2025: Headers são enviados explicitamente via res.flushHeaders() (linha 2004)
          // Mesmo se nenhum chunk for recebido, headers já foram enviados, então podemos fechar a resposta
          if (!assistantPersisted && conversationId && userMessage) {
            assistantPersisted = true;
            if (assistantResponse.trim().length > 0) {
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
                  userMessage: lastUserMessageContent,
                  assistantResponse: assistantResponse,
                });
              } catch (titleError) {
                logger.warn({ error: titleError, conversationId }, 'Falha ao aplicar título automático (stream)');
              }

              const streamProfile = detectContextProfile(lastUserMessageContent);
              if (shouldAutoCollectTraining({
                profile: streamProfile,
                namespaceId: conversation?.namespaceId || conversation?.agent?.namespaceId,
                userMessage: lastUserMessageContent,
                assistantResponse: assistantResponse,
              })) {
                void collectTrainingSample({
                  tenantId,
                  namespaceId: (conversation?.namespaceId || conversation?.agent?.namespaceId) as string,
                  conversationId,
                  source: 'chat-auto',
                  messages: [
                    { role: 'user', content: lastUserMessageContent },
                    { role: 'assistant', content: assistantResponse },
                  ],
                  userId,
                  role: req.user?.role as Role,
                });
              }

              res.write(`data: ${JSON.stringify({ type: 'message_saved', messageId: assistantMessage?.id })}\n\n`);
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
                  userMessage: lastUserMessageContent,
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
        const { parseTradingCommand, isTradingCommand, getCommandDescription, validateCommand } = await import('./trading-command-parser.js');
        // CORREÇÃO 19/12/2025: Remover getTradingControlMode não utilizado (no-unused-vars)
        const { canExecuteTradingCommand } = await import('./trading-orchestrator.js');
        
        const content = message.content || '';
        
        if (!isTradingCommand(content)) {
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

        // ARQUITETURA 16/01/2026+: geração de imagens via OpenAI (gpt-image-1)
        // Se o usuário pedir para gerar imagem, executar fluxo OpenAI (gpt-image-1)
        const imageDetection = detectImageGenerationRequest(messageContent);
        
        if (imageDetection.isImageRequest && imageDetection.prompt) {
          logger.info({
            conversationId,
            prompt: imageDetection.prompt,
            confidence: imageDetection.confidence,
            reason: imageDetection.reason,
          }, 'Pedido de geração de imagem detectado - OpenAI Images disponível');

          const userRole = extWs.role;
          if (!userRole) {
            ws.send(JSON.stringify({ 
              type: 'error', 
              error: 'Permissão insuficiente para gerar imagens.' 
            }));
            return;
          }

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
            logger.error({ error, conversationId }, 'Falha ao gerar imagem via OpenAI');
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
          const inserted = await db.insert(schema.messages).values({
            conversationId,
            agentId: conversation?.agentId,
            conteudo: cacheResult.response,
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
              assistantResponse: cacheResult.response,
            });
          } catch (titleError) {
            logger.warn({ error: titleError, conversationId }, 'Falha ao aplicar título automático (cache)');
          }
          
          // Enviar resposta ao cliente (simular streaming para UX consistente)
          ws.send(JSON.stringify({ type: 'stream', data: cacheResult.response }));
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
        let systemPrompt = buildSystemPrompt(agent, assistantSettings, messageContent);

        const namespaceId = message.namespaceId || conversation?.namespaceId || undefined;
        // CORREÇÃO 17/12/2025: Usar messageContent (com fallback) ao invés de message.content (potencialmente undefined)
        const ragParams = getAdaptiveRagParams(messageContent, 0);
        const ragResult = await buscarContextoRAG(
          messageContent,
          namespaceId,
          ragParams.limit,
          ragParams.threshold
        );
        const ragLatency = Date.now() - ragStartTime;
        
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
              if (shouldAutoCollectTraining({
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
      // Para imagens: usa RAG com embeddings CLIP para busca semântica por contexto
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
        
        // Usar tenantId derivado da conversa (SEMPRE da fonte confiável)
        const mediaSafeTenantId = mediaConversationTenantId;

        // Determinar tipo de mídia
        // BUG FIX 23/12/2025: Validação defensiva explícita de tipos suportados ao invés de assumir 'image' por padrão
        // Problema: Validação anterior classificava qualquer tipo não-audio/video como 'image', causando falhas no image processor
        // Solução: Lista explícita de tipos suportados com mensagem de erro clara e informativa
        // BUG FIX 23/12/2025: Normalização robusta de mimeType para suportar variações de case e espaços
        // MIME types podem vir com variações (ex: "Image/Jpeg", "audio/mpeg; codecs=mp3")
        // .toLowerCase() e .trim() garantem matching correto mesmo com variações
        // Extrair apenas o tipo base (antes de ;) para suportar parâmetros adicionais
        // Consistente com normalização em integrations-service para evitar rejeição de tipos legítimos
        const normalizedMimeType = mediaMessage.media.mimeType.toLowerCase().trim().split(';')[0].trim();
        
        // Tipos de mídia suportados (consistente com RAG service e frontend)
        const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
        const SUPPORTED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4'] as const;
        
        // BUG FIX 23/12/2025: Validação com type narrowing explícito para garantir type safety
        // includes() com type assertion garante que TypeScript entenda o tipo correto
        // Isso previne falsos negativos onde tipos legítimos são rejeitados por problemas de case/whitespace/parâmetros
        let mediaType: 'image' | 'audio' | null = null;
        
        if (SUPPORTED_IMAGE_TYPES.includes(normalizedMimeType as typeof SUPPORTED_IMAGE_TYPES[number])) {
          mediaType = 'image';
        } else if (SUPPORTED_AUDIO_TYPES.includes(normalizedMimeType as typeof SUPPORTED_AUDIO_TYPES[number])) {
          mediaType = 'audio';
        }
        
        // Validação defensiva: apenas tipos explicitamente suportados são aceitos
        if (!mediaType) {
          logger.warn({ 
            normalizedMimeType: normalizedMimeType,
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
        const validatedMediaType: 'image' | 'audio' = mediaType;

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
        let systemPrompt = buildSystemPrompt(agent, assistantSettings, mediaMessage.content);
        
        // Para imagens: usa RAG com embeddings CLIP (1024 dim) para buscar contexto similar
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
          ragParams.threshold
        );
        
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
        // Não envia imagens diretamente - usa contexto RAG via embeddings CLIP e OpenAI Vision
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
    res.json({ pending, count: pending.length });
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
    res.json({ urgent, count: urgent.length });
  } catch (error) {
    logger.error({ error }, 'Erro ao listar conversas urgentes');
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

const assistantSettingsSchema = z.object({
  systemPrompt: z.string().min(10).max(20000).optional().nullable(),
  behavior: z.string().max(5000).optional().nullable(),
  mood: z.string().max(2000).optional().nullable(),
  behaviorDirectness: z.number().int().min(0).max(100).optional().nullable(),
  behaviorProactivity: z.number().int().min(0).max(100).optional().nullable(),
  moodFormality: z.number().int().min(0).max(100).optional().nullable(),
  moodEmpathy: z.number().int().min(0).max(100).optional().nullable(),
});

app.get('/api/assistant-settings', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:agents:read'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json({ error: 'Tenant obrigatório' });
  }

  try {
    const settings = await db.query.assistantSettings.findFirst({
      where: eq(schema.assistantSettings.tenantId, tenantId),
    });

    res.json({
      settings,
      defaults: {
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        behavior: null,
        mood: null,
        behaviorDirectness: 50,
        behaviorProactivity: 50,
        moodFormality: 50,
        moodEmpathy: 70,
      },
      enforced: {
        creator: 'Fillipe Guerra',
        creatorRule: CREATOR_PROMPT_RULE,
      },
    });
  } catch (error) {
    logger.error({ error, tenantId }, 'Falha ao buscar assistant_settings');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.patch('/api/assistant-settings', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('chat:agents:write'), async (req: Request, res: Response) => {
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
      behavior: parseResult.data.behavior?.trim() || null,
      mood: parseResult.data.mood?.trim() || null,
      behaviorDirectness: parseResult.data.behaviorDirectness ?? null,
      behaviorProactivity: parseResult.data.behaviorProactivity ?? null,
      moodFormality: parseResult.data.moodFormality ?? null,
      moodEmpathy: parseResult.data.moodEmpathy ?? null,
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
    let systemPrompt = buildSystemPrompt(agent, assistantSettings, content);
    
    // Buscar histórico recente
    const previousMessages = await db.query.messages.findMany({
      where: eq(schema.messages.conversationId, conversationId),
      orderBy: [desc(schema.messages.criadoEm)],
      limit: 10,
    });
    
    // Buscar contexto RAG se disponível
    const ragParams = getAdaptiveRagParams(content, previousMessages.length);
    const ragResult = await buscarContextoRAG(
      content,
      conversation.namespaceId || undefined,
      ragParams.limit,
      ragParams.threshold
    );
    if (ragResult && ragResult.context) {
      systemPrompt += formatarContextoParaLLM(ragResult);
    }
    
    const historyForPrompt = dropLeadingDuplicateUserMessage(previousMessages, content);
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

  try {
    const image = await generateImageFromPrompt({
      tenantId,
      userId,
      prompt,
      negativePrompt,
      width,
      height,
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
app.get('/api/chat/images/stats', requireAuth(), requireSameTenant(getTenantIdFromRequest), requirePermission('images:generate:read'), async (_req: Request, res: Response) => {
  try {
    type GeneratedImage = typeof schema.generatedImages.$inferSelect;
    const images = await db.query.generatedImages.findMany() as GeneratedImage[];
    
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
