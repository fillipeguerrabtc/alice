/**
 * Trading LoRA Job Manager - Alice Enterprise Platform
 * 
 * Gerencia ciclo de vida de jobs de treinamento LoRA para trading.
 * Execução real via GPU Manager Service + gpu-trainer (GPU única 20GB, prioridade baixa).
 * 
 * Funcionalidades:
 * - Criação e gerenciamento de jobs
 * - Preparação de datasets para treinamento
 * - Monitoramento de progresso
 * - Integração com GPU Manager Service (Hetzner GEX44)
 * 
 * Autor: Fillipe Guerra
 * Data: 25 de Dezembro de 2025
 */

import { createLogger } from '@alice/logger';
import { getDatabase, schema, eq, and, desc, sql, inArray } from '@alice/database';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requestGpu, GpuServiceType, GpuRequestPriority, GPU_MANAGER_CONFIG } from '@alice/shared-utils';
import type {
  TradingLoraJob,
  InsertTradingLoraJob,
  TradingDataset,
  TradingLoraHyperparams,
  TradingLoraMetrics,
} from '@alice/shared';

const logger = createLogger('lora-job-manager');

const TRAINING_STORAGE_DIR = process.env.TRAINING_STORAGE_DIR || '/opt/alice/uploads/training';

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

// Modelo base padrão para LoRA (Gate 2): deve bater com o LLM de runtime
const DEFAULT_BASE_MODEL = GPU_MANAGER_CONFIG.models.llm;

// Configuração padrão de hiperparâmetros
const DEFAULT_HYPERPARAMS: TradingLoraHyperparams = {
  loraRank: 16,
  loraAlpha: 32,
  learningRate: 2e-4,
  batchSize: 4,
  epochs: 3,
  warmupSteps: 100,
  targetModules: ['q_proj', 'v_proj', 'k_proj', 'o_proj'],
};

// Mínimo de exemplos para treinar
const MIN_DATASET_SIZE = 100;

// ============================================================================
// UTILITÁRIOS
// ============================================================================

/**
 * Fisher-Yates (Knuth) Shuffle - Algoritmo de embaralhamento uniforme
 * 
 * Produz distribuição verdadeiramente uniforme, ao contrário de:
 * - array.sort(() => Math.random() - 0.5) que é enviesado
 * 
 * Complexidade: O(n) tempo, O(1) espaço adicional (in-place)
 * 
 * IMPORTANTE para ML: Garante que train/validation splits sejam não-enviesados,
 * resultando em métricas de validação confiáveis.
 * 
 * Referência: https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
 * 
 * @param array - Array a ser embaralhado (modificado in-place)
 * @returns O mesmo array, embaralhado
 */
function fisherYatesShuffle<T>(array: T[]): T[] {
  // Iterar de trás para frente
  for (let i = array.length - 1; i > 0; i--) {
    // Gerar índice aleatório entre 0 e i (inclusive)
    const j = Math.floor(Math.random() * (i + 1));
    // Trocar elementos nas posições i e j
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ============================================================================
// TIPOS
// ============================================================================

interface CreateJobParams {
  tenantId: string;
  name: string;
  description?: string;
  baseModel?: string;
  hyperparameters?: Partial<TradingLoraHyperparams>;
  datasetFilter?: {
    minQualityScore?: number;
    actionTypes?: string[];
    fromDate?: Date;
    toDate?: Date;
  };
}

interface JobProgress {
  status: string;
  progress: number;
  currentStep: number;
  totalSteps: number | null;
  metrics: TradingLoraMetrics;
}

interface PreparedDataset {
  trainingData: string[];    // Linhas JSONL ({text: string})
  validationData: string[];  // Linhas JSONL ({text: string})
  datasetIds: string[];      // IDs dos datasets filtrados (para marcar como usados)
  stats: {
    total: number;
    training: number;
    validation: number;
    byActionType: Record<string, number>;
  };
}

// ============================================================================
// PREPARAÇÃO DE DATASET
// ============================================================================

/**
 * Prepara dataset para treinamento LoRA
 * Converte registros do banco para formato JSONL
 */
export async function prepareDataset(
  tenantId: string,
  filter?: {
    minQualityScore?: number;
    actionTypes?: string[];
    fromDate?: Date;
    toDate?: Date;
  }
): Promise<PreparedDataset> {
  const db = getDatabase();

  logger.info({ tenantId, filter }, 'Preparando dataset para treinamento');

  // Buscar datasets aprovados
  // CORREÇÃO 19/12/2025: Usar const ao invés de let (prefer-const)
  const datasets = await db
    .select()
    .from(schema.tradingDataset)
    .where(
      and(
        eq(schema.tradingDataset.tenantId, tenantId),
        eq(schema.tradingDataset.status, 'approved'),
        eq(schema.tradingDataset.isDuplicate, false)
      )
    )
    .orderBy(desc(schema.tradingDataset.criadoEm));

  // Aplicar filtros
  let filtered = datasets;

  if (filter?.minQualityScore) {
    filtered = filtered.filter(
      d => d.qualityScore !== null && d.qualityScore >= filter.minQualityScore!
    );
  }

  if (filter?.actionTypes && filter.actionTypes.length > 0) {
    filtered = filtered.filter(d => filter.actionTypes!.includes(d.actionType));
  }

  if (filter?.fromDate) {
    filtered = filtered.filter(
      d => d.criadoEm && d.criadoEm >= filter.fromDate!
    );
  }

  if (filter?.toDate) {
    filtered = filtered.filter(
      d => d.criadoEm && d.criadoEm <= filter.toDate!
    );
  }

  // Estatísticas por tipo de ação
  const byActionType: Record<string, number> = {};
  for (const d of filtered) {
    byActionType[d.actionType] = (byActionType[d.actionType] || 0) + 1;
  }

  // Dividir em treinamento (90%) e validação (10%)
  // ENTERPRISE FIX: Usar Fisher-Yates shuffle para distribuição uniforme
  // O sort(() => Math.random() - 0.5) é anti-pattern que produz distribuição enviesada
  // Referência: https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
  const shuffled = fisherYatesShuffle([...filtered]);
  const splitIndex = Math.floor(shuffled.length * 0.9);
  const training = shuffled.slice(0, splitIndex);
  const validation = shuffled.slice(splitIndex);

  // Converter para formato JSONL (SFT): campo `text` obrigatório (gpu-trainer valida)
  const formatToJsonl = (dataset: TradingDataset): string => {
    const text = [
      'system: Você é Alice, uma assistente especializada em trading de BTC Futures. Analise o contexto de mercado e forneça sinais de trading baseados em análise técnica e dados em tempo real.',
      `user: ${dataset.prompt}`,
      `assistant: ${dataset.response}`,
    ].join('\n');
    return JSON.stringify({ text });
  };

  const trainingData = training.map(formatToJsonl);
  const validationData = validation.map(formatToJsonl);

  // Extrair IDs dos datasets filtrados (para marcar como usados posteriormente)
  const datasetIds = filtered.map(d => d.id);

  logger.info(
    {
      total: filtered.length,
      training: trainingData.length,
      validation: validationData.length,
      byActionType,
      datasetIdsCount: datasetIds.length,
    },
    'Dataset preparado com sucesso'
  );

  return {
    trainingData,
    validationData,
    datasetIds,
    stats: {
      total: filtered.length,
      training: trainingData.length,
      validation: validationData.length,
      byActionType,
    },
  };
}

// ============================================================================
// GERENCIAMENTO DE JOBS
// ============================================================================

/**
 * Cria um novo job de treinamento LoRA
 */
export async function createLoraJob(params: CreateJobParams): Promise<TradingLoraJob> {
  const db = getDatabase();

  // Preparar dataset para obter contagens
  const dataset = await prepareDataset(params.tenantId, params.datasetFilter);

  if (dataset.stats.total < MIN_DATASET_SIZE) {
    throw new Error(
      `Dataset insuficiente: ${dataset.stats.total} exemplos. Mínimo necessário: ${MIN_DATASET_SIZE}`
    );
  }

  // Mesclar hiperparâmetros com defaults
  const hyperparameters: TradingLoraHyperparams = {
    ...DEFAULT_HYPERPARAMS,
    ...params.hyperparameters,
  };

  // Criar job
  const jobData: InsertTradingLoraJob = {
    tenantId: params.tenantId,
    name: params.name,
    description: params.description,
    baseModel: params.baseModel || DEFAULT_BASE_MODEL,
    hyperparameters,
    status: 'queued',
    progress: 0,
    currentStep: 0,
    datasetCount: dataset.stats.training,
    validationCount: dataset.stats.validation,
    metrics: {},
  };

  const [job] = await db
    .insert(schema.tradingLoraJobs)
    .values(jobData)
    .returning();

  // Bug fix: Usar os IDs dos datasets FILTRADOS (retornados por prepareDataset)
  // Antes marcava TODOS os datasets aprovados, ignorando os filtros aplicados
  if (dataset.datasetIds.length > 0) {
    await db
      .update(schema.tradingDataset)
      .set({
        status: 'used',
        usedInJobId: job.id,
        atualizadoEm: new Date(),
      })
      .where(
        inArray(
          schema.tradingDataset.id,
          dataset.datasetIds
        )
      );
    
    logger.info(
      { jobId: job.id, markedAsUsed: dataset.datasetIds.length },
      'Datasets marcados como usados'
    );
  }

  logger.info(
    {
      jobId: job.id,
      name: params.name,
      datasetCount: dataset.stats.training,
      validationCount: dataset.stats.validation,
    },
    'Job de treinamento LoRA criado'
  );

  return job;
}

/**
 * Obtém detalhes de um job
 */
export async function getJob(jobId: string): Promise<TradingLoraJob | null> {
  const db = getDatabase();

  const [job] = await db
    .select()
    .from(schema.tradingLoraJobs)
    .where(eq(schema.tradingLoraJobs.id, jobId))
    .limit(1);

  return job ?? null;
}

/**
 * Lista jobs de um tenant
 */
export async function listJobs(
  tenantId: string,
  options?: { status?: string; limit?: number }
): Promise<TradingLoraJob[]> {
  const db = getDatabase();

  // CORREÇÃO 18/12/2025: Drizzle não permite encadear .where() múltiplas vezes
  // Construir condição completa de uma vez
  // CORREÇÃO 19/12/2025: Remover query não utilizado (no-unused-vars)
  const conditions = options?.status
    ? and(
        eq(schema.tradingLoraJobs.tenantId, tenantId),
        eq(schema.tradingLoraJobs.status, options.status as 'queued' | 'preparing' | 'training' | 'validating' | 'completed' | 'failed' | 'cancelled')
      )
    : eq(schema.tradingLoraJobs.tenantId, tenantId);

  const jobs = await db
    .select()
    .from(schema.tradingLoraJobs)
    .where(conditions)
    .orderBy(desc(schema.tradingLoraJobs.criadoEm))
    .limit(options?.limit ?? 50);

  return jobs;
}

/**
 * Atualiza progresso de um job
 */
export async function updateJobProgress(
  jobId: string,
  progress: Partial<JobProgress>
): Promise<TradingLoraJob | null> {
  const db = getDatabase();

  const updateData: Record<string, unknown> = {};

  if (progress.status) {
    updateData.status = progress.status;
    
    // Atualizar timestamps baseado no status
    if (progress.status === 'training') {
      updateData.startedAt = new Date();
    } else if (progress.status === 'completed' || progress.status === 'failed') {
      updateData.completedAt = new Date();
    }
  }

  if (progress.progress !== undefined) updateData.progress = progress.progress;
  if (progress.currentStep !== undefined) updateData.currentStep = progress.currentStep;
  if (progress.totalSteps !== undefined) updateData.totalSteps = progress.totalSteps;
  if (progress.metrics) updateData.metrics = progress.metrics;

  const [updated] = await db
    .update(schema.tradingLoraJobs)
    .set(updateData)
    .where(eq(schema.tradingLoraJobs.id, jobId))
    .returning();

  if (updated) {
    logger.info({ jobId, progress }, 'Progresso do job atualizado');
  }

  return updated ?? null;
}

/**
 * Cancela um job
 * 
 * Regra 6 CLAUDE.md: Integração real enterprise com Hetzner GPU GEX44
 * Em migração - funcionalidade temporariamente desabilitada
 */
export async function cancelJob(jobId: string): Promise<TradingLoraJob | null> {
  const db = getDatabase();

  const [job] = await db
    .select()
    .from(schema.tradingLoraJobs)
    .where(eq(schema.tradingLoraJobs.id, jobId))
    .limit(1);

  if (!job) {
    return null;
  }

  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    throw new Error(`Job já está ${job.status}, não pode ser cancelado`);
  }

  // Cancelamento REAL no trainer (flag persistida em disco) - Regra 6
  await requestGpu({
    serviceType: GpuServiceType.TRAINING,
    endpoint: '/train/lora/cancel',
    method: 'POST',
    priority: GpuRequestPriority.LOW,
    timeout: 15000,
    body: { jobId },
  });

  const [updated] = await db
    .update(schema.tradingLoraJobs)
    .set({
      status: 'cancelled',
      completedAt: new Date(),
    })
    .where(eq(schema.tradingLoraJobs.id, jobId))
    .returning();

  logger.info({ jobId }, 'Job cancelado');

  return updated ?? null;
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJsonlFile(filePath: string, jsonlLines: string[]): Promise<void> {
  const content = jsonlLines.join('\n') + '\n';
  await fs.writeFile(filePath, content, { encoding: 'utf-8' });
}

async function getDirectorySizeBytes(dirPath: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dirPath, e.name);
    if (e.isDirectory()) {
      total += await getDirectorySizeBytes(full);
    } else if (e.isFile()) {
      const st = await fs.stat(full);
      total += st.size;
    }
  }
  return total;
}

function computeTargetSteps(trainCount: number, hyper: TradingLoraHyperparams): number {
  const stepsPerEpoch = Math.max(1, Math.ceil(trainCount / Math.max(1, hyper.batchSize)));
  return Math.max(1, hyper.epochs * stepsPerEpoch);
}

/**
 * Executa um job LoRA (trading) de forma preemptível (slices curtas) via gpu-trainer.
 * Status e progresso são persistidos no PostgreSQL.
 */
export async function processTradingLoraJob(jobId: string): Promise<void> {
  const db = getDatabase();
  const job = await getJob(jobId);
  if (!job) throw new Error('Job LoRA não encontrado');
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return;

  await updateJobProgress(jobId, { status: 'preparing', progress: 0, currentStep: 0, totalSteps: job.totalSteps ?? null, metrics: job.metrics as TradingLoraMetrics });

  const tenantId = job.tenantId ?? 'default-tenant';
  const prepared = await prepareDataset(tenantId, undefined);
  const jobDir = path.join(TRAINING_STORAGE_DIR, 'trading-lora', tenantId, jobId);
  await ensureDir(jobDir);

  const trainPath = path.join(jobDir, 'train.jsonl');
  const evalPath = path.join(jobDir, 'eval.jsonl');
  const outputDir = path.join(jobDir, 'output');
  await ensureDir(outputDir);

  await writeJsonlFile(trainPath, prepared.trainingData);
  await writeJsonlFile(evalPath, prepared.validationData);

  const targetSteps = computeTargetSteps(prepared.stats.training, job.hyperparameters as TradingLoraHyperparams);
  await updateJobProgress(jobId, { status: 'training', progress: 0, currentStep: 0, totalSteps: targetSteps, metrics: job.metrics as TradingLoraMetrics });

  const sliceSteps = 5;
  let stepsCompleted = 0;

  while (stepsCompleted < targetSteps) {
    const fresh = await getJob(jobId);
    if (!fresh) throw new Error('Job LoRA desapareceu');
    if (fresh.status === 'cancelled') return;

    const gpu = await requestGpu({
      serviceType: GpuServiceType.TRAINING,
      endpoint: '/train/lora/slice',
      method: 'POST',
      priority: GpuRequestPriority.LOW,
      timeout: 25000,
      body: {
        jobId,
        baseModel: fresh.baseModel,
        trainJsonlPath: trainPath,
        evalJsonlPath: evalPath,
        outputDir,
        stepsThisSlice: Math.min(sliceSteps, targetSteps - stepsCompleted),
        hyperparameters: {
          epochs: (fresh.hyperparameters as TradingLoraHyperparams).epochs,
          learningRate: (fresh.hyperparameters as TradingLoraHyperparams).learningRate,
          batchSize: (fresh.hyperparameters as TradingLoraHyperparams).batchSize,
        },
      },
    });

    const data = gpu.data as { stepsCompleted?: number; adapterPath?: string } | undefined;
    stepsCompleted = data?.stepsCompleted ?? (stepsCompleted + sliceSteps);
    const pct = Math.min(99, Math.floor((stepsCompleted / targetSteps) * 100));
    await updateJobProgress(jobId, { status: stepsCompleted >= targetSteps ? 'validating' : 'training', progress: pct, currentStep: stepsCompleted, totalSteps: targetSteps, metrics: fresh.metrics as TradingLoraMetrics });

    if (data?.adapterPath) {
      await db.update(schema.tradingLoraJobs)
        .set({ resultAdapterPath: data.adapterPath })
        .where(eq(schema.tradingLoraJobs.id, jobId));
    }
  }

  const final = await getJob(jobId);
  const adapterPath = final?.resultAdapterPath;
  if (!adapterPath) throw new Error('AdapterPath não definido no job LoRA');
  const adapterSize = await getDirectorySizeBytes(adapterPath);

  await setJobResult(jobId, { adapterPath, adapterSize, metrics: (final?.metrics as TradingLoraMetrics) || {} });
}

/**
 * Define resultado do job (após treinamento)
 */
export async function setJobResult(
  jobId: string,
  result: {
    adapterPath: string;
    adapterSize: number;
    metrics: TradingLoraMetrics;
  }
): Promise<TradingLoraJob | null> {
  const db = getDatabase();

  const [updated] = await db
    .update(schema.tradingLoraJobs)
    .set({
      status: 'completed',
      progress: 100,
      resultAdapterPath: result.adapterPath,
      resultAdapterSize: result.adapterSize,
      metrics: result.metrics,
      completedAt: new Date(),
    })
    .where(eq(schema.tradingLoraJobs.id, jobId))
    .returning();

  if (updated) {
    logger.info(
      {
        jobId,
        adapterPath: result.adapterPath,
        adapterSize: result.adapterSize,
        metrics: result.metrics,
      },
      'Job concluído com sucesso'
    );
  }

  return updated ?? null;
}

/**
 * Define erro no job
 */
export async function setJobError(
  jobId: string,
  error: {
    message: string;
    details?: Record<string, unknown>;
  }
): Promise<TradingLoraJob | null> {
  const db = getDatabase();

  const [updated] = await db
    .update(schema.tradingLoraJobs)
    .set({
      status: 'failed',
      errorMessage: error.message,
      errorDetails: error.details ?? null,
      completedAt: new Date(),
    })
    .where(eq(schema.tradingLoraJobs.id, jobId))
    .returning();

  if (updated) {
    logger.error({ jobId, error: error.message }, 'Job falhou');
  }

  return updated ?? null;
}

// ============================================================================
// ESTATÍSTICAS
// ============================================================================

/**
 * Obtém estatísticas de jobs
 */
export async function getJobStats(tenantId: string): Promise<{
  total: number;
  byStatus: Record<string, number>;
  avgTrainingTime: number | null;
  totalDatasetsUsed: number;
}> {
  const db = getDatabase();

  // Total de jobs
  const [totalResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.tradingLoraJobs)
    .where(eq(schema.tradingLoraJobs.tenantId, tenantId));

  // Por status
  const statusResults = await db
    .select({
      status: schema.tradingLoraJobs.status,
      count: sql<number>`count(*)`,
    })
    .from(schema.tradingLoraJobs)
    .where(eq(schema.tradingLoraJobs.tenantId, tenantId))
    .groupBy(schema.tradingLoraJobs.status);

  const byStatus: Record<string, number> = {};
  for (const row of statusResults) {
    // CORREÇÃO 18/12/2025: status pode ser null (ignorar nesse caso)
    if (row.status) {
      byStatus[row.status] = Number(row.count);
    }
  }

  // Tempo médio de treinamento
  const [avgResult] = await db
    .select({
      avgMinutes: sql<number>`AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60)`,
    })
    .from(schema.tradingLoraJobs)
    .where(
      and(
        eq(schema.tradingLoraJobs.tenantId, tenantId),
        eq(schema.tradingLoraJobs.status, 'completed')
      )
    );

  // Total de datasets usados
  const [datasetsResult] = await db
    .select({ sum: sql<number>`SUM(dataset_count)` })
    .from(schema.tradingLoraJobs)
    .where(eq(schema.tradingLoraJobs.tenantId, tenantId));

  return {
    total: Number(totalResult?.count ?? 0),
    byStatus,
    avgTrainingTime: avgResult?.avgMinutes ?? null,
    totalDatasetsUsed: Number(datasetsResult?.sum ?? 0),
  };
}

export default {
  // Dataset
  prepareDataset,
  
  // Jobs
  createLoraJob,
  getJob,
  listJobs,
  updateJobProgress,
  cancelJob,
  setJobResult,
  setJobError,
  
  // Stats
  getJobStats,
};
