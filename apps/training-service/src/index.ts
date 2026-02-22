/**
 * Training Service - Alice Enterprise Platform
 * 
 * Serviço de treinamento e fine-tuning com deduplicação semântica (SemHash).
 * Implementa Circuit Breaker pattern (Regra 16 - Best Practices 2025).
 * 
 * Gate 2 (15/01/2026):
 * - Embeddings de texto: Qwen3-Embedding-0.6B INT8 (1024 dim, GPU Manager Service → Qdrant)
 * - Fine-tuning (QLoRA): MESMO modelo base do LLM (texto) via gpu-trainer (sob demanda)
 * - Schedule semanal configurável (domingo 3:00 AM default)
 * - Treinamento on-demand via dashboard admin
 * - Zero latência de troca (serviços GPU sempre ativos)
 * 
 * Autor: Fillipe Guerra
 * Data: 15 de Janeiro de 2026
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import compression from 'compression';
import crypto from 'crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '@alice/logger';
import { getDatabase, getPool, schema, closeDatabasePool, isPoolHealthy, createDrizzleFeatureFlagStorage, validateEmbeddingDimension, EMBEDDING_DIMENSIONS } from '@alice/database';
import { 
  createCorrelationMiddleware, 
  createSecurityMiddleware,
  createRateLimiter,
  createErrorHandler,
  createNotFoundHandler,
  initFeatureFlags,
  createAlicePrometheus,
  initRbacPrometheusMetrics,
  instrumentCircuitBreaker,
  createCircuitBreaker,
  CIRCUIT_BREAKER_PRESETS,
  registerShutdownCallback,
  ShutdownPriority,
  setupSwaggerUI,
  TRAINING_SERVICE_TAGS,
  requirePermission,
  extractAuthContext,
  validateNamespaceTenantConsistency,
  validateTenantConsistency,
  setPermissionResolver,
  // Auth híbrida (WS4): Sessão (cookie) + Bearer JWT (OIDC) com validação local via JWKS
  createSessionAuthMiddleware,
  initializeRedisCache,
  initializeSessionAuthCache,
  closeRedisCacheClient,
  getRedisClient,
  requestGpu,
  GpuServiceType,
  GpuRequestPriority,
  GPU_MANAGER_CONFIG,
  RedisStreamQueue,
  TRADING_V2_STREAMS,
  buildTradingV2IdempotencyKey,
  tradingUniverseEnqueueSchema,
  tradingBacktestEnqueueSchema,
  tradingCalibrationEnqueueSchema,
  tradingRebalanceEnqueueSchema,
  tradingModelRiskEnqueueSchema,
  Gauge as PromGauge,
  Counter as PromCounter,
  Histogram as PromHistogram,
  computeSemHash,
  cosineSimilarity,
} from '@alice/shared-utils';
import { trainingServicePaths, trainingServiceSchemas } from './openapi-specs.js';
import { eq, and, or, desc, sql, isNull, not, inArray } from '@alice/database';
import { z } from 'zod';
import { getAllSystemConfig, setSystemConfig, getSystemConfig } from '@alice/database/system-config';

async function resolveMinOndemandDatasetSize(): Promise<number> {
  const v = await getSystemConfig('MIN_ONDEMAND_DATASET_SIZE');
  if (v) {
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return MIN_ONDEMAND_DATASET_SIZE;
}

async function resolveDefaultMaxSeqLen(): Promise<number> {
  const v = await getSystemConfig('maxSeqLen');
  if (v) {
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n >= 256 && n <= 32768) return n;
  }
  return 2048;
}
import { processLoraJob, activateLoraAdapter, getActiveAdapter, deactivateLoraAdapter } from './lora-job-manager.js';
import { resolveScope } from './scope-resolver.js';
import { selectExamplesByProfile } from './dataset-selection-engine.js';
import { runUniverseScanWorker } from './trading-v2/jobs/universe-scan-worker.js';
import { runBacktestWorker } from './trading-v2/jobs/backtest-worker.js';
import { runCalibrationWorker } from './trading-v2/jobs/calibration-worker.js';
import { runPortfolioRebalanceWorker } from './trading-v2/jobs/portfolio-rebalance-worker.js';
import { runModelRiskWorker } from './trading-v2/jobs/model-risk-worker.js';
// Fine-tuning é executado localmente via GPU Manager Service (Regra 6 - sem stubs/migração)

// Logger centralizado: JSON em produção, pino-pretty em desenvolvimento
const logger = createLogger('training-service');

// ============================================================================
// VALIDAÇÃO DE VARIÁVEIS DE AMBIENTE - CORREÇÃO AUDITORIA 17/12/2025
// Bug: parseInt sem validação de NaN causava:
// - app.listen(NaN) → comportamento indefinido
// ============================================================================
function parseEnvInt(envValue: string | undefined, defaultValue: number, varName: string): number {
  const raw = envValue ?? String(defaultValue);
  const trimmed = raw.trim();
  
  // Regra 6: Rejeitar valores parciais - só dígitos são aceitos
  if (!/^\d+$/.test(trimmed)) {
    const errorMsg = `${varName} inválido: "${raw}". Deve ser número inteiro positivo.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ varName, rawValue: raw }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, defaultValue }, `${errorMsg} Usando valor padrão.`);
    return defaultValue;
  }
  
  const parsed = parseInt(trimmed, 10);
  
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const errorMsg = `${varName} inválido: "${raw}". Deve ser número inteiro positivo.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ varName, rawValue: raw, parsed }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, parsed, defaultValue }, `${errorMsg} Usando valor padrão.`);
    return defaultValue;
  }
  
  return parsed;
}

function readUuidFromUnknown(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

function requireInternalApiAuth(req: Request, res: Response, next: () => void): void {
  if (!INTERNAL_API_SECRET) {
    res.status(503).json({ error: 'INTERNAL_API_SECRET não configurado' });
    return;
  }
  const secret = req.headers['x-internal-api-secret'];
  if (typeof secret !== 'string' || secret !== INTERNAL_API_SECRET) {
    res.status(401).json({ error: 'Token interno inválido' });
    return;
  }
  next();
}

const PORT = parseEnvInt(process.env.PORT, 3004, 'PORT');
const DATABASE_URL = process.env.DATABASE_URL;
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;
const corsOriginsEnv = process.env.CORS_ORIGINS;
if (!corsOriginsEnv && process.env.NODE_ENV === 'production') {
  logger.error('CORS_ORIGINS é obrigatório em produção (Regra 6 - fail-fast)');
  process.exit(1);
}
const CORS_ORIGINS = corsOriginsEnv
  ? corsOriginsEnv.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [];

if (!DATABASE_URL) {
  logger.error('DATABASE_URL não configurada');
  process.exit(1);
}

logger.info('Training service inicializado - fine-tuning LoRA ativo via GPU Manager Service (GPU única 20GB)');

// Usar package @alice/database centralizado (node-postgres para produção Hetzner)
const db = getDatabase();
setPermissionResolver(async (auth) => {
  let customRoleId = auth.customRoleId;
  if (!customRoleId) {
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, auth.userId),
      columns: { customRoleId: true },
    });
    customRoleId = user?.customRoleId ?? undefined;
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
  return [
    ...rolePermissions
      .map((rp) => ('codigo' in rp ? rp.codigo : (rp as { permission?: { codigo?: string | null } }).permission?.codigo))
      .filter((code): code is string => Boolean(code)),
    ...customRolePermissions
      .map((rp) => (rp as { permission?: { codigo?: string | null } }).permission?.codigo)
      .filter((code): code is string => Boolean(code)),
  ];
});

// Inicializar sistema de feature flags com storage PostgreSQL (Regra 16 - Enterprise)
const featureFlagStorage = createDrizzleFeatureFlagStorage();
initFeatureFlags(featureFlagStorage);
logger.info('Sistema de feature flags inicializado');

const app = express();

// ============================================================================
// PROMETHEUS: Instrumentação de métricas (Regra 16 - Observability Enterprise)
// ============================================================================
const { metrics, metricsRouter, httpMetricsMiddleware } = createAlicePrometheus({
  serviceName: 'training-service',
  collectDefaultMetrics: true,
});

// Métrica enterprise: total de datasets de treinamento (DB → Prometheus)
const trainingDatasetsTotal = new PromGauge({
  name: 'alice_training_datasets_total',
  help: 'Total de registros de training data (todas as categorias)',
  registers: [metrics.registry],
});

const trainingPipelineMetrics = {
  dataCollectedTotal: new PromCounter({
    name: 'alice_training_data_collected_total',
    help: 'Total de dados de treinamento coletados',
    labelNames: ['source_type', 'status'] as const,
    registers: [metrics.registry],
  }),
  dataRejectedTotal: new PromCounter({
    name: 'alice_training_data_rejected_total',
    help: 'Total de dados de treinamento rejeitados automaticamente',
    labelNames: ['reason', 'source_type'] as const,
    registers: [metrics.registry],
  }),
  dataDuplicatesTotal: new PromCounter({
    name: 'alice_training_data_duplicates_total',
    help: 'Total de dados de treinamento detectados como duplicados',
    labelNames: ['source_type'] as const,
    registers: [metrics.registry],
  }),
  qualityScore: new PromHistogram({
    name: 'alice_training_data_quality_score',
    help: 'Distribuição de score de qualidade dos dados de treinamento',
    buckets: [0, 0.25, 0.5, 0.75, 0.9, 0.95, 1],
    registers: [metrics.registry],
  }),
  reviewTotal: new PromCounter({
    name: 'alice_training_data_review_total',
    help: 'Total de revisões manuais de dados de treinamento',
    labelNames: ['decision'] as const,
    registers: [metrics.registry],
  }),
  schedulerRunsTotal: new PromCounter({
    name: 'alice_training_scheduler_runs_total',
    help: 'Total de execuções do scheduler de auto-learning',
    labelNames: ['result'] as const,
    registers: [metrics.registry],
  }),
  scopeQuarantineTotal: new PromCounter({
    name: 'alice_training_scope_quarantine_total',
    help: 'Total de itens em quarentena por escopo',
    labelNames: ['source_type', 'reason'] as const,
    registers: [metrics.registry],
  }),
  scopeOverrideTotal: new PromCounter({
    name: 'alice_training_scope_override_total',
    help: 'Total de overrides manuais de escopo durante aprovação',
    labelNames: ['source'] as const,
    registers: [metrics.registry],
  }),
  scopeResolvedTotal: new PromCounter({
    name: 'alice_training_scope_resolved_total',
    help: 'Total de itens de quarentena resolvidos manualmente',
    labelNames: ['source'] as const,
    registers: [metrics.registry],
  }),
  /** Plano TREINAMENTO-LIMITES 11/02/2026: sugestão de novo namespace quando não há match */
  scopeSuggestedNewNamespaceTotal: new PromCounter({
    name: 'alice_training_scope_suggested_new_namespace_total',
    help: 'Total de vezes que scope-resolver sugeriu criação de novo namespace (sem namespace inferido)',
    labelNames: ['source_type'] as const,
    registers: [metrics.registry],
  }),
};

const tradingV2Metrics = {
  queuePending: new PromGauge({
    name: 'trading_v2_queue_pending',
    help: 'Mensagens pendentes por consumer group nas filas de trading V2',
    labelNames: ['queue'] as const,
    registers: [metrics.registry],
  }),
  queueLagMs: new PromGauge({
    name: 'trading_v2_queue_lag_ms',
    help: 'Lag aproximado do consumer group de trading V2 (ms)',
    labelNames: ['queue'] as const,
    registers: [metrics.registry],
  }),
  dlqTotal: new PromGauge({
    name: 'trading_v2_dlq_total',
    help: 'Total acumulado de mensagens em DLQ por stream de trading V2',
    labelNames: ['queue'] as const,
    registers: [metrics.registry],
  }),
  universeScanSeconds: new PromHistogram({
    name: 'trading_v2_universe_scan_seconds',
    help: 'Duração de processamento do worker de universe scan',
    buckets: [0.05, 0.1, 0.5, 1, 2, 5],
    registers: [metrics.registry],
  }),
  backtestSeconds: new PromHistogram({
    name: 'trading_v2_backtest_seconds',
    help: 'Duração de processamento do worker de backtest',
    buckets: [0.1, 0.5, 1, 2, 5, 10],
    registers: [metrics.registry],
  }),
  calibrationSeconds: new PromHistogram({
    name: 'trading_v2_calibration_seconds',
    help: 'Duração de processamento do worker de calibration',
    buckets: [0.05, 0.1, 0.5, 1, 2, 5],
    registers: [metrics.registry],
  }),
  rebalanceSeconds: new PromHistogram({
    name: 'trading_v2_rebalance_seconds',
    help: 'Duração de processamento do worker de rebalance',
    buckets: [0.05, 0.1, 0.5, 1, 2, 5],
    registers: [metrics.registry],
  }),
  modelRiskSeconds: new PromHistogram({
    name: 'trading_v2_model_risk_seconds',
    help: 'Duração de processamento do worker de model risk',
    buckets: [0.05, 0.1, 0.5, 1, 2, 5],
    registers: [metrics.registry],
  }),
  modelRiskEventsTotal: new PromCounter({
    name: 'trading_v2_model_risk_events_total',
    help: 'Total de eventos de model risk registrados',
    registers: [metrics.registry],
  }),
  backtestDsr: new PromGauge({
    name: 'trading_v2_backtest_dsr',
    help: 'Último DSR calculado por mercado/estratégia',
    labelNames: ['marketType', 'strategyKey'] as const,
    registers: [metrics.registry],
  }),
  backtestPbo: new PromGauge({
    name: 'trading_v2_backtest_pbo',
    help: 'Último PBO calculado por mercado/estratégia',
    labelNames: ['marketType', 'strategyKey'] as const,
    registers: [metrics.registry],
  }),
  candidateCount: new PromCounter({
    name: 'trading_v2_candidates_total',
    help: 'Total de candidatos produzidos por lado e mercado',
    labelNames: ['side', 'marketType'] as const,
    registers: [metrics.registry],
  }),
  datasetVersionCreatedTotal: new PromCounter({
    name: 'training_dataset_version_created_total',
    help: 'Total de versões de dataset criadas',
    registers: [metrics.registry],
  }),
};

const tradingQueueNames = {
  universe: TRADING_V2_STREAMS.universeScan,
  backtest: TRADING_V2_STREAMS.backtest,
  calibration: TRADING_V2_STREAMS.calibration,
  rebalance: TRADING_V2_STREAMS.portfolioRebalance,
  modelRisk: TRADING_V2_STREAMS.modelRisk,
} as const;

const TRAINING_METRICS_INTERVAL_MS = parseEnvInt(
  process.env.TRAINING_METRICS_INTERVAL_MS,
  60000,
  'TRAINING_METRICS_INTERVAL_MS'
);
const TRADING_WORKER_POLL_INTERVAL_MS = 250;

let trainingMetricsInterval: NodeJS.Timeout | null = null;
const tradingWorkerStoppers: Array<() => Promise<void>> = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshTrainingMetrics(): Promise<void> {
  try {
    const [datasetsTotal] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.trainingData);

    const [activeJobs] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.fineTuningJobs)
      .where(inArray(schema.fineTuningJobs.status, ['preparing', 'training', 'validating']));

    const datasetsCount = Number(datasetsTotal?.count ?? 0);
    const activeJobsCount = Number(activeJobs?.count ?? 0);

    trainingDatasetsTotal.set(datasetsCount);
    metrics.training.activeJobs.set(activeJobsCount);
  } catch (error) {
    logger.error({ error }, 'Falha ao atualizar métricas de training');
  }
}

function startTrainingMetricsScheduler(): void {
  void refreshTrainingMetrics();
  trainingMetricsInterval = setInterval(() => {
    void refreshTrainingMetrics();
  }, TRAINING_METRICS_INTERVAL_MS);
}


async function enqueueTradingJob(
  queueName: (typeof tradingQueueNames)[keyof typeof tradingQueueNames],
  payload: Record<string, unknown>,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    throw new Error('Redis não disponível para fila de trading');
  }
  const queue = new RedisStreamQueue(queueName, {
    group: 'training-service',
    consumer: `training-${process.pid}`,
    maxRetries: 3,
  });
  const idempotencyKey = buildTradingV2IdempotencyKey(queueName, payload);
  await queue.enqueue(redis, payload, idempotencyKey);
}

function createTradingWorker<T extends { idempotencyKey: string }>(
  queueName: string,
  parser: z.ZodSchema<T>,
  handler: (payload: T) => Promise<void>,
  metric: PromHistogram,
): () => Promise<void> {
  const queue = new RedisStreamQueue<T>(queueName, {
    group: 'training-service',
    consumer: `training-${process.pid}`,
    maxRetries: 3,
    autoClaimCount: 10,
    streamMaxLen: parseEnvInt(process.env.TRADING_V2_QUEUE_MAXLEN, 20_000, 'TRADING_V2_QUEUE_MAXLEN'),
  });
  let stopped = false;
  const stopToken = { isStopped: () => stopped };

  const runLoop = async () => {
    const redis = getRedisClient();
    if (!redis) return;
    await queue.consumeLoop(redis, async (message) => {
        const parsed = parser.parse(message);
        const timer = metric.startTimer();
        try {
          await handler(parsed);
        } finally {
          timer();
        }
      }, {
      stopToken,
      idleSleepMs: TRADING_WORKER_POLL_INTERVAL_MS,
    });
  };

  void (async () => {
    while (!stopped) {
      try {
        await runLoop();
        const redis = getRedisClient();
        if (!redis) {
          await sleep(TRADING_WORKER_POLL_INTERVAL_MS);
          continue;
        }
        const lagMetrics = await queue.getLagMetrics(redis);
        tradingV2Metrics.queuePending.set({ queue: queueName }, lagMetrics.pending);
        tradingV2Metrics.queueLagMs.set({ queue: queueName }, lagMetrics.lag * TRADING_WORKER_POLL_INTERVAL_MS);
        tradingV2Metrics.dlqTotal.set({ queue: queueName }, await queue.dlqSize(redis));
      } catch (error) {
        logger.error({ queueName, error: error instanceof Error ? error.message : String(error) }, 'Falha ao processar job trading-v2');
        await sleep(TRADING_WORKER_POLL_INTERVAL_MS);
      }
    }
  })();

  return async () => {
    stopped = true;
    queue.requestStop();
    await sleep(TRADING_WORKER_POLL_INTERVAL_MS + 50);
  };
}

// Inicializar métricas RBAC (Regra 16 - Observability Enterprise)
initRbacPrometheusMetrics(metrics.rbac);
logger.info('Métricas RBAC Prometheus inicializadas no training-service');

// Endpoint /metrics para Prometheus scraper (antes de outros middlewares)
app.use(metricsRouter);

// ============================================================================
// OPENAPI/SWAGGER: Documentação da API (OWASP API9)
// ============================================================================
setupSwaggerUI(app, {
  serviceName: 'training-service',
  version: '1.0.0',
  description: 'Serviço de fine-tuning com SemHash, auto-learning e GPU Manager Service (Hetzner GEX44).',
  port: Number(PORT),
  tags: TRAINING_SERVICE_TAGS,
  paths: trainingServicePaths,
  schemas: trainingServiceSchemas,
});
logger.info('Swagger UI configurado em /api/docs');

// Middleware para coletar métricas HTTP automaticamente
app.use(httpMetricsMiddleware);

// SEGURANÇA: Desabilitar X-Powered-By header (Express.js 2025 + OWASP API8)
app.disable('x-powered-by');

// SEGURANÇA: Trust proxy = 1 para confiar apenas no primeiro proxy (Traefik)
// Evita bypass de rate limiting (express-rate-limit 2025 best practice)
app.set('trust proxy', 1);

// ============================================================================
// CIRCUIT BREAKER - Text Embeddings GPU (GPU Manager Service)
// Gate 2: Qwen3-Embedding-0.6B INT8 (1024 dim, SSOT) via GPU Manager Service → Qdrant
// Usa CIRCUIT_BREAKER_PRESETS centralizado (Regra 2 - Não Duplicar)
// ============================================================================

// GPU Manager Service - Gerenciamento centralizado de requisições GPU (25/12/2025)
// URL é usada internamente pelo requestGpu, não precisa ser exposta aqui

interface TextEmbeddingResponse {
  embedding: number[];
  model: string;
  processing_time_ms: number;
}

// RESILIÊNCIA: Timeout para chamadas externas (Best Practices 2025)
const EXTERNAL_API_TIMEOUT_MS = 25000;

async function generateEmbeddingInternal(text: string): Promise<number[]> {
  // Gate 2: Embeddings de texto via GPU Manager Service (dimensão SSOT = EMBEDDING_DIMENSIONS.TEXT)
  
  try {
    // Enfileirar requisição no GPU Manager com prioridade MEDIUM (embeddings para fine-tuning)
    const gpuResponse = await requestGpu({
      serviceType: GpuServiceType.EMBEDDINGS,
      endpoint: '/embed/text',
      method: 'POST',
      priority: GpuRequestPriority.MEDIUM,
      timeout: EXTERNAL_API_TIMEOUT_MS,
      body: {
        texts: [text.slice(0, 2000)], // Limitar tamanho para evitar problemas
      },
    });

    if (!gpuResponse.success || !gpuResponse.data) {
      throw new Error(gpuResponse.error || 'Erro ao gerar embedding de texto');
    }

    const data = gpuResponse.data as Partial<TextEmbeddingResponse> & {
      embedding?: number[];
      embeddings?: number[][];
      dimensions?: number;
    };
    const resultEmbedding = data.embedding ?? data.embeddings?.[0];
    
    if (!resultEmbedding || resultEmbedding.length === 0) {
      throw new Error('Serviço de embeddings GPU retornou resultado vazio');
    }
    
    // Validar dimensão (SSOT) - Enterprise-grade
    // Lança erro se dimensão estiver incorreta (não apenas warning) - Regra 6
    validateEmbeddingDimension(resultEmbedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');
    
    return resultEmbedding;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Timeout')) {
      logger.warn({ timeout: EXTERNAL_API_TIMEOUT_MS }, 'Chamada de embedding abortada por timeout');
      throw new Error(`Timeout de ${EXTERNAL_API_TIMEOUT_MS / 1000}s excedido na chamada de embedding`);
    }
    throw error;
  }
}

const gpuManagerEmbeddingsBreaker = createCircuitBreaker(generateEmbeddingInternal, {
  name: 'gpu-manager-embeddings',
  ...CIRCUIT_BREAKER_PRESETS.textEmbeddings,
});

// Instrumentar circuit breaker com métricas Prometheus
// Type assertion necessária: Opossum CircuitBreaker tem tipos de eventos mais específicos
instrumentCircuitBreaker(metrics, 'gpu-manager-embeddings', gpuManagerEmbeddingsBreaker as unknown as Parameters<typeof instrumentCircuitBreaker>[2]);

async function generateEmbedding(text: string): Promise<number[]> {
  try {
    return await gpuManagerEmbeddingsBreaker.fire(text) as number[];
  } catch (error) {
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      logger.warn('Circuit breaker aberto - Embeddings temporariamente indisponível');
      throw new Error('Serviço de embeddings temporariamente indisponível. Tente novamente em alguns segundos.');
    }
    throw error;
  }
}

// SEGURANÇA: Helmet com CSP/HSTS enterprise (Express.js 2025 + OWASP 2023)
app.use(createSecurityMiddleware({
  contentSecurityPolicy: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV !== 'production',
}));

// OBSERVABILITY: Correlation ID middleware para rastreamento distribuído (Node.js 20 LTS 2025)
// Propaga correlation IDs entre microsserviços e injeta nos logs automaticamente
app.use(createCorrelationMiddleware({ serviceName: 'training-service' }));

// PERFORMANCE: Compression para reduzir tamanho de respostas (Express.js 2025)
app.use(compression());

app.use(cors({
  origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : false,
  credentials: CORS_ORIGINS.length > 0,
}));

// SEGURANÇA: Rate limiting multi-tenant (express-rate-limit 2025)
app.use(createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  skipRoutes: ['/api/training/health', '/api/training/stats'],
  serviceName: 'training-service',
}));

// SEGURANÇA: Limites de payload para prevenir DoS (OWASP API4)
app.use(express.json({ limit: '10mb' }));

// =============================================================================
// MIDDLEWARE: Auth híbrida (WS4) — Sessão (cookie) + Bearer JWT OIDC (JWKS)
// =============================================================================
// SSOT: @alice/shared-utils/createSessionAuthMiddleware
// - Popular req.user / req.tenantId para RBAC (`requirePermission`)
// - Aceitar Bearer JWT (OIDC) quando o cookie não está presente
// =============================================================================
app.use(createSessionAuthMiddleware({
  pool: getPool(),
  publicPaths: ['/api/training/health', '/live', '/ready', '/metrics'],
}));

const SIMILARITY_THRESHOLD = 0.85;
// BUG FIX 26/12/2025: JOB_POLLING_INTERVAL_MS removido - fine-tuning em migração para Hetzner GPU

function computeQualityScore(messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>): number {
  if (messages.length < 2) return 0;
  const totalLength = messages.reduce((sum, msg) => sum + msg.content.trim().length, 0);
  if (totalLength < 80) return 0.2;

  const hasUser = messages.some((msg) => msg.role === 'user');
  const hasAssistant = messages.some((msg) => msg.role === 'assistant');
  if (!hasUser || !hasAssistant) return 0.3;

  const averageLength = totalLength / messages.length;
  const lengthScore = Math.min(1, averageLength / 400);
  const balanceScore = hasUser && hasAssistant ? 0.5 : 0.2;

  return Math.min(1, 0.4 + lengthScore * 0.4 + balanceScore);
}

app.get('/api/training/health', async (_req: Request, res: Response) => {
  const embeddingsCircuitState = gpuManagerEmbeddingsBreaker.opened ? 'open' : (gpuManagerEmbeddingsBreaker.halfOpen ? 'half-open' : 'closed');
  
  const overallStatus = embeddingsCircuitState === 'open' ? 'degraded' : 'ok';
  
  res.json({ 
    status: overallStatus, 
    service: 'training-service', 
    timestamp: new Date().toISOString(),
    embeddingsProvider: 'gpu-manager-service',
    model: 'Qwen/Qwen3-Embedding-0.6B (1024 dim → Qdrant)',
    fineTuningStatus: 'enabled',
    circuitBreakers: {
      embeddings: {
        state: embeddingsCircuitState,
        stats: {
          failures: gpuManagerEmbeddingsBreaker.stats.failures,
          successes: gpuManagerEmbeddingsBreaker.stats.successes,
          timeouts: gpuManagerEmbeddingsBreaker.stats.timeouts,
        },
      },
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
    service: 'training-service',
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe - verifica se PostgreSQL e embeddings estão acessíveis
app.get('/ready', async (_req: Request, res: Response) => {
  try {
    const dbHealthy = await isPoolHealthy();
    const embeddingsReady = !gpuManagerEmbeddingsBreaker.opened;
    
    const allReady = dbHealthy && embeddingsReady;
    
    if (allReady) {
      res.status(200).json({
        status: 'ready',
        service: 'training-service',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgresql: 'ready',
          embeddings: 'ready',
        },
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        service: 'training-service',
        reason: !dbHealthy ? 'PostgreSQL não está acessível' : 'Embeddings circuit breaker aberto',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgresql: dbHealthy ? 'ready' : 'not_ready',
          embeddings: embeddingsReady ? 'ready' : 'circuit_open',
        },
      });
    }
  } catch (error) {
    logger.error({ error }, 'Erro ao verificar readiness');
    res.status(503).json({
      status: 'not_ready',
      service: 'training-service',
      reason: 'Erro ao verificar dependências',
      timestamp: new Date().toISOString(),
    });
  }
});

app.post(['/internal/trading/universe/enqueue', '/internal/trading-v2/enqueue/universe-scan'], requireInternalApiAuth, async (req: Request, res: Response) => {
  const payload = tradingUniverseEnqueueSchema.parse(req.body);
  await enqueueTradingJob(tradingQueueNames.universe, payload);
  logger.info({ tenantId: payload.tenantId, instrumentId: payload.instrumentId, queue: tradingQueueNames.universe }, 'Trading V2 universe scan enfileirado');
  res.status(202).json({ queued: true, queue: tradingQueueNames.universe, idempotencyKey: payload.idempotencyKey });
});

app.post(['/internal/trading/backtest/enqueue', '/internal/trading-v2/enqueue/backtest'], requireInternalApiAuth, async (req: Request, res: Response) => {
  const payload = tradingBacktestEnqueueSchema.parse(req.body);
  await enqueueTradingJob(tradingQueueNames.backtest, payload);
  logger.info({ tenantId: payload.tenantId, strategyKey: payload.strategyKey, queue: tradingQueueNames.backtest }, 'Trading V2 backtest enfileirado');
  res.status(202).json({ queued: true, queue: tradingQueueNames.backtest, idempotencyKey: payload.idempotencyKey });
});

app.post(['/internal/trading/calibration/enqueue', '/internal/trading-v2/enqueue/calibration'], requireInternalApiAuth, async (req: Request, res: Response) => {
  const payload = tradingCalibrationEnqueueSchema.parse(req.body);
  await enqueueTradingJob(tradingQueueNames.calibration, payload);
  logger.info({ tenantId: payload.tenantId, strategyKey: payload.strategyKey, queue: tradingQueueNames.calibration }, 'Trading V2 calibration enfileirado');
  res.status(202).json({ queued: true, queue: tradingQueueNames.calibration, idempotencyKey: payload.idempotencyKey });
});

app.post(['/internal/trading/portfolio-rebalance/enqueue', '/internal/trading-v2/enqueue/portfolio-rebalance'], requireInternalApiAuth, async (req: Request, res: Response) => {
  const payload = tradingRebalanceEnqueueSchema.parse(req.body);
  await enqueueTradingJob(tradingQueueNames.rebalance, payload);
  logger.info({ tenantId: payload.tenantId, portfolioId: payload.portfolioId, queue: tradingQueueNames.rebalance }, 'Trading V2 rebalance enfileirado');
  res.status(202).json({ queued: true, queue: tradingQueueNames.rebalance, idempotencyKey: payload.idempotencyKey });
});

app.post(['/internal/trading/model-risk/enqueue', '/internal/trading-v2/enqueue/model-risk'], requireInternalApiAuth, async (req: Request, res: Response) => {
  const payload = tradingModelRiskEnqueueSchema.parse(req.body);
  await enqueueTradingJob(tradingQueueNames.modelRisk, payload);
  logger.info({ tenantId: payload.tenantId, scope: payload.scope, scopeKey: payload.scopeKey, queue: tradingQueueNames.modelRisk }, 'Trading V2 model risk enfileirado');
  res.status(202).json({ queued: true, queue: tradingQueueNames.modelRisk, idempotencyKey: payload.idempotencyKey });
});

// ============================================================================
// SYSTEM CONFIG - Configurações editáveis via UI (RAG, Chat, Treino)
// Ref: docs/TREINAMENTO-LIMITES-E-BOAS-PRATICAS.md
// ============================================================================
app.get('/api/training/system-config', requirePermission('config:system:read'), async (_req: Request, res: Response) => {
  try {
    const config = await getAllSystemConfig();
    res.json(config);
  } catch (error) {
    logger.error({ error }, 'Erro ao obter system config');
    res.status(500).json({ error: 'Erro ao obter configurações' });
  }
});

const systemConfigPatchSchema = z.object({
  configs: z.record(z.string().min(1)),
});

app.patch('/api/training/system-config', requirePermission('config:system:write'), async (req: Request, res: Response) => {
  try {
    const body = systemConfigPatchSchema.parse(req.body);
    const knownKeys = [
      'DOCUMENT_MAX_CHUNKS',
      'TRAINING_DOC_MAX_SAMPLES',
      'TRAINING_CONVERSATION_MAX_MESSAGES',
      'CONVERSATION_SLICE_SIZE',
      'MIN_ONDEMAND_DATASET_SIZE',
      'maxSeqLen',
    ] as const;
    for (const [key, value] of Object.entries(body.configs)) {
      if (knownKeys.includes(key as (typeof knownKeys)[number])) {
        await setSystemConfig(key, String(value));
      }
    }
    const config = await getAllSystemConfig();
    res.json(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Payload inválido', details: error.flatten() });
      return;
    }
    logger.error({ error }, 'Erro ao atualizar system config');
    res.status(500).json({ error: 'Erro ao atualizar configurações' });
  }
});

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1, 'Conteúdo da mensagem é obrigatório'),
});

const trainingSourceTypeSchema = z.enum([
  'chat',
  'trading_signal',
  'trading_order',
  'trading_demo',
  'trading_postmortem',
  'document',
  'rag_document',
  'rag_media', // Plano RAG Multimodal Fase 4 - mídia (imagem/áudio) promovida para treinamento
  'upload',
  'external',
  'manual',
  'system',
]);

function parseEnvFloat(envValue: string | undefined, defaultValue: number, varName: string): number {
  const raw = envValue ?? String(defaultValue);
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    const errorMsg = `${varName} inválido: "${raw}". Deve ser número positivo.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ varName, rawValue: raw }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, defaultValue }, `${errorMsg} Usando valor padrão.`);
    return defaultValue;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const errorMsg = `${varName} inválido: "${raw}". Deve ser número positivo.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ varName, rawValue: raw, parsed }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, parsed, defaultValue }, `${errorMsg} Usando valor padrão.`);
    return defaultValue;
  }
  return parsed;
}

const TRAINING_DATA_MIN_QUALITY = parseEnvFloat(
  process.env.TRAINING_DATA_MIN_QUALITY,
  0.35,
  'TRAINING_DATA_MIN_QUALITY'
);

const TRAINING_SCHEDULER_POLL_MS = parseEnvInt(
  process.env.TRAINING_SCHEDULER_POLL_MS,
  60000,
  'TRAINING_SCHEDULER_POLL_MS'
);

const collectTrainingDataSchema = z.object({
  tenantId: z.string().uuid('Tenant ID deve ser UUID válido'),
  namespaceId: z.string().uuid('Namespace ID deve ser UUID válido').optional(),
  agentId: z.string().uuid('Agent ID deve ser UUID válido').optional(),
  domain: z.string().min(1).max(120).optional(),
  conversationId: z.string().uuid('Conversation ID deve ser UUID válido').optional(),
  source: z.string().min(1, 'Fonte é obrigatória'),
  sourceType: trainingSourceTypeSchema.optional(),
  sourceId: z.string().min(1).max(255).optional(),
  sourceMetadata: z.record(z.unknown()).optional(),
  messages: z.array(messageSchema).min(1, 'Pelo menos uma mensagem é obrigatória'),
  rating: z.number().min(1).max(5).optional(),
});

app.post('/api/training/data', requirePermission('training:training_data:write'), async (req: Request, res: Response) => {
  try {
    const body = collectTrainingDataSchema.parse(req.body);
    const authContext = extractAuthContext(req);
    const resolvedTenantId = authContext?.tenantId || body.tenantId;
    const createdBy = authContext?.userId ?? undefined;

    // SEGURANÇA: Validação cross-tenant - namespaceId/agentId do body devem pertencer ao tenant
    if (body.namespaceId) {
      await validateNamespaceTenantConsistency(
        body.namespaceId,
        resolvedTenantId,
        async (id) => getDatabase().query.namespaces.findFirst({ where: eq(schema.namespaces.id, id), columns: { id: true, tenantId: true } })
      );
    }
    if (body.agentId) {
      const agent = await getDatabase().query.agents.findFirst({ where: eq(schema.agents.id, body.agentId), columns: { id: true, tenantId: true } });
      validateTenantConsistency('agent', agent, resolvedTenantId, 'training_data');
    }

    const messagesText = body.messages.map(m => m.content).join('\n');
    const scope = await resolveScope({
      tenantId: resolvedTenantId,
      namespaceId: body.namespaceId ?? null,
      agentId: body.agentId ?? null,
      domain: body.domain ?? null,
      sourceType: body.sourceType ?? null,
      sourceId: body.sourceId ?? null,
      sourceMetadata: body.sourceMetadata ?? {},
      conversationId: body.conversationId ?? null,
      messagesText,
    });

    const effectiveNamespaceId = body.namespaceId ?? scope.namespaceId ?? null;
    const effectiveAgentId = body.agentId ?? scope.agentId ?? null;
    const inferredStatusNotes: string[] = [];
    if (scope.needsHumanReview) {
      inferredStatusNotes.push(
        `Escopo em quarentena automática: confidence=${scope.confidence.toFixed(2)}`
      );
      trainingPipelineMetrics.scopeQuarantineTotal.inc({
        source_type: body.sourceType ?? 'unknown',
        reason: 'low_confidence_or_missing_namespace',
      });
    }
    if (scope.suggestedNewNamespace) {
      trainingPipelineMetrics.scopeSuggestedNewNamespaceTotal.inc({
        source_type: body.sourceType ?? 'unknown',
      });
    }
    const semhash = computeSemHash(messagesText);
    const embedding = await generateEmbedding(messagesText);
    const qualityScore = computeQualityScore(body.messages);

    const existingData = await db.query.trainingData.findMany({
      where: and(
        eq(schema.trainingData.tenantId, resolvedTenantId),
        inArray(schema.trainingData.status, ['pending', 'approved', 'used']),
        not(isNull(schema.trainingData.embedding))
      ),
    });

    let isDuplicate = false;
    let duplicateOfId: string | undefined;
    let highestSimilarity = 0;

    for (const existing of existingData) {
      if (existing.semhash === semhash) {
        isDuplicate = true;
        duplicateOfId = existing.id;
        highestSimilarity = 1.0;
        break;
      }

      if (existing.embedding) {
        const similarity = cosineSimilarity(embedding, existing.embedding);
        if (similarity > SIMILARITY_THRESHOLD && similarity > highestSimilarity) {
          isDuplicate = true;
          duplicateOfId = existing.id;
          highestSimilarity = similarity;
        }
      }
    }

    const autoRejectedByQuality = !isDuplicate && qualityScore < TRAINING_DATA_MIN_QUALITY;
    const status = isDuplicate || autoRejectedByQuality ? 'rejected' : 'pending';
    const reviewNotes = autoRejectedByQuality
      ? `Auto-rejeitado: qualidade ${qualityScore.toFixed(2)} abaixo do mínimo (${TRAINING_DATA_MIN_QUALITY}).`
      : null;

    const [trainingData] = await db.insert(schema.trainingData).values({
      tenantId: resolvedTenantId,
      namespaceId: effectiveNamespaceId,
      agentId: effectiveAgentId,
      conversationId: body.conversationId,
      source: body.source,
      sourceType: body.sourceType ?? 'manual',
      sourceId: body.sourceId ?? null,
      sourceMetadata: body.sourceMetadata ?? {},
      inferredNamespaceId: scope.namespaceId,
      inferredAgentId: scope.agentId,
      inferredDomain: scope.domain,
      inferenceConfidence: scope.confidence,
      inferenceTrace: scope.trace,
      scopeResolverVersion: 'v1',
      profileVersion: 1,
      needsHumanReview: scope.needsHumanReview,
      quarantineReason: scope.needsHumanReview ? 'low_confidence_or_missing_namespace' : null,
      scopeResolvedAt: new Date(),
      quarantinedAt: scope.needsHumanReview ? new Date() : null,
      messages: body.messages,
      rating: body.rating,
      qualityScore,
      createdBy,
      semhash,
      embedding,
      isDuplicate,
      duplicateOfId,
      similarityScore: highestSimilarity > 0 ? highestSimilarity : null,
      status,
      reviewNotes: [reviewNotes, ...inferredStatusNotes].filter(Boolean).join(' | ') || null,
    }).returning();

    const sourceTypeMetric = body.sourceType ?? 'manual';
    trainingPipelineMetrics.dataCollectedTotal.labels(sourceTypeMetric, status).inc();
    trainingPipelineMetrics.qualityScore.observe(qualityScore);
    if (isDuplicate) {
      trainingPipelineMetrics.dataDuplicatesTotal.labels(sourceTypeMetric).inc();
      trainingPipelineMetrics.dataRejectedTotal.labels('duplicate', sourceTypeMetric).inc();
    }
    if (autoRejectedByQuality) {
      trainingPipelineMetrics.dataRejectedTotal.labels('quality', sourceTypeMetric).inc();
    }

    logger.info({
      trainingDataId: trainingData.id, 
      isDuplicate, 
      similarity: highestSimilarity,
      scope: {
        namespaceId: effectiveNamespaceId,
        agentId: effectiveAgentId,
        inferredNamespaceId: scope.namespaceId,
        inferredAgentId: scope.agentId,
        inferredDomain: scope.domain,
        confidence: scope.confidence,
        needsHumanReview: scope.needsHumanReview,
      },
    }, 'Dados de treinamento coletados');

    res.json({ 
      trainingData, 
      isDuplicate,
      duplicateOfId,
      similarityScore: highestSimilarity,
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao coletar dados de treinamento');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/training/data', requirePermission('training:training_data:read'), async (req: Request, res: Response) => {
  // OWASP API3: Validação de query params
  const queryResult = trainingDataQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }
  const { status, namespaceId, agentId, inferredDomain, needsHumanReview, sourceType } = queryResult.data;

  try {
    const conditions = [];
    if (status) conditions.push(eq(schema.trainingData.status, status as 'pending' | 'approved' | 'rejected' | 'used'));
    if (namespaceId) conditions.push(eq(schema.trainingData.namespaceId, namespaceId));
    if (agentId) conditions.push(eq(schema.trainingData.agentId, agentId));
    if (inferredDomain) conditions.push(eq(schema.trainingData.inferredDomain, inferredDomain));
    if (needsHumanReview) conditions.push(eq(schema.trainingData.needsHumanReview, needsHumanReview === 'true'));
    if (sourceType) conditions.push(eq(schema.trainingData.sourceType, sourceType));

    const trainingData = await db.query.trainingData.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [desc(schema.trainingData.criadoEm)],
      limit: 100,
    });

    res.json({ trainingData });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar dados de treinamento');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// OWASP API3 - Schema para validação de parâmetros de rota (UUID)
const uuidParamSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID válido'),
});

// OWASP API3 - Schema para validação de status
const statusUpdateSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reviewNotes: z.string().max(2000).optional(),
  overrideScope: z.object({
    namespaceId: z.string().uuid().optional().nullable(),
    agentId: z.string().uuid().optional().nullable(),
    domain: z.string().min(1).max(120).optional().nullable(),
    reason: z.string().min(10).max(2000),
  }).optional(),
});

app.patch('/api/training/data/:id/status', requirePermission('training:training_data:manage'), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  
  // OWASP API3: Validação de body
  const bodyResult = statusUpdateSchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({ error: 'Status inválido', details: bodyResult.error.format() });
  }
  const { status, reviewNotes, overrideScope } = bodyResult.data;
  const authContext = extractAuthContext(req);
  const reviewedBy = authContext?.userId ?? undefined;

  try {
    const existing = await db.query.trainingData.findFirst({
      where: eq(schema.trainingData.id, id),
    });

    if (!existing) {
      return res.status(404).json({ error: 'Registro de treinamento não encontrado' });
    }

    if (!existing.namespaceId && status === 'approved' && !overrideScope?.namespaceId) {
      return res.status(400).json({
        error: 'Não é possível aprovar sem namespace definido. Resolva o escopo primeiro.',
      });
    }

    if (existing.needsHumanReview && status === 'approved' && !overrideScope) {
      return res.status(400).json({
        error: 'Item em quarentena de escopo. Resolva o escopo antes de aprovar.',
      });
    }

    let nextNamespaceId = existing.namespaceId;
    let nextAgentId = existing.agentId;
    let nextDomain = existing.inferredDomain;
    const overrideApplied =
      Boolean(overrideScope) &&
      (
        (overrideScope?.namespaceId ?? existing.namespaceId) !== existing.namespaceId ||
        (overrideScope?.agentId ?? existing.agentId) !== existing.agentId ||
        (overrideScope?.domain ?? existing.inferredDomain) !== existing.inferredDomain
      );

    if (overrideScope) {
      if (!overrideScope.reason?.trim()) {
        return res.status(400).json({ error: 'Motivo é obrigatório para override de escopo' });
      }

      if (overrideScope.namespaceId) {
        const namespace = await db.query.namespaces.findFirst({
          where: eq(schema.namespaces.id, overrideScope.namespaceId),
          columns: { id: true, tenantId: true },
        });
        if (!namespace || namespace.tenantId !== existing.tenantId) {
          return res.status(403).json({ error: 'Namespace de override inválido para o tenant do item' });
        }
        nextNamespaceId = namespace.id;
      }

      if (overrideScope.agentId) {
        const agent = await db.query.agents.findFirst({
          where: eq(schema.agents.id, overrideScope.agentId),
          columns: { id: true, tenantId: true, namespaceId: true },
        });
        if (!agent || agent.tenantId !== existing.tenantId) {
          return res.status(403).json({ error: 'Agente de override inválido para o tenant do item' });
        }
        if (nextNamespaceId && agent.namespaceId && agent.namespaceId !== nextNamespaceId) {
          return res.status(403).json({ error: 'Agente selecionado não pertence ao namespace alvo' });
        }
        nextAgentId = agent.id;
        if (!nextNamespaceId && agent.namespaceId) {
          nextNamespaceId = agent.namespaceId;
        }
      }

      if (overrideScope.domain) {
        nextDomain = overrideScope.domain;
      }

      if (overrideApplied && reviewedBy) {
        if (!existing.tenantId) {
          return res.status(400).json({
            error: 'Item sem tenant válido não pode receber override de escopo',
          });
        }
        await db.insert(schema.trainingScopeOverrides).values({
          trainingDataId: id,
          tenantId: existing.tenantId,
          oldNamespaceId: existing.namespaceId,
          newNamespaceId: nextNamespaceId,
          oldDomain: existing.inferredDomain,
          newDomain: nextDomain,
          oldAgentId: existing.agentId,
          newAgentId: nextAgentId,
          changedBy: reviewedBy,
          reason: overrideScope.reason,
          source: 'training_review',
        });
        trainingPipelineMetrics.scopeOverrideTotal.inc({ source: 'training_review' });
      }
    }

    const [updated] = await db.update(schema.trainingData)
      .set({ 
        status: status as 'approved' | 'rejected',
        processadoEm: new Date(),
        reviewedBy,
        reviewedAt: new Date(),
        reviewNotes: reviewNotes ?? null,
        namespaceId: nextNamespaceId,
        agentId: nextAgentId,
        inferredDomain: nextDomain,
        needsHumanReview: false,
        quarantineReason: null,
        quarantinedAt: null,
      })
      .where(eq(schema.trainingData.id, id))
      .returning();

    trainingPipelineMetrics.reviewTotal.labels(status).inc();

    logger.info({ trainingDataId: id, status, overrideApplied }, 'Status de treinamento atualizado');
    res.json({ trainingData: updated });
  } catch (error) {
    logger.error({ error }, 'Falha ao atualizar status de treinamento');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

const resolveScopeSchema = z.object({
  namespaceId: z.string().uuid(),
  agentId: z.string().uuid().optional().nullable(),
  domain: z.string().min(1).max(120).optional().nullable(),
  reason: z.string().min(10).max(2000),
});

app.patch('/api/training/data/:id/resolve-scope', requirePermission('training:training_data:manage'), async (req: Request, res: Response) => {
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramsResult.error.format() });
  }
  const bodyResult = resolveScopeSchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({ error: 'Payload inválido', details: bodyResult.error.format() });
  }

  const authContext = extractAuthContext(req);
  const changedBy = authContext?.userId;
  if (!changedBy) {
    return res.status(403).json({ error: 'Usuário não identificado para resolver escopo' });
  }

  try {
    const existing = await db.query.trainingData.findFirst({
      where: eq(schema.trainingData.id, paramsResult.data.id),
    });
    if (!existing) {
      return res.status(404).json({ error: 'Registro de treinamento não encontrado' });
    }
    if (!existing.tenantId) {
      return res.status(400).json({ error: 'Item sem tenant válido não pode ser resolvido' });
    }

    const namespace = await db.query.namespaces.findFirst({
      where: eq(schema.namespaces.id, bodyResult.data.namespaceId),
      columns: { id: true, tenantId: true },
    });
    if (!namespace || namespace.tenantId !== existing.tenantId) {
      return res.status(403).json({ error: 'Namespace não pertence ao tenant do item' });
    }

    const nextAgentId: string | null = bodyResult.data.agentId ?? null;
    if (nextAgentId) {
      const agent = await db.query.agents.findFirst({
        where: eq(schema.agents.id, nextAgentId),
        columns: { id: true, tenantId: true, namespaceId: true },
      });
      if (!agent || agent.tenantId !== existing.tenantId) {
        return res.status(403).json({ error: 'Agente inválido para o tenant do item' });
      }
      if (agent.namespaceId && agent.namespaceId !== namespace.id) {
        return res.status(403).json({ error: 'Agente não pertence ao namespace informado' });
      }
    }

    await db.insert(schema.trainingScopeOverrides).values({
      trainingDataId: existing.id,
      tenantId: existing.tenantId,
      oldNamespaceId: existing.namespaceId,
      newNamespaceId: namespace.id,
      oldDomain: existing.inferredDomain,
      newDomain: bodyResult.data.domain ?? existing.inferredDomain,
      oldAgentId: existing.agentId,
      newAgentId: nextAgentId,
      changedBy,
      reason: bodyResult.data.reason,
      source: 'quarantine_resolution',
    });
    trainingPipelineMetrics.scopeOverrideTotal.inc({ source: 'quarantine_resolution' });
    trainingPipelineMetrics.scopeResolvedTotal.inc({ source: 'quarantine_resolution' });

    const [updated] = await db.update(schema.trainingData)
      .set({
        namespaceId: namespace.id,
        agentId: nextAgentId,
        inferredDomain: bodyResult.data.domain ?? existing.inferredDomain,
        needsHumanReview: false,
        quarantineReason: null,
        quarantinedAt: null,
        scopeResolvedAt: new Date(),
        reviewedBy: changedBy,
        reviewedAt: new Date(),
      })
      .where(eq(schema.trainingData.id, existing.id))
      .returning();

    return res.json({ trainingData: updated });
  } catch (error) {
    logger.error({ error }, 'Falha ao resolver escopo em quarentena');
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/training/jobs', requirePermission('training:fine_tuning_jobs:read'), async (req: Request, res: Response) => {
  // OWASP API3: Validação de query params
  const queryResult = jobsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }
  const { tenantId } = queryResult.data;

  try {
    const jobs = await db.query.fineTuningJobs.findMany({
      where: tenantId ? eq(schema.fineTuningJobs.tenantId, tenantId) : undefined,
      orderBy: [desc(schema.fineTuningJobs.criadoEm)],
      limit: 50,
    });

    res.json({ jobs });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar jobs');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Gate 2: Treinamento deve usar o MESMO modelo base do LLM (texto)
const MIN_ONDEMAND_DATASET_SIZE = Math.max(
  1,
  parseInt(process.env.MIN_ONDEMAND_DATASET_SIZE ?? '10', 10) || 10
);

const createJobSchema = z.object({
  tenantId: z.string().uuid().optional(),
  namespaceId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  domain: z.string().min(1).max(120).optional(),
  name: z.string().min(1),
  baseModel: z.string().default(GPU_MANAGER_CONFIG.models.llm),
  hyperparameters: z.object({
    epochs: z.number().default(3),
    learningRate: z.number().default(0.0001),
    batchSize: z.number().default(4),
    maxSeqLen: z.number().int().min(256).max(32768).optional(),
  }).optional(),
  forceMinSize: z.boolean().optional(),
});

app.post('/api/training/jobs', requirePermission('training:fine_tuning_jobs:start'), async (req: Request, res: Response) => {
  try {
    const body = createJobSchema.parse(req.body);

    const namespace = await db.query.namespaces.findFirst({
      where: eq(schema.namespaces.id, body.namespaceId),
      columns: { id: true, tenantId: true },
    });
    if (!namespace) {
      return res.status(404).json({ error: 'Namespace não encontrado' });
    }
    if (body.tenantId && namespace.tenantId !== body.tenantId) {
      return res.status(403).json({ error: 'Namespace não pertence ao tenant informado' });
    }
    const tenantId = body.tenantId ?? namespace.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant inválido para criação de job de treinamento' });
    }

    const approvedConditions = [
      eq(schema.trainingData.status, 'approved'),
      eq(schema.trainingData.isDuplicate, false),
      isNull(schema.trainingData.usedInJobId),
      eq(schema.trainingData.namespaceId, body.namespaceId),
    ];
    approvedConditions.push(eq(schema.trainingData.tenantId, tenantId));
    if (body.agentId) approvedConditions.push(eq(schema.trainingData.agentId, body.agentId));
    
    const approvedDataRaw = await db.query.trainingData.findMany({
      where: and(...approvedConditions),
    });

    const profileSelection = await selectExamplesByProfile(
      {
        tenantId,
        namespaceId: body.namespaceId,
        agentId: body.agentId ?? null,
        domain: body.domain ?? null,
      },
      'training_job',
      approvedDataRaw.map((item) => ({
        id: item.id,
        sourceType: item.sourceType,
        sourceMetadata: item.sourceMetadata as Record<string, unknown>,
        qualityScore: item.qualityScore,
        messages: item.messages as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
      }))
    );

    const approvedIds = new Set(profileSelection.selected.map((item) => item.id));
    const approvedData = approvedDataRaw.filter((item) => approvedIds.has(item.id));

    const minOndemand = await resolveMinOndemandDatasetSize();
    const defaultMaxSeqLen = await resolveDefaultMaxSeqLen();
    const minRequired = body.forceMinSize ? 1 : minOndemand;
    if (approvedData.length < minRequired) {
      return res.status(400).json({ 
        error: 'Dados de treinamento insuficientes',
        required: minRequired,
        available: approvedData.length,
        hint: body.forceMinSize ? 'Poucos exemplos podem prejudicar o modelo. Use por sua conta e risco.' : undefined,
      });
    }

    const [job] = await db.insert(schema.fineTuningJobs).values({
      tenantId,
      name: body.name,
      baseModel: body.baseModel,
      status: 'pending',
      trainingDataCount: approvedData.length,
      metrics: {
        scope: {
          namespaceId: body.namespaceId,
          agentId: body.agentId ?? null,
          domain: body.domain ?? null,
        },
      },
      hyperparameters: body.hyperparameters || {
        epochs: 3,
        learningRate: 0.0001,
        batchSize: 4,
        maxSeqLen: defaultMaxSeqLen,
      },
    }).returning();

    const jobHyperparameters: FineTuningJobHyperparams = body.hyperparameters
      ? { ...body.hyperparameters, maxSeqLen: body.hyperparameters.maxSeqLen ?? defaultMaxSeqLen }
      : { epochs: 3, learningRate: 0.0001, batchSize: 4, maxSeqLen: defaultMaxSeqLen };
    
    // Execução real (LoRA) via GPU Manager Service (prioridade baixa)
    processFineTuningJob(job.id, jobHyperparameters).catch((err: unknown) => {
      logger.error({ error: err, jobId: job.id }, 'Job de fine-tuning falhou');
    });

    logger.info({
      jobId: job.id,
      dataCount: approvedData.length,
      scope: { tenantId, namespaceId: body.namespaceId, agentId: body.agentId ?? null },
      profileVersion: profileSelection.profileVersion,
    }, 'Job de fine-tuning criado');
    res.json({ job, profileSelection: profileSelection.diagnostics });
  } catch (error) {
    logger.error({ error }, 'Falha ao criar job');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// NOTA: Não usamos polling in-memory. Estado é persistido em DB e retomado no startup.

/**
 * Processa job de fine-tuning
 * 
 * ARQUITETURA ENTERPRISE (26/12/2025): Fine-tuning LoRA REAL via GPU Manager Service
 * - Dataset JSONL persistido em /opt/alice/uploads/training
 * - Execução em slices curtas (preempção real: chat/WhatsApp > embeddings > training)
 * - Retomável: estado persistido em DB (metrics) + checkpoints no disco
 */
const TRAINING_STORAGE_DIR = process.env.TRAINING_STORAGE_DIR || '/opt/alice/uploads/training';

type FineTuningJobHyperparams = { epochs: number; learningRate: number; batchSize: number; maxSeqLen?: number };

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJsonl(filePath: string, lines: Array<Record<string, unknown>>): Promise<void> {
  const content = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  await fs.writeFile(filePath, content, { encoding: 'utf-8' });
}

function buildChatMlText(messages: Array<{ role: string; content: string }>): string {
  // Formato simples e determinístico para SFT: "role: content"
  // O trainer valida que existe campo 'text' no JSONL.
  return messages.map((m) => `${m.role}: ${m.content}`).join('\n');
}

async function prepareFineTuningDatasetFiles(
  jobId: string,
  tenantId: string,
  scope?: { namespaceId?: string | null; agentId?: string | null; domain?: string | null }
): Promise<{ trainPath: string; evalPath: string; outputDir: string; manifestPath: string; trainCount: number; evalCount: number; }> {
  const approvedConditions = [
    eq(schema.trainingData.status, 'approved'),
    eq(schema.trainingData.tenantId, tenantId),
    isNull(schema.trainingData.usedInJobId),
  ];
  if (scope?.namespaceId) approvedConditions.push(eq(schema.trainingData.namespaceId, scope.namespaceId));
  if (scope?.agentId) approvedConditions.push(eq(schema.trainingData.agentId, scope.agentId));
  if (scope?.domain) approvedConditions.push(eq(schema.trainingData.inferredDomain, scope.domain));

  const approvedRaw = await db.query.trainingData.findMany({
    where: and(...approvedConditions),
    limit: 5000,
  });

  const profileSelection = scope?.namespaceId
    ? await selectExamplesByProfile(
      {
        tenantId,
        namespaceId: scope.namespaceId,
        agentId: scope.agentId ?? null,
        domain: scope.domain ?? null,
      },
      'fine_tuning',
      approvedRaw.map((item) => ({
        id: item.id,
        sourceType: item.sourceType,
        sourceMetadata: item.sourceMetadata as Record<string, unknown>,
        qualityScore: item.qualityScore,
        messages: item.messages as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
      }))
    )
    : { selected: approvedRaw };
  const approvedIds = new Set(profileSelection.selected.map((item) => item.id));
  const approved = approvedRaw.filter((item) => approvedIds.has(item.id));

  if (approved.length < 10) {
    throw new Error(`Dados aprovados insuficientes para fine-tuning: ${approved.length}/10`);
  }

  const jobDir = path.join(TRAINING_STORAGE_DIR, 'fine-tuning', tenantId, jobId);
  const outputDir = path.join(jobDir, 'output');
  await ensureDir(outputDir);

  // Split determinístico 90/10
  const splitIndex = Math.floor(approved.length * 0.9);
  const train = approved.slice(0, splitIndex);
  const evalData = approved.slice(splitIndex);

  const trainLines = train.map((d) => ({ text: buildChatMlText(d.messages as Array<{ role: string; content: string }>) }));
  const evalLines = evalData.map((d) => ({ text: buildChatMlText(d.messages as Array<{ role: string; content: string }>) }));

  const trainPath = path.join(jobDir, 'train.jsonl');
  const evalPath = path.join(jobDir, 'eval.jsonl');
  const manifestPath = path.join(jobDir, 'manifest.json');

  await writeJsonl(trainPath, trainLines);
  await writeJsonl(evalPath, evalLines);

  const sourceTypeCounts = approved.reduce<Record<string, number>>((acc, item) => {
    const key = item.sourceType ?? 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  await fs.writeFile(
    manifestPath,
    JSON.stringify({
      jobId,
      tenantId,
      createdAt: new Date().toISOString(),
      total: approved.length,
      trainCount: trainLines.length,
      evalCount: evalLines.length,
      trainIds: train.map((d) => d.id),
      evalIds: evalData.map((d) => d.id),
      sourceTypeCounts,
      scope: scope ?? null,
      profileVersion: scope?.namespaceId && 'profileVersion' in profileSelection ? profileSelection.profileVersion : null,
    }, null, 2),
    { encoding: 'utf-8' }
  );

  // Marcar dados como usados (persistência enterprise)
  for (const row of approved) {
    await db.update(schema.trainingData)
      .set({ status: 'used', usedInJobId: jobId })
      .where(eq(schema.trainingData.id, row.id));
  }

  return { trainPath, evalPath, outputDir, manifestPath, trainCount: trainLines.length, evalCount: evalLines.length };
}

function computeTargetSteps(trainCount: number, hyper: FineTuningJobHyperparams): number {
  const stepsPerEpoch = Math.max(1, Math.ceil(trainCount / Math.max(1, hyper.batchSize)));
  return Math.max(1, hyper.epochs * stepsPerEpoch);
}

async function processFineTuningJob(jobId: string, hyperparameters: FineTuningJobHyperparams): Promise<void> {
  const job = await db.query.fineTuningJobs.findFirst({ where: eq(schema.fineTuningJobs.id, jobId) });
  if (!job) {
    throw new Error('Job não encontrado');
  }
  if (!job.tenantId) {
    throw new Error('tenantId ausente no job');
  }

  // Se já finalizado, não reprocessar
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return;
  }

  // Preparar dataset (idempotente por jobId)
  await db.update(schema.fineTuningJobs)
    .set({ status: 'preparing', iniciadoEm: job.iniciadoEm ?? new Date() })
    .where(eq(schema.fineTuningJobs.id, jobId));

  const jobMetrics = (job.metrics ?? {}) as Record<string, unknown>;
  const scope = (jobMetrics.scope ?? {}) as { namespaceId?: string | null; agentId?: string | null; domain?: string | null };
  const { trainPath, evalPath, outputDir, manifestPath, trainCount, evalCount } =
    await prepareFineTuningDatasetFiles(jobId, job.tenantId, scope);
  const targetSteps = computeTargetSteps(trainCount, hyperparameters);

  await db.update(schema.fineTuningJobs)
    .set({
      status: 'training',
      trainingDataCount: trainCount,
      validationDataCount: evalCount,
      progress: 0,
      metrics: {
        scope,
        dataset: { trainPath, evalPath, outputDir, manifestPath, trainCount, evalCount, targetSteps },
        stepsCompleted: 0,
      },
    })
    .where(eq(schema.fineTuningJobs.id, jobId));

  // Execução em slices curtas para permitir preempção
  const sliceSteps = 5;
  let stepsCompleted = 0;

  while (stepsCompleted < targetSteps) {
    const fresh = await db.query.fineTuningJobs.findFirst({ where: eq(schema.fineTuningJobs.id, jobId) });
    if (!fresh) throw new Error('Job sumiu durante processamento');
    if (fresh.status === 'cancelled') {
      logger.warn({ jobId }, 'Job cancelado - interrompendo processamento');
      return;
    }

    const gpuResult = await requestGpu({
      serviceType: GpuServiceType.TRAINING,
      endpoint: '/train/lora/slice',
      method: 'POST',
      priority: GpuRequestPriority.LOW, // prioridade 3 (chat/whatsapp > embeddings > training)
      timeout: 25000,
      body: {
        jobId,
        baseModel: fresh.baseModel,
        trainJsonlPath: trainPath,
        evalJsonlPath: evalPath,
        outputDir,
        stepsThisSlice: Math.min(sliceSteps, targetSteps - stepsCompleted),
        hyperparameters: {
          epochs: hyperparameters.epochs,
          learningRate: hyperparameters.learningRate,
          batchSize: hyperparameters.batchSize,
          maxSeqLen: hyperparameters.maxSeqLen ?? 2048,
        },
      },
    });

    const data = gpuResult.data as { stepsCompleted?: number; adapterPath?: string; durationMs?: number } | undefined;
    stepsCompleted = data?.stepsCompleted ?? (stepsCompleted + sliceSteps);
    const progressPct = Math.min(99, Math.floor((stepsCompleted / targetSteps) * 100));

    await db.update(schema.fineTuningJobs)
      .set({
        status: stepsCompleted >= targetSteps ? 'validating' : 'training',
        progress: progressPct,
        metrics: {
          dataset: { trainPath, evalPath, outputDir, trainCount, evalCount, targetSteps },
          stepsCompleted,
          lastSliceMs: data?.durationMs ?? null,
        },
        resultModel: data?.adapterPath ?? null,
      })
      .where(eq(schema.fineTuningJobs.id, jobId));
  }

  // Finalizar
  const finalJob = await db.query.fineTuningJobs.findFirst({ where: eq(schema.fineTuningJobs.id, jobId) });
  const adapterPath = (finalJob?.resultModel ?? null) as string | null;
  if (!adapterPath) {
    throw new Error('AdapterPath não foi gerado pelo trainer');
  }

  await db.update(schema.fineTuningJobs)
    .set({
      status: 'completed',
      progress: 100,
      completadoEm: new Date(),
    })
    .where(eq(schema.fineTuningJobs.id, jobId));

  metrics.training.completedJobsTotal.inc(1);
  void refreshTrainingMetrics();

  logger.info({ jobId, adapterPath }, 'Fine-tuning concluído (LoRA)');
}

async function resumePendingFineTuningJobs(): Promise<void> {
  const pending = await db.query.fineTuningJobs.findMany({
    where: and(
      not(eq(schema.fineTuningJobs.status, 'completed')),
      not(eq(schema.fineTuningJobs.status, 'failed')),
      not(eq(schema.fineTuningJobs.status, 'cancelled'))
    ),
    limit: 10,
  });

  for (const job of pending) {
    // Rodar em background, mas com retomada via DB. (Sem depender de polling em memória)
    processFineTuningJob(job.id, (job.hyperparameters as FineTuningJobHyperparams) || { epochs: 3, learningRate: 0.0001, batchSize: 4, maxSeqLen: 2048 })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ jobId: job.id, error: msg }, 'Falha ao retomar fine-tuning job');
        db.update(schema.fineTuningJobs)
          .set({ status: 'failed', errorMessage: msg, completadoEm: new Date() })
          .where(eq(schema.fineTuningJobs.id, job.id))
          .catch(() => {});
        metrics.training.failedJobsTotal.inc(1);
        void refreshTrainingMetrics();
      });
  }
}

async function resumePendingLoraJobs(): Promise<void> {
  const pending = await db.query.loraJobs.findMany({
    where: and(
      not(eq(schema.loraJobs.status, 'completed')),
      not(eq(schema.loraJobs.status, 'failed')),
      not(eq(schema.loraJobs.status, 'cancelled'))
    ),
    limit: 5,
  });

  for (const job of pending) {
    processLoraJob(job.id).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ jobId: job.id, error: msg }, 'Falha ao retomar LoRA job');
      db.update(schema.loraJobs)
        .set({ status: 'failed', errorMessage: msg, completedAt: new Date() })
        .where(eq(schema.loraJobs.id, job.id))
        .catch(() => {});
    });
  }
}

// Polling removido (Regra 6): cancelamento e progresso são tratados via DB + gpu-trainer

app.get('/api/training/jobs/:id', requirePermission('training:fine_tuning_jobs:read'), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;

  try {
    const job = await db.query.fineTuningJobs.findFirst({
      where: eq(schema.fineTuningJobs.id, id),
    });

    if (!job) {
      return res.status(404).json({ error: 'Job não encontrado' });
    }

    res.json({ job });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar job');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.delete('/api/training/jobs/:id', requirePermission('training:fine_tuning_jobs:cancel'), async (req: Request, res: Response) => {
  // OWASP API3: Validação Zod obrigatória de parâmetros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID inválido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;

  try {
    const job = await db.query.fineTuningJobs.findFirst({
      where: eq(schema.fineTuningJobs.id, id),
    });

    if (!job) {
      return res.status(404).json({ error: 'Job não encontrado' });
    }

    if (job.status === 'completed' || job.status === 'cancelled') {
      return res.status(400).json({ error: 'Job já finalizado ou cancelado' });
    }

    // Cancelamento REAL no trainer (persistido em disco via flag CANCEL)
    await requestGpu({
      serviceType: GpuServiceType.TRAINING,
      endpoint: '/train/lora/cancel',
      method: 'POST',
      priority: GpuRequestPriority.LOW,
      timeout: 15000,
      body: { jobId: id },
    });

    const [updated] = await db.update(schema.fineTuningJobs)
      .set({ 
        status: 'cancelled',
        completadoEm: new Date(),
      })
      .where(eq(schema.fineTuningJobs.id, id))
      .returning();

    logger.info({ jobId: id }, 'Job de fine-tuning cancelado');
    res.json({ job: updated });
  } catch (error) {
    logger.error({ error }, 'Falha ao cancelar job');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// LoRA ADAPTER MANAGEMENT - Ativação, Consulta e Desativação
// ============================================================================

/**
 * POST /api/training/lora/activate/:jobId
 * Aprova e ativa um adapter LoRA treinado, tornando-o disponível para inferência no vLLM.
 * O adapter é copiado para /opt/alice/data/lora-adapters/trading-global/
 * e o vLLM carrega automaticamente via filesystem resolver (sem restart).
 */
app.post('/api/training/lora/activate/:jobId', requirePermission('training:fine_tuning_jobs:start'), async (req: Request, res: Response) => {
  const paramsResult = uuidParamSchema.safeParse({ id: req.params.jobId });
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'jobId inválido', details: paramsResult.error.format() });
  }

  try {
    const authContext = extractAuthContext(req);
    if (!authContext?.userId) {
      return res.status(403).json({ error: 'Usuário não identificado para aprovação' });
    }

    const result = await activateLoraAdapter(paramsResult.data.id, authContext.userId);
    logger.info({ jobId: paramsResult.data.id, approvedBy: authContext.userId }, 'Adapter LoRA ativado via endpoint');
    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error, jobId: req.params.jobId }, 'Falha ao ativar adapter LoRA');
    res.status(400).json({ error: errorMessage });
  }
});

/**
 * GET /api/training/lora/active
 * Retorna o adapter LoRA atualmente ativo, ou null se nenhum estiver ativo.
 * Usado pelo GPU Manager e integrations-service para saber qual modelo solicitar.
 */
app.get('/api/training/lora/active', requirePermission('training:fine_tuning_jobs:read'), async (_req: Request, res: Response) => {
  try {
    const querySchema = z.object({
      tenantId: z.string().uuid().optional(),
      namespaceId: z.string().uuid().optional(),
      agentId: z.string().uuid().optional(),
    });
    const parsed = querySchema.safeParse(_req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Parâmetros inválidos', details: parsed.error.format() });
    }
    const active = await getActiveAdapter(parsed.data);
    res.json({ adapter: active });
  } catch (error) {
    logger.error({ error }, 'Falha ao consultar adapter ativo');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * DELETE /api/training/lora/active
 * Desativa o adapter LoRA ativo, voltando a usar apenas o modelo base.
 */
app.delete('/api/training/lora/active', requirePermission('training:fine_tuning_jobs:start'), async (_req: Request, res: Response) => {
  try {
    const bodySchema = z.object({
      tenantId: z.string().uuid().optional(),
      namespaceId: z.string().uuid().optional(),
      agentId: z.string().uuid().optional(),
    });
    const parsed = bodySchema.safeParse(_req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Payload inválido', details: parsed.error.format() });
    }
    await deactivateLoraAdapter(parsed.data);
    res.json({ success: true, message: 'Adapter LoRA desativado. vLLM usará modelo base.' });
  } catch (error) {
    logger.error({ error }, 'Falha ao desativar adapter LoRA');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// GPU ORCHESTRATOR PROXY - Estado e retorno (Frontend usa via /api/training/*)
// ============================================================================
// Proxy para GPU Manager Service: frontend não tem acesso direto ao GPU Manager.
// Training service autentica com INTERNAL_API_SECRET e repassa requisições.
// Ref: gpu-orchestrator.ts (switchToLlmEmbeddings, getOrchestratorState)
// ============================================================================

const GPU_MANAGER_URL_ORCHESTRATOR = process.env.GPU_MANAGER_URL || 'http://alice-gpu-manager:3010';
const INTERNAL_API_SECRET_ORCHESTRATOR = process.env.INTERNAL_API_SECRET;

app.get('/api/training/gpu-orchestrator/state', requirePermission('training:fine_tuning_jobs:read'), async (_req: Request, res: Response) => {
  if (!INTERNAL_API_SECRET_ORCHESTRATOR) {
    return res.status(503).json({ error: 'Serviço indisponível', orchestratorAvailable: false });
  }
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const r = await fetch(`${GPU_MANAGER_URL_ORCHESTRATOR}/api/gpu/orchestrator/state`, {
      signal: controller.signal,
      headers: { 'X-Internal-Api-Secret': INTERNAL_API_SECRET_ORCHESTRATOR, Accept: 'application/json' },
    });
    clearTimeout(t);
    const data = (await r.json()) as Record<string, unknown>;
    res.status(r.status).json(data);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Proxy gpu-orchestrator/state falhou');
    res.status(503).json({ error: 'GPU Manager indisponível', orchestratorAvailable: false });
  }
});

app.post('/api/training/gpu-orchestrator/return', requirePermission('training:fine_tuning_jobs:start'), async (_req: Request, res: Response) => {
  if (!INTERNAL_API_SECRET_ORCHESTRATOR) {
    return res.status(503).json({ error: 'Serviço indisponível' });
  }
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const r = await fetch(`${GPU_MANAGER_URL_ORCHESTRATOR}/api/gpu/orchestrator/return`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'X-Internal-Api-Secret': INTERNAL_API_SECRET_ORCHESTRATOR, 'Content-Type': 'application/json' },
    });
    clearTimeout(t);
    const data = (await r.json()).catch(() => ({})) as Record<string, unknown>;
    res.status(r.status).json(data);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Proxy gpu-orchestrator/return falhou');
    res.status(503).json({ error: 'GPU Manager indisponível' });
  }
});

// ============================================================================
// BULK IMPORT - Importação em Lote de Dados de Treinamento
// ============================================================================

const bulkImportSchema = z.object({
  source: z.string().min(1).max(50),
  namespaceId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  domain: z.string().min(1).max(120).optional(),
  data: z.array(z.object({
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string().min(1),
    })).min(2),
    rating: z.number().min(1).max(5).optional(),
  })).min(1).max(1000),
  autoApprove: z.boolean().optional().default(false),
});

app.post('/api/training/bulk-import', requirePermission('training:training_data:create'), async (req: Request, res: Response) => {
  try {
    const authContext = extractAuthContext(req);
    
    if (!authContext || !authContext.tenantId) {
      logger.warn({ path: req.path }, 'Tentativa de bulk-import sem tenant válido');
      return res.status(403).json({ error: 'Tenant não identificado. Autenticação obrigatória.' });
    }

    const tenantId = authContext.tenantId;
    const validation = bulkImportSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Dados inválidos',
        details: validation.error.issues,
      });
    }

    const { source, namespaceId, agentId, domain, data, autoApprove } = validation.data;
    const importedIds: string[] = [];
    const duplicatesSkipped: number[] = [];

    for (let i = 0; i < data.length; i++) {
      const entry = data[i];
      
      const text = entry.messages.map(m => m.content).join(' ');
      let embedding: number[] | null = null;
      let semhash: string | null = null;

      try {
        embedding = await gpuManagerEmbeddingsBreaker.fire(text) as number[];
        semhash = computeSemHash(text);

        const existingDuplicate = await db.query.trainingData.findFirst({
          where: and(
            eq(schema.trainingData.tenantId, tenantId),
            eq(schema.trainingData.semhash, semhash)
          ),
        });

        if (existingDuplicate) {
          duplicatesSkipped.push(i);
          continue;
        }
      } catch (embError) {
        logger.warn({ error: embError, index: i }, 'Erro ao gerar embedding - continuando sem deduplicação');
      }

      const qualityScore = computeQualityScore(entry.messages);
      const scope = await resolveScope({
        tenantId,
        namespaceId: namespaceId ?? null,
        agentId: agentId ?? null,
        domain: domain ?? null,
        sourceType: 'external',
        sourceMetadata: { bulkSource: source },
        messagesText: entry.messages.map((m) => m.content).join('\n'),
      });
      if (scope.needsHumanReview) {
        trainingPipelineMetrics.scopeQuarantineTotal.inc({
          source_type: 'external',
          reason: 'low_confidence_or_missing_namespace',
        });
      }
      if (scope.suggestedNewNamespace) {
        trainingPipelineMetrics.scopeSuggestedNewNamespaceTotal.inc({
          source_type: 'external',
        });
      }
      const autoRejectedByQuality = qualityScore < TRAINING_DATA_MIN_QUALITY;
      const status = autoRejectedByQuality
        ? 'rejected'
        : (autoApprove && (entry.rating || 0) >= 4 ? 'approved' : 'pending');
      const reviewNotes = autoRejectedByQuality
        ? `Auto-rejeitado: qualidade ${qualityScore.toFixed(2)} abaixo do mínimo (${TRAINING_DATA_MIN_QUALITY}).`
        : null;

      const [inserted] = await db.insert(schema.trainingData).values({
        tenantId,
        namespaceId: scope.namespaceId,
        agentId: scope.agentId,
        source: `bulk_import:${source}`,
        sourceType: 'external',
        sourceMetadata: { bulkSource: source },
        inferredNamespaceId: scope.namespaceId,
        inferredAgentId: scope.agentId,
        inferredDomain: scope.domain,
        inferenceConfidence: scope.confidence,
        inferenceTrace: scope.trace,
        scopeResolverVersion: 'v1',
        profileVersion: 1,
        needsHumanReview: scope.needsHumanReview,
        quarantineReason: scope.needsHumanReview ? 'low_confidence_or_missing_namespace' : null,
        scopeResolvedAt: new Date(),
        quarantinedAt: scope.needsHumanReview ? new Date() : null,
        messages: entry.messages,
        rating: entry.rating,
        qualityScore,
        status,
        reviewNotes,
        semhash,
        embedding,
        isDuplicate: false,
      }).returning();

      importedIds.push(inserted.id);
    }

    logger.info({
      source,
      totalReceived: data.length,
      imported: importedIds.length,
      duplicatesSkipped: duplicatesSkipped.length,
      autoApprove,
    }, 'Bulk import concluído');

    res.status(201).json({
      success: true,
      imported: importedIds.length,
      duplicatesSkipped: duplicatesSkipped.length,
      ids: importedIds,
    });
  } catch (error) {
    logger.error({ error }, 'Falha no bulk import');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// WEBHOOK - Receber Dados de Sistemas Externos
// ============================================================================

const webhookSchema = z.object({
  event: z.enum(['training_data', 'feedback', 'document']),
  payload: z.object({
    messages: z.array(z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
      timestamp: z.string().datetime().optional(),
    })).optional(),
    rating: z.number().min(1).max(5).optional(),
    conversationId: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  timestamp: z.string().optional(),
});

// OWASP API3 - Schema para aprovação em lote
const batchApproveSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  action: z.enum(['approve', 'reject']),
  reviewNotes: z.string().max(2000).optional(),
});

// ============================================================================
// OWASP API3 - Schemas Zod para validação de query params
// Previne type coercion issues e input tampering
// ============================================================================

// Schema para query params de training data
const trainingDataQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'used']).optional(),
  namespaceId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  inferredDomain: z.string().min(1).max(120).optional(),
  needsHumanReview: z.enum(['true', 'false']).optional(),
  sourceType: trainingSourceTypeSchema.optional(),
});

// Schema para query params de jobs
const jobsQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

// Schema para query params de auto-learning status
const autoLearningStatusQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

// Schema para query params de stats
const trainingStatsQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

app.post('/api/training/webhook', async (req: Request, res: Response) => {
  const webhookSecret = req.headers['x-webhook-secret'] as string | undefined;
  const expectedSecret = process.env.TRAINING_WEBHOOK_SECRET;

  if (!expectedSecret) {
    logger.error('TRAINING_WEBHOOK_SECRET não configurado - webhook desabilitado por segurança');
    return res.status(503).json({ error: 'Webhook não configurado. Configure TRAINING_WEBHOOK_SECRET.' });
  }

  // SEGURANÇA: Usar timing-safe comparison para evitar timing attacks (OWASP)
  // crypto.timingSafeEqual() previne que atacantes descubram o secret via análise de tempo de resposta
  if (!webhookSecret) {
    logger.warn({ hasSecret: false }, 'Tentativa de webhook sem secret');
    return res.status(401).json({ error: 'Webhook secret ausente' });
  }
  
  // Converter para Buffer para timing-safe comparison
  const secretBuffer = Buffer.from(webhookSecret, 'utf-8');
  const expectedBuffer = Buffer.from(expectedSecret, 'utf-8');
  
  // Se tamanhos diferentes, ainda precisamos fazer comparação para manter tempo constante
  // Mas retornamos erro após a comparação
  const lengthsMatch = secretBuffer.length === expectedBuffer.length;
  const isValid = lengthsMatch && crypto.timingSafeEqual(
    secretBuffer,
    lengthsMatch ? expectedBuffer : Buffer.alloc(secretBuffer.length)
  );
  
  if (!isValid) {
    logger.warn({ hasSecret: true }, 'Tentativa de webhook com secret inválido');
    return res.status(401).json({ error: 'Webhook secret inválido' });
  }

  const tenantId = req.headers['x-tenant-id'] as string | undefined;
  if (!tenantId) {
    return res.status(400).json({ error: 'Header X-Tenant-ID obrigatório' });
  }

  try {
    const validation = webhookSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Payload inválido',
        details: validation.error.issues,
      });
    }

    const { event, payload } = validation.data;

    if (event === 'training_data' && payload.messages) {
      const text = payload.messages.map(m => m.content).join(' ');
      let embedding: number[] | null = null;
      const semhash = computeSemHash(text);
      const scope = await resolveScope({
        tenantId,
        namespaceId: readUuidFromUnknown(payload.metadata?.namespaceId),
        agentId: readUuidFromUnknown(payload.metadata?.agentId),
        domain: typeof payload.metadata?.domain === 'string' ? payload.metadata.domain : null,
        sourceType: 'external',
        sourceMetadata: payload.metadata as Record<string, unknown> ?? {},
        conversationId: payload.conversationId ?? null,
        messagesText: text,
      });

      try {
        embedding = await gpuManagerEmbeddingsBreaker.fire(text) as number[];
      } catch (embError) {
        logger.warn({ error: embError }, 'Erro ao gerar embedding no webhook');
      }

      const existingData = await db.query.trainingData.findMany({
        where: and(
          eq(schema.trainingData.tenantId, tenantId),
          inArray(schema.trainingData.status, ['pending', 'approved', 'used'])
        ),
      });

      let isDuplicate = false;
      let duplicateOfId: string | undefined;
      let highestSimilarity = 0;

      for (const existing of existingData) {
        if (existing.semhash === semhash) {
          isDuplicate = true;
          duplicateOfId = existing.id;
          highestSimilarity = 1.0;
          break;
        }

        if (embedding && existing.embedding) {
          const similarity = cosineSimilarity(embedding, existing.embedding);
          if (similarity > SIMILARITY_THRESHOLD && similarity > highestSimilarity) {
            isDuplicate = true;
            duplicateOfId = existing.id;
            highestSimilarity = similarity;
          }
        }
      }

      const qualityScore = computeQualityScore(payload.messages);
      if (scope.needsHumanReview) {
        trainingPipelineMetrics.scopeQuarantineTotal.inc({
          source_type: 'external',
          reason: 'low_confidence_or_missing_namespace',
        });
      }
      if (scope.suggestedNewNamespace) {
        trainingPipelineMetrics.scopeSuggestedNewNamespaceTotal.inc({
          source_type: 'external',
        });
      }
      const autoRejectedByQuality = !isDuplicate && qualityScore < TRAINING_DATA_MIN_QUALITY;
      const status = isDuplicate || autoRejectedByQuality ? 'rejected' : 'pending';
      const reviewNotes = autoRejectedByQuality
        ? `Auto-rejeitado: qualidade ${qualityScore.toFixed(2)} abaixo do mínimo (${TRAINING_DATA_MIN_QUALITY}).`
        : null;
      const [inserted] = await db.insert(schema.trainingData).values({
        tenantId,
        namespaceId: scope.namespaceId,
        agentId: scope.agentId,
        source: 'webhook',
        sourceType: 'external',
        sourceMetadata: { event },
        inferredNamespaceId: scope.namespaceId,
        inferredAgentId: scope.agentId,
        inferredDomain: scope.domain,
        inferenceConfidence: scope.confidence,
        inferenceTrace: scope.trace,
        scopeResolverVersion: 'v1',
        profileVersion: 1,
        needsHumanReview: scope.needsHumanReview,
        quarantineReason: scope.needsHumanReview ? 'low_confidence_or_missing_namespace' : null,
        scopeResolvedAt: new Date(),
        quarantinedAt: scope.needsHumanReview ? new Date() : null,
        messages: payload.messages,
        rating: payload.rating,
        qualityScore,
        status,
        reviewNotes,
        semhash,
        embedding,
        isDuplicate,
        duplicateOfId,
        similarityScore: highestSimilarity > 0 ? highestSimilarity : null,
      }).returning();

      trainingPipelineMetrics.dataCollectedTotal.labels('external', status).inc();
      trainingPipelineMetrics.qualityScore.observe(qualityScore);
      if (isDuplicate) {
        trainingPipelineMetrics.dataDuplicatesTotal.labels('external').inc();
        trainingPipelineMetrics.dataRejectedTotal.labels('duplicate', 'external').inc();
      }
      if (autoRejectedByQuality) {
        trainingPipelineMetrics.dataRejectedTotal.labels('quality', 'external').inc();
      }

      logger.info({ id: inserted.id, event }, 'Dados recebidos via webhook');
      res.status(201).json({ success: true, id: inserted.id });
    } else if (event === 'feedback' && payload.conversationId) {
      await db.update(schema.trainingData)
        .set({ rating: payload.rating })
        .where(eq(schema.trainingData.conversationId, payload.conversationId));

      logger.info({ conversationId: payload.conversationId, rating: payload.rating }, 'Feedback atualizado via webhook');
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Evento não suportado ou payload incompleto' });
    }
  } catch (error) {
    logger.error({ error }, 'Falha ao processar webhook');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// APROVAÇÃO EM LOTE
// ============================================================================

app.post('/api/training/data/approve-batch', requirePermission('training:training_data:update'), async (req: Request, res: Response) => {
  // OWASP API3 - Validação Zod obrigatória
  const parseResult = batchApproveSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Input inválido' });
  }
  const { ids, action, reviewNotes } = parseResult.data;
  const authContext = extractAuthContext(req);
  const reviewedBy = authContext?.userId ?? undefined;

  try {
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    let updatedCount = 0;
    let skippedByQuarantine = 0;
    let skippedByMissingNamespace = 0;

    for (const id of ids) {
      const current = await db.query.trainingData.findFirst({
        where: eq(schema.trainingData.id, id),
        columns: { needsHumanReview: true, namespaceId: true },
      });

      if (newStatus === 'approved' && current?.needsHumanReview) {
        skippedByQuarantine += 1;
        continue;
      }
      if (newStatus === 'approved' && !current?.namespaceId) {
        skippedByMissingNamespace += 1;
        continue;
      }

      const [updated] = await db.update(schema.trainingData)
        .set({ 
          status: newStatus,
          processadoEm: new Date(),
          reviewedBy,
          reviewedAt: new Date(),
          reviewNotes: reviewNotes ?? null,
          needsHumanReview: false,
          quarantineReason: null,
          quarantinedAt: null,
        })
        .where(eq(schema.trainingData.id, id))
        .returning();

      if (updated) updatedCount++;
    }

    if (updatedCount > 0) {
      trainingPipelineMetrics.reviewTotal.labels(newStatus).inc(updatedCount);
    }

    logger.info(
      { action, count: updatedCount, skippedByQuarantine, skippedByMissingNamespace },
      'Aprovação em lote concluída'
    );
    res.json({ success: true, updated: updatedCount, skippedByQuarantine, skippedByMissingNamespace });
  } catch (error) {
    logger.error({ error }, 'Falha na aprovação em lote');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// AUTO-LEARNING STATUS
// ============================================================================

app.get('/api/training/auto-learning/status', requirePermission('training:training_data:read'), async (req: Request, res: Response) => {
  // OWASP API3: Validação de query params
  const queryResult = autoLearningStatusQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }
  const { tenantId } = queryResult.data;

  try {
    const modelVersions = await db.query.modelVersions.findMany({
      where: tenantId ? eq(schema.modelVersions.tenantId, tenantId) : undefined,
      orderBy: [desc(schema.modelVersions.version)],
      limit: 10,
    });

    const activeVersion = modelVersions.find((v: typeof schema.modelVersions.$inferSelect) => v.isActive);

    const schedules = await db.query.autoLearningSchedule.findMany({
      where: tenantId ? eq(schema.autoLearningSchedule.tenantId, tenantId) : undefined,
      orderBy: [desc(schema.autoLearningSchedule.scheduledFor)],
      limit: 5,
    });

    const pendingDataConditions = [
      eq(schema.trainingData.status, 'approved'),
      isNull(schema.trainingData.usedInJobId),
    ];
    if (tenantId) pendingDataConditions.push(eq(schema.trainingData.tenantId, tenantId));
    
    const pendingData = await db.select({ count: sql<number>`count(*)` })
      .from(schema.trainingData)
      .where(and(...pendingDataConditions));

    const pendingImagesConditions = [
      eq(schema.generatedImages.approvedForTraining, true),
      eq(schema.generatedImages.usedInFineTuning, false),
    ];
    if (tenantId) pendingImagesConditions.push(eq(schema.generatedImages.tenantId, tenantId));
    
    const pendingImages = await db.select({ count: sql<number>`count(*)` })
      .from(schema.generatedImages)
      .where(and(...pendingImagesConditions));

    res.json({
      activeModel: {
        version: activeVersion?.version || 0,
        name: activeVersion?.name || 'baseline',
        improvementPercent: activeVersion?.improvementPercent || 0,
        trainingDataUsed: activeVersion?.trainingDataCount || 0,
        imagesUsed: activeVersion?.imageDataCount || 0,
      },
      pendingData: {
        trainingEntries: pendingData[0]?.count || 0,
        images: pendingImages[0]?.count || 0,
      },
      recentVersions: modelVersions.slice(0, 5).map((v: typeof schema.modelVersions.$inferSelect) => ({
        version: v.version,
        status: v.status,
        createdAt: v.criadoEm,
      })),
      upcomingSchedules: schedules.map((s: typeof schema.autoLearningSchedule.$inferSelect) => ({
        id: s.id,
        type: s.scheduleType,
        scheduledFor: s.scheduledFor,
        status: s.status,
      })),
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter status do auto-learning');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/training/stats', requirePermission('training:training_data:read'), async (req: Request, res: Response) => {
  // OWASP API3: Validação de query params
  const queryResult = trainingStatsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos', details: queryResult.error.format() });
  }
  const { tenantId } = queryResult.data;

  try {
    const pendingConditions = [eq(schema.trainingData.status, 'pending')];
    if (tenantId) pendingConditions.push(eq(schema.trainingData.tenantId, tenantId));
    
    const pendingCount = await db.select({ count: sql<number>`count(*)` })
      .from(schema.trainingData)
      .where(and(...pendingConditions));

    const approvedConditions = [eq(schema.trainingData.status, 'approved')];
    if (tenantId) approvedConditions.push(eq(schema.trainingData.tenantId, tenantId));
    
    const approvedCount = await db.select({ count: sql<number>`count(*)` })
      .from(schema.trainingData)
      .where(and(...approvedConditions));

    const duplicateConditions = [eq(schema.trainingData.isDuplicate, true)];
    if (tenantId) duplicateConditions.push(eq(schema.trainingData.tenantId, tenantId));
    
    const duplicatesCount = await db.select({ count: sql<number>`count(*)` })
      .from(schema.trainingData)
      .where(and(...duplicateConditions));

    const jobConditions = [eq(schema.fineTuningJobs.status, 'completed')];
    if (tenantId) jobConditions.push(eq(schema.fineTuningJobs.tenantId, tenantId));
    
    const completedJobs = await db.select({ count: sql<number>`count(*)` })
      .from(schema.fineTuningJobs)
      .where(and(...jobConditions));

    res.json({
      trainingData: {
        pending: pendingCount[0]?.count || 0,
        approved: approvedCount[0]?.count || 0,
        duplicatesFiltered: duplicatesCount[0]?.count || 0,
      },
      jobs: {
        completed: completedJobs[0]?.count || 0,
      },
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter estatísticas');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// Gate 2 (15/01/2026): Training Schedule + On-Demand
// Endpoints enterprise para configurar e executar treinamentos
// ============================================================================

// Schema para configuração de schedule
const scheduleConfigSchema = z.object({
  tenantId: z.string().uuid(),
  scheduleType: z.enum(['incremental_fine_tuning', 'complete_fine_tuning']),
  enabled: z.boolean().default(true),
  cronPattern: z.string().optional(), // Ex: '0 3 * * 0' para domingo às 3h
  minDataRequired: z.number().int().min(10).default(50),
});

// Schema para iniciar treinamento on-demand
const startTrainingSchema = z.object({
  tenantId: z.string().uuid(),
  trainingType: z.enum(['incremental', 'full']).default('incremental'),
  includeImages: z.boolean().default(false),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  description: z.string().max(500).optional(),
  /** Escopo namespace: treino on-demand por namespace (LoRA por namespace). */
  namespaceId: z.string().uuid().optional(),
});

// Schema para cancelar treinamento
const cancelTrainingSchema = z.object({
  trainingRunId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

/**
 * POST /api/training/schedule/configure
 * Configura o agendamento automático de treinamento
 */
app.post('/api/training/schedule/configure', requirePermission('training:training_data:manage'), async (req: Request, res: Response) => {
  const parseResult = scheduleConfigSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Input inválido', details: parseResult.error.format() });
  }
  
  const { tenantId, scheduleType, enabled, cronPattern, minDataRequired } = parseResult.data;
  
  try {
    // Verificar se já existe configuração
    const existing = await db.query.autoLearningSchedule.findFirst({
      where: and(
        eq(schema.autoLearningSchedule.tenantId, tenantId),
        eq(schema.autoLearningSchedule.scheduleType, scheduleType),
        eq(schema.autoLearningSchedule.status, 'scheduled')
      ),
    });

    if (existing && !enabled) {
      // Desabilitar schedule existente (usar 'skipped' pois 'cancelled' não existe no enum)
      await db.update(schema.autoLearningSchedule)
        .set({ status: 'skipped' })
        .where(eq(schema.autoLearningSchedule.id, existing.id));
      
      logger.info({ tenantId, scheduleType }, 'Schedule de treinamento desabilitado');
      return res.json({ success: true, action: 'disabled', scheduleId: existing.id });
    }

    if (enabled) {
      // FIX: Preparar metadata com configurações customizadas (persistir minDataRequired)
      const scheduleMetadata = {
        minDataRequired,
        cronPattern: cronPattern || null,
        configuredAt: new Date().toISOString(),
      };
      
      // FIX Bug 2: Se já existe um schedule ativo, atualizar ao invés de criar duplicado
      if (existing) {
        // Atualizar schedule existente com nova data e metadata
        const scheduledFor = calculateNextScheduleDate(scheduleType, cronPattern);
        
        await db.update(schema.autoLearningSchedule)
          .set({ 
            scheduledFor, 
            status: 'scheduled',
            metadata: scheduleMetadata, // FIX: Persistir minDataRequired
          })
          .where(eq(schema.autoLearningSchedule.id, existing.id));
        
        logger.info({ 
          tenantId, 
          scheduleType, 
          scheduledFor,
          scheduleId: existing.id,
          minDataRequired,
        }, 'Schedule de treinamento atualizado');
        
        return res.json({ 
          success: true, 
          action: 'updated', 
          scheduleId: existing.id,
          scheduledFor,
          minDataRequired,
        });
      }
      
      // Criar novo schedule (não existe nenhum ativo)
      const scheduledFor = calculateNextScheduleDate(scheduleType, cronPattern);
      
      const [newSchedule] = await db.insert(schema.autoLearningSchedule).values({
        tenantId,
        scheduleType,
        status: 'scheduled',
        scheduledFor,
        metadata: scheduleMetadata, // FIX: Persistir minDataRequired
      }).returning();
      
      logger.info({ 
        tenantId, 
        scheduleType, 
        scheduledFor,
        scheduleId: newSchedule.id,
        minDataRequired,
      }, 'Schedule de treinamento configurado');
      
      return res.json({ 
        success: true, 
        action: 'scheduled', 
        scheduleId: newSchedule.id,
        scheduledFor,
        minDataRequired,
      });
    }

    res.json({ success: true, action: 'no_change' });
  } catch (error) {
    logger.error({ error }, 'Falha ao configurar schedule de treinamento');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * POST /api/training/run/start
 * Inicia treinamento on-demand
 */
app.post('/api/training/run/start', requirePermission('training:training_data:manage'), async (req: Request, res: Response) => {
  const parseResult = startTrainingSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Input inválido', details: parseResult.error.format() });
  }
  
  const { tenantId, trainingType, includeImages, priority: _priority, description, namespaceId } = parseResult.data;

  try {
    // Verificar se já existe treinamento em andamento (status 'training' ou 'preparing')
    // FIX Bug 1: Incluir 'preparing' na verificação (fase de preparação de dados)
    const runningJobs = await db.query.fineTuningJobs.findMany({
      where: and(
        eq(schema.fineTuningJobs.tenantId, tenantId),
        or(
          eq(schema.fineTuningJobs.status, 'training'),
          eq(schema.fineTuningJobs.status, 'preparing')
        )
      ),
    });

    if (runningJobs.length > 0) {
      return res.status(409).json({
        error: 'Já existe treinamento em andamento',
        runningJobId: runningJobs[0].id,
      });
    }

    // Avaliar qualidade dos dados antes de iniciar (com escopo namespace quando informado).
    const scheduleType = trainingType === 'full' ? 'complete_fine_tuning' : 'incremental_fine_tuning';
    const evaluation = await evaluateDataQuality(
      scheduleType,
      tenantId,
      undefined,
      namespaceId,
      false
    );

    if (!evaluation.isReady) {
      return res.status(400).json({
        error: 'Dados insuficientes ou qualidade baixa',
        evaluation,
        recommendation: evaluation.recommendation,
        reason: evaluation.reason,
      });
    }

    // Criar job de fine-tuning on-demand
    // Usando campos existentes no schema: name, baseModel, trainingDataCount
    const [job] = await db.insert(schema.fineTuningJobs).values({
      tenantId,
      name: description || `Treinamento ${trainingType} on-demand`,
      baseModel: GPU_MANAGER_CONFIG.models.llm,
      status: 'pending',
      trainingDataCount: evaluation.dataCount,
    }).returning();

    // Iniciar Progressive LoRA (cria lora_jobs source=scheduled_run; execução em background)
    const loraResult = await startProgressiveLoRA(tenantId, {
      includeImages,
      namespaceId,
    });

    // Atualizar job com status training
    await db.update(schema.fineTuningJobs)
      .set({
        status: 'training',
        iniciadoEm: new Date(),
      })
      .where(eq(schema.fineTuningJobs.id, job.id));

    // Executar treino LoRA em background (processLoraJob); ao terminar, sincronizar fine_tuning_jobs
    const fineTuningJobId = job.id;
    const loraJobId = loraResult.loraJobId;
    const { processLoraJob } = await import('./lora-job-manager.js');
    processLoraJob(loraJobId)
      .then(async () => {
        await db.update(schema.fineTuningJobs)
          .set({ status: 'completed', completadoEm: new Date() })
          .where(eq(schema.fineTuningJobs.id, fineTuningJobId));
        logger.info({ fineTuningJobId, loraJobId }, 'Treinamento on-demand concluído; fine_tuning_jobs atualizado');
      })
      .catch(async (err) => {
        logger.error({ err, loraJobId }, 'Falha ao executar job LoRA on-demand');
        await db.update(schema.fineTuningJobs)
          .set({
            status: 'failed',
            completadoEm: new Date(),
            errorMessage: err instanceof Error ? err.message : 'processLoraJob falhou',
          })
          .where(eq(schema.fineTuningJobs.id, fineTuningJobId));
      });

    logger.info({
      jobId: job.id,
      loraJobId: loraResult.loraJobId,
      tenantId,
      trainingType,
      dataCount: evaluation.dataCount,
      imageCount: evaluation.imageCount,
    }, 'Treinamento on-demand iniciado');

    res.status(201).json({
      success: true,
      jobId: job.id,
      loraJobId: loraResult.loraJobId,
      modelVersionId: loraResult.modelVersionId,
      version: loraResult.version,
      trainingDataUsed: loraResult.trainingDataUsed,
      imagesUsed: loraResult.imagesUsed,
      status: 'running',
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao iniciar treinamento on-demand');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * GET /api/training/run/status
 * Obtém status atual do treinamento
 */
app.get('/api/training/run/status', requirePermission('training:training_data:read'), async (req: Request, res: Response) => {
  const queryResult = z.object({ tenantId: z.string().uuid().optional() }).safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }
  const { tenantId } = queryResult.data;

  try {
    // Buscar jobs com status 'training' ou 'preparing' (em execução)
    // FIX Bug 1: Incluir 'preparing' na verificação (fase de preparação de dados)
    const conditions = [
      or(
        eq(schema.fineTuningJobs.status, 'training'),
        eq(schema.fineTuningJobs.status, 'preparing')
      )
    ];
    if (tenantId) conditions.push(eq(schema.fineTuningJobs.tenantId, tenantId));

    const runningJobs = await db.query.fineTuningJobs.findMany({
      where: and(...conditions),
      orderBy: [desc(schema.fineTuningJobs.iniciadoEm)],
      limit: 5,
    });

    if (runningJobs.length === 0) {
      return res.json({
        hasRunningTraining: false,
        status: 'idle',
        message: 'Nenhum treinamento em andamento',
      });
    }

    const currentJob = runningJobs[0];
    const elapsedMs = currentJob.iniciadoEm ? Date.now() - new Date(currentJob.iniciadoEm).getTime() : 0;

    // Usar campos existentes no schema: name, trainingDataCount, progress
    res.json({
      hasRunningTraining: true,
      status: 'training',
      currentJob: {
        id: currentJob.id,
        name: currentJob.name,
        baseModel: currentJob.baseModel,
        trainingDataCount: currentJob.trainingDataCount,
        progress: currentJob.progress || 0,
        elapsedSeconds: Math.round(elapsedMs / 1000),
        startedAt: currentJob.iniciadoEm,
      },
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter status do treinamento');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * GET /api/training/run/history
 * Obtém histórico de treinamentos
 */
app.get('/api/training/run/history', requirePermission('training:training_data:read'), async (req: Request, res: Response) => {
  const queryResult = z.object({ 
    tenantId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }).safeParse(req.query);
  
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }
  const { tenantId, limit } = queryResult.data;

  try {
    const conditions = [];
    if (tenantId) conditions.push(eq(schema.fineTuningJobs.tenantId, tenantId));

    const jobs = await db.query.fineTuningJobs.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [desc(schema.fineTuningJobs.criadoEm)],
      limit,
    });

    const history = jobs.map((job: typeof schema.fineTuningJobs.$inferSelect) => ({
      id: job.id,
      jobType: job.name, // name contém tipo do job (qlora_incremental, etc)
      status: job.status,
      totalRecords: job.trainingDataCount,
      processedRecords: job.progress ? Math.round((job.progress / 100) * (job.trainingDataCount ?? 0)) : 0,
      description: job.name,
      startedAt: job.iniciadoEm,
      completedAt: job.completadoEm,
      durationSeconds: job.iniciadoEm && job.completadoEm 
        ? Math.round((new Date(job.completadoEm).getTime() - new Date(job.iniciadoEm).getTime()) / 1000)
        : null,
      errorMessage: job.errorMessage,
    }));

    res.json({
      total: history.length,
      history,
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter histórico de treinamentos');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * DELETE /api/training/run/cancel
 * Cancela treinamento em andamento
 */
app.delete('/api/training/run/cancel', requirePermission('training:training_data:manage'), async (req: Request, res: Response) => {
  const parseResult = cancelTrainingSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Input inválido', details: parseResult.error.format() });
  }
  
  const { trainingRunId, reason } = parseResult.data;

  try {
    const job = await db.query.fineTuningJobs.findFirst({
      where: eq(schema.fineTuningJobs.id, trainingRunId),
    });

    if (!job) {
      return res.status(404).json({ error: 'Treinamento não encontrado' });
    }

    if (job.status !== 'training' && job.status !== 'pending' && job.status !== 'preparing') {
      return res.status(400).json({ 
        error: 'Treinamento não pode ser cancelado',
        currentStatus: job.status,
      });
    }

    await db.update(schema.fineTuningJobs)
      .set({
        status: 'cancelled',
        completadoEm: new Date(),
        errorMessage: reason || 'Cancelado pelo usuário',
      })
      .where(eq(schema.fineTuningJobs.id, trainingRunId));

    logger.info({ trainingRunId, reason }, 'Treinamento cancelado');

    res.json({
      success: true,
      trainingRunId,
      previousStatus: job.status,
      newStatus: 'cancelled',
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao cancelar treinamento');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Funções auxiliares para schedule

/**
 * Calcula a próxima data de execução baseado no cron pattern ou intervalo padrão.
 * 
 * Suporta padrões cron básicos:
 * - '0 3 * * 0' → Domingo às 3:00 AM
 * - '0 1 1,15 * *' → Dias 1 e 15 de cada mês às 1:00 AM
 * 
 * FIX Bug 3: Agora honra o cronPattern passado pelo usuário
 */
function calculateNextScheduleDate(scheduleType: string, cronPattern?: string): Date {
  const config = scheduleType === 'incremental_fine_tuning'
    ? SCHEDULE_CONFIG.incrementalFineTuning
    : SCHEDULE_CONFIG.completeFineTuning;
  
  // Se não tiver cron pattern customizado, usar intervalo padrão
  if (!cronPattern) {
    return new Date(Date.now() + config.intervalMs);
  }
  
  // Parse básico do cron pattern: 'minuto hora diaDoMes mes diaDaSemana'
  // Exemplo: '0 3 * * 0' = minuto 0, hora 3, qualquer dia do mês, qualquer mês, domingo
  const parts = cronPattern.trim().split(/\s+/);
  if (parts.length !== 5) {
    logger.warn({ cronPattern }, 'Cron pattern inválido, usando intervalo padrão');
    return new Date(Date.now() + config.intervalMs);
  }
  
  const [minute, hour, dayOfMonth, _month, dayOfWeek] = parts;
  const now = new Date();
  const next = new Date(now);
  
  // Configurar hora e minuto
  const targetHour = hour === '*' ? now.getHours() : parseInt(hour, 10);
  const targetMinute = minute === '*' ? 0 : parseInt(minute, 10);
  
  next.setHours(targetHour, targetMinute, 0, 0);
  
  // Se for dia da semana específico (ex: '0' = domingo)
  if (dayOfWeek !== '*') {
    const targetDay = parseInt(dayOfWeek, 10); // 0 = domingo, 6 = sábado
    let daysUntil = targetDay - now.getDay();
    
    // Se o dia já passou esta semana, ir para próxima semana
    if (daysUntil < 0 || (daysUntil === 0 && now >= next)) {
      daysUntil += 7;
    }
    
    next.setDate(now.getDate() + daysUntil);
  }
  // Se for dia do mês específico (ex: '1,15' = dias 1 e 15)
  else if (dayOfMonth !== '*') {
    const days = dayOfMonth.split(',').map(d => parseInt(d.trim(), 10)).sort((a, b) => a - b);
    const currentDay = now.getDate();
    
    // Encontrar próximo dia válido
    let targetDayOfMonth = days.find(d => d > currentDay || (d === currentDay && now < next));
    
    if (targetDayOfMonth === undefined) {
      // Nenhum dia disponível este mês, ir para próximo mês
      targetDayOfMonth = days[0];
      // FIX Bug 2: Definir dia como 1 ANTES de incrementar mês para evitar overflow
      // Exemplo: 31/Jan + 1 mês = 3/Mar se não fizermos isso (Fev não tem 31 dias)
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
    }
    
    // FIX Bug 3 (11/01/2026): Verificar se o dia existe no mês alvo
    // Exemplo: Cron '0 1 31 * *' após Janeiro → Fevereiro não tem dia 31
    // JavaScript Date overflow: setDate(31) em Fevereiro → 3 de Março (ERRADO)
    // Solução: Avançar meses até encontrar um que tenha o dia desejado
    const getDaysInMonth = (date: Date): number => {
      // Criar data no primeiro dia do próximo mês e subtrair 1 dia
      return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    };
    
    // Avançar meses se o dia não existir no mês atual (máximo 12 iterações para segurança)
    for (let i = 0; i < 12; i++) {
      const daysInMonth = getDaysInMonth(next);
      if (targetDayOfMonth <= daysInMonth) {
        break; // Mês atual tem o dia desejado
      }
      // Mês não tem o dia (ex: Fevereiro não tem 31), ir para próximo mês
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
    }
    
    next.setDate(targetDayOfMonth);
  }
  // Se já passou o horário de hoje, ir para amanhã
  else if (now >= next) {
    next.setDate(next.getDate() + 1);
  }
  
  logger.debug({ cronPattern, nextSchedule: next.toISOString() }, 'Próximo schedule calculado');
  return next;
}

function _estimateRemainingTime(job: typeof schema.fineTuningJobs.$inferSelect): number | null {
  if (!job.iniciadoEm || !job.trainingDataCount || !job.progress) return null;
  
  const elapsedMs = Date.now() - new Date(job.iniciadoEm).getTime();
  const progress = job.progress / 100; // progress é 0-100
  
  if (progress <= 0) return null;
  
  const estimatedTotalMs = elapsedMs / progress;
  const remainingMs = estimatedTotalMs - elapsedMs;
  
  return Math.round(Math.max(0, remainingMs) / 1000);
}

// Importar funções do auto-learning scheduler
import { 
  SCHEDULE_CONFIG, 
  evaluateDataQuality, 
  startProgressiveLoRA,
  processScheduledJobs,
  initAutoLearningScheduler,
} from './auto-learning-scheduler.js';

// ============================================================================
// MIDDLEWARE: Not Found + Error Handler (Express.js 2025)
// ============================================================================

// Not Found handler (antes do error handler)
app.use(createNotFoundHandler({ serviceName: 'training-service' }));

// Error handler global (OWASP 2023 + Express.js 2025)
app.use(createErrorHandler({ 
  serviceName: 'training-service', 
  logger,
  includeStackInDev: true,
}));

// CORREÇÃO 31/12/2025: Usar connectWithRetry para garantir PostgreSQL + pgvector prontos
// Previne crash loop quando PostgreSQL ainda está inicializando
import { connectWithRetry } from '@alice/database';

// SSOT validation (Plano 11/02/2026): TEXT_EMBEDDING_DIM (embeddings-gpu) = EMBEDDING_DIMENSIONS.TEXT
const GPU_MANAGER_URL = process.env.GPU_MANAGER_URL || 'http://alice-gpu-manager:3010';
const INTERNAL_API_SECRET_FOR_VALIDATION = process.env.INTERNAL_API_SECRET;

async function validateEmbeddingDimensionsSSOT(): Promise<void> {
  if (!INTERNAL_API_SECRET_FOR_VALIDATION) return;
  const maxAttempts = 3;
  const delayMs = 2000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${GPU_MANAGER_URL}/api/gpu/embeddings/health`, {
        signal: controller.signal,
        headers: { 'X-Internal-Api-Secret': INTERNAL_API_SECRET_FOR_VALIDATION, Accept: 'application/json' },
      });
      clearTimeout(t);
      if (!res.ok) {
        if (attempt < maxAttempts) {
          logger.warn({ attempt, status: res.status }, 'Embeddings health unreachable - retrying');
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        logger.warn({ status: res.status }, 'Embeddings health unreachable após retries - continuando (readiness falhará)');
        return;
      }
      const data = (await res.json()) as { text_dimensions?: number };
      const dim = data.text_dimensions;
      if (typeof dim !== 'number') {
        logger.warn({ data }, 'Embeddings health não retornou text_dimensions');
        return;
      }
      if (dim !== EMBEDDING_DIMENSIONS.TEXT) {
        logger.error(
          { text_dimensions: dim, expected: EMBEDDING_DIMENSIONS.TEXT },
          'SSOT INCONSISTENTE: embeddings-gpu retorna dimensão diferente de @alice/database. Verifique configuração.'
        );
        process.exit(1);
      }
      logger.info({ text_dimensions: dim }, 'SSOT validado: embeddings-gpu = EMBEDDING_DIMENSIONS.TEXT');
      return;
    } catch (err) {
      if (attempt < maxAttempts) {
        logger.warn({ attempt, err: err instanceof Error ? err.message : String(err) }, 'Embeddings health unreachable - retrying');
        await new Promise((r) => setTimeout(r, delayMs));
      } else {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Embeddings health unreachable após retries - continuando');
      }
    }
  }
}

let server: ReturnType<typeof app.listen>;
let autoLearningLoopActive = false;

(async () => {
  try {
    // Conectar ao PostgreSQL com retry logic ANTES de iniciar servidor HTTP
    // Training-service usa pgvector para colunas vetoriais (documentos/metadata)
    await connectWithRetry({
      maxRetries: 15,
      initialDelayMs: 2000,
      checkPgvector: true, // Verificar extensão pgvector (obrigatório para embeddings)
    });

    // Inicializar auto-learning scheduler com instância do banco (Regra 6: sem db undefined)
    // CORREÇÃO 11/02/2026: initAutoLearningScheduler NUNCA era chamada, causando
    // db=undefined → TypeError a cada 60s no processScheduledJobs → alerta Grafana
    initAutoLearningScheduler(getDatabase());

    // SSOT validation (Plano 11/02/2026): embeddings-gpu text_dimensions = EMBEDDING_DIMENSIONS.TEXT
    await validateEmbeddingDimensionsSSOT();

    // WS4: Redis cache + session-auth cache (evita queries repetitivas em PostgreSQL)
    // - Em produção: Redis é obrigatório (fail-fast dentro de initializeSessionAuthCache)
    // - Em dev/test: cache fica desabilitado (sem in-memory)
    await initializeRedisCache();
    await initializeSessionAuthCache();
    logger.info('Auth cache (session-auth) inicializado');
    tradingWorkerStoppers.push(createTradingWorker(
      tradingQueueNames.universe,
      tradingUniverseEnqueueSchema,
      async (payload) => {
        const result = await runUniverseScanWorker(payload);
        tradingV2Metrics.candidateCount.inc({ side: result.side, marketType: payload.marketType });
      },
      tradingV2Metrics.universeScanSeconds,
    ));
    tradingWorkerStoppers.push(createTradingWorker(
      tradingQueueNames.backtest,
      tradingBacktestEnqueueSchema,
      async (payload) => {
        const result = await runBacktestWorker(payload);
        tradingV2Metrics.backtestDsr.set({ marketType: payload.marketType, strategyKey: payload.strategyKey }, result.dsr);
        tradingV2Metrics.backtestPbo.set({ marketType: payload.marketType, strategyKey: payload.strategyKey }, result.pbo);
      },
      tradingV2Metrics.backtestSeconds,
    ));
    tradingWorkerStoppers.push(createTradingWorker(
      tradingQueueNames.calibration,
      tradingCalibrationEnqueueSchema,
      async (payload) => {
        await runCalibrationWorker(payload);
      },
      tradingV2Metrics.calibrationSeconds,
    ));
    tradingWorkerStoppers.push(createTradingWorker(
      tradingQueueNames.rebalance,
      tradingRebalanceEnqueueSchema,
      async (payload) => {
        await runPortfolioRebalanceWorker(payload);
      },
      tradingV2Metrics.rebalanceSeconds,
    ));
    tradingWorkerStoppers.push(createTradingWorker(
      tradingQueueNames.modelRisk,
      tradingModelRiskEnqueueSchema,
      async (payload) => {
        await runModelRiskWorker(payload);
        tradingV2Metrics.modelRiskEventsTotal.inc();
      },
      tradingV2Metrics.modelRiskSeconds,
    ));
    
    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info({ 
        port: PORT, 
        embeddingsConfigured: true, // Embeddings via GPU Manager Service (Gate 2)
        fineTuningConfigured: true, // Fine-tuning LoRA via gpu-trainer (prioridade baixa)
        circuitBreaker: 'enabled',
      }, 'Training service iniciado com Circuit Breaker');

      startTrainingMetricsScheduler();
      logger.info({ intervalMs: TRAINING_METRICS_INTERVAL_MS }, 'Scheduler de métricas de training iniciado');

      autoLearningLoopActive = true;
      void (async () => {
        while (autoLearningLoopActive) {
          try {
            await processScheduledJobs();
            trainingPipelineMetrics.schedulerRunsTotal.labels('success').inc();
          } catch (error: unknown) {
            trainingPipelineMetrics.schedulerRunsTotal.labels('error').inc();
            const errObj = error instanceof Error ? error : new Error(String(error));
            logger.warn({ err: errObj }, 'Falha ao processar jobs agendados de auto-learning');
          }
          await sleep(TRAINING_SCHEDULER_POLL_MS);
        }
      })();
      logger.info({ intervalMs: TRAINING_SCHEDULER_POLL_MS }, 'Scheduler de auto-learning iniciado');

      // Retomar jobs pendentes após restart (Regra 6: sem dependência de state em memória)
      resumePendingFineTuningJobs().catch((error: unknown) => {
        const errObj = error instanceof Error ? error : new Error(String(error));
        logger.error({ err: errObj }, 'Falha ao retomar jobs de fine-tuning pendentes');
      });
      resumePendingLoraJobs().catch((error: unknown) => {
        const errObj = error instanceof Error ? error : new Error(String(error));
        logger.error({ err: errObj }, 'Falha ao retomar jobs de trading LoRA pendentes');
      });

      // Tick periódico: garante execução de jobs criados por scheduler/rotas mesmo após long uptimes
      setInterval(() => {
        resumePendingFineTuningJobs().catch(() => {});
        resumePendingLoraJobs().catch(() => {});
      }, 30000);
    });

    // SEGURANÇA: Timeouts para prevenir conexões pendentes (Node.js 20 LTS Best Practices)
    server.timeout = 30000; // 30s timeout para requisições
    server.keepAliveTimeout = 65000; // 65s (maior que ALB timeout padrão de 60s)
    server.headersTimeout = 66000; // Ligeiramente maior que keepAliveTimeout
    
    // ============================================================================
    // GRACEFUL SHUTDOWN (Enterprise-Grade - Regra 16 CLAUDE.md)
    // CORREÇÃO 31/12/2025: Callbacks movidos para dentro do IIFE para garantir
    // que 'server' está definido antes de registrar o callback
    // ShutdownManager centralizado elimina duplicação de listeners (Regra 6)
    // Ordem: HTTP server → Database pool
    // ============================================================================

    registerShutdownCallback(
      'training-http-server',
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
      'training-redis-cache',
      async () => {
        logger.info('Encerrando cliente Redis cache...');
        await closeRedisCacheClient();
        logger.info('Cliente Redis cache encerrado com sucesso');
      },
      { priority: ShutdownPriority.CACHE }
    );

    registerShutdownCallback(
      'training-metrics-scheduler',
      async () => {
        if (trainingMetricsInterval) {
          clearInterval(trainingMetricsInterval);
          trainingMetricsInterval = null;
        }
      },
      { priority: ShutdownPriority.BACKGROUND_JOBS }
    );

    registerShutdownCallback(
      'training-trading-v2-workers',
      async () => {
        await Promise.all(tradingWorkerStoppers.map((stop) => stop()));
      },
      { priority: ShutdownPriority.BACKGROUND_JOBS }
    );

    registerShutdownCallback(
      'training-auto-learning-scheduler',
      async () => {
        autoLearningLoopActive = false;
      },
      { priority: ShutdownPriority.BACKGROUND_JOBS }
    );

    registerShutdownCallback(
      'training-database-pool',
      async () => {
        logger.info('Encerrando pool de conexões database...');
        await closeDatabasePool();
        logger.info('Pool de conexões encerrado com sucesso');
      },
      { priority: ShutdownPriority.DATABASE }
    );
    
  } catch (error) {
    logger.fatal({ error: error instanceof Error ? error.message : String(error) }, 
      '❌ FATAL: Falha ao conectar ao PostgreSQL - training-service não pode iniciar');
    process.exit(1);
  }
})();
