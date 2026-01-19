/**
 * Embedding Worker - Alice Enterprise Platform
 * 
 * Worker para processamento assíncrono de embeddings via fila Redis.
 * 
 * ARQUITETURA ENTERPRISE (26/12/2025):
 * - GPU dedicada (Hetzner GEX44 RTX 4000 Ada 20GB) - SEMPRE disponível
 * - Poll contínuo da fila Redis
 * - Batching inteligente para amortizar latência
 * - Circuit breaker para resiliência (Regra 16)
 * 
 * NOTA (26/12/2025): Estratégia "Warm on Demand" REMOVIDA
 * Com servidor GPU dedicado, containers Docker rodam 24/7 e não há cold start.
 * 
 * EMBEDDINGS:
 * - Qwen3-Embedding-0.6B: 1024 dim (texto/documentos → Qdrant) via GPU Manager Service
 * 
 * Autor: Fillipe Guerra
 * Data: 26 de Dezembro de 2025
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { createLogger } from '@alice/logger';
import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS, instrumentCircuitBreaker, requestGpu, GpuServiceType, GpuRequestPriority } from '@alice/shared-utils';
import type { AliceMetrics } from '@alice/shared-utils';
import { validateEmbeddingDimension, EMBEDDING_DIMENSIONS } from '@alice/database';
import {
  dequeueEmbeddingJob,
  completeEmbeddingJob,
  failEmbeddingJob,
  publishNotification,
  touchGpuWarm,
  isGpuWarm,
  getQueueSize,
  type EmbeddingJob,
} from '../embedding-queue.js';

const logger = createLogger('embedding-worker');

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

// GPU Manager Service - Gerenciamento centralizado de requisições GPU (25/12/2025)
// URL é usada internamente pelo requestGpu, não precisa ser exposta aqui

/** Intervalo de polling em ms */
const POLL_INTERVAL_MS = 1000;

/** Timeout para chamadas GPU em ms */
const GPU_TIMEOUT_MS = 60000;

/** Máximo de jobs processados em paralelo */
const MAX_CONCURRENT = 3;

// ============================================================================
// CIRCUIT BREAKERS (Regra 16 - Resiliência)
// ============================================================================

interface GpuTextParams {
  text: string;
  endpoint: '/embed/text';
}

interface GpuBatchParams {
  texts: string[];
}

interface GpuResponse {
  embedding?: number[];
  embeddings?: number[][];
  model?: string;
  dimension?: number;
  dimensions?: number;
  processing_time_ms?: number;
}

async function callGpuTextApi(params: GpuTextParams): Promise<GpuResponse> {
  // ARQUITETURA ENTERPRISE (25/12/2025): Usar GPU Manager Service
  const gpuResponse = await requestGpu({
    serviceType: GpuServiceType.EMBEDDINGS,
    endpoint: params.endpoint,
    method: 'POST',
    priority: GpuRequestPriority.MEDIUM,
    timeout: GPU_TIMEOUT_MS,
    body: {
      texts: [params.text],
    },
  });

  if (!gpuResponse.success || !gpuResponse.data) {
    throw new Error(gpuResponse.error || 'Erro ao gerar embedding de texto');
  }

  return gpuResponse.data as GpuResponse;
}

async function callGpuBatchApi(params: GpuBatchParams): Promise<GpuResponse> {
  // ARQUITETURA ENTERPRISE (25/12/2025): Usar GPU Manager Service para batch
  const gpuResponse = await requestGpu({
    serviceType: GpuServiceType.EMBEDDINGS,
    endpoint: '/embed/batch',
    method: 'POST',
    priority: GpuRequestPriority.MEDIUM,
    timeout: GPU_TIMEOUT_MS * 2, // Batch leva mais tempo
    body: params,
  });

  if (!gpuResponse.success || !gpuResponse.data) {
    throw new Error(gpuResponse.error || 'Erro ao gerar embeddings em batch');
  }

  return gpuResponse.data as GpuResponse;
}

// Circuit breakers serão criados no start do worker
// Tipos corrigidos: TArgs deve ser array (tuple) para createCircuitBreaker<TArgs extends unknown[], TResult>
let gpuTextBreaker: ReturnType<typeof createCircuitBreaker<[GpuTextParams], GpuResponse>> | null = null;
let gpuBatchBreaker: ReturnType<typeof createCircuitBreaker<[GpuBatchParams], GpuResponse>> | null = null;

// ============================================================================
// PROCESSAMENTO DE JOBS
// ============================================================================

async function processTextJob(job: EmbeddingJob): Promise<void> {
  if (!job.input.text) {
    throw new Error('Texto não fornecido para job de embedding');
  }
  
  if (!gpuTextBreaker) {
    throw new Error('Worker não inicializado');
  }
  
  const startTime = Date.now();
  const result = await gpuTextBreaker.fire({ text: job.input.text, endpoint: '/embed/text' }) as GpuResponse;
  const resolvedEmbedding = result.embedding ?? result.embeddings?.[0];
  
  if (!resolvedEmbedding) {
    throw new Error('Embedding não retornado pela GPU');
  }
  
  // Validar dimensão
  validateEmbeddingDimension(resolvedEmbedding, EMBEDDING_DIMENSIONS.TEXT, 'TEXT');
  
  const processingTimeMs = Date.now() - startTime;
  const resolvedDimension = result.dimension ?? result.dimensions ?? resolvedEmbedding.length;
  
  await completeEmbeddingJob(job.id, {
    embedding: resolvedEmbedding,
    model: result.model ?? 'Qwen/Qwen3-Embedding-0.6B',
    dimension: resolvedDimension,
    processingTimeMs,
  });
  
  // Publicar notificação
  await publishNotification({
    type: 'job_completed',
    jobId: job.id,
    tenantId: job.tenantId,
    data: {
      type: job.type,
      dimension: resolvedDimension,
      processingTimeMs,
    },
    timestamp: new Date().toISOString(),
  });
}

async function processBatchTextJob(job: EmbeddingJob): Promise<void> {
  if (!job.input.texts || job.input.texts.length === 0) {
    throw new Error('Textos não fornecidos para batch');
  }
  
  if (!gpuBatchBreaker) {
    throw new Error('Worker não inicializado');
  }
  
  const startTime = Date.now();
  
  const result = await gpuBatchBreaker.fire({ texts: job.input.texts }) as GpuResponse;
  
  if (!result.embeddings || result.embeddings.length === 0) {
    throw new Error('Embeddings não retornados pela GPU');
  }
  
  const processingTimeMs = Date.now() - startTime;
  const resolvedDimension = result.dimension ?? result.dimensions ?? result.embeddings?.[0]?.length ?? 0;
  
  await completeEmbeddingJob(job.id, {
    embeddings: result.embeddings,
    model: result.model ?? 'Qwen/Qwen3-Embedding-0.6B',
    dimension: resolvedDimension,
    processingTimeMs,
  });
  
  // Publicar notificação
  await publishNotification({
    type: 'job_completed',
    jobId: job.id,
    tenantId: job.tenantId,
    data: {
      type: job.type,
      count: result.embeddings.length,
      dimension: resolvedDimension,
      processingTimeMs,
    },
    timestamp: new Date().toISOString(),
  });
}

async function processJob(job: EmbeddingJob): Promise<void> {
  logger.info({
    jobId: job.id,
    type: job.type,
    tenantId: job.tenantId,
  }, 'Processando job de embedding');
  
  try {
    switch (job.type) {
      case 'text':
        await processTextJob(job);
        break;
      case 'batch-text':
        await processBatchTextJob(job);
        break;
      default:
        throw new Error(`Tipo de job não suportado: ${job.type}`);
    }
    
    // Atualizar warm state após processamento bem-sucedido
    touchGpuWarm();
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    logger.error({
      jobId: job.id,
      type: job.type,
      error: errorMessage,
    }, 'Erro ao processar job de embedding');
    
    await failEmbeddingJob(job.id, errorMessage);
    
    // Publicar notificação de falha
    await publishNotification({
      type: 'job_failed',
      jobId: job.id,
      tenantId: job.tenantId,
      data: { error: errorMessage },
      timestamp: new Date().toISOString(),
    });
  }
}

// ============================================================================
// WORKER LOOP
// ============================================================================

let isRunning = false;
let processedCount = 0;
let currentConcurrent = 0;

async function workerLoop(): Promise<void> {
  while (isRunning) {
    try {
      // Verificar se podemos processar mais jobs
      if (currentConcurrent >= MAX_CONCURRENT) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      
      // Buscar próximo job
      const job = await dequeueEmbeddingJob();
      
      if (!job) {
        // Fila vazia - aguardar antes de tentar novamente
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        continue;
      }
      
      // Processar job em paralelo (não bloquear o loop)
      // Bug fix: Adicionar .catch() para evitar unhandled promise rejection
      // Se failEmbeddingJob ou publishNotification falharem (ex: Redis down),
      // o erro será logado mas não propagará como unhandled rejection
      currentConcurrent++;
      processJob(job)
        .then(() => {
          processedCount++;
        })
        .catch((unexpectedError) => {
          // Este catch captura erros que escaparam do try/catch interno do processJob
          // (ex: failEmbeddingJob ou publishNotification falhando porque Redis está down)
          logger.error({
            jobId: job.id,
            type: job.type,
            error: unexpectedError instanceof Error ? unexpectedError.message : String(unexpectedError),
          }, 'Erro inesperado no processamento de job (failEmbeddingJob/publishNotification falhou)');
        })
        .finally(() => {
          currentConcurrent--;
        });
        
    } catch (error) {
      logger.error({ error }, 'Erro no loop do embedding worker');
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

// ============================================================================
// INTERFACE PÚBLICA
// ============================================================================

export interface EmbeddingWorkerConfig {
  /** Métricas Prometheus (OBRIGATÓRIO - Regra 16) */
  metrics: AliceMetrics;
  /** Intervalo de polling em ms (default: 1000) */
  pollIntervalMs?: number;
  /** Máximo de jobs em paralelo (default: 3) */
  maxConcurrent?: number;
}

export interface EmbeddingWorkerStatus {
  running: boolean;
  processedCount: number;
  currentConcurrent: number;
  queueSize: number;
  gpuWarm: boolean;
  gpuManager: string;
}

/**
 * Inicia o worker de embeddings
 */
export function startEmbeddingWorker(config: EmbeddingWorkerConfig): void {
  if (isRunning) {
    logger.warn('Embedding worker já está rodando');
    return;
  }
  
  // GPU Manager Service é usado via requestGpu, não precisa validar URL aqui
  
  // Criar circuit breakers
  gpuTextBreaker = createCircuitBreaker(callGpuTextApi, {
    name: 'embedding-worker-text',
    ...CIRCUIT_BREAKER_PRESETS.embeddingsGPU,
  });
  
  gpuBatchBreaker = createCircuitBreaker(callGpuBatchApi, {
    name: 'embedding-worker-batch',
    ...CIRCUIT_BREAKER_PRESETS.embeddingsGPU,
    timeout: GPU_TIMEOUT_MS * 2, // Batch leva mais tempo
  });
  
  // Instrumentar com Prometheus
  instrumentCircuitBreaker(config.metrics, 'embedding-worker-text', gpuTextBreaker as unknown);
  instrumentCircuitBreaker(config.metrics, 'embedding-worker-batch', gpuBatchBreaker as unknown);
  
  isRunning = true;
  
  logger.info({
    gpuManager: 'enabled',
    gpuDedicated: true, // GPU Hetzner GEX44 dedicada - sempre disponível
    pollIntervalMs: POLL_INTERVAL_MS,
    maxConcurrent: MAX_CONCURRENT,
  }, 'Embedding worker iniciado - GPU dedicada Hetzner GEX44 (24/7)');
  
  // Iniciar loop em background
  workerLoop().catch(error => {
    logger.error({ error }, 'Worker loop encerrado com erro');
    isRunning = false;
  });
}

/**
 * Para o worker de embeddings
 */
export function stopEmbeddingWorker(): void {
  if (!isRunning) {
    logger.warn('Embedding worker não está rodando');
    return;
  }
  
  isRunning = false;
  logger.info({ processedCount }, 'Embedding worker parado');
}

/**
 * Retorna status do worker
 */
export async function getEmbeddingWorkerStatus(): Promise<EmbeddingWorkerStatus> {
  return {
    running: isRunning,
    processedCount,
    currentConcurrent,
    queueSize: await getQueueSize(),
    gpuWarm: isGpuWarm(),
    gpuManager: 'enabled',
  };
}

/**
 * Verifica se o worker está rodando
 */
export function isEmbeddingWorkerRunning(): boolean {
  return isRunning;
}
