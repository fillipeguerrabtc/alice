/**
 * Training Service - Alice Enterprise Platform
 * 
 * ServiÃ§o de treinamento e fine-tuning com deduplicaÃ§Ã£o semÃ¢ntica (SemHash).
 * Implementa Circuit Breaker pattern (Regra 16 - Best Practices 2025).
 * 
 * Gate 2 (15/01/2026):
 * - Embeddings de texto: Qwen3-Embedding-0.6B INT8 (1024 dim, GPU Manager Service â†’ Qdrant)
 * - Fine-tuning (QLoRA): MESMO modelo base do LLM (texto) via gpu-trainer (sob demanda)
 * - Schedule semanal configurÃ¡vel (domingo 3:00 AM default)
 * - Treinamento on-demand via dashboard admin
 * - Zero latÃªncia de troca (serviÃ§os GPU sempre ativos)
 * 
 * Autor: Fillipe Guerra
 * Data: 15 de Janeiro de 2026
 * DocumentaÃ§Ã£o em PT-BR (Regra 10 CLAUDE.md)
 */

import express from 'express';
import type { Request } from 'express';
import cors from 'cors';
import compression from 'compression';
import crypto from 'crypto';
import { createLogger } from '@alice/logger';
import { getDatabase, getPool, schema, closeDatabasePool, isPoolHealthy, createDrizzleFeatureFlagStorage, validateEmbeddingDimension, EMBEDDING_DIMENSIONS, withTenantContext } from '@alice/database';
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
  extractAuthContext,
  validateNamespaceTenantConsistency,
  validateTenantConsistency,
  setPermissionResolver,
  // Auth hÃ­brida (WS4): SessÃ£o (cookie) + Bearer JWT (OIDC) com validaÃ§Ã£o local via JWKS
  createSessionAuthMiddleware,
  initializeRedisCache,
  initializeSessionAuthCache,
  closeRedisCacheClient,
  getRedisClient,
  requestGpu,
  GpuServiceType,
  GpuRequestPriority,
  callGatewayComplete,
  isGatewayConfigured,
  TRADING_LLM_SIGNAL_JSON_SCHEMA,
  TRADING_LLM_SIGNAL_PARTIAL_SCHEMA,
  GPU_MANAGER_CONFIG,
  RedisStreamQueue,
  TRADING_STREAMS,
  buildTradingIdempotencyKey,
  buildTrainingIdempotencyKey,
  buildNamespaceProfileReconcileIdempotencyKey,
  tradingUniverseEnqueueSchema,
  tradingBacktestEnqueueSchema,
  tradingCalibrationEnqueueSchema,
  tradingRebalanceEnqueueSchema,
  tradingModelRiskEnqueueSchema,
  TRAINING_EMBEDDING_DEDUPE_QUEUE,
  TRAINING_DATA_POLICY_GATE_QUEUE,
  TRAINING_NAMESPACE_PROFILE_RECONCILE_QUEUE,
  TRAINING_FINE_TUNING_QUEUE_HIGH,
  TRAINING_FINE_TUNING_QUEUE_NORMAL,
  TRAINING_FINE_TUNING_QUEUE_LOW,
  trainingEmbeddingDedupeQueuePayloadSchema,
  trainingNamespaceProfileReconcileQueuePayloadSchema,
  Gauge as PromGauge,
  Counter as PromCounter,
  Histogram as PromHistogram,
  computeSemHash,
  applyPrivacyPolicy,
  generateInternalAuthHeaders,
  verifyImmutableAuditChain,
} from '@alice/shared-utils';
import { trainingServicePaths, trainingServiceSchemas } from './openapi-specs.js';
import { eq, and, desc, asc, sql, isNull, inArray, lte, ne } from '@alice/database';
import { z } from 'zod';
import {
  getNamespaceProfileDefaultConfig,
} from '@alice/database/system-config';
import {
  NamespaceProfileConfigSchema,
  TradingTechniqueSchema,
  type TradingSignalMetadata,
  type NamespaceProfileConfig,
  type TradingTechnique,
} from '@alice/shared';

function parseStructuredJsonFromContent(content: string): unknown {
  const trimmed = content.trim();
  const stripped = trimmed.startsWith('```')
    ? trimmed.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim()
    : trimmed;
  try {
    return JSON.parse(stripped);
  } catch {
    throw new Error(`ConteÃºdo LLM nÃ£o Ã© JSON vÃ¡lido. Recebido: ${stripped.slice(0, 200)}`);
  }
}

import {
  activateLoraAdapter,
  getActiveAdapter,
  deactivateLoraAdapter,
  cancelJob,
} from './lora-job-manager.js';
import { resolveScope } from './scope-resolver.js';
import { runUniverseScanWorker } from './trading/jobs/universe-scan-worker.js';
import { runBacktestWorker } from './trading/jobs/backtest-worker.js';
import { runCalibrationWorker } from './trading/jobs/calibration-worker.js';
import { runPortfolioRebalanceWorker } from './trading/jobs/portfolio-rebalance-worker.js';
import { runModelRiskWorker } from './trading/jobs/model-risk-worker.js';
import { TRAINING_DATA_SIMILARITY_THRESHOLD, TRAINING_EMBEDDING_DEDUPE_WORKER_POLL_INTERVAL_MS } from './training-data-constants.js';
import { createTrainingEmbeddingDedupeWorker } from './workers/training-embedding-dedupe-worker.js';
import { createNamespaceProfileReconcileWorker } from './workers/namespace-profile-reconcile-worker.js';
import { createTrainingDataPolicyGateWorker } from './workers/training-data-policy-gate-worker.js';
import { createTrainingFineTuningWorker } from './workers/training-fine-tuning-worker.js';
import { enqueueTrainingFineTuningRun } from './training-fine-tuning-queue.js';
import {
  loadTrainingSystemRuntimeConfig,
  runTrainingFineTuningJob,
} from './training-runner.js';
import { loadTrainingEnterpriseConfig } from './training-config.js';
import {
  getTenantInflightFineTuningJobsCount,
  loadTrainingGovernanceRuntimeConfig,
} from './training-governance.js';
import {
  createTrainingGovernanceAuditService,
  isTrainingGovernanceAuditAction,
  TRAINING_GOVERNANCE_AUDIT_ACTIONS,
} from './training-governance-audit.js';
import { getPromotionApprovalSummary } from './training-promotion-approvals.js';
import { createTrainingJobLifecycleService } from './training-job-lifecycle.js';
import { createTrainingRunStartIdempotencyService } from './training-run-start-idempotency.js';
import {
  buildTradingDataEligibilityConditions,
  loadTradingDataGovernancePolicyFromEnv,
} from './trading-data-governance.js';
import { registerTrainingPlatformRoutes } from './routes/training-platform-routes.js';
import { registerTrainingAuditRoutes } from './routes/training-audit-routes.js';
import { registerTrainingLoraOrchestratorRoutes } from './routes/training-lora-orchestrator-routes.js';
import { registerTrainingRuntimeRoutes } from './routes/training-runtime-routes.js';
import { registerTrainingRunManagementRoutes } from './routes/training-run-management-routes.js';
import { registerTrainingScheduleRoutes } from './routes/training-schedule-routes.js';
import { registerTrainingDataRoutes } from './routes/training-data-routes.js';
import { registerTrainingJobQueryRoutes } from './routes/training-job-query-routes.js';
import { registerTrainingJobCancelRoutes } from './routes/training-job-cancel-routes.js';
import { registerTrainingJobCreateRoutes } from './routes/training-job-create-routes.js';
import { registerTrainingJobPromotionApprovalRoutes } from './routes/training-job-promotion-approval-routes.js';
import { registerTrainingJobRollbackRoutes } from './routes/training-job-rollback-routes.js';
import { registerTrainingJobPromoteRoutes } from './routes/training-job-promote-routes.js';
import { registerTrainingRunStartRoutes } from './routes/training-run-start-routes.js';
import { registerTrainingDataReviewRoutes } from './routes/training-data-review-routes.js';
import { registerTrainingBulkImportRoutes } from './routes/training-bulk-import-routes.js';
import { registerTrainingWebhookRoutes } from './routes/training-webhook-routes.js';
// Fine-tuning Ã© executado localmente via GPU Manager Service (Regra 6 - sem stubs/migraÃ§Ã£o)

// Logger centralizado: JSON em produÃ§Ã£o, pino-pretty em desenvolvimento
const logger = createLogger('training-service');

// ============================================================================
// VALIDAÃ‡ÃƒO DE VARIÃVEIS DE AMBIENTE - CORREÃ‡ÃƒO AUDITORIA 17/12/2025
// Bug: parseInt sem validaÃ§Ã£o de NaN causava:
// - app.listen(NaN) â†’ comportamento indefinido
// ============================================================================
function parseEnvInt(envValue: string | undefined, defaultValue: number, varName: string): number {
  const raw = envValue ?? String(defaultValue);
  const trimmed = raw.trim();
  
  // Regra 6: Rejeitar valores parciais - sÃ³ dÃ­gitos sÃ£o aceitos
  if (!/^\d+$/.test(trimmed)) {
    const errorMsg = `${varName} invÃ¡lido: "${raw}". Deve ser nÃºmero inteiro positivo.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ varName, rawValue: raw }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, defaultValue }, `${errorMsg} Usando valor padrÃ£o.`);
    return defaultValue;
  }
  
  const parsed = parseInt(trimmed, 10);
  
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const errorMsg = `${varName} invÃ¡lido: "${raw}". Deve ser nÃºmero inteiro positivo.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ varName, rawValue: raw, parsed }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, parsed, defaultValue }, `${errorMsg} Usando valor padrÃ£o.`);
    return defaultValue;
  }
  
  return parsed;
}

function parseEnvBoolean(envValue: string | undefined, defaultValue: boolean): boolean {
  if (typeof envValue === 'undefined') return defaultValue;
  const normalized = envValue.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return defaultValue;
}

function resolveFineTuningQueuePriorityFromSnapshot(
  runSource: 'custom_job' | 'on_demand' | 'scheduled',
  snapshot: unknown
): 'low' | 'normal' | 'high' {
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    const raw = (snapshot as Record<string, unknown>).priority;
    if (raw === 'low' || raw === 'normal' || raw === 'high') {
      return raw;
    }
  }
  if (runSource === 'scheduled') return 'low';
  return 'normal';
}

type ScheduleScopeMetadata = {
  minDataRequired?: number;
  cronPattern?: string;
  namespaceId?: string | null;
  configuredAt?: string;
};

function readScheduleScopeMetadata(raw: unknown): ScheduleScopeMetadata {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const metadata = raw as Record<string, unknown>;
  return {
    minDataRequired: typeof metadata.minDataRequired === 'number' ? metadata.minDataRequired : undefined,
    cronPattern: typeof metadata.cronPattern === 'string' ? metadata.cronPattern : undefined,
    namespaceId: typeof metadata.namespaceId === 'string'
      ? metadata.namespaceId
      : (metadata.namespaceId === null ? null : undefined),
    configuredAt: typeof metadata.configuredAt === 'string' ? metadata.configuredAt : undefined,
  };
}

function isSameScheduleScope(metadata: unknown, namespaceId: string | null): boolean {
  const parsed = readScheduleScopeMetadata(metadata);
  return (parsed.namespaceId ?? null) === (namespaceId ?? null);
}

type RequestAuthContext = NonNullable<ReturnType<typeof extractAuthContext>>;

function resolveAuthorizedTenantId(
  req: Request,
  requestedTenantId?: string | null
): { ok: true; tenantId: string; authContext: RequestAuthContext } | { ok: false; status: number; error: string } {
  const authContext = extractAuthContext(req);
  if (!authContext) {
    return { ok: false, status: 401, error: 'Autenticacao necessaria' };
  }

  const normalizedRequestedTenantId = typeof requestedTenantId === 'string' && requestedTenantId.trim().length > 0
    ? requestedTenantId.trim()
    : null;

  if (authContext.role !== 'super_admin') {
    if (!authContext.tenantId) {
      return { ok: false, status: 403, error: 'Tenant nao identificado para o usuario autenticado' };
    }
    if (normalizedRequestedTenantId && normalizedRequestedTenantId !== authContext.tenantId) {
      return { ok: false, status: 403, error: 'Acesso negado para tenant diferente do usuario autenticado' };
    }
    return { ok: true, tenantId: authContext.tenantId, authContext };
  }

  const superAdminTenantId = normalizedRequestedTenantId ?? authContext.tenantId ?? null;
  if (!superAdminTenantId) {
    return { ok: false, status: 400, error: 'tenantId obrigatorio para super_admin sem tenant vinculado' };
  }

  return { ok: true, tenantId: superAdminTenantId, authContext };
}

type FineTuningJobRow = typeof schema.fineTuningJobs.$inferSelect;
type RequestWithRawBody = Request & { rawBody?: Buffer };
const TRAINING_JOB_STREAM_POLL_INTERVAL_MS = parseEnvInt(
  process.env.TRAINING_JOB_STREAM_POLL_INTERVAL_MS,
  1000,
  'TRAINING_JOB_STREAM_POLL_INTERVAL_MS'
);
const TRAINING_JOB_STREAM_HEARTBEAT_MS = parseEnvInt(
  process.env.TRAINING_JOB_STREAM_HEARTBEAT_MS,
  15000,
  'TRAINING_JOB_STREAM_HEARTBEAT_MS'
);

function toIsoTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isActiveFineTuningJobStatus(status: FineTuningJobRow['status']): boolean {
  return status === 'pending'
    || status === 'preparing'
    || status === 'training'
    || status === 'validating';
}

function buildFineTuningJobStreamFingerprint(job: FineTuningJobRow): string {
  const metrics = asObjectRecord(job.metrics);
  const progress = asObjectRecord(metrics?.progress);
  const failure = asObjectRecord(metrics?.failure);

  return stableStringifyForFingerprint({
    id: job.id,
    status: job.status,
    progress: job.progress ?? null,
    evaluationStatus: job.evaluationStatus ?? null,
    promotionStatus: job.promotionStatus ?? null,
    resultModel: job.resultModel ?? null,
    errorMessage: job.errorMessage ?? null,
    iniciadoEm: toIsoTimestamp(job.iniciadoEm),
    completadoEm: toIsoTimestamp(job.completadoEm),
    progressMetrics: {
      status: typeof progress?.status === 'string' ? progress.status : null,
      progress: typeof progress?.progress === 'number' ? progress.progress : null,
      currentStep: typeof progress?.currentStep === 'number' ? progress.currentStep : null,
      totalSteps: typeof progress?.totalSteps === 'number' ? progress.totalSteps : null,
      updatedAt: typeof progress?.updatedAt === 'string' ? progress.updatedAt : null,
      adapterPath: typeof metrics?.adapterPath === 'string' ? metrics.adapterPath : null,
    },
    failureMetrics: {
      message: typeof failure?.message === 'string' ? failure.message : null,
      at: typeof failure?.at === 'string' ? failure.at : null,
    },
  });
}

function stableStringifyForFingerprint(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringifyForFingerprint(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => typeof entryValue !== 'undefined')
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
  return `{${entries
    .map(([entryKey, entryValue]) => `${JSON.stringify(entryKey)}:${stableStringifyForFingerprint(entryValue)}`)
    .join(',')}}`;
}

const PORT = parseEnvInt(process.env.PORT, 3004, 'PORT');
const TRAINING_HTTP_SERVER_TIMEOUT_MS = parseEnvInt(
  process.env.TRAINING_HTTP_SERVER_TIMEOUT_MS,
  600000,
  'TRAINING_HTTP_SERVER_TIMEOUT_MS'
);
const TRAINING_OPERATION_LOCK_TTL_SECONDS = parseEnvInt(
  process.env.TRAINING_OPERATION_LOCK_TTL_SECONDS,
  45,
  'TRAINING_OPERATION_LOCK_TTL_SECONDS'
);
const TRAINING_RUN_START_IDEMPOTENCY_TTL_SECONDS = parseEnvInt(
  process.env.TRAINING_RUN_START_IDEMPOTENCY_TTL_SECONDS,
  86400,
  'TRAINING_RUN_START_IDEMPOTENCY_TTL_SECONDS'
);
const TRAINING_RUN_START_CONTENTION_RETRY_AFTER_SECONDS = parseEnvInt(
  process.env.TRAINING_RUN_START_CONTENTION_RETRY_AFTER_SECONDS,
  15,
  'TRAINING_RUN_START_CONTENTION_RETRY_AFTER_SECONDS'
);
const TRAINING_RUN_START_CAPACITY_RETRY_AFTER_SECONDS = parseEnvInt(
  process.env.TRAINING_RUN_START_CAPACITY_RETRY_AFTER_SECONDS,
  60,
  'TRAINING_RUN_START_CAPACITY_RETRY_AFTER_SECONDS'
);
const TRAINING_RUN_START_REQUIRE_IDEMPOTENCY_KEY = parseEnvBoolean(
  process.env.TRAINING_RUN_START_REQUIRE_IDEMPOTENCY_KEY,
  false
);
const tradingDataGovernancePolicy = loadTradingDataGovernancePolicyFromEnv();
const DATABASE_URL = process.env.DATABASE_URL;
const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL ?? 'http://alice-rag:3003';
const INTEGRATIONS_SERVICE_URL = process.env.INTEGRATIONS_SERVICE_URL;
if (!INTEGRATIONS_SERVICE_URL) {
  throw new Error('INTEGRATIONS_SERVICE_URL Ã© obrigatÃ³rio (Regra 6 - fail-fast)');
}
const INTEGRATIONS_SERVICE_URL_FINAL = INTEGRATIONS_SERVICE_URL;
const corsOriginsEnv = process.env.CORS_ORIGINS;
if (!corsOriginsEnv && process.env.NODE_ENV === 'production') {
  logger.error('CORS_ORIGINS Ã© obrigatÃ³rio em produÃ§Ã£o (Regra 6 - fail-fast)');
  process.exit(1);
}
const CORS_ORIGINS = corsOriginsEnv
  ? corsOriginsEnv.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [];

if (!DATABASE_URL) {
  logger.error('DATABASE_URL nÃ£o configurada');
  process.exit(1);
}

logger.info('Training service inicializado - fine-tuning LoRA ativo via GPU Manager Service (GPU Ãºnica 20GB)');

// Usar package @alice/database centralizado (node-postgres para produÃ§Ã£o Hetzner)
const db = getDatabase();

async function findNamespaceByIdInTenant(tenantId: string, namespaceId: string) {
  return withTenantContext(tenantId, false, async (tenantDb) =>
    tenantDb.query.namespaces.findFirst({
      where: eq(schema.namespaces.id, namespaceId),
      columns: { id: true, tenantId: true },
    })
  );
}

async function findAgentByIdInTenant(tenantId: string, agentId: string) {
  return withTenantContext(tenantId, false, async (tenantDb) =>
    tenantDb.query.agents.findFirst({
      where: eq(schema.agents.id, agentId),
      columns: { id: true, tenantId: true, namespaceId: true },
    })
  );
}
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
// PROMETHEUS: InstrumentaÃ§Ã£o de mÃ©tricas (Regra 16 - Observability Enterprise)
// ============================================================================
const { metrics, metricsRouter, httpMetricsMiddleware } = createAlicePrometheus({
  serviceName: 'training-service',
  collectDefaultMetrics: true,
});

// MÃ©trica enterprise: total de datasets de treinamento (DB â†’ Prometheus)
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
    help: 'DistribuiÃ§Ã£o de score de qualidade dos dados de treinamento',
    buckets: [0, 0.25, 0.5, 0.75, 0.9, 0.95, 1],
    registers: [metrics.registry],
  }),
  reviewTotal: new PromCounter({
    name: 'alice_training_data_review_total',
    help: 'Total de revisÃµes manuais de dados de treinamento',
    labelNames: ['decision'] as const,
    registers: [metrics.registry],
  }),
  schedulerRunsTotal: new PromCounter({
    name: 'alice_training_scheduler_runs_total',
    help: 'Total de execuÃ§Ãµes do scheduler de auto-learning',
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
    help: 'Total de overrides manuais de escopo durante aprovaÃ§Ã£o',
    labelNames: ['source'] as const,
    registers: [metrics.registry],
  }),
  scopeResolvedTotal: new PromCounter({
    name: 'alice_training_scope_resolved_total',
    help: 'Total de itens de quarentena resolvidos manualmente',
    labelNames: ['source'] as const,
    registers: [metrics.registry],
  }),
  /** Plano TREINAMENTO-LIMITES 11/02/2026: sugestÃ£o de novo namespace quando nÃ£o hÃ¡ match */
  scopeSuggestedNewNamespaceTotal: new PromCounter({
    name: 'alice_training_scope_suggested_new_namespace_total',
    help: 'Total de vezes que scope-resolver sugeriu criaÃ§Ã£o de novo namespace (sem namespace inferido)',
    labelNames: ['source_type'] as const,
    registers: [metrics.registry],
  }),
  scopeConfidenceHistogram: new PromHistogram({
    name: 'alice_training_scope_confidence_histogram',
    help: 'Distribuicao de confidence do scope-resolver para dados de treinamento',
    buckets: [0, 0.25, 0.5, 0.65, 0.75, 0.85, 0.95, 1],
    registers: [metrics.registry],
  }),
  failClosedBlockTotal: new PromCounter({
    name: 'alice_training_fail_closed_block_total',
    help: 'Total de bloqueios fail-closed no pipeline de treinamento/trading',
    labelNames: ['reason'] as const,
    registers: [metrics.registry],
  }),
  embeddingDedupeJobsTotal: new PromCounter({
    name: 'alice_training_embedding_dedupe_jobs_total',
    help: 'Total de jobs de embedding/dedupe processados pela fila',
    labelNames: ['result'] as const,
    registers: [metrics.registry],
  }),
  embeddingDedupeHitsTotal: new PromCounter({
    name: 'alice_training_embedding_dedupe_hits_total',
    help: 'Total de hits de deduplicaÃ§Ã£o por mÃ©todo',
    labelNames: ['method'] as const,
    registers: [metrics.registry],
  }),
  embeddingDedupeDurationSeconds: new PromHistogram({
    name: 'alice_training_embedding_dedupe_duration_seconds',
    help: 'DuraÃ§Ã£o de processamento dos jobs de embedding/dedupe',
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [metrics.registry],
  }),
  namespaceProfileReconcileJobsTotal: new PromCounter({
    name: 'alice_training_namespace_profile_reconcile_jobs_total',
    help: 'Total de jobs de reconciliaÃ§Ã£o de namespace_profiles processados pela fila',
    labelNames: ['result'] as const,
    registers: [metrics.registry],
  }),
  namespaceProfileReconcileCreatedTotal: new PromCounter({
    name: 'alice_training_namespace_profile_reconcile_created_total',
    help: 'Total de namespace_profiles criados automaticamente pelo reconcile',
    registers: [metrics.registry],
  }),
  namespaceProfileReconcileMissingTotal: new PromCounter({
    name: 'alice_training_namespace_profile_reconcile_missing_total',
    help: 'Total de namespaces detectados sem namespace_profile no reconcile',
    registers: [metrics.registry],
  }),
  namespaceProfileReconcileDurationSeconds: new PromHistogram({
    name: 'alice_training_namespace_profile_reconcile_duration_seconds',
    help: 'DuraÃ§Ã£o de processamento dos jobs de reconciliaÃ§Ã£o de namespace_profiles',
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [metrics.registry],
  }),
  fineTuningQueueJobsTotal: new PromCounter({
    name: 'alice_training_fine_tuning_queue_jobs_total',
    help: 'Total de jobs de fine-tuning processados pela fila redis',
    labelNames: ['result'] as const,
    registers: [metrics.registry],
  }),
  fineTuningQueueDurationSeconds: new PromHistogram({
    name: 'alice_training_fine_tuning_queue_duration_seconds',
    help: 'Duracao de processamento dos jobs de fine-tuning na fila redis',
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [metrics.registry],
  }),
  fineTuningQueuePending: new PromGauge({
    name: 'alice_training_fine_tuning_queue_pending',
    help: 'Mensagens pendentes no consumer group da fila de fine-tuning',
    labelNames: ['queue'] as const,
    registers: [metrics.registry],
  }),
  fineTuningQueueLag: new PromGauge({
    name: 'alice_training_fine_tuning_queue_lag',
    help: 'Lag aproximado por fila de prioridade de fine-tuning',
    labelNames: ['queue'] as const,
    registers: [metrics.registry],
  }),
  fineTuningQueueDlqTotal: new PromGauge({
    name: 'alice_training_fine_tuning_queue_dlq_total',
    help: 'Total acumulado de mensagens em DLQ por fila de fine-tuning',
    labelNames: ['queue'] as const,
    registers: [metrics.registry],
  }),
  privacyRedactionsTotal: new PromCounter({
    name: 'alice_training_privacy_redactions_total',
    help: 'Total de redaÃ§Ãµes aplicadas por polÃ­tica de privacidade no treinamento',
    registers: [metrics.registry],
  }),
  privacyQuarantineTotal: new PromCounter({
    name: 'alice_training_privacy_quarantine_total',
    help: 'Total de itens em quarentena por polÃ­tica de privacidade',
    registers: [metrics.registry],
  }),
  consentRejectedTotal: new PromCounter({
    name: 'alice_training_consent_rejected_total',
    help: 'Total de itens rejeitados por ausÃªncia de consentimento de treinamento',
    registers: [metrics.registry],
  }),
  governanceLockAttemptsTotal: new PromCounter({
    name: 'alice_training_governance_lock_attempts_total',
    help: 'Total de tentativas de lock distribuido para operacoes de governanca de treinamento',
    labelNames: ['operation', 'result'] as const,
    registers: [metrics.registry],
  }),
  governanceAuditWritesTotal: new PromCounter({
    name: 'alice_training_governance_audit_writes_total',
    help: 'Total de eventos de auditoria de governanca persistidos',
    labelNames: ['action', 'result'] as const,
    registers: [metrics.registry],
  }),
  runStartIdempotencyTotal: new PromCounter({
    name: 'alice_training_run_start_idempotency_total',
    help: 'Resultado das validacoes e persistencia de idempotencia em start de treino',
    labelNames: ['endpoint', 'result'] as const,
    registers: [metrics.registry],
  }),
  webhookNonceValidationTotal: new PromCounter({
    name: 'alice_training_webhook_nonce_validation_total',
    help: 'Resultado das validacoes de nonce do webhook de treinamento',
    labelNames: ['storage', 'result'] as const,
    registers: [metrics.registry],
  }),
  webhookAuthValidationTotal: new PromCounter({
    name: 'alice_training_webhook_auth_validation_total',
    help: 'Resultado da validacao de autenticacao do webhook de treinamento',
    labelNames: ['mode', 'result'] as const,
    registers: [metrics.registry],
  }),
  webhookBodyDigestValidationTotal: new PromCounter({
    name: 'alice_training_webhook_body_digest_validation_total',
    help: 'Resultado da validacao de integridade do payload do webhook de treinamento',
    labelNames: ['result'] as const,
    registers: [metrics.registry],
  }),
  immutableAuditIntegrityChecksTotal: new PromCounter({
    name: 'alice_training_immutable_audit_integrity_checks_total',
    help: 'Total de verificacoes periodicas de integridade do ledger imutavel',
    labelNames: ['result'] as const,
    registers: [metrics.registry],
  }),
  immutableAuditIntegrityStatus: new PromGauge({
    name: 'alice_training_immutable_audit_integrity_status',
    help: 'Status da ultima verificacao de integridade do ledger imutavel (1=ok,0=erro)',
    registers: [metrics.registry],
  }),
  immutableAuditIntegrityBrokenStreams: new PromGauge({
    name: 'alice_training_immutable_audit_integrity_broken_streams',
    help: 'Quantidade de streams com integridade quebrada na ultima verificacao',
    registers: [metrics.registry],
  }),
  immutableAuditIntegrityCheckedStreams: new PromGauge({
    name: 'alice_training_immutable_audit_integrity_checked_streams',
    help: 'Quantidade de streams avaliadas na ultima verificacao de integridade',
    registers: [metrics.registry],
  }),
  immutableAuditIntegrityLastCheckTimestampSeconds: new PromGauge({
    name: 'alice_training_immutable_audit_integrity_last_check_timestamp_seconds',
    help: 'Timestamp unix em segundos da ultima verificacao de integridade do ledger imutavel',
    registers: [metrics.registry],
  }),
  highRiskAuditEventsTotal: new PromCounter({
    name: 'alice_high_risk_audit_events_total',
    help: 'Total de eventos de auditoria de alto risco registrados',
    labelNames: ['service', 'event_type', 'result'] as const,
    registers: [metrics.registry],
  }),
};

const tradingMetrics = {
  queuePending: new PromGauge({
    name: 'trading_queue_pending',
    help: 'Mensagens pendentes por consumer group nas filas de trading',
    labelNames: ['queue'] as const,
    registers: [metrics.registry],
  }),
  queueLagMs: new PromGauge({
    name: 'trading_queue_lag_ms',
    help: 'Lag aproximado do consumer group de trading (ms)',
    labelNames: ['queue'] as const,
    registers: [metrics.registry],
  }),
  dlqTotal: new PromGauge({
    name: 'trading_dlq_total',
    help: 'Total acumulado de mensagens em DLQ por stream de trading',
    labelNames: ['queue'] as const,
    registers: [metrics.registry],
  }),
  universeScanSeconds: new PromHistogram({
    name: 'trading_universe_scan_seconds',
    help: 'DuraÃ§Ã£o de processamento do worker de universe scan',
    buckets: [0.05, 0.1, 0.5, 1, 2, 5],
    registers: [metrics.registry],
  }),
  backtestSeconds: new PromHistogram({
    name: 'trading_backtest_seconds',
    help: 'DuraÃ§Ã£o de processamento do worker de backtest',
    buckets: [0.1, 0.5, 1, 2, 5, 10],
    registers: [metrics.registry],
  }),
  calibrationSeconds: new PromHistogram({
    name: 'trading_calibration_seconds',
    help: 'DuraÃ§Ã£o de processamento do worker de calibration',
    buckets: [0.05, 0.1, 0.5, 1, 2, 5],
    registers: [metrics.registry],
  }),
  rebalanceSeconds: new PromHistogram({
    name: 'trading_rebalance_seconds',
    help: 'DuraÃ§Ã£o de processamento do worker de rebalance',
    buckets: [0.05, 0.1, 0.5, 1, 2, 5],
    registers: [metrics.registry],
  }),
  modelRiskSeconds: new PromHistogram({
    name: 'trading_model_risk_seconds',
    help: 'DuraÃ§Ã£o de processamento do worker de model risk',
    buckets: [0.05, 0.1, 0.5, 1, 2, 5],
    registers: [metrics.registry],
  }),
  modelRiskEventsTotal: new PromCounter({
    name: 'trading_model_risk_events_total',
    help: 'Total de eventos de model risk registrados',
    registers: [metrics.registry],
  }),
  backtestDsr: new PromGauge({
    name: 'trading_backtest_dsr',
    help: 'Ãšltimo DSR calculado por mercado/estratÃ©gia',
    labelNames: ['marketType', 'strategyKey'] as const,
    registers: [metrics.registry],
  }),
  backtestPbo: new PromGauge({
    name: 'trading_backtest_pbo',
    help: 'Ãšltimo PBO calculado por mercado/estratÃ©gia',
    labelNames: ['marketType', 'strategyKey'] as const,
    registers: [metrics.registry],
  }),
  candidateCount: new PromCounter({
    name: 'trading_candidates_total',
    help: 'Total de candidatos produzidos por lado e mercado',
    labelNames: ['side', 'marketType'] as const,
    registers: [metrics.registry],
  }),
  datasetVersionCreatedTotal: new PromCounter({
    name: 'training_dataset_version_created_total',
    help: 'Total de versÃµes de dataset criadas',
    registers: [metrics.registry],
  }),
  portfolioAutoRunSeconds: new PromHistogram({
    name: 'trading_portfolio_auto_run_seconds',
    help: 'DuraÃ§Ã£o de processamento do worker de portfolio auto run',
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [metrics.registry],
  }),
  signalAutoRunSeconds: new PromHistogram({
    name: 'trading_signal_auto_run_seconds',
    help: 'DuraÃ§Ã£o de processamento do worker de signal auto run',
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [metrics.registry],
  }),
  signalAutoLlmStepSeconds: new PromHistogram({
    name: 'trading_signal_auto_llm_step_seconds',
    help: 'DuraÃ§Ã£o do step signal-llm do auto engine',
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [metrics.registry],
  }),
  signalAutoLlmFailuresTotal: new PromCounter({
    name: 'trading_signal_auto_llm_failures_total',
    help: 'Total de falhas LLM no auto engine de sinais',
    registers: [metrics.registry],
  }),
};

const tradingQueueNames = {
  universe: TRADING_STREAMS.universeScan,
  backtest: TRADING_STREAMS.backtest,
  calibration: TRADING_STREAMS.calibration,
  rebalance: TRADING_STREAMS.portfolioRebalance,
  modelRisk: TRADING_STREAMS.modelRisk,
  portfolioAutoRun: TRADING_STREAMS.portfolioAutoRun,
  signalAutoRun: TRADING_STREAMS.signalAutoRun,
} as const;

const fineTuningQueueNames = [
  TRAINING_FINE_TUNING_QUEUE_HIGH,
  TRAINING_FINE_TUNING_QUEUE_NORMAL,
  TRAINING_FINE_TUNING_QUEUE_LOW,
] as const;

const TRAINING_METRICS_INTERVAL_MS = parseEnvInt(
  process.env.TRAINING_METRICS_INTERVAL_MS,
  60000,
  'TRAINING_METRICS_INTERVAL_MS'
);
const NAMESPACE_PROFILE_RECONCILE_INTERVAL_MS = parseEnvInt(
  process.env.NAMESPACE_PROFILE_RECONCILE_INTERVAL_MS,
  600_000,
  'NAMESPACE_PROFILE_RECONCILE_INTERVAL_MS'
);
const TRAINING_POLICY_GATE_WORKER_POLL_INTERVAL_MS = parseEnvInt(
  process.env.TRAINING_POLICY_GATE_WORKER_POLL_INTERVAL_MS,
  5_000,
  'TRAINING_POLICY_GATE_WORKER_POLL_INTERVAL_MS'
);
const TRAINING_FINE_TUNING_WORKER_POLL_INTERVAL_MS = parseEnvInt(
  process.env.TRAINING_FINE_TUNING_WORKER_POLL_INTERVAL_MS,
  5_000,
  'TRAINING_FINE_TUNING_WORKER_POLL_INTERVAL_MS'
);
const TRADING_WORKER_POLL_INTERVAL_MS = 250;
const TRADING_SIGNAL_AUTO_CANDIDATE_FETCH_LIMIT = parseEnvInt(
  process.env.TRADING_SIGNAL_AUTO_CANDIDATE_FETCH_LIMIT,
  300,
  'TRADING_SIGNAL_AUTO_CANDIDATE_FETCH_LIMIT',
);
const TRADING_SIGNAL_AUTO_AUTOMIX_CANDIDATE_FETCH_LIMIT = parseEnvInt(
  process.env.TRADING_SIGNAL_AUTO_AUTOMIX_CANDIDATE_FETCH_LIMIT,
  2_000,
  'TRADING_SIGNAL_AUTO_AUTOMIX_CANDIDATE_FETCH_LIMIT',
);
const TRAINING_IMMUTABLE_AUDIT_CHECK_INTERVAL_MS = parseEnvInt(
  process.env.TRAINING_IMMUTABLE_AUDIT_CHECK_INTERVAL_MS,
  300_000,
  'TRAINING_IMMUTABLE_AUDIT_CHECK_INTERVAL_MS',
);
const TRAINING_IMMUTABLE_AUDIT_STREAMS_PER_CHECK = parseEnvInt(
  process.env.TRAINING_IMMUTABLE_AUDIT_STREAMS_PER_CHECK,
  20,
  'TRAINING_IMMUTABLE_AUDIT_STREAMS_PER_CHECK',
);
const TRAINING_IMMUTABLE_AUDIT_EVENTS_PER_STREAM_LIMIT = parseEnvInt(
  process.env.TRAINING_IMMUTABLE_AUDIT_EVENTS_PER_STREAM_LIMIT,
  5_000,
  'TRAINING_IMMUTABLE_AUDIT_EVENTS_PER_STREAM_LIMIT',
);

let trainingMetricsInterval: NodeJS.Timeout | null = null;
let namespaceProfileReconcileInterval: NodeJS.Timeout | null = null;
let trainingImmutableAuditIntegrityInterval: NodeJS.Timeout | null = null;
const tradingWorkerStoppers: Array<() => Promise<void>> = [];

type ImmutableAuditIntegrityHealthState = {
  status: 'unknown' | 'ok' | 'error';
  checkedAt: string | null;
  checkedStreams: number;
  brokenStreams: number;
  reason: string | null;
};

let trainingImmutableAuditIntegrityState: ImmutableAuditIntegrityHealthState = {
  status: 'unknown',
  checkedAt: null,
  checkedStreams: 0,
  brokenStreams: 0,
  reason: null,
};

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

    const redis = getRedisClient();
    if (!redis) {
      return;
    }

    for (const queueName of fineTuningQueueNames) {
      const queue = new RedisStreamQueue(queueName, {
        group: 'training-service',
        consumer: `training-metrics-${process.pid}`,
        maxRetries: 3,
        autoClaimCount: 10,
      });

      try {
        const lagMetrics = await queue.getLagMetrics(redis);
        trainingPipelineMetrics.fineTuningQueuePending.set(
          { queue: queueName },
          lagMetrics.pending
        );
        trainingPipelineMetrics.fineTuningQueueLag.set(
          { queue: queueName },
          lagMetrics.lag
        );
        trainingPipelineMetrics.fineTuningQueueDlqTotal.set(
          { queue: queueName },
          await queue.dlqSize(redis)
        );
      } catch {
        trainingPipelineMetrics.fineTuningQueuePending.set({ queue: queueName }, 0);
        trainingPipelineMetrics.fineTuningQueueLag.set({ queue: queueName }, 0);
        trainingPipelineMetrics.fineTuningQueueDlqTotal.set({ queue: queueName }, 0);
      }
    }
  } catch (error) {
    logger.error({ error }, 'Falha ao atualizar metricas de training');
  }
}

async function getFineTuningQueuesStatus(): Promise<Array<{
  queue: string;
  pending: number;
  lag: number;
  dlq: number;
}>> {
  const redis = getRedisClient();
  if (!redis) {
    return fineTuningQueueNames.map((queue) => ({ queue, pending: 0, lag: 0, dlq: 0 }));
  }

  const output: Array<{ queue: string; pending: number; lag: number; dlq: number }> = [];
  for (const queueName of fineTuningQueueNames) {
    const queue = new RedisStreamQueue(queueName, {
      group: 'training-service',
      consumer: `training-queue-status-${process.pid}`,
      maxRetries: 3,
      autoClaimCount: 10,
    });

    try {
      const lagMetrics = await queue.getLagMetrics(redis);
      const dlq = await queue.dlqSize(redis);
      output.push({
        queue: queueName,
        pending: lagMetrics.pending,
        lag: lagMetrics.lag,
        dlq,
      });
    } catch {
      output.push({ queue: queueName, pending: 0, lag: 0, dlq: 0 });
    }
  }
  return output;
}

function startTrainingMetricsScheduler(): void {
  void refreshTrainingMetrics();
  trainingMetricsInterval = setInterval(() => {
    void refreshTrainingMetrics();
  }, TRAINING_METRICS_INTERVAL_MS);
}

async function runTrainingImmutableAuditIntegrityCheck(): Promise<void> {
  try {
    const recentEvents = await db.query.immutableAuditEvents.findMany({
      where: eq(schema.immutableAuditEvents.stream, 'training_governance'),
      columns: {
        streamKey: true,
      },
      orderBy: [desc(schema.immutableAuditEvents.createdAt)],
      limit: TRAINING_IMMUTABLE_AUDIT_STREAMS_PER_CHECK * 50,
    });

    const streamKeys = Array.from(new Set(
      recentEvents
        .map((event) => event.streamKey)
        .filter((streamKey): streamKey is string => typeof streamKey === 'string' && streamKey.length > 0)
    )).slice(0, TRAINING_IMMUTABLE_AUDIT_STREAMS_PER_CHECK);

    let brokenStreams = 0;
    let firstReason: string | null = null;

    for (const streamKey of streamKeys) {
      const [latest] = await db.query.immutableAuditEvents.findMany({
        where: and(
          eq(schema.immutableAuditEvents.stream, 'training_governance'),
          eq(schema.immutableAuditEvents.streamKey, streamKey),
        ),
        columns: {
          chainPosition: true,
        },
        orderBy: [desc(schema.immutableAuditEvents.chainPosition)],
        limit: 1,
      });

      const events = await db.query.immutableAuditEvents.findMany({
        where: and(
          eq(schema.immutableAuditEvents.stream, 'training_governance'),
          eq(schema.immutableAuditEvents.streamKey, streamKey),
        ),
        columns: {
          chainPosition: true,
          prevEventHash: true,
          eventHash: true,
        },
        orderBy: [asc(schema.immutableAuditEvents.chainPosition)],
        limit: TRAINING_IMMUTABLE_AUDIT_EVENTS_PER_STREAM_LIMIT,
      });

      const maxChainPosition = Number(latest?.chainPosition ?? 0);
      if (maxChainPosition > events.length) {
        brokenStreams += 1;
        if (!firstReason) {
          firstReason = `${streamKey}:CHAIN_SAMPLE_TRUNCATED max=${maxChainPosition} sampled=${events.length}`;
        }
        continue;
      }

      const integrity = verifyImmutableAuditChain(events);
      if (!integrity.ok) {
        brokenStreams += 1;
        if (!firstReason) {
          firstReason = `${streamKey}:${integrity.reason ?? 'INTEGRITY_CHECK_FAILED'}`;
        }
      }
    }

    const status: ImmutableAuditIntegrityHealthState['status'] = brokenStreams > 0 ? 'error' : 'ok';
    const checkedAt = new Date().toISOString();
    trainingImmutableAuditIntegrityState = {
      status,
      checkedAt,
      checkedStreams: streamKeys.length,
      brokenStreams,
      reason: firstReason,
    };

    trainingPipelineMetrics.immutableAuditIntegrityChecksTotal.inc({ result: status });
    trainingPipelineMetrics.immutableAuditIntegrityStatus.set(status === 'ok' ? 1 : 0);
    trainingPipelineMetrics.immutableAuditIntegrityBrokenStreams.set(brokenStreams);
    trainingPipelineMetrics.immutableAuditIntegrityCheckedStreams.set(streamKeys.length);
    trainingPipelineMetrics.immutableAuditIntegrityLastCheckTimestampSeconds.set(Math.floor(Date.now() / 1000));

    if (status === 'error') {
      logger.error(
        { checkedStreams: streamKeys.length, brokenStreams, reason: firstReason },
        'Verificacao de integridade do ledger imutavel falhou'
      );
    }
  } catch (error) {
    trainingImmutableAuditIntegrityState = {
      status: 'error',
      checkedAt: new Date().toISOString(),
      checkedStreams: 0,
      brokenStreams: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
    trainingPipelineMetrics.immutableAuditIntegrityChecksTotal.inc({ result: 'error' });
    trainingPipelineMetrics.immutableAuditIntegrityStatus.set(0);
    trainingPipelineMetrics.immutableAuditIntegrityBrokenStreams.set(0);
    trainingPipelineMetrics.immutableAuditIntegrityCheckedStreams.set(0);
    trainingPipelineMetrics.immutableAuditIntegrityLastCheckTimestampSeconds.set(Math.floor(Date.now() / 1000));
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Falha ao executar verificacao de integridade do ledger imutavel'
    );
  }
}

function startTrainingImmutableAuditIntegrityScheduler(): void {
  void runTrainingImmutableAuditIntegrityCheck();
  trainingImmutableAuditIntegrityInterval = setInterval(() => {
    void runTrainingImmutableAuditIntegrityCheck();
  }, TRAINING_IMMUTABLE_AUDIT_CHECK_INTERVAL_MS);
}


async function enqueueTradingJob(
  queueName: (typeof tradingQueueNames)[keyof typeof tradingQueueNames],
  payload: Record<string, unknown>,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    throw new Error('Redis nÃ£o disponÃ­vel para fila de trading');
  }
  const queue = new RedisStreamQueue(queueName, {
    group: 'training-service',
    consumer: `training-${process.pid}`,
    maxRetries: 3,
  });
  const idempotencyKey = buildTradingIdempotencyKey(queueName, payload);
  await queue.enqueue(redis, payload, idempotencyKey);
}

async function enqueueTrainingEmbeddingDedupeJob(payload: z.infer<typeof trainingEmbeddingDedupeQueuePayloadSchema>): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) {
    throw new Error('Redis nÃ£o disponÃ­vel para fila de embedding/dedupe');
  }

  const queue = new RedisStreamQueue<z.infer<typeof trainingEmbeddingDedupeQueuePayloadSchema>>(
    TRAINING_EMBEDDING_DEDUPE_QUEUE,
    {
      group: 'training-service',
      consumer: `training-${process.pid}`,
      maxRetries: 3,
      autoClaimCount: 10,
      streamMaxLen: 20_000,
    }
  );
  return queue.enqueue(redis, payload, payload.idempotencyKey);
}

async function enqueueNamespaceProfileReconcileJob(payload: z.infer<typeof trainingNamespaceProfileReconcileQueuePayloadSchema>): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) {
    throw new Error('Redis nÃ£o disponÃ­vel para fila de reconciliaÃ§Ã£o de namespace_profiles');
  }

  const queue = new RedisStreamQueue<z.infer<typeof trainingNamespaceProfileReconcileQueuePayloadSchema>>(
    TRAINING_NAMESPACE_PROFILE_RECONCILE_QUEUE,
    {
      group: 'training-service',
      consumer: `training-${process.pid}`,
      maxRetries: 3,
      autoClaimCount: 10,
      streamMaxLen: 5_000,
    }
  );
  return queue.enqueue(redis, payload, payload.idempotencyKey);
}

function startNamespaceProfileReconcileScheduler(): void {
  const scheduleTick = async () => {
    const runId = crypto.randomUUID();
    const payload = trainingNamespaceProfileReconcileQueuePayloadSchema.parse({
      runId,
      idempotencyKey: buildNamespaceProfileReconcileIdempotencyKey({ runId }),
      createdAt: new Date().toISOString(),
    });
    const enqueued = await enqueueNamespaceProfileReconcileJob(payload);
    logger.info(
      {
        queue: TRAINING_NAMESPACE_PROFILE_RECONCILE_QUEUE,
        runId,
        enqueued,
      },
      'Tick de reconciliaÃ§Ã£o de namespace_profiles processado'
    );
  };

  void scheduleTick().catch((error: unknown) => {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Falha no tick inicial de reconciliaÃ§Ã£o de namespace_profiles'
    );
  });

  namespaceProfileReconcileInterval = setInterval(() => {
    void scheduleTick().catch((error: unknown) => {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'Falha no tick agendado de reconciliaÃ§Ã£o de namespace_profiles'
      );
    });
  }, NAMESPACE_PROFILE_RECONCILE_INTERVAL_MS);
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
    streamMaxLen: parseEnvInt(process.env.TRADING_QUEUE_MAXLEN, 20_000, 'TRADING_QUEUE_MAXLEN'),
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
        tradingMetrics.queuePending.set({ queue: queueName }, lagMetrics.pending);
        tradingMetrics.queueLagMs.set({ queue: queueName }, lagMetrics.lag * TRADING_WORKER_POLL_INTERVAL_MS);
        tradingMetrics.dlqTotal.set({ queue: queueName }, await queue.dlqSize(redis));
      } catch (error) {
        logger.error({ queueName, error: error instanceof Error ? error.message : String(error) }, 'Falha ao processar job trading');
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

// Inicializar mÃ©tricas RBAC (Regra 16 - Observability Enterprise)
initRbacPrometheusMetrics(metrics.rbac);
logger.info('MÃ©tricas RBAC Prometheus inicializadas no training-service');

// Endpoint /metrics para Prometheus scraper (antes de outros middlewares)
app.use(metricsRouter);

// ============================================================================
// OPENAPI/SWAGGER: DocumentaÃ§Ã£o da API (OWASP API9)
// ============================================================================
setupSwaggerUI(app, {
  serviceName: 'training-service',
  version: '1.0.0',
  description: 'ServiÃ§o de fine-tuning com SemHash, auto-learning e GPU Manager Service (Hetzner GEX44).',
  port: Number(PORT),
  tags: TRAINING_SERVICE_TAGS,
  paths: trainingServicePaths,
  schemas: trainingServiceSchemas,
});
logger.info('Swagger UI configurado em /api/docs');

// Middleware para coletar mÃ©tricas HTTP automaticamente
app.use(httpMetricsMiddleware);

// SEGURANÃ‡A: Desabilitar X-Powered-By header (Express.js 2025 + OWASP API8)
app.disable('x-powered-by');

// SEGURANÃ‡A: Trust proxy = 1 para confiar apenas no primeiro proxy (Traefik)
// Evita bypass de rate limiting (express-rate-limit 2025 best practice)
app.set('trust proxy', 1);

// ============================================================================
// CIRCUIT BREAKER - Text Embeddings GPU (GPU Manager Service)
// Gate 2: Qwen3-Embedding-0.6B INT8 (1024 dim, SSOT) via GPU Manager Service â†’ Qdrant
// Usa CIRCUIT_BREAKER_PRESETS centralizado (Regra 2 - NÃ£o Duplicar)
// ============================================================================

// GPU Manager Service - Gerenciamento centralizado de requisiÃ§Ãµes GPU (25/12/2025)
// URL Ã© usada internamente pelo requestGpu, nÃ£o precisa ser exposta aqui

interface TextEmbeddingResponse {
  embedding: number[];
  model: string;
  processing_time_ms: number;
}

// RESILIÃŠNCIA: Timeout para chamadas externas (Best Practices 2025)
const EXTERNAL_API_TIMEOUT_MS = 25000;

async function generateEmbeddingInternal(text: string): Promise<number[]> {
  // Gate 2: Embeddings de texto via GPU Manager Service (dimensÃ£o SSOT = EMBEDDING_DIMENSIONS.TEXT)
  
  try {
    // Enfileirar requisiÃ§Ã£o no GPU Manager com prioridade MEDIUM (embeddings para fine-tuning)
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
      throw new Error('ServiÃ§o de embeddings GPU retornou resultado vazio');
    }
    
    // Validar dimensÃ£o (SSOT) - Enterprise-grade
    // LanÃ§a erro se dimensÃ£o estiver incorreta (nÃ£o apenas warning) - Regra 6
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

// Instrumentar circuit breaker com mÃ©tricas Prometheus
// Type assertion necessÃ¡ria: Opossum CircuitBreaker tem tipos de eventos mais especÃ­ficos
instrumentCircuitBreaker(metrics, 'gpu-manager-embeddings', gpuManagerEmbeddingsBreaker as unknown as Parameters<typeof instrumentCircuitBreaker>[2]);

async function generateEmbedding(text: string): Promise<number[]> {
  try {
    return await gpuManagerEmbeddingsBreaker.fire(text) as number[];
  } catch (error) {
    if (error instanceof Error && error.message.includes('Breaker is open')) {
      logger.warn('Circuit breaker aberto - Embeddings temporariamente indisponÃ­vel');
      throw new Error('ServiÃ§o de embeddings temporariamente indisponÃ­vel. Tente novamente em alguns segundos.');
    }
    throw error;
  }
}

// SEGURANÃ‡A: Helmet com CSP/HSTS enterprise (Express.js 2025 + OWASP 2023)
app.use(createSecurityMiddleware({
  contentSecurityPolicy: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV !== 'production',
}));

// OBSERVABILITY: Correlation ID middleware para rastreamento distribuÃ­do (Node.js 20 LTS 2025)
// Propaga correlation IDs entre microsserviÃ§os e injeta nos logs automaticamente
app.use(createCorrelationMiddleware({ serviceName: 'training-service' }));

// PERFORMANCE: Compression para reduzir tamanho de respostas (Express.js 2025)
app.use(compression());

app.use(cors({
  origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : false,
  credentials: CORS_ORIGINS.length > 0,
}));

// SEGURANÃ‡A: Rate limiting multi-tenant (express-rate-limit 2025)
app.use(createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  skipRoutes: ['/api/training/health', '/api/training/stats'],
  serviceName: 'training-service',
}));

// SEGURANÃ‡A: Limites de payload para prevenir DoS (OWASP API4)
// Captura do raw body para validaÃ§Ã£o criptogrÃ¡fica de webhooks.
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    (req as RequestWithRawBody).rawBody = Buffer.from(buf);
  },
}));

// =============================================================================
// MIDDLEWARE: Auth hÃ­brida (WS4) â€” SessÃ£o (cookie) + Bearer JWT OIDC (JWKS)
// =============================================================================
// SSOT: @alice/shared-utils/createSessionAuthMiddleware
// - Popular req.user / req.tenantId para RBAC (`requirePermission`)
// - Aceitar Bearer JWT (OIDC) quando o cookie nÃ£o estÃ¡ presente
// =============================================================================
app.use(createSessionAuthMiddleware({
  pool: getPool(),
  publicPaths: ['/api/training/health', '/live', '/ready', '/metrics'],
}));

const SIMILARITY_THRESHOLD = TRAINING_DATA_SIMILARITY_THRESHOLD;
// BUG FIX 26/12/2025: JOB_POLLING_INTERVAL_MS removido - fine-tuning em migraÃ§Ã£o para Hetzner GPU

type TrainingQualityAssessment = {
  score: number;
  rejectionReasons: string[];
};

function clampQualityScore(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function evaluateTrainingQuality(params: {
  sourceType: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  sourceMetadata?: Record<string, unknown>;
}): TrainingQualityAssessment {
  const reasons: string[] = [];
  const sourceMetadata = params.sourceMetadata ?? {};
  const messages = params.messages;

  if (messages.length < 2) {
    reasons.push('insufficient_message_count');
  }
  const hasUser = messages.some((msg) => msg.role === 'user');
  const hasAssistant = messages.some((msg) => msg.role === 'assistant');
  if (!hasUser) reasons.push('missing_user_message');
  if (!hasAssistant) reasons.push('missing_assistant_message');

  const normalizedContents = messages.map((msg) => msg.content.trim()).filter((content) => content.length > 0);
  const totalLength = normalizedContents.reduce((sum, content) => sum + content.length, 0);
  const avgLength = normalizedContents.length > 0 ? totalLength / normalizedContents.length : 0;

  if (totalLength < 120) {
    reasons.push('content_too_short');
  }
  if (avgLength < 30) {
    reasons.push('average_message_too_short');
  }

  const uniqueContent = new Set(normalizedContents.map((content) => content.toLowerCase()));
  if (normalizedContents.length > 0 && uniqueContent.size / normalizedContents.length < 0.5) {
    reasons.push('high_content_repetition');
  }

  const isTradingSource = params.sourceType.startsWith('trading_');
  if (isTradingSource) {
    const actionType = sourceMetadata.actionType;
    const timeframe = sourceMetadata.timeframe;
    if (typeof actionType !== 'string' || actionType.trim().length === 0) {
      reasons.push('missing_trading_action_type');
    }
    if (typeof timeframe !== 'string' || timeframe.trim().length === 0) {
      reasons.push('missing_trading_timeframe');
    }
  }

  if (params.sourceType === 'rag_document' || params.sourceType === 'rag_media') {
    reasons.push('knowledge_rag_default');
  }

  let score = 1;
  for (const reason of reasons) {
    if (reason === 'knowledge_rag_default') {
      score -= 0.1;
      continue;
    }
    if (reason.startsWith('missing_trading_')) {
      score -= 0.15;
      continue;
    }
    score -= 0.12;
  }
  if (params.sourceType === 'rag_document' || params.sourceType === 'rag_media') {
    score = Math.min(score, 0.55);
  }

  return {
    score: clampQualityScore(score),
    rejectionReasons: reasons,
  };
}

// ============================================================================
// TRADING AUTO ENGINE - Jobs automÃ¡ticos de portfÃ³lio e sinais IA
// ============================================================================

const tradingAutoPortfolioPayloadSchema = z.object({
  runId: z.string().uuid(),
  portfolioId: z.string().uuid(),
  marketType: z.enum(['spot', 'futures', 'margin']).optional(),
  constraints: z.record(z.unknown()).optional(),
  namespaceId: z.string().uuid().optional(),
  correlationId: z.string(),
});

const tradingAutoSignalAssetSchema = z.object({
  venue: z.string().min(1).max(32).transform((value) => value.trim().toLowerCase()),
  symbol: z.string().min(1).max(64).transform((value) => value.trim().toUpperCase()),
  marketType: z.enum(['spot', 'futures', 'margin']),
  marginMode: z.enum(['cross', 'isolated']).optional(),
}).superRefine((asset, ctx) => {
  if (asset.marginMode && asset.marketType !== 'margin') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'marginMode Ã© permitido apenas para marketType=margin.',
      path: ['marginMode'],
    });
  }
});

const tradingAutoSignalPayloadSchema = z.object({
  runId: z.string().uuid(),
  symbol: z.string().min(1).max(50).optional(),
  universeScope: z.enum(['spot', 'futures', 'margin', 'all']).optional(),
  marketType: z.enum(['spot', 'futures', 'margin']).optional(),
  allowedModes: z.array(TradingTechniqueSchema).optional(),
  autoMix: z.boolean().optional(),
  selectedAssets: z.array(tradingAutoSignalAssetSchema).max(2_000).optional(),
  selectAllAssets: z.boolean().optional().default(false),
  namespaceId: z.string().uuid().optional(),
  correlationId: z.string(),
});

const SIGNAL_AUTO_MARKET_TYPES = ['spot', 'futures', 'margin'] as const;
const SIGNAL_AUTO_OPERATION_INTENTS = [
  'scalping',
  'intraday',
  'swing',
  'positional',
  'arbitrage_internal',
  'arbitrage_cross_exchange',
  'cash_and_carry',
  'market_neutral',
  'volatility_breakout',
] as const;
type SignalAutoMarketType = (typeof SIGNAL_AUTO_MARKET_TYPES)[number];
type SignalAutoOperationIntent = (typeof SIGNAL_AUTO_OPERATION_INTENTS)[number];
type SignalAutoAsset = z.infer<typeof tradingAutoSignalAssetSchema>;

const SIGNAL_AUTO_MODE_TO_INTENTS: Record<TradingTechnique, SignalAutoOperationIntent[]> = {
  scalping: ['scalping'],
  day_trade: ['intraday'],
  swing: ['swing'],
  position: ['positional'],
  trend: ['intraday'],
  mean_reversion: ['market_neutral'],
  breakout: ['volatility_breakout'],
  range: ['market_neutral'],
  momentum: ['intraday', 'volatility_breakout'],
  arbitrage_triangular: ['arbitrage_internal', 'arbitrage_cross_exchange'],
  cash_and_carry: ['cash_and_carry'],
  basis_trade: ['cash_and_carry', 'arbitrage_internal'],
  funding_arbitrage: ['cash_and_carry'],
  grid_trading: ['market_neutral'],
  market_making: ['market_neutral'],
};

function resolveSignalAutoMarketTypes(payload: z.infer<typeof tradingAutoSignalPayloadSchema>): SignalAutoMarketType[] {
  if (payload.autoMix) return [...SIGNAL_AUTO_MARKET_TYPES];
  if (payload.universeScope === 'all') return [...SIGNAL_AUTO_MARKET_TYPES];
  if (payload.marketType) return [payload.marketType];
  if (payload.universeScope) return [payload.universeScope];
  return ['futures'];
}

function resolveSignalAutoAllowedOperationIntents(payload: z.infer<typeof tradingAutoSignalPayloadSchema>): SignalAutoOperationIntent[] {
  if (payload.autoMix) return [...SIGNAL_AUTO_OPERATION_INTENTS];
  const requestedModes = payload.allowedModes ?? [];
  if (requestedModes.length === 0) return [...SIGNAL_AUTO_OPERATION_INTENTS];

  const merged = new Set<SignalAutoOperationIntent>();
  for (const mode of requestedModes) {
    const mapped = SIGNAL_AUTO_MODE_TO_INTENTS[mode];
    if (!mapped) continue;
    for (const intent of mapped) merged.add(intent);
  }
  return merged.size > 0 ? Array.from(merged) : [...SIGNAL_AUTO_OPERATION_INTENTS];
}

function buildSignalAutoAssetKey(input: {
  venue: string;
  symbol: string;
  marketType: SignalAutoMarketType;
  marginMode?: 'cross' | 'isolated' | null;
}): string {
  const normalizedVenue = input.venue.trim().toLowerCase();
  const normalizedSymbol = input.symbol.trim().toUpperCase();
  const normalizedMargin = input.marketType === 'margin'
    ? (input.marginMode ?? 'cross')
    : 'none';
  return `${normalizedVenue}:${input.marketType}:${normalizedMargin}:${normalizedSymbol}`;
}

/** Atualiza status de um step no DB */
async function updateAutoRunStep(
  runId: string,
  stepName: string,
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped',
  extra: { error?: string; metrics?: Record<string, unknown> } = {},
): Promise<void> {
  const now = new Date();
  const updates: Record<string, unknown> = { status };
  if (status === 'running') updates.startedAt = now;
  if (status === 'succeeded' || status === 'failed' || status === 'skipped') updates.endedAt = now;
  if (extra.error) updates.error = extra.error;
  if (extra.metrics) updates.metrics = extra.metrics;

  await db.update(schema.tradingAutoRunSteps)
    .set(updates as Partial<typeof schema.tradingAutoRunSteps.$inferInsert>)
    .where(
      and(
        eq(schema.tradingAutoRunSteps.runId, runId),
        eq(schema.tradingAutoRunSteps.stepName, stepName as typeof schema.tradingAutoStepNameEnum.enumValues[number]),
      ),
    );
}

/** Processa pipeline automÃ¡tico de portfÃ³lio (universe â†’ backtest â†’ calibration â†’ model-risk â†’ rebalance) */
async function processPortfolioAutoRun(payload: z.infer<typeof tradingAutoPortfolioPayloadSchema>): Promise<void> {
  const { runId, correlationId } = payload;
  logger.info({ runId, correlationId }, 'Iniciando portfolio auto run');

  await db.update(schema.tradingAutoRuns)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(schema.tradingAutoRuns.id, runId));

  const steps = ['universe-scan', 'backtest', 'calibration', 'model-risk', 'rebalance'] as const;
  const stepMetrics: Record<string, Record<string, unknown>> = {};

  for (const stepName of steps) {
    try {
      await updateAutoRunStep(runId, stepName, 'running');
      const stepStart = Date.now();

      // Enfileira o step individual na fila existente do trading
      const queueMapping = {
        'universe-scan': tradingQueueNames.universe,
        'backtest': tradingQueueNames.backtest,
        'calibration': tradingQueueNames.calibration,
        'model-risk': tradingQueueNames.modelRisk,
        'rebalance': tradingQueueNames.rebalance,
      } as const;
      const targetQueue = queueMapping[stepName];
      if (targetQueue) {
        const idempotencyKey = buildTradingIdempotencyKey(targetQueue, { runId, stepName, correlationId });
        await enqueueTradingJob(targetQueue, {
          ...payload,
          idempotencyKey,
          autoRunId: runId,
          stepName,
        });
      }

      const stepDurationMs = Date.now() - stepStart;
      stepMetrics[stepName] = { durationMs: stepDurationMs, enqueuedAt: new Date().toISOString() };
      await updateAutoRunStep(runId, stepName, 'succeeded', { metrics: stepMetrics[stepName] });
      logger.info({ runId, stepName, correlationId, durationMs: stepDurationMs }, 'Auto run step enfileirado com sucesso');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      await updateAutoRunStep(runId, stepName, 'failed', { error: errorMessage });
      logger.error({ runId, stepName, correlationId, error: errorMessage }, 'Falha no auto run step');

      await db.update(schema.tradingAutoRuns)
        .set({ status: 'failed', error: `Falha no step ${stepName}: ${errorMessage}`, finishedAt: new Date() })
        .where(eq(schema.tradingAutoRuns.id, runId));
      return;
    }
  }

  // Criar decisÃ£o final do portfÃ³lio
  const run = await db.query.tradingAutoRuns.findFirst({
    where: eq(schema.tradingAutoRuns.id, runId),
  });
  if (!run) {
    logger.error({ runId, correlationId }, 'Run nÃ£o encontrado ao criar decisÃ£o final');
    return;
  }

  await db.insert(schema.tradingAutoDecisions).values({
    runId,
    tenantId: run.tenantId,
    decisionType: 'portfolio_auto',
    entryPayload: payload as Record<string, unknown>,
    guardrails: { steps: Object.keys(stepMetrics), completedAll: true },
    modelsUsed: ['trading-pipeline'],
    idempotencyHash: crypto.createHash('sha256').update(`portfolio-auto:${runId}:${correlationId}`).digest('hex'),
    approved: true,
    reasoning: `Pipeline institucional completo: ${steps.join(' â†’ ')}. Todos os steps enfileirados com sucesso.`,
  });

  await db.update(schema.tradingAutoRuns)
    .set({ status: 'succeeded', finishedAt: new Date() })
    .where(eq(schema.tradingAutoRuns.id, runId));

  logger.info({ runId, correlationId, steps: steps.length }, 'Portfolio auto run concluÃ­do com sucesso');
}

type AdaptiveThresholds = {
  minDsr: number;
  maxPbo: number;
  liquidityBucket: 'HIGH_LIQUIDITY' | 'LOW_LIQUIDITY';
  volatilityBucket: 'LOW_VOL' | 'HIGH_VOL';
  regimeBucket: 'TREND' | 'RANGE';
};

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferDurationMinutesFromTimeframe(timeframe: string): number {
  const normalized = timeframe.trim().toLowerCase();
  if (normalized.endsWith('m')) return Math.max(1, Number.parseInt(normalized, 10));
  if (normalized.endsWith('h')) return Math.max(1, Number.parseInt(normalized, 10)) * 60;
  if (normalized.endsWith('d')) return Math.max(1, Number.parseInt(normalized, 10)) * 60 * 24;
  return 60;
}

function resolveAdaptiveThresholds(candidate: typeof schema.tradingUniverseCandidates.$inferSelect): AdaptiveThresholds {
  const riskFlags = Array.isArray(candidate.riskFlags)
    ? candidate.riskFlags.map((flag) => String(flag))
    : [];
  const entryModel = (candidate.entryModel ?? {}) as Record<string, unknown>;
  const liquidityProxy = toFiniteNumber(entryModel.liquidityProxy);
  const lowLiquidityByDepth = riskFlags.includes('depth_drop');
  const lowLiquidityBySpread = riskFlags.includes('spread_widening');
  const isLowLiquidity = lowLiquidityByDepth || lowLiquidityBySpread || (liquidityProxy !== null && liquidityProxy < 0.45);

  const timeframeMinutes = inferDurationMinutesFromTimeframe(String(candidate.timeframe));
  const isHighVol = timeframeMinutes <= 5 || riskFlags.includes('high_volatility') || riskFlags.includes('volatility_spike');
  const isTrend = riskFlags.includes('trend_following') || riskFlags.includes('momentum_alignment');

  if (isLowLiquidity || isHighVol) {
    return {
      minDsr: 1.8,
      maxPbo: 0.45,
      liquidityBucket: 'LOW_LIQUIDITY',
      volatilityBucket: 'HIGH_VOL',
      regimeBucket: isTrend ? 'TREND' : 'RANGE',
    };
  }

  return {
    minDsr: 1.5,
    maxPbo: 0.55,
    liquidityBucket: 'HIGH_LIQUIDITY',
    volatilityBucket: 'LOW_VOL',
    regimeBucket: isTrend ? 'TREND' : 'RANGE',
  };
}

async function resolveAutoDecisionEvidenceIds(params: {
  tenantId: string;
  userId?: string;
  asof: Date;
  symbol?: string;
  marketType?: 'spot' | 'futures' | 'margin';
  operationIntent?: string;
  regime?: string;
  namespaceId?: string | null;
}): Promise<string[]> {
  const signalWhereConditions = [eq(schema.tradingSignals.tenantId, params.tenantId), lte(schema.tradingSignals.criadoEm, params.asof)];
  if (params.symbol) {
    signalWhereConditions.push(eq(schema.tradingSignals.symbol, params.symbol));
  }
  if (params.marketType) {
    signalWhereConditions.push(eq(schema.tradingSignals.marketType, params.marketType));
  }
  const [signals, postmortems] = await Promise.all([
    db.query.tradingSignals.findMany({
      where: and(...signalWhereConditions),
      columns: { id: true },
      orderBy: [desc(schema.tradingSignals.criadoEm)],
      limit: 4,
    }),
    db.query.tradingPostmortems.findMany({
      where: and(
        eq(schema.tradingPostmortems.tenantId, params.tenantId),
        lte(schema.tradingPostmortems.createdAt, params.asof),
      ),
      columns: { id: true },
      orderBy: [desc(schema.tradingPostmortems.createdAt)],
      limit: 3,
    }),
  ]);

  const dbEvidenceIds = [
    ...signals.map((row) => `signal:${row.id}`),
    ...postmortems.map((row) => `postmortem:${row.id}`),
  ];

  // Busca RAG por intent/regime quando disponÃ­vel (nÃ£o bloqueante â€” falha silenciosa)
  const ragEvidenceIds: string[] = [];
  if (params.namespaceId && params.operationIntent && params.userId) {
    try {
      const internalHeaders = generateInternalAuthHeaders({
        userId: params.userId,
        tenantId: params.tenantId,
        role: 'viewer',
      });
      const queryParts = [
        `EstratÃ©gia: ${params.operationIntent}`,
        params.regime ? `Regime: ${params.regime}` : null,
        params.symbol ? `Par: ${params.symbol}` : null,
        params.marketType ? `Mercado: ${params.marketType}` : null,
      ].filter(Boolean).join('. ');

      const ragResponse = await fetch(`${RAG_SERVICE_URL}/api/rag/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...internalHeaders },
        body: JSON.stringify({
          query: queryParts,
          namespaceId: params.namespaceId,
          limit: 3,
          minSimilarity: 0.6,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (ragResponse.ok) {
        const ragData = await ragResponse.json() as { data?: Array<{ id?: string }> };
        for (const doc of ragData.data ?? []) {
          if (doc.id) ragEvidenceIds.push(`rag:${doc.id}`);
        }
      }
    } catch {
      // RAG nÃ£o disponÃ­vel â€” continuar sem contexto (nÃ£o bloqueante)
      logger.debug({ tenantId: params.tenantId, operationIntent: params.operationIntent }, 'RAG intent/regime indisponÃ­vel (nÃ£o bloqueante)');
    }
  }

  return [...dbEvidenceIds, ...ragEvidenceIds];
}

async function autoValidateCandidateIfNeeded(params: {
  run: typeof schema.tradingAutoRuns.$inferSelect;
  payload: z.infer<typeof tradingAutoSignalPayloadSchema>;
  candidate: typeof schema.tradingUniverseCandidates.$inferSelect;
}): Promise<{
  candidate: typeof schema.tradingUniverseCandidates.$inferSelect;
  validationTriggered: boolean;
  dsr: number | null;
  pbo: number | null;
}> {
  const candidateDsr = toFiniteNumber(params.candidate.dsrScore);
  const candidatePbo = toFiniteNumber(params.candidate.pboScore);
  if (candidateDsr !== null && candidatePbo !== null) {
    return { candidate: params.candidate, validationTriggered: false, dsr: candidateDsr, pbo: candidatePbo };
  }

  const asofTimestamp = params.run.createdAt?.toISOString() ?? new Date().toISOString();
  const lookback = 180;
  const operationIntent = params.candidate.operationIntent ?? 'intraday';
  const backtest = await runBacktestWorker({
    tenantId: params.run.tenantId,
    namespaceId: params.payload.namespaceId ?? params.run.namespaceId ?? undefined,
    instrumentId: params.candidate.instrumentId,
    marketType: params.candidate.marketType,
    strategyKey: params.candidate.strategyKey,
    strategyVersion: params.candidate.strategyVersion,
    operationIntent,
    timeframe: params.candidate.timeframe,
    lookback,
    asofTimestamp,
  });
  await db.update(schema.tradingUniverseCandidates)
    .set({
      dsrScore: String(backtest.dsr),
      pboScore: String(backtest.pbo),
    })
    .where(eq(schema.tradingUniverseCandidates.id, params.candidate.id));

  await runCalibrationWorker({
    tenantId: params.run.tenantId,
    namespaceId: params.payload.namespaceId ?? params.run.namespaceId ?? undefined,
    instrumentId: params.candidate.instrumentId,
    marketType: params.candidate.marketType,
    strategyKey: params.candidate.strategyKey,
    strategyVersion: params.candidate.strategyVersion,
    operationIntent,
    timeframe: params.candidate.timeframe,
    lookback,
    asofTimestamp,
  });

  const refreshed = await db.query.tradingUniverseCandidates.findFirst({
    where: eq(schema.tradingUniverseCandidates.id, params.candidate.id),
  });
  return {
    candidate: refreshed ?? params.candidate,
    validationTriggered: true,
    dsr: backtest.dsr,
    pbo: backtest.pbo,
  };
}

async function findAutoRunSignal(params: { tenantId: string; runId: string }) {
  return withTenantContext(params.tenantId, false, async (tenantDb) => {
    const rows = await tenantDb.execute(sql<{ id: string }>`
      SELECT id
      FROM trading_signals
      WHERE tenant_id = ${params.tenantId}
        AND metadata ->> 'autoRunId' = ${params.runId}
      ORDER BY criado_em DESC
      LIMIT 1
    `);
    return rows.rows[0] ?? null;
  });
}

async function persistNoTradeAutoSignal(params: {
  run: typeof schema.tradingAutoRuns.$inferSelect;
  runId: string;
  decisionId: string;
  symbol: string;
  marketType: 'spot' | 'futures' | 'margin';
  reasonCode: string;
  reasonHuman: string;
  correlationId: string;
}): Promise<void> {
  const existing = await findAutoRunSignal({ tenantId: params.run.tenantId, runId: params.runId });
  if (existing) return;

  await withTenantContext(params.run.tenantId, false, async (tenantDb) => {
    await tenantDb.insert(schema.tradingSignals).values({
      tenantId: params.run.tenantId,
      signalType: 'hold',
      symbol: params.symbol,
      marketType: params.marketType,
      confidence: 0,
      metadata: {
        generationSource: 'auto',
        operationType: 'neutral',
        tradeSummary: 'Signal auto concluiu sem entrada (hold).',
        reasoning: params.reasonHuman,
        validationStatus: 'validated',
        approvalStatus: 'approved',
        createdByUserId: params.run.userId ?? undefined,
        autoRunId: params.runId,
        autoDecisionId: params.decisionId,
        correlationId: params.correlationId,
        noTradeReasonCode: params.reasonCode,
      } as schema.TradingSignalMetadata,
    });
  });
}

async function generateAndTagAutoSignal(params: {
  run: typeof schema.tradingAutoRuns.$inferSelect;
  runId: string;
  decisionId: string;
  symbol: string;
  interval: string;
  marketType: 'spot' | 'futures' | 'margin';
  correlationId: string;
}): Promise<void> {
  const existing = await findAutoRunSignal({ tenantId: params.run.tenantId, runId: params.runId });
  if (existing) return;

  const internalHeaders = generateInternalAuthHeaders({
    userId: params.run.userId,
    tenantId: params.run.tenantId,
    role: 'admin',
  });

  const response = await fetch(`${INTEGRATIONS_SERVICE_URL_FINAL}/api/integrations/trading/signals/generate`, {
    method: 'POST',
    headers: {
      ...internalHeaders,
      'Content-Type': 'application/json',
      'x-correlation-id': params.correlationId,
    },
    body: JSON.stringify({
      symbol: params.symbol,
      interval: params.interval,
      marketType: params.marketType,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Falha ao gerar sinal auto via integrations (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const body = await response.json() as { data?: { id?: string } };
  const signalId = body.data?.id;
  if (!signalId) {
    throw new Error('Integrations retornou sucesso sem signal id para signal_auto');
  }

  const updatedSignal = await withTenantContext(params.run.tenantId, false, async (tenantDb) => {
    const [updated] = await tenantDb.update(schema.tradingSignals)
      .set({
        metadata: sql`
          coalesce(${schema.tradingSignals.metadata}, '{}'::jsonb)
          || ${JSON.stringify({
            generationSource: 'auto',
            autoRunId: params.runId,
            autoDecisionId: params.decisionId,
            correlationId: params.correlationId,
          })}::jsonb
        `,
      })
      .where(and(
        eq(schema.tradingSignals.id, signalId),
        eq(schema.tradingSignals.tenantId, params.run.tenantId),
      ))
      .returning({ id: schema.tradingSignals.id });

    return updated ?? null;
  });

  if (!updatedSignal) {
    throw new Error(`Sinal ${signalId} nÃ£o encontrado para marcar metadata de signal_auto`);
  }
}

/** Processa geraÃ§Ã£o automÃ¡tica de sinais */
async function processSignalAutoRun(payload: z.infer<typeof tradingAutoSignalPayloadSchema>): Promise<void> {
  const { runId, correlationId } = payload;
  logger.info({ runId, correlationId }, 'Iniciando signal auto run');

  await db.update(schema.tradingAutoRuns)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(schema.tradingAutoRuns.id, runId));

  try {
    await updateAutoRunStep(runId, 'signal-decision', 'running');

    const run = await db.query.tradingAutoRuns.findFirst({
      where: eq(schema.tradingAutoRuns.id, runId),
    });
    if (!run) throw new Error('Run nÃ£o encontrado');

    const normalizedPayloadSymbol = typeof payload.symbol === 'string'
      ? payload.symbol.trim().toUpperCase()
      : null;
    const marketTypes = resolveSignalAutoMarketTypes(payload);
    const allowedOperationIntents = resolveSignalAutoAllowedOperationIntents(payload);
    const allowedIntentSet = new Set(allowedOperationIntents);
    const selectAllAssets = Boolean(payload.autoMix || payload.selectAllAssets);
    const selectedAssets = (payload.selectedAssets ?? []).map((asset) => ({
      venue: asset.venue.trim().toLowerCase(),
      symbol: asset.symbol.trim().toUpperCase(),
      marketType: asset.marketType,
      marginMode: asset.marginMode,
    })) as SignalAutoAsset[];
    const selectedAssetKeySet = new Set(
      selectedAssets.map((asset) => buildSignalAutoAssetKey({
        venue: asset.venue,
        symbol: asset.symbol,
        marketType: asset.marketType,
        marginMode: asset.marginMode ?? null,
      })),
    );
    const candidateFetchLimit = payload.autoMix
      ? TRADING_SIGNAL_AUTO_AUTOMIX_CANDIDATE_FETCH_LIMIT
      : TRADING_SIGNAL_AUTO_CANDIDATE_FETCH_LIMIT;

    const candidateFilters = [
      eq(schema.tradingUniverseCandidates.tenantId, run.tenantId),
      inArray(schema.tradingUniverseCandidates.marketType, marketTypes),
    ];
    const rawCandidates = await db.query.tradingUniverseCandidates.findMany({
      where: and(...candidateFilters),
      orderBy: [desc(schema.tradingUniverseCandidates.createdAt)],
      limit: candidateFetchLimit,
    });

    const instrumentIds = Array.from(new Set(rawCandidates.map((candidate) => candidate.instrumentId)));
    const instruments = instrumentIds.length > 0
      ? await db.query.tradingInstruments.findMany({
        where: and(
          eq(schema.tradingInstruments.tenantId, run.tenantId),
          inArray(schema.tradingInstruments.id, instrumentIds),
        ),
        columns: { id: true, venue: true, symbol: true },
      })
      : [];
    const instrumentById = new Map(instruments.map((instrument) => [instrument.id, instrument]));

    const candidatesBeforeAssetFilter = rawCandidates.length;
    let candidates = rawCandidates;
    if (!selectAllAssets) {
      if (selectedAssetKeySet.size > 0) {
        candidates = candidates.filter((candidate) => {
          const instrument = instrumentById.get(candidate.instrumentId);
          if (!instrument) return false;
          const exactKey = buildSignalAutoAssetKey({
            venue: instrument.venue,
            symbol: instrument.symbol,
            marketType: candidate.marketType as SignalAutoMarketType,
            marginMode: candidate.marginMode ?? null,
          });
          if (selectedAssetKeySet.has(exactKey)) return true;
          if (candidate.marketType === 'margin') {
            const genericMarginKey = buildSignalAutoAssetKey({
              venue: instrument.venue,
              symbol: instrument.symbol,
              marketType: 'margin',
              marginMode: null,
            });
            return selectedAssetKeySet.has(genericMarginKey);
          }
          return false;
        });
      } else if (normalizedPayloadSymbol) {
        candidates = candidates.filter((candidate) => {
          const instrument = instrumentById.get(candidate.instrumentId);
          return instrument?.symbol === normalizedPayloadSymbol;
        });
      }
    }
    const candidatesAfterAssetFilter = candidates.length;
    const candidatesBeforeIntentFilter = candidates.length;
    if (allowedIntentSet.size < SIGNAL_AUTO_OPERATION_INTENTS.length) {
      candidates = candidates.filter((candidate) => allowedIntentSet.has(candidate.operationIntent as SignalAutoOperationIntent));
    }
    const candidatesAfterIntentFilter = candidates.length;

    const validationTarget = candidates.find((candidate) => (
      toFiniteNumber(candidate.dsrScore) === null || toFiniteNumber(candidate.pboScore) === null
    ));
    let validationTriggered = false;
    let validatedCandidateId: string | null = null;
    let validatedDsr: number | null = null;
    let validatedPbo: number | null = null;
    if (validationTarget) {
      const validationResult = await autoValidateCandidateIfNeeded({ run, payload, candidate: validationTarget });
      validationTriggered = validationResult.validationTriggered;
      validatedCandidateId = validationResult.candidate.id;
      validatedDsr = validationResult.dsr;
      validatedPbo = validationResult.pbo;
      if (validationResult.validationTriggered) {
        const index = candidates.findIndex((candidate) => candidate.id === validationResult.candidate.id);
        if (index >= 0) {
          candidates[index] = validationResult.candidate;
        }
      }
    }

    const guardrailResults: Record<string, unknown> = {
      totalCandidates: candidates.length,
      filteredByDSR: 0,
      filteredByPBO: 0,
      filteredByLiquidity: 0,
      unvalidated: 0,
      approved: 0,
      thresholdsApplied: [] as Array<{
        candidateId: string;
        minDsr: number;
        maxPbo: number;
        liquidityBucket: string;
        volatilityBucket: string;
        regimeBucket: string;
      }>,
    };

    const approvedCandidates = candidates.filter((candidate) => {
      const thresholds = resolveAdaptiveThresholds(candidate);
      (guardrailResults.thresholdsApplied as Array<Record<string, unknown>>).push({
        candidateId: candidate.id,
        minDsr: thresholds.minDsr,
        maxPbo: thresholds.maxPbo,
        liquidityBucket: thresholds.liquidityBucket,
        volatilityBucket: thresholds.volatilityBucket,
        regimeBucket: thresholds.regimeBucket,
      });

      const dsr = toFiniteNumber(candidate.dsrScore);
      const pbo = toFiniteNumber(candidate.pboScore);
      if (dsr === null || pbo === null) {
        guardrailResults.unvalidated = (guardrailResults.unvalidated as number) + 1;
        return false;
      }
      if (dsr < thresholds.minDsr) {
        guardrailResults.filteredByDSR = (guardrailResults.filteredByDSR as number) + 1;
        return false;
      }
      if (pbo > thresholds.maxPbo) {
        guardrailResults.filteredByPBO = (guardrailResults.filteredByPBO as number) + 1;
        return false;
      }
      const riskFlags = Array.isArray(candidate.riskFlags)
        ? candidate.riskFlags.map((flag) => String(flag))
        : [];
      if (riskFlags.includes('spread_widening') || riskFlags.includes('depth_drop')) {
        guardrailResults.filteredByLiquidity = (guardrailResults.filteredByLiquidity as number) + 1;
        return false;
      }
      return true;
    });
    guardrailResults.approved = approvedCandidates.length;

    const candidateIds = approvedCandidates.map((c) => c.id);
    const bestCandidate = approvedCandidates[0];
    const candidateForReason = bestCandidate ?? candidates[0];
    const thresholdsUsed = candidateForReason ? resolveAdaptiveThresholds(candidateForReason) : null;
    const timeframe = String(candidateForReason?.timeframe ?? '5m');
    const durationMinutes = inferDurationMinutesFromTimeframe(timeframe);
    const entryModel = (candidateForReason?.entryModel ?? {}) as Record<string, unknown>;
    const entry = toFiniteNumber(entryModel.entry);
    const stop = toFiniteNumber(entryModel.stop);
    const takeProfit = toFiniteNumber(entryModel.takeProfit);
    const riskReward = entry !== null && stop !== null && takeProfit !== null && Math.abs(entry - stop) > 0
      ? Math.abs((takeProfit - entry) / (entry - stop))
      : null;

    const instrumentSymbol = candidateForReason
      ? await db.query.tradingInstruments.findFirst({
        where: eq(schema.tradingInstruments.id, candidateForReason.instrumentId),
        columns: { symbol: true },
      })
      : null;
    const selectedAssetSymbol = selectedAssets[0]?.symbol ?? null;
    const symbol = normalizedPayloadSymbol ?? instrumentSymbol?.symbol ?? selectedAssetSymbol ?? null;
    const ragEvidenceIds = await resolveAutoDecisionEvidenceIds({
      tenantId: run.tenantId,
      userId: run.userId,
      asof: run.createdAt ?? new Date(),
      symbol: symbol ?? undefined,
      marketType: payload.marketType ?? candidateForReason?.marketType,
      operationIntent: candidateForReason?.operationIntent ?? undefined,
      regime: thresholdsUsed?.regimeBucket ?? 'unknown',
      namespaceId: run.namespaceId ?? null,
    });

    const noTradeReasons: string[] = [];
    if (candidates.length === 0) noTradeReasons.push('NO_CANDIDATES');
    if ((guardrailResults.unvalidated as number) > 0 && approvedCandidates.length === 0) noTradeReasons.push('UNVALIDATED');
    if ((guardrailResults.filteredByLiquidity as number) > 0) noTradeReasons.push('LIQUIDITY_CONSTRAINT');
    if ((guardrailResults.filteredByDSR as number) > 0 || (guardrailResults.filteredByPBO as number) > 0) noTradeReasons.push('GUARDRAIL_BLOCKED');
    if (noTradeReasons.length === 0 && approvedCandidates.length === 0) noTradeReasons.push('NO_EDGE');
    const reasonPriority = ['UNVALIDATED', 'LIQUIDITY_CONSTRAINT', 'GUARDRAIL_BLOCKED', 'NO_CANDIDATES', 'NO_EDGE'];
    const noTradeReasonCode = reasonPriority.find((reason) => noTradeReasons.includes(reason)) ?? 'NO_EDGE';
    const noTradeReasonHumanMap: Record<string, string> = {
      UNVALIDATED: 'Candidato ainda sem validaÃ§Ã£o estatÃ­stica mÃ­nima (DSR/PBO).',
      LIQUIDITY_CONSTRAINT: 'Sem liquidez mÃ­nima: spread alargado ou profundidade insuficiente.',
      GUARDRAIL_BLOCKED: 'Guardrails bloquearam o trade por DSR/PBO fora da faixa.',
      NO_CANDIDATES: 'Nenhum candidato disponÃ­vel para o escopo atual.',
      NO_EDGE: 'Edge lÃ­quido insuficiente para execuÃ§Ã£o segura.',
    };
    const nextActionMap: Record<string, string> = {
      UNVALIDATED: 'Rodar pipeline de backtest+calibration e aguardar prÃ³xima janela de mercado.',
      LIQUIDITY_CONSTRAINT: 'Aguardar melhora de liquidez (spread/depth) e tentar novamente.',
      NO_CANDIDATES: 'Executar universe scan para ampliar o conjunto de candidates.',
      GUARDRAIL_BLOCKED: 'Revisar thresholds e aguardar novas condiÃ§Ãµes de regime.',
      NO_EDGE: 'Revisar thresholds e aguardar novas condiÃ§Ãµes de regime.',
    };
    const noTradeReasonHuman = noTradeReasonHumanMap[noTradeReasonCode] ?? noTradeReasonHumanMap.NO_EDGE;
    const nextAction = nextActionMap[noTradeReasonCode] ?? nextActionMap.NO_EDGE;
    const idempotencyHash = crypto.createHash('sha256').update(`signal-auto:${runId}:${correlationId}`).digest('hex');

    const [decision] = await db.insert(schema.tradingAutoDecisions).values({
      runId,
      tenantId: run.tenantId,
      decisionType: 'signal_auto' as const,
      entryPayload: {
        operationIntent: 'auto',
        symbol,
        marketType: payload.marketType ?? candidateForReason?.marketType ?? null,
        side: bestCandidate?.side ?? 'hold',
        timeframe,
        horizon: `${durationMinutes}m`,
        durationMinutes,
        entry,
        stop,
        takeProfit,
        invalidationConditions: Array.isArray(candidateForReason?.riskFlags) ? candidateForReason.riskFlags : [],
        riskReward,
        confidenceRaw: toFiniteNumber(candidateForReason?.confidenceRaw),
        confidenceCalibrated: toFiniteNumber(candidateForReason?.confidenceCalibrated ?? candidateForReason?.confidenceRaw),
        edgeNet: toFiniteNumber(candidateForReason?.expectedEdge),
        costs: { estimationMode: 'candidate_expected_edge_net' },
        noTradeReasonCode: bestCandidate ? null : noTradeReasonCode,
        noTradeReasons: bestCandidate ? [] : noTradeReasons,
        noTradeReasonHuman: bestCandidate ? null : noTradeReasonHuman,
        nextAction: bestCandidate ? null : nextAction,
        autoMix: payload.autoMix ?? true,
        allowedModes: payload.allowedModes ?? [],
        thresholdsUsed: thresholdsUsed
          ? {
            minDsr: thresholdsUsed.minDsr,
            maxPbo: thresholdsUsed.maxPbo,
            liquidityBucket: thresholdsUsed.liquidityBucket,
            volatilityBucket: thresholdsUsed.volatilityBucket,
            regimeBucket: thresholdsUsed.regimeBucket,
          }
          : null,
      },
      guardrails: guardrailResults,
      candidateIds,
      modelsUsed: ['trading-guardrails'],
      ragEvidenceIds,
      idempotencyHash,
      approved: approvedCandidates.length > 0,
      reasoning: approvedCandidates.length > 0
        ? `${approvedCandidates.length} candidate(s) aprovado(s) apÃ³s guardrails adaptativos. Melhor: ${bestCandidate?.strategyKey ?? 'N/A'} (${bestCandidate?.operationIntent ?? 'intraday'}).`
        : `${noTradeReasonHuman} Total avaliados: ${candidates.length}.`,
    }).returning({ id: schema.tradingAutoDecisions.id, tradingSignalId: schema.tradingAutoDecisions.tradingSignalId });

    const fallbackInstrument = await db.query.tradingInstruments.findFirst({
      where: and(
        eq(schema.tradingInstruments.tenantId, run.tenantId),
        eq(schema.tradingInstruments.isActive, true),
      ),
      orderBy: [desc(schema.tradingInstruments.createdAt)],
      columns: { symbol: true },
    });
    const resolvedSymbol = symbol ?? fallbackInstrument?.symbol;
    if (!resolvedSymbol) {
      throw new Error('Signal auto run sem sÃ­mbolo disponÃ­vel para persistÃªncia de histÃ³rico');
    }

    const resolvedMarketType = payload.marketType ?? candidateForReason?.marketType ?? 'futures';
    if (approvedCandidates.length > 0 && decision?.id) {
      await generateAndTagAutoSignal({
        run,
        runId,
        decisionId: decision.id,
        symbol: resolvedSymbol,
        interval: timeframe,
        marketType: resolvedMarketType,
        correlationId,
      });
    } else if (decision?.id) {
      await persistNoTradeAutoSignal({
        run,
        runId,
        decisionId: decision.id,
        symbol: resolvedSymbol,
        marketType: resolvedMarketType,
        reasonCode: noTradeReasonCode,
        reasonHuman: noTradeReasonHuman,
        correlationId,
      });
    }

    await updateAutoRunStep(runId, 'signal-decision', 'succeeded', {
      metrics: {
        candidatesEvaluated: candidates.length,
        candidatesBeforeAssetFilter,
        candidatesAfterAssetFilter,
        candidatesBeforeIntentFilter,
        candidatesAfterIntentFilter,
        approved: approvedCandidates.length,
        validationTriggered,
        validatedCandidateId,
        validatedDsr,
        validatedPbo,
        marketTypes,
        selectAllAssets,
        selectedAssets: selectAllAssets ? 'all' : selectedAssets.length,
        allowedModes: payload.autoMix ? 'auto_mix_all' : (payload.allowedModes ?? []),
        allowedOperationIntents,
        fetchLimit: candidateFetchLimit,
      },
    });

    if (approvedCandidates.length === 0) {
      await updateAutoRunStep(runId, 'signal-llm', 'skipped', {
        metrics: {
          noTrade: true,
          reasonCode: noTradeReasonCode,
        },
      });
      await updateAutoRunStep(runId, 'signal-persist', 'running');
      await updateAutoRunStep(runId, 'signal-persist', 'succeeded', {
        metrics: {
          noTrade: true,
          reasonCode: noTradeReasonCode,
        },
      });
      await db.update(schema.tradingAutoRuns)
        .set({ status: 'succeeded', error: null, finishedAt: new Date() })
        .where(eq(schema.tradingAutoRuns.id, runId));
      logger.info(
        { runId, correlationId, candidates: candidates.length, approved: approvedCandidates.length, noTradeReasonCode },
        'Signal auto run concluido com no-trade (sucesso operacional)',
      );
      return;
    }

    await updateAutoRunStep(runId, 'signal-llm', 'running');
    const llmStepTimer = tradingMetrics.signalAutoLlmStepSeconds.startTimer();
    const namespaceId = run.namespaceId ?? payload.namespaceId ?? null;
    const trainingNamespaceId = namespaceId;
    if (!trainingNamespaceId) {
      throw new Error('TRADING_SCOPE_REQUIRED: Namespace Trading obrigatÃ³rio para Auto Engine.');
    }
    const tradingDatasetEligibilityConditions = tradingDataGovernancePolicy.requireStrictApprovedDataForAutoEngine
      ? buildTradingDataEligibilityConditions({
          tenantId: run.tenantId,
          namespaceId: trainingNamespaceId,
          policy: tradingDataGovernancePolicy,
        })
      : [
          eq(schema.trainingData.tenantId, run.tenantId),
          eq(schema.trainingData.namespaceId, trainingNamespaceId),
          eq(schema.trainingData.status, 'approved'),
        ];
    const [trainingSummary] = await db
      .select({
        count: sql<number>`count(*)`,
        maxConfidence: sql<number>`COALESCE(MAX(${schema.trainingData.inferenceConfidence}), 0)`,
      })
      .from(schema.trainingData)
      .where(and(...tradingDatasetEligibilityConditions));
    trainingPipelineMetrics.scopeConfidenceHistogram.observe(Number(trainingSummary?.maxConfidence ?? 0));
    if (Number(trainingSummary?.count ?? 0) <= 0) {
      if (tradingDataGovernancePolicy.requireStrictApprovedDataForAutoEngine) {
        trainingPipelineMetrics.failClosedBlockTotal.inc({
          reason: 'trading_scope_missing_strict_eligible_data',
        });
        throw new Error(
          `TRADING_SCOPE_REQUIRED: Auto Engine exige dataset Trading aprovado, sem quarentena e elegivel por politica (min_confidence=${tradingDataGovernancePolicy.minInferenceConfidence.toFixed(2)}).`
        );
      }
      throw new Error('TRADING_SCOPE_REQUIRED: Approved Trading dataset is required for Auto Engine.');
    }
    const activeAdapter = await getActiveAdapter({ tenantId: run.tenantId, namespaceId: trainingNamespaceId });
    if (!activeAdapter?.adapterPath) {
      throw new Error('TRADING_SCOPE_REQUIRED: Adapter LoRA ativo obrigatÃ³rio para Auto Engine.');
    }

    const llmPrompt = [
      'VocÃª Ã© um engine institucional de trading.',
      `Candidate side: ${String(bestCandidate?.side ?? 'hold')}`,
      `Entry model base: ${JSON.stringify(entryModel)}`,
      `Guardrails: ${JSON.stringify(guardrailResults)}`,
      `No trade reason code: ${noTradeReasonCode}`,
      `Evidence IDs: ${JSON.stringify(ragEvidenceIds)}`,
      'Regra obrigatÃ³ria: nÃ£o invente preÃ§o. Use entryModel.entry e ajuste no mÃ¡ximo 0.3%.',
      'Responda no JSON schema solicitado.',
    ].join('\n');

    const messages = [
      { role: 'system' as const, content: 'VocÃª gera plano de trade estruturado para Auto Engine.' },
      { role: 'user' as const, content: llmPrompt },
    ];

    const configuredModel = process.env.TRADING_LLM_MODEL?.trim() || 'Qwen2.5-7B-Instruct-AWQ';
    const loraModel = activeAdapter.adapterPath ? `${configuredModel}::${activeAdapter.adapterPath}` : configuredModel;
    let llmRawContent = '';
    if (isGatewayConfigured()) {
      const gatewayResult = await callGatewayComplete({
        messages,
        config: {
          model: loraModel,
          temperature: 0.2,
          maxTokens: 1200,
        },
        context: {
          route: '/trading/auto/signal',
          tenantId: run.tenantId,
          userId: run.userId,
          namespaceId: trainingNamespaceId,
        },
        extraBody: {
          response_format: {
            type: 'json_schema',
            json_schema: TRADING_LLM_SIGNAL_JSON_SCHEMA,
          },
        },
        requestOptions: { timeout: 120000, priority: 'high' },
      });
      if (!gatewayResult.success || !gatewayResult.data) {
        tradingMetrics.signalAutoLlmFailuresTotal.inc();
        throw new Error(gatewayResult.error || 'Falha no llm-gateway-service');
      }
      const gatewayData = gatewayResult.data as { choices?: Array<{ message?: { content?: string } }> };
      llmRawContent = String(gatewayData.choices?.[0]?.message?.content ?? '');
      logger.info({ runId, decisionId: decision.id, model: loraModel, via: 'gateway', correlationId }, 'Signal Auto LLM executado');
    } else {
      const gpuResult = await requestGpu({
        serviceType: GpuServiceType.LLM,
        endpoint: '/v1/chat/completions',
        method: 'POST',
        priority: GpuRequestPriority.HIGH,
        timeout: 120000,
        body: {
          model: loraModel,
          messages,
          response_format: { type: 'json_schema', json_schema: TRADING_LLM_SIGNAL_JSON_SCHEMA },
          max_tokens: 1200,
          temperature: 0.2,
          stream: false,
        },
      });
      if (!gpuResult.success || !gpuResult.data) {
        tradingMetrics.signalAutoLlmFailuresTotal.inc();
        throw new Error(gpuResult.error || 'Falha no gpu-manager LLM');
      }
      const gpuData = gpuResult.data as { choices?: Array<{ message?: { content?: string } }> };
      llmRawContent = String(gpuData.choices?.[0]?.message?.content ?? '');
      logger.info({ runId, decisionId: decision.id, model: loraModel, via: 'gpu-direct', correlationId }, 'Signal Auto LLM executado');
    }

    const llmPayload = TRADING_LLM_SIGNAL_PARTIAL_SCHEMA.parse(parseStructuredJsonFromContent(llmRawContent));
    const autoSignalDraft = llmPayload;
    llmStepTimer();
    await updateAutoRunStep(runId, 'signal-llm', 'succeeded', {
      metrics: {
        signalType: autoSignalDraft.signalType,
        confidence: autoSignalDraft.confidence,
        model: loraModel,
      },
    });

    await updateAutoRunStep(runId, 'signal-persist', 'running');
    if (decision.tradingSignalId) {
      await updateAutoRunStep(runId, 'signal-persist', 'succeeded', {
        metrics: { tradingSignalId: decision.tradingSignalId, deduplicated: true },
      });
    } else {
      const signalMetadata: TradingSignalMetadata = {
        confidence: autoSignalDraft.confidence,
        reasoning: autoSignalDraft.reasoning,
        operationType: (autoSignalDraft.operationType as TradingSignalMetadata['operationType']) ?? 'neutral',
        expectedDurationMinutes: autoSignalDraft.expectedDurationMinutes ?? durationMinutes,
        expectedDurationLabel: `${durationMinutes}m`,
        entryPrice: autoSignalDraft.suggestedPrice ?? undefined,
        stopLoss: autoSignalDraft.suggestedStopLoss ?? undefined,
        takeProfit: autoSignalDraft.suggestedTakeProfit ?? undefined,
        riskReward: riskReward ?? undefined,
        motivators: autoSignalDraft.motivators ?? [],
        invalidationReasons: autoSignalDraft.invalidationReasons ?? [],
        marketCondition: autoSignalDraft.marketCondition,
        riskScore: autoSignalDraft.riskScore,
        tradeSummary: autoSignalDraft.tradeSummary ?? autoSignalDraft.reasoning,
        generationSource: 'scheduler',
        autoRunId: runId,
        autoDecisionId: decision.id,
        autoEngine: true,
        modelsUsed: ['trading-guardrails', loraModel],
        ragEvidenceIds,
        createdByUserId: run.userId,
      };

      const signalValues: typeof schema.tradingSignals.$inferInsert = {
        tenantId: run.tenantId,
        signalType: autoSignalDraft.signalType ?? 'hold',
        marketType: (payload.marketType ?? candidateForReason?.marketType ?? 'futures') as 'spot' | 'futures' | 'margin',
        symbol: symbol ?? 'BTC-USDT',
        suggestedPrice: autoSignalDraft.suggestedPrice,
        suggestedStopLoss: autoSignalDraft.suggestedStopLoss,
        suggestedTakeProfit: autoSignalDraft.suggestedTakeProfit,
        suggestedSize: autoSignalDraft.suggestedSize,
        confidence: autoSignalDraft.confidence,
        metadata: signalMetadata,
        isActive: true,
      };
      const [createdSignal] = await db.insert(schema.tradingSignals).values(signalValues).returning();
      if (!createdSignal) {
        throw new Error('Falha ao persistir trading_signal do auto engine');
      }
      await db.update(schema.tradingAutoDecisions)
        .set({
          tradingSignalId: createdSignal.id,
          modelsUsed: ['trading-guardrails', loraModel],
        })
        .where(eq(schema.tradingAutoDecisions.id, decision.id));
      await updateAutoRunStep(runId, 'signal-persist', 'succeeded', {
        metrics: { tradingSignalId: createdSignal.id },
      });
      logger.info({ runId, decisionId: decision.id, signalId: createdSignal.id, correlationId }, 'Signal Auto persistido em trading_signals');
    }

    await db.update(schema.tradingAutoRuns)
      .set({ status: 'succeeded', finishedAt: new Date() })
      .where(eq(schema.tradingAutoRuns.id, runId));

    logger.info({ runId, correlationId, candidates: candidates.length, approved: approvedCandidates.length }, 'Signal auto run concluÃ­do');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    const currentSteps = await db.query.tradingAutoRunSteps.findMany({
      where: eq(schema.tradingAutoRunSteps.runId, runId),
      columns: { stepName: true, status: true },
    });
    const terminalStatuses = new Set(['succeeded', 'skipped']);
    const statusByStep = new Map(currentSteps.map((step) => [step.stepName, step.status]));
    for (const stepName of ['signal-decision', 'signal-llm', 'signal-persist'] as const) {
      const currentStatus = statusByStep.get(stepName);
      if (!terminalStatuses.has(String(currentStatus))) {
        await updateAutoRunStep(runId, stepName, 'failed', { error: errorMessage });
      }
    }
    await db.update(schema.tradingAutoRuns)
      .set({ status: 'failed', error: errorMessage, finishedAt: new Date() })
      .where(eq(schema.tradingAutoRuns.id, runId));
    logger.error({ runId, correlationId, error: errorMessage }, 'Falha no signal auto run');
  }
}

const trainingGovernanceAuditService = createTrainingGovernanceAuditService({
  incrementHighRiskAuditEventMetric: ({ action, result }) => {
    trainingPipelineMetrics.highRiskAuditEventsTotal.inc({
      service: 'training-service',
      event_type: action,
      result,
    });
  },
});

const trainingRunStartIdempotencyService = createTrainingRunStartIdempotencyService({
  logger,
  runStartIdempotencyTtlSeconds: TRAINING_RUN_START_IDEMPOTENCY_TTL_SECONDS,
  incrementRunStartIdempotencyMetric: ({ endpoint, result }) => {
    trainingPipelineMetrics.runStartIdempotencyTotal.inc({ endpoint, result });
  },
});

const trainingJobLifecycleService = createTrainingJobLifecycleService({
  logger,
  resolveFineTuningQueuePriorityFromSnapshot,
  enqueueTrainingFineTuningRun,
  cancelLoraJob: async (loraJobId) => {
    await cancelJob(loraJobId);
  },
  createHttpError: (status, payload) => new TrainingHttpError(status, payload),
});

registerTrainingPlatformRoutes(app, {
  logger,
  getEmbeddingsCircuitBreakerSnapshot: () => ({
    opened: gpuManagerEmbeddingsBreaker.opened,
    halfOpen: gpuManagerEmbeddingsBreaker.halfOpen,
    stats: {
      failures: gpuManagerEmbeddingsBreaker.stats.failures,
      successes: gpuManagerEmbeddingsBreaker.stats.successes,
      timeouts: gpuManagerEmbeddingsBreaker.stats.timeouts,
    },
  }),
  getImmutableAuditIntegrityState: () => trainingImmutableAuditIntegrityState,
  isPoolHealthy: async () => isPoolHealthy(),
  tradingQueueNames: {
    universe: tradingQueueNames.universe,
    backtest: tradingQueueNames.backtest,
    calibration: tradingQueueNames.calibration,
    rebalance: tradingQueueNames.rebalance,
    modelRisk: tradingQueueNames.modelRisk,
    portfolioAutoRun: tradingQueueNames.portfolioAutoRun,
    signalAutoRun: tradingQueueNames.signalAutoRun,
  },
  enqueueTradingJob: async (queueName, payload) => enqueueTradingJob(
    queueName as (typeof tradingQueueNames)[keyof typeof tradingQueueNames],
    payload,
  ),
  parseTradingUniverseEnqueuePayload: (body) => tradingUniverseEnqueueSchema.parse(body),
  parseTradingBacktestEnqueuePayload: (body) => tradingBacktestEnqueueSchema.parse(body),
  parseTradingCalibrationEnqueuePayload: (body) => tradingCalibrationEnqueueSchema.parse(body),
  parseTradingRebalanceEnqueuePayload: (body) => tradingRebalanceEnqueueSchema.parse(body),
  parseTradingModelRiskEnqueuePayload: (body) => tradingModelRiskEnqueueSchema.parse(body),
  parseTradingAutoPortfolioPayload: (body) => tradingAutoPortfolioPayloadSchema.parse(body),
  parseTradingAutoSignalPayload: (body) => tradingAutoSignalPayloadSchema.parse(body),
  buildTradingIdempotencyKey: (queueName, payload) => buildTradingIdempotencyKey(
    queueName as Parameters<typeof buildTradingIdempotencyKey>[0],
    payload,
  ),
});

registerTrainingAuditRoutes(app, {
  logger,
  runTrainingImmutableAuditIntegrityCheck,
  getTrainingImmutableAuditIntegrityState: () => trainingImmutableAuditIntegrityState,
  resolveAuthorizedTenantId,
  isTrainingGovernanceAuditAction,
});

registerTrainingLoraOrchestratorRoutes(app, {
  logger,
  resolveAuthorizedTenantId,
  activateLoraAdapter,
  getActiveAdapter,
  deactivateLoraAdapter,
  gpuManagerUrlOrchestrator: process.env.GPU_MANAGER_URL || 'http://alice-gpu-manager:3010',
  internalApiSecretOrchestrator: process.env.INTERNAL_API_SECRET,
});

registerTrainingRuntimeRoutes(app, {
  logger,
  resolveAuthorizedTenantId,
  readScheduleScopeMetadata,
  loadTrainingSystemRuntimeConfig,
  loadTrainingGovernanceRuntimeConfig,
  getFineTuningQueuesStatus,
  getTenantInflightFineTuningJobsCount: async (tenantId) => getTenantInflightFineTuningJobsCount(db, tenantId),
  getTradingDataGovernancePolicy: () => tradingDataGovernancePolicy,
  trainingRunStartRequireIdempotencyKey: TRAINING_RUN_START_REQUIRE_IDEMPOTENCY_KEY,
});

registerTrainingRunManagementRoutes(app, {
  logger,
  resolveAuthorizedTenantId,
  cancelFineTuningJobAndLora: (params) => trainingJobLifecycleService.cancelFineTuningJobAndLora(params),
  toTrainingHttpErrorResponse: (error) => (
    error instanceof TrainingHttpError
      ? { status: error.status, payload: error.responsePayload }
      : null
  ),
});

registerTrainingScheduleRoutes(app, {
  logger,
  resolveAuthorizedTenantId,
  findNamespaceByIdInTenant,
  loadTrainingSystemRuntimeConfig,
  loadTrainingEnterpriseConfig,
  isSameScheduleScope,
  scheduleConfig: SCHEDULE_CONFIG,
});

registerTrainingDataRoutes(app, {
  logger,
  resolveAuthorizedTenantId,
  parseCollectTrainingDataBody: (body) => collectTrainingDataSchema.parse(body),
  parseCollectTrainingDataPayload: (body) => collectTrainingDataPayloadSchema.parse(body),
  collectTrainingDataForTenant: async (params) => collectTrainingDataForTenant({
    tenantId: params.tenantId,
    createdBy: params.createdBy,
    payload: params.payload as z.infer<typeof collectTrainingDataPayloadSchema>,
  }),
  toTrainingHttpErrorResponse: (error) => (
    error instanceof TrainingHttpError
      ? { status: error.status, payload: error.responsePayload }
      : null
  ),
  findNamespaceByIdInTenant,
  findAgentByIdInTenant,
  persistTrainingGovernanceAudit: async (params) => trainingGovernanceAuditService.persistTrainingGovernanceAudit({
    tenantId: params.tenantId,
    userId: params.userId,
    action: params.action,
    resource: params.resource,
    resourceId: params.resourceId,
    request: params.request,
    details: params.details,
  }),
  incrementReviewMetric: (status) => {
    trainingPipelineMetrics.reviewTotal.labels(status).inc();
  },
  incrementScopeOverrideMetric: (source) => {
    trainingPipelineMetrics.scopeOverrideTotal.inc({ source });
  },
  incrementScopeResolvedMetric: (source) => {
    trainingPipelineMetrics.scopeResolvedTotal.inc({ source });
  },
  incrementGovernanceAuditWritesMetric: (result) => {
    trainingPipelineMetrics.governanceAuditWritesTotal.inc({
      action: 'training_scope_binding_changed',
      result,
    });
  },
});

registerTrainingDataReviewRoutes(app, {
  logger,
  resolveAuthorizedTenantId,
  incrementReviewMetric: (status, count) => {
    trainingPipelineMetrics.reviewTotal.labels(status).inc(count);
  },
});

registerTrainingBulkImportRoutes(app, {
  logger,
  resolveAuthorizedTenantId,
  parseBulkImportBody: (body) => bulkImportSchema.parse(body),
  findNamespaceByIdInTenant,
  findAgentByIdInTenant,
  computeSemHash,
  evaluateTrainingQuality,
  resolveScope,
  observeScopeConfidence: (value) => {
    trainingPipelineMetrics.scopeConfidenceHistogram.observe(value);
  },
  incrementScopeQuarantineTotal: ({ sourceType, reason }) => {
    trainingPipelineMetrics.scopeQuarantineTotal.inc({
      source_type: sourceType,
      reason,
    });
  },
  incrementScopeSuggestedNewNamespaceTotal: ({ sourceType }) => {
    trainingPipelineMetrics.scopeSuggestedNewNamespaceTotal.inc({
      source_type: sourceType,
    });
  },
  getTrainingDataMinQuality: () => TRAINING_DATA_MIN_QUALITY,
  buildTrainingIdempotencyKey: (params) => buildTrainingIdempotencyKey(params),
  parseTrainingEmbeddingDedupeQueuePayload: (payload) => trainingEmbeddingDedupeQueuePayloadSchema.parse(payload),
  enqueueTrainingEmbeddingDedupeJob,
});

registerTrainingWebhookRoutes(app, {
  logger,
  collectTrainingDataForTenant,
  parseCollectTrainingDataPayload: (body) => collectTrainingDataPayloadSchema.parse(body),
  toTrainingHttpErrorResponse: (error) => (
    error instanceof TrainingHttpError
      ? { status: error.status, payload: error.responsePayload }
      : null
  ),
  incrementWebhookAuthValidationTotal: ({ mode, result }) => {
    trainingPipelineMetrics.webhookAuthValidationTotal.inc({ mode, result });
  },
  incrementWebhookBodyDigestValidationTotal: ({ result }) => {
    trainingPipelineMetrics.webhookBodyDigestValidationTotal.inc({ result });
  },
  incrementWebhookNonceValidationTotal: ({ storage, result }) => {
    trainingPipelineMetrics.webhookNonceValidationTotal.inc({ storage, result });
  },
});

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1, 'ConteÃºdo da mensagem Ã© obrigatÃ³rio'),
});

const trainingSourceTypeSchema = z.enum([
  'chat',
  'trading_signal',
  'trading_order',
  'trading_demo',
  'trading_postmortem',
  'document',
  'rag_document',
  'rag_media', // Plano RAG Multimodal Fase 4 - mÃ­dia (imagem/Ã¡udio) promovida para treinamento
  'upload',
  'external',
  'manual',
  'system',
]);

function parseEnvFloat(envValue: string | undefined, defaultValue: number, varName: string): number {
  const raw = envValue ?? String(defaultValue);
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    const errorMsg = `${varName} invÃ¡lido: "${raw}". Deve ser nÃºmero positivo.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ varName, rawValue: raw }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, defaultValue }, `${errorMsg} Usando valor padrÃ£o.`);
    return defaultValue;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const errorMsg = `${varName} invÃ¡lido: "${raw}". Deve ser nÃºmero positivo.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ varName, rawValue: raw, parsed }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, parsed, defaultValue }, `${errorMsg} Usando valor padrÃ£o.`);
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

type TrainingNamespaceProfileRuntime = {
  profileVersion: number;
  isActive: boolean;
  autoCollectEnabled: boolean;
  exists: boolean;
  config: NamespaceProfileConfig;
};

async function getDefaultNamespaceProfileConfigForTraining(): Promise<NamespaceProfileConfig> {
  return getNamespaceProfileDefaultConfig();
}

async function resolveTrainingNamespaceProfile(params: {
  tenantId: string;
  namespaceId?: string | null;
}): Promise<TrainingNamespaceProfileRuntime> {
  const defaultConfig = await getDefaultNamespaceProfileConfigForTraining();
  if (!params.namespaceId) {
    return {
      profileVersion: 1,
      isActive: true,
      autoCollectEnabled: false,
      exists: false,
      config: defaultConfig,
    };
  }

  const profile = await db.query.namespaceProfiles.findFirst({
    where: and(
      eq(schema.namespaceProfiles.tenantId, params.tenantId),
      eq(schema.namespaceProfiles.namespaceId, params.namespaceId)
    ),
  });
  if (!profile) {
    return {
      profileVersion: 1,
      isActive: true,
      autoCollectEnabled: true,
      exists: false,
      config: defaultConfig,
    };
  }
  return {
    profileVersion: profile.version,
    isActive: profile.isActive,
    autoCollectEnabled: profile.autoCollectEnabled,
    exists: true,
    config: NamespaceProfileConfigSchema.parse(profile.config),
  };
}

const collectTrainingDataSchema = z.object({
  tenantId: z.string().uuid('Tenant ID deve ser UUID vÃ¡lido'),
  namespaceId: z.string().uuid('Namespace ID deve ser UUID vÃ¡lido').optional(),
  agentId: z.string().uuid('Agent ID deve ser UUID vÃ¡lido').optional(),
  domain: z.string().min(1).max(120).optional(),
  conversationId: z.string().uuid('Conversation ID deve ser UUID vÃ¡lido').optional(),
  source: z.string().min(1, 'Fonte Ã© obrigatÃ³ria'),
  sourceType: trainingSourceTypeSchema.optional(),
  sourceId: z.string().min(1).max(255).optional(),
  sourceMetadata: z.record(z.unknown()).optional(),
  messages: z.array(messageSchema).min(1, 'Pelo menos uma mensagem Ã© obrigatÃ³ria'),
  rating: z.number().min(1).max(5).optional(),
});

const collectTrainingDataPayloadSchema = collectTrainingDataSchema.omit({ tenantId: true });
const TRAINING_DATA_ACTIVE_FINGERPRINT_UNIQUE_INDEX = 'training_data_active_fingerprint_uidx';
const TRAINING_DATA_ACTIVE_STATUSES_FOR_FINGERPRINT = ['pending', 'approved', 'reserved', 'used'] as const;

class TrainingHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly responsePayload: Record<string, unknown>
  ) {
    super(`Training HTTP error ${status}`);
    this.name = 'TrainingHttpError';
  }
}

function isPgUniqueConstraintViolation(error: unknown, constraintName: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === '23505' && candidate.constraint === constraintName;
}

async function collectTrainingDataForTenant(params: {
  tenantId: string;
  createdBy?: string;
  payload: z.infer<typeof collectTrainingDataPayloadSchema>;
}): Promise<{
  trainingData: typeof schema.trainingData.$inferSelect;
  queued: boolean;
  idempotencyKey: string;
  idempotencyHit?: boolean;
  isDuplicate: boolean;
  duplicateOfId: string | null;
  similarityScore: number | null;
}> {
  const body = params.payload;
  const resolvedTenantId = params.tenantId;
  const createdBy = params.createdBy;

  if (body.namespaceId) {
    await validateNamespaceTenantConsistency(
      body.namespaceId,
      resolvedTenantId,
      async (id) => findNamespaceByIdInTenant(resolvedTenantId, id)
    );
  }
  if (body.agentId) {
    const agent = await findAgentByIdInTenant(resolvedTenantId, body.agentId);
    validateTenantConsistency('agent', agent, resolvedTenantId, 'training_data');
  }

  const sourceType = body.sourceType ?? 'manual';
  const namespaceProfile = await resolveTrainingNamespaceProfile({
    tenantId: resolvedTenantId,
    namespaceId: body.namespaceId ?? null,
  });

  if (!namespaceProfile.exists && body.namespaceId) {
    const runId = crypto.randomUUID();
    const reconcilePayload = trainingNamespaceProfileReconcileQueuePayloadSchema.parse({
      runId,
      idempotencyKey: buildNamespaceProfileReconcileIdempotencyKey({ runId }),
      createdAt: new Date().toISOString(),
    });
    const enqueued = await enqueueNamespaceProfileReconcileJob(reconcilePayload);
    logger.warn(
      {
        tenantId: resolvedTenantId,
        namespaceId: body.namespaceId,
        runId,
        enqueued,
      },
      'Namespace profile ausente; reconcile enfileirado'
    );
  }

  const privacyResult = applyPrivacyPolicy({
    messages: body.messages,
    privacyConfig: namespaceProfile.config.privacy,
  });
  const messagesForStorage = privacyResult.messagesRedacted;
  if (privacyResult.summary.totalMatches > 0) {
    trainingPipelineMetrics.privacyRedactionsTotal.inc(privacyResult.summary.totalMatches);
  }
  if (privacyResult.action === 'quarantine') {
    trainingPipelineMetrics.privacyQuarantineTotal.inc();
  }

  if (sourceType === 'chat' && body.source === 'chat-auto') {
    if (!namespaceProfile.isActive || !namespaceProfile.autoCollectEnabled || !namespaceProfile.config.autoCollect.enabled) {
      trainingPipelineMetrics.dataRejectedTotal.labels('policy', sourceType).inc();
      throw new TrainingHttpError(403, { error: 'namespace_profile_auto_collect_disabled' });
    }
  }

  if (sourceType === 'chat' && body.source === 'chat-auto' && namespaceProfile.config.autoCollect.requiresUserConsent) {
    const sourceMetadataUserId = typeof body.sourceMetadata?.['userId'] === 'string' ? body.sourceMetadata.userId : null;
    const userIdForConsent = sourceMetadataUserId ?? createdBy ?? null;
    if (!userIdForConsent) {
      trainingPipelineMetrics.consentRejectedTotal.inc();
      throw new TrainingHttpError(403, { error: 'user_opt_out' });
    }
    const userRecord = await db.query.users.findFirst({
      where: and(
        eq(schema.users.id, userIdForConsent),
        eq(schema.users.tenantId, resolvedTenantId)
      ),
      columns: { preferencias: true },
    });
    const prefs = (userRecord?.preferencias ?? {}) as {
      training?: { allowTrainingUsage?: boolean; allowAutoCollect?: boolean };
    };
    if (prefs.training?.allowTrainingUsage === false || prefs.training?.allowAutoCollect === false) {
      trainingPipelineMetrics.consentRejectedTotal.inc();
      throw new TrainingHttpError(403, { error: 'user_opt_out' });
    }
  }

  const messagesText = messagesForStorage.map((m) => m.content).join('\n');
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
  trainingPipelineMetrics.scopeConfidenceHistogram.observe(scope.confidence);

  const effectiveNamespaceId = body.namespaceId ?? scope.namespaceId ?? null;
  const effectiveAgentId = body.agentId ?? scope.agentId ?? null;
  const inferredStatusNotes: string[] = [];
  if (scope.needsHumanReview) {
    inferredStatusNotes.push(
      `Escopo em quarentena automÃ¡tica: confidence=${scope.confidence.toFixed(2)}`
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
  const qualityAssessment = evaluateTrainingQuality({
    sourceType,
    messages: messagesForStorage,
    sourceMetadata: body.sourceMetadata,
  });
  const qualityScore = qualityAssessment.score;
  const idempotencyKey = buildTrainingIdempotencyKey({
    tenantId: resolvedTenantId,
    sourceType,
    sourceId: body.sourceId ?? null,
    semhash,
  });

  const qualityMinScore = namespaceProfile.config.quality.minScore;
  const qualityAutoReject = namespaceProfile.config.quality.autoRejectBelowMin;
  const defaultPurpose = sourceType === 'rag_document' || sourceType === 'rag_media'
    ? 'knowledge_rag'
    : 'behavior_sft';
  const autoRejectedByQuality = qualityAutoReject && qualityScore < qualityMinScore;
  if (autoRejectedByQuality || privacyResult.action === 'reject') {
    const reviewNotes = autoRejectedByQuality
      ? `Auto-rejeitado: qualidade ${qualityScore.toFixed(2)} abaixo do mÃ­nimo (${qualityMinScore}).`
      : 'Rejeitado por polÃ­tica de privacidade';
    const processedAt = new Date();
    const [trainingData] = await db.insert(schema.trainingData).values({
      tenantId: resolvedTenantId,
      namespaceId: effectiveNamespaceId,
      agentId: effectiveAgentId,
      conversationId: body.conversationId,
      source: body.source,
      sourceType,
      sourceId: body.sourceId ?? null,
      sourceMetadata: body.sourceMetadata ?? {},
      inferredNamespaceId: scope.namespaceId,
      inferredAgentId: scope.agentId,
      inferredDomain: scope.domain,
      inferenceConfidence: scope.confidence,
      inferenceTrace: scope.trace,
      scopeResolverVersion: 'v1',
      profileVersion: namespaceProfile.profileVersion,
      needsHumanReview: scope.needsHumanReview || !namespaceProfile.exists,
      quarantineReason: !namespaceProfile.exists
        ? 'missing_namespace_profile'
        : scope.needsHumanReview
          ? 'low_confidence_or_missing_namespace'
          : null,
      scopeResolvedAt: new Date(),
      quarantinedAt: scope.needsHumanReview || !namespaceProfile.exists ? new Date() : null,
      messages: messagesForStorage,
      rating: body.rating,
      qualityScore,
      createdBy,
      semhash,
      embedding: null,
      isDuplicate: false,
      duplicateOfId: null,
      similarityScore: null,
      purpose: 'rejected',
      status: 'rejected',
      reviewNotes: [
        reviewNotes,
        !namespaceProfile.exists ? 'Namespace profile ausente; item em modo restritivo.' : null,
        privacyResult.action === 'reject' ? 'privacy_policy_match' : null,
        qualityAssessment.rejectionReasons.length > 0
          ? `quality_reasons:${qualityAssessment.rejectionReasons.join(',')}`
          : null,
        ...inferredStatusNotes,
      ].filter(Boolean).join(' | ') || null,
      processedAt,
      processadoEm: processedAt,
    }).returning();

    trainingPipelineMetrics.dataCollectedTotal.labels(sourceType, 'rejected').inc();
    trainingPipelineMetrics.qualityScore.observe(qualityScore);
    trainingPipelineMetrics.dataRejectedTotal.labels(
      privacyResult.action === 'reject' ? 'privacy' : 'quality',
      sourceType
    ).inc();
    await db.insert(schema.trainingLineageEvents).values({
      tenantId: resolvedTenantId,
      namespaceId: effectiveNamespaceId,
      eventType: 'training_data.rejected_policy',
      sourceTable: 'training_data',
      sourceId: trainingData.id,
      producedTable: 'training_data',
      producedId: trainingData.id,
      metadata: {
        sourceType,
        qualityScore,
        minScore: qualityMinScore,
        privacyAction: privacyResult.action,
      },
    });

    logger.info({
      trainingDataId: trainingData.id,
      qualityScore,
      queued: false,
      idempotencyKey,
    }, 'Dados de treinamento rejeitados por qualidade mÃ­nima');

    return {
      trainingData,
      queued: false,
      idempotencyKey,
      isDuplicate: false,
      duplicateOfId: null,
      similarityScore: null,
    };
  }

  const sameFingerprintConditions = [
    eq(schema.trainingData.tenantId, resolvedTenantId),
    eq(schema.trainingData.sourceType, sourceType),
    eq(schema.trainingData.semhash, semhash),
  ];
  if (body.sourceId) {
    sameFingerprintConditions.push(eq(schema.trainingData.sourceId, body.sourceId));
  } else {
    sameFingerprintConditions.push(isNull(schema.trainingData.sourceId));
  }

  const existingByFingerprint = await db.query.trainingData.findFirst({
    where: and(...sameFingerprintConditions),
    orderBy: [desc(schema.trainingData.criadoEm)],
  });
  if (existingByFingerprint) {
    const alreadyProcessed = Boolean(existingByFingerprint.embedding && existingByFingerprint.processedAt);
    logger.info({
      trainingDataId: existingByFingerprint.id,
      queued: !alreadyProcessed && existingByFingerprint.status === 'pending',
      idempotencyKey,
    }, 'RequisiÃ§Ã£o idempotente detectada em training_data');

    return {
      trainingData: existingByFingerprint,
      queued: !alreadyProcessed && existingByFingerprint.status === 'pending',
      idempotencyKey,
      idempotencyHit: true,
      isDuplicate: Boolean(existingByFingerprint.isDuplicate),
      duplicateOfId: existingByFingerprint.duplicateOfId,
      similarityScore: existingByFingerprint.similarityScore ?? null,
    };
  }

  let trainingData: typeof schema.trainingData.$inferSelect | null = null;
  try {
    [trainingData] = await db.insert(schema.trainingData).values({
      tenantId: resolvedTenantId,
      namespaceId: effectiveNamespaceId,
      agentId: effectiveAgentId,
      conversationId: body.conversationId,
      source: body.source,
      sourceType,
      sourceId: body.sourceId ?? null,
      sourceMetadata: {
        ...(body.sourceMetadata ?? {}),
        privacySummary: namespaceProfile.config.privacy.logRedactionSummary ? privacyResult.summary : undefined,
        qualityAssessment: {
          score: qualityScore,
          rejectionReasons: qualityAssessment.rejectionReasons,
        },
      },
      inferredNamespaceId: scope.namespaceId,
      inferredAgentId: scope.agentId,
      inferredDomain: scope.domain,
      inferenceConfidence: scope.confidence,
      inferenceTrace: scope.trace,
      scopeResolverVersion: 'v1',
      profileVersion: namespaceProfile.profileVersion,
      needsHumanReview: scope.needsHumanReview
        || !namespaceProfile.exists
        || privacyResult.action === 'quarantine'
        || defaultPurpose === 'knowledge_rag',
      quarantineReason: defaultPurpose === 'knowledge_rag'
        ? 'knowledge_rag_default'
        : privacyResult.action === 'quarantine'
        ? 'privacy_policy_match'
        : !namespaceProfile.exists
          ? 'missing_namespace_profile'
          : scope.needsHumanReview
            ? 'low_confidence_or_missing_namespace'
            : null,
      scopeResolvedAt: new Date(),
      quarantinedAt: scope.needsHumanReview || !namespaceProfile.exists || privacyResult.action === 'quarantine' || defaultPurpose === 'knowledge_rag' ? new Date() : null,
      messages: messagesForStorage,
      rating: body.rating,
      qualityScore,
      createdBy,
      semhash,
      embedding: null,
      isDuplicate: false,
      duplicateOfId: null,
      similarityScore: null,
      purpose: defaultPurpose,
      status: 'pending',
      reviewNotes: [
        ...inferredStatusNotes,
        !namespaceProfile.exists ? 'Namespace profile ausente; reconcile solicitado.' : null,
        privacyResult.action === 'quarantine' ? 'privacy_policy_match' : null,
        defaultPurpose === 'knowledge_rag' ? 'knowledge_rag_default' : null,
        qualityAssessment.rejectionReasons.length > 0
          ? `quality_reasons:${qualityAssessment.rejectionReasons.join(',')}`
          : null,
      ].filter(Boolean).join(' | ') || null,
    }).returning();
  } catch (error) {
    if (!isPgUniqueConstraintViolation(error, TRAINING_DATA_ACTIVE_FINGERPRINT_UNIQUE_INDEX)) {
      throw error;
    }

    const existingAfterConflict = await db.query.trainingData.findFirst({
      where: and(
        ...sameFingerprintConditions,
        inArray(schema.trainingData.status, [...TRAINING_DATA_ACTIVE_STATUSES_FOR_FINGERPRINT])
      ),
      orderBy: [desc(schema.trainingData.criadoEm)],
    });
    if (!existingAfterConflict) {
      throw error;
    }

    const alreadyProcessed = Boolean(existingAfterConflict.embedding && existingAfterConflict.processedAt);
    logger.warn({
      trainingDataId: existingAfterConflict.id,
      queued: !alreadyProcessed && existingAfterConflict.status === 'pending',
      idempotencyKey,
    }, 'Conflito de fingerprint resolvido por unique index (idempotÃªncia concorrente)');

    return {
      trainingData: existingAfterConflict,
      queued: !alreadyProcessed && existingAfterConflict.status === 'pending',
      idempotencyKey,
      idempotencyHit: true,
      isDuplicate: Boolean(existingAfterConflict.isDuplicate),
      duplicateOfId: existingAfterConflict.duplicateOfId,
      similarityScore: existingAfterConflict.similarityScore ?? null,
    };
  }

  if (!trainingData) {
    throw new Error('Falha ao inserir training_data');
  }

  await db.insert(schema.trainingLineageEvents).values({
    tenantId: resolvedTenantId,
    namespaceId: effectiveNamespaceId,
    eventType: privacyResult.action === 'quarantine' || !namespaceProfile.exists || scope.needsHumanReview
      ? 'training_data.quarantined_policy'
      : 'training_data.collected',
    sourceTable: 'training_data',
    sourceId: trainingData.id,
    producedTable: 'training_data',
    producedId: trainingData.id,
    metadata: {
      sourceType,
      qualityScore,
      profileVersion: namespaceProfile.profileVersion,
      privacyAction: privacyResult.action,
    },
  });

  const queuePayload = trainingEmbeddingDedupeQueuePayloadSchema.parse({
    trainingDataId: trainingData.id,
    tenantId: resolvedTenantId,
    namespaceId: effectiveNamespaceId ?? undefined,
    agentId: effectiveAgentId ?? undefined,
    semhash,
    sourceType,
    sourceId: body.sourceId ?? undefined,
    idempotencyKey,
    createdAt: new Date().toISOString(),
  });
  const queued = await enqueueTrainingEmbeddingDedupeJob(queuePayload);

  if (!queued) {
    const processedAt = new Date();
    const canonical = await db.query.trainingData.findFirst({
      where: and(
        ...sameFingerprintConditions,
        ne(schema.trainingData.id, trainingData.id)
      ),
      orderBy: [desc(schema.trainingData.criadoEm)],
    });
    const [updatedDuplicate] = await db.update(schema.trainingData)
      .set({
        isDuplicate: true,
        duplicateOfId: canonical?.id ?? null,
        similarityScore: 1,
        status: 'rejected',
        reviewNotes: [
          'RequisiÃ§Ã£o idempotente duplicada: job jÃ¡ enfileirado para fingerprint idÃªntico.',
          trainingData.reviewNotes,
        ].filter(Boolean).join(' | '),
        processedAt,
        processadoEm: processedAt,
      })
      .where(eq(schema.trainingData.id, trainingData.id))
      .returning();

    const duplicateRow = updatedDuplicate ?? trainingData;
    trainingPipelineMetrics.dataCollectedTotal.labels(sourceType, 'rejected').inc();
    trainingPipelineMetrics.dataRejectedTotal.labels('duplicate', sourceType).inc();
    trainingPipelineMetrics.qualityScore.observe(qualityScore);
    trainingPipelineMetrics.dataDuplicatesTotal.labels(sourceType).inc();

    logger.info({
      trainingDataId: duplicateRow.id,
      queued: false,
      idempotencyKey,
    }, 'RequisiÃ§Ã£o idempotente duplicada sem novo enqueue');

    return {
      trainingData: duplicateRow,
      queued: false,
      idempotencyKey,
      idempotencyHit: true,
      isDuplicate: true,
      duplicateOfId: duplicateRow.duplicateOfId,
      similarityScore: duplicateRow.similarityScore ?? null,
    };
  }

  trainingPipelineMetrics.dataCollectedTotal.labels(sourceType, 'pending').inc();
  trainingPipelineMetrics.qualityScore.observe(qualityScore);

  logger.info({
    trainingDataId: trainingData.id,
    queued,
    idempotencyKey,
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

  return {
    trainingData,
    queued,
    idempotencyKey,
    isDuplicate: false,
    duplicateOfId: null,
    similarityScore: null,
  };
}

registerTrainingJobQueryRoutes(app, {
  logger,
  resolveAuthorizedTenantId,
  getPromotionApprovalSummary,
  buildFineTuningJobStreamFingerprint,
  isActiveFineTuningJobStatus,
  trainingJobStreamPollIntervalMs: TRAINING_JOB_STREAM_POLL_INTERVAL_MS,
  trainingJobStreamHeartbeatMs: TRAINING_JOB_STREAM_HEARTBEAT_MS,
  trainingGovernanceAuditActions: TRAINING_GOVERNANCE_AUDIT_ACTIONS,
});

registerTrainingJobCreateRoutes(app, {
  logger,
  resolveAuthorizedTenantId,
  readOptionalTrainingIdempotencyKey: (req) => trainingRunStartIdempotencyService.readOptionalTrainingIdempotencyKey(req),
  buildRunStartRequestFingerprint: (params) => trainingRunStartIdempotencyService.buildRunStartRequestFingerprint(params),
  hashIdempotencyKeyForAudit: (key) => trainingRunStartIdempotencyService.hashIdempotencyKeyForAudit(key),
  lookupRunStartIdempotencyReplay: (params) => trainingRunStartIdempotencyService.lookupRunStartIdempotencyReplay(params),
  sendTrainingRunStartError: (params) => trainingRunStartIdempotencyService.sendTrainingRunStartError(params),
  applyIdempotencyResponseHeaders: (res, key, status) => (
    trainingRunStartIdempotencyService.applyIdempotencyResponseHeaders(res, key, status)
  ),
  storeRunStartIdempotencyRecord: (params) => trainingRunStartIdempotencyService.storeRunStartIdempotencyRecord(params),
  findNamespaceByIdInTenant,
  findAgentByIdInTenant,
  enqueueTrainingFineTuningRun,
  persistTrainingGovernanceAudit: async (params) => trainingGovernanceAuditService.persistTrainingGovernanceAudit({
    tenantId: params.tenantId,
    userId: params.userId,
    action: params.action,
    resourceId: params.resourceId,
    request: params.request,
    details: params.details,
  }),
  trainingRunStartRequireIdempotencyKey: TRAINING_RUN_START_REQUIRE_IDEMPOTENCY_KEY,
  trainingRunStartContentionRetryAfterSeconds: TRAINING_RUN_START_CONTENTION_RETRY_AFTER_SECONDS,
  trainingRunStartCapacityRetryAfterSeconds: TRAINING_RUN_START_CAPACITY_RETRY_AFTER_SECONDS,
  incrementRunStartIdempotencyMetric: (result) => {
    trainingPipelineMetrics.runStartIdempotencyTotal.inc({
      endpoint: 'custom_job',
      result,
    });
  },
  incrementGovernanceLockAttemptsMetric: (result) => {
    trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
      operation: 'run_start',
      result,
    });
  },
  incrementGovernanceAuditWritesMetric: (result) => {
    trainingPipelineMetrics.governanceAuditWritesTotal.inc({
      action: 'training_run_start_requested',
      result,
    });
  },
});

registerTrainingJobCancelRoutes(app, {
  logger,
  resolveAuthorizedTenantId,
  cancelFineTuningJobAndLora: (params) => trainingJobLifecycleService.cancelFineTuningJobAndLora(params),
  toTrainingHttpErrorResponse: (error) => (
    error instanceof TrainingHttpError
      ? { status: error.status, payload: error.responsePayload }
      : null
  ),
});

registerTrainingJobPromotionApprovalRoutes(app, {
  logger,
  resolveAuthorizedTenantId,
  getPromotionApprovalSummary,
  persistTrainingGovernanceAudit: async (params) => trainingGovernanceAuditService.persistTrainingGovernanceAudit({
    tenantId: params.tenantId,
    userId: params.userId,
    action: params.action,
    resourceId: params.resourceId,
    request: params.request,
    details: params.details,
    executor: params.executor,
  }),
  trainingOperationLockTtlSeconds: TRAINING_OPERATION_LOCK_TTL_SECONDS,
  incrementGovernanceLockAttemptsMetric: (result) => {
    trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
      operation: 'promotion_approval',
      result,
    });
  },
  incrementGovernanceAuditWritesMetric: (result) => {
    trainingPipelineMetrics.governanceAuditWritesTotal.inc({
      action: 'training_promotion_approval_recorded',
      result,
    });
  },
});

registerTrainingJobRollbackRoutes(app, {
  logger,
  resolveAuthorizedTenantId,
  persistTrainingGovernanceAudit: async (params) => trainingGovernanceAuditService.persistTrainingGovernanceAudit({
    tenantId: params.tenantId,
    userId: params.userId,
    action: params.action,
    resourceId: params.resourceId,
    request: params.request,
    details: params.details,
    executor: params.executor,
  }),
  trainingOperationLockTtlSeconds: TRAINING_OPERATION_LOCK_TTL_SECONDS,
  incrementGovernanceLockAttemptsMetric: (result) => {
    trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
      operation: 'rollback',
      result,
    });
  },
  incrementGovernanceAuditWritesMetric: (result) => {
    trainingPipelineMetrics.governanceAuditWritesTotal.inc({
      action: 'training_model_rollback_executed',
      result,
    });
  },
});

registerTrainingJobPromoteRoutes(app, {
  logger,
  resolveAuthorizedTenantId,
  getPromotionApprovalSummary,
  persistTrainingGovernanceAudit: async (params) => trainingGovernanceAuditService.persistTrainingGovernanceAudit({
    tenantId: params.tenantId,
    userId: params.userId,
    action: params.action,
    resourceId: params.resourceId,
    request: params.request,
    details: params.details,
    executor: params.executor,
  }),
  trainingOperationLockTtlSeconds: TRAINING_OPERATION_LOCK_TTL_SECONDS,
  incrementGovernanceLockAttemptsMetric: (result) => {
    trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
      operation: 'promote',
      result,
    });
  },
  incrementGovernanceAuditWritesMetric: (result) => {
    trainingPipelineMetrics.governanceAuditWritesTotal.inc({
      action: 'training_model_promoted',
      result,
    });
  },
});

registerTrainingRunStartRoutes(app, {
  logger,
  resolveAuthorizedTenantId,
  readOptionalTrainingIdempotencyKey: (req) => trainingRunStartIdempotencyService.readOptionalTrainingIdempotencyKey(req),
  buildRunStartRequestFingerprint: (params) => trainingRunStartIdempotencyService.buildRunStartRequestFingerprint(params),
  hashIdempotencyKeyForAudit: (key) => trainingRunStartIdempotencyService.hashIdempotencyKeyForAudit(key),
  lookupRunStartIdempotencyReplay: (params) => trainingRunStartIdempotencyService.lookupRunStartIdempotencyReplay(params),
  sendTrainingRunStartError: (params) => trainingRunStartIdempotencyService.sendTrainingRunStartError(params),
  applyIdempotencyResponseHeaders: (res, key, status) => (
    trainingRunStartIdempotencyService.applyIdempotencyResponseHeaders(res, key, status)
  ),
  loadTrainingGovernanceRuntimeConfig,
  loadTrainingEnterpriseConfig,
  getTenantInflightFineTuningJobsCount: async (tenantId) => getTenantInflightFineTuningJobsCount(db, tenantId),
  findNamespaceByIdInTenant,
  evaluateDataQuality,
  startProgressiveLoRA,
  enqueueTrainingFineTuningRun,
  storeRunStartIdempotencyRecord: (params) => trainingRunStartIdempotencyService.storeRunStartIdempotencyRecord(params),
  persistTrainingGovernanceAudit: async (params) => trainingGovernanceAuditService.persistTrainingGovernanceAudit({
    tenantId: params.tenantId,
    userId: params.userId,
    action: params.action,
    resourceId: params.resourceId,
    request: params.request,
    details: params.details,
    executor: params.executor,
  }),
  baseModel: GPU_MANAGER_CONFIG.models.llm,
  trainingRunStartRequireIdempotencyKey: TRAINING_RUN_START_REQUIRE_IDEMPOTENCY_KEY,
  trainingRunStartContentionRetryAfterSeconds: TRAINING_RUN_START_CONTENTION_RETRY_AFTER_SECONDS,
  trainingRunStartCapacityRetryAfterSeconds: TRAINING_RUN_START_CAPACITY_RETRY_AFTER_SECONDS,
  incrementRunStartIdempotencyMetric: (result) => {
    trainingPipelineMetrics.runStartIdempotencyTotal.inc({
      endpoint: 'on_demand',
      result,
    });
  },
  incrementGovernanceLockAttemptsMetric: (result) => {
    trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
      operation: 'run_start',
      result,
    });
  },
  incrementGovernanceAuditWritesMetric: (result) => {
    trainingPipelineMetrics.governanceAuditWritesTotal.inc({
      action: 'training_run_start_requested',
      result,
    });
  },
});

// NOTA: Nao usamos polling in-memory. Estado e persistido em DB e retomado no startup.
// Polling removido (Regra 6): cancelamento e progresso sao tratados via DB + gpu-trainer.

// ============================================================================
// BULK IMPORT - ImportaÃ§Ã£o em Lote de Dados de Treinamento
// ============================================================================

const bulkImportSchema = z.object({
  source: z.string().min(1).max(50),
  sourceType: trainingSourceTypeSchema.optional(),
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

// ============================================================================
// WEBHOOK - Receber Dados de Sistemas Externos
// ============================================================================

// ============================================================================
// OWASP API3 - Schemas Zod para validaÃ§Ã£o de query params
// Previne type coercion issues e input tampering
// ============================================================================

// ============================================================================
// Gate 2 (15/01/2026): Training Schedule + On-Demand
// Endpoints enterprise para configurar e executar treinamentos
// ============================================================================

/**
 * POST /api/training/run/start
 * Inicia treinamento on-demand
 */
// FunÃ§Ãµes auxiliares para schedule

function _estimateRemainingTime(job: typeof schema.fineTuningJobs.$inferSelect): number | null {
  if (!job.iniciadoEm || !job.trainingDataCount || !job.progress) return null;
  
  const elapsedMs = Date.now() - new Date(job.iniciadoEm).getTime();
  const progress = job.progress / 100; // progress Ã© 0-100
  
  if (progress <= 0) return null;
  
  const estimatedTotalMs = elapsedMs / progress;
  const remainingMs = estimatedTotalMs - elapsedMs;
  
  return Math.round(Math.max(0, remainingMs) / 1000);
}

// Importar funÃ§Ãµes do auto-learning scheduler
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

// CORREÃ‡ÃƒO 31/12/2025: Usar connectWithRetry para garantir PostgreSQL + pgvector prontos
// Previne crash loop quando PostgreSQL ainda estÃ¡ inicializando
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
        logger.warn({ status: res.status }, 'Embeddings health unreachable apÃ³s retries - continuando (readiness falharÃ¡)');
        return;
      }
      const data = (await res.json()) as { text_dimensions?: number };
      const dim = data.text_dimensions;
      if (typeof dim !== 'number') {
        logger.warn({ data }, 'Embeddings health nÃ£o retornou text_dimensions');
        return;
      }
      if (dim !== EMBEDDING_DIMENSIONS.TEXT) {
        logger.error(
          { text_dimensions: dim, expected: EMBEDDING_DIMENSIONS.TEXT },
          'SSOT INCONSISTENTE: embeddings-gpu retorna dimensÃ£o diferente de @alice/database. Verifique configuraÃ§Ã£o.'
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
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Embeddings health unreachable apÃ³s retries - continuando');
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
      checkPgvector: true, // Verificar extensÃ£o pgvector (obrigatÃ³rio para embeddings)
    });

    // Inicializar auto-learning scheduler com instÃ¢ncia do banco (Regra 6: sem db undefined)
    // CORREÃ‡ÃƒO 11/02/2026: initAutoLearningScheduler NUNCA era chamada, causando
    // db=undefined â†’ TypeError a cada 60s no processScheduledJobs â†’ alerta Grafana
    initAutoLearningScheduler(getDatabase());

    // SSOT validation (Plano 11/02/2026): embeddings-gpu text_dimensions = EMBEDDING_DIMENSIONS.TEXT
    await validateEmbeddingDimensionsSSOT();

    // WS4: Redis cache + session-auth cache (evita queries repetitivas em PostgreSQL)
    // - Em produÃ§Ã£o: Redis Ã© obrigatÃ³rio (fail-fast dentro de initializeSessionAuthCache)
    // - Em dev/test: cache fica desabilitado (sem in-memory)
    await initializeRedisCache();
    await initializeSessionAuthCache();
    logger.info('Auth cache (session-auth) inicializado');
    tradingWorkerStoppers.push(
      createTrainingFineTuningWorker({
        db,
        logger,
        metrics: {
          jobsTotal: trainingPipelineMetrics.fineTuningQueueJobsTotal,
          durationSeconds: trainingPipelineMetrics.fineTuningQueueDurationSeconds,
        },
        pollIntervalMs: TRAINING_FINE_TUNING_WORKER_POLL_INTERVAL_MS,
        processJob: async (_job, payload) => {
          await runTrainingFineTuningJob({
            db,
            payload,
            fineTuningJobId: payload.fineTuningJobId,
          });
        },
      })
    );
    logger.info(
      {
        queues: [
          TRAINING_FINE_TUNING_QUEUE_HIGH,
          TRAINING_FINE_TUNING_QUEUE_NORMAL,
          TRAINING_FINE_TUNING_QUEUE_LOW,
        ],
        pollIntervalMs: TRAINING_FINE_TUNING_WORKER_POLL_INTERVAL_MS,
      },
      'Worker de fila fine-tuning inicializado'
    );
    tradingWorkerStoppers.push(
      createNamespaceProfileReconcileWorker({
        db,
        logger,
        metrics: {
          jobsTotal: trainingPipelineMetrics.namespaceProfileReconcileJobsTotal,
          reconcileCreatedTotal: trainingPipelineMetrics.namespaceProfileReconcileCreatedTotal,
          reconcileMissingTotal: trainingPipelineMetrics.namespaceProfileReconcileMissingTotal,
          durationSeconds: trainingPipelineMetrics.namespaceProfileReconcileDurationSeconds,
        },
        pollIntervalMs: Math.min(NAMESPACE_PROFILE_RECONCILE_INTERVAL_MS, 30_000),
      })
    );
    logger.info(
      {
        queue: TRAINING_NAMESPACE_PROFILE_RECONCILE_QUEUE,
        intervalMs: NAMESPACE_PROFILE_RECONCILE_INTERVAL_MS,
      },
      'Worker de reconciliaÃ§Ã£o de namespace_profiles inicializado'
    );
    tradingWorkerStoppers.push(
      createTrainingEmbeddingDedupeWorker({
        db,
        logger,
        metrics: {
          jobsTotal: trainingPipelineMetrics.embeddingDedupeJobsTotal,
          dedupeHitsTotal: trainingPipelineMetrics.embeddingDedupeHitsTotal,
          durationSeconds: trainingPipelineMetrics.embeddingDedupeDurationSeconds,
        },
        pollIntervalMs: TRAINING_EMBEDDING_DEDUPE_WORKER_POLL_INTERVAL_MS,
        similarityThreshold: SIMILARITY_THRESHOLD,
        generateEmbedding,
      })
    );
    tradingWorkerStoppers.push(
      createTrainingDataPolicyGateWorker({
        db,
        pollIntervalMs: TRAINING_POLICY_GATE_WORKER_POLL_INTERVAL_MS,
      })
    );
    logger.info(
      {
        queue: TRAINING_DATA_POLICY_GATE_QUEUE,
        pollIntervalMs: TRAINING_POLICY_GATE_WORKER_POLL_INTERVAL_MS,
      },
      'Worker de policy gate de treinamento inicializado'
    );
    logger.info(
      {
        queue: TRAINING_EMBEDDING_DEDUPE_QUEUE,
        pollIntervalMs: TRAINING_EMBEDDING_DEDUPE_WORKER_POLL_INTERVAL_MS,
      },
      'Worker de embedding/dedupe inicializado'
    );
    tradingWorkerStoppers.push(createTradingWorker(
      tradingQueueNames.universe,
      tradingUniverseEnqueueSchema,
      async (payload) => {
        const result = await runUniverseScanWorker(payload);
        tradingMetrics.candidateCount.inc({ side: result.side, marketType: payload.marketType });
      },
      tradingMetrics.universeScanSeconds,
    ));
    tradingWorkerStoppers.push(createTradingWorker(
      tradingQueueNames.backtest,
      tradingBacktestEnqueueSchema,
      async (payload) => {
        const result = await runBacktestWorker(payload);
        tradingMetrics.backtestDsr.set({ marketType: payload.marketType, strategyKey: payload.strategyKey }, result.dsr);
        tradingMetrics.backtestPbo.set({ marketType: payload.marketType, strategyKey: payload.strategyKey }, result.pbo);
      },
      tradingMetrics.backtestSeconds,
    ));
    tradingWorkerStoppers.push(createTradingWorker(
      tradingQueueNames.calibration,
      tradingCalibrationEnqueueSchema,
      async (payload) => {
        await runCalibrationWorker(payload);
      },
      tradingMetrics.calibrationSeconds,
    ));
    tradingWorkerStoppers.push(createTradingWorker(
      tradingQueueNames.rebalance,
      tradingRebalanceEnqueueSchema,
      async (payload) => {
        await runPortfolioRebalanceWorker(payload);
      },
      tradingMetrics.rebalanceSeconds,
    ));
    tradingWorkerStoppers.push(createTradingWorker(
      tradingQueueNames.modelRisk,
      tradingModelRiskEnqueueSchema,
      async (payload) => {
        await runModelRiskWorker(payload);
        tradingMetrics.modelRiskEventsTotal.inc();
      },
      tradingMetrics.modelRiskSeconds,
    ));

    // Auto Engine Workers
    tradingWorkerStoppers.push(createTradingWorker(
      tradingQueueNames.portfolioAutoRun,
      tradingAutoPortfolioPayloadSchema.extend({ idempotencyKey: z.string() }),
      async (payload) => {
        await processPortfolioAutoRun(payload);
      },
      tradingMetrics.portfolioAutoRunSeconds,
    ));
    tradingWorkerStoppers.push(createTradingWorker(
      tradingQueueNames.signalAutoRun,
      tradingAutoSignalPayloadSchema.extend({ idempotencyKey: z.string() }),
      async (payload) => {
        await processSignalAutoRun({
          ...payload,
          selectAllAssets: payload.selectAllAssets ?? false,
        });
      },
      tradingMetrics.signalAutoRunSeconds,
    ));
    
    server = app.listen(PORT, '0.0.0.0', () => {
      logger.info({ 
        port: PORT, 
        embeddingsConfigured: true, // Embeddings via GPU Manager Service (Gate 2)
        fineTuningConfigured: true, // Fine-tuning LoRA via gpu-trainer (prioridade baixa)
        circuitBreaker: 'enabled',
      }, 'Training service iniciado com Circuit Breaker');

      startTrainingMetricsScheduler();
      logger.info({ intervalMs: TRAINING_METRICS_INTERVAL_MS }, 'Scheduler de mÃ©tricas de training iniciado');
      startTrainingImmutableAuditIntegrityScheduler();
      logger.info(
        { intervalMs: TRAINING_IMMUTABLE_AUDIT_CHECK_INTERVAL_MS },
        'Scheduler de verificacao de integridade do ledger imutavel iniciado'
      );
      startNamespaceProfileReconcileScheduler();
      logger.info(
        { intervalMs: NAMESPACE_PROFILE_RECONCILE_INTERVAL_MS },
        'Scheduler de reconciliaÃ§Ã£o de namespace_profiles iniciado'
      );

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

      // Retomar jobs pendentes apÃ³s restart (Regra 6: sem dependÃªncia de state em memÃ³ria)
      trainingJobLifecycleService.resumePendingFineTuningJobs().catch((error: unknown) => {
        const errObj = error instanceof Error ? error : new Error(String(error));
        logger.error({ err: errObj }, 'Falha ao retomar jobs de fine-tuning pendentes');
      });
      trainingJobLifecycleService.resumePendingLoraJobs().catch((error: unknown) => {
        const errObj = error instanceof Error ? error : new Error(String(error));
        logger.error({ err: errObj }, 'Falha ao retomar jobs de trading LoRA pendentes');
      });

      // Tick periÃ³dico: garante execuÃ§Ã£o de jobs criados por scheduler/rotas mesmo apÃ³s long uptimes
      setInterval(() => {
        trainingJobLifecycleService.resumePendingFineTuningJobs().catch(() => {});
        trainingJobLifecycleService.resumePendingLoraJobs().catch(() => {});
      }, 30000);
    });

    // SEGURANÃ‡A: Timeouts para prevenir conexÃµes pendentes (Node.js 20 LTS Best Practices)
    // Bulk import pode processar centenas de entradas e exceder 30s.
    // Em produÃ§Ã£o, 30s causava socket close no upstream e 502 no Caddy (EOF).
    server.timeout = TRAINING_HTTP_SERVER_TIMEOUT_MS;
    server.keepAliveTimeout = 65000; // 65s (maior que ALB timeout padrÃ£o de 60s)
    server.headersTimeout = 66000; // Ligeiramente maior que keepAliveTimeout
    logger.info(
      {
        serverTimeoutMs: TRAINING_HTTP_SERVER_TIMEOUT_MS,
        keepAliveTimeoutMs: server.keepAliveTimeout,
        headersTimeoutMs: server.headersTimeout,
      },
      'Timeouts HTTP do training-service configurados'
    );
    
    // ============================================================================
    // GRACEFUL SHUTDOWN (Enterprise-Grade - Regra 16 CLAUDE.md)
    // CORREÃ‡ÃƒO 31/12/2025: Callbacks movidos para dentro do IIFE para garantir
    // que 'server' estÃ¡ definido antes de registrar o callback
    // ShutdownManager centralizado elimina duplicaÃ§Ã£o de listeners (Regra 6)
    // Ordem: HTTP server â†’ Database pool
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
      'training-immutable-audit-integrity-scheduler',
      async () => {
        if (trainingImmutableAuditIntegrityInterval) {
          clearInterval(trainingImmutableAuditIntegrityInterval);
          trainingImmutableAuditIntegrityInterval = null;
        }
      },
      { priority: ShutdownPriority.BACKGROUND_JOBS }
    );

    registerShutdownCallback(
      'training-namespace-profile-reconcile-scheduler',
      async () => {
        if (namespaceProfileReconcileInterval) {
          clearInterval(namespaceProfileReconcileInterval);
          namespaceProfileReconcileInterval = null;
        }
      },
      { priority: ShutdownPriority.BACKGROUND_JOBS }
    );

    registerShutdownCallback(
      'training-trading-workers',
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
        logger.info('Encerrando pool de conexÃµes database...');
        await closeDatabasePool();
        logger.info('Pool de conexÃµes encerrado com sucesso');
      },
      { priority: ShutdownPriority.DATABASE }
    );
    
  } catch (error) {
    logger.fatal({ error: error instanceof Error ? error.message : String(error) }, 
      'âŒ FATAL: Falha ao conectar ao PostgreSQL - training-service nÃ£o pode iniciar');
    process.exit(1);
  }
})();




