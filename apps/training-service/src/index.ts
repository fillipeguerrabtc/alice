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

/* eslint-disable no-irregular-whitespace -- legacy text encoding needs dedicated cleanup */
import express from 'express';
import type { Request, Response } from 'express';
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
  requirePermission,
  requireInternalHmacAuth,
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
  cosineSimilarity,
  generateInternalAuthHeaders,
} from '@alice/shared-utils';
import { trainingServicePaths, trainingServiceSchemas } from './openapi-specs.js';
import { eq, and, or, desc, asc, sql, isNull, not, inArray, lte, ne } from '@alice/database';
import { z } from 'zod';
import {
  getAllSystemConfig,
  getSystemConfig,
  setSystemConfig,
  SYSTEM_CONFIG_KNOWN_KEYS,
} from '@alice/database/system-config';
import {
  NamespaceProfileConfigSchema,
  TradingTechniqueSchema,
  TradingLoraHyperparamsSchema,
  type TradingSignalMetadata,
  type NamespaceProfileConfig,
  type TradingTechnique,
  type TradingLoraHyperparams,
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

import { activateLoraAdapter, getActiveAdapter, deactivateLoraAdapter } from './lora-job-manager.js';
import { resolveScope } from './scope-resolver.js';
import { selectExamplesByProfile } from './dataset-selection-engine.js';
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
  TrainingHyperparamsOverrideSchema,
} from './training-runner.js';
import { loadTrainingEnterpriseConfig } from './training-config.js';
import {
  canPromoteFineTuningJob,
  getTenantInflightFineTuningJobsCount,
  loadTrainingGovernanceRuntimeConfig,
} from './training-governance.js';
import {
  assertValidModelRegistryScope,
  buildFineTuningScopeCondition,
  buildModelVersionScopeCondition,
} from './model-registry-scope.js';
import {
  acquireTrainingOperationLock,
  buildTrainingJobOperationLockKey,
  buildTrainingScopeOperationLockKey,
  extractRequestIp,
  extractRequestUserAgent,
  releaseTrainingOperationLock,
} from './training-enterprise-controls.js';
import { validateWebhookSignature } from './webhook-security.js';
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

function readUuidFromUnknown(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
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

let trainingMetricsInterval: NodeJS.Timeout | null = null;
let namespaceProfileReconcileInterval: NodeJS.Timeout | null = null;
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
app.use(express.json({ limit: '10mb' }));

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
    model: 'Qwen/Qwen3-Embedding-0.6B (1024 dim â†’ Qdrant)',
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
// /live: Processo estÃ¡ vivo? Se nÃ£o, Kubernetes reinicia o container
// /ready: Pronto para trÃ¡fego? Verifica conexÃ£o com PostgreSQL e circuit breakers
// ============================================================================

// Liveness probe - verificaÃ§Ã£o simples que o processo responde
app.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ 
    status: 'alive', 
    service: 'training-service',
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe - verifica se PostgreSQL e embeddings estÃ£o acessÃ­veis
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
        reason: !dbHealthy ? 'PostgreSQL nÃ£o estÃ¡ acessÃ­vel' : 'Embeddings circuit breaker aberto',
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
      reason: 'Erro ao verificar dependÃªncias',
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/internal/trading/enqueue/universe-scan', requireInternalHmacAuth(), async (req: Request, res: Response) => {
  const payload = tradingUniverseEnqueueSchema.parse(req.body);
  await enqueueTradingJob(tradingQueueNames.universe, payload);
  logger.info({ tenantId: payload.tenantId, instrumentId: payload.instrumentId, queue: tradingQueueNames.universe }, 'Trading universe scan enfileirado');
  res.status(202).json({ queued: true, queue: tradingQueueNames.universe, idempotencyKey: payload.idempotencyKey });
});

app.post('/internal/trading/enqueue/backtest', requireInternalHmacAuth(), async (req: Request, res: Response) => {
  const payload = tradingBacktestEnqueueSchema.parse(req.body);
  await enqueueTradingJob(tradingQueueNames.backtest, payload);
  logger.info({ tenantId: payload.tenantId, strategyKey: payload.strategyKey, queue: tradingQueueNames.backtest }, 'Trading backtest enfileirado');
  res.status(202).json({ queued: true, queue: tradingQueueNames.backtest, idempotencyKey: payload.idempotencyKey });
});

app.post('/internal/trading/enqueue/calibration', requireInternalHmacAuth(), async (req: Request, res: Response) => {
  const payload = tradingCalibrationEnqueueSchema.parse(req.body);
  await enqueueTradingJob(tradingQueueNames.calibration, payload);
  logger.info({ tenantId: payload.tenantId, strategyKey: payload.strategyKey, queue: tradingQueueNames.calibration }, 'Trading calibration enfileirado');
  res.status(202).json({ queued: true, queue: tradingQueueNames.calibration, idempotencyKey: payload.idempotencyKey });
});

app.post('/internal/trading/enqueue/portfolio-rebalance', requireInternalHmacAuth(), async (req: Request, res: Response) => {
  const payload = tradingRebalanceEnqueueSchema.parse(req.body);
  await enqueueTradingJob(tradingQueueNames.rebalance, payload);
  logger.info({ tenantId: payload.tenantId, portfolioId: payload.portfolioId, queue: tradingQueueNames.rebalance }, 'Trading rebalance enfileirado');
  res.status(202).json({ queued: true, queue: tradingQueueNames.rebalance, idempotencyKey: payload.idempotencyKey });
});

app.post('/internal/trading/enqueue/model-risk', requireInternalHmacAuth(), async (req: Request, res: Response) => {
  const payload = tradingModelRiskEnqueueSchema.parse(req.body);
  await enqueueTradingJob(tradingQueueNames.modelRisk, payload);
  logger.info({ tenantId: payload.tenantId, scope: payload.scope, scopeKey: payload.scopeKey, queue: tradingQueueNames.modelRisk }, 'Trading model risk enfileirado');
  res.status(202).json({ queued: true, queue: tradingQueueNames.modelRisk, idempotencyKey: payload.idempotencyKey });
});

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
    const [trainingSummary] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.trainingData)
      .where(and(
        eq(schema.trainingData.tenantId, run.tenantId),
        eq(schema.trainingData.namespaceId, trainingNamespaceId),
        eq(schema.trainingData.status, 'approved'),
      ));
    if (Number(trainingSummary?.count ?? 0) <= 0) {
      throw new Error('TRADING_SCOPE_REQUIRED: Dataset aprovado de Trading Ã© obrigatÃ³rio para Auto Engine.');
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

/** POST /internal/trading/auto/portfolio-run - Recebe job de pipeline de portfÃ³lio */
app.post('/internal/trading/auto/portfolio-run', requireInternalHmacAuth(), async (req: Request, res: Response) => {
  try {
    const payload = tradingAutoPortfolioPayloadSchema.parse(req.body);
    const idempotencyKey = buildTradingIdempotencyKey(tradingQueueNames.portfolioAutoRun, payload);
    await enqueueTradingJob(tradingQueueNames.portfolioAutoRun, { ...payload, idempotencyKey });
    logger.info({ runId: payload.runId, correlationId: payload.correlationId }, 'Portfolio auto run enfileirado');
    res.status(202).json({ queued: true, queue: tradingQueueNames.portfolioAutoRun });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao enfileirar portfolio auto run');
    res.status(500).json({ error: errorMessage });
  }
});

/** POST /internal/trading/auto/signal-run - Recebe job de geraÃ§Ã£o automÃ¡tica de sinais */
app.post('/internal/trading/auto/signal-run', requireInternalHmacAuth(), async (req: Request, res: Response) => {
  try {
    const payload = tradingAutoSignalPayloadSchema.parse(req.body);
    const idempotencyKey = buildTradingIdempotencyKey(tradingQueueNames.signalAutoRun, payload);
    await enqueueTradingJob(tradingQueueNames.signalAutoRun, { ...payload, idempotencyKey });
    logger.info({ runId: payload.runId, correlationId: payload.correlationId }, 'Signal auto run enfileirado');
    res.status(202).json({ queued: true, queue: tradingQueueNames.signalAutoRun });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    logger.error({ error: errorMessage }, 'Erro ao enfileirar signal auto run');
    res.status(500).json({ error: errorMessage });
  }
});

// ============================================================================
// SYSTEM CONFIG - ConfiguraÃ§Ãµes editÃ¡veis via UI (RAG, Chat, Treino)
// Ref: docs/TREINAMENTO-LIMITES-E-BOAS-PRATICAS.md
// ============================================================================
app.get('/api/training/system-config', requirePermission('config:system:read'), async (_req: Request, res: Response) => {
  try {
    const config = await getAllSystemConfig();
    res.json(config);
  } catch (error) {
    logger.error({ error }, 'Erro ao obter system config');
    res.status(500).json({ error: 'Erro ao obter configuraÃ§Ãµes' });
  }
});

const systemConfigPatchSchema = z.object({
  configs: z.record(z.string().min(1)),
});

const SYSTEM_CONFIG_PATCH_KEYS = [...SYSTEM_CONFIG_KNOWN_KEYS] as const;

app.patch('/api/training/system-config', requirePermission('config:system:write'), async (req: Request, res: Response) => {
  try {
    const body = systemConfigPatchSchema.parse(req.body);
    for (const [key, value] of Object.entries(body.configs)) {
      if (SYSTEM_CONFIG_PATCH_KEYS.includes(key as (typeof SYSTEM_CONFIG_PATCH_KEYS)[number])) {
        await setSystemConfig(key, String(value));
      }
    }
    const config = await getAllSystemConfig();
    res.json(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Payload invÃ¡lido', details: error.flatten() });
      return;
    }
    logger.error({ error }, 'Erro ao atualizar system config');
    res.status(500).json({ error: 'Erro ao atualizar configuraÃ§Ãµes' });
  }
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
  const raw = await getSystemConfig('NAMESPACE_PROFILE_DEFAULT_CONFIG_JSON');
  if (!raw) {
    throw new Error('NAMESPACE_PROFILE_DEFAULT_CONFIG_JSON ausente no system_config');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `JSON invÃ¡lido em NAMESPACE_PROFILE_DEFAULT_CONFIG_JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return NamespaceProfileConfigSchema.parse(parsed);
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

app.post('/api/training/data', requirePermission('training:training_data:write'), async (req: Request, res: Response) => {
  try {
    const body = collectTrainingDataSchema.parse(req.body);
    const tenantResolution = resolveAuthorizedTenantId(req, body.tenantId);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    const resolvedTenantId = tenantResolution.tenantId;
    const createdBy = tenantResolution.authContext.userId ?? undefined;

    // SEGURANÃ‡A: ValidaÃ§Ã£o cross-tenant - namespaceId/agentId do body devem pertencer ao tenant
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
        return res.status(403).json({ error: 'namespace_profile_auto_collect_disabled' });
      }
    }

    if (sourceType === 'chat' && body.source === 'chat-auto' && namespaceProfile.config.autoCollect.requiresUserConsent) {
      const sourceMetadataUserId = typeof body.sourceMetadata?.['userId'] === 'string' ? body.sourceMetadata['userId'] : null;
      const userIdForConsent = sourceMetadataUserId ?? createdBy ?? null;
      if (!userIdForConsent) {
        trainingPipelineMetrics.consentRejectedTotal.inc();
        return res.status(403).json({ error: 'user_opt_out' });
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
        return res.status(403).json({ error: 'user_opt_out' });
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
    const qualityScore = computeQualityScore(messagesForStorage);
    const idempotencyKey = buildTrainingIdempotencyKey({
      tenantId: resolvedTenantId,
      sourceType,
      sourceId: body.sourceId ?? null,
      semhash,
    });

    const qualityMinScore = namespaceProfile.config.quality.minScore;
    const qualityAutoReject = namespaceProfile.config.quality.autoRejectBelowMin;
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
        status: 'rejected',
        reviewNotes: [
          reviewNotes,
          !namespaceProfile.exists ? 'Namespace profile ausente; item em modo restritivo.' : null,
          privacyResult.action === 'reject' ? 'privacy_policy_match' : null,
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

      return res.json({
        trainingData,
        queued: false,
        idempotencyKey,
        isDuplicate: false,
        duplicateOfId: null,
        similarityScore: null,
      });
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

      return res.json({
        trainingData: existingByFingerprint,
        queued: !alreadyProcessed && existingByFingerprint.status === 'pending',
        idempotencyKey,
        idempotencyHit: true,
        isDuplicate: Boolean(existingByFingerprint.isDuplicate),
        duplicateOfId: existingByFingerprint.duplicateOfId,
        similarityScore: existingByFingerprint.similarityScore ?? null,
      });
    }

    const [trainingData] = await db.insert(schema.trainingData).values({
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
      },
      inferredNamespaceId: scope.namespaceId,
      inferredAgentId: scope.agentId,
      inferredDomain: scope.domain,
      inferenceConfidence: scope.confidence,
      inferenceTrace: scope.trace,
      scopeResolverVersion: 'v1',
      profileVersion: namespaceProfile.profileVersion,
      needsHumanReview: scope.needsHumanReview || !namespaceProfile.exists || privacyResult.action === 'quarantine',
      quarantineReason: privacyResult.action === 'quarantine'
        ? 'privacy_policy_match'
        : !namespaceProfile.exists
          ? 'missing_namespace_profile'
          : scope.needsHumanReview
            ? 'low_confidence_or_missing_namespace'
            : null,
      scopeResolvedAt: new Date(),
      quarantinedAt: scope.needsHumanReview || !namespaceProfile.exists || privacyResult.action === 'quarantine' ? new Date() : null,
      messages: messagesForStorage,
      rating: body.rating,
      qualityScore,
      createdBy,
      semhash,
      embedding: null,
      isDuplicate: false,
      duplicateOfId: null,
      similarityScore: null,
      status: 'pending',
      reviewNotes: [
        ...inferredStatusNotes,
        !namespaceProfile.exists ? 'Namespace profile ausente; reconcile solicitado.' : null,
        privacyResult.action === 'quarantine' ? 'privacy_policy_match' : null,
      ].filter(Boolean).join(' | ') || null,
    }).returning();

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

      trainingPipelineMetrics.dataCollectedTotal.labels(sourceType, 'rejected').inc();
      trainingPipelineMetrics.dataRejectedTotal.labels('duplicate', sourceType).inc();
      trainingPipelineMetrics.qualityScore.observe(qualityScore);
      trainingPipelineMetrics.dataDuplicatesTotal.labels(sourceType).inc();

      logger.info({
        trainingDataId: updatedDuplicate.id,
        queued: false,
        idempotencyKey,
      }, 'RequisiÃ§Ã£o idempotente duplicada sem novo enqueue');

      return res.json({
        trainingData: updatedDuplicate,
        queued: false,
        idempotencyKey,
        idempotencyHit: true,
        isDuplicate: true,
        duplicateOfId: updatedDuplicate.duplicateOfId,
        similarityScore: updatedDuplicate.similarityScore,
      });
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

    res.json({ 
      trainingData, 
      queued,
      idempotencyKey,
      isDuplicate: false,
      duplicateOfId: null,
      similarityScore: null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Payload invalido', details: error.flatten() });
    }
    logger.error({ error }, 'Falha ao coletar dados de treinamento');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/training/data', requirePermission('training:training_data:read'), async (req: Request, res: Response) => {
  // OWASP API3: ValidaÃ§Ã£o de query params
  const queryResult = trainingDataQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'ParÃ¢metros invÃ¡lidos', details: queryResult.error.format() });
  }
  const { status, namespaceId, agentId, inferredDomain, needsHumanReview, sourceType } = queryResult.data;

  try {
    const tenantResolution = resolveAuthorizedTenantId(req);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }

    const conditions = [eq(schema.trainingData.tenantId, tenantResolution.tenantId)];
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

// OWASP API3 - Schema para validaÃ§Ã£o de parÃ¢metros de rota (UUID)
const uuidParamSchema = z.object({
  id: z.string().uuid('ID deve ser um UUID vÃ¡lido'),
});

// OWASP API3 - Schema para validaÃ§Ã£o de status
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

const promotionApprovalBodySchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().max(2000).optional(),
});

const rollbackBodySchema = z.object({
  reason: z.string().trim().min(10).max(500),
});

async function getPromotionApprovalSummary(params: {
  tenantId: string;
  fineTuningJobId: string;
  requesterUserId: string;
}): Promise<{
  approvedDistinctUsersCount: number;
  requesterHasApproved: boolean;
  approvals: Array<{
    approverUserId: string;
    decision: 'approved' | 'rejected';
    reason: string | null;
    updatedAt: Date;
  }>;
}> {
  const approvals = await db.query.fineTuningPromotionApprovals.findMany({
    where: and(
      eq(schema.fineTuningPromotionApprovals.tenantId, params.tenantId),
      eq(schema.fineTuningPromotionApprovals.fineTuningJobId, params.fineTuningJobId)
    ),
    orderBy: [desc(schema.fineTuningPromotionApprovals.updatedAt)],
  });

  const approvedDistinctUsersCount = approvals
    .filter((approval) => approval.decision === 'approved')
    .length;
  const requesterHasApproved = approvals.some((approval) => (
    approval.approverUserId === params.requesterUserId
    && approval.decision === 'approved'
  ));

  return {
    approvedDistinctUsersCount,
    requesterHasApproved,
    approvals: approvals.map((approval) => ({
      approverUserId: approval.approverUserId,
      decision: approval.decision,
      reason: approval.reason,
      updatedAt: approval.updatedAt,
    })),
  };
}

type TrainingGovernanceAuditAction =
  | 'training_promotion_approval_recorded'
  | 'training_model_promoted'
  | 'training_model_rollback_executed'
  | 'training_run_start_requested';
const TRAINING_GOVERNANCE_AUDIT_ACTIONS: TrainingGovernanceAuditAction[] = [
  'training_promotion_approval_recorded',
  'training_model_promoted',
  'training_model_rollback_executed',
  'training_run_start_requested',
];

function buildTrainingGovernanceAuditValues(params: {
  tenantId: string;
  userId: string | null;
  action: TrainingGovernanceAuditAction;
  resourceId: string;
  request: Request;
  details: Record<string, unknown>;
}) {
  return {
    tenantId: params.tenantId,
    userId: params.userId,
    acao: params.action,
    recurso: 'fine_tuning_job',
    recursoId: params.resourceId,
    detalhes: params.details,
    ip: extractRequestIp(params.request),
    userAgent: extractRequestUserAgent(params.request),
  };
}

app.patch('/api/training/data/:id/status', requirePermission('training:training_data:manage'), async (req: Request, res: Response) => {
  // OWASP API3: ValidaÃ§Ã£o Zod obrigatÃ³ria de parÃ¢metros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID invÃ¡lido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;
  
  // OWASP API3: ValidaÃ§Ã£o de body
  const bodyResult = statusUpdateSchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({ error: 'Status invÃ¡lido', details: bodyResult.error.format() });
  }
  const { status, reviewNotes, overrideScope } = bodyResult.data;
  const tenantResolution = resolveAuthorizedTenantId(req);
  if (!tenantResolution.ok) {
    return res.status(tenantResolution.status).json({ error: tenantResolution.error });
  }
  const reviewedBy = tenantResolution.authContext.userId;

  try {
    const existing = await db.query.trainingData.findFirst({
      where: eq(schema.trainingData.id, id),
    });

    if (!existing) {
      return res.status(404).json({ error: 'Registro de treinamento nÃ£o encontrado' });
    }

    if (existing.tenantId !== tenantResolution.tenantId) {
      return res.status(403).json({ error: 'Registro de treinamento nao pertence ao tenant autenticado' });
    }

    if (!existing.namespaceId && status === 'approved' && !overrideScope?.namespaceId) {
      return res.status(400).json({
        error: 'NÃ£o Ã© possÃ­vel aprovar sem namespace definido. Resolva o escopo primeiro.',
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
        return res.status(400).json({ error: 'Motivo Ã© obrigatÃ³rio para override de escopo' });
      }

      if (overrideScope.namespaceId) {
        const namespace = await db.query.namespaces.findFirst({
          where: eq(schema.namespaces.id, overrideScope.namespaceId),
          columns: { id: true, tenantId: true },
        });
        if (!namespace || namespace.tenantId !== existing.tenantId) {
          return res.status(403).json({ error: 'Namespace de override invÃ¡lido para o tenant do item' });
        }
        nextNamespaceId = namespace.id;
      }

      if (overrideScope.agentId) {
        const agent = await db.query.agents.findFirst({
          where: eq(schema.agents.id, overrideScope.agentId),
          columns: { id: true, tenantId: true, namespaceId: true },
        });
        if (!agent || agent.tenantId !== existing.tenantId) {
          return res.status(403).json({ error: 'Agente de override invÃ¡lido para o tenant do item' });
        }
        if (nextNamespaceId && agent.namespaceId && agent.namespaceId !== nextNamespaceId) {
          return res.status(403).json({ error: 'Agente selecionado nÃ£o pertence ao namespace alvo' });
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
            error: 'Item sem tenant vÃ¡lido nÃ£o pode receber override de escopo',
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

    const reviewedAt = new Date();
    const [updated] = await db.update(schema.trainingData)
      .set({ 
        status: status as 'approved' | 'rejected',
        processadoEm: reviewedAt,
        processedAt: reviewedAt,
        reviewedBy,
        reviewedAt,
        reviewNotes: reviewNotes ?? null,
        namespaceId: nextNamespaceId,
        agentId: nextAgentId,
        inferredDomain: nextDomain,
        needsHumanReview: false,
        quarantineReason: null,
        quarantinedAt: null,
      })
      .where(and(
        eq(schema.trainingData.id, id),
        eq(schema.trainingData.tenantId, tenantResolution.tenantId)
      ))
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
    return res.status(400).json({ error: 'ID invÃ¡lido', details: paramsResult.error.format() });
  }
  const bodyResult = resolveScopeSchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({ error: 'Payload invÃ¡lido', details: bodyResult.error.format() });
  }

  const tenantResolution = resolveAuthorizedTenantId(req);
  if (!tenantResolution.ok) {
    return res.status(tenantResolution.status).json({ error: tenantResolution.error });
  }
  const changedBy = tenantResolution.authContext.userId;
  if (!changedBy) {
    return res.status(403).json({ error: 'UsuÃ¡rio nÃ£o identificado para resolver escopo' });
  }

  try {
    const existing = await db.query.trainingData.findFirst({
      where: eq(schema.trainingData.id, paramsResult.data.id),
    });
    if (!existing) {
      return res.status(404).json({ error: 'Registro de treinamento nÃ£o encontrado' });
    }
    if (existing.tenantId !== tenantResolution.tenantId) {
      return res.status(403).json({ error: 'Registro de treinamento nao pertence ao tenant autenticado' });
    }
    if (!existing.tenantId) {
      return res.status(400).json({ error: 'Item sem tenant vÃ¡lido nÃ£o pode ser resolvido' });
    }

    const namespace = await db.query.namespaces.findFirst({
      where: eq(schema.namespaces.id, bodyResult.data.namespaceId),
      columns: { id: true, tenantId: true },
    });
    if (!namespace || namespace.tenantId !== existing.tenantId) {
      return res.status(403).json({ error: 'Namespace nÃ£o pertence ao tenant do item' });
    }

    const nextAgentId: string | null = bodyResult.data.agentId ?? null;
    if (nextAgentId) {
      const agent = await db.query.agents.findFirst({
        where: eq(schema.agents.id, nextAgentId),
        columns: { id: true, tenantId: true, namespaceId: true },
      });
      if (!agent || agent.tenantId !== existing.tenantId) {
        return res.status(403).json({ error: 'Agente invÃ¡lido para o tenant do item' });
      }
      if (agent.namespaceId && agent.namespaceId !== namespace.id) {
        return res.status(403).json({ error: 'Agente nÃ£o pertence ao namespace informado' });
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
      .where(and(
        eq(schema.trainingData.id, existing.id),
        eq(schema.trainingData.tenantId, tenantResolution.tenantId)
      ))
      .returning();

    return res.json({ trainingData: updated });
  } catch (error) {
    logger.error({ error }, 'Falha ao resolver escopo em quarentena');
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/training/jobs', requirePermission('training:fine_tuning_jobs:read'), async (req: Request, res: Response) => {
  // OWASP API3: ValidaÃ§Ã£o de query params
  const queryResult = jobsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'ParÃ¢metros invÃ¡lidos', details: queryResult.error.format() });
  }
  const { tenantId } = queryResult.data;

  try {
    const tenantResolution = resolveAuthorizedTenantId(req, tenantId);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }

    const jobs = await db.query.fineTuningJobs.findMany({
      where: eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId),
      orderBy: [desc(schema.fineTuningJobs.criadoEm)],
      limit: 50,
    });

    res.json({ jobs });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar jobs');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

const createJobSchema = z.object({
  tenantId: z.string().uuid().optional(),
  namespaceId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  domain: z.string().min(1).max(120).optional(),
  name: z.string().min(1),
  baseModel: z.string().default(GPU_MANAGER_CONFIG.models.llm),
  hyperparameters: TrainingHyperparamsOverrideSchema.optional(),
  hyperparametersPreset: z.enum(['safe', 'standard', 'large']).optional(),
  forceMinSize: z.boolean().optional(),
});

app.post('/api/training/jobs', requirePermission('training:fine_tuning_jobs:start'), async (req: Request, res: Response) => {
  try {
    const body = createJobSchema.parse(req.body);
    const tenantResolution = resolveAuthorizedTenantId(req, body.tenantId ?? null);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    const authorizedTenantId = tenantResolution.tenantId;

    const namespace = await db.query.namespaces.findFirst({
      where: eq(schema.namespaces.id, body.namespaceId),
      columns: { id: true, tenantId: true },
    });
    if (!namespace) {
      return res.status(404).json({ error: 'Namespace nao encontrado' });
    }
    if (body.tenantId && namespace.tenantId !== body.tenantId) {
      return res.status(403).json({ error: 'Namespace nao pertence ao tenant informado' });
    }
    const tenantId = authorizedTenantId;
    if (namespace.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Namespace nao pertence ao tenant autenticado' });
    }
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant invalido para criacao de job de treinamento' });
    }

    const redis = getRedisClient();
    let lockHandle: Awaited<ReturnType<typeof acquireTrainingOperationLock>> = null;
    if (!redis) {
      trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
        operation: 'run_start',
        result: 'redis_unavailable',
      });
      return res.status(503).json({ error: 'Redis indisponivel para controle de concorrencia de inicio de treino' });
    }
    const startLockKey = buildTrainingScopeOperationLockKey({
      scope: {
        tenantId,
        namespaceId: null,
        agentId: null,
      },
      operation: 'run_start',
    });
    lockHandle = await acquireTrainingOperationLock({
      redis,
      key: startLockKey,
      ttlSeconds: 300,
    });
    if (!lockHandle) {
      trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
        operation: 'run_start',
        result: 'contention',
      });
      return res.status(409).json({ error: 'Ja existe inicializacao de treino em andamento para este tenant' });
    }
    trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
      operation: 'run_start',
      result: 'acquired',
    });

    try {
      const governanceConfig = await loadTrainingGovernanceRuntimeConfig();
      const inflightCount = await getTenantInflightFineTuningJobsCount(db, tenantId);
      if (inflightCount >= governanceConfig.maxInflightRunsPerTenant) {
        return res.status(429).json({
          error: 'Capacidade de treinamento esgotada para este tenant',
          inflightCount,
          maxInflightRunsPerTenant: governanceConfig.maxInflightRunsPerTenant,
        });
      }

      if (body.agentId) {
        const agent = await db.query.agents.findFirst({
          where: eq(schema.agents.id, body.agentId),
          columns: { id: true, tenantId: true, namespaceId: true },
        });
        if (!agent || agent.tenantId !== tenantId) {
          return res.status(403).json({ error: 'Agente invalido para o tenant autenticado' });
        }
        if (agent.namespaceId && agent.namespaceId !== namespace.id) {
          return res.status(403).json({ error: 'Agente nao pertence ao namespace informado' });
        }
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

    const [trainingRuntimeConfig, trainingEnterpriseConfig] = await Promise.all([
      loadTrainingSystemRuntimeConfig(),
      loadTrainingEnterpriseConfig(),
    ]);
    const minRequired = body.forceMinSize ? 1 : trainingEnterpriseConfig.minOndemandDatasetSize;
    if (approvedData.length < minRequired) {
      return res.status(400).json({
        error: 'Dados de treinamento insuficientes',
        required: minRequired,
        available: approvedData.length,
        hint: body.forceMinSize ? 'Poucos exemplos podem prejudicar o modelo. Use por sua conta e risco.' : undefined,
      });
    }

    const selectedPreset = body.hyperparametersPreset ?? 'standard';
    const presetHyperparameters = trainingRuntimeConfig.presets[selectedPreset];
    const jobHyperparameters: TradingLoraHyperparams = TradingLoraHyperparamsSchema.parse({
      ...trainingRuntimeConfig.defaultHyperparams,
      ...presetHyperparameters,
      ...(body.hyperparameters ?? {}),
    });

    const [loraJob] = await db.insert(schema.loraJobs).values({
      tenantId,
      scopeType: body.agentId ? 'agent' : 'namespace',
      scopeNamespaceId: body.namespaceId,
      scopeAgentId: body.agentId ?? null,
      source: 'explicit_job',
      name: `${body.name} (linked LoRA)`,
      description: 'Job LoRA vinculado ao fine_tuning_jobs',
      baseModel: body.baseModel,
      status: 'queued',
      datasetCount: approvedData.length,
      includeTradingDataset: false,
      hyperparameters: jobHyperparameters,
    }).returning({ id: schema.loraJobs.id });

    const [job] = await db.insert(schema.fineTuningJobs).values({
      tenantId,
      name: body.name,
      baseModel: body.baseModel,
      status: 'pending',
      runSource: 'custom_job',
      trainingDataCount: approvedData.length,
      loraJobId: loraJob.id,
      scopeNamespaceId: body.namespaceId,
      scopeAgentId: body.agentId ?? null,
      configSnapshot: {
        runSource: 'custom_job',
        execution: {
          trigger: 'manual',
          profile: 'advanced_job',
        },
        priority: 'normal',
        scope: {
          namespaceId: body.namespaceId,
          agentId: body.agentId ?? null,
          domain: body.domain ?? null,
        },
        hyperparametersPreset: selectedPreset,
        hyperparameters: jobHyperparameters,
        minDatasetSizeUsed: minRequired,
      },
      hyperparameters: jobHyperparameters,
      metrics: {
        scope: {
          namespaceId: body.namespaceId,
          agentId: body.agentId ?? null,
          domain: body.domain ?? null,
        },
      },
      evaluationStatus: 'pending',
      promotionStatus: 'candidate',
    }).returning();

    const enqueueResult = await enqueueTrainingFineTuningRun({
      fineTuningJobId: job.id,
      tenantId,
      priority: 'normal',
      requestedBy: tenantResolution.authContext.userId ?? null,
    });

    try {
      await db.insert(schema.auditLogs).values(buildTrainingGovernanceAuditValues({
        tenantId,
        userId: tenantResolution.authContext.userId ?? null,
        action: 'training_run_start_requested',
        resourceId: job.id,
        request: req,
        details: {
          source: 'custom_job',
          after: {
            status: job.status,
            promotionStatus: job.promotionStatus,
            trainingDataCount: job.trainingDataCount,
            scopeNamespaceId: job.scopeNamespaceId,
            scopeAgentId: job.scopeAgentId,
          },
          metadata: {
            operation: 'run_start',
            queuePriority: 'normal',
            runSource: 'custom_job',
          },
        },
      }));
      trainingPipelineMetrics.governanceAuditWritesTotal.inc({
        action: 'training_run_start_requested',
        result: 'success',
      });
    } catch (auditError) {
      trainingPipelineMetrics.governanceAuditWritesTotal.inc({
        action: 'training_run_start_requested',
        result: 'failure',
      });
      logger.error(
        {
          error: auditError instanceof Error ? auditError.message : String(auditError),
          tenantId,
          jobId: job.id,
        },
        'Falha ao registrar auditoria de inicio de treino (job customizado)'
      );
    }

      logger.info({
        jobId: job.id,
        loraJobId: loraJob.id,
        dataCount: approvedData.length,
        scope: { tenantId, namespaceId: body.namespaceId, agentId: body.agentId ?? null },
        profileVersion: profileSelection.profileVersion,
        enqueued: enqueueResult.enqueued,
        queueRunId: enqueueResult.runId,
      }, 'Job de fine-tuning criado e enfileirado');

      return res.status(202).json({
        job,
        loraJobId: loraJob.id,
        enqueued: enqueueResult.enqueued,
        profileSelection: profileSelection.diagnostics,
      });
    } finally {
      if (lockHandle) {
        try {
          await releaseTrainingOperationLock({
            redis,
            handle: lockHandle,
          });
        } catch (releaseError) {
          logger.error(
            {
              error: releaseError instanceof Error ? releaseError.message : String(releaseError),
              tenantId,
            },
            'Falha ao liberar lock de inicializacao de treino (job customizado)'
          );
        }
      }
    }
  } catch (error) {
    logger.error({ error }, 'Falha ao criar job');
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// NOTA: Nao usamos polling in-memory. Estado e persistido em DB e retomado no startup.

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
    if (!job.tenantId) {
      logger.warn({ jobId: job.id }, 'Ignorando reenqueue de fine_tuning_job sem tenantId');
      continue;
    }
    try {
      const enqueueResult = await enqueueTrainingFineTuningRun({
        fineTuningJobId: job.id,
        tenantId: job.tenantId,
        priority: resolveFineTuningQueuePriorityFromSnapshot(job.runSource, job.configSnapshot),
      });
      logger.info(
        {
          jobId: job.id,
          enqueued: enqueueResult.enqueued,
          queueRunId: enqueueResult.runId,
        },
        'fine_tuning_job pendente reenfileirado'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ jobId: job.id, error: msg }, 'Falha ao reenfileirar fine_tuning_job');
    }
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

  if (pending.length > 0) {
    logger.info(
      { count: pending.length },
      'lora_jobs pendentes detectados; execucao ocorre via fila de fine_tuning'
    );
  }
}
// Polling removido (Regra 6): cancelamento e progresso sÃ£o tratados via DB + gpu-trainer

app.get('/api/training/jobs/:id', requirePermission('training:fine_tuning_jobs:read'), async (req: Request, res: Response) => {
  // OWASP API3: ValidaÃ§Ã£o Zod obrigatÃ³ria de parÃ¢metros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID invÃ¡lido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;

  try {
    const tenantResolution = resolveAuthorizedTenantId(req);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }

    const job = await db.query.fineTuningJobs.findFirst({
      where: and(
        eq(schema.fineTuningJobs.id, id),
        eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId)
      ),
    });

    if (!job) {
      return res.status(404).json({ error: 'Job nÃ£o encontrado' });
    }

    res.json({ job });
  } catch (error) {
    logger.error({ error }, 'Falha ao buscar job');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.delete('/api/training/jobs/:id', requirePermission('training:fine_tuning_jobs:cancel'), async (req: Request, res: Response) => {
  // OWASP API3: ValidaÃ§Ã£o Zod obrigatÃ³ria de parÃ¢metros de rota
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID invÃ¡lido', details: paramsResult.error.format() });
  }
  const { id } = paramsResult.data;

  try {
    const tenantResolution = resolveAuthorizedTenantId(req);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }

    const job = await db.query.fineTuningJobs.findFirst({
      where: and(
        eq(schema.fineTuningJobs.id, id),
        eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId)
      ),
    });

    if (!job) {
      return res.status(404).json({ error: 'Job nÃ£o encontrado' });
    }

    if (job.status === 'completed' || job.status === 'cancelled') {
      return res.status(400).json({ error: 'Job jÃ¡ finalizado ou cancelado' });
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
      .where(and(
        eq(schema.fineTuningJobs.id, id),
        eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId)
      ))
      .returning();

    logger.info({ jobId: id }, 'Job de fine-tuning cancelado');
    res.json({ job: updated });
  } catch (error) {
    logger.error({ error }, 'Falha ao cancelar job');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/training/jobs/:id/promotion-approvals', requirePermission('training:fine_tuning_jobs:read'), async (req: Request, res: Response) => {
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID invalido', details: paramsResult.error.format() });
  }

  try {
    const tenantResolution = resolveAuthorizedTenantId(req);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    if (!tenantResolution.authContext.userId) {
      return res.status(403).json({ error: 'Usuario nao identificado para leitura de aprovacoes' });
    }

    const fineTuningJob = await db.query.fineTuningJobs.findFirst({
      where: and(
        eq(schema.fineTuningJobs.id, paramsResult.data.id),
        eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId)
      ),
      columns: { id: true },
    });
    if (!fineTuningJob) {
      return res.status(404).json({ error: 'Job de fine-tuning nao encontrado' });
    }

    const summary = await getPromotionApprovalSummary({
      tenantId: tenantResolution.tenantId,
      fineTuningJobId: fineTuningJob.id,
      requesterUserId: tenantResolution.authContext.userId,
    });
    return res.json(summary);
  } catch (error) {
    logger.error({ error, jobId: req.params.id }, 'Falha ao consultar aprovacoes de promocao');
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/training/jobs/:id/audit-trail', requirePermission('training:fine_tuning_jobs:read'), async (req: Request, res: Response) => {
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID invalido', details: paramsResult.error.format() });
  }

  try {
    const tenantResolution = resolveAuthorizedTenantId(req);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }

    const fineTuningJob = await db.query.fineTuningJobs.findFirst({
      where: and(
        eq(schema.fineTuningJobs.id, paramsResult.data.id),
        eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId)
      ),
      columns: { id: true },
    });
    if (!fineTuningJob) {
      return res.status(404).json({ error: 'Job de fine-tuning nao encontrado' });
    }

    const events = await db.query.auditLogs.findMany({
      where: and(
        eq(schema.auditLogs.tenantId, tenantResolution.tenantId),
        eq(schema.auditLogs.recurso, 'fine_tuning_job'),
        eq(schema.auditLogs.recursoId, fineTuningJob.id),
        inArray(schema.auditLogs.acao, TRAINING_GOVERNANCE_AUDIT_ACTIONS)
      ),
      orderBy: [desc(schema.auditLogs.criadoEm)],
      limit: 100,
    });

    const userIds = Array.from(new Set(
      events
        .map((event) => event.userId)
        .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0)
    ));
    const users = userIds.length > 0
      ? await db.query.users.findMany({
        where: inArray(schema.users.id, userIds),
        columns: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      })
      : [];
    const usersById = new Map(users.map((user) => [user.id, user]));

    return res.json({
      events: events.map((event) => {
        const user = event.userId ? usersById.get(event.userId) : undefined;
        return {
          id: event.id,
          action: event.acao,
          resourceId: event.recursoId,
          details: event.detalhes,
          ip: event.ip,
          userAgent: event.userAgent,
          createdAt: event.criadoEm,
          user: user ? {
            id: user.id,
            name: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email || user.id,
            email: user.email,
          } : null,
        };
      }),
    });
  } catch (error) {
    logger.error({ error, jobId: req.params.id }, 'Falha ao consultar trilha de auditoria de training');
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/training/jobs/:id/promotion-approval', requirePermission('training:fine_tuning_jobs:start'), async (req: Request, res: Response) => {
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID invalido', details: paramsResult.error.format() });
  }
  const bodyResult = promotionApprovalBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({ error: 'Payload invalido', details: bodyResult.error.format() });
  }

  const redis = getRedisClient();
  let lockHandle: Awaited<ReturnType<typeof acquireTrainingOperationLock>> = null;

  try {
    const tenantResolution = resolveAuthorizedTenantId(req);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    if (!tenantResolution.authContext.userId) {
      return res.status(403).json({ error: 'Usuario nao identificado para aprovar promocao' });
    }

    const fineTuningJob = await db.query.fineTuningJobs.findFirst({
      where: and(
        eq(schema.fineTuningJobs.id, paramsResult.data.id),
        eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId)
      ),
      columns: { id: true, status: true },
    });
    if (!fineTuningJob) {
      return res.status(404).json({ error: 'Job de fine-tuning nao encontrado' });
    }
    if (fineTuningJob.status !== 'completed') {
      return res.status(409).json({ error: 'Somente jobs concluidos podem receber aprovacao de promocao' });
    }

    if (!redis) {
      trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
        operation: 'promotion_approval',
        result: 'redis_unavailable',
      });
      return res.status(503).json({ error: 'Redis indisponivel para controle de concorrencia de aprovacao' });
    }
    const lockKey = buildTrainingJobOperationLockKey({
      tenantId: tenantResolution.tenantId,
      fineTuningJobId: fineTuningJob.id,
      operation: 'promotion_approval',
    });
    lockHandle = await acquireTrainingOperationLock({
      redis,
      key: lockKey,
      ttlSeconds: TRAINING_OPERATION_LOCK_TTL_SECONDS,
    });
    if (!lockHandle) {
      trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
        operation: 'promotion_approval',
        result: 'lock_conflict',
      });
      return res.status(409).json({ error: 'Aprovacao de promocao em andamento para este job; tente novamente' });
    }
    trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
      operation: 'promotion_approval',
      result: 'acquired',
    });

    const now = new Date();
    await db.transaction(async (tx) => {
      const existingApproval = await tx.query.fineTuningPromotionApprovals.findFirst({
        where: and(
          eq(schema.fineTuningPromotionApprovals.tenantId, tenantResolution.tenantId),
          eq(schema.fineTuningPromotionApprovals.fineTuningJobId, fineTuningJob.id),
          eq(schema.fineTuningPromotionApprovals.approverUserId, tenantResolution.authContext.userId)
        ),
        columns: {
          decision: true,
          reason: true,
          updatedAt: true,
        },
      });

      await tx.insert(schema.fineTuningPromotionApprovals).values({
        tenantId: tenantResolution.tenantId,
        fineTuningJobId: fineTuningJob.id,
        approverUserId: tenantResolution.authContext.userId,
        decision: bodyResult.data.decision,
        reason: bodyResult.data.reason ?? null,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [
          schema.fineTuningPromotionApprovals.fineTuningJobId,
          schema.fineTuningPromotionApprovals.approverUserId,
        ],
        set: {
          decision: bodyResult.data.decision,
          reason: bodyResult.data.reason ?? null,
          updatedAt: now,
        },
      });

      await tx.insert(schema.auditLogs).values(buildTrainingGovernanceAuditValues({
        tenantId: tenantResolution.tenantId,
        userId: tenantResolution.authContext.userId,
        action: 'training_promotion_approval_recorded',
        resourceId: fineTuningJob.id,
        request: req,
        details: {
          before: existingApproval ? {
            decision: existingApproval.decision,
            reason: existingApproval.reason,
            updatedAt: existingApproval.updatedAt.toISOString(),
          } : undefined,
          after: {
            decision: bodyResult.data.decision,
            reason: bodyResult.data.reason ?? null,
          },
          reason: bodyResult.data.reason ?? undefined,
          metadata: {
            operation: 'promotion_approval',
          },
        },
      }));
    });
    trainingPipelineMetrics.governanceAuditWritesTotal.inc({
      action: 'training_promotion_approval_recorded',
      result: 'success',
    });

    const summary = await getPromotionApprovalSummary({
      tenantId: tenantResolution.tenantId,
      fineTuningJobId: fineTuningJob.id,
      requesterUserId: tenantResolution.authContext.userId,
    });

    return res.json({
      success: true,
      ...summary,
    });
  } catch (error) {
    logger.error({ error, jobId: req.params.id }, 'Falha ao registrar aprovacao de promocao');
    return res.status(500).json({ error: 'Erro interno do servidor' });
  } finally {
    if (redis && lockHandle) {
      await releaseTrainingOperationLock({ redis, handle: lockHandle }).catch((lockError) => {
        logger.warn(
          { lockKey: lockHandle?.key, error: lockError instanceof Error ? lockError.message : String(lockError) },
          'Falha ao liberar lock de aprovacao de promocao'
        );
      });
    }
  }
});

app.post('/api/training/jobs/:id/promote', requirePermission('training:fine_tuning_jobs:start'), async (req: Request, res: Response) => {
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID invalido', details: paramsResult.error.format() });
  }

  const redis = getRedisClient();
  let lockHandle: Awaited<ReturnType<typeof acquireTrainingOperationLock>> = null;

  try {
    const tenantResolution = resolveAuthorizedTenantId(req);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    if (!tenantResolution.authContext.userId) {
      return res.status(403).json({ error: 'Usuario nao identificado para promocao' });
    }

    const fineTuningJob = await db.query.fineTuningJobs.findFirst({
      where: and(
        eq(schema.fineTuningJobs.id, paramsResult.data.id),
        eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId)
      ),
    });
    if (!fineTuningJob) {
      return res.status(404).json({ error: 'Job de fine-tuning nao encontrado' });
    }
    if (fineTuningJob.status !== 'completed') {
      return res.status(409).json({ error: 'Somente jobs concluidos podem ser promovidos' });
    }
    if (!fineTuningJob.loraJobId) {
      return res.status(409).json({ error: 'Job sem loraJobId vinculado' });
    }
    if (fineTuningJob.promotionStatus === 'active' && fineTuningJob.modelVersionId) {
      const activeVersion = await db.query.modelVersions.findFirst({
        where: and(
          eq(schema.modelVersions.id, fineTuningJob.modelVersionId),
          eq(schema.modelVersions.tenantId, tenantResolution.tenantId),
          eq(schema.modelVersions.isActive, true)
        ),
      });
      if (activeVersion) {
        return res.json({
          success: true,
          alreadyActive: true,
          fineTuningJobId: fineTuningJob.id,
          modelVersion: activeVersion,
        });
      }
    }
    if (fineTuningJob.promotionStatus === 'active') {
      return res.status(409).json({ error: 'Job ja esta com promocao ativa neste escopo' });
    }
    let scopedModelRegistry: ReturnType<typeof assertValidModelRegistryScope>;
    try {
      scopedModelRegistry = assertValidModelRegistryScope({
        namespaceId: fineTuningJob.scopeNamespaceId,
        agentId: fineTuningJob.scopeAgentId,
      });
    } catch (scopeError) {
      return res.status(409).json({
        error: scopeError instanceof Error ? scopeError.message : 'Escopo de promocao invalido',
      });
    }
    const governanceConfig = await loadTrainingGovernanceRuntimeConfig();
    const evaluationStatus = fineTuningJob.evaluationStatus ?? 'pending';
    const approvalSummary = await getPromotionApprovalSummary({
      tenantId: tenantResolution.tenantId,
      fineTuningJobId: fineTuningJob.id,
      requesterUserId: tenantResolution.authContext.userId,
    });
    const promotionCheck = canPromoteFineTuningJob({
      evaluationStatus,
      requireEvalPassedForPromotion: governanceConfig.requireEvalPassedForPromotion,
      requireDualApprovalForPromotion: governanceConfig.requireDualApprovalForPromotion,
      promotionMinApprovals: governanceConfig.promotionMinApprovals,
      approvedDistinctUsersCount: approvalSummary.approvedDistinctUsersCount,
      requesterHasApproved: approvalSummary.requesterHasApproved,
    });
    if (!promotionCheck.allowed) {
      return res.status(409).json({
        error: promotionCheck.reason,
        approvals: {
          approvedDistinctUsersCount: approvalSummary.approvedDistinctUsersCount,
          requesterHasApproved: approvalSummary.requesterHasApproved,
          minApprovals: governanceConfig.promotionMinApprovals,
          requireDualApprovalForPromotion: governanceConfig.requireDualApprovalForPromotion,
        },
      });
    }

    if (!redis) {
      trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
        operation: 'promote',
        result: 'redis_unavailable',
      });
      return res.status(503).json({ error: 'Redis indisponivel para controle de concorrencia de promocao' });
    }
    const lockKey = buildTrainingScopeOperationLockKey({
      scope: {
        tenantId: tenantResolution.tenantId,
        namespaceId: scopedModelRegistry.namespaceId,
        agentId: scopedModelRegistry.agentId,
      },
      operation: 'promote',
    });
    lockHandle = await acquireTrainingOperationLock({
      redis,
      key: lockKey,
      ttlSeconds: TRAINING_OPERATION_LOCK_TTL_SECONDS,
    });
    if (!lockHandle) {
      trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
        operation: 'promote',
        result: 'lock_conflict',
      });
      return res.status(409).json({ error: 'Promocao em andamento neste escopo; tente novamente' });
    }
    trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
      operation: 'promote',
      result: 'acquired',
    });

    const activationResult = await activateLoraAdapter(
      fineTuningJob.loraJobId,
      tenantResolution.authContext.userId
    );

    const modelVersionScopeCondition = buildModelVersionScopeCondition(scopedModelRegistry);
    const fineJobScopeCondition = buildFineTuningScopeCondition(scopedModelRegistry);

    const [modelVersion] = await db.transaction(async (tx) => {
      const latestScopedVersion = await tx.query.modelVersions.findFirst({
        where: and(
          eq(schema.modelVersions.tenantId, tenantResolution.tenantId),
          modelVersionScopeCondition
        ),
        orderBy: [desc(schema.modelVersions.version)],
        columns: { version: true },
      });

      await tx.update(schema.modelVersions)
        .set({
          isActive: false,
          status: 'deprecated',
          deprecadoEm: new Date(),
        })
        .where(and(
          eq(schema.modelVersions.tenantId, tenantResolution.tenantId),
          modelVersionScopeCondition,
          eq(schema.modelVersions.isActive, true)
        ));

      await tx.update(schema.fineTuningJobs)
        .set({ promotionStatus: 'staged' })
        .where(and(
          eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId),
          fineJobScopeCondition,
          eq(schema.fineTuningJobs.promotionStatus, 'active')
        ));

      const nextVersion = (latestScopedVersion?.version ?? 0) + 1;
      const jobMetrics = (fineTuningJob.metrics ?? {}) as Record<string, unknown>;
      const datasetMetrics = typeof jobMetrics.dataset === 'object' && jobMetrics.dataset !== null
        ? (jobMetrics.dataset as Record<string, unknown>)
        : {};
      const imagesUsedRaw = datasetMetrics.imagesUsed;
      const imageDataCount = typeof imagesUsedRaw === 'number' && Number.isFinite(imagesUsedRaw)
        ? imagesUsedRaw
        : 0;
      const [createdVersion] = await tx.insert(schema.modelVersions).values({
        tenantId: tenantResolution.tenantId,
        namespaceId: scopedModelRegistry.namespaceId,
        agentId: scopedModelRegistry.agentId,
        name: `${fineTuningJob.name}-v${nextVersion}`,
        version: nextVersion,
        baseModel: fineTuningJob.baseModel,
        loraPath: activationResult.adapterPath,
        status: 'active',
        fineTuningJobId: fineTuningJob.id,
        trainingDataCount: fineTuningJob.trainingDataCount ?? 0,
        imageDataCount,
        metrics: jobMetrics,
        baselineMetrics: {},
        isActive: true,
        ativadoEm: new Date(),
      }).returning();

      await tx.update(schema.fineTuningJobs)
        .set({
          modelVersionId: createdVersion.id,
          promotionStatus: 'active',
        })
        .where(eq(schema.fineTuningJobs.id, fineTuningJob.id));

      await tx.insert(schema.auditLogs).values(buildTrainingGovernanceAuditValues({
        tenantId: tenantResolution.tenantId,
        userId: tenantResolution.authContext.userId,
        action: 'training_model_promoted',
        resourceId: fineTuningJob.id,
        request: req,
        details: {
          after: {
            modelVersionId: createdVersion.id,
            promotionStatus: 'active',
          },
          metadata: {
            operation: 'promote',
            scope: scopedModelRegistry,
            loraJobId: fineTuningJob.loraJobId,
            approvedDistinctUsersCount: approvalSummary.approvedDistinctUsersCount,
            requesterHasApproved: approvalSummary.requesterHasApproved,
          },
        },
      }));

      return [createdVersion];
    });
    trainingPipelineMetrics.governanceAuditWritesTotal.inc({
      action: 'training_model_promoted',
      result: 'success',
    });

    logger.info(
      {
        fineTuningJobId: fineTuningJob.id,
        loraJobId: fineTuningJob.loraJobId,
        modelVersionId: modelVersion.id,
      },
      'Promocao de modelo concluida'
    );

    return res.json({
      success: true,
      fineTuningJobId: fineTuningJob.id,
      modelVersion,
      activation: activationResult,
      approvals: {
        approvedDistinctUsersCount: approvalSummary.approvedDistinctUsersCount,
        requesterHasApproved: approvalSummary.requesterHasApproved,
        minApprovals: governanceConfig.promotionMinApprovals,
        requireDualApprovalForPromotion: governanceConfig.requireDualApprovalForPromotion,
      },
    });
  } catch (error) {
    logger.error({ error, jobId: req.params.id }, 'Falha ao promover modelo');
    return res.status(500).json({ error: 'Erro interno do servidor' });
  } finally {
    if (redis && lockHandle) {
      await releaseTrainingOperationLock({ redis, handle: lockHandle }).catch((lockError) => {
        logger.warn(
          { lockKey: lockHandle?.key, error: lockError instanceof Error ? lockError.message : String(lockError) },
          'Falha ao liberar lock de promocao'
        );
      });
    }
  }
});

app.post('/api/training/jobs/:id/rollback', requirePermission('training:fine_tuning_jobs:start'), async (req: Request, res: Response) => {
  const paramsResult = uuidParamSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'ID invalido', details: paramsResult.error.format() });
  }
  const bodyResult = rollbackBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({ error: 'Payload invalido', details: bodyResult.error.format() });
  }
  const rollbackReason = bodyResult.data.reason.trim();

  const redis = getRedisClient();
  let lockHandle: Awaited<ReturnType<typeof acquireTrainingOperationLock>> = null;

  try {
    const tenantResolution = resolveAuthorizedTenantId(req);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    if (!tenantResolution.authContext.userId) {
      return res.status(403).json({ error: 'Usuario nao identificado para rollback' });
    }

    const currentJob = await db.query.fineTuningJobs.findFirst({
      where: and(
        eq(schema.fineTuningJobs.id, paramsResult.data.id),
        eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId)
      ),
    });
    if (!currentJob) {
      return res.status(404).json({ error: 'Job de fine-tuning nao encontrado' });
    }
    if (!currentJob.modelVersionId) {
      return res.status(409).json({ error: 'Job sem modelVersionId para rollback' });
    }

    const currentVersion = await db.query.modelVersions.findFirst({
      where: and(
        eq(schema.modelVersions.id, currentJob.modelVersionId),
        eq(schema.modelVersions.tenantId, tenantResolution.tenantId)
      ),
    });
    if (!currentVersion) {
      return res.status(404).json({ error: 'Model version atual nao encontrada' });
    }
    if (!currentVersion.isActive) {
      return res.status(409).json({ error: 'Somente model version ativa pode sofrer rollback' });
    }
    if (currentJob.promotionStatus !== 'active') {
      return res.status(409).json({ error: 'Somente job com promocao ativa pode sofrer rollback' });
    }

    let scopedModelRegistry: ReturnType<typeof assertValidModelRegistryScope>;
    try {
      scopedModelRegistry = assertValidModelRegistryScope({
        namespaceId: currentVersion.namespaceId,
        agentId: currentVersion.agentId,
      });
    } catch (scopeError) {
      return res.status(409).json({
        error: scopeError instanceof Error ? scopeError.message : 'Escopo do model version invalido para rollback',
      });
    }

    if (!redis) {
      trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
        operation: 'rollback',
        result: 'redis_unavailable',
      });
      return res.status(503).json({ error: 'Redis indisponivel para controle de concorrencia de rollback' });
    }
    const lockKey = buildTrainingScopeOperationLockKey({
      scope: {
        tenantId: tenantResolution.tenantId,
        namespaceId: scopedModelRegistry.namespaceId,
        agentId: scopedModelRegistry.agentId,
      },
      operation: 'rollback',
    });
    lockHandle = await acquireTrainingOperationLock({
      redis,
      key: lockKey,
      ttlSeconds: TRAINING_OPERATION_LOCK_TTL_SECONDS,
    });
    if (!lockHandle) {
      trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
        operation: 'rollback',
        result: 'lock_conflict',
      });
      return res.status(409).json({ error: 'Rollback em andamento neste escopo; tente novamente' });
    }
    trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
      operation: 'rollback',
      result: 'acquired',
    });

    const scopedCondition = buildModelVersionScopeCondition(scopedModelRegistry);
    const previousVersion = await db.query.modelVersions.findFirst({
      where: and(
        eq(schema.modelVersions.tenantId, tenantResolution.tenantId),
        scopedCondition,
        lte(schema.modelVersions.version, currentVersion.version - 1)
      ),
      orderBy: [desc(schema.modelVersions.version)],
    });
    if (!previousVersion || !previousVersion.fineTuningJobId) {
      return res.status(404).json({ error: 'Nao existe versao anterior para rollback neste escopo' });
    }

    const previousJob = await db.query.fineTuningJobs.findFirst({
      where: and(
        eq(schema.fineTuningJobs.id, previousVersion.fineTuningJobId),
        eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId)
      ),
    });
    if (!previousJob?.loraJobId) {
      return res.status(409).json({ error: 'Versao anterior nao possui loraJobId valido' });
    }

    const activationResult = await activateLoraAdapter(
      previousJob.loraJobId,
      tenantResolution.authContext.userId
    );

    await db.transaction(async (tx) => {
      await tx.update(schema.modelVersions)
        .set({
          isActive: false,
          status: 'rolled_back',
          deprecadoEm: new Date(),
          rolledBackFrom: previousVersion.id,
          rolledBackReason: rollbackReason,
        })
        .where(eq(schema.modelVersions.id, currentVersion.id));

      await tx.update(schema.modelVersions)
        .set({
          isActive: true,
          status: 'active',
          ativadoEm: new Date(),
        })
        .where(eq(schema.modelVersions.id, previousVersion.id));

      await tx.update(schema.fineTuningJobs)
        .set({ promotionStatus: 'rolled_back' })
        .where(eq(schema.fineTuningJobs.id, currentJob.id));

      await tx.update(schema.fineTuningJobs)
        .set({ promotionStatus: 'active' })
        .where(eq(schema.fineTuningJobs.id, previousJob.id));

      await tx.insert(schema.auditLogs).values(buildTrainingGovernanceAuditValues({
        tenantId: tenantResolution.tenantId,
        userId: tenantResolution.authContext.userId,
        action: 'training_model_rollback_executed',
        resourceId: currentJob.id,
        request: req,
        details: {
          before: {
            modelVersionId: currentVersion.id,
            promotionStatus: currentJob.promotionStatus,
          },
          after: {
            modelVersionId: previousVersion.id,
            promotionStatus: 'active',
          },
          reason: rollbackReason,
          metadata: {
            operation: 'rollback',
            scope: scopedModelRegistry,
            previousJobId: previousJob.id,
            previousVersion: previousVersion.version,
          },
        },
      }));
    });
    trainingPipelineMetrics.governanceAuditWritesTotal.inc({
      action: 'training_model_rollback_executed',
      result: 'success',
    });

    logger.info(
      {
        currentJobId: currentJob.id,
        previousJobId: previousJob.id,
        previousModelVersionId: previousVersion.id,
      },
      'Rollback de modelo concluido'
    );

    return res.json({
      success: true,
      rolledBackJobId: currentJob.id,
      activeJobId: previousJob.id,
      activeModelVersionId: previousVersion.id,
      activation: activationResult,
    });
  } catch (error) {
    logger.error({ error, jobId: req.params.id }, 'Falha ao executar rollback');
    return res.status(500).json({ error: 'Erro interno do servidor' });
  } finally {
    if (redis && lockHandle) {
      await releaseTrainingOperationLock({ redis, handle: lockHandle }).catch((lockError) => {
        logger.warn(
          { lockKey: lockHandle?.key, error: lockError instanceof Error ? lockError.message : String(lockError) },
          'Falha ao liberar lock de rollback'
        );
      });
    }
  }
});

// ============================================================================
// LoRA ADAPTER MANAGEMENT - AtivaÃ§Ã£o, Consulta e DesativaÃ§Ã£o
// ============================================================================

/**
 * POST /api/training/lora/activate/:jobId
 * Aprova e ativa um adapter LoRA treinado, tornando-o disponÃ­vel para inferÃªncia no vLLM.
 * O adapter Ã© copiado para /opt/alice/data/lora-adapters/trading-global/
 * e o vLLM carrega automaticamente via filesystem resolver (sem restart).
 */
app.post('/api/training/lora/activate/:jobId', requirePermission('training:fine_tuning_jobs:start'), async (req: Request, res: Response) => {
  const paramsResult = uuidParamSchema.safeParse({ id: req.params.jobId });
  if (!paramsResult.success) {
    return res.status(400).json({ error: 'jobId invÃ¡lido', details: paramsResult.error.format() });
  }

  try {
    const tenantResolution = resolveAuthorizedTenantId(req);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    if (!tenantResolution.authContext.userId) {
      return res.status(403).json({ error: 'UsuÃ¡rio nÃ£o identificado para aprovaÃ§Ã£o' });
    }

    const loraJob = await db.query.loraJobs.findFirst({
      where: and(
        eq(schema.loraJobs.id, paramsResult.data.id),
        eq(schema.loraJobs.tenantId, tenantResolution.tenantId)
      ),
      columns: { id: true },
    });
    if (!loraJob) {
      return res.status(404).json({ error: 'Job LoRA nao encontrado para o tenant autenticado' });
    }

    const result = await activateLoraAdapter(paramsResult.data.id, tenantResolution.authContext.userId);
    logger.info({ jobId: paramsResult.data.id, approvedBy: tenantResolution.authContext.userId }, 'Adapter LoRA ativado via endpoint');
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
      return res.status(400).json({ error: 'ParÃ¢metros invÃ¡lidos', details: parsed.error.format() });
    }
    const tenantResolution = resolveAuthorizedTenantId(_req, parsed.data.tenantId ?? null);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    const active = await getActiveAdapter({
      tenantId: tenantResolution.tenantId,
      namespaceId: parsed.data.namespaceId,
      agentId: parsed.data.agentId,
    });
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
      return res.status(400).json({ error: 'Payload invÃ¡lido', details: parsed.error.format() });
    }
    const tenantResolution = resolveAuthorizedTenantId(_req, parsed.data.tenantId ?? null);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    await deactivateLoraAdapter({
      tenantId: tenantResolution.tenantId,
      namespaceId: parsed.data.namespaceId,
      agentId: parsed.data.agentId,
    });
    res.json({ success: true, message: 'Adapter LoRA desativado. vLLM usarÃ¡ modelo base.' });
  } catch (error) {
    logger.error({ error }, 'Falha ao desativar adapter LoRA');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// GPU ORCHESTRATOR PROXY - Estado e retorno (Frontend usa via /api/training/*)
// ============================================================================
// Proxy para GPU Manager Service: frontend nÃ£o tem acesso direto ao GPU Manager.
// Training service autentica com INTERNAL_API_SECRET e repassa requisiÃ§Ãµes.
// Ref: gpu-orchestrator.ts (switchToLlmEmbeddings, getOrchestratorState)
// ============================================================================

const GPU_MANAGER_URL_ORCHESTRATOR = process.env.GPU_MANAGER_URL || 'http://alice-gpu-manager:3010';
const INTERNAL_API_SECRET_ORCHESTRATOR = process.env.INTERNAL_API_SECRET;

app.get('/api/training/gpu-orchestrator/state', requirePermission('training:fine_tuning_jobs:read'), async (_req: Request, res: Response) => {
  if (!INTERNAL_API_SECRET_ORCHESTRATOR) {
    return res.status(503).json({ error: 'ServiÃ§o indisponÃ­vel', orchestratorAvailable: false });
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
    res.status(503).json({ error: 'GPU Manager indisponÃ­vel', orchestratorAvailable: false });
  }
});

app.post('/api/training/gpu-orchestrator/return', requirePermission('training:fine_tuning_jobs:start'), async (_req: Request, res: Response) => {
  if (!INTERNAL_API_SECRET_ORCHESTRATOR) {
    return res.status(503).json({ error: 'ServiÃ§o indisponÃ­vel' });
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
    const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    res.status(r.status).json(data);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Proxy gpu-orchestrator/return falhou');
    res.status(503).json({ error: 'GPU Manager indisponÃ­vel' });
  }
});

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

app.post('/api/training/bulk-import', requirePermission('training:training_data:write'), async (req: Request, res: Response) => {
  try {
    const tenantResolution = resolveAuthorizedTenantId(req);
    
    if (!tenantResolution.ok) {
      logger.warn({ path: req.path }, 'Tentativa de bulk-import sem tenant vÃ¡lido');
      return res.status(403).json({ error: 'Tenant nÃ£o identificado. AutenticaÃ§Ã£o obrigatÃ³ria.' });
    }

    const tenantId = tenantResolution.tenantId;
    const validation = bulkImportSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Dados invÃ¡lidos',
        details: validation.error.issues,
      });
    }

    const { source, sourceType, namespaceId, agentId, domain, data, autoApprove } = validation.data;
    const sourceTypeForImport = sourceType ?? 'external';

    if (namespaceId) {
      try {
        await validateNamespaceTenantConsistency(
          namespaceId,
          tenantId,
          async (id) => getDatabase().query.namespaces.findFirst({
            where: eq(schema.namespaces.id, id),
            columns: { id: true, tenantId: true },
          })
        );
      } catch (validationError) {
        logger.warn({
          tenantId,
          namespaceId,
          error: validationError instanceof Error ? validationError.message : String(validationError),
        }, 'Bulk import rejeitado por namespace fora do tenant');
        return res.status(403).json({ error: 'Namespace invÃ¡lido para o tenant autenticado.' });
      }
    }

    if (agentId) {
      const agent = await db.query.agents.findFirst({
        where: eq(schema.agents.id, agentId),
        columns: { id: true, tenantId: true, namespaceId: true },
      });
      try {
        validateTenantConsistency('agent', agent, tenantId, 'training_bulk_import');
      } catch (validationError) {
        logger.warn({
          tenantId,
          agentId,
          error: validationError instanceof Error ? validationError.message : String(validationError),
        }, 'Bulk import rejeitado por agente fora do tenant');
        return res.status(403).json({ error: 'Agente invÃ¡lido para o tenant autenticado.' });
      }
      if (namespaceId && agent?.namespaceId && agent.namespaceId !== namespaceId) {
        logger.warn({ tenantId, agentId, namespaceId, agentNamespaceId: agent.namespaceId }, 'Bulk import rejeitado por inconsistÃªncia agentId/namespaceId');
        return res.status(403).json({ error: 'O agente informado nÃ£o pertence ao namespace selecionado.' });
      }
    }

    const importedIds: string[] = [];
    const duplicatesSkipped: number[] = [];

    for (let i = 0; i < data.length; i++) {
      const entry = data[i];

      const text = entry.messages.map(m => m.content).join(' ');
      const semhash = computeSemHash(text);

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

      const qualityScore = computeQualityScore(entry.messages);
      const scope = await resolveScope({
        tenantId,
        namespaceId: namespaceId ?? null,
        agentId: agentId ?? null,
        domain: domain ?? null,
        sourceType: sourceTypeForImport,
        sourceMetadata: {
          bulkSource: source,
          bulkSourceType: sourceTypeForImport,
        },
        messagesText: entry.messages.map((m) => m.content).join('\n'),
      });
      if (scope.needsHumanReview) {
        trainingPipelineMetrics.scopeQuarantineTotal.inc({
          source_type: sourceTypeForImport,
          reason: 'low_confidence_or_missing_namespace',
        });
      }
      if (scope.suggestedNewNamespace) {
        trainingPipelineMetrics.scopeSuggestedNewNamespaceTotal.inc({
          source_type: sourceTypeForImport,
        });
      }
      const autoRejectedByQuality = qualityScore < TRAINING_DATA_MIN_QUALITY;
      const status = autoRejectedByQuality
        ? 'rejected'
        : (autoApprove && (entry.rating || 0) >= 4 ? 'approved' : 'pending');
      const reviewNotes = autoRejectedByQuality
        ? `Auto-rejeitado: qualidade ${qualityScore.toFixed(2)} abaixo do mÃ­nimo (${TRAINING_DATA_MIN_QUALITY}).`
        : null;

      const [inserted] = await db.insert(schema.trainingData).values({
        tenantId,
        namespaceId: scope.namespaceId,
        agentId: scope.agentId,
        source: `bulk_import:${source}`,
        sourceType: sourceTypeForImport,
        sourceMetadata: {
          bulkSource: source,
          bulkSourceType: sourceTypeForImport,
        },
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
        embedding: null,
        isDuplicate: false,
      }).returning();

      importedIds.push(inserted.id);

      if (status !== 'rejected') {
        const idempotencyKey = buildTrainingIdempotencyKey({
          tenantId,
          sourceType: sourceTypeForImport,
          sourceId: null,
          semhash,
        });
        const queuePayload = trainingEmbeddingDedupeQueuePayloadSchema.parse({
          trainingDataId: inserted.id,
          tenantId,
          namespaceId: scope.namespaceId ?? undefined,
          agentId: scope.agentId ?? undefined,
          semhash,
          sourceType: sourceTypeForImport,
          sourceId: undefined,
          idempotencyKey,
          createdAt: new Date().toISOString(),
        });
        try {
          await enqueueTrainingEmbeddingDedupeJob(queuePayload);
        } catch (queueError) {
          logger.warn({
            trainingDataId: inserted.id,
            error: queueError instanceof Error ? queueError.message : String(queueError),
          }, 'Falha ao enfileirar job de dedupe/embedding no bulk import');
        }
      }
    }

    logger.info({
      tenantId,
      source,
      sourceType: sourceTypeForImport,
      namespaceId: namespaceId ?? null,
      agentId: agentId ?? null,
      totalReceived: data.length,
      imported: importedIds.length,
      duplicatesSkipped: duplicatesSkipped.length,
      autoApprove,
    }, 'Bulk import concluÃ­do');

    res.status(201).json({
      success: true,
      imported: importedIds.length,
      duplicatesSkipped: duplicatesSkipped.length,
      sourceType: sourceTypeForImport,
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

const webhookInternalHeadersSchema = z.object({
  'x-webhook-secret': z.string().min(1),
  'x-internal-signature': z.string().regex(/^[a-f0-9]{64}$/i),
  'x-internal-timestamp': z.string().regex(/^\d+$/),
  'x-internal-user-id': z.string().min(1),
  'x-internal-tenant-id': z.string().uuid(),
  'x-internal-role': z.string().min(1),
  'x-internal-nonce': z.string().uuid(),
});

const webhookNonceStore = new Map<string, number>();
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;
const WEBHOOK_NONCE_TTL_MS = 10 * 60 * 1000;
const WEBHOOK_NONCE_REDIS_PREFIX = 'alice:training:webhook:nonce';
const webhookNonceCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [nonce, expiresAt] of webhookNonceStore.entries()) {
    if (expiresAt <= now) {
      webhookNonceStore.delete(nonce);
    }
  }
}, 60_000);
webhookNonceCleanupTimer.unref?.();

type WebhookNonceValidationResult = {
  accepted: boolean;
  storage: 'redis' | 'memory';
  result: 'accepted' | 'replay' | 'fallback_after_redis_error';
};

async function validateAndStoreWebhookNonce(params: {
  tenantId: string;
  nonce: string;
}): Promise<WebhookNonceValidationResult> {
  const inMemoryKey = `${params.tenantId}:${params.nonce}`;
  const redis = getRedisClient();

  if (redis) {
    try {
      const redisKey = `${WEBHOOK_NONCE_REDIS_PREFIX}:${params.tenantId}:${params.nonce}`;
      const lock = await redis.set(redisKey, '1', { NX: true, PX: WEBHOOK_NONCE_TTL_MS });
      if (lock !== 'OK') {
        return { accepted: false, storage: 'redis', result: 'replay' };
      }
      return { accepted: true, storage: 'redis', result: 'accepted' };
    } catch (error) {
      logger.error(
        { error, tenantId: params.tenantId },
        'Falha ao validar nonce do webhook no Redis; aplicando fallback em memoria'
      );
      const nonceExpiry = webhookNonceStore.get(inMemoryKey);
      if (nonceExpiry && nonceExpiry > Date.now()) {
        return { accepted: false, storage: 'memory', result: 'replay' };
      }
      webhookNonceStore.set(inMemoryKey, Date.now() + WEBHOOK_NONCE_TTL_MS);
      return { accepted: true, storage: 'memory', result: 'fallback_after_redis_error' };
    }
  }

  const nonceExpiry = webhookNonceStore.get(inMemoryKey);
  if (nonceExpiry && nonceExpiry > Date.now()) {
    return { accepted: false, storage: 'memory', result: 'replay' };
  }
  webhookNonceStore.set(inMemoryKey, Date.now() + WEBHOOK_NONCE_TTL_MS);
  return { accepted: true, storage: 'memory', result: 'accepted' };
}

// OWASP API3 - Schema para aprovaÃ§Ã£o em lote
const batchApproveSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
  action: z.enum(['approve', 'reject']),
  reviewNotes: z.string().max(2000).optional(),
});

// ============================================================================
// OWASP API3 - Schemas Zod para validaÃ§Ã£o de query params
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
  const expectedSecret = process.env.TRAINING_WEBHOOK_SECRET;

  if (!expectedSecret) {
    logger.error('TRAINING_WEBHOOK_SECRET nao configurado - webhook desabilitado por seguranca');
    return res.status(503).json({ error: 'Webhook nao configurado. Configure TRAINING_WEBHOOK_SECRET.' });
  }

  const headersValidation = webhookInternalHeadersSchema.safeParse(req.headers);
  if (!headersValidation.success) {
    logger.warn({ issues: headersValidation.error.issues }, 'Webhook com headers internos invalidos');
    return res.status(401).json({ error: 'Headers internos invalidos' });
  }

  const {
    'x-webhook-secret': webhookSecret,
    'x-internal-signature': internalSignature,
    'x-internal-timestamp': internalTimestamp,
    'x-internal-user-id': internalUserId,
    'x-internal-tenant-id': internalTenantId,
    'x-internal-role': internalRole,
    'x-internal-nonce': internalNonce,
  } = headersValidation.data;

  const secretBuffer = Buffer.from(webhookSecret, 'utf-8');
  const expectedBuffer = Buffer.from(expectedSecret, 'utf-8');
  const lengthsMatch = secretBuffer.length === expectedBuffer.length;
  const secretValid = lengthsMatch && crypto.timingSafeEqual(
    secretBuffer,
    lengthsMatch ? expectedBuffer : Buffer.alloc(secretBuffer.length)
  );

  if (!secretValid) {
    logger.warn({ hasSecret: true }, 'Tentativa de webhook com secret invalido');
    return res.status(401).json({ error: 'Webhook secret invalido' });
  }

  const timestampNum = Number.parseInt(internalTimestamp, 10);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestampNum) || Math.abs(nowSeconds - timestampNum) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
    return res.status(401).json({ error: 'Timestamp interno invalido ou expirado' });
  }

  const signaturePayload = `${internalUserId}:${internalTenantId}:${internalRole}:${internalNonce}:${internalTimestamp}`;
  const signatureValidation = validateWebhookSignature({
    signature: internalSignature,
    payload: signaturePayload,
    webhookSecret: expectedSecret,
    internalApiSecret: process.env.INTERNAL_API_SECRET,
    allowLegacySignature: process.env.TRAINING_WEBHOOK_ALLOW_LEGACY_SIGNATURE === 'true',
  });
  trainingPipelineMetrics.webhookAuthValidationTotal.inc({
    mode: signatureValidation.mode,
    result: signatureValidation.ok ? 'accepted' : 'rejected',
  });
  if (!signatureValidation.ok) {
    return res.status(401).json({ error: 'Assinatura interna invalida' });
  }
  if (signatureValidation.mode === 'legacy_webhook_secret') {
    logger.warn(
      { tenantId: internalTenantId },
      'Webhook autenticado via assinatura legada; migre para assinatura com INTERNAL_API_SECRET'
    );
  }

  const nonceValidation = await validateAndStoreWebhookNonce({
    tenantId: internalTenantId,
    nonce: internalNonce,
  });
  trainingPipelineMetrics.webhookNonceValidationTotal.inc({
    storage: nonceValidation.storage,
    result: nonceValidation.result,
  });
  if (!nonceValidation.accepted) {
    return res.status(409).json({ error: 'Nonce ja utilizado (replay detectado)' });
  }

  const tenantId = internalTenantId;
  const tenant = await db.query.tenants.findFirst({
    where: eq(schema.tenants.id, tenantId),
    columns: { id: true },
  });
  if (!tenant) {
    return res.status(403).json({ error: 'Tenant invalido para webhook' });
  }
  const internalUser = await db.query.users.findFirst({
    where: eq(schema.users.id, internalUserId),
    columns: { id: true, tenantId: true },
  });
  if (!internalUser) {
    return res.status(401).json({ error: 'Usuario interno invalido para webhook' });
  }
  try {
    validateTenantConsistency('user', internalUser, tenantId, 'training_webhook');
  } catch {
    return res.status(403).json({ error: 'Usuario nao pertence ao tenant do webhook' });
  }

  try {
    const validation = webhookSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Payload invÃ¡lido',
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
        ? `Auto-rejeitado: qualidade ${qualityScore.toFixed(2)} abaixo do mÃ­nimo (${TRAINING_DATA_MIN_QUALITY}).`
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
        .where(and(
          eq(schema.trainingData.conversationId, payload.conversationId),
          eq(schema.trainingData.tenantId, tenantId)
        ));

      logger.info({ conversationId: payload.conversationId, rating: payload.rating }, 'Feedback atualizado via webhook');
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Evento nÃ£o suportado ou payload incompleto' });
    }
  } catch (error) {
    logger.error({ error }, 'Falha ao processar webhook');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// APROVAÃ‡ÃƒO EM LOTE
// ============================================================================

app.post('/api/training/data/approve-batch', requirePermission('training:training_data:manage'), async (req: Request, res: Response) => {
  // OWASP API3 - ValidaÃ§Ã£o Zod obrigatÃ³ria
  const parseResult = batchApproveSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Input invÃ¡lido' });
  }
  const { ids, action, reviewNotes } = parseResult.data;
  const tenantResolution = resolveAuthorizedTenantId(req);
  if (!tenantResolution.ok) {
    return res.status(tenantResolution.status).json({ error: tenantResolution.error });
  }
  const reviewedBy = tenantResolution.authContext.userId;

  try {
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    let updatedCount = 0;
    let skippedByQuarantine = 0;
    let skippedByMissingNamespace = 0;
    let skippedByTenantMismatch = 0;

    for (const id of ids) {
      const current = await db.query.trainingData.findFirst({
        where: eq(schema.trainingData.id, id),
        columns: { tenantId: true, needsHumanReview: true, namespaceId: true },
      });
      if (!current) {
        continue;
      }
      if (current.tenantId !== tenantResolution.tenantId) {
        skippedByTenantMismatch += 1;
        continue;
      }

      if (newStatus === 'approved' && current.needsHumanReview) {
        skippedByQuarantine += 1;
        continue;
      }
      if (newStatus === 'approved' && !current.namespaceId) {
        skippedByMissingNamespace += 1;
        continue;
      }

      const reviewedAt = new Date();
      const [updated] = await db.update(schema.trainingData)
        .set({ 
          status: newStatus,
          processadoEm: reviewedAt,
          processedAt: reviewedAt,
          reviewedBy,
          reviewedAt,
          reviewNotes: reviewNotes ?? null,
          needsHumanReview: false,
          quarantineReason: null,
          quarantinedAt: null,
        })
        .where(and(
          eq(schema.trainingData.id, id),
          eq(schema.trainingData.tenantId, tenantResolution.tenantId)
        ))
        .returning();

      if (updated) updatedCount++;
    }

    if (updatedCount > 0) {
      trainingPipelineMetrics.reviewTotal.labels(newStatus).inc(updatedCount);
    }

    logger.info(
      { action, count: updatedCount, skippedByQuarantine, skippedByMissingNamespace, skippedByTenantMismatch },
      'AprovaÃ§Ã£o em lote concluÃ­da'
    );
    res.json({ success: true, updated: updatedCount, skippedByQuarantine, skippedByMissingNamespace, skippedByTenantMismatch });
  } catch (error) {
    logger.error({ error }, 'Falha na aprovaÃ§Ã£o em lote');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// AUTO-LEARNING STATUS
// ============================================================================

app.get('/api/training/auto-learning/status', requirePermission('training:training_data:read'), async (req: Request, res: Response) => {
  // OWASP API3: ValidaÃ§Ã£o de query params
  const queryResult = autoLearningStatusQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'ParÃ¢metros invÃ¡lidos', details: queryResult.error.format() });
  }
  const { tenantId } = queryResult.data;

  try {
    const tenantResolution = resolveAuthorizedTenantId(req, tenantId);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    const scopedTenantId = tenantResolution.tenantId;

    const modelVersions = await db.query.modelVersions.findMany({
      where: eq(schema.modelVersions.tenantId, scopedTenantId),
      orderBy: [desc(schema.modelVersions.version)],
      limit: 10,
    });

    const activeVersion = modelVersions.find((v: typeof schema.modelVersions.$inferSelect) => v.isActive);

    const schedules = await db.query.autoLearningSchedule.findMany({
      where: and(
        eq(schema.autoLearningSchedule.tenantId, scopedTenantId),
        eq(schema.autoLearningSchedule.status, 'scheduled')
      ),
      orderBy: [asc(schema.autoLearningSchedule.scheduledFor)],
      limit: 20,
    });

    const pendingDataConditions = [
      eq(schema.trainingData.status, 'approved'),
      isNull(schema.trainingData.usedInJobId),
    ];
    pendingDataConditions.push(eq(schema.trainingData.tenantId, scopedTenantId));
    
    const pendingData = await db.select({ count: sql<number>`count(*)` })
      .from(schema.trainingData)
      .where(and(...pendingDataConditions));

    const pendingImagesConditions = [
      eq(schema.generatedImages.approvedForTraining, true),
      eq(schema.generatedImages.usedInFineTuning, false),
    ];
    pendingImagesConditions.push(eq(schema.generatedImages.tenantId, scopedTenantId));
    
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
        namespaceId: v.namespaceId ?? null,
        agentId: v.agentId ?? null,
        createdAt: v.criadoEm,
      })),
      upcomingSchedules: schedules
        .filter((s: typeof schema.autoLearningSchedule.$inferSelect) => new Date(s.scheduledFor).getTime() > Date.now())
        .map((s: typeof schema.autoLearningSchedule.$inferSelect) => ({
          id: s.id,
          type: s.scheduleType,
          scheduledFor: s.scheduledFor,
          status: s.status,
          namespaceId: readScheduleScopeMetadata(s.metadata).namespaceId ?? null,
        })),
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter status do auto-learning');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/training/stats', requirePermission('training:training_data:read'), async (req: Request, res: Response) => {
  // OWASP API3: ValidaÃ§Ã£o de query params
  const queryResult = trainingStatsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'ParÃ¢metros invÃ¡lidos', details: queryResult.error.format() });
  }
  const { tenantId } = queryResult.data;

  try {
    const tenantResolution = resolveAuthorizedTenantId(req, tenantId);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    const scopedTenantId = tenantResolution.tenantId;

    const pendingConditions = [eq(schema.trainingData.status, 'pending')];
    pendingConditions.push(eq(schema.trainingData.tenantId, scopedTenantId));
    
    const pendingCount = await db.select({ count: sql<number>`count(*)` })
      .from(schema.trainingData)
      .where(and(...pendingConditions));

    const approvedConditions = [eq(schema.trainingData.status, 'approved')];
    approvedConditions.push(eq(schema.trainingData.tenantId, scopedTenantId));
    
    const approvedCount = await db.select({ count: sql<number>`count(*)` })
      .from(schema.trainingData)
      .where(and(...approvedConditions));

    const duplicateConditions = [eq(schema.trainingData.isDuplicate, true)];
    duplicateConditions.push(eq(schema.trainingData.tenantId, scopedTenantId));
    
    const duplicatesCount = await db.select({ count: sql<number>`count(*)` })
      .from(schema.trainingData)
      .where(and(...duplicateConditions));

    const jobConditions = [eq(schema.fineTuningJobs.status, 'completed')];
    jobConditions.push(eq(schema.fineTuningJobs.tenantId, scopedTenantId));
    
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
    logger.error({ error }, 'Falha ao obter estatÃ­sticas');
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ============================================================================
// Gate 2 (15/01/2026): Training Schedule + On-Demand
// Endpoints enterprise para configurar e executar treinamentos
// ============================================================================

// Schema para configuraÃ§Ã£o de schedule
const scheduleConfigSchema = z.object({
  tenantId: z.string().uuid(),
  scheduleType: z.enum(['incremental_fine_tuning', 'complete_fine_tuning']),
  enabled: z.boolean().default(true),
  cronPattern: z.string().optional(), // Ex: '0 3 * * 0' para domingo Ã s 3h
  minDataRequired: z.number().int().min(1).optional(),
  namespaceId: z.string().uuid().optional().nullable(),
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
 * Configura o agendamento automÃ¡tico de treinamento
 */
app.post('/api/training/schedule/configure', requirePermission('training:training_data:manage'), async (req: Request, res: Response) => {
  const parseResult = scheduleConfigSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Input invï¿½lido', details: parseResult.error.format() });
  }

  const { tenantId, scheduleType, enabled, cronPattern, minDataRequired, namespaceId } = parseResult.data;

  try {
    const tenantResolution = resolveAuthorizedTenantId(req, tenantId);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    const scopedTenantId = tenantResolution.tenantId;
    const scheduleNamespaceId = namespaceId ?? null;

    if (scheduleNamespaceId) {
      const namespace = await db.query.namespaces.findFirst({
        where: eq(schema.namespaces.id, scheduleNamespaceId),
        columns: { id: true, tenantId: true },
      });
      if (!namespace || namespace.tenantId !== scopedTenantId) {
        return res.status(403).json({ error: 'Namespace nao pertence ao tenant autenticado' });
      }
    }

    const [trainingRuntimeConfig, trainingEnterpriseConfig] = await Promise.all([
      loadTrainingSystemRuntimeConfig(),
      loadTrainingEnterpriseConfig(),
    ]);

    const resolvedMinDataRequired = minDataRequired
      ?? (
        scheduleType === 'incremental_fine_tuning'
          ? trainingEnterpriseConfig.minScheduledIncremental
          : trainingEnterpriseConfig.minScheduledFull
      );

    const activeSchedules = await db.query.autoLearningSchedule.findMany({
      where: and(
        eq(schema.autoLearningSchedule.tenantId, scopedTenantId),
        eq(schema.autoLearningSchedule.scheduleType, scheduleType),
        eq(schema.autoLearningSchedule.status, 'scheduled')
      ),
      orderBy: [desc(schema.autoLearningSchedule.criadoEm)],
    });

    const schedulesForScope = activeSchedules.filter((item) =>
      isSameScheduleScope(item.metadata, scheduleNamespaceId)
    );
    const existing = schedulesForScope[0];
    const duplicatedScheduleIds = schedulesForScope.slice(1).map((item) => item.id);

    if (!enabled) {
      if (schedulesForScope.length === 0) {
        return res.json({ success: true, action: 'no_change', scheduleId: null });
      }

      await db.update(schema.autoLearningSchedule)
        .set({
          status: 'skipped',
          completedAt: new Date(),
          errorMessage: null,
        })
        .where(inArray(schema.autoLearningSchedule.id, schedulesForScope.map((item) => item.id)));

      logger.info({
        tenantId: scopedTenantId,
        scheduleType,
        namespaceId: scheduleNamespaceId,
        affectedSchedules: schedulesForScope.length,
      }, 'Schedule de treinamento desabilitado para escopo');

      return res.json({
        success: true,
        action: 'disabled',
        scheduleId: existing?.id ?? null,
        disabledCount: schedulesForScope.length,
      });
    }

    const scheduleMetadata = {
      minDataRequired: resolvedMinDataRequired,
      cronPattern: cronPattern
        ?? (
          scheduleType === 'incremental_fine_tuning'
            ? trainingRuntimeConfig.autoLearningCronIncremental
            : trainingRuntimeConfig.autoLearningCronFull
        ),
      namespaceId: scheduleNamespaceId,
      configuredAt: new Date().toISOString(),
    };

    if (existing) {
      const scheduledFor = calculateNextScheduleDate(scheduleType, scheduleMetadata.cronPattern ?? undefined);

      await db.update(schema.autoLearningSchedule)
        .set({
          scheduledFor,
          status: 'scheduled',
          metadata: scheduleMetadata,
          errorMessage: null,
        })
        .where(eq(schema.autoLearningSchedule.id, existing.id));

      if (duplicatedScheduleIds.length > 0) {
        await db.update(schema.autoLearningSchedule)
          .set({
            status: 'skipped',
            completedAt: new Date(),
            errorMessage: 'Schedule duplicado desativado por reconciliacao de escopo',
          })
          .where(inArray(schema.autoLearningSchedule.id, duplicatedScheduleIds));
      }

      logger.info({
        tenantId: scopedTenantId,
        scheduleType,
        namespaceId: scheduleNamespaceId,
        scheduledFor,
        scheduleId: existing.id,
        minDataRequired: resolvedMinDataRequired,
        skippedDuplicates: duplicatedScheduleIds.length,
      }, 'Schedule de treinamento atualizado');

      return res.json({
        success: true,
        action: 'updated',
        scheduleId: existing.id,
        scheduledFor,
        minDataRequired: resolvedMinDataRequired,
        skippedDuplicates: duplicatedScheduleIds.length,
      });
    }

    const scheduledFor = calculateNextScheduleDate(scheduleType, scheduleMetadata.cronPattern ?? undefined);

    const [newSchedule] = await db.insert(schema.autoLearningSchedule).values({
      tenantId: scopedTenantId,
      scheduleType,
      status: 'scheduled',
      scheduledFor,
      metadata: scheduleMetadata,
    }).returning();

    logger.info({
      tenantId: scopedTenantId,
      scheduleType,
      namespaceId: scheduleNamespaceId,
      scheduledFor,
      scheduleId: newSchedule.id,
      minDataRequired: resolvedMinDataRequired,
    }, 'Schedule de treinamento configurado');

    return res.json({
      success: true,
      action: 'scheduled',
      scheduleId: newSchedule.id,
      scheduledFor,
      minDataRequired: resolvedMinDataRequired,
    });
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
    return res.status(400).json({ error: 'Input invalido', details: parseResult.error.format() });
  }

  const { tenantId, trainingType, includeImages, priority, description, namespaceId } = parseResult.data;

  try {
    const tenantResolution = resolveAuthorizedTenantId(req, tenantId);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    const scopedTenantId = tenantResolution.tenantId;
    const governanceConfig = await loadTrainingGovernanceRuntimeConfig();
    const redis = getRedisClient();
    let lockHandle: Awaited<ReturnType<typeof acquireTrainingOperationLock>> = null;
    if (!redis) {
      trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
        operation: 'run_start',
        result: 'redis_unavailable',
      });
      return res.status(503).json({ error: 'Redis indisponivel para controle de concorrencia de inicio de treino' });
    }
    const startLockKey = buildTrainingScopeOperationLockKey({
      scope: {
        tenantId: scopedTenantId,
        namespaceId: null,
        agentId: null,
      },
      operation: 'run_start',
    });
    lockHandle = await acquireTrainingOperationLock({
      redis,
      key: startLockKey,
      ttlSeconds: 300,
    });
    if (!lockHandle) {
      trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
        operation: 'run_start',
        result: 'contention',
      });
      return res.status(409).json({ error: 'Ja existe inicializacao de treino em andamento para este tenant' });
    }
    trainingPipelineMetrics.governanceLockAttemptsTotal.inc({
      operation: 'run_start',
      result: 'acquired',
    });

    try {
      const runningJobs = await db.query.fineTuningJobs.findMany({
        where: and(
          eq(schema.fineTuningJobs.tenantId, scopedTenantId),
          or(
            eq(schema.fineTuningJobs.status, 'pending'),
            eq(schema.fineTuningJobs.status, 'training'),
            eq(schema.fineTuningJobs.status, 'preparing'),
            eq(schema.fineTuningJobs.status, 'validating')
          )
        ),
      });

      if (runningJobs.length > 0) {
        return res.status(409).json({
          error: 'Ja existe treinamento em andamento ou enfileirado',
          runningJobId: runningJobs[0].id,
        });
      }

      const inflightCount = await getTenantInflightFineTuningJobsCount(db, scopedTenantId);
      if (inflightCount >= governanceConfig.maxInflightRunsPerTenant) {
        return res.status(429).json({
          error: 'Capacidade de treinamento esgotada para este tenant',
          inflightCount,
          maxInflightRunsPerTenant: governanceConfig.maxInflightRunsPerTenant,
        });
      }

    if (namespaceId) {
      const namespace = await db.query.namespaces.findFirst({
        where: eq(schema.namespaces.id, namespaceId),
        columns: { id: true, tenantId: true },
      });
      if (!namespace || namespace.tenantId !== scopedTenantId) {
        return res.status(403).json({ error: 'Namespace nao pertence ao tenant autenticado' });
      }
    }

    const scheduleType = trainingType === 'full' ? 'complete_fine_tuning' : 'incremental_fine_tuning';
    const evaluation = await evaluateDataQuality(
      scheduleType,
      scopedTenantId,
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

    const loraResult = await startProgressiveLoRA(scopedTenantId, {
      includeImages,
      namespaceId,
    });
    await db.update(schema.loraJobs)
      .set({
        description: `on_demand:${scheduleType}:priority:${priority}`,
      })
      .where(eq(schema.loraJobs.id, loraResult.loraJobId));

    const [job] = await db.insert(schema.fineTuningJobs).values({
      tenantId: scopedTenantId,
      name: description || `Treinamento ${trainingType} on-demand`,
      baseModel: GPU_MANAGER_CONFIG.models.llm,
      status: 'pending',
      runSource: 'on_demand',
      trainingDataCount: evaluation.dataCount,
      loraJobId: loraResult.loraJobId,
      scopeNamespaceId: namespaceId ?? null,
      configSnapshot: {
        runSource: 'on_demand',
        execution: {
          trigger: 'manual',
          profile: 'quick_run',
        },
        scheduleType,
        priority,
        includeImages,
        namespaceId: namespaceId ?? null,
        evaluation,
      },
      evaluationStatus: 'pending',
      promotionStatus: 'candidate',
    }).returning();

    const enqueueResult = await enqueueTrainingFineTuningRun({
      fineTuningJobId: job.id,
      tenantId: scopedTenantId,
      priority,
      requestedBy: tenantResolution.authContext.userId ?? null,
    });

      try {
        await db.insert(schema.auditLogs).values(buildTrainingGovernanceAuditValues({
          tenantId: scopedTenantId,
          userId: tenantResolution.authContext.userId ?? null,
          action: 'training_run_start_requested',
          resourceId: job.id,
          request: req,
          details: {
            source: 'on_demand',
            after: {
              status: job.status,
              promotionStatus: job.promotionStatus,
              trainingDataCount: job.trainingDataCount,
              scopeNamespaceId: job.scopeNamespaceId,
              scopeAgentId: job.scopeAgentId,
            },
            metadata: {
              operation: 'run_start',
              queuePriority: priority,
              runSource: 'on_demand',
              includeImages,
              trainingType,
            },
          },
        }));
        trainingPipelineMetrics.governanceAuditWritesTotal.inc({
          action: 'training_run_start_requested',
          result: 'success',
        });
      } catch (auditError) {
        trainingPipelineMetrics.governanceAuditWritesTotal.inc({
          action: 'training_run_start_requested',
          result: 'failure',
        });
        logger.error(
          {
            error: auditError instanceof Error ? auditError.message : String(auditError),
            tenantId: scopedTenantId,
            jobId: job.id,
          },
          'Falha ao registrar auditoria de inicio de treino (on-demand)'
        );
      }

      logger.info({
        jobId: job.id,
        loraJobId: loraResult.loraJobId,
        tenantId: scopedTenantId,
        trainingType,
        priority,
        dataCount: evaluation.dataCount,
        imageCount: evaluation.imageCount,
        enqueued: enqueueResult.enqueued,
        queueRunId: enqueueResult.runId,
      }, 'Treinamento on-demand enfileirado');

      return res.status(202).json({
        success: true,
        jobId: job.id,
        loraJobId: loraResult.loraJobId,
        modelVersionId: loraResult.modelVersionId,
        version: loraResult.version,
        trainingDataUsed: loraResult.trainingDataUsed,
        imagesUsed: loraResult.imagesUsed,
        status: 'queued',
        enqueued: enqueueResult.enqueued,
      });
    } finally {
      if (lockHandle) {
        try {
          await releaseTrainingOperationLock({
            redis,
            handle: lockHandle,
          });
        } catch (releaseError) {
          logger.error(
            {
              error: releaseError instanceof Error ? releaseError.message : String(releaseError),
              tenantId: scopedTenantId,
            },
            'Falha ao liberar lock de inicializacao de treino (on-demand)'
          );
        }
      }
    }
  } catch (error) {
    logger.error({ error }, 'Falha ao iniciar treinamento on-demand');
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * GET /api/training/run/status
 * Obtem status atual do treinamento
 */
app.get('/api/training/run/status', requirePermission('training:training_data:read'), async (req: Request, res: Response) => {
  const queryResult = z.object({ tenantId: z.string().uuid().optional() }).safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'ParÃ¢metros invÃ¡lidos' });
  }
  const { tenantId } = queryResult.data;

  try {
    // Buscar jobs com status 'training' ou 'preparing' (em execuÃ§Ã£o)
    // FIX Bug 1: Incluir 'preparing' na verificaÃ§Ã£o (fase de preparaÃ§Ã£o de dados)
    const tenantResolution = resolveAuthorizedTenantId(req, tenantId);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    const conditions = [
      eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId),
      or(
        eq(schema.fineTuningJobs.status, 'training'),
        eq(schema.fineTuningJobs.status, 'preparing')
      )
    ];

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
 * GET /api/training/queue/status
 * Status enterprise das filas de fine-tuning (prioridades + DLQ + governanÃ§a)
 */
app.get('/api/training/queue/status', requirePermission('training:fine_tuning_jobs:read'), async (req: Request, res: Response) => {
  const queryResult = z.object({ tenantId: z.string().uuid().optional() }).safeParse(req.query);
  if (!queryResult.success) {
    return res.status(400).json({ error: 'Parametros invalidos' });
  }

  try {
    const tenantResolution = resolveAuthorizedTenantId(req, queryResult.data.tenantId ?? null);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }

    const [governanceConfig, queues, inflightCount] = await Promise.all([
      loadTrainingGovernanceRuntimeConfig(),
      getFineTuningQueuesStatus(),
      getTenantInflightFineTuningJobsCount(db, tenantResolution.tenantId),
    ]);

    return res.json({
      queues,
      governance: {
        maxInflightRunsPerTenant: governanceConfig.maxInflightRunsPerTenant,
        requireEvalPassedForPromotion: governanceConfig.requireEvalPassedForPromotion,
        requireDualApprovalForPromotion: governanceConfig.requireDualApprovalForPromotion,
        promotionMinApprovals: governanceConfig.promotionMinApprovals,
      },
      tenant: {
        id: tenantResolution.tenantId,
        inflightCount,
      },
    });
  } catch (error) {
    logger.error({ error }, 'Falha ao obter status das filas de fine-tuning');
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/**
 * GET /api/training/run/history
 * ObtÃ©m histÃ³rico de treinamentos
 */
app.get('/api/training/run/history', requirePermission('training:training_data:read'), async (req: Request, res: Response) => {
  const queryResult = z.object({ 
    tenantId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }).safeParse(req.query);
  
  if (!queryResult.success) {
    return res.status(400).json({ error: 'ParÃ¢metros invÃ¡lidos' });
  }
  const { tenantId, limit } = queryResult.data;

  try {
    const tenantResolution = resolveAuthorizedTenantId(req, tenantId);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }

    const jobs = await db.query.fineTuningJobs.findMany({
      where: eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId),
      orderBy: [desc(schema.fineTuningJobs.criadoEm)],
      limit,
    });

    const history = jobs.map((job: typeof schema.fineTuningJobs.$inferSelect) => ({
      id: job.id,
      jobType: job.name, // name contÃ©m tipo do job (qlora_incremental, etc)
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
    logger.error({ error }, 'Falha ao obter histÃ³rico de treinamentos');
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
    return res.status(400).json({ error: 'Input invÃ¡lido', details: parseResult.error.format() });
  }
  
  const { trainingRunId, reason } = parseResult.data;

  try {
    const tenantResolution = resolveAuthorizedTenantId(req);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }

    const job = await db.query.fineTuningJobs.findFirst({
      where: and(
        eq(schema.fineTuningJobs.id, trainingRunId),
        eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId)
      ),
    });

    if (!job) {
      return res.status(404).json({ error: 'Treinamento nÃ£o encontrado' });
    }

    if (job.status !== 'training' && job.status !== 'pending' && job.status !== 'preparing') {
      return res.status(400).json({ 
        error: 'Treinamento nÃ£o pode ser cancelado',
        currentStatus: job.status,
      });
    }

    await db.update(schema.fineTuningJobs)
      .set({
        status: 'cancelled',
        completadoEm: new Date(),
        errorMessage: reason || 'Cancelado pelo usuÃ¡rio',
      })
      .where(and(
        eq(schema.fineTuningJobs.id, trainingRunId),
        eq(schema.fineTuningJobs.tenantId, tenantResolution.tenantId)
      ));

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

// FunÃ§Ãµes auxiliares para schedule

/**
 * Calcula a prÃ³xima data de execuÃ§Ã£o baseado no cron pattern ou intervalo padrÃ£o.
 * 
 * Suporta padrÃµes cron bÃ¡sicos:
 * - '0 3 * * 0' â†’ Domingo Ã s 3:00 AM
 * - '0 1 1,15 * *' â†’ Dias 1 e 15 de cada mÃªs Ã s 1:00 AM
 * 
 * FIX Bug 3: Agora honra o cronPattern passado pelo usuÃ¡rio
 */
function calculateNextScheduleDate(scheduleType: string, cronPattern?: string): Date {
  const config = scheduleType === 'incremental_fine_tuning'
    ? SCHEDULE_CONFIG.incrementalFineTuning
    : SCHEDULE_CONFIG.completeFineTuning;
  
  // Se nÃ£o tiver cron pattern customizado, usar intervalo padrÃ£o
  if (!cronPattern) {
    return new Date(Date.now() + config.intervalMs);
  }
  
  // Parse bÃ¡sico do cron pattern: 'minuto hora diaDoMes mes diaDaSemana'
  // Exemplo: '0 3 * * 0' = minuto 0, hora 3, qualquer dia do mÃªs, qualquer mÃªs, domingo
  const parts = cronPattern.trim().split(/\s+/);
  if (parts.length !== 5) {
    logger.warn({ cronPattern }, 'Cron pattern invÃ¡lido, usando intervalo padrÃ£o');
    return new Date(Date.now() + config.intervalMs);
  }
  
  const [minute, hour, dayOfMonth, _month, dayOfWeek] = parts;
  const now = new Date();
  const next = new Date(now);
  
  // Configurar hora e minuto
  const targetHour = hour === '*' ? now.getHours() : parseInt(hour, 10);
  const targetMinute = minute === '*' ? 0 : parseInt(minute, 10);
  
  next.setHours(targetHour, targetMinute, 0, 0);
  
  // Se for dia da semana especÃ­fico (ex: '0' = domingo)
  if (dayOfWeek !== '*') {
    const targetDay = parseInt(dayOfWeek, 10); // 0 = domingo, 6 = sÃ¡bado
    let daysUntil = targetDay - now.getDay();
    
    // Se o dia jÃ¡ passou esta semana, ir para prÃ³xima semana
    if (daysUntil < 0 || (daysUntil === 0 && now >= next)) {
      daysUntil += 7;
    }
    
    next.setDate(now.getDate() + daysUntil);
  }
  // Se for dia do mÃªs especÃ­fico (ex: '1,15' = dias 1 e 15)
  else if (dayOfMonth !== '*') {
    const days = dayOfMonth.split(',').map(d => parseInt(d.trim(), 10)).sort((a, b) => a - b);
    const currentDay = now.getDate();
    
    // Encontrar prÃ³ximo dia vÃ¡lido
    let targetDayOfMonth = days.find(d => d > currentDay || (d === currentDay && now < next));
    
    if (targetDayOfMonth === undefined) {
      // Nenhum dia disponÃ­vel este mÃªs, ir para prÃ³ximo mÃªs
      targetDayOfMonth = days[0];
      // FIX Bug 2: Definir dia como 1 ANTES de incrementar mÃªs para evitar overflow
      // Exemplo: 31/Jan + 1 mÃªs = 3/Mar se nÃ£o fizermos isso (Fev nÃ£o tem 31 dias)
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
    }
    
    // FIX Bug 3 (11/01/2026): Verificar se o dia existe no mÃªs alvo
    // Exemplo: Cron '0 1 31 * *' apÃ³s Janeiro â†’ Fevereiro nÃ£o tem dia 31
    // JavaScript Date overflow: setDate(31) em Fevereiro â†’ 3 de MarÃ§o (ERRADO)
    // SoluÃ§Ã£o: AvanÃ§ar meses atÃ© encontrar um que tenha o dia desejado
    const getDaysInMonth = (date: Date): number => {
      // Criar data no primeiro dia do prÃ³ximo mÃªs e subtrair 1 dia
      return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    };
    
    // AvanÃ§ar meses se o dia nÃ£o existir no mÃªs atual (mÃ¡ximo 12 iteraÃ§Ãµes para seguranÃ§a)
    for (let i = 0; i < 12; i++) {
      const daysInMonth = getDaysInMonth(next);
      if (targetDayOfMonth <= daysInMonth) {
        break; // MÃªs atual tem o dia desejado
      }
      // MÃªs nÃ£o tem o dia (ex: Fevereiro nÃ£o tem 31), ir para prÃ³ximo mÃªs
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
    }
    
    next.setDate(targetDayOfMonth);
  }
  // Se jÃ¡ passou o horÃ¡rio de hoje, ir para amanhÃ£
  else if (now >= next) {
    next.setDate(next.getDate() + 1);
  }
  
  logger.debug({ cronPattern, nextSchedule: next.toISOString() }, 'PrÃ³ximo schedule calculado');
  return next;
}

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
      resumePendingFineTuningJobs().catch((error: unknown) => {
        const errObj = error instanceof Error ? error : new Error(String(error));
        logger.error({ err: errObj }, 'Falha ao retomar jobs de fine-tuning pendentes');
      });
      resumePendingLoraJobs().catch((error: unknown) => {
        const errObj = error instanceof Error ? error : new Error(String(error));
        logger.error({ err: errObj }, 'Falha ao retomar jobs de trading LoRA pendentes');
      });

      // Tick periÃ³dico: garante execuÃ§Ã£o de jobs criados por scheduler/rotas mesmo apÃ³s long uptimes
      setInterval(() => {
        resumePendingFineTuningJobs().catch(() => {});
        resumePendingLoraJobs().catch(() => {});
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
