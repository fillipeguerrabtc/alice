import express from 'express';
import type { Request, Response } from 'express';
import Stripe from 'stripe';
import cors from 'cors';
// helmet aplicado via createSecurityMiddleware de @alice/shared-utils
import compression from 'compression';
// rateLimit via createRateLimiter de @alice/shared-utils
// CircuitBreaker via createCircuitBreaker de @alice/shared-utils
// CORREÇÃO PR#107 (10/01/2026): Usar prefixo 'node:' para módulos Node.js built-in
// REF: https://nodejs.org/api/esm.html#node-imports
// REF: Best Practices Node.js ESM 2025 - evita conflitos com pacotes npm de mesmo nome
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { createLogger } from '@alice/logger';
import { 
  createCorrelationMiddleware, 
  createSecurityMiddleware,
  createRateLimiter,
  createErrorHandler,
  createNotFoundHandler,
  requirePermission, 
  extractAuthContext,
  generateInternalAuthHeaders,
  initFeatureFlags,
  createAlicePrometheus,
  initRbacPrometheusMetrics,
  instrumentCircuitBreaker,
  createCircuitBreaker,
  CIRCUIT_BREAKER_PRESETS,
  registerShutdownCallback,
  ShutdownPriority,
  setupSwaggerUI,
  INTEGRATIONS_SERVICE_TAGS,
  setPermissionResolver,
  PERMISSION_MAP,
  // CORREÇÃO PR#107 (10/01/2026): Middleware de sessão HTTP para autenticação
  createSessionAuthMiddleware,
  initializeSessionAuthCache,
  initializeRedisCache,
  Gauge as PromGauge,
  Counter as PromCounter,
} from '@alice/shared-utils';
import type { AuthContext } from '@alice/shared-utils';
import { integrationsServicePaths, integrationsServiceSchemas } from './openapi-specs.js';
import { loadConfig, integrationsServiceConfigSchema } from '@alice/config';
import { getDatabase, schema, closeDatabasePool, isPoolHealthy, createDrizzleFeatureFlagStorage, getPool } from '@alice/database';
import { eq, desc, sql, and } from '@alice/database';
import { z } from 'zod';
import { wiseService } from './wiseService.js';
import { isWiseConfigured, getSandboxStatus, getProfileIdSafe, getWiseCircuitBreakerStatus, validateWiseWebhook } from './wiseClient.js';
import { initWiseSyncService } from './wiseSyncService.js';
import * as kucoinClient from './kucoinClient.js';
import * as kucoinService from './kucoinService.js';
import {
  closeWebSocketClients as closeKucoinWebSocketClients,
  getPrivateWebSocketClient,
  getPublicWebSocketClient,
  initializeWebSocketClients as initializeKucoinWebSocketClients,
  isWebSocketConfigured as isKucoinWebSocketConfigured,
} from './kucoinWebSocket.js';
import { initializeBroadcast, getPublisher, closeBroadcast } from './tradingBroadcast.js';
import { sendKucoinErrorResponse } from './kucoin-error-mapper.js';
import * as technicalIndicators from './technical-indicators.js';

const logger = createLogger('integrations-service');
const config = loadConfig(integrationsServiceConfigSchema);

const GH_API_URL = config.GH_API_URL?.trim() || 'https://api.github.com';
const GH_REPO = config.GH_REPO?.trim();
const GH_PAT = config.GH_PAT?.trim();

const app = express();
setPermissionResolver(async (auth: AuthContext) => {
  const db = getDatabase();
  let customRoleId = auth.customRoleId;
  if (!customRoleId) {
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, auth.userId),
      columns: { customRoleId: true },
    });
    customRoleId = user?.customRoleId ?? undefined;
  }
  if (customRoleId) {
    const activeRole = await db.query.customRoles.findFirst({
      where: and(
        eq(schema.customRoles.id, customRoleId),
        eq(schema.customRoles.ativo, true)
      ),
      columns: { id: true },
    });
    if (!activeRole) {
      customRoleId = undefined;
    }
  }
  const isAdminRole = auth.role === 'admin' || auth.role === 'super_admin';
  const rolePermissions = isAdminRole
    ? await db.query.permissions.findMany({ columns: { codigo: true } })
    : await db.query.rolePermissions.findMany({
      where: eq(schema.rolePermissions.role, auth.role),
      with: { permission: true },
    });
  const customRolePermissions = customRoleId
    ? await db.query.customRolePermissions.findMany({
      where: eq(schema.customRolePermissions.customRoleId, customRoleId),
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
    .filter(([, roles]) => roles.includes(auth.role))
    .map(([code]) => code);
  const resolved = new Set<string>([...dbPermissions, ...customPermissions, ...basePermissions]);
  if (isAdminRole) {
    resolved.add('admin:alice_core:write');
  }
  return Array.from(resolved);
});

// ============================================================================
// PROMETHEUS: Instrumentação de métricas (Regra 16 - Observability Enterprise)
// ============================================================================
const { metrics, metricsRouter, httpMetricsMiddleware } = createAlicePrometheus({
  serviceName: 'integrations-service',
  collectDefaultMetrics: true,
});

// ============================================================================
// WS5: Métricas operacionais - KuCoin WebSocket
// ============================================================================
// Requisitos:
// - Não usar WS como fonte de verdade de dados de negócio (market data continua via REST)
// - Expor estado para observabilidade (degraded quando WS está down/reconnecting)
// - Sem alta cardinalidade (somente label channel=public|private)
type KucoinWsState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

const kucoinWsStateGauge = new PromGauge({
  name: 'alice_kucoin_ws_state',
  help: 'Estado do KuCoin WebSocket (0=disconnected, 0.25=connecting, 0.5=reconnecting, 1=connected)',
  labelNames: ['channel'] as const,
  registers: [metrics.registry],
});

const kucoinWsConnectedGauge = new PromGauge({
  name: 'alice_kucoin_ws_connected',
  help: 'KuCoin WebSocket conectado (1=connected, 0=not connected)',
  labelNames: ['channel'] as const,
  registers: [metrics.registry],
});

const kucoinWsReconnectsTotal = new PromCounter({
  name: 'alice_kucoin_ws_reconnects_total',
  help: 'Total de reconexões do KuCoin WebSocket',
  labelNames: ['channel'] as const,
  registers: [metrics.registry],
});

const kucoinWsErrorsTotal = new PromCounter({
  name: 'alice_kucoin_ws_errors_total',
  help: 'Total de erros emitidos pelo KuCoin WebSocket',
  labelNames: ['channel'] as const,
  registers: [metrics.registry],
});

// Tenant alvo para eventos privados de KuCoin via WS (ordens/posição/balance).
// Evita vazamento multi-tenant quando há apenas uma integração configurada.
const KUCOIN_TENANT_ID = process.env.KUCOIN_TENANT_ID?.trim()
  || process.env.TRADING_TENANT_ID?.trim()
  || null;

function mapKucoinWsStateToNumber(state: KucoinWsState): number {
  switch (state) {
    case 'disconnected':
      return 0;
    case 'connecting':
      return 0.25;
    case 'reconnecting':
      return 0.5;
    case 'connected':
      return 1;
    default:
      return 0;
  }
}

let kucoinWsMetricsWired = false;

function wireKucoinWebSocketMetrics(opts: {
  publicWs: { getState(): KucoinWsState; on(event: 'stateChange', cb: (s: KucoinWsState) => void): void; on(event: 'error', cb: (e: Error) => void): void };
  privateWs?: { getState(): KucoinWsState; on(event: 'stateChange', cb: (s: KucoinWsState) => void): void; on(event: 'error', cb: (e: Error) => void): void } | null;
  privateEnabled: boolean;
}): void {
  if (kucoinWsMetricsWired) return;
  kucoinWsMetricsWired = true;

  const apply = (channel: 'public' | 'private', state: KucoinWsState) => {
    kucoinWsStateGauge.set({ channel }, mapKucoinWsStateToNumber(state));
    kucoinWsConnectedGauge.set({ channel }, state === 'connected' ? 1 : 0);
    if (state === 'reconnecting') {
      kucoinWsReconnectsTotal.inc({ channel }, 1);
    }
  };

  // Public WS (sempre)
  apply('public', opts.publicWs.getState());
  opts.publicWs.on('stateChange', (s) => apply('public', s));
  opts.publicWs.on('error', () => kucoinWsErrorsTotal.inc({ channel: 'public' }, 1));

  // Private WS (quando credenciais existem)
  if (opts.privateEnabled && opts.privateWs) {
    apply('private', opts.privateWs.getState());
    opts.privateWs.on('stateChange', (s) => apply('private', s));
    opts.privateWs.on('error', () => kucoinWsErrorsTotal.inc({ channel: 'private' }, 1));
  } else {
    // Explicitar estado quando desabilitado (evita "No data")
    kucoinWsStateGauge.set({ channel: 'private' }, 0);
    kucoinWsConnectedGauge.set({ channel: 'private' }, 0);
  }
}

// Inicializar métricas RBAC (Regra 16 - Observability Enterprise)
initRbacPrometheusMetrics(metrics.rbac);
logger.info('Métricas RBAC Prometheus inicializadas no integrations-service');

// Endpoint /metrics para Prometheus scraper (antes de outros middlewares)
app.use(metricsRouter);

// ============================================================================
// OPENAPI/SWAGGER: Documentação da API (OWASP API9)
// ============================================================================
setupSwaggerUI(app, {
  serviceName: 'integrations-service',
  version: '1.0.0',
  description: 'Serviço de integrações: Stripe, Wise, ERPNext, Twilio, KuCoin Futures.',
  port: config.PORT ?? 3005,
  tags: INTEGRATIONS_SERVICE_TAGS,
  paths: integrationsServicePaths,
  schemas: integrationsServiceSchemas,
});
logger.info('Swagger UI configurado em /api/docs');

// Middleware para coletar métricas HTTP automaticamente
app.use(httpMetricsMiddleware);

// SEGURANÇA: Desabilitar X-Powered-By header (Express.js 2025 + OWASP API8)
app.disable('x-powered-by');

// SEGURANÇA: Trust proxy = 1 para confiar apenas no primeiro proxy (Traefik)
// Evita bypass de rate limiting (express-rate-limit 2025 best practice)
app.set('trust proxy', 1);

// STRIPE API VERSION: Versão estável atual (Novembro 2025)
// Referência: https://docs.stripe.com/changelog
const STRIPE_API_VERSION = '2024-12-18.acacia' as Stripe.LatestApiVersion;

// =============================================================================
// GMAIL SMTP - Emails Transacionais (30/12/2025)
// =============================================================================
// Usa Gmail SMTP com App Password para enviar:
// - Comprovantes de vendas e pagamentos
// - Notificações de pedidos e entregas
// - Promoções e campanhas de marketing
// - Alertas e notificações do sistema
//
// Ref: https://support.google.com/accounts/answer/185833
// Documentação PT-BR (Regra 10 CLAUDE.md)
// =============================================================================
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const isProduction = config.NODE_ENV === 'production';

// Transporter do Nodemailer para Gmail SMTP
// Usando tipo genérico pois nodemailer.Transporter tem tipagem complexa
let emailTransporter: nodemailer.Transporter | null = null;

if (GMAIL_USER && GMAIL_APP_PASSWORD) {
  emailTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // TLS (não SSL)
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
    // Configurações enterprise para alta disponibilidade
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 10, // 10 emails por segundo (limite Gmail)
  });

  // Verificar conexão SMTP no startup
  // NOTA: verify() retorna Promise, usamos .then() para não bloquear startup
  emailTransporter.verify()
    .then(() => {
      logger.info({ user: GMAIL_USER }, 'Gmail SMTP conectado com sucesso');
    })
    .catch((error: unknown) => {
      logger.error({ error, user: GMAIL_USER }, 'Falha ao conectar Gmail SMTP');
      if (isProduction) {
        // Em produção, email é crítico para comprovantes
        logger.error('Gmail SMTP é obrigatório em produção (Regra 6 - fail-fast)');
        process.exit(1);
      }
    });
} else {
  if (isProduction) {
    logger.error('GMAIL_USER e GMAIL_APP_PASSWORD são obrigatórios em produção (Regra 6 - fail-fast)');
    process.exit(1);
  }
  logger.warn('Gmail SMTP não configurado - emails desabilitados em desenvolvimento');
}

let stripe: Stripe | null = null;
if (config.STRIPE_SECRET_KEY) {
  stripe = new Stripe(config.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
  });
  logger.info({ apiVersion: STRIPE_API_VERSION }, 'Cliente Stripe inicializado');
}

// Circuit Breaker para chamadas ao ERPNext (Best Practices 2025)
// Usa CIRCUIT_BREAKER_PRESETS centralizado (Regra 2 - Não Duplicar)

// RESILIÊNCIA: Timeout para chamadas externas (Best Practices 2025)
const EXTERNAL_API_TIMEOUT_MS = 8000;

const erpNextBreaker = createCircuitBreaker(async (options: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}) => {
  // RESILIÊNCIA: AbortController com timeout para evitar chamadas penduradas
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);
  
  try {
    const response = await fetch(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`ERPNext request failed: ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}, {
  name: 'erpnext-main',
  ...CIRCUIT_BREAKER_PRESETS.erpnextAPI,
});

// Instrumentar circuit breaker com métricas Prometheus
// Type assertion necessária: Opossum CircuitBreaker tem tipos de eventos mais específicos
instrumentCircuitBreaker(metrics, 'erpnext', erpNextBreaker as unknown as Parameters<typeof instrumentCircuitBreaker>[2]);

// Sincronizar cliente/pedido com ERPNext (com Circuit Breaker)
// Fluxo correto ERPNext: Customer → Sales Order → Sales Invoice → Payment Entry com referência
async function syncToERPNext(
  type: 'customer' | 'sales_order' | 'sales_invoice' | 'payment' | 'payment_from_invoice', 
  data: Record<string, unknown>
) {
  if (!config.ERPNEXT_URL || !config.ERPNEXT_API_KEY || !config.ERPNEXT_API_SECRET) {
    logger.warn('ERPNext não configurado, sincronização ignorada');
    return null;
  }

  const doctypes: Record<string, string> = {
    customer: 'Customer',
    sales_order: 'Sales Order',
    sales_invoice: 'Sales Invoice',
    payment: 'Payment Entry',
    payment_from_invoice: 'Payment Entry', // Usado quando temos referência a invoice
  };

  try {
    // Para Payment Entry com referência a invoice, usar API especial do ERPNext
    if (type === 'payment_from_invoice' && data.against_invoice) {
      // Usar o método get_payment_entry para criar Payment Entry corretamente linkado
      const getPaymentResult = await erpNextBreaker.fire({
        url: `${config.ERPNEXT_URL}/api/method/erpnext.accounts.doctype.payment_entry.payment_entry.get_payment_entry`,
        method: 'POST',
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dt: 'Sales Invoice',
          dn: data.against_invoice,
          party_amount: data.paid_amount,
          payment_type: 'Receive',
        }),
      }) as { message: Record<string, unknown> };

      // Salvar o Payment Entry gerado
      const paymentEntry = getPaymentResult.message;
      paymentEntry.reference_no = data.reference_no;
      paymentEntry.reference_date = data.reference_date;
      paymentEntry.mode_of_payment = data.mode_of_payment;
      
      // Adicionar campos custom se existirem
      if (data.custom_stripe_payment_intent_id) {
        paymentEntry.custom_stripe_payment_intent_id = data.custom_stripe_payment_intent_id;
      }
      if (data.custom_wise_transfer_id) {
        paymentEntry.custom_wise_transfer_id = data.custom_wise_transfer_id;
      }

      const result = await erpNextBreaker.fire({
        url: `${config.ERPNEXT_URL}/api/resource/Payment%20Entry`,
        method: 'POST',
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentEntry),
      }) as { data: { name: string } };

      logger.info({ type: 'payment_from_invoice', erpnextId: result.data.name, invoice: data.against_invoice }, 'Payment Entry criado com referência a Invoice');
      return result.data;
    }

    const result = await erpNextBreaker.fire({
      url: `${config.ERPNEXT_URL}/api/resource/${doctypes[type]}`,
      method: 'POST',
      headers: {
        'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    }) as { data: { name: string } };

    logger.info({ type, erpnextId: result.data.name }, 'Sincronizado com ERPNext');
    return result.data;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      logger.warn({ type }, 'Circuit breaker aberto - ERPNext temporariamente indisponível');
    } else {
      logger.error({ error, type }, 'Falha ao sincronizar com ERPNext');
    }
    return null;
  }
}

// Criar Sales Invoice a partir de Sales Order
async function createInvoiceFromOrder(salesOrderName: string): Promise<string | null> {
  if (!config.ERPNEXT_URL || !config.ERPNEXT_API_KEY || !config.ERPNEXT_API_SECRET) {
    return null;
  }

  try {
    // Usar API do ERPNext para criar Invoice a partir de Sales Order
    const result = await erpNextBreaker.fire({
      url: `${config.ERPNEXT_URL}/api/method/erpnext.selling.doctype.sales_order.sales_order.make_sales_invoice`,
      method: 'POST',
      headers: {
        'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source_name: salesOrderName }),
    }) as { message: Record<string, unknown> };

    // Salvar a invoice gerada
    const invoice = result.message;
    const saveResult = await erpNextBreaker.fire({
      url: `${config.ERPNEXT_URL}/api/resource/Sales%20Invoice`,
      method: 'POST',
      headers: {
        'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(invoice),
    }) as { data: { name: string } };

    logger.info({ salesOrder: salesOrderName, invoice: saveResult.data.name }, 'Sales Invoice criada a partir de Sales Order');
    return saveResult.data.name;
  } catch (error) {
    logger.error({ error, salesOrder: salesOrderName }, 'Falha ao criar Sales Invoice a partir de Sales Order');
    return null;
  }
}

// Inicializar sistema de feature flags com storage PostgreSQL (Regra 16 - Enterprise)
const featureFlagStorage = createDrizzleFeatureFlagStorage();
initFeatureFlags(featureFlagStorage);
logger.info('Sistema de feature flags inicializado');

const corsOriginsEnv = process.env.CORS_ORIGINS;
if (!corsOriginsEnv && process.env.NODE_ENV === 'production') {
  logger.error('CORS_ORIGINS é obrigatório em produção (Regra 6 - fail-fast)');
  process.exit(1);
}
const CORS_ORIGINS = corsOriginsEnv
  ? corsOriginsEnv.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [];

// SEGURANÇA: Helmet com CSP/HSTS enterprise (Express.js 2025 + OWASP 2023)
app.use(createSecurityMiddleware({
  contentSecurityPolicy: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV !== 'production',
}));

// OBSERVABILITY: Correlation ID middleware para rastreamento distribuído (Node.js 20 LTS 2025)
// Propaga correlation IDs entre microsserviços e injeta nos logs automaticamente
app.use(createCorrelationMiddleware({ serviceName: 'integrations-service' }));

// PERFORMANCE: Compression para reduzir tamanho de respostas (Express.js 2025)
app.use(compression());

// NOTA: Helmet já aplicado via createSecurityMiddleware() acima

app.use(cors({
  origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : false,
  credentials: CORS_ORIGINS.length > 0,
}));

// SEGURANÇA: Rate limiting multi-tenant (express-rate-limit 2025)
app.use(createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  skipRoutes: ['/api/integrations/health', '/api/integrations/stripe/webhook', '/api/integrations/wise/webhook', '/api/integrations/twilio/webhook'],
  serviceName: 'integrations-service',
}));

// REGRA 6: express.raw() DEVE ser registrado ANTES de express.json() global
// Em Express, app.use() middleware executa na ordem de registro, não na ordem da rota
// Se express.json() for registrado antes, ele converte body em objeto para TODAS as rotas
// incluindo webhooks, quebrando validação de assinatura que requer Buffer
// IMPORTANTE: Registrar body parsers específicos ANTES do parser global
app.use('/api/integrations/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/integrations/wise/webhook', express.raw({ type: 'application/json' }));
app.use('/api/integrations/twilio/webhook', express.urlencoded({ extended: false }));
// SEGURANÇA: express.json() APÓS os parsers específicos (OWASP API4)
app.use(express.json({ limit: '10mb' }));

// =============================================================================
// MIDDLEWARE: Autenticação via Cookie de Sessão PostgreSQL
// =============================================================================
// CORREÇÃO PR#107 (10/01/2026): Requisições HTTP precisam de validação de sessão
// PROBLEMA: alice-integrations não tinha middleware para processar cookie de sessão
//           do alice-auth, causando 401 em todas as requisições autenticadas.
// SOLUÇÃO: Middleware compartilhado de @alice/shared-utils
// REF: CLAUDE.md Regra 7 (Diagnóstico de causa raiz)
// =============================================================================
app.use(createSessionAuthMiddleware({
  pool: getPool(),
  publicPaths: [
    '/api/integrations/health', 
    '/live', 
    '/ready', 
    '/metrics',
    // Webhooks usam validação própria de assinatura (não precisam de sessão)
    '/api/integrations/stripe/webhook',
    '/api/integrations/wise/webhook',
    '/api/integrations/twilio/webhook',
  ],
}));

app.get('/api/integrations/health', (_req: Request, res: Response) => {
  const wiseConfigured = isWiseConfigured();
  res.json({ 
    status: 'ok', 
    service: 'integrations-service', 
    timestamp: new Date().toISOString(),
    integrations: {
      stripe: !!stripe,
      erpnext: !!config.ERPNEXT_URL,
      wise: wiseConfigured,
    },
    circuitBreakers: {
      erpnext: erpNextBreaker.opened ? 'open' : 'closed',
      wise: wiseConfigured ? getWiseCircuitBreakerStatus() : null,
    },
  });
});

// ============================================================================
// KUBERNETES PROBES: /ready e /live (Regra 16 - Best Practices 2025)
// /live: Processo está vivo? Se não, Kubernetes reinicia o container
// /ready: Pronto para tráfego? Verifica conexão com PostgreSQL e circuit breakers
// ============================================================================

// Liveness probe - verificação simples que o processo responde
app.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ 
    status: 'alive', 
    service: 'integrations-service',
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe - verifica se PostgreSQL e integrações críticas estão acessíveis
app.get('/ready', async (_req: Request, res: Response) => {
  try {
    const dbHealthy = await isPoolHealthy();
    const erpnextReady = !erpNextBreaker.opened;
    
    // Para readiness, verificamos apenas PostgreSQL (obrigatório) e ERPNext (se configurado)
    const allReady = dbHealthy && (erpnextReady || !config.ERPNEXT_URL);
    
    if (allReady) {
      res.status(200).json({
        status: 'ready',
        service: 'integrations-service',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgresql: 'ready',
          erpnext: config.ERPNEXT_URL ? (erpnextReady ? 'ready' : 'circuit_open') : 'not_configured',
        },
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        service: 'integrations-service',
        reason: !dbHealthy ? 'PostgreSQL não está acessível' : 'ERPNext circuit breaker aberto',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgresql: dbHealthy ? 'ready' : 'not_ready',
          erpnext: config.ERPNEXT_URL ? (erpnextReady ? 'ready' : 'circuit_open') : 'not_configured',
        },
      });
    }
  } catch (error) {
    logger.error({ error }, 'Erro ao verificar readiness');
    res.status(503).json({
      status: 'not_ready',
      service: 'integrations-service',
      reason: 'Erro ao verificar dependências',
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/integrations', requirePermission('integrations:integrations:read'), async (req: Request, res: Response) => {
  // OWASP API3: Validação de query params
  const queryResult = integrationsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }
  const { tenantId } = queryResult.data;

  try {
    const db = getDatabase();

    const integrations = await db.query.integrations.findMany({
      where: tenantId ? eq(schema.integrations.tenantId, tenantId) : undefined,
      orderBy: [desc(schema.integrations.criadoEm)],
    });

    res.json({ integrations });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch integrations');
    res.status(500).json({ error: 'Internal server error' });
  }
});

const createIntegrationSchema = z.object({
  tenantId: z.string().uuid().optional(),
  tipo: z.enum(['stripe', 'erpnext', 'twilio', 'whatsapp']),
  nome: z.string().min(1),
  configuracao: z.record(z.unknown()).optional(),
  credenciais: z.record(z.unknown()).optional(),
});

// OWASP API3 - Schemas Zod para Twilio webhooks e rotas
// Referência: https://www.twilio.com/docs/messaging/webhooks/message-webhooks
// Regex para formato Twilio: "whatsapp:+xxxxxxxxxxx" ou "+xxxxxxxxxxx"
const twilioPhoneRegex = /^(whatsapp:)?\+?[1-9]\d{9,14}$/;
// Regex para MessageSid webhook incoming: MM + 32 hex chars (MMS) ou SM + 32 (SMS)
const twilioIncomingSidRegex = /^(SM|MM)[0-9a-fA-F]{32}$/;
const twilioWebhookSchema = z.object({
  MessageSid: z.string().regex(twilioIncomingSidRegex), // SM/MM + 32 hex chars
  From: z.string().min(10).max(30).regex(twilioPhoneRegex), // whatsapp:+xxxxxxxxxxx ou +xxxxxxxxxxx
  To: z.string().min(10).max(30).regex(twilioPhoneRegex),
  Body: z.string().max(1600).default(''), // WhatsApp max message size
  NumMedia: z.string().regex(/^\d+$/).optional(),
  MediaUrl0: z.string().url().optional(),
  MediaContentType0: z.string().max(100).optional(),
});

// Twilio message status enum completo
// Docs: https://www.twilio.com/docs/messaging/guides/outbound-message-statuses
// Inclui todos os status: outbound, inbound e WhatsApp específicos
const twilioMessageStatuses = [
  // Outbound statuses
  'accepted', 'queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed',
  // Inbound statuses
  'receiving', 'received',
  // Scheduled message statuses
  'scheduled', 'canceled',
  // WhatsApp specific statuses
  'read',
] as const;
// Regex para MessageSid: SM + 32 hex chars
const twilioSidRegex = /^SM[0-9a-fA-F]{32}$/;
const twilioStatusSchema = z.object({
  MessageSid: z.string().regex(twilioSidRegex), // SM + 32 hex chars
  MessageStatus: z.enum(twilioMessageStatuses),
  ErrorCode: z.string().max(10).optional(),
  ErrorMessage: z.string().max(500).optional(),
  To: z.string().min(10).max(30).regex(twilioPhoneRegex), // whatsapp:+xxxxxxxxxxx ou +xxxxxxxxxxx
});

const twilioSendSchema = z.object({
  to: z.string().min(10).max(30).regex(twilioPhoneRegex), // whatsapp:+xxxxxxxxxxx ou +xxxxxxxxxxx
  message: z.string().min(1).max(1600), // WhatsApp max message size
  conversationId: z.string().uuid().optional(),
  mediaUrl: z.string().url().optional(),
});

// ============================================================================
// OWASP API3 - Schemas Zod para validação de parâmetros de rota e query
// Previne NaN e injection via parâmetros não validados
// ============================================================================

// Schema para ID numérico positivo (Wise recipient/transfer IDs)
const numericIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'ID deve ser numérico').transform(Number).refine(n => n > 0, 'ID deve ser positivo'),
});

// Schema para ID string (batch groups usam UUID) - reservado para uso futuro
const _stringIdParamSchema = z.object({
  id: z.string().min(1).max(100),
});

// Schema para query params de paginação
const paginationQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).transform(Number).refine(n => n >= 1 && n <= 100, 'limit deve ser entre 1 e 100').optional(),
  offset: z.string().regex(/^\d+$/).transform(Number).refine(n => n >= 0, 'offset deve ser >= 0').optional(),
});

// Schema para query params com tenantId opcional
const tenantQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

// Schema para query params de integrations
const integrationsQuerySchema = tenantQuerySchema;

// OWASP API3: Schemas para validação de query params Wise
// Previne injection e garante tipos corretos

// Schema para taxas de câmbio (source/target currencies)
const wiseRatesQuerySchema = z.object({
  source: z.string()
    .min(3, 'source deve ter 3 caracteres')
    .max(3, 'source deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'source deve ser código de moeda válido (ex: USD, EUR, BRL)'),
  target: z.string()
    .min(3, 'target deve ter 3 caracteres')
    .max(3, 'target deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'target deve ser código de moeda válido (ex: USD, EUR, BRL)'),
});

// Schema para filtro de destinatários por moeda (opcional)
const wiseRecipientsQuerySchema = z.object({
  currency: z.string()
    .min(3, 'currency deve ter 3 caracteres')
    .max(3, 'currency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'currency deve ser código de moeda válido')
    .optional(),
});

// Schema para requisitos de destinatário
const wiseRecipientRequirementsQuerySchema = z.object({
  sourceCurrency: z.string()
    .min(3, 'sourceCurrency deve ter 3 caracteres')
    .max(3, 'sourceCurrency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'sourceCurrency deve ser código de moeda válido'),
  targetCurrency: z.string()
    .min(3, 'targetCurrency deve ter 3 caracteres')
    .max(3, 'targetCurrency deve ter 3 caracteres')
    .regex(/^[A-Z]{3}$/, 'targetCurrency deve ser código de moeda válido'),
  sourceAmount: z.string()
    .regex(/^\d+(\.\d{1,2})?$/, 'sourceAmount deve ser número válido')
    .transform(Number)
    .refine(n => n > 0, 'sourceAmount deve ser positivo'),
});

app.post('/api/integrations', requirePermission('integrations:integrations:write'), async (req: Request, res: Response) => {
  try {
    const body = createIntegrationSchema.parse(req.body);
    const db = getDatabase();

    const [integration] = await db.insert(schema.integrations).values({
      tenantId: body.tenantId,
      tipo: body.tipo,
      nome: body.nome,
      configuracao: body.configuracao || {},
      credenciais: body.credenciais || {},
      ativo: true,
    }).returning();

    logger.info({ integrationId: integration.id, tipo: body.tipo }, 'Integration created');
    res.json({ integration });
  } catch (error) {
    logger.error({ error }, 'Failed to create integration');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/integrations/stripe/create-checkout', requirePermission('integrations:stripe:write'), async (req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const { priceId, userId, successUrl, cancelUrl } = req.body;

  try {
    const db = getDatabase();
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });

    let customerId = user?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user?.email || undefined,
        name: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || undefined,
        metadata: { userId },
      });
      customerId = customer.id;

      await db.update(schema.users)
        .set({ stripeCustomerId: customerId })
        .where(eq(schema.users.id, userId));
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId },
    });

    logger.info({ sessionId: session.id, userId }, 'Checkout session created');
    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    logger.error({ error }, 'Failed to create checkout session');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/integrations/stripe/create-portal', requirePermission('integrations:stripe:write'), async (req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const { userId, returnUrl } = req.body;

  try {
    const db = getDatabase();
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });

    if (!user?.stripeCustomerId) {
      return res.status(400).json({ error: 'User has no Stripe customer' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: returnUrl,
    });

    res.json({ url: session.url });
  } catch (error) {
    logger.error({ error }, 'Failed to create portal session');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Listar produtos do Stripe
app.get('/api/integrations/stripe/products', requirePermission('integrations:stripe:read'), async (_req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  try {
    const products = await stripe.products.list({ active: true, limit: 100 });
    const prices = await stripe.prices.list({ active: true, limit: 100 });

    const productsWithPrices = products.data.map(product => ({
      ...product,
      prices: prices.data.filter(price => price.product === product.id),
    }));

    res.json({ products: productsWithPrices });
  } catch (error) {
    logger.error({ error }, 'Failed to list products');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Criar PaymentIntent para pagamento único
app.post('/api/integrations/stripe/create-payment-intent', requirePermission('integrations:stripe:write'), async (req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const { amount, currency = 'eur', userId, description } = req.body;

  try {
    const db = getDatabase();
    let customerId: string | undefined;

    if (userId) {
      const user = await db.query.users.findFirst({
        where: eq(schema.users.id, userId),
      });

      if (user?.stripeCustomerId) {
        customerId = user.stripeCustomerId;
      } else if (user?.email) {
        const customer = await stripe.customers.create({
          email: user.email,
          name: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
          metadata: { userId },
        });
        customerId = customer.id;

        await db.update(schema.users)
          .set({ stripeCustomerId: customerId })
          .where(eq(schema.users.id, userId));
      }
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      customer: customerId,
      description,
      automatic_payment_methods: { enabled: true },
      metadata: { userId: userId || '' },
    });

    logger.info({ paymentIntentId: paymentIntent.id, amount, currency }, 'PaymentIntent created');
    res.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
  } catch (error) {
    logger.error({ error }, 'Failed to create PaymentIntent');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Validar secrets obrigatórios em produção (Regra 16 - Segurança Enterprise)
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const WISE_WEBHOOK_SECRET = process.env.WISE_WEBHOOK_SECRET;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// STRIPE: Fail-fast se produção sem webhook secret
if (!STRIPE_WEBHOOK_SECRET && IS_PRODUCTION && stripe) {
  logger.error('CRITICAL: STRIPE_WEBHOOK_SECRET é OBRIGATÓRIO em produção com Stripe ativo. Abortando.');
  process.exit(1);
}

// WISE: Warning se produção sem webhook secret (webhooks desabilitados, API funciona)
// CORREÇÃO 23/12/2025: WISE_WEBHOOK_SECRET só é gerado após primeiro deploy
// O serviço deve funcionar sem webhook secret - apenas webhooks ficam desabilitados
if (!WISE_WEBHOOK_SECRET && IS_PRODUCTION && isWiseConfigured()) {
  logger.warn('WISE_WEBHOOK_SECRET não configurado - webhooks Wise desabilitados. Configure após primeiro deploy se necessário.');
}

// Função auxiliar para verificar idempotência de webhooks
async function checkWebhookIdempotency(
  db: ReturnType<typeof getDatabase>,
  source: 'stripe' | 'wise' | 'twilio' | 'erpnext',
  eventId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<{ isDuplicate: boolean; existingEvent?: typeof schema.webhookEvents.$inferSelect }> {
  // Verificar se evento já foi processado
  const existingEvent = await db.query.webhookEvents.findFirst({
    where: and(
      eq(schema.webhookEvents.source, source),
      eq(schema.webhookEvents.eventId, eventId)
    ),
  });

  if (existingEvent) {
    logger.info({ 
      source, 
      eventId, 
      processedAt: existingEvent.processedAt,
    }, 'Webhook duplicado detectado - ignorando (idempotência)');
    return { isDuplicate: true, existingEvent };
  }

  // Registrar evento para garantir idempotência
  await db.insert(schema.webhookEvents).values({
    source,
    eventId,
    eventType,
    payload,
    processed: false,
  });

  return { isDuplicate: false };
}

// Função auxiliar para marcar webhook como processado
async function markWebhookProcessed(
  db: ReturnType<typeof getDatabase>,
  source: 'stripe' | 'wise' | 'twilio' | 'erpnext',
  eventId: string,
  result: Record<string, unknown>,
  error?: string
): Promise<void> {
  await db.update(schema.webhookEvents)
    .set({
      processed: !error,
      processedAt: new Date(),
      result,
      error,
      retryCount: error ? sql`retry_count + 1` : undefined,
    })
    .where(and(
      eq(schema.webhookEvents.source, source),
      eq(schema.webhookEvents.eventId, eventId)
    ));
}

// Stripe Webhook - express.raw() já aplicado via app.use() ANTES de express.json() (linha 310)
// Isso garante que req.body seja Buffer para validação de assinatura Stripe
app.post('/api/integrations/stripe/webhook', async (req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const contentTypeHeader = req.headers['content-type'];
  const contentType = Array.isArray(contentTypeHeader)
    ? contentTypeHeader[0]?.toLowerCase()
    : contentTypeHeader?.toLowerCase();
  if (!contentType || !contentType.startsWith('application/json')) {
    logger.warn({ contentType }, 'Stripe webhook rejeitado: content-type inválido');
    return res.status(400).json({ error: 'Invalid content-type' });
  }

  const sig = req.headers['stripe-signature'] as string;

  if (!STRIPE_WEBHOOK_SECRET) {
    logger.error('Webhook recebido mas STRIPE_WEBHOOK_SECRET não configurado');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  // REGRA 6: Validação de Buffer após express.raw() aplicado diretamente na rota
  // Se express.raw() não foi aplicado corretamente, req.body será objeto (erro)
  if (!Buffer.isBuffer(req.body)) {
    logger.error('Stripe webhook rejeitado: body não é Buffer (express.raw() não aplicado corretamente)');
    return res.status(500).json({ error: 'Invalid body parser for webhook' });
  }

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    const db = getDatabase();

    // IDEMPOTÊNCIA: Verificar se evento já foi processado
    const { isDuplicate } = await checkWebhookIdempotency(
      db,
      'stripe',
      event.id,
      event.type,
      event.data.object as unknown as Record<string, unknown>
    );

    if (isDuplicate) {
      return res.json({ received: true, duplicate: true });
    }

    let processingResult: Record<string, unknown> = {};
    let processingError: string | undefined;

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          const userId = session.metadata?.userId;

          if (userId && session.subscription) {
            await db.update(schema.users)
              .set({ stripeSubscriptionId: session.subscription as string })
              .where(eq(schema.users.id, userId));

            logger.info({ userId, subscriptionId: session.subscription }, 'Subscription created');
            processingResult = { userId, subscriptionId: session.subscription };
          }

          // FLUXO ERPNEXT COMPLETO: Customer → Sales Order → Sales Invoice → Payment Entry
          // Step 1: Criar registro de mapeamento para rastreabilidade
          const [mapping] = await db.insert(schema.stripeErpnextMapping).values({
            stripeSessionId: session.id,
            stripeCustomerId: session.customer as string,
            stripePaymentIntentId: session.payment_intent as string || null,
            stripeSubscriptionId: session.subscription as string || null,
            flowStatus: 'pending',
          }).returning();

          // Step 2: Criar Sales Order quando checkout completa
          if (session.customer && session.amount_total) {
            const customer = await stripe.customers.retrieve(session.customer as string);
            if (customer && !customer.deleted) {
              const salesOrderResult = await syncToERPNext('sales_order', {
                customer: customer.email || customer.id,
                transaction_date: new Date().toISOString().split('T')[0],
                delivery_date: new Date().toISOString().split('T')[0],
                currency: (session.currency || 'EUR').toUpperCase(),
                items: [{
                  item_code: session.metadata?.productId || 'SUBSCRIPTION',
                  qty: 1,
                  rate: (session.amount_total || 0) / 100,
                }],
                custom_stripe_session_id: session.id,
                custom_stripe_customer_id: session.customer,
              });
              
              if (salesOrderResult?.name) {
                // Atualizar mapeamento com Sales Order
                await db.update(schema.stripeErpnextMapping)
                  .set({ 
                    erpnextSalesOrder: salesOrderResult.name,
                    erpnextCustomer: customer.email || customer.id,
                    flowStatus: 'order_created',
                    atualizadoEm: new Date(),
                  })
                  .where(eq(schema.stripeErpnextMapping.id, mapping.id));
              }
              
              // Step 3: Se pagamento já foi feito (status=paid), criar Invoice + Payment Entry
              if (session.payment_status === 'paid' && salesOrderResult?.name) {
                // Criar Invoice a partir do Sales Order
                const invoiceName = await createInvoiceFromOrder(salesOrderResult.name);
                
                if (invoiceName) {
                  // Atualizar mapeamento com Invoice
                  await db.update(schema.stripeErpnextMapping)
                    .set({ 
                      erpnextSalesInvoice: invoiceName,
                      flowStatus: 'invoice_created',
                      atualizadoEm: new Date(),
                    })
                    .where(eq(schema.stripeErpnextMapping.id, mapping.id));

                  // Criar Payment Entry com referência à Invoice
                  const paymentResult = await syncToERPNext('payment_from_invoice', {
                    against_invoice: invoiceName,
                    paid_amount: (session.amount_total || 0) / 100,
                    reference_no: session.payment_intent as string || session.id,
                    reference_date: new Date().toISOString().split('T')[0],
                    mode_of_payment: 'Stripe',
                    custom_stripe_session_id: session.id,
                    custom_stripe_payment_intent_id: session.payment_intent,
                  });
                  
                  // Atualizar mapeamento com Payment Entry
                  if (paymentResult?.name) {
                    await db.update(schema.stripeErpnextMapping)
                      .set({ 
                        erpnextPaymentEntry: paymentResult.name,
                        flowStatus: 'complete',
                        atualizadoEm: new Date(),
                      })
                      .where(eq(schema.stripeErpnextMapping.id, mapping.id));
                  }
                  
                  logger.info({ 
                    salesOrder: salesOrderResult.name, 
                    invoice: invoiceName,
                    sessionId: session.id 
                  }, 'Fluxo ERPNext completo: Sales Order → Invoice → Payment Entry');
                  
                  processingResult = { 
                    ...processingResult, 
                    salesOrder: salesOrderResult.name, 
                    invoice: invoiceName,
                    erpnextFlowComplete: true 
                  };
                }
              } else if (salesOrderResult?.name) {
                // Pagamento pendente - apenas Sales Order criado
                logger.info({ 
                  salesOrder: salesOrderResult.name, 
                  sessionId: session.id,
                  paymentStatus: session.payment_status 
                }, 'Sales Order criado - Invoice será criada quando pagamento confirmar');
                processingResult = { ...processingResult, salesOrder: salesOrderResult.name };
              }
            }
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          const customerId = subscription.customer as string;

          const user = await db.query.users.findFirst({
            where: eq(schema.users.stripeCustomerId, customerId),
          });

          if (user) {
            await db.update(schema.users)
              .set({ stripeSubscriptionId: null })
              .where(eq(schema.users.id, user.id));

            logger.info({ userId: user.id }, 'Subscription cancelled');
            processingResult = { userId: user.id, action: 'subscription_cancelled' };
          }
          break;
        }

        case 'payment_intent.succeeded': {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          
          // Completar fluxo ERPNext se pagamento foi feito após checkout
          // Usar tabela de mapeamento para encontrar o Sales Order correto
          
          if (paymentIntent.amount && paymentIntent.customer) {
            // Buscar mapeamento pelo payment_intent_id
            const mapping = await db.query.stripeErpnextMapping.findFirst({
              where: eq(schema.stripeErpnextMapping.stripePaymentIntentId, paymentIntent.id),
            });

            if (mapping && mapping.erpnextSalesOrder) {
              // Verificar se fluxo já está completo
              if (mapping.flowStatus === 'complete') {
                logger.info({ paymentIntentId: paymentIntent.id, mappingId: mapping.id }, 
                  'Fluxo ERPNext já completo - ignorando payment_intent.succeeded');
                processingResult = { 
                  paymentIntentId: paymentIntent.id, 
                  amount: paymentIntent.amount,
                  alreadyComplete: true 
                };
              } else if (mapping.flowStatus === 'order_created') {
                // Sales Order existe mas Invoice não - criar Invoice + Payment Entry
                try {
                  const invoiceName = await createInvoiceFromOrder(mapping.erpnextSalesOrder);
                  
                  if (invoiceName) {
                    // Atualizar mapeamento com Invoice
                    await db.update(schema.stripeErpnextMapping)
                      .set({ 
                        erpnextSalesInvoice: invoiceName,
                        flowStatus: 'invoice_created',
                        atualizadoEm: new Date(),
                      })
                      .where(eq(schema.stripeErpnextMapping.id, mapping.id));

                    // Criar Payment Entry com referência à Invoice
                    const paymentResult = await syncToERPNext('payment_from_invoice', {
                      against_invoice: invoiceName,
                      paid_amount: paymentIntent.amount / 100,
                      reference_no: paymentIntent.id,
                      reference_date: new Date().toISOString().split('T')[0],
                      mode_of_payment: 'Stripe',
                      custom_stripe_payment_intent_id: paymentIntent.id,
                    });
                    
                    // Atualizar mapeamento com Payment Entry
                    if (paymentResult?.name) {
                      await db.update(schema.stripeErpnextMapping)
                        .set({ 
                          erpnextPaymentEntry: paymentResult.name,
                          flowStatus: 'complete',
                          atualizadoEm: new Date(),
                        })
                        .where(eq(schema.stripeErpnextMapping.id, mapping.id));
                    }
                    
                    logger.info({ 
                      salesOrder: mapping.erpnextSalesOrder, 
                      invoice: invoiceName,
                      paymentIntentId: paymentIntent.id 
                    }, 'Fluxo ERPNext completado via payment_intent.succeeded');
                    
                    processingResult = { 
                      paymentIntentId: paymentIntent.id, 
                      amount: paymentIntent.amount,
                      salesOrder: mapping.erpnextSalesOrder,
                      invoice: invoiceName,
                      erpnextFlowComplete: true
                    };
                  }
                } catch (erpnextError) {
                  logger.error({ error: erpnextError, paymentIntentId: paymentIntent.id, mapping }, 
                    'Falha ao completar fluxo ERPNext via payment_intent.succeeded');
                  
                  processingResult = { 
                    paymentIntentId: paymentIntent.id, 
                    amount: paymentIntent.amount,
                    error: 'ERPNext flow failed',
                    salesOrder: mapping.erpnextSalesOrder
                  };
                }
              } else if (mapping.flowStatus === 'invoice_created' && mapping.erpnextSalesInvoice) {
                // Invoice existe mas Payment Entry não - criar apenas Payment Entry
                try {
                  const paymentResult = await syncToERPNext('payment_from_invoice', {
                    against_invoice: mapping.erpnextSalesInvoice,
                    paid_amount: paymentIntent.amount / 100,
                    reference_no: paymentIntent.id,
                    reference_date: new Date().toISOString().split('T')[0],
                    mode_of_payment: 'Stripe',
                    custom_stripe_payment_intent_id: paymentIntent.id,
                  });
                  
                  if (paymentResult?.name) {
                    await db.update(schema.stripeErpnextMapping)
                      .set({ 
                        erpnextPaymentEntry: paymentResult.name,
                        flowStatus: 'complete',
                        atualizadoEm: new Date(),
                      })
                      .where(eq(schema.stripeErpnextMapping.id, mapping.id));
                  }
                  
                  processingResult = { 
                    paymentIntentId: paymentIntent.id, 
                    amount: paymentIntent.amount,
                    invoice: mapping.erpnextSalesInvoice,
                    paymentCreated: true
                  };
                } catch (paymentError) {
                  logger.error({ error: paymentError, paymentIntentId: paymentIntent.id }, 
                    'Falha ao criar Payment Entry');
                }
              }
            } else {
              // Sem mapeamento encontrado - registrar apenas metadados
              logger.info({ paymentIntentId: paymentIntent.id }, 
                'Payment intent sem mapeamento - provavelmente processado por checkout.session.completed');
              processingResult = { 
                paymentIntentId: paymentIntent.id, 
                amount: paymentIntent.amount,
                note: 'No mapping found - may be handled by checkout.session.completed'
              };
            }
          }
          break;
        }

        case 'customer.created': {
          const customer = event.data.object as Stripe.Customer;
          
          // Sincronizar cliente com ERPNext
          await syncToERPNext('customer', {
            customer_name: customer.name || customer.email || customer.id,
            customer_type: 'Individual',
            customer_group: 'Individual',
            territory: 'Portugal',
            email_id: customer.email,
            custom_stripe_customer_id: customer.id,
          });
          processingResult = { customerId: customer.id };
          break;
        }
      }
    } catch (processingErr) {
      processingError = processingErr instanceof Error ? processingErr.message : String(processingErr);
      logger.error({ error: processingErr, eventId: event.id }, 'Erro ao processar webhook Stripe');
    }

    // Marcar webhook como processado (ou com erro)
    await markWebhookProcessed(db, 'stripe', event.id, processingResult, processingError);

    res.json({ received: true });
  } catch (error) {
    logger.error({ error }, 'Webhook error');
    res.status(400).json({ error: 'Webhook error' });
  }
});

app.get('/api/integrations/erpnext/test', requirePermission('integrations:erpnext:read'), async (_req: Request, res: Response) => {
  if (!config.ERPNEXT_URL) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  // RESILIÊNCIA: AbortController com timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.ERPNEXT_URL}/api/method/frappe.auth.get_logged_user`, {
      headers: {
        'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error('ERPNext connection failed');
    }

    const data = await response.json() as { message: string };
    res.json({ status: 'connected', user: data.message });
  } catch (error) {
    logger.error({ error }, 'ERPNext test failed');
    res.status(500).json({ error: 'ERPNext connection failed' });
  } finally {
    clearTimeout(timeoutId);
  }
});

app.get('/api/integrations/erpnext/customers', requirePermission('integrations:erpnext:read'), async (_req: Request, res: Response) => {
  if (!config.ERPNEXT_URL) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  // RESILIÊNCIA: AbortController com timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${config.ERPNEXT_URL}/api/resource/Customer?fields=["name","customer_name","customer_type","territory"]&limit_page_length=100`,
      {
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
        },
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch customers');
    }

    const data = await response.json() as { data: unknown[] };
    res.json({ customers: data.data });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch ERPNext customers');
    res.status(500).json({ error: 'Failed to fetch customers' });
  } finally {
    clearTimeout(timeoutId);
  }
});

app.get('/api/integrations/erpnext/items', requirePermission('integrations:erpnext:read'), async (_req: Request, res: Response) => {
  if (!config.ERPNEXT_URL) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  // RESILIÊNCIA: AbortController com timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${config.ERPNEXT_URL}/api/resource/Item?fields=["name","item_name","item_group","stock_uom","standard_rate"]&limit_page_length=100`,
      {
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
        },
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch items');
    }

    const data = await response.json() as { data: unknown[] };
    res.json({ items: data.data });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch ERPNext items');
    res.status(500).json({ error: 'Failed to fetch items' });
  } finally {
    clearTimeout(timeoutId);
  }
});

const erpNextCustomerCreateSchema = z.object({
  customerName: z.string().min(2),
  customerType: z.string().min(2),
  territory: z.string().min(2),
  email: z.string().email().optional(),
  phone: z.string().min(3).optional(),
  taxId: z.string().min(3).optional(),
});

app.post('/api/integrations/erpnext/customers', requirePermission('integrations:erpnext:write'), async (req: Request, res: Response) => {
  if (!config.ERPNEXT_URL) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  const parseResult = erpNextCustomerCreateSchema.safeParse(req.body);
  if (!parseResult.success) {
    logger.warn({ errors: parseResult.error.flatten() }, 'Input inválido em /api/integrations/erpnext/customers');
    return res.status(400).json({ error: 'Input inválido', details: parseResult.error.format() });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${config.ERPNEXT_URL}/api/resource/Customer`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          customer_name: parseResult.data.customerName,
          customer_type: parseResult.data.customerType,
          territory: parseResult.data.territory,
          email_id: parseResult.data.email,
          mobile_no: parseResult.data.phone,
          tax_id: parseResult.data.taxId,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Failed to create customer: ${response.status} - ${errText}`);
    }

    const data = await response.json() as { data: unknown };
    res.json({ customer: data.data });
  } catch (error) {
    logger.error({ error }, 'Failed to create ERPNext customer');
    res.status(500).json({ error: 'Failed to create customer' });
  } finally {
    clearTimeout(timeoutId);
  }
});

app.get('/api/integrations/erpnext/invoices', requirePermission('integrations:erpnext:read'), async (req: Request, res: Response) => {
  if (!config.ERPNEXT_URL) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  const limit = Number(req.query.limit ?? 100);
  const safeLimit = Number.isFinite(limit) && limit > 0 && limit <= 200 ? limit : 100;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${config.ERPNEXT_URL}/api/resource/Sales%20Invoice?fields=["name","customer","grand_total","status","posting_date"]&limit_page_length=${safeLimit}`,
      {
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
        },
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch invoices');
    }

    const data = await response.json() as { data: unknown[] };
    res.json({ invoices: data.data });
  } catch (error) {
    logger.error({ error }, 'Failed to fetch ERPNext invoices');
    res.status(500).json({ error: 'Failed to fetch invoices' });
  } finally {
    clearTimeout(timeoutId);
  }
});

const erpNextInvoiceItemSchema = z.object({
  itemCode: z.string().min(2),
  qty: z.number().positive(),
  rate: z.number().positive(),
});

const erpNextInvoiceCreateSchema = z.object({
  customer: z.string().min(2),
  items: z.array(erpNextInvoiceItemSchema).min(1),
  dueDate: z.string().optional(),
});

app.post('/api/integrations/erpnext/invoices', requirePermission('integrations:erpnext:write'), async (req: Request, res: Response) => {
  if (!config.ERPNEXT_URL) {
    return res.status(503).json({ error: 'ERPNext not configured' });
  }

  const parseResult = erpNextInvoiceCreateSchema.safeParse(req.body);
  if (!parseResult.success) {
    logger.warn({ errors: parseResult.error.flatten() }, 'Input inválido em /api/integrations/erpnext/invoices');
    return res.status(400).json({ error: 'Input inválido', details: parseResult.error.format() });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${config.ERPNEXT_URL}/api/resource/Sales%20Invoice`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${config.ERPNEXT_API_KEY}:${config.ERPNEXT_API_SECRET}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          customer: parseResult.data.customer,
          items: parseResult.data.items.map((item) => ({
            item_code: item.itemCode,
            qty: item.qty,
            rate: item.rate,
          })),
          due_date: parseResult.data.dueDate,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Failed to create invoice: ${response.status} - ${errText}`);
    }

    const data = await response.json() as { data: unknown };
    res.json({ invoice: data.data });
  } catch (error) {
    logger.error({ error }, 'Failed to create ERPNext invoice');
    res.status(500).json({ error: 'Failed to create invoice' });
  } finally {
    clearTimeout(timeoutId);
  }
});

const githubDeploySchema = z.object({
  stack: z.enum(['infra', 'alice', 'observability', 'erpnext', 'backup', 'all']),
  version: z.string().min(2),
  rollback: z.boolean().optional(),
  rollbackVersion: z.string().optional(),
  dryRun: z.boolean().optional(),
  smartDeploy: z.boolean().optional(),
});

app.post('/api/integrations/github/deploy-stack', requirePermission('admin:alice_core:write'), async (req: Request, res: Response) => {
  if (!GH_PAT || !GH_REPO) {
    return res.status(503).json({ error: 'GitHub Actions not configured' });
  }

  const parseResult = githubDeploySchema.safeParse(req.body);
  if (!parseResult.success) {
    logger.warn({ errors: parseResult.error.flatten() }, 'Input inválido em /api/integrations/github/deploy-stack');
    return res.status(400).json({ error: 'Input inválido', details: parseResult.error.format() });
  }

  const payload = {
    ref: 'main',
    inputs: {
      stack: parseResult.data.stack,
      version: parseResult.data.version,
      rollback: parseResult.data.rollback ? 'true' : 'false',
      rollback_version: parseResult.data.rollbackVersion ?? '',
      dry_run: parseResult.data.dryRun ? 'true' : 'false',
      smart_deploy: parseResult.data.smartDeploy ? 'true' : 'false',
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(
      `${GH_API_URL}/repos/${GH_REPO}/actions/workflows/deploy-stack-modular.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GH_PAT}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`GitHub Actions dispatch failed: ${response.status} - ${errText}`);
    }

    res.json({
      status: 'queued',
      workflow: 'deploy-stack-modular.yml',
      inputs: payload.inputs,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao disparar workflow deploy-stack-modular');
    res.status(500).json({
      error: 'Falha ao disparar workflow',
      durationMs: Date.now() - startedAt,
    });
  } finally {
    clearTimeout(timeoutId);
  }
});

// =============================================================================
// GMAIL SMTP API - Emails Transacionais (30/12/2025)
// =============================================================================
// Substituiu Resend. Usa Gmail SMTP com App Password.
// Ref: https://support.google.com/accounts/answer/185833
// =============================================================================

/**
 * Schema de validação para envio de email
 * Suporta envio para múltiplos destinatários
 */
const emailSchema = z.object({
  to: z.union([
    z.string().trim().email(),
    z.array(z.string().trim().email()).min(1).max(50), // Máximo 50 destinatários por envio
  ]),
  subject: z.string().min(1).max(200),
  html: z.string().min(1).max(100000), // Máximo 100KB de HTML
  text: z.string().optional(), // Versão texto plano (opcional, recomendado para acessibilidade)
  from: z.string().trim().email().optional(), // Se não informado, usa GMAIL_USER
  replyTo: z.string().trim().email().optional(),
  // Metadados para rastreamento
  metadata: z.object({
    type: z.enum(['receipt', 'invoice', 'promotion', 'notification', 'alert', 'other']).optional(),
    orderId: z.string().optional(),
    customerId: z.string().optional(),
    tenantId: z.string().uuid().optional(),
  }).optional(),
});

/**
 * POST /api/integrations/email/send
 * Envia email transacional via Gmail SMTP
 * 
 * Usado para:
 * - Comprovantes de vendas e pagamentos
 * - Faturas e recibos
 * - Notificações de pedidos
 * - Promoções e campanhas
 * - Alertas do sistema
 */
app.post('/api/integrations/email/send', requirePermission('integrations:email:write'), async (req: Request, res: Response) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn({ errors: parsed.error.flatten() }, 'Payload inválido para email');
    return res.status(400).json({ error: 'Payload inválido', details: parsed.error.format() });
  }

  if (!emailTransporter) {
    logger.error('Gmail SMTP não configurado');
    return res.status(503).json({ error: 'Serviço de email não configurado' });
  }

  const { to, subject, html, text, from, replyTo, metadata } = parsed.data;
  const fromEmail = from ?? GMAIL_USER;

  try {
    const result = await emailTransporter.sendMail({
      from: fromEmail,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      html,
      text: text ?? undefined,
      replyTo: replyTo ?? undefined,
    });

    logger.info({ 
      messageId: result.messageId,
      to: Array.isArray(to) ? to.length : 1,
      subject,
      from: fromEmail,
      type: metadata?.type ?? 'other',
      orderId: metadata?.orderId,
    }, 'Email enviado via Gmail SMTP');

    res.json({ 
      success: true, 
      messageId: result.messageId,
      accepted: result.accepted,
      rejected: result.rejected,
    });
  } catch (error) {
    logger.error({ error, to, subject }, 'Falha ao enviar email via Gmail SMTP');
    res.status(500).json({ error: 'Falha ao enviar email' });
  }
});

/**
 * GET /api/integrations/email/health
 * Verifica saúde do serviço de email
 */
app.get('/api/integrations/email/health', requirePermission('integrations:email:read'), async (_req: Request, res: Response) => {
  if (!emailTransporter) {
    return res.status(503).json({ 
      status: 'unavailable',
      configured: false,
      message: 'Gmail SMTP não configurado',
    });
  }

  try {
    await emailTransporter.verify();
    res.json({
      status: 'healthy',
      configured: true,
      smtp: {
        host: 'smtp.gmail.com',
        port: 587,
        user: GMAIL_USER,
      },
    });
  } catch (error) {
    logger.error({ error }, 'Gmail SMTP health check falhou');
    res.status(503).json({
      status: 'unhealthy',
      configured: true,
      error: 'Falha na conexão SMTP',
    });
  }
});

// ============================================================
// WISE API - Pagamentos Globais
// Documentação: https://docs.wise.com/api-docs/
// ============================================================

// Obter saldos multi-moeda
app.get('/api/integrations/wise/balances', requirePermission('integrations:wise:read'), async (_req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  try {
    const account = await wiseService.getBalances();
    res.json({ balances: account.balances, sandbox: wiseService.isSandboxMode() });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter saldos Wise');
    res.status(500).json({ error: 'Falha ao obter saldos' });
  }
});

// Obter taxas de câmbio
app.get('/api/integrations/wise/rates', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação Zod obrigatória de query params
  const queryResult = wiseRatesQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    logger.warn({ errors: queryResult.error.flatten() }, 'Input inválido em /api/integrations/wise/rates');
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }

  const { source, target } = queryResult.data;

  try {
    const rate = await wiseService.getExchangeRates(source, target);
    res.json({ rate });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter taxa de câmbio Wise');
    res.status(500).json({ error: 'Falha ao obter taxa de câmbio' });
  }
});

// Criar cotação
app.post('/api/integrations/wise/quotes', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const { sourceCurrency, targetCurrency, sourceAmount, targetAmount } = req.body;

  try {
    const quote = await wiseService.createQuote({
      sourceCurrency,
      targetCurrency,
      sourceAmount,
      targetAmount,
    });
    res.json({ quote });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar cotação Wise');
    res.status(500).json({ error: 'Falha ao criar cotação' });
  }
});

// Listar destinatários
app.get('/api/integrations/wise/recipients', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação Zod de query params (currency é opcional)
  const queryResult = wiseRecipientsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    logger.warn({ errors: queryResult.error.flatten() }, 'Input inválido em /api/integrations/wise/recipients');
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }

  const { currency } = queryResult.data;

  try {
    const recipients = await wiseService.listRecipients(currency);
    res.json({ recipients });
  } catch (error) {
    logger.error({ error }, 'Falha ao listar destinatários Wise');
    res.status(500).json({ error: 'Falha ao listar destinatários' });
  }
});

// Criar destinatário
app.post('/api/integrations/wise/recipients', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const { currency, type, accountHolderName, details } = req.body;

  try {
    const recipient = await wiseService.createRecipient({
      currency,
      type,
      accountHolderName,
      details,
    });
    res.json({ recipient });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar destinatário Wise');
    res.status(500).json({ error: 'Falha ao criar destinatário' });
  }
});

// Obter destinatário por ID
app.get('/api/integrations/wise/recipients/:id', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de parâmetro de rota
  const paramResult = numericIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
  }

  try {
    const recipient = await wiseService.getRecipient(paramResult.data.id);
    res.json({ recipient });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter destinatário Wise');
    res.status(500).json({ error: 'Falha ao obter destinatário' });
  }
});

// Excluir destinatário
app.delete('/api/integrations/wise/recipients/:id', requirePermission('integrations:wise:delete'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de parâmetro de rota
  const paramResult = numericIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
  }

  try {
    await wiseService.deleteRecipient(paramResult.data.id);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Falha ao excluir destinatário Wise');
    res.status(500).json({ error: 'Falha ao excluir destinatário' });
  }
});

// Listar transferências
app.get('/api/integrations/wise/transfers', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de query params de paginação
  const queryResult = paginationQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }
  const limit = queryResult.data.limit ?? 20;
  const offset = queryResult.data.offset ?? 0;

  try {
    const transfers = await wiseService.listTransfers(limit, offset);
    res.json({ transfers });
  } catch (error) {
    logger.error({ error }, 'Falha ao listar transferências Wise');
    res.status(500).json({ error: 'Falha ao listar transferências' });
  }
});

// Criar transferência
app.post('/api/integrations/wise/transfers', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const { targetAccount, quoteUuid, customerTransactionId, details } = req.body;

  try {
    const transfer = await wiseService.createTransfer({
      targetAccount,
      quoteUuid,
      customerTransactionId: customerTransactionId || `alice-${Date.now()}`,
      details: details || { reference: 'Pagamento Alice' },
    });

    logger.info({ transferId: transfer.id, targetAccount }, 'Transferência Wise criada');
    res.json({ transfer });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar transferência Wise');
    res.status(500).json({ error: 'Falha ao criar transferência' });
  }
});

// Obter transferência por ID
app.get('/api/integrations/wise/transfers/:id', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de parâmetro de rota
  const paramResult = numericIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
  }

  try {
    const transfer = await wiseService.getTransfer(paramResult.data.id);
    res.json({ transfer });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter transferência Wise');
    res.status(500).json({ error: 'Falha ao obter transferência' });
  }
});

// Financiar transferência (sandbox)
app.post('/api/integrations/wise/transfers/:id/fund', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de parâmetro de rota
  const paramResult = numericIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
  }

  try {
    const result = await wiseService.fundTransfer(paramResult.data.id);
    res.json({ result });
  } catch (error) {
    logger.error({ error }, 'Falha ao financiar transferência Wise');
    res.status(500).json({ error: 'Falha ao financiar transferência' });
  }
});

// Cancelar transferência
app.post('/api/integrations/wise/transfers/:id/cancel', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de parâmetro de rota
  const paramResult = numericIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
  }

  try {
    const transfer = await wiseService.cancelTransfer(paramResult.data.id);
    res.json({ transfer });
  } catch (error) {
    logger.error({ error }, 'Falha ao cancelar transferência Wise');
    res.status(500).json({ error: 'Falha ao cancelar transferência' });
  }
});

// Listar batch groups (pagamentos em lote)
app.get('/api/integrations/wise/batch-groups', requirePermission('integrations:wise:read'), async (_req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  try {
    const batchGroups = await wiseService.listBatchGroups();
    res.json({ batchGroups });
  } catch (error) {
    logger.error({ error }, 'Falha ao listar batch groups Wise');
    res.status(500).json({ error: 'Falha ao listar batch groups' });
  }
});

// Criar batch group
app.post('/api/integrations/wise/batch-groups', requirePermission('integrations:wise:write'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  const { name, sourceCurrency } = req.body;

  try {
    const batchGroup = await wiseService.createBatchGroup({ name, sourceCurrency });
    res.json({ batchGroup });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar batch group Wise');
    res.status(500).json({ error: 'Falha ao criar batch group' });
  }
});

// Obter batch group por ID
// NOTA: Batch groups usam UUID, não ID numérico
const batchGroupIdParamSchema = z.object({
  id: z.string().min(1).max(100), // UUID ou ID string
});

app.get('/api/integrations/wise/batch-groups/:id', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de parâmetro de rota
  const paramResult = batchGroupIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
  }

  try {
    const batchGroup = await wiseService.getBatchGroup(paramResult.data.id);
    res.json({ batchGroup });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter batch group Wise');
    res.status(500).json({ error: 'Falha ao obter batch group' });
  }
});

// Completar batch group
app.post('/api/integrations/wise/batch-groups/:id/complete', requirePermission('integrations:wise:manage'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação de parâmetro de rota
  const paramResult = batchGroupIdParamSchema.safeParse(req.params);
  if (!paramResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
  }

  const { version } = req.body;

  try {
    const batchGroup = await wiseService.completeBatchGroup(paramResult.data.id, version);
    res.json({ batchGroup });
  } catch (error) {
    logger.error({ error }, 'Falha ao completar batch group Wise');
    res.status(500).json({ error: 'Falha ao completar batch group' });
  }
});

// Webhook Wise - Receber notificações de transferências
// SEGURANÇA: Validar assinatura ANTES de responder (OWASP API4)
// Wise Webhook - express.raw() já aplicado via app.use() ANTES de express.json() (linha 311)
// Isso garante que req.body seja Buffer para validação de assinatura Wise
app.post('/api/integrations/wise/webhook', async (req: Request, res: Response) => {
  const contentTypeHeader = req.headers['content-type'];
  const contentType = Array.isArray(contentTypeHeader)
    ? contentTypeHeader[0]?.toLowerCase()
    : contentTypeHeader?.toLowerCase();
  if (!contentType || !contentType.startsWith('application/json')) {
    logger.warn({ contentType }, 'Webhook Wise: content-type inválido');
    return res.status(400).json({ error: 'Invalid content-type' });
  }

  // REGRA 6: Validação de Buffer após express.raw() aplicado diretamente na rota
  // Se express.raw() não foi aplicado corretamente, req.body será objeto (erro)
  if (!Buffer.isBuffer(req.body)) {
    logger.error('Webhook Wise: body não é Buffer (express.raw() não aplicado corretamente)');
    return res.status(500).json({ error: 'Invalid body parser for webhook' });
  }

  const signature = req.headers['x-signature-sha256'] as string;
  const isTestNotification = req.headers['x-test-notification'] === 'true';
  const deliveryId = req.headers['x-delivery-id'] as string;
  const payload = req.body.toString('utf8');

  // Verificar se é notificação de teste
  if (isTestNotification) {
    logger.info({ deliveryId }, 'Webhook Wise: Notificação de teste recebida');
    res.status(200).json({ received: true });
    return;
  }

  // CRÍTICO: Validar assinatura ANTES de responder (não depois!)
  const webhookSecret = WISE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error({ deliveryId }, 'Webhook Wise: WISE_WEBHOOK_SECRET não configurado');
    res.status(500).json({ error: 'Webhook secret not configured' });
    return;
  }

  const validation = validateWiseWebhook(signature, payload, webhookSecret);
  if (!validation.valid) {
    logger.warn({ 
      deliveryId, 
      reason: validation.reason,
      signaturePresent: !!signature,
    }, 'Webhook Wise: Assinatura inválida - rejeitando');
    res.status(403).json({ error: 'Invalid signature' });
    return;
  }

  // Parse event early to get event_type for idempotency check
  let event: {
    event_type: string;
    data: {
      resource: {
        id: number;
        type: string;
        profile_id: number;
        state?: string;
        source_amount?: number;
        source_currency?: string;
        target_amount?: number;
        target_currency?: string;
        reference?: string;
      };
      current_state?: string;
      previous_state?: string;
      occurred_at: string;
    };
  };

  try {
    event = JSON.parse(payload);
  } catch (parseError) {
    logger.error({ error: parseError, deliveryId }, 'Webhook Wise: Falha ao parsear payload');
    res.status(400).json({ error: 'Invalid JSON payload' });
    return;
  }

  // IDEMPOTÊNCIA: Verificar se evento já foi processado usando deliveryId
  const db = getDatabase();
  const eventId = deliveryId || `wise-${event.data.resource.id}-${event.event_type}-${event.data.occurred_at}`;
  
  const { isDuplicate } = await checkWebhookIdempotency(
    db,
    'wise',
    eventId,
    event.event_type,
    event as unknown as Record<string, unknown>
  );

  if (isDuplicate) {
    res.status(200).json({ received: true, duplicate: true });
    return;
  }

  // Assinatura válida e não duplicado - responder 200 e processar
  res.status(200).json({ received: true });

  // Processar webhook de forma assíncrona (após validação e resposta)
  let processingResult: Record<string, unknown> = {};
  let processingError: string | undefined;

  try {
    logger.info({ 
      eventType: event.event_type, 
      resourceId: event.data.resource.id,
      deliveryId,
    }, 'Webhook Wise recebido e validado');

    // Processar eventos de transferência
    if (event.event_type === 'transfers#state-change') {
      const transfer = event.data.resource;
      const newState = event.data.current_state;

      // Sincronizar com ERPNext quando transferência for concluída
      if (newState === 'outgoing_payment_sent' || newState === 'funds_converted') {
        await syncToERPNext('payment', {
          payment_type: 'Pay',
          party_type: 'Supplier',
          party: transfer.reference || `Wise-${transfer.id}`,
          paid_amount: transfer.source_amount,
          paid_to_account_currency: transfer.source_currency,
          received_amount: transfer.target_amount,
          reference_no: `WISE-${transfer.id}`,
          reference_date: event.data.occurred_at.split('T')[0],
          mode_of_payment: 'Wise Transfer',
          custom_wise_transfer_id: transfer.id.toString(),
          custom_wise_state: newState,
        });

        logger.info({ transferId: transfer.id, state: newState }, 'Transferência Wise sincronizada com ERPNext');
        processingResult = { transferId: transfer.id, state: newState, action: 'synced_to_erpnext' };
      }
    }

    // Processar eventos de depósito (credit balance)
    if (event.event_type === 'balances#credit') {
      const balance = event.data.resource;
      
      // Registrar recebimento no ERPNext
      await syncToERPNext('payment', {
        payment_type: 'Receive',
        party_type: 'Customer',
        party: `Wise-Balance-${balance.id}`,
        paid_amount: balance.source_amount,
        paid_from_account_currency: balance.source_currency,
        reference_no: `WISE-CREDIT-${balance.id}`,
        reference_date: event.data.occurred_at.split('T')[0],
        mode_of_payment: 'Wise Deposit',
        custom_wise_balance_id: balance.id.toString(),
      });

      logger.info({ balanceId: balance.id }, 'Depósito Wise sincronizado com ERPNext');
      processingResult = { balanceId: balance.id, action: 'credit_synced' };
    }

  } catch (error) {
    processingError = error instanceof Error ? error.message : String(error);
    logger.error({ error, deliveryId }, 'Falha ao processar webhook Wise');
  }

  // Marcar webhook como processado (ou com erro)
  await markWebhookProcessed(db, 'wise', eventId, processingResult, processingError);
});

// Obter requisitos de conta por moeda
app.get('/api/integrations/wise/recipient-requirements', requirePermission('integrations:wise:read'), async (req: Request, res: Response) => {
  if (!isWiseConfigured()) {
    return res.status(503).json({ error: 'Wise não configurado' });
  }

  // OWASP API3: Validação Zod obrigatória de query params
  const queryResult = wiseRecipientRequirementsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    logger.warn({ errors: queryResult.error.flatten() }, 'Input inválido em /api/integrations/wise/recipient-requirements');
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }

  const { sourceCurrency, targetCurrency, sourceAmount } = queryResult.data;

  try {
    const requirements = await wiseService.getRecipientRequirements(
      sourceCurrency,
      targetCurrency,
      sourceAmount
    );
    res.json({ requirements });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter requisitos de destinatário Wise');
    res.status(500).json({ error: 'Falha ao obter requisitos' });
  }
});

// Status do Wise (não requer configuração para retornar status)
app.get('/api/integrations/wise/status', (_req: Request, res: Response) => {
  const profileId = getProfileIdSafe();
  res.json({
    configured: isWiseConfigured(),
    sandbox: getSandboxStatus(),
    profileId: profileId ? '***' + profileId.slice(-4) : null,
  });
});

// ============================================================
// TWILIO/WHATSAPP API - Mensagens e Webhooks
// Documentação: https://www.twilio.com/docs/messaging/webhooks
// Integração com Conversation Orchestrator para Handover/Takeover
// ============================================================

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;
// REGRA 6: Fail-fast em TODOS os ambientes - variável DEVE estar definida
const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL;
if (!CHAT_SERVICE_URL) {
  throw new Error('CHAT_SERVICE_URL é obrigatório (Regra 6 - fail-fast)');
}
const CHAT_SERVICE_URL_FINAL = CHAT_SERVICE_URL;

// URL do Training Service para coleta de dados de treinamento
// REGRA 6: Fail-fast em TODOS os ambientes - variável DEVE estar definida
// Alice MULTIMODAL: coleta dados de WhatsApp (texto, imagens, áudio) para aprendizado
const TRAINING_SERVICE_URL = process.env.TRAINING_SERVICE_URL;
if (!TRAINING_SERVICE_URL) {
  throw new Error('TRAINING_SERVICE_URL é obrigatório (Regra 6 - fail-fast)');
}
const TRAINING_SERVICE_URL_FINAL = TRAINING_SERVICE_URL;

// URL do RAG Service para indexação de mídia multimodal do WhatsApp
// REGRA 6: Fail-fast em TODOS os ambientes - variável DEVE estar definida
// Permite indexar imagens/áudios recebidos via WhatsApp no RAG
const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL;
if (!RAG_SERVICE_URL) {
  throw new Error('RAG_SERVICE_URL é obrigatório (Regra 6 - fail-fast)');
}
const RAG_SERVICE_URL_FINAL = RAG_SERVICE_URL;

/**
 * Valida assinatura do webhook Twilio
 * Segue especificação oficial: https://www.twilio.com/docs/usage/security
 * 
 * Algoritmo Twilio:
 * 1. Pegar URL completa do webhook
 * 2. Ordenar parâmetros POST alfabeticamente por chave
 * 3. Concatenar: URL + key1 + value1 + key2 + value2...
 * 4. HMAC-SHA1 com auth token
 * 5. Comparar base64 com X-Twilio-Signature
 */
function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>
): { valid: boolean; reason?: string } {
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (!TWILIO_AUTH_TOKEN) {
    if (isProduction) {
      logger.error('TWILIO_AUTH_TOKEN obrigatório em produção - webhook rejeitado');
      return { valid: false, reason: 'AUTH_TOKEN_MISSING' };
    }
    logger.warn('TWILIO_AUTH_TOKEN não configurado - validação ignorada em desenvolvimento');
    return { valid: true, reason: 'DEV_MODE_SKIP' };
  }

  if (!signature) {
    logger.warn('X-Twilio-Signature header ausente');
    return { valid: false, reason: 'SIGNATURE_MISSING' };
  }

  try {
    // Ordenar parâmetros alfabeticamente e concatenar
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + (params[key] || ''), '');
    
    const dataToSign = url + sortedParams;
    
    const expectedSignature = crypto
      .createHmac('sha1', TWILIO_AUTH_TOKEN)
      .update(new Uint8Array(Buffer.from(dataToSign, 'utf-8')))
      .digest('base64');

    // Usar timingSafeEqual para prevenir timing attacks
    const signatureBuffer = new Uint8Array(Buffer.from(signature));
    const expectedBuffer = new Uint8Array(Buffer.from(expectedSignature));
    
    if (signatureBuffer.length !== expectedBuffer.length) {
      return { valid: false, reason: 'SIGNATURE_LENGTH_MISMATCH' };
    }

    const isValid = crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
    return { valid: isValid, reason: isValid ? 'VALID' : 'SIGNATURE_MISMATCH' };
  } catch (error) {
    logger.error({ error }, 'Erro ao validar assinatura Twilio');
    return { valid: false, reason: 'VALIDATION_ERROR' };
  }
}

/**
 * Envia mensagem WhatsApp via Twilio
 */
async function sendWhatsAppMessage(to: string, body: string, mediaUrl?: string): Promise<{
  success: boolean;
  messageSid?: string;
  error?: string;
}> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_NUMBER) {
    logger.error('Twilio não configurado para envio de mensagens');
    return { success: false, error: 'Twilio não configurado' };
  }

  // RESILIÊNCIA: AbortController com timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_API_TIMEOUT_MS);

  try {
    const formData = new URLSearchParams();
    formData.append('From', `whatsapp:${TWILIO_WHATSAPP_NUMBER}`);
    formData.append('To', to.startsWith('whatsapp:') ? to : `whatsapp:${to}`);
    formData.append('Body', body);
    if (mediaUrl) {
      formData.append('MediaUrl', mediaUrl);
    }

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const errorData = await response.json() as { message?: string };
      throw new Error(errorData.message || `Twilio API error: ${response.status}`);
    }

    const data = await response.json() as { sid: string };
    logger.info({ messageSid: data.sid, to }, 'Mensagem WhatsApp enviada com sucesso');
    return { success: true, messageSid: data.sid };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error, to }, 'Falha ao enviar mensagem WhatsApp');
    return { success: false, error: errorMessage };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Resultado do processamento de mensagem via Chat Service
 * Inclui suporte para escalação automática (handover)
 */
interface ChatMessageResult {
  response: string | null;
  escalated: boolean;
  humanMode: boolean;
  trigger?: string;
  error?: string;
}

/**
 * Processa mensagem via Chat Service (LLM + RAG)
 * Integrado com sistema de Handover/Takeover para escalação automática
 * 
 * O chat-service agora verifica shouldEscalate() e pode retornar:
 * - escalated: true → Conversa foi escalada para agente humano
 * - humanMode: true → Conversa já está em modo humano
 * - response: string → Resposta normal do LLM
 */
async function processMessageWithLLM(
  conversationId: string,
  message: string,
  tenantId?: string
): Promise<ChatMessageResult> {
  // RESILIÊNCIA: AbortController com timeout para chamada ao chat-service
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s para LLM processing

  try {
    const response = await fetch(`${CHAT_SERVICE_URL_FINAL}/api/chat/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(tenantId && { 'X-Tenant-Id': tenantId }),
      },
      body: JSON.stringify({
        conversationId,
        content: message,
        role: 'user',
        channel: 'whatsapp',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Chat service error: ${response.status}`);
    }

    const data = await response.json() as {
      response?: string;
      escalated?: boolean;
      humanMode?: boolean;
      trigger?: string;
    };
    
    // Verificar se houve escalação automática
    if (data.escalated) {
      logger.info({
        conversationId,
        trigger: data.trigger,
        channel: 'whatsapp',
      }, 'Escalação automática detectada via WhatsApp');
      
      return {
        response: data.response || 'Um de nossos atendentes irá auxiliá-lo em breve. Por favor, aguarde.',
        escalated: true,
        humanMode: false,
        trigger: data.trigger,
      };
    }
    
    // Verificar se conversa está em modo humano
    if (data.humanMode) {
      logger.info({
        conversationId,
        channel: 'whatsapp',
      }, 'Conversa em modo humano - mensagem encaminhada para agente');
      
      return {
        response: null,
        escalated: false,
        humanMode: true,
      };
    }
    
    // Resposta normal do LLM
    return {
      response: data.response || '',
      escalated: false,
      humanMode: false,
    };
  } catch (error) {
    logger.error({ error, conversationId }, 'Falha ao processar mensagem com LLM');
    return {
      response: 'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.',
      escalated: false,
      humanMode: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Processa mídia recebida via WhatsApp e indexa no RAG
 * 
 * ARQUITETURA ENTERPRISE (17/12/2025):
 * - Imagens: OpenAI Vision (descrição textual, sem embeddings de imagem)
 * - Áudios: OpenAI ASR (gpt-4o-transcribe) + Qwen3-Embedding-0.6B embeddings (1024 dim → Qdrant)
 * - Vídeos: NÃO suportado (uploads `video/*` são rejeitados explicitamente)
 * 
 * @param mediaUrl - URL do Twilio para baixar a mídia
 * @param mediaContentType - MIME type da mídia
 * @param conversationId - ID da conversa para contexto
 * @param tenantId - ID do tenant para isolamento
 * @param userId - ID do usuário que enviou
 * @returns Promise com resultado do processamento
 */
async function processWhatsAppMediaForRAG(
  mediaUrl: string,
  mediaContentType: string,
  conversationId: string,
  tenantId: string,
  userId: string
): Promise<{ success: boolean; uploadId?: string; error?: string }> {
  // Determinar tipo de mídia
  // ATUALIZADO 23/12/2025: Apenas imagem e áudio são suportados (vídeo removido - muito pesado para GPU)
  // BUG FIX 23/12/2025: Validação defensiva explícita de tipos suportados ao invés de rejeitar tudo
  // Problema: Validação anterior rejeitava TODOS os tipos não-image/audio, incluindo edge cases futuros
  // Solução: Lista explícita de tipos suportados com mensagem de erro clara
  const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
  const SUPPORTED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4'] as const;
  
  // BUG FIX 23/12/2025: Normalização robusta de content-type para suportar variações de case e espaços
  // WhatsApp pode enviar tipos com variações (ex: "Image/Jpeg", "audio/mpeg; codecs=mp3")
  // .toLowerCase() e .trim() garantem matching correto mesmo com variações
  // Extrair apenas o tipo base (antes de ;) para suportar parâmetros adicionais
  const normalizedContentType = mediaContentType.toLowerCase().trim().split(';')[0].trim();
  
  // BUG FIX 23/12/2025: Validação com type narrowing explícito para garantir type safety
  // includes() com type assertion garante que TypeScript entenda o tipo correto
  // Isso previne falsos negativos onde tipos legítimos são rejeitados por problemas de case/whitespace
  const isImage = SUPPORTED_IMAGE_TYPES.includes(normalizedContentType as typeof SUPPORTED_IMAGE_TYPES[number]);
  const isAudio = SUPPORTED_AUDIO_TYPES.includes(normalizedContentType as typeof SUPPORTED_AUDIO_TYPES[number]);
  
  // Validação defensiva: apenas tipos explicitamente suportados são aceitos
  if (!isImage && !isAudio) {
    logger.warn({
      mediaContentType: normalizedContentType,
      originalContentType: mediaContentType,
      conversationId,
      supportedTypes: {
        image: SUPPORTED_IMAGE_TYPES,
        audio: SUPPORTED_AUDIO_TYPES,
      },
    }, 'Tipo de mídia WhatsApp não suportado para RAG - apenas imagem e áudio são aceitos');
    return { 
      success: false, 
      error: `Tipo de mídia não suportado: ${mediaContentType}. Tipos suportados: imagens (${SUPPORTED_IMAGE_TYPES.join(', ')}) e áudio (${SUPPORTED_AUDIO_TYPES.join(', ')}).` 
    };
  }
  
  // RESILIÊNCIA: AbortController com timeout de 60s para download + upload
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  
  try {
    // Passo 1: Baixar mídia do Twilio (requer autenticação Basic)
    const twilioAuthHeader = Buffer.from(
      `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
    ).toString('base64');
    
    const mediaResponse = await fetch(mediaUrl, {
      headers: {
        'Authorization': `Basic ${twilioAuthHeader}`,
      },
      signal: controller.signal,
    });
    
    if (!mediaResponse.ok) {
      throw new Error(`Falha ao baixar mídia do Twilio: ${mediaResponse.status}`);
    }
    
    const mediaBuffer = Buffer.from(await mediaResponse.arrayBuffer());
    const mediaBase64 = mediaBuffer.toString('base64');
    
    // Determinar extensão do arquivo
    // ATUALIZADO 23/12/2025: Removido suporte a vídeo (muito pesado para GPU)
    // BUG FIX 23/12/2025: Usar normalizedContentType ao invés de mediaContentType para lookup
    // Problema: extensionMap tem chaves em lowercase, mas mediaContentType pode vir em mixed case (ex: Image/JPEG)
    // Se usar mediaContentType original, lookup falha e retorna 'bin' como fallback incorreto
    // Solução: Usar normalizedContentType (já convertido para lowercase) para lookup correto
    const extensionMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/wav': 'wav',
      'audio/webm': 'webm',
    };
    const extension = extensionMap[normalizedContentType] || 'bin';
    const mediaType = isImage ? 'image' : 'audio';
    
    // Gerar headers de autenticação interna
    // Role válidos: super_admin, admin, manager, operator, viewer, guest
    // 'operator' é apropriado para processamento automatizado de mídia
    const internalHeaders = generateInternalAuthHeaders({
      userId,
      tenantId,
      role: 'operator',
    });
    
    // Passo 2: Enviar para RAG Service via endpoint JSON (mais eficiente para base64)
    const ragResponse = await fetch(`${RAG_SERVICE_URL_FINAL}/api/media/upload/json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Signature': internalHeaders['x-internal-signature'],
        'X-Internal-Timestamp': internalHeaders['x-internal-timestamp'],
        'X-Tenant-Id': tenantId,
        'X-User-Id': userId,
      },
      body: JSON.stringify({
        // Bug fix: Campo deve ser 'file', não 'base64Data' (conforme jsonUploadSchema do RAG service)
        file: mediaBase64,
        filename: `whatsapp_${Date.now()}.${extension}`,
        mimeType: mediaContentType,
        description: `Mídia recebida via WhatsApp na conversa ${conversationId}`,
        conversationId,
      }),
      signal: controller.signal,
    });
    
    if (!ragResponse.ok) {
      const errorText = await ragResponse.text();
      throw new Error(`Falha ao enviar mídia para RAG: ${ragResponse.status} - ${errorText}`);
    }
    
    const ragData = await ragResponse.json() as { id?: string; uploadId?: string };
    const uploadId = ragData.id || ragData.uploadId;
    
    logger.info({
      uploadId,
      mediaType,
      conversationId,
      tenantId,
      sizeBytes: mediaBuffer.length,
    }, 'Mídia WhatsApp indexada no RAG com sucesso');
    
    return { success: true, uploadId };
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      mediaUrl,
      conversationId,
      tenantId,
    }, 'Erro ao processar mídia WhatsApp para RAG');
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Webhook principal para mensagens WhatsApp recebidas
 * Rota: POST /api/integrations/twilio/webhook/whatsapp
 */
app.post('/api/integrations/twilio/webhook/whatsapp', async (req: Request, res: Response) => {
  const twilioSignature = req.headers['x-twilio-signature'] as string;
  const webhookUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  const contentTypeHeader = req.headers['content-type'];
  const contentType = Array.isArray(contentTypeHeader)
    ? contentTypeHeader[0]?.toLowerCase()
    : contentTypeHeader?.toLowerCase();
  if (!contentType || !contentType.startsWith('application/x-www-form-urlencoded')) {
    logger.warn({ contentType }, 'Webhook Twilio: content-type inválido');
    return res.status(400).send('Invalid content-type');
  }

  if (!TWILIO_AUTH_TOKEN) {
    logger.error('Webhook Twilio: TWILIO_AUTH_TOKEN não configurado');
    return res.status(500).send('Webhook secret not configured');
  }

  // SEGURANÇA: Validar que body é objeto (urlencoded produz objeto, não Buffer)
  // NOTA: express.urlencoded() sempre produz objeto Record<string, string>, nunca Buffer
  // DIFERENÇA COM STRIPE: Stripe usa express.raw() (Buffer), Twilio usa express.urlencoded() (objeto)
  // Se body for Buffer, significa que middleware incorreto foi aplicado (deveria ser urlencoded)
  if (Buffer.isBuffer(req.body)) {
    logger.error('Webhook Twilio: body é Buffer mas deveria ser objeto (middleware incorreto - use express.urlencoded(), não express.raw())');
    return res.status(500).send('Invalid middleware configuration');
  }
  // Validar que é objeto válido (não null, não primitivo)
  if (typeof req.body !== 'object' || req.body === null) {
    logger.error('Webhook Twilio: body inválido (deve ser objeto parseado por urlencoded)');
    return res.status(500).send('Invalid body format');
  }

  // CRÍTICO: Validar assinatura ANTES de responder
  const validation = validateTwilioSignature(
    twilioSignature,
    webhookUrl,
    req.body as Record<string, string>
  );

  if (!validation.valid) {
    logger.warn({ webhookUrl, reason: validation.reason }, 'Assinatura Twilio inválida - webhook rejeitado');
    res.status(403).send('Forbidden');
    return;
  }

  // Responder ao Twilio após validação bem-sucedida
  res.set('Content-Type', 'text/xml');
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

  // Processar webhook de forma assíncrona (após resposta enviada)
  try {
    // OWASP API3 - Validação Zod (não rejeita por falha pois já respondemos 200)
    const parseResult = twilioWebhookSchema.safeParse(req.body);
    if (!parseResult.success) {
      logger.warn({ errors: parseResult.error.flatten() }, 'Payload Twilio inválido');
      return;
    }
    const {
      MessageSid,
      From,
      To,
      Body,
      NumMedia,
      MediaUrl0,
      MediaContentType0,
    } = parseResult.data;

    logger.info({
      messageSid: MessageSid,
      from: From,
      hasMedia: parseInt(NumMedia || '0') > 0,
    }, 'Webhook WhatsApp recebido');

    const db = getDatabase();

    // Normalizar número de telefone (remover 'whatsapp:')
    const phoneNumber = From.replace('whatsapp:', '');

    // Buscar ou criar usuário pelo telefone
    let user = await db.query.users.findFirst({
      where: eq(schema.users.telefone, phoneNumber),
    });

    if (!user) {
      // Criar usuário temporário para WhatsApp
      const [newUser] = await db.insert(schema.users).values({
        email: `whatsapp_${phoneNumber.replace(/\+/g, '')}@temp.alice.app`,
        telefone: phoneNumber,
        firstName: 'WhatsApp',
        lastName: `User ${phoneNumber.slice(-4)}`,
        authProvider: 'whatsapp',
        role: 'guest',
      }).returning();
      user = newUser;
      logger.info({ userId: user.id, phone: phoneNumber }, 'Novo usuário WhatsApp criado');
    }

    // Buscar ou criar conversa ativa para este usuário via WhatsApp
    let conversation = await db.query.conversations.findFirst({
      where: (c, { and, eq: e }) => and(
        e(c.userId, user.id),
        e(c.status, 'active'),
        e(c.metadata, sql`metadata->>'channel' = 'whatsapp'`)
      ),
      orderBy: [desc(schema.conversations.criadoEm)],
    });

    if (!conversation) {
      // Criar nova conversa para WhatsApp
      const [newConversation] = await db.insert(schema.conversations).values({
        userId: user.id,
        titulo: `WhatsApp - ${phoneNumber}`,
        status: 'active',
        metadata: {
          channel: 'whatsapp',
          phoneNumber,
          twilioFrom: From,
          twilioTo: To,
        },
      }).returning();
      conversation = newConversation;
      logger.info({ conversationId: conversation.id }, 'Nova conversa WhatsApp criada');
    }

    // Salvar mensagem do usuário
    await db.insert(schema.messages).values({
      conversationId: conversation.id,
      userId: user.id,
      isFromUser: true,
      conteudo: Body,
      tipo: parseInt(NumMedia || '0') > 0 ? 'mixed' : 'text',
      metadata: {
        twilioMessageSid: MessageSid,
        mediaUrl: MediaUrl0,
        mediaContentType: MediaContentType0,
        channel: 'whatsapp',
      },
    });

    // ARQUITETURA 100% GPU (15/12/2025): Processar mídia WhatsApp para RAG
    // Executa em background (fire-and-forget) para não bloquear a resposta ao usuário
    // Mídia será indexada com embeddings (imagem) ou transcrita + embeddings (áudio/vídeo)
    if (MediaUrl0 && MediaContentType0 && user.tenantId) {
      processWhatsAppMediaForRAG(
        MediaUrl0,
        MediaContentType0,
        conversation.id,
        user.tenantId,
        user.id
      ).catch(err => {
        logger.error({
          error: err instanceof Error ? err.message : String(err),
          mediaUrl: MediaUrl0,
          conversationId: conversation.id,
        }, 'Erro ao processar mídia WhatsApp para RAG (não crítico)');
      });
    }

    // Verificar estado de handover/takeover
    const conversationState = await db.query.conversationStates.findFirst({
      where: eq(schema.conversationStates.conversationId, conversation.id),
    });

    // Se a conversa está em modo humano, não responder automaticamente
    if (conversationState?.controlMode === 'human') {
      logger.info({
        conversationId: conversation.id,
        controlMode: 'human',
      }, 'Conversa em modo humano - mensagem salva sem resposta automática');

      // Notificar agente humano via chat-service WebSocket
      // RESILIÊNCIA: AbortController com timeout curto para notificação
      const notifyController = new AbortController();
      const notifyTimeoutId = setTimeout(() => notifyController.abort(), 5000);
      try {
        await fetch(`${CHAT_SERVICE_URL_FINAL}/api/chat/notify-agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: conversation.id,
            type: 'new_message',
            message: Body,
            from: phoneNumber,
          }),
          signal: notifyController.signal,
        });
      } catch (notifyError) {
        logger.warn({ error: notifyError }, 'Falha ao notificar agente humano');
      } finally {
        clearTimeout(notifyTimeoutId);
      }
      return;
    }

    // Processar mensagem com LLM via Chat Service
    // Inclui verificação automática de handover/escalação
    const chatResult = await processMessageWithLLM(
      conversation.id,
      Body,
      user.tenantId ?? undefined
    );

    // Se conversa está em modo humano, não enviar resposta automática
    if (chatResult.humanMode) {
      logger.info({
        conversationId: conversation.id,
        channel: 'whatsapp',
      }, 'Conversa em modo humano - aguardando resposta do agente');
      return;
    }

    // Se houve escalação automática, enviar mensagem de notificação
    if (chatResult.escalated) {
      logger.info({
        conversationId: conversation.id,
        trigger: chatResult.trigger,
        channel: 'whatsapp',
      }, 'Escalação automática processada via WhatsApp');
      
      // Salvar mensagem de escalação
      await db.insert(schema.messages).values({
        conversationId: conversation.id,
        isFromUser: false,
        conteudo: chatResult.response || 'Um de nossos atendentes irá auxiliá-lo em breve.',
        tipo: 'text',
        metadata: {
          channel: 'whatsapp',
          escalated: true,
          escalationTrigger: chatResult.trigger,
        },
      });
      
      // Enviar notificação de escalação via WhatsApp
      const escalationMessage = chatResult.response || 'Um de nossos atendentes irá auxiliá-lo em breve. Por favor, aguarde.';
      const sendResult = await sendWhatsAppMessage(From, escalationMessage);
      
      if (!sendResult.success) {
        logger.error({
          conversationId: conversation.id,
          error: sendResult.error,
        }, 'Falha ao enviar notificação de escalação WhatsApp');
      }
      
      return;
    }

    // Resposta normal do LLM
    if (chatResult.response) {
      // Salvar resposta do bot
      await db.insert(schema.messages).values({
        conversationId: conversation.id,
        isFromUser: false,
        conteudo: chatResult.response,
        tipo: 'text',
        metadata: {
          channel: 'whatsapp',
          generatedBy: 'llm',
        },
      });

      // Enviar resposta via WhatsApp
      const sendResult = await sendWhatsAppMessage(From, chatResult.response);

      if (!sendResult.success) {
        logger.error({
          conversationId: conversation.id,
          error: sendResult.error,
        }, 'Falha ao enviar resposta WhatsApp');
      }

      // GAP CRÍTICO #2: Coletar dados de treinamento para WhatsApp
      // Alice MULTIMODAL: coleta dados de texto, imagens, áudio, vídeo do WhatsApp para aprendizado
      // Rating inferido: se não houve escalação = positivo (5), se houve = negativo (1)
      // REGRA 6: Enterprise-grade - integração real com training-service (sem mocks)
      try {
        const rating = chatResult.escalated ? 1 : 5; // Inferir rating baseado em escalação
        
        // VALIDAÇÃO: Só coletar dados se houver resposta válida do LLM
        // Previne coleta de dados malformados (rating alto com resposta vazia)
        const hasValidResponse = chatResult.response && chatResult.response.trim().length > 0;
        
        // Coletar dados apenas se:
        // 1. Rating >= 4 (positivo) E houver resposta válida, OU
        // 2. Houve escalação (para aprendizado negativo) E houver resposta válida
        if ((rating >= 4 || chatResult.escalated) && hasValidResponse) {
          // conversations não possui objeto agent; usar namespaceId já persistido na conversa
          const namespaceId = conversation.namespaceId || undefined;
          const tenantId = user.tenantId;
          
          if (tenantId) {
            // Gerar headers de autenticação interna para training-service
            const internalHeaders = generateInternalAuthHeaders({
              userId: user.id,
              tenantId: tenantId,
              role: 'super_admin', // Service-to-service usa role privilegiado
            });
            
            // RESILIÊNCIA: AbortController com timeout para prevenir hang
            const trainingController = new AbortController();
            const trainingTimeoutId = setTimeout(() => trainingController.abort(), 10000); // 10s timeout
            
            try {
              // Chamar training-service para coletar dados
              const trainingResponse = await fetch(`${TRAINING_SERVICE_URL_FINAL}/api/training/data`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Internal-Signature': internalHeaders['x-internal-signature'],
                  'X-Internal-Timestamp': internalHeaders['x-internal-timestamp'],
                  'X-Internal-User-Id': user.id,
                  'X-Internal-Tenant-Id': tenantId,
                  'X-Internal-Role': 'super_admin',
                },
                body: JSON.stringify({
                  tenantId: tenantId,
                  namespaceId: namespaceId || undefined,
                  conversationId: conversation.id,
                  source: 'whatsapp', // Fonte: WhatsApp
                  messages: [
                    { role: 'user', content: Body },
                    { role: 'assistant', content: chatResult.response },
                  ],
                  rating: rating,
                }),
                signal: trainingController.signal,
              });
              
              if (!trainingResponse.ok) {
                const errorText = await trainingResponse.text();
                logger.error({ 
                  conversationId: conversation.id, 
                  status: trainingResponse.status,
                  error: errorText,
                }, 'Falha ao coletar dados de treinamento do WhatsApp');
              } else {
                const trainingData = await trainingResponse.json() as { trainingData?: { id: string }; isDuplicate?: boolean };
                logger.info({ 
                  conversationId: conversation.id, 
                  trainingDataId: trainingData.trainingData?.id,
                  isDuplicate: trainingData.isDuplicate,
                  rating: rating,
                  source: 'whatsapp',
                }, 'Dados de treinamento do WhatsApp coletados com sucesso');
              }
            } finally {
              clearTimeout(trainingTimeoutId);
            }
          }
        }
      } catch (trainingError) {
        // Não falhar o webhook se coleta de treinamento falhar (não crítico)
        logger.error({ error: trainingError, conversationId: conversation.id }, 'Erro ao coletar dados de treinamento do WhatsApp (não crítico)');
      }
    }

  } catch (error) {
    logger.error({ error }, 'Erro ao processar webhook WhatsApp');
  }
});

/**
 * Webhook para status de mensagens Twilio
 * Rota: POST /api/integrations/twilio/webhook/status
 */
app.post('/api/integrations/twilio/webhook/status', async (req: Request, res: Response) => {
  const twilioSignature = req.headers['x-twilio-signature'] as string;
  const webhookUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  const contentTypeHeader = req.headers['content-type'];
  const contentType = Array.isArray(contentTypeHeader)
    ? contentTypeHeader[0]?.toLowerCase()
    : contentTypeHeader?.toLowerCase();
  if (!contentType || !contentType.startsWith('application/x-www-form-urlencoded')) {
    logger.warn({ contentType }, 'Webhook Twilio status: content-type inválido');
    return res.status(400).send('Invalid content-type');
  }

  if (!TWILIO_AUTH_TOKEN) {
    logger.error('Webhook Twilio: TWILIO_AUTH_TOKEN não configurado');
    return res.status(500).send('Webhook secret not configured');
  }

  // SEGURANÇA: Validar que body é objeto (urlencoded produz objeto, não Buffer)
  // NOTA: express.urlencoded() sempre produz objeto Record<string, string>, nunca Buffer
  // Se alguém adicionar verificação Buffer.isBuffer() aqui, sempre falhará incorretamente
  if (Buffer.isBuffer(req.body) || typeof req.body !== 'object' || req.body === null) {
    logger.error('Webhook Twilio status: body inválido (deve ser objeto parseado por urlencoded, não Buffer)');
    return res.status(500).send('Invalid body format');
  }

  // CRÍTICO: Validar assinatura ANTES de responder
  const validation = validateTwilioSignature(
    twilioSignature,
    webhookUrl,
    req.body as Record<string, string>
  );

  if (!validation.valid) {
    logger.warn({ webhookUrl, reason: validation.reason }, 'Assinatura Twilio inválida - status webhook rejeitado');
    res.status(403).send('Forbidden');
    return;
  }

  // Responder ao Twilio após validação bem-sucedida
  res.set('Content-Type', 'text/xml');
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

  try {
    // OWASP API3 - Validação Zod (não rejeita por falha pois já respondemos 200)
    const parseResult = twilioStatusSchema.safeParse(req.body);
    if (!parseResult.success) {
      logger.warn({ errors: parseResult.error.flatten() }, 'Payload status Twilio inválido');
      return;
    }
    const {
      MessageSid,
      MessageStatus,
      ErrorCode,
      ErrorMessage,
      To,
    } = parseResult.data;

    logger.info({
      messageSid: MessageSid,
      status: MessageStatus,
      errorCode: ErrorCode,
      to: To,
    }, 'Status de mensagem Twilio recebido');

    // Atualizar metadata da mensagem com status
    if (MessageStatus === 'failed' || MessageStatus === 'undelivered') {
      logger.error({
        messageSid: MessageSid,
        status: MessageStatus,
        errorCode: ErrorCode,
        errorMessage: ErrorMessage,
      }, 'Mensagem WhatsApp falhou na entrega');

      // Registrar falha em audit log se necessário
      const db = getDatabase();
      await db.insert(schema.auditLogs).values({
        acao: 'whatsapp_delivery_failed',
        recurso: 'message',
        detalhes: {
          messageSid: MessageSid,
          status: MessageStatus,
          errorCode: ErrorCode,
          errorMessage: ErrorMessage,
          to: To,
        },
      });
    }
  } catch (error) {
    logger.error({ error }, 'Erro ao processar webhook de status Twilio');
  }
});

/**
 * Enviar mensagem WhatsApp manualmente (para handover humano)
 * Rota: POST /api/integrations/twilio/send
 */
app.post('/api/integrations/twilio/send', requirePermission('integrations:twilio:write'), async (req: Request, res: Response) => {
  // OWASP API3 - Validação Zod obrigatória
  const parseResult = twilioSendSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Input inválido' });
  }
  const { to, message, conversationId, mediaUrl } = parseResult.data;

  try {
    const result = await sendWhatsAppMessage(to, message, mediaUrl);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    // Se conversationId fornecido, salvar mensagem no histórico
    if (conversationId) {
      const db = getDatabase();
      const authContext = extractAuthContext(req);

      await db.insert(schema.messages).values({
        conversationId,
        userId: authContext?.userId,
        isFromUser: false,
        conteudo: message,
        tipo: mediaUrl ? 'mixed' : 'text',
        metadata: {
          channel: 'whatsapp',
          twilioMessageSid: result.messageSid,
          sentByAgent: true,
          mediaUrl,
        },
      });
    }

    res.json({ success: true, messageSid: result.messageSid });
  } catch (error) {
    logger.error({ error, to }, 'Falha ao enviar mensagem WhatsApp');
    res.status(500).json({ error: 'Falha ao enviar mensagem' });
  }
});

/**
 * Status da integração Twilio
 * Rota: GET /api/integrations/twilio/status
 */
app.get('/api/integrations/twilio/status', (_req: Request, res: Response) => {
  const configured = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_NUMBER);
  res.json({
    configured,
    accountSid: TWILIO_ACCOUNT_SID ? '***' + TWILIO_ACCOUNT_SID.slice(-4) : null,
    whatsappNumber: TWILIO_WHATSAPP_NUMBER ? TWILIO_WHATSAPP_NUMBER.slice(-4) : null,
  });
});

// ============================================================================
// TRADING: KuCoin Futures BTC Perpetuals
// Sistema enterprise-grade para trading automatizado (modelo LLM é agnóstico).
// ============================================================================

// Inicializar métricas do circuit breaker KuCoin
kucoinClient.initKucoinMetrics(metrics);

// ============================================================================
// WS5: KuCoin WebSocket (REST + WS) - readiness operacional
// ============================================================================
// Objetivo:
// - Garantir conectividade WS (public + private quando credenciais existirem)
// - Expor estado da conexão para a UI/observabilidade
// - Sem depender de in-memory para dados de negócio (market data continua via REST)
//
// NOTA: conexão WS pode falhar por motivos transitórios (rede/upstream).
// A estratégia é:
// - Inicializar em background (não bloquear startup do serviço)
// - Reconnect automático é responsabilidade do cliente (kucoinWebSocket.ts)
// - Expor status para o dashboard/UI e logs estruturados
// ============================================================================
if (kucoinClient.isKucoinConfigured()) {
  initializeKucoinWebSocketClients()
    .then(() => {
      initializeBroadcast()
        .then((status) => {
          if (!status.publisher) {
            logger.warn('Broadcast de trading iniciado sem publisher (Redis indisponível)');
          }
          const publisher = getPublisher();
          const publicWs = getPublicWebSocketClient();
          const privateWs = isKucoinWebSocketConfigured() ? getPrivateWebSocketClient() : null;
          const privateTenantId = KUCOIN_TENANT_ID;

          publicWs.on('ticker', (data) => {
            void publisher.publishTicker(data.symbol, data).catch((error) => {
              logger.error({ error }, 'Falha ao publicar ticker de trading');
            });
          });

          publicWs.on('orderbook', (data) => {
            void publisher.publishOrderBook(data.symbol, data).catch((error) => {
              logger.error({ error }, 'Falha ao publicar orderbook de trading');
            });
          });

          publicWs.on('kline', (data) => {
            void publisher.publishKlines(data.symbol, data).catch((error) => {
              logger.error({ error }, 'Falha ao publicar kline de trading');
            });
          });

          publicWs.on('trade', (data) => {
            void publisher.publishTrades(data.symbol, data).catch((error) => {
              logger.error({ error }, 'Falha ao publicar trades de trading');
            });
          });

          if (privateWs) {
            if (!privateTenantId) {
              logger.warn('KUCOIN_TENANT_ID/TRADING_TENANT_ID não definido - eventos privados não serão publicados');
            } else {
              privateWs.on('order', (data) => {
                void publisher.publishOrderUpdate(privateTenantId, data).catch((error) => {
                  logger.error({ error }, 'Falha ao publicar ordens de trading');
                });
              });
              privateWs.on('position', (data) => {
                void publisher.publishPositionUpdate(privateTenantId, data).catch((error) => {
                  logger.error({ error }, 'Falha ao publicar posições de trading');
                });
              });
              privateWs.on('balance', (data) => {
                void publisher.publishBalanceUpdate(privateTenantId, data).catch((error) => {
                  logger.error({ error }, 'Falha ao publicar balance de trading');
                });
              });
            }
          }
        })
        .catch((error) => {
          logger.error({ error }, 'Falha ao inicializar broadcast de trading');
          if (process.env.NODE_ENV === 'production') {
            process.exit(1);
          }
        });

      // Subscrições mínimas (reduz custo/cardi nalidade): default symbol
      const symbol = kucoinClient.getDefaultSymbol();
      const publicWs = getPublicWebSocketClient();
      publicWs.subscribeTicker(symbol);
      publicWs.subscribeOrderBook(symbol, 50);

      if (isKucoinWebSocketConfigured()) {
        // Canais privados úteis para auditoria/operacional (ordens/posição/wallet)
        const privateWs = getPrivateWebSocketClient();
        privateWs.subscribeOrders();
        privateWs.subscribePosition(symbol);
        privateWs.subscribeBalance();
      }

      // WS5: wiring de métricas operacionais (state/connected/reconnect/errors)
      wireKucoinWebSocketMetrics({
        publicWs,
        privateWs: isKucoinWebSocketConfigured() ? getPrivateWebSocketClient() : null,
        privateEnabled: isKucoinWebSocketConfigured(),
      });

      logger.info({ symbol, privateEnabled: isKucoinWebSocketConfigured() }, 'KuCoin WebSocket inicializado (public + private)');
    })
    .catch((error: unknown) => {
      // Não derrubar o serviço inteiro por instabilidade transitória do upstream.
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Falha ao inicializar KuCoin WebSocket (trading seguirá via REST; WS pode ficar degraded)'
      );
    });
}

function getAllowedKucoinSymbolsMessage(): string {
  return kucoinClient.getAllowedSymbols().join(', ');
}

function respondKucoinNotConfigured(res: Response): void {
  res.status(503).json({ error: 'API KuCoin não configurada' });
}

function assertValidTradingSymbol(res: Response, symbol: string): boolean {
  if (!kucoinClient.isValidSymbol(symbol)) {
    res.status(400).json({
      error: `Símbolo inválido: ${symbol}. Valores permitidos: ${getAllowedKucoinSymbolsMessage()}.`,
    });
    return false;
  }
  return true;
}

const KUCOIN_ALLOWED_GRANULARITIES_MINUTES = [
  1, 3, 5, 15, 30, 60, 120, 240, 480, 720, 1440, 10080,
] as const;

// GET /api/integrations/trading/status - Status do serviço de trading
app.get('/api/integrations/trading/status', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    
    // BUG FIX 13/01/2026: Retornar isConfigured mesmo sem tenantId para mostrar status correto na UI
    // Trading pode estar configurado (secrets existem) mas usuário não tem tenant associado
    // UI precisa saber se KuCoin está configurado para mostrar mensagem correta
    const isConfigured = kucoinClient.isKucoinConfigured();
    const isSandbox = kucoinClient.getKucoinSandboxStatus();
    const circuitBreakerStatus = kucoinClient.getKucoinCircuitBreakerStatus();
    
    // Se não tem tenantId, retornar apenas status de configuração (sem dados do tenant)
    if (!authContext?.tenantId || !authContext?.userId) {
      res.json({
        success: true,
        data: {
          isConfigured,
          isSandbox,
          circuitBreaker: circuitBreakerStatus,
          riskConfig: null,
          activeSignals: 0,
          pendingOrders: 0,
          requiresTenant: true, // Flag para UI saber que precisa de tenant
        },
      });
      return;
    }

    const status = await kucoinService.getTradingServiceStatus({
      tenantId: authContext.tenantId,
      userId: authContext.userId,
    });

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter status do trading');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/ws/status - Status do WebSocket KuCoin (public/private)
app.get('/api/integrations/trading/ws/status', requirePermission('integrations:trading:read'), (_req: Request, res: Response) => {
  const configured = kucoinClient.isKucoinConfigured();
  if (!configured) {
    res.json({
      success: true,
      data: {
        configured: false,
        public: { state: 'disconnected' },
        private: { enabled: false, state: 'disconnected' },
      },
    });
    return;
  }

  const publicWs = getPublicWebSocketClient();
  const privateEnabled = isKucoinWebSocketConfigured();
  const privateWs = privateEnabled ? getPrivateWebSocketClient() : null;

  res.json({
    success: true,
    data: {
      configured: true,
      allowedSymbols: kucoinClient.getAllowedSymbols(),
      defaultSymbol: kucoinClient.getDefaultSymbol(),
      public: { state: publicWs.getState() },
      private: { enabled: privateEnabled, state: privateWs?.getState() ?? 'disconnected' },
    },
  });
});

// GET /api/integrations/trading/market/:symbol - Dados de mercado
app.get('/api/integrations/trading/market/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    if (!assertValidTradingSymbol(res, symbol)) return;

    const marketData = await kucoinService.getMarketData(symbol);
    
    res.json({
      success: true,
      data: marketData,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter dados de mercado');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/account - Visão geral da conta KuCoin
app.get('/api/integrations/trading/account', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    const account = await kucoinService.getAccountOverview();
    
    res.json({
      success: true,
      data: account,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter dados da conta');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/positions - Posições abertas na KuCoin
app.get('/api/integrations/trading/positions', requirePermission('integrations:trading:read'), async (_req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    const positions = await kucoinService.getKucoinPositions();
    
    res.json({
      success: true,
      data: positions,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter posições');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/risk-config - Configuração de risco do tenant
app.get('/api/integrations/trading/risk-config', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const config = await kucoinService.getRiskConfig({
      tenantId: authContext.tenantId,
      userId: authContext.userId,
    });

    res.json({
      success: true,
      data: config,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter configuração de risco');
    res.status(500).json({ error: errorMessage });
  }
});

// PUT /api/integrations/trading/risk-config - Atualizar configuração de risco
app.put('/api/integrations/trading/risk-config', requirePermission('integrations:trading:manage'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    // CORREÇÃO 17/12/2025: Schema Zod alinhado com colunas reais do banco
    // Bug: maxDailyOrders e allowedSymbols não existiam no tradingRiskConfig
    // Removidos campos inexistentes que causariam erro no Drizzle ORM
    const configSchema = z.object({
      // Limites de risco (valores numéricos como string para precisão decimal)
      maxPositionSize: z.string().optional(),  // % do capital por posição
      maxDailyLoss: z.string().optional(),     // % perda diária máxima
      maxOrderValue: z.string().optional(),    // Valor máximo por ordem em USD
      maxLeverage: z.number().optional(),      // Alavancagem máxima
      maxOpenPositions: z.number().optional(), // Máximo de posições abertas
      // Configurações de execução
      defaultLeverage: z.number().optional(),
      defaultStopLoss: z.string().optional(),
      defaultTakeProfit: z.string().optional(),
      // Controles
      tradingEnabled: z.boolean().optional(),
      autoExecuteSignals: z.boolean().optional(),
      minConfidenceToExecute: z.string().optional(),
    });

    const validatedResult = configSchema.safeParse(req.body);
    if (!validatedResult.success) {
      res.status(400).json({ error: 'Dados inválidos', details: validatedResult.error.flatten() });
      return;
    }
    const validated = validatedResult.data;

    // CORREÇÃO 18/12/2025: Converter strings para numbers onde necessário
    // Schema Zod usa string para precisão decimal, mas DB usa number
    const configForDb = {
      maxPositionSize: validated.maxPositionSize ? Number(validated.maxPositionSize) : undefined,
      maxDailyLoss: validated.maxDailyLoss ? Number(validated.maxDailyLoss) : undefined,
      maxOrderValue: validated.maxOrderValue ? Number(validated.maxOrderValue) : undefined,
      maxLeverage: validated.maxLeverage,
      maxOpenPositions: validated.maxOpenPositions,
      defaultLeverage: validated.defaultLeverage,
      defaultStopLoss: validated.defaultStopLoss ? Number(validated.defaultStopLoss) : undefined,
      defaultTakeProfit: validated.defaultTakeProfit ? Number(validated.defaultTakeProfit) : undefined,
      tradingEnabled: validated.tradingEnabled,
      autoExecuteSignals: validated.autoExecuteSignals,
      minConfidenceToExecute: validated.minConfidenceToExecute ? Number(validated.minConfidenceToExecute) : undefined,
    };

    const result = await kucoinService.upsertRiskConfig(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      configForDb
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao atualizar configuração de risco');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/signals - Lista sinais de trading ativos
app.get('/api/integrations/trading/signals', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(200).optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }

    const limit = queryResult.data.limit ?? 10;
    const signals = await kucoinService.getActiveSignals(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      limit
    );

    res.json({
      success: true,
      data: signals,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter sinais');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/signals - Criar sinal de trading (do LLM)
app.post('/api/integrations/trading/signals', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    // CORREÇÃO 18/12/2025: signalType alinhado com enum do banco de dados
    const signalSchema = z.object({
      signalType: z.enum(['entry_long', 'entry_short', 'exit', 'adjust_sl', 'adjust_tp', 'hold', 'neutral']),
      symbol: z.string().optional(),
      confidence: z.number().min(0).max(1),
      reasoning: z.string().optional(),
      sourceModel: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    });

    const validatedResult = signalSchema.safeParse(req.body);
    if (!validatedResult.success) {
      res.status(400).json({ error: 'Dados inválidos', details: validatedResult.error.flatten() });
      return;
    }
    const validated = validatedResult.data;

    const result = await kucoinService.createSignal(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      validated
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(201).json({
      success: true,
      data: result.data,
      auditLogId: result.auditLogId,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar sinal');
    res.status(500).json({ error: errorMessage });
  }
});

// Schema para ID UUID de trading (sinais, ordens, etc.)
const tradingUuidParamSchema = z.object({
  id: z.string().uuid('ID deve ser UUID válido'),
});

// DELETE /api/integrations/trading/signals/:id - Desativar sinal
app.delete('/api/integrations/trading/signals/:id', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    // OWASP API3: Validação de parâmetro de rota
    const paramResult = tradingUuidParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
      return;
    }

    const { id } = paramResult.data;
    const result = await kucoinService.deactivateSignal(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      id
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao desativar sinal');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/orders - Lista ordens
app.get('/api/integrations/trading/orders', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const querySchema = z.object({
      status: z.enum(['pending', 'open', 'filled', 'cancelled', 'rejected', 'expired']).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }

    const status = queryResult.data.status;
    const limit = queryResult.data.limit ?? 50;

    const orders = await kucoinService.getOrders(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      { status, limit }
    );

    res.json({
      success: true,
      data: orders,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter ordens');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/orders - Criar ordem baseada em sinal
app.post('/api/integrations/trading/orders', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    const baseOrderSchema = z.object({
      symbol: z.string().optional(),
      side: z.enum(['buy', 'sell']),
      orderType: z.enum(['limit', 'market']),
      size: z.number().int().positive(),
      price: z.number().positive().optional(),
      leverage: z.number().min(1).max(100).optional(),
    }).strict();

    const orderFromSignalSchema = baseOrderSchema
      .extend({ signalId: z.string().uuid() })
      .superRefine((data, ctx) => {
        if (data.orderType === 'limit' && data.price === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Preço é obrigatório para ordens do tipo "limit".',
            path: ['price'],
          });
        }
      });

    const manualOrderSchema = baseOrderSchema.superRefine((data, ctx) => {
      if (data.orderType === 'limit' && data.price === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Preço é obrigatório para ordens do tipo "limit".',
          path: ['price'],
        });
      }
    });

    const parsed = z.union([orderFromSignalSchema, manualOrderSchema]).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    const result =
      'signalId' in parsed.data
        ? await kucoinService.createOrderFromSignal(
            { tenantId: authContext.tenantId, userId: authContext.userId },
            parsed.data
          )
        : await kucoinService.createManualOrder(
            { tenantId: authContext.tenantId, userId: authContext.userId },
            parsed.data
          );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(201).json({
      success: true,
      data: result.data,
      auditLogId: result.auditLogId,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar ordem');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/orders/:id - Cancelar ordem
app.delete('/api/integrations/trading/orders/:id', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    // OWASP API3: Validação de parâmetro de rota
    const paramResult = tradingUuidParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({ error: 'ID inválido', details: paramResult.error.format() });
      return;
    }

    const { id } = paramResult.data;
    const result = await kucoinService.cancelOrder(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      id
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar ordem');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/orders/sync - Sincronizar ordens com KuCoin
app.post('/api/integrations/trading/orders/sync', requirePermission('integrations:trading:manage'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    const result = await kucoinService.syncOrdersStatus({
      tenantId: authContext.tenantId,
      userId: authContext.userId,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao sincronizar ordens');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// TRADING: STOP ORDERS (TP/SL) - KuCoin API 2025
// POST /api/v1/st-orders conforme documentação oficial
// Referência: https://www.kucoin.com/docs-new/rest/futures-trading/orders/add-take-profit-and-stop-loss-order
// ============================================================================

// POST /api/integrations/trading/stop-orders - Criar ordem stop (TP/SL)
app.post('/api/integrations/trading/stop-orders', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    const stopOrderSchema = z.object({
      symbol: z.string().optional(),
      side: z.enum(['buy', 'sell']),
      size: z.number().int().positive(),
      stopLoss: z.number().positive().optional(),
      takeProfit: z.number().positive().optional(),
      leverage: z.number().int().min(1).max(100).optional(),
      orderType: z.enum(['limit', 'market']).optional(),
      price: z.number().positive().optional(),
      stopPriceType: z.enum(['TP', 'MP']).optional(),
    })
      .refine((data) => data.stopLoss || data.takeProfit, {
        message: 'Pelo menos stopLoss ou takeProfit deve ser definido',
      })
      .superRefine((data, ctx) => {
        if (data.orderType === 'limit' && data.price === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Preço é obrigatório quando orderType="limit".',
            path: ['price'],
          });
        }
        if ((data.stopLoss !== undefined || data.takeProfit !== undefined) && !data.stopPriceType) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'stopPriceType é obrigatório quando stopLoss ou takeProfit são informados.',
            path: ['stopPriceType'],
          });
        }
      });

    const parsed = stopOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dados inválidos', details: parsed.error.flatten() });
      return;
    }

    if (parsed.data.symbol && !assertValidTradingSymbol(res, parsed.data.symbol)) return;

    const result = await kucoinService.createStopOrder(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      parsed.data
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(201).json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao criar ordem stop');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/stop-orders - Listar ordens stop abertas
app.get('/api/integrations/trading/stop-orders', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    const symbol = req.query.symbol as string | undefined;
    if (symbol && !assertValidTradingSymbol(res, symbol)) return;

    const result = await kucoinService.getOpenStopOrders(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      symbol
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao listar ordens stop');
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/integrations/trading/stop-orders/:id - Cancelar ordem stop
app.delete('/api/integrations/trading/stop-orders/:id', requirePermission('integrations:trading:write'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    const orderIdSchema = z.object({ id: z.string().min(1) });
    const paramResult = orderIdSchema.safeParse(req.params);
    if (!paramResult.success) {
      res.status(400).json({ error: 'ID de ordem inválido' });
      return;
    }

    const result = await kucoinService.cancelStopOrder(
      { tenantId: authContext.tenantId, userId: authContext.userId },
      paramResult.data.id
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao cancelar ordem stop');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// TRADING: DADOS DE MERCADO ADICIONAIS (17/12/2025)
// Klines, Order Book, Funding Rate, Mark Price, Trade History
// ============================================================================

// GET /api/integrations/trading/klines/:symbol - Dados de candles
app.get('/api/integrations/trading/klines/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    if (!assertValidTradingSymbol(res, symbol)) return;

    const querySchema = z.object({
      granularity: z.coerce.number().int().optional(),
      from: z.coerce.number().int().optional(),
      to: z.coerce.number().int().optional(),
    }).superRefine((data, ctx) => {
      const granularity = data.granularity ?? 5;
      if (!KUCOIN_ALLOWED_GRANULARITIES_MINUTES.includes(granularity as (typeof KUCOIN_ALLOWED_GRANULARITIES_MINUTES)[number])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `granularity inválido. Valores permitidos (minutos): ${KUCOIN_ALLOWED_GRANULARITIES_MINUTES.join(', ')}`,
          path: ['granularity'],
        });
      }
      if (data.from !== undefined && data.to !== undefined && data.from > data.to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '"from" deve ser <= "to".',
          path: ['from'],
        });
      }
      if (data.from !== undefined && data.to !== undefined) {
        const intervalMs = granularity * 60 * 1000;
        const points = Math.floor((data.to - data.from) / intervalMs) + 1;
        if (points > 500) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Intervalo excede o limite de 500 klines por requisição. Divida o período.',
            path: ['from'],
          });
        }
      }
    });

    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }

    const granularity = queryResult.data.granularity ?? 5;
    const from = queryResult.data.from;
    const to = queryResult.data.to;

    const klines = await kucoinClient.getKlines(symbol, granularity, from, to);

    res.json({
      success: true,
      data: klines,
      symbol,
      granularity,
      interval: kucoinClient.granularityToInterval(granularity),
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter klines');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/orderbook/:symbol - Order Book
app.get('/api/integrations/trading/orderbook/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    if (!assertValidTradingSymbol(res, symbol)) return;

    const querySchema = z.object({
      depth: z.coerce.number().int().optional(),
    }).superRefine((data, ctx) => {
      const depth = data.depth ?? 20;
      if (depth !== 20 && depth !== 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'depth inválido. Valores permitidos: 20, 100.',
          path: ['depth'],
        });
      }
    });

    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }

    const depth = (queryResult.data.depth ?? 20) as 20 | 100;
    const orderbook = await kucoinClient.getOrderBook(symbol, depth);

    res.json({
      success: true,
      data: orderbook,
      symbol,
      depth,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter order book');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/funding-rate/:symbol - Funding Rate
app.get('/api/integrations/trading/funding-rate/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    if (!assertValidTradingSymbol(res, symbol)) return;

    const fundingRate = await kucoinClient.getCurrentFundingRate(symbol);

    res.json({
      success: true,
      data: fundingRate,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter funding rate');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/mark-price/:symbol - Mark Price
app.get('/api/integrations/trading/mark-price/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    if (!assertValidTradingSymbol(res, symbol)) return;

    const markPrice = await kucoinClient.getMarkPrice(symbol);

    res.json({
      success: true,
      data: markPrice,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter mark price');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/trades/:symbol - Histórico de Trades
app.get('/api/integrations/trading/trades/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    if (!assertValidTradingSymbol(res, symbol)) return;

    const trades = await kucoinClient.getTradeHistory(symbol);

    res.json({
      success: true,
      data: trades,
      symbol,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de trades');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/orders/history - Histórico de Ordens
app.get('/api/integrations/trading/orders/history', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    const querySchema = z.object({
      symbol: z.string().optional(),
      pageSize: z.coerce.number().int().min(1).max(1000).optional(),
      currentPage: z.coerce.number().int().min(1).max(1000).optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }

    const symbol = queryResult.data.symbol;
    if (symbol && !assertValidTradingSymbol(res, symbol)) return;

    const pageSize = queryResult.data.pageSize ?? 50;
    const currentPage = queryResult.data.currentPage ?? 1;

    const history = await kucoinClient.getOrderHistory(symbol, pageSize, currentPage);

    res.json({
      success: true,
      data: history,
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de ordens');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// TRADING CONTROL ENDPOINTS (Handover/Takeover - 17/12/2025)
// Endpoints para gerenciar controle entre Alice (IA) e operador manual
// Regra 6 - SEM MOCKS: Persistência real em PostgreSQL
// ============================================================================

// GET /api/integrations/trading/control-history - Histórico de handover/takeover
app.get('/api/integrations/trading/control-history', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(200).optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({ error: 'Query inválida', details: queryResult.error.flatten() });
      return;
    }

    const limit = queryResult.data.limit ?? 50;
    const db = getDatabase();

    // Buscar histórico de controle ordenado por data descendente
    const history = await db
      .select()
      .from(schema.tradingControlHistory)
      .where(eq(schema.tradingControlHistory.tenantId, authContext.tenantId))
      .orderBy(desc(schema.tradingControlHistory.criadoEm))
      .limit(limit);

    // Mapear para formato esperado pelo frontend
    const formattedHistory = history.map(entry => ({
      id: entry.id,
      previousMode: entry.previousMode,
      newMode: entry.newMode,
      changedBy: entry.changedBy,
      reason: entry.reason,
      source: (entry.metadata as Record<string, unknown>)?.source || 'unknown',
      createdAt: entry.criadoEm?.toISOString() || new Date().toISOString(),
    }));

    res.json({
      success: true,
      data: formattedHistory,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de controle de trading');
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/integrations/trading/control - Mudar modo de controle (handover/takeover)
app.post('/api/integrations/trading/control', requirePermission('integrations:trading:manage'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    // Validar body da requisição
    const controlSchema = z.object({
      mode: z.enum(['alice', 'manual']),
      reason: z.string().max(500).optional(),
      source: z.string().max(50).optional(),
    });

    const parsed = controlSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Dados inválidos',
        details: parsed.error.errors,
      });
      return;
    }

    const { mode, reason, source } = parsed.data;
    const db = getDatabase();

    // Buscar configuração atual de risco para determinar modo anterior
    const [currentConfig] = await db
      .select()
      .from(schema.tradingRiskConfig)
      .where(eq(schema.tradingRiskConfig.tenantId, authContext.tenantId))
      .limit(1);

    if (!currentConfig) {
      res.status(404).json({ error: 'Configuração de trading não encontrada para este tenant' });
      return;
    }

    // Determinar modo anterior
    const previousMode = currentConfig.autoExecuteSignals ? 'alice' : 'manual';

    // Se já está no modo solicitado, retornar sem alteração
    if (previousMode === mode) {
      res.json({
        success: true,
        data: {
          previousMode,
          newMode: mode,
          message: `Trading já está em modo ${mode}`,
          changed: false,
        },
      });
      return;
    }

    // Atualizar configuração de risco para refletir novo modo
    await db
      .update(schema.tradingRiskConfig)
      .set({
        autoExecuteSignals: mode === 'alice',
        atualizadoEm: new Date(),
      })
      .where(eq(schema.tradingRiskConfig.tenantId, authContext.tenantId));

    // Registrar mudança no histórico
    const [historyEntry] = await db
      .insert(schema.tradingControlHistory)
      .values({
        tenantId: authContext.tenantId,
        previousMode,
        newMode: mode,
        changedBy: authContext.userId,
        reason: reason || (mode === 'alice' ? 'Controle devolvido para Alice' : 'Takeover manual solicitado'),
        metadata: {
          source: source || 'api',
          timestamp: new Date().toISOString(),
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
        },
      })
      .returning();

    logger.info({
      tenantId: authContext.tenantId,
      userId: authContext.userId,
      previousMode,
      newMode: mode,
      reason,
      historyId: historyEntry?.id,
    }, 'Modo de controle de trading alterado');

    res.json({
      success: true,
      data: {
        previousMode,
        newMode: mode,
        message: mode === 'alice' 
          ? 'Controle devolvido para Alice com sucesso'
          : 'Controle manual assumido com sucesso',
        changed: true,
        historyId: historyEntry?.id,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao alterar modo de controle de trading');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// TRADING: ANÁLISE TÉCNICA ENTERPRISE (21/12/2025)
// Indicadores técnicos calculados por CÓDIGO (determinísticos)
// Elimina alucinações do LLM ao fornecer dados reais calculados
// ============================================================================

// GET /api/integrations/trading/analysis/:symbol - Análise técnica completa
app.get('/api/integrations/trading/analysis/:symbol', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const { symbol } = req.params;
    const interval = (req.query.interval as string) || '5m';

    if (!kucoinClient.isKucoinConfigured()) {
      respondKucoinNotConfigured(res);
      return;
    }

    if (!assertValidTradingSymbol(res, symbol)) return;
    
    // Mapear intervalo para granularity (minutos)
    const intervalToGranularity: Record<string, number> = {
      '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30,
      '1h': 60, '2h': 120, '4h': 240, '8h': 480, '12h': 720,
      '1d': 1440, '1w': 10080
    };
    
    const granularity = intervalToGranularity[interval];
    if (!granularity) {
      res.status(400).json({ error: `Intervalo inválido: ${interval}. Use: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 8h, 12h, 1d, 1w` });
      return;
    }
    
    // BUG FIX 21/12/2025: Type narrowing para TypeScript entender que interval é válido após validação
    const validatedInterval = interval as '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '8h' | '12h' | '1d' | '1w';

    // Obter 250 candles para ter dados suficientes para todos os indicadores
    const now = Date.now();
    const from = now - (granularity * 60 * 1000 * 250);
    const klinesRaw = await kucoinClient.getKlines(symbol, granularity, from, now);

    if (klinesRaw.length < 200) {
      res.status(400).json({ 
        error: `Dados insuficientes: ${klinesRaw.length} candles. Mínimo: 200`,
        suggestion: 'Tente um intervalo maior ou aguarde mais dados acumularem'
      });
      return;
    }

    // Converter para formato do serviço de indicadores
    const candles: technicalIndicators.CandleData[] = klinesRaw.map(k => ({
      timestamp: k.time,
      open: parseFloat(k.open),
      high: parseFloat(k.high),
      low: parseFloat(k.low),
      close: parseFloat(k.close),
      volume: parseFloat(k.volume),
    }));

    // Calcular análise técnica completa
    const analysis = technicalIndicators.calculateFullAnalysis(candles, symbol, interval);

    // Persistir análise no banco de dados
    const db = getDatabase();
    const [savedIndicator] = await db
      .insert(schema.tradingTechnicalIndicators)
      .values({
        tenantId: authContext.tenantId,
        symbol,
        // BUG FIX 21/12/2025: Corrigido typo 'as string' e adicionada validação de tipo
        interval: validatedInterval,
        candleTimestamp: new Date(candles[candles.length - 1].timestamp),
        currentPrice: analysis.currentPrice,
        
        // RSI
        rsiValue: analysis.rsi.value,
        rsiInterpretation: analysis.rsi.interpretation,
        rsiPeriod: analysis.rsi.period,
        
        // MACD
        macdLine: analysis.macd.macd,
        macdSignal: analysis.macd.signal,
        macdHistogram: analysis.macd.histogram,
        macdInterpretation: analysis.macd.interpretation as 'bullish' | 'bearish' | 'sideways',
        macdCrossover: analysis.macd.crossover,
        
        // EMAs
        ema9: analysis.movingAverages.ema9,
        ema21: analysis.movingAverages.ema21,
        ema50: analysis.movingAverages.ema50,
        ema200: analysis.movingAverages.ema200,
        
        // SMAs
        sma20: analysis.movingAverages.sma20,
        sma50: analysis.movingAverages.sma50,
        sma200: analysis.movingAverages.sma200,
        maTrend: analysis.movingAverages.trend,
        
        // Bollinger
        bollingerUpper: analysis.bollinger.upper,
        bollingerMiddle: analysis.bollinger.middle,
        bollingerLower: analysis.bollinger.lower,
        bollingerWidth: analysis.bollinger.width,
        bollingerPercentB: analysis.bollinger.percentB,
        bollingerInterpretation: analysis.bollinger.interpretation,
        
        // ATR
        atrValue: analysis.atr.value,
        atrPercentage: analysis.atr.percentage,
        atrVolatility: analysis.atr.volatility,
        
        // Stochastic
        stochasticK: analysis.stochastic.k,
        stochasticD: analysis.stochastic.d,
        stochasticInterpretation: analysis.stochastic.interpretation,
        
        // ADX
        adxValue: analysis.adx.adx,
        adxPlusDI: analysis.adx.plusDI,
        adxMinusDI: analysis.adx.minusDI,
        adxTrendStrength: analysis.adx.trendStrength,
        
        // Suporte/Resistência
        pivotPoint: analysis.supportResistance.pivot,
        resistance1: analysis.supportResistance.resistance1,
        resistance2: analysis.supportResistance.resistance2,
        resistance3: analysis.supportResistance.resistance3,
        support1: analysis.supportResistance.support1,
        support2: analysis.supportResistance.support2,
        support3: analysis.supportResistance.support3,
        
        // Volume
        currentVolume: analysis.volume.currentVolume,
        averageVolume: analysis.volume.averageVolume,
        volumeRatio: analysis.volume.volumeRatio,
        obv: analysis.volume.obv,
        volumeInterpretation: analysis.volume.interpretation,
        
        // Sinal geral
        overallSignal: analysis.overallSignal,
        signalConfidence: analysis.confidence,
        
        metadata: {
          calculationDurationMs: Date.now() - analysis.timestamp,
          candleCount: candles.length,
          lastCandleTime: new Date(candles[candles.length - 1].timestamp).toISOString(),
        },
      })
      .returning({ id: schema.tradingTechnicalIndicators.id });

    logger.info({
      tenantId: authContext.tenantId,
      symbol,
      interval,
      overallSignal: analysis.overallSignal,
      confidence: analysis.confidence,
      indicatorId: savedIndicator?.id,
    }, 'Análise técnica calculada e persistida');

    res.json({
      success: true,
      data: analysis,
      indicatorId: savedIndicator?.id,
      llmPrompt: technicalIndicators.formatAnalysisForLLM(analysis),
    });
  } catch (error) {
    if (sendKucoinErrorResponse(res, error)) return;
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao calcular análise técnica');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/analysis/history - Histórico de análises
app.get('/api/integrations/trading/analysis/history', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const symbol = req.query.symbol as string || 'XBTUSDTM';
    const intervalParam = req.query.interval as string || '5m';
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    // BUG FIX 21/12/2025: Validação e type narrowing para TypeScript
    const validIntervals = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '1w'] as const;
    type ValidInterval = typeof validIntervals[number];
    
    if (!validIntervals.includes(intervalParam as ValidInterval)) {
      res.status(400).json({ error: `Intervalo inválido: ${intervalParam}. Use: ${validIntervals.join(', ')}` });
      return;
    }
    const interval = intervalParam as ValidInterval;

    const db = getDatabase();
    // BUG FIX 21/12/2025: interval agora é usado na query (antes era ignorado)
    const history = await db
      .select()
      .from(schema.tradingTechnicalIndicators)
      .where(
        and(
          eq(schema.tradingTechnicalIndicators.tenantId, authContext.tenantId),
          eq(schema.tradingTechnicalIndicators.symbol, symbol),
          eq(schema.tradingTechnicalIndicators.interval, interval)
        )
      )
      .orderBy(desc(schema.tradingTechnicalIndicators.calculatedAt))
      .limit(limit);

    res.json({
      success: true,
      data: history,
      count: history.length,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter histórico de análises');
    res.status(500).json({ error: errorMessage });
  }
});

// GET /api/integrations/trading/validations - Histórico de validações LLM
app.get('/api/integrations/trading/validations', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId) {
      res.status(401).json({ error: 'Autenticação necessária' });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const passedOnly = req.query.passedOnly === 'true';

    const db = getDatabase();
    
    const conditions = [eq(schema.tradingLlmValidations.tenantId, authContext.tenantId)];
    if (passedOnly) {
      conditions.push(eq(schema.tradingLlmValidations.validationPassed, true));
    }

    const validations = await db
      .select()
      .from(schema.tradingLlmValidations)
      .where(and(...conditions))
      .orderBy(desc(schema.tradingLlmValidations.validatedAt))
      .limit(limit);

    // Calcular estatísticas
    const allValidations = await db
      .select()
      .from(schema.tradingLlmValidations)
      .where(eq(schema.tradingLlmValidations.tenantId, authContext.tenantId));

    const totalValidations = allValidations.length;
    const passedValidations = allValidations.filter(v => v.validationPassed).length;
    const accuracyRate = totalValidations > 0 ? (passedValidations / totalValidations) * 100 : 0;

    res.json({
      success: true,
      data: validations,
      stats: {
        total: totalValidations,
        passed: passedValidations,
        failed: totalValidations - passedValidations,
        accuracyRate: Math.round(accuracyRate * 100) / 100,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao obter validações LLM');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// MIDDLEWARE: Not Found + Error Handler (Express.js 2025)
// ============================================================================

// Not Found handler (antes do error handler)
app.use(createNotFoundHandler({ serviceName: 'integrations-service' }));

// Error handler global (OWASP 2023 + Express.js 2025)
app.use(createErrorHandler({ 
  serviceName: 'integrations-service', 
  logger,
  includeStackInDev: true,
}));

const PORT = config.PORT || 3005;

// =============================================================================
// INICIALIZAÇÃO: Redis Cache + Session Auth Cache
// =============================================================================
// CORREÇÃO PR#107 (10/01/2026): Inicializar caches antes de processar requisições
// Redis cache é usado para performance de sessões HTTP (evita queries repetitivas)
// =============================================================================
async function initializeCaches(): Promise<void> {
  // initializeRedisCache() usa REDIS_URL do ambiente automaticamente.
  // - Em produção: fail-fast se Redis indisponível (Regra 6)
  // - Em dev/test: Redis pode estar ausente; session-auth cache fica desabilitado (sem in-memory)
  const redisConnected = await initializeRedisCache();
  logger.info({ redisConnected }, 'Redis cache inicializado');

  await initializeSessionAuthCache();
  logger.info('Session auth cache inicializado');
}

// Inicializar caches e depois iniciar servidor
initializeCaches().then(() => {
  try {
    const db = getDatabase();
    initWiseSyncService(db);
    logger.info('WiseSyncService inicializado com sucesso');
  } catch (error) {
    logger.warn({ error }, 'WiseSyncService não inicializado (database não disponível)');
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT }, 'Integrations service started');
  });

  // SEGURANÇA: Timeouts para prevenir conexões pendentes (Node.js 20 LTS Best Practices)
  server.timeout = 30000; // 30s timeout para requisições
  server.keepAliveTimeout = 65000; // 65s (maior que ALB timeout padrão de 60s)
  server.headersTimeout = 66000; // Ligeiramente maior que keepAliveTimeout

  // ============================================================================
  // GRACEFUL SHUTDOWN (Enterprise-Grade - Regra 16 CLAUDE.md)
  // ShutdownManager centralizado elimina duplicação de listeners (Regra 6)
  // Ordem: HTTP server → Database pool (coordenado pelo ShutdownManager)
  // ============================================================================

  registerShutdownCallback(
    'integrations-http-server',
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

  registerShutdownCallback(
    'integrations-database-pool',
    async () => {
      logger.info('Encerrando pool de conexões database...');
      await closeDatabasePool();
      logger.info('Pool de conexões encerrado com sucesso');
    },
    { priority: ShutdownPriority.DATABASE }
  );

  registerShutdownCallback(
    'integrations-kucoin-websocket',
    async () => {
      // WS5: garante shutdown limpo dos clientes WS (evita sockets pendurados)
      closeKucoinWebSocketClients();
    },
    { priority: ShutdownPriority.EXTERNAL_CONNECTIONS }
  );

  registerShutdownCallback(
    'integrations-trading-broadcast',
    async () => {
      await closeBroadcast();
    },
    { priority: ShutdownPriority.EXTERNAL_CONNECTIONS }
  );
}).catch((error: unknown) => {
  logger.error({ error }, 'Erro fatal ao inicializar serviço');
  process.exit(1);
});
