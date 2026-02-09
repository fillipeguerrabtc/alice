/**
 * Post-Mortem Worker - Fila Redis para processamento assíncrono de post-mortems
 * 
 * Arquitetura:
 * - Sorted Set Redis (ZSET) com score = timestamp de agendamento
 * - Serializado por tenant (1 post-mortem por vez por tenant)
 * - Retry com exponential backoff (max 3 tentativas)
 * - Dead Letter Queue para jobs que excederam retries
 * - Métricas Prometheus para observabilidade
 * 
 * @author Fillipe Guerra
 * @since 09/02/2026
 */

import { createLogger } from '@alice/logger';
import {
  getRedisClient,
  Counter as PromCounter,
  Histogram as PromHistogram,
  Gauge as PromGauge,
} from '@alice/shared-utils';
// Banco de dados importado no postmortem-engine.ts (responsável por persistência)
import { executePostMortem } from './postmortem-engine.js';
import type { PostMortemPositionData } from './postmortem-engine.js';
import type { TechnicalAnalysisResult } from './technical-indicators.js';

const logger = createLogger('postmortem-worker');

// ============================================================================
// Métricas Prometheus
// ============================================================================

const postmortemJobsTotal = new PromCounter({
  name: 'alice_postmortem_jobs_total',
  help: 'Total de jobs de post-mortem processados',
  labelNames: ['status', 'is_demo'] as const,
});

const postmortemJobDuration = new PromHistogram({
  name: 'alice_postmortem_job_duration_seconds',
  help: 'Duração do processamento de post-mortem em segundos',
  labelNames: ['phase'] as const,
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
});

const postmortemQueueSize = new PromGauge({
  name: 'alice_postmortem_queue_size',
  help: 'Tamanho atual da fila de post-mortem',
  labelNames: ['queue_type'] as const,
});

const postmortemDlqSize = new PromGauge({
  name: 'alice_postmortem_dlq_size',
  help: 'Tamanho atual da Dead Letter Queue',
});

// ============================================================================
// Constantes
// ============================================================================

/** Chave Redis para a fila principal de post-mortem */
const QUEUE_KEY = 'alice:postmortem:queue';

/** Chave Redis para Dead Letter Queue */
const DLQ_KEY = 'alice:postmortem:dlq';

/** Prefixo para dados do job em Redis */
const JOB_DATA_PREFIX = 'alice:postmortem:job:';

/** Prefixo para locks de tenant (serialização) */
const TENANT_LOCK_PREFIX = 'alice:postmortem:lock:';

/** Máximo de retries antes de mover para DLQ */
const MAX_RETRIES = 3;

/** Intervalo de polling da fila (ms) */
const POLL_INTERVAL_MS = 5_000;

/** Timeout do lock de tenant (segundos) */
const TENANT_LOCK_TTL_SECONDS = 300; // 5 minutos

/** TTL dos dados do job em Redis (segundos) */
const JOB_DATA_TTL_SECONDS = 86_400; // 24 horas

// ============================================================================
// Tipos
// ============================================================================

/** Job na fila de post-mortem */
interface PostMortemJob {
  id: string;
  tenantId: string;
  positionId: string;
  isDemo: boolean;
  positionData: PostMortemPositionData;
  indicators?: TechnicalAnalysisResult;
  retryCount: number;
  createdAt: string;
  scheduledAt: string;
}

// ============================================================================
// Estado do worker
// ============================================================================

let isRunning = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

// ============================================================================
// Funções de Fila
// ============================================================================

/**
 * Calcula backoff exponencial para retry
 */
function calculateBackoff(retryCount: number): number {
  // Base: 10s, max: 5min
  const baseMs = 10_000;
  const maxMs = 300_000;
  const backoff = Math.min(baseMs * Math.pow(2, retryCount), maxMs);
  // Jitter: +/- 20%
  const jitter = backoff * 0.2 * (Math.random() * 2 - 1);
  return Math.floor(backoff + jitter);
}

/**
 * Enfileira um post-mortem para processamento assíncrono
 */
export async function enqueuePostMortem(params: {
  positionData: PostMortemPositionData;
  indicators?: TechnicalAnalysisResult;
  delayMs?: number;
}): Promise<string> {
  const redis = getRedisClient();
  if (!redis) {
    logger.warn('Redis não disponível - executando post-mortem sincronamente');
    // Fallback síncrono se Redis não disponível
    const result = await executePostMortem({
      position: params.positionData,
      indicators: params.indicators,
    });
    return result.id;
  }

  const jobId = `pm-${params.positionData.id}-${Date.now()}`;
  const now = Date.now();
  const scheduledAt = now + (params.delayMs ?? 0);

  const job: PostMortemJob = {
    id: jobId,
    tenantId: params.positionData.tenantId,
    positionId: params.positionData.id,
    isDemo: params.positionData.isDemo,
    positionData: params.positionData,
    indicators: params.indicators,
    retryCount: 0,
    createdAt: new Date(now).toISOString(),
    scheduledAt: new Date(scheduledAt).toISOString(),
  };

  // Salvar dados do job em Redis (com TTL)
  await redis.set(
    `${JOB_DATA_PREFIX}${jobId}`,
    JSON.stringify(job),
    { EX: JOB_DATA_TTL_SECONDS }
  );

  // Adicionar na Sorted Set (score = timestamp de execução)
  await redis.zAdd(QUEUE_KEY, { score: scheduledAt, value: jobId });

  logger.info({
    jobId,
    positionId: params.positionData.id,
    tenantId: params.positionData.tenantId,
    isDemo: params.positionData.isDemo,
    scheduledAt: new Date(scheduledAt).toISOString(),
  }, 'Post-mortem enfileirado com sucesso');

  return jobId;
}

/**
 * Tenta adquirir lock de tenant para serialização
 */
async function acquireTenantLock(tenantId: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  const lockKey = `${TENANT_LOCK_PREFIX}${tenantId}`;
  const result = await redis.set(lockKey, '1', {
    NX: true,
    EX: TENANT_LOCK_TTL_SECONDS,
  });

  return result === 'OK';
}

/**
 * Libera lock de tenant
 */
async function releaseTenantLock(tenantId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  const lockKey = `${TENANT_LOCK_PREFIX}${tenantId}`;
  await redis.del(lockKey);
}

/**
 * Processa um job da fila
 */
async function processJob(jobId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  // Buscar dados do job
  const jobDataRaw = await redis.get(`${JOB_DATA_PREFIX}${jobId}`);
  if (!jobDataRaw) {
    logger.warn({ jobId }, 'Dados do job não encontrados - removendo da fila');
    await redis.zRem(QUEUE_KEY, jobId);
    return;
  }

  let job: PostMortemJob;
  try {
    job = JSON.parse(jobDataRaw) as PostMortemJob;
  } catch {
    logger.error({ jobId }, 'Falha ao parsear dados do job');
    await redis.zRem(QUEUE_KEY, jobId);
    return;
  }

  // Tentar adquirir lock do tenant (serialização por tenant)
  const hasLock = await acquireTenantLock(job.tenantId);
  if (!hasLock) {
    // Outro job do mesmo tenant está rodando - reagendar para depois
    const rescheduleMs = 10_000; // 10 segundos
    await redis.zAdd(QUEUE_KEY, { score: Date.now() + rescheduleMs, value: jobId });
    logger.debug({ jobId, tenantId: job.tenantId }, 'Tenant lock ocupado - reagendado');
    return;
  }

  try {
    // Reconstituir datas do positionData (serialized como string no JSON)
    const positionData: PostMortemPositionData = {
      ...job.positionData,
      openedAt: new Date(job.positionData.openedAt),
      closedAt: new Date(job.positionData.closedAt),
    };

    logger.info({
      jobId,
      positionId: job.positionId,
      tenantId: job.tenantId,
      retryCount: job.retryCount,
    }, 'Processando post-mortem job');

    // Executar post-mortem com medição de duração
    const startTime = performance.now();
    const result = await executePostMortem({
      position: positionData,
      indicators: job.indicators,
    });
    const durationSec = (performance.now() - startTime) / 1_000;

    // Registrar duração total no histogram Prometheus
    postmortemJobDuration.observe({ phase: 'total' }, durationSec);

    // Se post-mortem chegou até Phase 2 (status completed), registrar como pipeline completa
    // Se parou na Phase 1 (status completed_cpu), registrar como apenas CPU
    if (result.status === 'completed') {
      postmortemJobDuration.observe({ phase: 'full_pipeline' }, durationSec);
    } else if (result.status === 'completed_cpu') {
      postmortemJobDuration.observe({ phase: 'cpu_only' }, durationSec);
    }

    // Sucesso - limpar job
    await redis.zRem(QUEUE_KEY, jobId);
    await redis.del(`${JOB_DATA_PREFIX}${jobId}`);

    const isDemo = String(job.isDemo ?? false);
    postmortemJobsTotal.inc({ status: 'completed', is_demo: isDemo });
    logger.info({ jobId, positionId: job.positionId, durationSec: durationSec.toFixed(2) }, 'Post-mortem job concluído com sucesso');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    job.retryCount += 1;
    const isDemo = String(job.isDemo ?? false);

    if (job.retryCount >= MAX_RETRIES) {
      // Mover para DLQ
      await redis.zRem(QUEUE_KEY, jobId);
      await redis.zAdd(DLQ_KEY, { score: Date.now(), value: jobId });
      // Atualizar dados do job com informação de falha
      await redis.set(
        `${JOB_DATA_PREFIX}${jobId}`,
        JSON.stringify({ ...job, lastError: errorMessage }),
        { EX: JOB_DATA_TTL_SECONDS }
      );

      postmortemJobsTotal.inc({ status: 'dlq', is_demo: isDemo });
      logger.error({
        jobId,
        positionId: job.positionId,
        retryCount: job.retryCount,
        error: errorMessage,
      }, 'Post-mortem movido para DLQ após exceder retries');
    } else {
      // Reagendar com backoff
      const backoffMs = calculateBackoff(job.retryCount);
      const nextRun = Date.now() + backoffMs;

      await redis.set(
        `${JOB_DATA_PREFIX}${jobId}`,
        JSON.stringify({ ...job, lastError: errorMessage }),
        { EX: JOB_DATA_TTL_SECONDS }
      );
      await redis.zAdd(QUEUE_KEY, { score: nextRun, value: jobId });

      postmortemJobsTotal.inc({ status: 'retry', is_demo: isDemo });
      logger.warn({
        jobId,
        positionId: job.positionId,
        retryCount: job.retryCount,
        nextRunIn: `${Math.round(backoffMs / 1000)}s`,
        error: errorMessage,
      }, 'Post-mortem job falhou - reagendado com backoff');
    }
  } finally {
    await releaseTenantLock(job.tenantId);
  }
}

/**
 * Polling: busca e processa jobs prontos na fila
 */
async function pollQueue(): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    const now = Date.now();

    // Buscar jobs cujo score (scheduledAt) <= now
    const jobIds = await redis.zRangeByScore(QUEUE_KEY, 0, now, { LIMIT: { offset: 0, count: 5 } });

    for (const jobId of jobIds) {
      await processJob(jobId);
    }
  } catch (error) {
    logger.error({ error }, 'Erro no polling da fila de post-mortem');
  }
}

// ============================================================================
// Controle do Worker
// ============================================================================

/**
 * Inicia o worker de processamento de post-mortems
 */
export function startPostMortemWorker(): void {
  if (isRunning) {
    logger.warn('Post-mortem worker já está rodando');
    return;
  }

  isRunning = true;
  logger.info({ pollIntervalMs: POLL_INTERVAL_MS, maxRetries: MAX_RETRIES }, 'Iniciando post-mortem worker');

  const poll = async (): Promise<void> => {
    if (!isRunning) return;
    await pollQueue();
    pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  };

  // Iniciar polling
  void poll();
}

/**
 * Para o worker de processamento
 */
export function stopPostMortemWorker(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info('Post-mortem worker parado');
}

// ============================================================================
// Utilitários de Consulta
// ============================================================================

/**
 * Retorna estatísticas da fila
 */
export async function getQueueStats(): Promise<{
  pending: number;
  dlq: number;
}> {
  const redis = getRedisClient();
  if (!redis) return { pending: 0, dlq: 0 };

  const [pending, dlq] = await Promise.all([
    redis.zCard(QUEUE_KEY),
    redis.zCard(DLQ_KEY),
  ]);

  // Atualizar gauges Prometheus
  postmortemQueueSize.set({ queue_type: 'pending' }, pending);
  postmortemDlqSize.set(dlq);

  return { pending, dlq };
}

/**
 * Reprocessa um job da DLQ (move de volta para a fila principal)
 */
export async function retryDlqJob(jobId: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;

  // Verificar se existe na DLQ
  const score = await redis.zScore(DLQ_KEY, jobId);
  if (score === null) return false;

  // Buscar e resetar retry count
  const jobDataRaw = await redis.get(`${JOB_DATA_PREFIX}${jobId}`);
  if (!jobDataRaw) return false;

  try {
    const job = JSON.parse(jobDataRaw) as PostMortemJob & { lastError?: string };
    job.retryCount = 0;
    delete job.lastError;

    await redis.set(
      `${JOB_DATA_PREFIX}${jobId}`,
      JSON.stringify(job),
      { EX: JOB_DATA_TTL_SECONDS }
    );
  } catch {
    return false;
  }

  // Mover da DLQ para fila principal
  await redis.zRem(DLQ_KEY, jobId);
  await redis.zAdd(QUEUE_KEY, { score: Date.now(), value: jobId });

  logger.info({ jobId }, 'Job movido da DLQ para fila principal');
  return true;
}
