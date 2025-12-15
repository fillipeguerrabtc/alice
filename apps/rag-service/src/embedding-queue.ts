/**
 * Embedding Queue Service - Alice Enterprise Platform
 * 
 * Fila Redis para processamento assíncrono de embeddings com GPUs Salad Cloud.
 * Implementa estratégia "Warm on Demand" para otimização de custos.
 * 
 * Estratégia:
 * - GPUs mantidas "quentes" por 30 minutos após último uso
 * - Processamento assíncrono via fila Redis
 * - WebSocket para notificações em tempo real
 * - Circuit breaker para resiliência (Regra 16)
 * 
 * ARQUITETURA 100% GPU (Opção B - Alta Qualidade) - 15/12/2025:
 * - BGE-M3: 1024 dim (texto/documentos)
 * - OpenCLIP ViT-H/14: 1024 dim (imagens + text-to-image)
 * 
 * Autor: Fillipe Guerra
 * Data: 15 de Dezembro de 2025
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { createLogger } from '@alice/logger';
import { getRedisClient, isRedisAvailable } from '@alice/shared-utils';
import { randomUUID } from 'crypto';

const logger = createLogger('embedding-queue');

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

/** Tempo de keep-warm em ms (30 minutos) */
const KEEP_WARM_MS = 30 * 60 * 1000;

/** Prefixo para chaves Redis */
const REDIS_PREFIX = 'alice:embeddings';

/** 
 * TTL padrão para dados do job em segundos (24 horas)
 * 
 * IMPORTANTE: Este TTL deve ser maior que o tempo máximo esperado na fila.
 * Se o TTL for menor que o tempo de espera, os dados do job expiram antes
 * do processamento, causando perda silenciosa de jobs.
 * 
 * Histórico:
 * - Valor anterior: 1 hora (3600s) - causava perda de jobs em filas congestionadas
 * - Valor atual: 24 horas (86400s) - margem de segurança enterprise
 * 
 * Nota: A entrada na fila (sorted set via zAdd) não tem TTL, apenas os dados do job.
 */
const JOB_TTL_SECONDS = 60 * 60 * 24; // 24 horas

/** Tamanho máximo do batch para processamento */
const MAX_BATCH_SIZE = 10;

// ============================================================================
// TIPOS
// ============================================================================

export type EmbeddingJobType = 'text' | 'text-for-image' | 'image' | 'batch-text' | 'batch-image';

export type EmbeddingJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface EmbeddingJob {
  id: string;
  type: EmbeddingJobType;
  tenantId: string;
  userId?: string;
  status: EmbeddingJobStatus;
  priority: number; // 1 = alta, 10 = baixa
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  // Dados de entrada
  input: {
    text?: string;
    texts?: string[];
    imageBase64?: string;
    imagesBase64?: string[];
  };
  // Resultado
  result?: {
    embedding?: number[];
    embeddings?: number[][];
    model: string;
    dimension: number;
    processingTimeMs: number;
  };
  // Metadados
  metadata?: {
    source?: string; // 'media-upload', 'document-upload', 'search', etc.
    correlationId?: string;
    originalFilename?: string;
  };
}

export interface EmbeddingQueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  lastActivityAt: string | null;
  gpuWarmUntil: string | null;
  isGpuWarm: boolean;
}

// ============================================================================
// GPU WARM STATE (Singleton)
// ============================================================================

interface GpuWarmState {
  warmUntil: number; // timestamp em ms
  lastActivity: number; // timestamp em ms
}

const gpuState: GpuWarmState = {
  warmUntil: 0,
  lastActivity: 0,
};

/**
 * Atualiza timestamp de última atividade e estende período warm
 */
function touchGpuWarm(): void {
  const now = Date.now();
  gpuState.lastActivity = now;
  gpuState.warmUntil = now + KEEP_WARM_MS;
  
  logger.debug({
    warmUntil: new Date(gpuState.warmUntil).toISOString(),
    keepWarmMinutes: KEEP_WARM_MS / 60000,
  }, 'GPU warm period estendido');
}

/**
 * Verifica se GPU está "quente" (dentro do período warm)
 */
export function isGpuWarm(): boolean {
  return Date.now() < gpuState.warmUntil;
}

/**
 * Retorna timestamp até quando GPU estará warm
 */
export function getGpuWarmUntil(): Date | null {
  if (!isGpuWarm()) return null;
  return new Date(gpuState.warmUntil);
}

/**
 * Retorna timestamp da última atividade
 */
export function getLastGpuActivity(): Date | null {
  if (gpuState.lastActivity === 0) return null;
  return new Date(gpuState.lastActivity);
}

// ============================================================================
// FILA REDIS
// ============================================================================

const QUEUE_KEY = `${REDIS_PREFIX}:queue`;
const PROCESSING_KEY = `${REDIS_PREFIX}:processing`;
const JOBS_KEY = `${REDIS_PREFIX}:jobs`;
const STATS_KEY = `${REDIS_PREFIX}:stats`;

/**
 * Adiciona job de embedding na fila
 */
export async function enqueueEmbeddingJob(
  job: Omit<EmbeddingJob, 'id' | 'status' | 'createdAt'>
): Promise<string> {
  const client = getRedisClient();
  
  if (!client) {
    throw new Error('Redis não disponível - embedding queue requer Redis (Regra 6)');
  }
  
  const jobId = randomUUID();
  const fullJob: EmbeddingJob = {
    ...job,
    id: jobId,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  
  // Salvar job completo
  await client.setEx(
    `${JOBS_KEY}:${jobId}`,
    JOB_TTL_SECONDS,
    JSON.stringify(fullJob)
  );
  
  // Adicionar à fila ordenada por prioridade
  await client.zAdd(QUEUE_KEY, {
    score: job.priority,
    value: jobId,
  });
  
  // Incrementar contador de pendentes
  await client.hIncrBy(STATS_KEY, 'pending', 1);
  
  logger.info({
    jobId,
    type: job.type,
    tenantId: job.tenantId,
    priority: job.priority,
  }, 'Job de embedding enfileirado');
  
  return jobId;
}

/**
 * Obtém próximo job da fila (com lock)
 */
export async function dequeueEmbeddingJob(): Promise<EmbeddingJob | null> {
  const client = getRedisClient();
  
  if (!client) {
    logger.warn('Redis não disponível para dequeue');
    return null;
  }
  
  // Buscar job com menor score (maior prioridade)
  const result = await client.zPopMin(QUEUE_KEY);
  
  if (!result) {
    return null;
  }
  
  const jobId = result.value;
  
  // Buscar dados completos do job
  const jobData = await client.get(`${JOBS_KEY}:${jobId}`);
  
  if (!jobData) {
    // Bug fix: Dados do job expiraram (TTL JOB_TTL_SECONDS) mas entrada na fila (zAdd) não tem TTL
    // O job já foi removido da fila via zPopMin acima, então devemos:
    // 1. Decrementar contador 'pending' para manter stats consistentes
    // 2. Logar como erro (perda de dados - job não pode ser recuperado)
    logger.error({
      jobId,
      ttlSeconds: JOB_TTL_SECONDS,
    }, 'PERDA DE JOB: Dados do job expiraram antes de ser processado. Job removido da fila mas dados não disponíveis. Verifique se a fila está congestionada.');
    
    // Decrementar pending para manter consistência das stats
    // O job foi contabilizado como pending quando enfileirado (linha 190)
    await client.hIncrBy(STATS_KEY, 'pending', -1);
    
    return null;
  }
  
  const job: EmbeddingJob = JSON.parse(jobData);
  
  // Marcar como processing
  job.status = 'processing';
  job.startedAt = new Date().toISOString();
  
  await client.setEx(
    `${JOBS_KEY}:${jobId}`,
    JOB_TTL_SECONDS,
    JSON.stringify(job)
  );
  
  // Adicionar à lista de processamento
  await client.sAdd(PROCESSING_KEY, jobId);
  
  // Atualizar contadores
  await client.hIncrBy(STATS_KEY, 'pending', -1);
  await client.hIncrBy(STATS_KEY, 'processing', 1);
  
  return job;
}

/**
 * Marca job como completo
 */
export async function completeEmbeddingJob(
  jobId: string,
  result: EmbeddingJob['result']
): Promise<void> {
  const client = getRedisClient();
  
  if (!client) {
    throw new Error('Redis não disponível');
  }
  
  const jobData = await client.get(`${JOBS_KEY}:${jobId}`);
  
  if (!jobData) {
    throw new Error(`Job ${jobId} não encontrado`);
  }
  
  const job: EmbeddingJob = JSON.parse(jobData);
  job.status = 'completed';
  job.completedAt = new Date().toISOString();
  job.result = result;
  
  await client.setEx(
    `${JOBS_KEY}:${jobId}`,
    JOB_TTL_SECONDS,
    JSON.stringify(job)
  );
  
  // Remover da lista de processamento
  await client.sRem(PROCESSING_KEY, jobId);
  
  // Atualizar contadores
  await client.hIncrBy(STATS_KEY, 'processing', -1);
  await client.hIncrBy(STATS_KEY, 'completed', 1);
  
  // Atualizar timestamp de última atividade e estender warm period
  touchGpuWarm();
  await client.set(`${STATS_KEY}:lastActivity`, new Date().toISOString());
  
  logger.info({
    jobId,
    processingTimeMs: result.processingTimeMs,
    dimension: result.dimension,
  }, 'Job de embedding completado');
}

/**
 * Marca job como falho
 */
export async function failEmbeddingJob(
  jobId: string,
  error: string
): Promise<void> {
  const client = getRedisClient();
  
  if (!client) {
    throw new Error('Redis não disponível');
  }
  
  const jobData = await client.get(`${JOBS_KEY}:${jobId}`);
  
  if (!jobData) {
    throw new Error(`Job ${jobId} não encontrado`);
  }
  
  const job: EmbeddingJob = JSON.parse(jobData);
  job.status = 'failed';
  job.completedAt = new Date().toISOString();
  job.error = error;
  
  await client.setEx(
    `${JOBS_KEY}:${jobId}`,
    JOB_TTL_SECONDS,
    JSON.stringify(job)
  );
  
  // Remover da lista de processamento
  await client.sRem(PROCESSING_KEY, jobId);
  
  // Atualizar contadores
  await client.hIncrBy(STATS_KEY, 'processing', -1);
  await client.hIncrBy(STATS_KEY, 'failed', 1);
  
  logger.error({ jobId, error }, 'Job de embedding falhou');
}

/**
 * Obtém status de um job
 */
export async function getEmbeddingJobStatus(jobId: string): Promise<EmbeddingJob | null> {
  const client = getRedisClient();
  
  if (!client) {
    return null;
  }
  
  const jobData = await client.get(`${JOBS_KEY}:${jobId}`);
  
  if (!jobData) {
    return null;
  }
  
  return JSON.parse(jobData) as EmbeddingJob;
}

/**
 * Obtém estatísticas da fila
 */
export async function getEmbeddingQueueStats(): Promise<EmbeddingQueueStats> {
  const client = getRedisClient();
  
  const defaultStats: EmbeddingQueueStats = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    lastActivityAt: getLastGpuActivity()?.toISOString() || null,
    gpuWarmUntil: getGpuWarmUntil()?.toISOString() || null,
    isGpuWarm: isGpuWarm(),
  };
  
  if (!client) {
    return defaultStats;
  }
  
  try {
    const stats = await client.hGetAll(STATS_KEY);
    const lastActivity = await client.get(`${STATS_KEY}:lastActivity`);
    
    return {
      pending: parseInt(stats.pending || '0', 10),
      processing: parseInt(stats.processing || '0', 10),
      completed: parseInt(stats.completed || '0', 10),
      failed: parseInt(stats.failed || '0', 10),
      lastActivityAt: lastActivity || getLastGpuActivity()?.toISOString() || null,
      gpuWarmUntil: getGpuWarmUntil()?.toISOString() || null,
      isGpuWarm: isGpuWarm(),
    };
  } catch (error) {
    logger.error({ error }, 'Erro ao obter estatísticas da fila');
    return defaultStats;
  }
}

/**
 * Obtém tamanho atual da fila
 */
export async function getQueueSize(): Promise<number> {
  const client = getRedisClient();
  
  if (!client) {
    return 0;
  }
  
  return await client.zCard(QUEUE_KEY);
}

/**
 * Obtém jobs pendentes para processamento em batch
 */
export async function getBatchJobs(maxSize: number = MAX_BATCH_SIZE): Promise<EmbeddingJob[]> {
  const client = getRedisClient();
  
  if (!client) {
    return [];
  }
  
  // Buscar IDs dos jobs com menor score (maior prioridade)
  const jobIds = await client.zRange(QUEUE_KEY, 0, maxSize - 1);
  
  if (jobIds.length === 0) {
    return [];
  }
  
  const jobs: EmbeddingJob[] = [];
  
  for (const jobId of jobIds) {
    const jobData = await client.get(`${JOBS_KEY}:${jobId}`);
    if (jobData) {
      jobs.push(JSON.parse(jobData));
    }
  }
  
  return jobs;
}

/**
 * Limpa jobs antigos (completados/falhos)
 */
export async function cleanupOldJobs(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
  const client = getRedisClient();
  
  if (!client) {
    return 0;
  }
  
  const cutoff = Date.now() - maxAgeMs;
  let cleaned = 0;
  
  // Buscar todos os jobs
  const keys = await client.keys(`${JOBS_KEY}:*`);
  
  for (const key of keys) {
    const jobData = await client.get(key);
    if (!jobData) continue;
    
    const job: EmbeddingJob = JSON.parse(jobData);
    
    // Remover apenas jobs completados ou falhos antigos
    if (['completed', 'failed'].includes(job.status)) {
      const completedAt = job.completedAt ? new Date(job.completedAt).getTime() : 0;
      
      if (completedAt < cutoff) {
        await client.del(key);
        cleaned++;
      }
    }
  }
  
  logger.info({ cleaned, maxAgeHours: maxAgeMs / 3600000 }, 'Jobs antigos limpos');
  
  return cleaned;
}

/**
 * Verifica se a fila está disponível (Redis conectado)
 */
export function isQueueAvailable(): boolean {
  return isRedisAvailable();
}

// ============================================================================
// WEBSOCKET NOTIFICATIONS (Pub/Sub)
// ============================================================================

const PUBSUB_CHANNEL = `${REDIS_PREFIX}:notifications`;

export interface EmbeddingNotification {
  type: 'job_completed' | 'job_failed' | 'queue_stats';
  jobId?: string;
  tenantId: string;
  data: unknown;
  timestamp: string;
}

/**
 * Publica notificação de job completado/falho
 */
export async function publishNotification(notification: EmbeddingNotification): Promise<void> {
  const client = getRedisClient();
  
  if (!client) {
    return;
  }
  
  await client.publish(PUBSUB_CHANNEL, JSON.stringify(notification));
}

/**
 * Retorna o canal de pub/sub para assinatura
 */
export function getNotificationChannel(): string {
  return PUBSUB_CHANNEL;
}

// ============================================================================
// EXPORTS ADICIONAIS
// ============================================================================

export {
  KEEP_WARM_MS,
  MAX_BATCH_SIZE,
  touchGpuWarm,
};
