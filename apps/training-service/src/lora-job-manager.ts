/**
 * Trading LoRA Job Manager - Alice Enterprise Platform
 * 
 * Gerencia ciclo de vida de jobs de treinamento LoRA para trading.
 * Integra com Salad Cloud para execução de treinamento em GPU.
 * 
 * Funcionalidades:
 * - Criação e gerenciamento de jobs
 * - Preparação de datasets para treinamento
 * - Monitoramento de progresso
 * - Integração com Salad Cloud
 * 
 * Autor: Fillipe Guerra
 * Data: 17 de Dezembro de 2025
 */

import { createLogger } from '@alice/logger';
import { getDatabase, schema, eq, and, desc, sql, inArray } from '@alice/database';
import type {
  TradingLoraJob,
  InsertTradingLoraJob,
  TradingDataset,
  TradingLoraHyperparams,
  TradingLoraMetrics,
} from '@alice/shared';

const logger = createLogger('lora-job-manager');

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

// Modelo base padrão para LoRA
const DEFAULT_BASE_MODEL = 'TheBloke/Mixtral-8x7B-Instruct-v0.1-AWQ';

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
  trainingData: string[];    // JSONL para treinamento
  validationData: string[];  // JSONL para validação
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
  let query = db
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

  const datasets = await query;

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
  const shuffled = filtered.sort(() => Math.random() - 0.5);
  const splitIndex = Math.floor(shuffled.length * 0.9);
  const training = shuffled.slice(0, splitIndex);
  const validation = shuffled.slice(splitIndex);

  // Converter para formato JSONL (formato ChatML para Mixtral)
  const formatToJsonl = (dataset: TradingDataset): string => {
    const example = {
      messages: [
        {
          role: 'system',
          content: 'Você é Alice, uma assistente especializada em trading de BTC Futures. Analise o contexto de mercado e forneça sinais de trading baseados em análise técnica e dados em tempo real.',
        },
        {
          role: 'user',
          content: dataset.prompt,
        },
        {
          role: 'assistant',
          content: dataset.response,
        },
      ],
    };
    return JSON.stringify(example);
  };

  const trainingData = training.map(formatToJsonl);
  const validationData = validation.map(formatToJsonl);

  logger.info(
    {
      total: filtered.length,
      training: trainingData.length,
      validation: validationData.length,
      byActionType,
    },
    'Dataset preparado com sucesso'
  );

  return {
    trainingData,
    validationData,
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

  // Marcar datasets como usados
  const datasetIds = await db
    .select({ id: schema.tradingDataset.id })
    .from(schema.tradingDataset)
    .where(
      and(
        eq(schema.tradingDataset.tenantId, params.tenantId),
        eq(schema.tradingDataset.status, 'approved'),
        eq(schema.tradingDataset.isDuplicate, false)
      )
    );

  if (datasetIds.length > 0) {
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
          datasetIds.map(d => d.id)
        )
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

  let query = db
    .select()
    .from(schema.tradingLoraJobs)
    .where(eq(schema.tradingLoraJobs.tenantId, tenantId))
    .orderBy(desc(schema.tradingLoraJobs.criadoEm));

  if (options?.status) {
    query = query.where(
      and(
        eq(schema.tradingLoraJobs.tenantId, tenantId),
        eq(schema.tradingLoraJobs.status, options.status as 'queued' | 'preparing' | 'training' | 'validating' | 'completed' | 'failed' | 'cancelled')
      )
    ) as typeof query;
  }

  const jobs = await query.limit(options?.limit ?? 50);

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

  const [updated] = await db
    .update(schema.tradingLoraJobs)
    .set({
      status: 'cancelled',
      completedAt: new Date(),
    })
    .where(eq(schema.tradingLoraJobs.id, jobId))
    .returning();

  // TODO: Se estiver rodando na Salad Cloud, cancelar container group

  logger.info({ jobId }, 'Job cancelado');

  return updated ?? null;
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
    byStatus[row.status] = Number(row.count);
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
