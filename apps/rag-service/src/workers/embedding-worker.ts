/**
 * Embedding Worker - Alice Enterprise Platform
 * 
 * Worker para processamento assíncrono de embeddings via fila Redis.
 * Implementa estratégia "Warm on Demand" com GPUs Salad Cloud.
 * 
 * Estratégia de processamento:
 * - Poll contínuo da fila Redis
 * - Batching inteligente para amortizar latência
 * - Keep-warm de 30 minutos após último processamento
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
import { createCircuitBreaker, CIRCUIT_BREAKER_PRESETS, instrumentCircuitBreaker } from '@alice/shared-utils';
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

/** URL do serviço de embeddings GPU (Salad Cloud) */
const EMBEDDINGS_GPU_URL = process.env.EMBEDDINGS_GPU_URL || '';

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
  endpoint: '/embed/text' | '/embed/text-for-image';
}

interface GpuImageParams {
  image: string;
}

interface GpuBatchParams {
  texts?: string[];
  images?: string[];
}

interface GpuResponse {
  embedding?: number[];
  embeddings?: number[][];
  model: string;
  dimension: number;
  processing_time_ms?: number;
}

async function callGpuTextApi(params: GpuTextParams): Promise<GpuResponse> {
  if (!EMBEDDINGS_GPU_URL) {
    throw new Error('EMBEDDINGS_GPU_URL não configurado');
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GPU_TIMEOUT_MS);
  
  try {
    const response = await fetch(`${EMBEDDINGS_GPU_URL}${params.endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: params.text }),
      signal: controller.signal,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GPU API error: ${response.status} - ${errorText}`);
    }
    
    return await response.json() as GpuResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callGpuImageApi(params: GpuImageParams): Promise<GpuResponse> {
  if (!EMBEDDINGS_GPU_URL) {
    throw new Error('EMBEDDINGS_GPU_URL não configurado');
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GPU_TIMEOUT_MS);
  
  try {
    const response = await fetch(`${EMBEDDINGS_GPU_URL}/embed/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: params.image }),
      signal: controller.signal,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GPU API error: ${response.status} - ${errorText}`);
    }
    
    return await response.json() as GpuResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callGpuBatchApi(params: GpuBatchParams): Promise<GpuResponse> {
  if (!EMBEDDINGS_GPU_URL) {
    throw new Error('EMBEDDINGS_GPU_URL não configurado');
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GPU_TIMEOUT_MS * 2); // Batch leva mais tempo
  
  try {
    const response = await fetch(`${EMBEDDINGS_GPU_URL}/embed/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GPU Batch API error: ${response.status} - ${errorText}`);
    }
    
    return await response.json() as GpuResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Circuit breakers serão criados no start do worker
let gpuTextBreaker: ReturnType<typeof createCircuitBreaker<GpuTextParams, GpuResponse>> | null = null;
let gpuImageBreaker: ReturnType<typeof createCircuitBreaker<GpuImageParams, GpuResponse>> | null = null;
let gpuBatchBreaker: ReturnType<typeof createCircuitBreaker<GpuBatchParams, GpuResponse>> | null = null;

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
  const endpoint = job.type === 'text-for-image' ? '/embed/text-for-image' : '/embed/text';
  
  const result = await gpuTextBreaker.fire({ text: job.input.text, endpoint }) as GpuResponse;
  
  if (!result.embedding) {
    throw new Error('Embedding não retornado pela GPU');
  }
  
  // Validar dimensão
  const expectedDim = job.type === 'text-for-image' ? EMBEDDING_DIMENSIONS.CLIP : EMBEDDING_DIMENSIONS.TEXT;
  validateEmbeddingDimension(result.embedding, expectedDim, job.type === 'text-for-image' ? 'CLIP' : 'TEXT');
  
  const processingTimeMs = Date.now() - startTime;
  
  await completeEmbeddingJob(job.id, {
    embedding: result.embedding,
    model: result.model,
    dimension: result.dimension,
    processingTimeMs,
  });
  
  // Publicar notificação
  await publishNotification({
    type: 'job_completed',
    jobId: job.id,
    tenantId: job.tenantId,
    data: {
      type: job.type,
      dimension: result.dimension,
      processingTimeMs,
    },
    timestamp: new Date().toISOString(),
  });
}

async function processImageJob(job: EmbeddingJob): Promise<void> {
  if (!job.input.imageBase64) {
    throw new Error('Imagem não fornecida para job de embedding');
  }
  
  if (!gpuImageBreaker) {
    throw new Error('Worker não inicializado');
  }
  
  const startTime = Date.now();
  
  const result = await gpuImageBreaker.fire({ image: job.input.imageBase64 }) as GpuResponse;
  
  if (!result.embedding) {
    throw new Error('Embedding não retornado pela GPU');
  }
  
  // Validar dimensão
  validateEmbeddingDimension(result.embedding, EMBEDDING_DIMENSIONS.CLIP, 'CLIP');
  
  const processingTimeMs = Date.now() - startTime;
  
  await completeEmbeddingJob(job.id, {
    embedding: result.embedding,
    model: result.model,
    dimension: result.dimension,
    processingTimeMs,
  });
  
  // Publicar notificação
  await publishNotification({
    type: 'job_completed',
    jobId: job.id,
    tenantId: job.tenantId,
    data: {
      type: job.type,
      dimension: result.dimension,
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
  
  await completeEmbeddingJob(job.id, {
    embeddings: result.embeddings,
    model: result.model,
    dimension: result.dimension,
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
      dimension: result.dimension,
      processingTimeMs,
    },
    timestamp: new Date().toISOString(),
  });
}

async function processBatchImageJob(job: EmbeddingJob): Promise<void> {
  if (!job.input.imagesBase64 || job.input.imagesBase64.length === 0) {
    throw new Error('Imagens não fornecidas para batch');
  }
  
  if (!gpuBatchBreaker) {
    throw new Error('Worker não inicializado');
  }
  
  const startTime = Date.now();
  
  const result = await gpuBatchBreaker.fire({ images: job.input.imagesBase64 }) as GpuResponse;
  
  if (!result.embeddings || result.embeddings.length === 0) {
    throw new Error('Embeddings não retornados pela GPU');
  }
  
  const processingTimeMs = Date.now() - startTime;
  
  await completeEmbeddingJob(job.id, {
    embeddings: result.embeddings,
    model: result.model,
    dimension: result.dimension,
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
      dimension: result.dimension,
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
      case 'text-for-image':
        await processTextJob(job);
        break;
      case 'image':
        await processImageJob(job);
        break;
      case 'batch-text':
        await processBatchTextJob(job);
        break;
      case 'batch-image':
        await processBatchImageJob(job);
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
      currentConcurrent++;
      processJob(job)
        .then(() => {
          processedCount++;
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
  gpuUrl: string;
}

/**
 * Inicia o worker de embeddings
 */
export function startEmbeddingWorker(config: EmbeddingWorkerConfig): void {
  if (isRunning) {
    logger.warn('Embedding worker já está rodando');
    return;
  }
  
  if (!EMBEDDINGS_GPU_URL) {
    logger.error('EMBEDDINGS_GPU_URL não configurado - embedding worker não iniciará');
    return;
  }
  
  // Criar circuit breakers
  gpuTextBreaker = createCircuitBreaker(callGpuTextApi, {
    name: 'embedding-worker-text',
    ...CIRCUIT_BREAKER_PRESETS.clipEmbeddings,
  });
  
  gpuImageBreaker = createCircuitBreaker(callGpuImageApi, {
    name: 'embedding-worker-image',
    ...CIRCUIT_BREAKER_PRESETS.clipEmbeddings,
  });
  
  gpuBatchBreaker = createCircuitBreaker(callGpuBatchApi, {
    name: 'embedding-worker-batch',
    ...CIRCUIT_BREAKER_PRESETS.clipEmbeddings,
    timeout: GPU_TIMEOUT_MS * 2, // Batch leva mais tempo
  });
  
  // Instrumentar com Prometheus
  instrumentCircuitBreaker(config.metrics, 'embedding-worker-text', gpuTextBreaker as unknown);
  instrumentCircuitBreaker(config.metrics, 'embedding-worker-image', gpuImageBreaker as unknown);
  instrumentCircuitBreaker(config.metrics, 'embedding-worker-batch', gpuBatchBreaker as unknown);
  
  isRunning = true;
  
  logger.info({
    gpuUrl: EMBEDDINGS_GPU_URL,
    pollIntervalMs: POLL_INTERVAL_MS,
    maxConcurrent: MAX_CONCURRENT,
  }, 'Embedding worker iniciado - Estratégia Warm on Demand (30 min keep-warm)');
  
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
    gpuUrl: EMBEDDINGS_GPU_URL,
  };
}

/**
 * Verifica se o worker está rodando
 */
export function isEmbeddingWorkerRunning(): boolean {
  return isRunning;
}
