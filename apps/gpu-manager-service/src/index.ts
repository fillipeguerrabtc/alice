/**
 * GPU Manager Service - Alice Enterprise Platform
 * 
 * Serviço centralizado de gerenciamento de requisições GPU com fila priorizada,
 * monitoramento de VRAM, circuit breakers e métricas enterprise.
 * 
 * ARQUITETURA GPU (Gate 2):
 * - LLM (texto), Embeddings e Training são serviços GPU locais
 * - Vision e ASR via OpenAI
 * - Tipos de serviço são **capability-based** (modelo-agnóstico) para que
 *   a troca de modelos não exija mudanças em observabilidade.
 * - GPU Manager mantém fila priorizada, VRAM gates, circuit breakers e métricas.
 * 
 * Funcionalidades mantidas:
 * - Fila Redis com priorização (chat > trading > embeddings > outros)
 * - Monitoramento de VRAM em tempo real (nvidia-smi)
 * - Circuit breakers por serviço GPU
 * - Retry logic com backoff exponencial
 * - Métricas Prometheus (latência, fila, VRAM, erros)
 * - Graceful shutdown
 * - Health checks enterprise
 * 
 * Autor: Fillipe Guerra
 * Data: 16 de Janeiro de 2026
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import compression from 'compression';
import {
  getNodeEnv,
  readNumberEnv,
  readOptionalStringEnv,
} from '@alice/config';
import { 
  getRedisClient,
  isRedisAvailable,
  createAlicePrometheus,
  getCorsConfig,
  requireInternalHmacAuth,
  setupSwaggerUI,
} from '@alice/shared-utils';
import { createLogger } from '@alice/logger';
import { 
  createCorrelationMiddleware, 
  createSecurityMiddleware,
  // createRateLimiter removido - não usado (GPU Manager Service usa autenticação interna)
  createErrorHandler,
  createNotFoundHandler,
  asyncHandler,
} from '@alice/shared-utils';
import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import {
  isOrchestratorAvailable,
  getOrchestratorState,
  onOrchestratorTransition,
  prepareTrainingRuntime,
  restoreServingRuntime,
  shutdownOrchestrator,
  type OrchestratorState,
  type ServingDrainResult,
  type OrchestratorTransition,
  type OrchestratorTransitionTrigger,
  GPU_ORCHESTRATION_MODE,
} from './gpu-orchestrator.js';
import {
  GpuRequestPriority,
  GpuServiceType,
  type GpuRequest,
  type GpuResponse,
  type VramStatus,
} from './gpu-contracts.js';
import {
  admissionControlReason,
  capabilityForServiceType,
  type GpuRejectionReason,
  hasEnoughVram,
} from './gpu-admission.js';
import { createGpuServiceClients, applyStructuredOutputs } from './gpu-service-clients.js';
import { createGpuManagerMetrics } from './gpu-metrics.js';
import { startGpuManagerBootstrap } from './gpu-bootstrap.js';
import { gpuManagerServicePaths, gpuManagerServiceSchemas } from './openapi-specs.js';
import { createGpuRuntimeStateStore } from './gpu-runtime-state-store.js';

export { GpuRequestPriority, GpuServiceType } from './gpu-contracts.js';

const execAsync = promisify(exec);
const logger = createLogger('gpu-manager');
const gpuRuntimeStateStore = createGpuRuntimeStateStore({
  logger,
  sourceService: 'gpu-manager-service',
});

const IS_PRODUCTION = getNodeEnv() === 'production';
const PORT = readNumberEnv('PORT', { defaultValue: 3010, integer: true, min: 1, max: 65535 });
// BUG FIX 26/12/2025: REDIS_URL removido - Redis é configurado via getRedisClient() de @alice/shared-utils
// BUG FIX 25/12/2025: REGRA 6 - Sem fallback em produção - variável DEVE estar definida
// INTERNAL_API_SECRET é obrigatório para autenticação service-to-service
// Fallback para string vazia desabilita autenticação, permitindo requisições não autenticadas
const INTERNAL_API_SECRET = readOptionalStringEnv('INTERNAL_API_SECRET');
if (!INTERNAL_API_SECRET && IS_PRODUCTION) {
  logger.error('INTERNAL_API_SECRET é obrigatório em produção (Regra 6 - fail-fast)');
  process.exit(1);
}

/**
 * GPU_SERVICE_TIMEOUT: Timeout padrão para requisições GPU (ms)
 * Configurável via variável de ambiente para permitir ajustes sem rebuild
 * Default: 60000ms (60s) - suficiente para a maioria das requisições
 * 
 * ENTERPRISE (27/12/2025): Variável lida do docker-compose.prod.yml
 * para permitir configuração dinâmica de timeouts em produção.
 */
const GPU_SERVICE_TIMEOUT = readNumberEnv('GPU_SERVICE_TIMEOUT', {
  defaultValue: 60000,
  integer: true,
  min: 1000,
});
logger.info({ gpuServiceTimeout: GPU_SERVICE_TIMEOUT }, 'Timeout GPU configurado');

/** Orquestrador: disponibilidade verificada uma vez no startup */
let orchestratorAvailable = false;

type RuntimePersistenceEventType =
  | 'state_snapshot'
  | 'switch_requested'
  | 'switch_completed'
  | 'switch_failed'
  | 'manual_restore_requested'
  | 'manual_restore_completed'
  | 'manual_restore_failed';
type RuntimePersistenceTriggerSource = 'startup' | 'queue_request' | 'manual_api' | 'system';
type RuntimePersistenceOutcome = 'success' | 'error';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeUuidCandidate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return UUID_V4_REGEX.test(trimmed) ? trimmed : undefined;
}

function readCorrelationIdFromHeaders(headers: Record<string, string> | undefined): string | undefined {
  const correlationId = headers?.['x-correlation-id'];
  if (!correlationId) return undefined;
  const normalized = correlationId.trim();
  return normalized.length > 0 ? normalized : undefined;
}

async function persistRuntimeSnapshot(params: {
  eventType: RuntimePersistenceEventType;
  triggerSource: RuntimePersistenceTriggerSource;
  outcome?: RuntimePersistenceOutcome;
  requestId?: string;
  correlationId?: string;
  reason?: string;
  actorUserId?: string;
  actorTenantId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const orchestrationMode = GPU_ORCHESTRATION_MODE === 'preemptive' ? 'preemptive' : 'simultaneous';
    await gpuRuntimeStateStore.recordSnapshot({
      orchestratorState: getOrchestratorState(),
      orchestrationMode,
      orchestratorAvailable,
      eventType: params.eventType,
      triggerSource: params.triggerSource,
      outcome: params.outcome ?? 'success',
      requestId: params.requestId,
      correlationId: params.correlationId,
      reason: params.reason,
      actorUserId: normalizeUuidCandidate(params.actorUserId),
      actorTenantId: normalizeUuidCandidate(params.actorTenantId),
      metadata: params.metadata,
    });
  } catch (error) {
    logger.error(
      {
        error,
        eventType: params.eventType,
        triggerSource: params.triggerSource,
      },
      'Falha ao persistir snapshot/evento de runtime GPU'
    );
  }
}

const ORCHESTRATOR_ALLOWED_ROLES = new Set(['admin', 'super_admin', 'superadmin']);
const ORCHESTRATOR_STATES: OrchestratorState[] = [
  'serving_ready',
  'serving_draining',
  'training_starting',
  'training_active',
  'training_finishing',
  'serving_restoring',
  'error',
];

function readHeaderStringValue(headerValue: string | string[] | undefined): string | undefined {
  if (typeof headerValue === 'string') {
    const normalized = headerValue.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  if (Array.isArray(headerValue) && headerValue.length > 0) {
    const first = headerValue[0];
    if (typeof first === 'string') {
      const normalized = first.trim();
      return normalized.length > 0 ? normalized : undefined;
    }
  }

  return undefined;
}

function normalizeInternalRole(role: string | undefined): string | undefined {
  if (!role) return undefined;
  return role.trim().toLowerCase();
}

function requireOrchestratorControlAuthorization(req: Request, res: Response, next: NextFunction): void {
  const actorUserId = readHeaderStringValue(req.headers['x-internal-user-id']);
  const actorRoleRaw = readHeaderStringValue(req.headers['x-internal-role']);
  const actorRole = normalizeInternalRole(actorRoleRaw);

  // Compatibilidade: chamadas internas legado (service-to-service) sem contexto de usuário continuam válidas.
  if (!actorUserId && !actorRole) {
    return next();
  }

  if (!actorUserId || !actorRole || !ORCHESTRATOR_ALLOWED_ROLES.has(actorRole)) {
    logger.warn(
      {
        path: req.path,
        actorUserId: actorUserId ?? null,
        actorRole: actorRole ?? null,
      },
      'Acesso negado ao controle de orquestração GPU (role insuficiente)',
    );
    res.status(403).json({ error: 'Permissão insuficiente para controle de orquestração GPU' });
    return;
  }

  next();
}

function resolveRuntimeTriggerSource(trigger: OrchestratorTransitionTrigger): RuntimePersistenceTriggerSource {
  if (trigger === 'queue_request') return 'queue_request';
  if (trigger === 'manual_api') return 'manual_api';
  if (trigger === 'startup') return 'startup';
  return 'system';
}

function trackOrchestratorStateGauge(state: OrchestratorState): void {
  for (const candidate of ORCHESTRATOR_STATES) {
    gpuOrchestratorState.set({ state: candidate }, candidate === state ? 1 : 0);
  }
}

async function recordOrchestratorTransition(transition: OrchestratorTransition): Promise<void> {
  const outcome = transition.toState === 'error' ? 'error' : 'success';
  gpuOrchestratorTransitionsTotal.inc({
    from_state: transition.fromState,
    to_state: transition.toState,
    trigger: transition.trigger,
    outcome,
  });
  trackOrchestratorStateGauge(transition.toState);

  await persistRuntimeSnapshot({
    eventType: 'state_snapshot',
    triggerSource: resolveRuntimeTriggerSource(transition.trigger),
    outcome: outcome === 'error' ? 'error' : 'success',
    reason: `FSM ${transition.fromState} -> ${transition.toState}: ${transition.reason}`,
    metadata: {
      transition: {
        fromState: transition.fromState,
        toState: transition.toState,
        trigger: transition.trigger,
        at: transition.at,
      },
    },
  });
}

async function runOrchestratorAction(params: {
  action: 'prepare_training' | 'restore_serving';
  trigger: OrchestratorTransitionTrigger;
  reason: string;
}): Promise<void> {
  const actionStart = Date.now();
  try {
    if (params.action === 'prepare_training') {
      await prepareTrainingRuntime({
        trigger: params.trigger,
        reason: params.reason,
        waitForServingDrain: waitForServingDrainCompletion,
      });
    } else {
      await restoreServingRuntime({
        trigger: params.trigger,
        reason: params.reason,
      });
    }

    gpuOrchestratorTransitionDurationSeconds.observe(
      { action: params.action, trigger: params.trigger, outcome: 'success' },
      (Date.now() - actionStart) / 1000,
    );
  } catch (error) {
    gpuOrchestratorTransitionDurationSeconds.observe(
      { action: params.action, trigger: params.trigger, outcome: 'error' },
      (Date.now() - actionStart) / 1000,
    );
    throw error;
  }
}

// Middleware de autenticação interna (service-to-service)
// BUG FIX 25/12/2025: GPU Manager Service endpoints devem aceitar X-Internal-Api-Secret, não requireAuth (OAuth/JWT)
// gpu-client.ts envia X-Internal-Api-Secret header para autenticação service-to-service
function requireInternalAuth(req: Request, res: Response, next: NextFunction): void {
  // Health check básico não requer auth (para docker healthcheck)
  if (req.path === '/health' || req.path === '/live' || req.path === '/ready') {
    return next();
  }

  const hasHmacHeaders = Boolean(
    req.headers['x-internal-signature']
    && req.headers['x-internal-timestamp']
    && req.headers['x-internal-user-id']
    && req.headers['x-internal-role']
  );
  if (hasHmacHeaders) {
    const hmacMiddleware = requireInternalHmacAuth();
    hmacMiddleware(req, res, next);
    return;
  }

  // Em desenvolvimento sem secret configurado, permitir acesso
  if (!INTERNAL_API_SECRET && !IS_PRODUCTION) {
    logger.warn('INTERNAL_API_SECRET não configurado - permitindo acesso (apenas desenvolvimento)');
    return next();
  }

  // Verificar header X-Internal-Api-Secret (usado por gpu-client.ts)
  const secretHeader = req.headers['x-internal-api-secret'] as string;
  
  if (!secretHeader || secretHeader !== INTERNAL_API_SECRET) {
    logger.warn({ path: req.path, ip: req.ip }, 'Tentativa de acesso não autorizado ao GPU Manager Service');
    res.status(401).json({ error: 'Token de autenticação inválido ou ausente' });
    return;
  }
  logger.warn({ path: req.path }, 'Autenticação interna legada por segredo estático utilizada; migre para HMAC');

  next();
}

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

const { gpuServiceUrls: GPU_SERVICE_URLS, protectedFetchByServiceType } = createGpuServiceClients(logger);

async function isTrainingServiceReachable(): Promise<boolean> {
  const trainingUrl = GPU_SERVICE_URLS[GpuServiceType.TRAINING];
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${trainingUrl}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/** VRAM necessária por serviço (GB)
 *
 * IMPORTANTE (Regra 6 - sem valores “falsos”): este valor é usado para:
 * - gate de admissão quando nvidia-smi não está disponível (fallback)
 * - estimativa de VRAM reservada por capacidade em dashboards
 *
 * Fonte de verdade:
 * - Em runtime real: nvidia-smi (quando disponível)
 * - Para fallback/estimativa: valores conservadores alinhados ao SSOT do stack modular
 *   (`infra/docker/stacks/docker-compose.alice.yml`) e ao budget de VRAM do vLLM.
 *
 * Observação:
 * - LLM (AWQ 4-bit): ~4-6GB (pesos) + KV cache conforme max-model-len / gpu-memory-utilization
 * Para coexistência em 20GB, usamos requisitos conservadores.
 */
const VRAM_REQUIREMENTS: Record<GpuServiceType, number> = {
  [GpuServiceType.LLM]: readNumberEnv('GPU_VRAM_BUDGET_LLM', { defaultValue: 6, min: 0.1 }),
  [GpuServiceType.EMBEDDINGS]: readNumberEnv('GPU_VRAM_BUDGET_EMBEDDINGS', { defaultValue: 3, min: 0.1 }),
  [GpuServiceType.TRAINING]: readNumberEnv('GPU_VRAM_BUDGET_TRAINING', { defaultValue: 8, min: 0.1 }),
};

// Validar budgets por serviço
for (const [serviceType, budget] of Object.entries(VRAM_REQUIREMENTS)) {
  if (!Number.isFinite(budget) || budget <= 0) {
    logger.error({ serviceType, budget }, 'Budget de VRAM por serviço inválido');
    process.exit(1);
  }
}

/** VRAM total disponível (20GB para RTX 4000 Ada - Hetzner GEX44) */
// BUG FIX 25/12/2025: Corrigido de 24GB (RTX 4090) para 20GB (RTX 4000 Ada)
const TOTAL_VRAM_GB = readNumberEnv('GPU_TOTAL_VRAM_GB', { defaultValue: 20, min: 0.1 });

/** Margem de segurança (GB) */
const VRAM_SAFETY_MARGIN_GB = readNumberEnv('GPU_VRAM_SAFETY_MARGIN_GB', { defaultValue: 2, min: 0 });
const GPU_RETRY_AFTER_SECONDS = readNumberEnv('GPU_RETRY_AFTER_SECONDS', {
  defaultValue: 5,
  integer: true,
  min: 1,
});
const SERVING_DRAIN_MAX_WAIT_MS = readNumberEnv('GPU_SERVING_DRAIN_MAX_WAIT_MS', {
  defaultValue: 30000,
  integer: true,
  min: 1000,
  max: 600000,
});
const SERVING_DRAIN_POLL_INTERVAL_MS = readNumberEnv('GPU_SERVING_DRAIN_POLL_INTERVAL_MS', {
  defaultValue: 200,
  integer: true,
  min: 50,
  max: 5000,
});
const SERVING_DRAIN_FORCE_SETTLE_MS = readNumberEnv('GPU_SERVING_DRAIN_FORCE_SETTLE_MS', {
  defaultValue: 5000,
  integer: true,
  min: 0,
  max: 60000,
});

const ADMISSION_MIN_FREE_GB: Record<GpuServiceType, number> = {
  [GpuServiceType.LLM]: readNumberEnv('GPU_ADMISSION_MIN_FREE_GB_LLM', { defaultValue: 2, min: 0 }),
  [GpuServiceType.EMBEDDINGS]: readNumberEnv('GPU_ADMISSION_MIN_FREE_GB_EMBEDDINGS', { defaultValue: 1.5, min: 0 }),
  [GpuServiceType.TRAINING]: readNumberEnv('GPU_ADMISSION_MIN_FREE_GB_TRAINING', { defaultValue: 2, min: 0 }),
};

for (const [serviceType, threshold] of Object.entries(ADMISSION_MIN_FREE_GB)) {
  if (!Number.isFinite(threshold) || threshold < 0) {
    logger.error({ serviceType, threshold }, 'Threshold de admission control inválido');
    process.exit(1);
  }
}

/** Prefixo Redis para fila GPU */
const REDIS_QUEUE_PREFIX = 'alice:gpu:queue';
const REDIS_ACTIVE_PREFIX = 'alice:gpu:active';
// BUG FIX 26/12/2025: REDIS_METRICS_PREFIX removido - métricas via Prometheus, não Redis

/** Lock global para garantir execução serial em GPU única (VRAM compartilhada) */
const REDIS_GPU_LOCK_KEY = 'alice:gpu:lock';

/** Score composto: prioridade (dominante) + FIFO dentro da prioridade (mais antigo primeiro via -createdAt) */
const PRIORITY_SCORE_MULTIPLIER = 10_000_000_000_000; // 1e13 (seguro dentro de Number.MAX_SAFE_INTEGER)

type ActiveStreamContext = {
  streamId: string;
  abortController: AbortController;
  close: () => void;
};

let inflightInferenceRequests = 0;
const activeStreamContexts = new Map<string, ActiveStreamContext>();

type GpuLockValue = {
  requestId: string;
  serviceType: GpuServiceType;
  acquiredAt: number;
};

async function tryAcquireGpuLock(serviceType: GpuServiceType, requestId: string, ttlMs: number): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) {
    throw new Error('Redis não disponível - lock GPU é obrigatório');
  }
  const value: GpuLockValue = { requestId, serviceType, acquiredAt: Date.now() };
  const result = await redis.set(REDIS_GPU_LOCK_KEY, JSON.stringify(value), { NX: true, PX: ttlMs });
  return result === 'OK';
}

async function releaseGpuLockIfOwned(requestId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  // Segurança enterprise: remover lock apenas se o owner (requestId) bater.
  const lua = `
    local key = KEYS[1]
    local reqId = ARGV[1]
    local v = redis.call("GET", key)
    if not v then
      return 0
    end
    local ok, decoded = pcall(cjson.decode, v)
    if not ok then
      return 0
    end
    if decoded["requestId"] == reqId then
      return redis.call("DEL", key)
    end
    return 0
  `;

  try {
    await redis.eval(lua, { keys: [REDIS_GPU_LOCK_KEY], arguments: [requestId] });
  } catch (error) {
    logger.error({ error, requestId }, 'Erro ao liberar lock GPU');
  }
}

// ============================================================================
// MONITORAMENTO DE VRAM
// ============================================================================

/**
 * Flag para evitar spam de logs quando nvidia-smi não está disponível
 * CORREÇÃO 28/12/2025: Em containers Distroless não há shell nem nvidia-smi
 * Logar apenas uma vez e usar fallback silenciosamente após isso
 */
let nvidiaSmiAvailable: boolean | null = null;

/**
 * Obtém status de VRAM via nvidia-smi
 * CORREÇÃO 28/12/2025: Graceful degradation em ambientes sem nvidia-smi
 * - Containers Distroless não têm shell (/bin/sh) para exec()
 * - GPU Manager pode rodar sem monitoramento de VRAM real
 * - Lock global Redis garante execução serial (evita OOM)
 */
async function getVramStatus(): Promise<VramStatus> {
  // Se já sabemos que nvidia-smi não está disponível, usar fallback silenciosamente
  if (nvidiaSmiAvailable === false) {
    return getVramFallback();
  }

  try {
    const { stdout } = await execAsync('nvidia-smi --query-gpu=memory.total,memory.used,memory.free --format=csv,noheader,nounits');
    const [total, used, free] = stdout.trim().split(',').map(s => parseInt(s.trim(), 10));
    
    // Marcar como disponível após primeira execução bem-sucedida
    if (nvidiaSmiAvailable === null) {
      nvidiaSmiAvailable = true;
      logger.info('nvidia-smi disponível - monitoramento de VRAM ativo');
    }

    // OBSERVABILIDADE: nvidia-smi retorna valores em MiB (nounits). Converter para GiB com precisão.
    const totalGB = total / 1024;
    const usedGB = used / 1024;
    const freeGB = free / 1024;
    const utilizationPercent = Math.round((used / total) * 100);

    // Métricas reais agregadas (bytes)
    gpuVramTotalBytes.set({ gpu_id: GPU_ID }, total * 1024 * 1024);
    gpuVramUsedBytes.set({ gpu_id: GPU_ID }, used * 1024 * 1024);

    // Obter serviços ativos do Redis
    const redis = getRedisClient();
    const activeServices: GpuServiceType[] = [];
    if (redis) {
      for (const serviceType of Object.values(GpuServiceType)) {
        const key = `${REDIS_ACTIVE_PREFIX}:${serviceType}`;
        const exists = await redis.exists(key);
        if (exists) {
          activeServices.push(serviceType);
        }
      }
    }

    // Métricas: VRAM reservada estimada por capacidade (bytes)
    // (não tenta inferir uso real por processo/container, mas mantém dashboards estáveis no WS3)
    gpuVramReservedBytes.set({ gpu_id: GPU_ID, service: 'llm' }, 0);
    gpuVramReservedBytes.set({ gpu_id: GPU_ID, service: 'embeddings' }, 0);
    gpuVramReservedBytes.set({ gpu_id: GPU_ID, service: 'training' }, 0);
    for (const serviceType of activeServices) {
      const cap = capabilityForServiceType(serviceType);
      const reservedBytes = VRAM_REQUIREMENTS[serviceType] * 1024 * 1024 * 1024;
      gpuVramReservedBytes.set({ gpu_id: GPU_ID, service: cap }, reservedBytes);
    }

    const vramStatus = {
      totalGB,
      usedGB,
      freeGB,
      utilizationPercent,
      activeServices,
    };
    observeVramFreeMetric(vramStatus);
    return vramStatus;
  } catch (error) {
    // Logar erro apenas na primeira tentativa
    if (nvidiaSmiAvailable === null) {
      nvidiaSmiAvailable = false;
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'nvidia-smi não disponível (esperado em Distroless) - usando valores de VRAM estimados'
      );
    }
    return getVramFallback();
  }
}

/**
 * Retorna valores de VRAM estimados quando nvidia-smi não está disponível
 */
async function getVramFallback(): Promise<VramStatus> {
  // Obter serviços ativos do Redis (ainda funciona sem nvidia-smi)
  const redis = getRedisClient();
  const activeServices: GpuServiceType[] = [];
  if (redis) {
    for (const serviceType of Object.values(GpuServiceType)) {
      const key = `${REDIS_ACTIVE_PREFIX}:${serviceType}`;
      const exists = await redis.exists(key);
      if (exists) {
        activeServices.push(serviceType);
      }
    }
  }

  // Estimar VRAM usada baseado em serviços ativos
  let estimatedUsedGB = 0;
  for (const service of activeServices) {
    estimatedUsedGB += VRAM_REQUIREMENTS[service];
  }

  // Proteção: fallback não pode gerar VRAM negativa e travar a fila.
  // Em ambientes sem nvidia-smi, o lock global Redis já garante execução serial.
  const boundedUsedGB = Math.min(TOTAL_VRAM_GB, estimatedUsedGB);
  const freeGB = Math.max(0, TOTAL_VRAM_GB - boundedUsedGB);
  const utilizationPercent = Math.max(
    0,
    Math.min(100, Math.round((boundedUsedGB / TOTAL_VRAM_GB) * 100))
  );

  // Métricas agregadas (bytes) - fallback baseado em budget declarado
  gpuVramTotalBytes.set({ gpu_id: GPU_ID }, TOTAL_VRAM_GB * 1024 * 1024 * 1024);
  gpuVramUsedBytes.set({ gpu_id: GPU_ID }, boundedUsedGB * 1024 * 1024 * 1024);

  // Métricas: VRAM reservada estimada por capacidade (bytes)
  // Zerar primeiro para evitar séries "stale" quando um serviço fica inativo.
  gpuVramReservedBytes.set({ gpu_id: GPU_ID, service: 'llm' }, 0);
  gpuVramReservedBytes.set({ gpu_id: GPU_ID, service: 'embeddings' }, 0);
  gpuVramReservedBytes.set({ gpu_id: GPU_ID, service: 'training' }, 0);
  for (const serviceType of activeServices) {
    const cap = capabilityForServiceType(serviceType);
    const reservedBytes = VRAM_REQUIREMENTS[serviceType] * 1024 * 1024 * 1024;
    gpuVramReservedBytes.set({ gpu_id: GPU_ID, service: cap }, reservedBytes);
  }

  const vramStatus = {
    totalGB: TOTAL_VRAM_GB,
    usedGB: boundedUsedGB,
    freeGB,
    utilizationPercent,
    activeServices,
  };
  observeVramFreeMetric(vramStatus);
  return vramStatus;
}

function observeVramFreeMetric(vramStatus: VramStatus): void {
  gpuManagerVramFreeBytes.set({ gpu_id: GPU_ID }, vramStatus.freeGB * 1024 * 1024 * 1024);
}

function trackGpuRejection(serviceType: GpuServiceType, reason: GpuRejectionReason): void {
  gpuManagerRejectionsTotal.inc({ service: capabilityForServiceType(serviceType), reason });
}

function isTransitionInProgressState(state: OrchestratorState): boolean {
  return (
    state === 'serving_draining'
    || state === 'training_starting'
    || state === 'training_finishing'
    || state === 'serving_restoring'
  );
}

function isServingPreemptedForTrainingState(state: OrchestratorState): boolean {
  return state === 'serving_draining' || state === 'training_starting' || state === 'training_active';
}

function isRuntimeServingInferenceReady(state: OrchestratorState): boolean {
  return state === 'serving_ready';
}

function beginInferenceInflight(): void {
  inflightInferenceRequests += 1;
}

function endInferenceInflight(): void {
  inflightInferenceRequests = Math.max(0, inflightInferenceRequests - 1);
}

function syncActiveStreamsMetric(): void {
  gpuManagerActiveStreams.set(activeStreamContexts.size);
}

function registerActiveStream(streamId: string, context: {
  abortController: AbortController;
  close: () => void;
}): () => void {
  activeStreamContexts.set(streamId, {
    streamId,
    abortController: context.abortController,
    close: context.close,
  });
  syncActiveStreamsMetric();

  return () => {
    activeStreamContexts.delete(streamId);
    syncActiveStreamsMetric();
  };
}

function getServingInflightOperationsCount(): number {
  return inflightInferenceRequests + activeStreamContexts.size;
}

function forceInterruptActiveStreams(reason: string): number {
  if (activeStreamContexts.size === 0) {
    return 0;
  }

  let interruptedCount = 0;
  for (const streamContext of activeStreamContexts.values()) {
    interruptedCount += 1;
    try {
      streamContext.abortController.abort(new Error(reason));
    } catch {
      // noop
    }
    try {
      streamContext.close();
    } catch {
      // noop
    }
  }

  if (interruptedCount > 0) {
    gpuManagerForcedInterruptionsTotal.inc(
      { reason: 'serving_preempted_for_training' },
      interruptedCount,
    );
  }

  return interruptedCount;
}

function buildAdmissionRuntimeFlags(serviceType: GpuServiceType): {
  isTransitionInProgress: boolean;
  isServingPreemptedForTraining: boolean;
} {
  if (!orchestratorAvailable || serviceType === GpuServiceType.TRAINING) {
    return { isTransitionInProgress: false, isServingPreemptedForTraining: false };
  }

  const orchestratorState = getOrchestratorState();
  return {
    isTransitionInProgress: isTransitionInProgressState(orchestratorState),
    isServingPreemptedForTraining: isServingPreemptedForTrainingState(orchestratorState),
  };
}

async function waitForServingDrainCompletion(): Promise<ServingDrainResult> {
  const startedAt = Date.now();
  const inflightAtStart = getServingInflightOperationsCount();
  let forcedInterruptions = 0;
  let timedOut = false;

  while (Date.now() - startedAt < SERVING_DRAIN_MAX_WAIT_MS) {
    if (getServingInflightOperationsCount() === 0) {
      const durationMs = Date.now() - startedAt;
      gpuOrchestratorDrainDurationSeconds.observe({ outcome: 'graceful' }, durationMs / 1000);
      return {
        durationMs,
        inflightAtStart,
        inflightAtFinish: 0,
        forcedInterruptions,
        timedOut: false,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, SERVING_DRAIN_POLL_INTERVAL_MS));
  }

  timedOut = true;
  forcedInterruptions = forceInterruptActiveStreams('serving_preempted_for_training');

  if (SERVING_DRAIN_FORCE_SETTLE_MS > 0) {
    const settleStart = Date.now();
    while (Date.now() - settleStart < SERVING_DRAIN_FORCE_SETTLE_MS) {
      if (getServingInflightOperationsCount() === 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, SERVING_DRAIN_POLL_INTERVAL_MS));
    }
  }

  const inflightAtFinish = getServingInflightOperationsCount();
  const durationMs = Date.now() - startedAt;
  gpuOrchestratorDrainDurationSeconds.observe(
    { outcome: inflightAtFinish === 0 ? 'forced' : 'timeout' },
    durationMs / 1000,
  );

  await persistRuntimeSnapshot({
    eventType: 'state_snapshot',
    triggerSource: 'system',
    outcome: inflightAtFinish === 0 ? 'success' : 'error',
    reason: inflightAtFinish === 0
      ? 'Drain de serving concluído com política de corte aplicada'
      : 'Drain de serving excedeu tempo máximo com operações em andamento',
    metadata: {
      drain: {
        inflightAtStart,
        inflightAtFinish,
        forcedInterruptions,
        durationMs,
        timedOut,
      },
    },
  });

  logger.warn(
    {
      inflightAtStart,
      inflightAtFinish,
      forcedInterruptions,
      durationMs,
      timedOut,
    },
    'Drain de serving finalizado por política de corte',
  );

  return {
    durationMs,
    inflightAtStart,
    inflightAtFinish,
    forcedInterruptions,
    timedOut,
  };
}

// ============================================================================
// FILA REDIS
// ============================================================================

/**
 * Adiciona requisição à fila priorizada
 * BUG FIX 25/12/2025: Adicionar verificação de null para evitar crash se Redis ficar indisponível
 */
async function enqueueRequest(request: GpuRequest): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    throw new Error('Redis não disponível - não é possível enfileirar requisição GPU');
  }
  
  const queueKey = `${REDIS_QUEUE_PREFIX}:${request.serviceType}`;
  const requestKey = `${REDIS_QUEUE_PREFIX}:request:${request.id}`;
  
  // Armazenar requisição completa
  await redis.setEx(
    requestKey,
    3600, // 1 hora TTL
    JSON.stringify(request)
  );
  
  // Adicionar à fila priorizada (sorted set)
  // - Prioridade domina (CRITICAL > HIGH > MEDIUM > LOW)
  // - Dentro da mesma prioridade: FIFO (mais antigo primeiro)
  // Nota: zPopMax retorna maior score, então usamos -createdAt para FIFO.
  await redis.zAdd(queueKey, {
    score: (request.priority * PRIORITY_SCORE_MULTIPLIER) - request.createdAt,
    value: request.id,
  });

  // Observabilidade: depth real por fila/capacidade (modelo-agnóstico)
  try {
    const depth = await redis.zCard(queueKey);
    gpuManagerQueueDepth.set({ queue: capabilityForServiceType(request.serviceType) }, depth);
  } catch (metricError) {
    logger.debug({ error: metricError }, 'Falha ao atualizar métrica de queue depth (enqueue)');
  }
  
  logger.info({
    requestId: request.id,
    serviceType: request.serviceType,
    priority: request.priority,
  }, 'Requisição GPU enfileirada');
}

/**
 * Remove e retorna próxima requisição da fila
 * BUG FIX 25/12/2025: Corrigido para pegar maior prioridade (zPopMax ao invés de zRange(-1, -1))
 * BUG FIX 25/12/2025: Adicionar verificação de null para evitar crash se Redis ficar indisponível
 */
async function dequeueRequest(serviceType: GpuServiceType): Promise<GpuRequest | null> {
  const redis = getRedisClient();
  if (!redis) {
    logger.warn('Redis não disponível - não é possível desenfileirar requisição GPU');
    return null;
  }
  
  const queueKey = `${REDIS_QUEUE_PREFIX}:${serviceType}`;
  
  // BUG FIX 25/12/2025: zRange(-1, -1) pega o último elemento (menor score se ordem crescente)
  // Precisamos do maior score (maior prioridade), então usamos zPopMax (atômico)
  // Prioridades: CRITICAL=10 > HIGH=8 > MEDIUM=5 > LOW=2
  // BUG FIX 26/12/2025: zPopMax sem count retorna objeto único { value, score } ou null
  const result = await redis.zPopMax(queueKey);
  if (!result) {
    return null;
  }
  
  const requestId = result.value;
  const requestKey = `${REDIS_QUEUE_PREFIX}:request:${requestId}`;
  
  // Obter requisição completa
  const requestData = await redis.get(requestKey);
  if (!requestData || typeof requestData !== 'string') {
    // BUG FIX 25/12/2025: zPopMax já removeu da fila atomicamente
    // Dados expiraram, mas elemento já foi removido da fila
    logger.warn({ requestId }, 'Dados da requisição expiraram após remoção da fila');
    return null;
  }
  
  // BUG FIX 26/12/2025: Type guard para garantir que é string (Redis v5 pode retornar tipos variados)
  const request: GpuRequest = JSON.parse(requestData);
  
  // BUG FIX 25/12/2025: zPopMax já remove o elemento da fila atomicamente
  // Não precisamos chamar zRem novamente
  
  return request;
}

/**
 * Marca serviço como ativo
 * BUG FIX 25/12/2025: Adicionar verificação de null para evitar crash se Redis ficar indisponível
 */
async function markServiceActive(serviceType: GpuServiceType, requestId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    logger.warn({ serviceType, requestId }, 'Redis não disponível - não é possível marcar serviço como ativo');
    return;
  }
  const key = `${REDIS_ACTIVE_PREFIX}:${serviceType}`;
  await redis.setEx(key, 300, JSON.stringify({ requestId, startedAt: Date.now() })); // 5 min TTL
}

/**
 * Marca serviço como inativo
 * BUG FIX 25/12/2025: Adicionar verificação de null para evitar crash se Redis ficar indisponível
 */
async function markServiceInactive(serviceType: GpuServiceType): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    logger.warn({ serviceType }, 'Redis não disponível - não é possível marcar serviço como inativo');
    return;
  }
  const key = `${REDIS_ACTIVE_PREFIX}:${serviceType}`;
  await redis.del(key);
}

// ============================================================================
// PROCESSAMENTO DE REQUISIÇÕES
// ============================================================================

/**
 * Processa requisição GPU com retry e circuit breaker
 * 
 * Gate 2 (16/01/2026): LLM separado + Embeddings + Training locais
 * - Serviços GPU rodam simultaneamente com budget em 20GB (métricas = fonte de verdade)
 * - Zero latência de troca (não há orquestração dinâmica de start/stop)
 * - Treinamento é sob demanda via profile, com política operacional fora do caminho crítico
 */
async function processGpuRequest(request: GpuRequest): Promise<GpuResponse> {
  const startTime = Date.now();
  const serviceType = request.serviceType;
  const url = GPU_SERVICE_URLS[serviceType];
  const protectedFetch = protectedFetchByServiceType[serviceType];
  const trackServingInflight = serviceType !== GpuServiceType.TRAINING;
  if (trackServingInflight) {
    beginInferenceInflight();
  }
  
  try {
    // Orquestração (se disponível): TRAINING/EMBEDDINGS trocam containers conforme demanda
    if (orchestratorAvailable) {
      const correlationId = readCorrelationIdFromHeaders(request.headers);
      if (serviceType === GpuServiceType.TRAINING) {
        await persistRuntimeSnapshot({
          eventType: 'switch_requested',
          triggerSource: 'queue_request',
          requestId: request.id,
          correlationId,
          reason: 'Treinamento solicitado pela fila GPU',
          actorUserId: request.userId,
          actorTenantId: request.tenantId,
          metadata: { serviceType },
        });
        try {
          await runOrchestratorAction({
            action: 'prepare_training',
            trigger: 'queue_request',
            reason: 'Treinamento solicitado pela fila GPU',
          });
          await persistRuntimeSnapshot({
            eventType: 'switch_completed',
            triggerSource: 'queue_request',
            requestId: request.id,
            correlationId,
            reason: 'Runtime GPU preparado para treinamento',
            actorUserId: request.userId,
            actorTenantId: request.tenantId,
            metadata: { serviceType },
          });
        } catch (error) {
          await persistRuntimeSnapshot({
            eventType: 'switch_failed',
            triggerSource: 'queue_request',
            outcome: 'error',
            requestId: request.id,
            correlationId,
            reason: error instanceof Error ? error.message : String(error),
            actorUserId: request.userId,
            actorTenantId: request.tenantId,
            metadata: { serviceType },
          });
          throw error;
        }
      } else {
        const runtimeFlags = buildAdmissionRuntimeFlags(serviceType);
        if (runtimeFlags.isServingPreemptedForTraining) {
          throw new Error(
            `SERVING_PREEMPTED_FOR_TRAINING: inferencia temporariamente indisponivel (serviceType=${serviceType})`,
          );
        }
        if (runtimeFlags.isTransitionInProgress || !isRuntimeServingInferenceReady(getOrchestratorState())) {
          throw new Error(
            `GPU_RUNTIME_TRANSITION_IN_PROGRESS: inferencia indisponivel durante transição de runtime (serviceType=${serviceType})`,
          );
        }
      }
    } else if (serviceType === GpuServiceType.TRAINING) {
      const trainerReachable = await isTrainingServiceReachable();
      if (!trainerReachable) {
        throw new Error(
          'TRAINING_SERVICE_UNAVAILABLE: gpu-trainer offline e orquestrador indisponivel para start on-demand. Verifique DOCKER_SOCKET_GID e profile gpu-training.'
        );
      }
    }

    const timeoutMs = request.timeout || GPU_SERVICE_TIMEOUT;
    const requestBody = applyStructuredOutputs({
      serviceType,
      endpoint: request.endpoint,
      body: request.body,
    });
    const response = await protectedFetch(`${url}${request.endpoint}`, {
      method: request.method,
      headers: {
        // Só setar JSON quando tiver body - evita bloquear endpoints que aceitam outros content-types
        ...(request.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
        ...request.headers,
      },
      body: request.method !== 'GET' && requestBody ? JSON.stringify(requestBody) : undefined,
      timeoutMs,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GPU service error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    // Obter VRAM atual
    const vramStatus = await getVramStatus();

    return {
      success: true,
      data,
      latencyMs,
      vramUsedGB: vramStatus.usedGB,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    logger.error({
      requestId: request.id,
      serviceType,
      error: error instanceof Error ? error.message : String(error),
      retries: request.retries,
    }, 'Erro ao processar requisição GPU');
    
    // Retry logic
    if (request.retries < request.maxRetries) {
      const backoffMs = Math.min(1000 * Math.pow(2, request.retries), 30000); // Max 30s
      logger.info({
        requestId: request.id,
        retries: request.retries + 1,
        backoffMs,
      }, 'Retentando requisição GPU');
      
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      request.retries++;
      return processGpuRequest(request);
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      latencyMs,
    };
  } finally {
    if (trackServingInflight) {
      endInferenceInflight();
    }
  }
}

// ============================================================================
// WORKER DE FILA
// ============================================================================

let isWorkerRunning = false;

/**
 * Worker que processa fila de requisições GPU
 */
async function startQueueWorker(): Promise<void> {
  if (isWorkerRunning) {
    logger.warn('Worker de fila já está rodando');
    return;
  }
  
  isWorkerRunning = true;
  logger.info('Iniciando worker de fila GPU');
  
  // Gate 2:
  // Todos os serviços rodam simultaneamente, mas mantemos priorização na fila
  // para garantir que requisições críticas (chat/trading) sejam processadas primeiro.
  // 1) LLM (chat/trading - maior prioridade)
  // 2) EMBEDDINGS (RAG)
  // 3) TRAINING (sob demanda - menor prioridade)
  const servicePriorityOrder: GpuServiceType[] = [
    GpuServiceType.LLM,
    GpuServiceType.EMBEDDINGS,
    GpuServiceType.TRAINING,
  ];

  const processNextRequest = async (): Promise<void> => {
    try {
      // Se já existe lock GPU, não iniciar nova execução
      const redis = getRedisClient();
      if (!redis) {
        throw new Error('Redis não disponível - worker GPU exige Redis');
      }
      const lockExists = (await redis.exists(REDIS_GPU_LOCK_KEY)) === 1;

      // Buscar a próxima requisição respeitando ordem global de prioridade
      for (const serviceType of servicePriorityOrder) {
        if (lockExists && serviceType !== GpuServiceType.TRAINING) {
          continue;
        }

        if (
          orchestratorAvailable
          && serviceType !== GpuServiceType.TRAINING
          && !isRuntimeServingInferenceReady(getOrchestratorState())
        ) {
          continue;
        }

        const request = await dequeueRequest(serviceType);
        if (!request) continue;

        // Observabilidade: tempo de espera na fila (do enqueue até o dequeue)
        const queue = capabilityForServiceType(serviceType);
        const waitSeconds = (Date.now() - request.createdAt) / 1000;
        gpuManagerQueueWaitDuration.observe({ queue }, waitSeconds);
        try {
          const depth = await redis.zCard(`${REDIS_QUEUE_PREFIX}:${serviceType}`);
          gpuManagerQueueDepth.set({ queue }, depth);
        } catch (metricError) {
          logger.debug({ error: metricError }, 'Falha ao atualizar métrica de queue depth (dequeue)');
        }

        // Tentar adquirir lock (TTL = timeout + margem)
        const timeoutMs = request.timeout || GPU_SERVICE_TIMEOUT;
        let lockAcquired = false;
        if (serviceType !== GpuServiceType.TRAINING) {
          const lockTtlMs = Math.min(timeoutMs + 30000, 5 * 60 * 1000); // max 5 min
          lockAcquired = await tryAcquireGpuLock(serviceType, request.id, lockTtlMs);
          if (!lockAcquired) {
            // Outra execução ganhou o lock; reenfileirar e sair
            await enqueueRequest(request);
            return;
          }
        }

        try {
          // Verificar VRAM disponível (evita iniciar serviço que não cabe no momento)
          const vramStatus = await getVramStatus();
          if (!hasEnoughVram({
            serviceType,
            currentVram: vramStatus,
            vramRequirements: VRAM_REQUIREMENTS,
            vramSafetyMarginGb: VRAM_SAFETY_MARGIN_GB,
          })) {
            logger.warn({
              requestId: request.id,
              serviceType,
              requiredGB: VRAM_REQUIREMENTS[serviceType],
              availableGB: vramStatus.freeGB,
            }, 'VRAM insuficiente, reenfileirando requisição');

            // Reenfileirar sem degradar prioridade global do request original
            await enqueueRequest(request);
            return;
          }

          // Marcar serviço como ativo
          await markServiceActive(serviceType, request.id);

          // Processar requisição
          const response = await processGpuRequest(request);

          // Armazenar resultado no Redis (para polling)
          const resultKey = `${REDIS_QUEUE_PREFIX}:result:${request.id}`;
          await redis.setEx(resultKey, 300, JSON.stringify(response)); // 5 min TTL

          if (serviceType === GpuServiceType.TRAINING && orchestratorAvailable) {
            const correlationId = readCorrelationIdFromHeaders(request.headers);
            await persistRuntimeSnapshot({
              eventType: 'switch_requested',
              triggerSource: 'queue_request',
              requestId: request.id,
              correlationId,
              reason: 'Treinamento finalizado na fila GPU; iniciando restore de serving',
              actorUserId: request.userId,
              actorTenantId: request.tenantId,
              metadata: { serviceType, phase: 'post_training_restore' },
            });

            try {
              await runOrchestratorAction({
                action: 'restore_serving',
                trigger: 'queue_request',
                reason: 'Treinamento finalizado na fila GPU',
              });
              await persistRuntimeSnapshot({
                eventType: 'switch_completed',
                triggerSource: 'queue_request',
                requestId: request.id,
                correlationId,
                reason: 'Serving restaurado ao final do treinamento',
                actorUserId: request.userId,
                actorTenantId: request.tenantId,
                metadata: { serviceType, phase: 'post_training_restore' },
              });
            } catch (restoreError) {
              await persistRuntimeSnapshot({
                eventType: 'switch_failed',
                triggerSource: 'queue_request',
                outcome: 'error',
                requestId: request.id,
                correlationId,
                reason: restoreError instanceof Error ? restoreError.message : String(restoreError),
                actorUserId: request.userId,
                actorTenantId: request.tenantId,
                metadata: { serviceType, phase: 'post_training_restore' },
              });
              logger.error(
                {
                  requestId: request.id,
                  restoreError,
                },
                'Falha ao restaurar serving apos conclusão de treinamento',
              );
            }
          }
          logger.info({
            requestId: request.id,
            serviceType,
            success: response.success,
            latencyMs: response.latencyMs,
          }, 'Requisição GPU processada');
          return;
        } finally {
          await markServiceInactive(serviceType);
          if (lockAcquired) {
            await releaseGpuLockIfOwned(request.id);
          }
        }
      }
    } catch (error) {
      logger.error({ error }, 'Erro ao processar próxima requisição GPU');
    }
  };

  const processQueue = async () => {
    try {
      await processNextRequest();
    } catch (error) {
      logger.error({ error }, 'Erro no worker de fila GPU');
    }
    
    // Continuar processando
    if (isWorkerRunning) {
      setTimeout(processQueue, 100); // Poll a cada 100ms
    }
  };
  
  processQueue();
}

/**
 * Para worker de fila
 */
function stopQueueWorker(): void {
  isWorkerRunning = false;
  logger.info('Worker de fila GPU parado');
}

// ============================================================================
// EXPRESS APP
// ============================================================================

const app = express();
const server = createServer(app);

setupSwaggerUI(app, {
  serviceName: 'gpu-manager-service',
  version: '1.0.0',
  description: 'Serviço central de fila, admission control e roteamento para workloads GPU.',
  port: PORT,
  tags: [
    { name: 'Health', description: 'Health checks, readiness e métricas' },
    { name: 'Queue', description: 'Fila e resultados de requisições GPU' },
    { name: 'Inference', description: 'Proxy de inferência e streaming SSE' },
    { name: 'VRAM', description: 'Status e orçamento de VRAM' },
    { name: 'Orchestrator', description: 'Estado e comandos de orquestração GPU' },
    { name: 'Embeddings', description: 'Health proxy para embeddings' },
    { name: 'Services', description: 'Estado operacional dos serviços GPU' },
  ],
  paths: gpuManagerServicePaths,
  schemas: gpuManagerServiceSchemas,
});
logger.info('Swagger UI configurado em /api/docs');

const defaultCompressionFilter: (req: Request, res: Response) => boolean =
  typeof (compression as unknown as { filter?: (req: Request, res: Response) => boolean }).filter === 'function'
    ? (compression as unknown as { filter: (req: Request, res: Response) => boolean }).filter
    : () => true;

function shouldBypassCompressionForGpuStream(req: Request): boolean {
  const acceptHeader = req.headers.accept ?? '';
  const acceptsSse = typeof acceptHeader === 'string' && acceptHeader.includes('text/event-stream');
  return req.path === '/api/gpu/stream' || acceptsSse;
}

// Middleware
app.use(compression({
  filter: (req, res) => {
    if (shouldBypassCompressionForGpuStream(req)) {
      logger.debug({ path: req.path, accept: req.headers.accept ?? null }, 'Bypass de compression para SSE no GPU Manager');
      return false;
    }
    return defaultCompressionFilter(req, res);
  },
}));
app.use(cors(getCorsConfig()));
app.use(express.json({ limit: '50mb' }));
app.use(createCorrelationMiddleware({ serviceName: 'gpu-manager' }));
app.use(createSecurityMiddleware());

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'gpu-manager' });
});

// Proxy para health do serviço de embeddings (SSOT validation - Plano 11/02/2026)
// Permite que training-service e rag-service validem text_dimensions === EMBEDDING_DIMENSIONS.TEXT
app.get('/api/gpu/embeddings/health', requireInternalAuth, asyncHandler(async (_req: Request, res: Response) => {
  const url = GPU_SERVICE_URLS[GpuServiceType.EMBEDDINGS];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${url}/health`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);
    if (!response.ok) {
      return res.status(502).json({
        error: 'Embeddings GPU health check failed',
        status: response.status,
        url,
      });
    }
    const data = (await response.json()) as { text_dimensions?: number; status?: string; [k: string]: unknown };
    res.json(data);
  } catch (err) {
    logger.warn({ err, url }, 'Falha ao obter health do embeddings GPU');
    res.status(503).json({
      error: 'Embeddings GPU unreachable',
      url,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}));

// Liveness probe
app.get('/live', async (req: Request, res: Response) => {
  try {
    const redisHealthy = isRedisAvailable();
    res.json({ 
      status: 'alive',
      redis: redisHealthy ? 'healthy' : 'unhealthy',
    });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: String(error) });
  }
});

// Readiness probe
app.get('/ready', async (req: Request, res: Response) => {
  try {
    const redisHealthy = isRedisAvailable();
    const vramStatus = await getVramStatus();
    
    if (!redisHealthy) {
      return res.status(503).json({ status: 'not ready', reason: 'redis unavailable' });
    }
    
    res.json({ 
      status: 'ready',
      redis: 'healthy',
      vram: vramStatus,
    });
  } catch (error) {
    res.status(503).json({ status: 'not ready', error: String(error) });
  }
});

// Enfileirar requisição GPU
// BUG FIX 25/12/2025: Usar requireInternalAuth ao invés de requireAuth (aceita X-Internal-Api-Secret)
app.post('/api/gpu/queue', requireInternalAuth, asyncHandler(async (req: Request, res: Response) => {
  const schema = z.object({
    serviceType: z.nativeEnum(GpuServiceType),
    priority: z.nativeEnum(GpuRequestPriority).optional(),
    endpoint: z.string(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
    body: z.unknown().optional(),
    headers: z.record(z.string()).optional(),
    timeout: z.number().optional(),
    maxRetries: z.number().optional(),
    metadata: z.record(z.unknown()).optional(),
  });
  
  const body = schema.parse(req.body);
  const requestId = `gpu-${randomUUID()}`;
  
  const request: GpuRequest = {
    id: requestId,
    serviceType: body.serviceType,
    priority: body.priority || GpuRequestPriority.MEDIUM,
    endpoint: body.endpoint,
    method: body.method || 'POST',
    body: body.body,
    headers: body.headers,
    timeout: body.timeout,
    // BUG FIX 25/12/2025: req.tenantId e req.userId não existem com requireInternalAuth
    // GPU Manager Service é interno - não precisa de tenant/user context para requisições GPU
    tenantId: undefined,
    userId: undefined,
    metadata: body.metadata,
    createdAt: Date.now(),
    retries: 0,
    maxRetries: body.maxRetries || 3,
  };

  const vramStatus = await getVramStatus();
  const admissionRuntimeFlags = buildAdmissionRuntimeFlags(request.serviceType);
  const rejectionReason = admissionControlReason({
    serviceType: request.serviceType,
    priority: request.priority,
    vramStatus,
    vramRequirements: VRAM_REQUIREMENTS,
    vramSafetyMarginGb: VRAM_SAFETY_MARGIN_GB,
    admissionMinFreeGb: ADMISSION_MIN_FREE_GB,
    isTransitionInProgress: admissionRuntimeFlags.isTransitionInProgress,
    isServingPreemptedForTraining: admissionRuntimeFlags.isServingPreemptedForTraining,
    logger,
  });
  if (rejectionReason) {
    trackGpuRejection(request.serviceType, rejectionReason);
    const statusCode = (rejectionReason === 'low_vram_low_priority') ? 429 : 503;
    res.setHeader('Retry-After', String(GPU_RETRY_AFTER_SECONDS));
    return res.status(statusCode).json({
      error: 'Requisição rejeitada pelo admission control',
      reason: rejectionReason,
      serviceType: request.serviceType,
      availableGB: vramStatus.freeGB,
      requiredGB: VRAM_REQUIREMENTS[request.serviceType] + VRAM_SAFETY_MARGIN_GB,
      thresholdGB: ADMISSION_MIN_FREE_GB[request.serviceType],
      retryAfterSeconds: GPU_RETRY_AFTER_SECONDS,
    });
  }
  
  await enqueueRequest(request);
  
  res.status(202).json({
    requestId,
    status: 'queued',
    message: 'Requisição enfileirada',
  });
}));

// Obter resultado de requisição
// BUG FIX 25/12/2025: Usar requireInternalAuth ao invés de requireAuth (aceita X-Internal-Api-Secret)
app.get('/api/gpu/queue/:requestId', requireInternalAuth, asyncHandler(async (req: Request, res: Response) => {
  const { requestId } = req.params;
  const redis = getRedisClient();
  if (!redis) {
    return res.status(503).json({ error: 'Redis não disponível' });
  }
  
  const resultKey = `${REDIS_QUEUE_PREFIX}:result:${requestId}`;
  
  const result = await redis.get(resultKey);
  if (!result || typeof result !== 'string') {
    return res.status(404).json({ error: 'Resultado não encontrado' });
  }
  
  // BUG FIX 26/12/2025: Type guard para garantir que é string (Redis v5 pode retornar tipos variados)
  const response: GpuResponse = JSON.parse(result);
  res.json(response);
}));

type OrchestratorActorContext = {
  requestId: string;
  actorUserId: string | undefined;
  actorTenantId: string | undefined;
  correlationId: string | undefined;
};

function buildOrchestratorActorContext(req: Request): OrchestratorActorContext {
  return {
    requestId: randomUUID(),
    actorUserId: readHeaderStringValue(req.headers['x-internal-user-id']),
    actorTenantId: readHeaderStringValue(req.headers['x-internal-tenant-id']),
    correlationId: readHeaderStringValue(req.headers['x-correlation-id']),
  };
}

// Orquestrador: estado e controles canônicos
app.get('/api/gpu/orchestrator/state', requireInternalAuth, asyncHandler(async (_req: Request, res: Response) => {
  const snapshot = await gpuRuntimeStateStore.getCurrentStateWithEvents(10);
  if (!snapshot.state) {
    await persistRuntimeSnapshot({
      eventType: 'state_snapshot',
      triggerSource: 'system',
      reason: 'Inicialização de estado durável por leitura operacional',
      metadata: { endpoint: '/api/gpu/orchestrator/state' },
    });
  }

  res.json({
    state: getOrchestratorState(),
    fsmState: getOrchestratorState(),
    orchestratorAvailable,
    orchestrationMode: GPU_ORCHESTRATION_MODE,
    durableState: snapshot.state,
    recentEvents: snapshot.events,
  });
}));

app.post('/api/gpu/orchestrator/prepare-training', requireInternalAuth, requireOrchestratorControlAuthorization, asyncHandler(async (req: Request, res: Response) => {
  if (!orchestratorAvailable) {
    return res.status(503).json({ error: 'Orquestrador não disponível' });
  }
  const actor = buildOrchestratorActorContext(req);

  await persistRuntimeSnapshot({
    eventType: 'switch_requested',
    triggerSource: 'manual_api',
    requestId: actor.requestId,
    correlationId: actor.correlationId,
    reason: 'Preparação manual da GPU para treinamento solicitada por operador',
    actorUserId: actor.actorUserId,
    actorTenantId: actor.actorTenantId,
    metadata: { endpoint: '/api/gpu/orchestrator/prepare-training' },
  });

  try {
    await runOrchestratorAction({
      action: 'prepare_training',
      trigger: 'manual_api',
      reason: 'Preparação manual da GPU para treinamento',
    });
    await persistRuntimeSnapshot({
      eventType: 'switch_completed',
      triggerSource: 'manual_api',
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      reason: 'Preparação manual da GPU para treinamento concluída',
      actorUserId: actor.actorUserId,
      actorTenantId: actor.actorTenantId,
      metadata: { endpoint: '/api/gpu/orchestrator/prepare-training' },
    });
  } catch (error) {
    await persistRuntimeSnapshot({
      eventType: 'switch_failed',
      triggerSource: 'manual_api',
      outcome: 'error',
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      reason: error instanceof Error ? error.message : String(error),
      actorUserId: actor.actorUserId,
      actorTenantId: actor.actorTenantId,
      metadata: { endpoint: '/api/gpu/orchestrator/prepare-training' },
    });
    throw error;
  }

  res.json({ state: getOrchestratorState(), message: 'GPU preparada para treinamento' });
}));

app.post('/api/gpu/orchestrator/restore-serving', requireInternalAuth, requireOrchestratorControlAuthorization, asyncHandler(async (req: Request, res: Response) => {
  if (!orchestratorAvailable) {
    return res.status(503).json({ error: 'Orquestrador não disponível' });
  }
  const actor = buildOrchestratorActorContext(req);

  await persistRuntimeSnapshot({
    eventType: 'manual_restore_requested',
    triggerSource: 'manual_api',
    requestId: actor.requestId,
    correlationId: actor.correlationId,
    reason: 'Restore manual de serving solicitado por operador',
    actorUserId: actor.actorUserId,
    actorTenantId: actor.actorTenantId,
    metadata: { endpoint: '/api/gpu/orchestrator/restore-serving' },
  });

  try {
    await runOrchestratorAction({
      action: 'restore_serving',
      trigger: 'manual_api',
      reason: 'Restore manual de serving',
    });
    await persistRuntimeSnapshot({
      eventType: 'manual_restore_completed',
      triggerSource: 'manual_api',
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      reason: 'Restore manual de serving concluído',
      actorUserId: actor.actorUserId,
      actorTenantId: actor.actorTenantId,
      metadata: { endpoint: '/api/gpu/orchestrator/restore-serving' },
    });
  } catch (error) {
    await persistRuntimeSnapshot({
      eventType: 'manual_restore_failed',
      triggerSource: 'manual_api',
      outcome: 'error',
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      reason: error instanceof Error ? error.message : String(error),
      actorUserId: actor.actorUserId,
      actorTenantId: actor.actorTenantId,
      metadata: { endpoint: '/api/gpu/orchestrator/restore-serving' },
    });
    throw error;
  }

  res.json({ state: getOrchestratorState(), message: 'Serving restaurado com sucesso' });
}));

// Alias de compatibilidade legada.
app.post('/api/gpu/orchestrator/return', requireInternalAuth, requireOrchestratorControlAuthorization, asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('X-Alice-Deprecated-Alias', '/api/gpu/orchestrator/restore-serving');

  if (!orchestratorAvailable) {
    return res.status(503).json({ error: 'Orquestrador não disponível' });
  }
  const actor = buildOrchestratorActorContext(req);

  await persistRuntimeSnapshot({
    eventType: 'manual_restore_requested',
    triggerSource: 'manual_api',
    requestId: actor.requestId,
    correlationId: actor.correlationId,
    reason: 'Restore manual de serving solicitado por alias legado',
    actorUserId: actor.actorUserId,
    actorTenantId: actor.actorTenantId,
    metadata: { endpoint: '/api/gpu/orchestrator/return', aliasFor: '/api/gpu/orchestrator/restore-serving' },
  });

  try {
    await runOrchestratorAction({
      action: 'restore_serving',
      trigger: 'manual_api',
      reason: 'Restore manual de serving (alias legado /return)',
    });
    await persistRuntimeSnapshot({
      eventType: 'manual_restore_completed',
      triggerSource: 'manual_api',
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      reason: 'Restore manual de serving concluído por alias legado',
      actorUserId: actor.actorUserId,
      actorTenantId: actor.actorTenantId,
      metadata: { endpoint: '/api/gpu/orchestrator/return', aliasFor: '/api/gpu/orchestrator/restore-serving' },
    });
  } catch (error) {
    await persistRuntimeSnapshot({
      eventType: 'manual_restore_failed',
      triggerSource: 'manual_api',
      outcome: 'error',
      requestId: actor.requestId,
      correlationId: actor.correlationId,
      reason: error instanceof Error ? error.message : String(error),
      actorUserId: actor.actorUserId,
      actorTenantId: actor.actorTenantId,
      metadata: { endpoint: '/api/gpu/orchestrator/return', aliasFor: '/api/gpu/orchestrator/restore-serving' },
    });
    throw error;
  }

  res.json({ state: getOrchestratorState(), message: 'Serving restaurado com sucesso' });
}));

// Streaming LLM (bypass fila - proxy direto com verificação de circuit breaker e VRAM)
// Gate 2 (15/01/2026): Sem orquestração dinâmica, serviço sempre ativo
app.post('/api/gpu/stream', requireInternalAuth, asyncHandler(async (req: Request, res: Response) => {
  const schema = z.object({
    serviceType: z.nativeEnum(GpuServiceType),
    endpoint: z.string(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
    body: z.unknown().optional(),
    headers: z.record(z.string()).optional(),
    timeout: z.number().optional(),
  });
  
  const body = schema.parse(req.body);
  const serviceType = body.serviceType;
  
  // Gate 2: streaming é suportado pelo LLM (texto)
  if (serviceType !== GpuServiceType.LLM) {
    return res.status(400).json({ error: 'Streaming suportado apenas para LLM' });
  }

  // Gate 2: Serviço sempre ativo, sem orquestração dinâmica
  const url = GPU_SERVICE_URLS[serviceType];
  const protectedFetch = protectedFetchByServiceType[serviceType];
  
  // Verificar VRAM disponível
  const vramStatus = await getVramStatus();
  const admissionRuntimeFlags = buildAdmissionRuntimeFlags(serviceType);
  const admissionReason = admissionControlReason({
    serviceType,
    priority: GpuRequestPriority.CRITICAL,
    vramStatus,
    vramRequirements: VRAM_REQUIREMENTS,
    vramSafetyMarginGb: VRAM_SAFETY_MARGIN_GB,
    admissionMinFreeGb: ADMISSION_MIN_FREE_GB,
    isTransitionInProgress: admissionRuntimeFlags.isTransitionInProgress,
    isServingPreemptedForTraining: admissionRuntimeFlags.isServingPreemptedForTraining,
    logger,
  });
  if (admissionReason) {
    trackGpuRejection(serviceType, admissionReason);
    const statusCode = (admissionReason === 'low_vram_low_priority') ? 429 : 503;
    res.setHeader('Retry-After', String(GPU_RETRY_AFTER_SECONDS));
    return res.status(statusCode).json({
      error: 'Requisição rejeitada pelo admission control',
      reason: admissionReason,
      requiredGB: VRAM_REQUIREMENTS[serviceType] + VRAM_SAFETY_MARGIN_GB,
      availableGB: vramStatus.freeGB,
      retryAfterSeconds: GPU_RETRY_AFTER_SECONDS,
    });
  }
  
  try {
    const streamingRequestId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const timeoutMs = body.timeout || GPU_SERVICE_TIMEOUT;
    const streamAbortController = new AbortController();

    // Streaming também precisa de lock global (GPU única) para garantir prioridade e VRAM
    const lockTtlMs = Math.min(timeoutMs + 30000, 5 * 60 * 1000);
    const acquired = await tryAcquireGpuLock(serviceType, streamingRequestId, lockTtlMs);
    if (!acquired) {
      trackGpuRejection(serviceType, 'gpu_busy');
      res.setHeader('Retry-After', String(GPU_RETRY_AFTER_SECONDS));
      return res.status(503).json({ error: 'GPU ocupada - tente novamente', retryAfterSeconds: GPU_RETRY_AFTER_SECONDS });
    }

    await markServiceActive(serviceType, streamingRequestId);
    const unregisterActiveStream = registerActiveStream(streamingRequestId, {
      abortController: streamAbortController,
      close: () => {
        if (!res.writableEnded) {
          res.end();
        }
      },
    });

    try {
      const requestBody = applyStructuredOutputs({
        serviceType,
        endpoint: body.endpoint,
        body: body.body,
      });
      const response = await protectedFetch(`${url}${body.endpoint}`, {
        method: body.method || 'POST',
        headers: {
          ...(body.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
          ...body.headers,
        },
        body: body.method !== 'GET' && requestBody ? JSON.stringify(requestBody) : undefined,
        signal: streamAbortController.signal,
        timeoutMs,
      });

      if (!response.ok) {
        const errorText = await response.text();
        res.status(response.status).json({ error: errorText });
        return;
      }

      if (!response.body) {
        res.status(500).json({ error: 'Resposta de streaming não contém body' });
        return;
      }

      // ARQUITETURA DE STREAMING (25/12/2025):
      // 1. GPU Manager Service faz fetch do gpu-mixtral e recebe Response com stream
      // 2. GPU Manager Service faz proxy do stream para sua resposta HTTP (res.write)
      // 3. Chat-service faz fetch do endpoint /api/gpu/stream e recebe Response com stream
      // 4. Chat-service faz proxy do stream para sua resposta HTTP (res.write)
      //
      // São duas requisições HTTP diferentes => não há conflito de body consumido.

      // Proxy do stream diretamente para o cliente (chat-service fará fetch deste endpoint e fará proxy)
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const flushSseChunk = () => {
        const flusher = (res as unknown as { flush?: () => void }).flush;
        if (typeof flusher === 'function') flusher();
      };

      let heartbeatHandle: ReturnType<typeof setInterval> | null = setInterval(() => {
        if (res.writableEnded) {
          if (heartbeatHandle) {
            clearInterval(heartbeatHandle);
            heartbeatHandle = null;
          }
          return;
        }
        try {
          res.write(':\n\n');
          flushSseChunk();
        } catch {
          if (heartbeatHandle) {
            clearInterval(heartbeatHandle);
            heartbeatHandle = null;
          }
        }
      }, 15000);

      const clearHeartbeat = () => {
        if (heartbeatHandle) {
          clearInterval(heartbeatHandle);
          heartbeatHandle = null;
        }
      };
      res.on('close', clearHeartbeat);
      res.on('finish', clearHeartbeat);

      // Pipe do stream (proxy direto)
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          if (!chunk) continue;
          res.write(chunk);
          flushSseChunk();
        }

        clearHeartbeat();
        res.end();
      } catch (error) {
        clearHeartbeat();
        logger.error({ error }, 'Erro ao fazer proxy de stream');
        if (!res.headersSent) {
          res.status(500).json({ error: 'Erro ao fazer proxy de stream' });
        } else {
          res.end();
        }
      } finally {
        reader.releaseLock();
      }
    } finally {
      unregisterActiveStream();
      await markServiceInactive(serviceType);
      await releaseGpuLockIfOwned(streamingRequestId);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn({ reason: 'serving_preempted_for_training' }, 'Streaming interrompido por preempção de serving');
      if (!res.headersSent) {
        res.status(503).json({
          error: 'Streaming interrompido por preempção de serving',
          reason: 'serving_preempted_for_training',
        });
      }
      return;
    }
    logger.error({ 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined 
    }, 'Erro na requisição streaming');
    if (!res.headersSent) {
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Erro desconhecido' 
      });
    }
  }
}));

// Status de VRAM
// BUG FIX 25/12/2025: Usar requireInternalAuth ao invés de requireAuth (aceita X-Internal-Api-Secret)
app.get('/api/gpu/vram', requireInternalAuth, asyncHandler(async (req: Request, res: Response) => {
  const vramStatus = await getVramStatus();
  res.json(vramStatus);
}));

// Status da fila
// BUG FIX 25/12/2025: Usar requireInternalAuth ao invés de requireAuth (aceita X-Internal-Api-Secret)
app.get('/api/gpu/queue/status', requireInternalAuth, asyncHandler(async (req: Request, res: Response) => {
  const redis = getRedisClient();
  if (!redis) {
    return res.status(503).json({ error: 'Redis não disponível' });
  }
  
  const status: Record<string, number> = {};
  
  for (const serviceType of Object.values(GpuServiceType)) {
    const queueKey = `${REDIS_QUEUE_PREFIX}:${serviceType}`;
    const count = await redis.zCard(queueKey);
    status[serviceType] = count;
  }
  
  res.json({
    queues: status,
    activeServices: (await getVramStatus()).activeServices,
  });
}));

// ===========================================================================
// Gate 2 (15/01/2026): Status dos serviços GPU
// ===========================================================================
// Endpoint para monitorar estado dos serviços GPU
// Todos rodam simultaneamente na nova arquitetura
app.get('/api/gpu/services', requireInternalAuth, asyncHandler(async (req: Request, res: Response) => {
  const vramStatus = await getVramStatus();
  
  // Gate 2: todos os serviços rodam simultaneamente EXCETO TRAINING
  // TRAINING é sob demanda (on_demand) - só inicia quando há job de fine-tuning
  const services: Record<string, { vramGB: number; url: string; status: string }> = {};
  for (const [type, url] of Object.entries(GPU_SERVICE_URLS)) {
    services[type] = {
      vramGB: VRAM_REQUIREMENTS[type as GpuServiceType],
      url,
      // FIX Bug 4 (11/01/2026): TRAINING é sob demanda, não always_active
      status: type === GpuServiceType.TRAINING ? 'on_demand' : 'always_active',
    };
  }
  
  // Gate 2: Calcular VRAM dinamicamente (exclui TRAINING - sob demanda)
  // BUG FIX 11/01/2026: vramFreeGB agora usa o mesmo cálculo de totalVramUsedGB
  // Antes: vramFreeGB era hardcoded (TOTAL_VRAM_GB - 15), causando inconsistência
  const totalVramUsedGB = Object.entries(VRAM_REQUIREMENTS)
    .filter(([key]) => key !== GpuServiceType.TRAINING)
    .reduce((sum, [, vram]) => sum + vram, 0);
  
  res.json({
    architecture: 'gate2',
    description: `Serviços GPU simultâneos (budget declarado: ${totalVramUsedGB}GB de ${TOTAL_VRAM_GB}GB; uso real via nvidia-smi quando disponível)`,
    services,
    vram: vramStatus,
    totalVramUsedGB,
    vramFreeGB: TOTAL_VRAM_GB - totalVramUsedGB,
  });
}));

// Métricas Prometheus
const prometheus = createAlicePrometheus({ serviceName: 'gpu-manager' });

// Helper: GPU única no GEX44 (RTX 4000 Ada). Mantemos configurável para suportar expansão futura.
const GPU_ID = readOptionalStringEnv('NVIDIA_GPU_ID') ?? '0';
const {
  gpuVramTotalBytes,
  gpuVramUsedBytes,
  gpuManagerVramFreeBytes,
  gpuVramReservedBytes,
  gpuManagerQueueDepth,
  gpuManagerQueueWaitDuration,
  gpuManagerRejectionsTotal,
  gpuOrchestratorTransitionsTotal,
  gpuOrchestratorTransitionDurationSeconds,
  gpuOrchestratorState,
  gpuManagerActiveStreams,
  gpuManagerForcedInterruptionsTotal,
  gpuOrchestratorDrainDurationSeconds,
} = createGpuManagerMetrics(prometheus.registry);

trackOrchestratorStateGauge(getOrchestratorState());
onOrchestratorTransition((transition) => recordOrchestratorTransition(transition));
syncActiveStreamsMetric();

// CORREÇÃO 26/12/2025: Usar contentType correto do registry (application/openmetrics-text)
// Padrão consistente com packages/shared-utils/src/prometheus.ts linha 702
app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', prometheus.registry.contentType);
    res.end(await prometheus.registry.metrics());
  } catch (error) {
    logger.error({ error }, 'Erro ao gerar métricas Prometheus');
    res.status(500).end('Erro ao gerar métricas');
  }
});

// Error handlers
app.use(createErrorHandler());
app.use(createNotFoundHandler());

// ============================================================================
// INICIALIZAÇÃO
// ============================================================================

void startGpuManagerBootstrap({
  logger,
  server,
  port: PORT,
  totalVramGb: TOTAL_VRAM_GB,
  vramSafetyMarginGb: VRAM_SAFETY_MARGIN_GB,
  vramRequirements: VRAM_REQUIREMENTS,
  admissionThresholds: ADMISSION_MIN_FREE_GB,
  getNvidiaSmiStatus: () => (nvidiaSmiAvailable === null ? 'unknown' : nvidiaSmiAvailable ? 'available' : 'unavailable'),
  resolveOrchestratorAvailability: isOrchestratorAvailable,
  orchestrationMode: GPU_ORCHESTRATION_MODE,
  setOrchestratorAvailable: (value) => {
    orchestratorAvailable = value;
    void persistRuntimeSnapshot({
      eventType: 'state_snapshot',
      triggerSource: 'startup',
      reason: 'Snapshot inicial após verificação de disponibilidade do orquestrador',
      metadata: { orchestratorAvailable: value },
    });
  },
  startQueueWorker,
  stopQueueWorker,
  shutdownOrchestrator,
});
