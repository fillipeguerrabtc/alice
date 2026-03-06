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
import { getDatabase, schema, eq, and, desc, sql, isNull } from '@alice/database';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requestGpu, GpuServiceType, GpuRequestPriority, GPU_MANAGER_CONFIG } from '@alice/shared-utils';
import type {
  DatasetSplitPolicy,
  LoraJob,
  TrainingDatasetManifest,
  InsertLoraJob,
  TradingLoraHyperparams,
  TradingLoraMetrics,
} from '@alice/shared';
import { TradingLoraHyperparamsSchema, TrainingDatasetManifestSchema } from '@alice/shared';
import { loadTrainingEnterpriseConfig } from './training-config.js';
import {
  markDatasetRowsUsedForJob,
  persistCanonicalDatasetSnapshot,
  planCanonicalDatasetSelection,
  releaseDatasetRowsForJob,
  reserveDatasetRowsForJob,
  type DatasetSelectionScope,
} from './datasets/dataset-selection.js';

const logger = createLogger('lora-job-manager');

const TRAINING_STORAGE_DIR = process.env.TRAINING_STORAGE_DIR || '/opt/alice/uploads/training';

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

// Modelo base padrão para LoRA (Gate 2): deve bater com o LLM de runtime
const DEFAULT_BASE_MODEL = GPU_MANAGER_CONFIG.models.llm;

// Configuração padrão de hiperparâmetros
const TRADING_HYPERPARAMS_BASE_DEFAULTS: TradingLoraHyperparams = TradingLoraHyperparamsSchema.parse({});

function toTradingHyperparamsFromEnterprise(
  enterpriseHyperparams: Partial<TradingLoraHyperparams>
): TradingLoraHyperparams {
  return TradingLoraHyperparamsSchema.parse({
    ...TRADING_HYPERPARAMS_BASE_DEFAULTS,
    ...enterpriseHyperparams,
  });
}

// ============================================================================
// TIPOS
// ============================================================================
interface CreateJobParams {
  tenantId: string;
  namespaceId: string;
  agentId?: string;
  profileVersion?: number;
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
  /** Se true, ignora mínimo de exemplos (permite 1). Aviso explícito no frontend. */
  forceMinSize?: boolean;
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
  holdoutData: string[];
  trainingRowIds: string[];  // IDs usados no split de treino
  validationRowIds: string[]; // IDs usados no split de validação
  holdoutRowIds: string[]; // IDs usados no split de holdout
  datasetIds: string[];      // IDs de training_data congelados no manifest
  splitPolicy: DatasetSplitPolicy;
  stats: {
    total: number;
    training: number;
    validation: number;
    holdout: number;
    byActionType: Record<string, number>;
    /** Número de imagens aprovadas incluídas (quando includeImages=true). */
    imagesUsed?: number;
    dataWindow?: { from: Date | null; to: Date | null };
  };
}

type DatasetProfileConfig = {
  id: string | null;
  version: number;
  systemPromptTemplate: string;
  allowedActions?: string[];
};

async function resolveDatasetProfile(
  tenantId: string,
  namespaceId: string,
  agentId?: string,
): Promise<DatasetProfileConfig> {
  const db = getDatabase();
  const profile = agentId
    ? await db.query.trainingDatasetProfiles.findFirst({
        where: and(
          eq(schema.trainingDatasetProfiles.tenantId, tenantId),
          eq(schema.trainingDatasetProfiles.namespaceId, namespaceId),
          eq(schema.trainingDatasetProfiles.agentId, agentId),
          eq(schema.trainingDatasetProfiles.isActive, true),
        ),
        orderBy: [desc(schema.trainingDatasetProfiles.version)],
      })
    : null;

  const fallbackNamespaceProfile = profile ?? await db.query.trainingDatasetProfiles.findFirst({
    where: and(
      eq(schema.trainingDatasetProfiles.tenantId, tenantId),
      eq(schema.trainingDatasetProfiles.namespaceId, namespaceId),
      eq(schema.trainingDatasetProfiles.isActive, true),
      isNull(schema.trainingDatasetProfiles.agentId),
    ),
    orderBy: [desc(schema.trainingDatasetProfiles.version)],
  });

  const globalTenantProfile = fallbackNamespaceProfile ?? await db.query.trainingDatasetProfiles.findFirst({
    where: and(
      eq(schema.trainingDatasetProfiles.tenantId, tenantId),
      eq(schema.trainingDatasetProfiles.isActive, true),
      isNull(schema.trainingDatasetProfiles.agentId),
    ),
    orderBy: [desc(schema.trainingDatasetProfiles.version)],
  });

  const rawTemplate = ((globalTenantProfile?.samplingPolicy ?? {}) as Record<string, unknown>).systemPromptTemplate;
  const template = typeof rawTemplate === 'string' && rawTemplate.trim().length > 0
    ? rawTemplate
    : 'Você é Alice, assistente financeira institucional para {{assetClass}} em {{marketType}} na venue {{venue}}. Siga a política de risco {{riskPolicy}} e priorize os timeframes {{timeframes}}.';
  const allowedActionsRaw = ((globalTenantProfile?.samplingPolicy ?? {}) as Record<string, unknown>).allowedActions;
  const allowedActions = Array.isArray(allowedActionsRaw)
    ? allowedActionsRaw.filter((item): item is string => typeof item === 'string')
    : undefined;

  return {
    id: globalTenantProfile?.id ?? null,
    version: globalTenantProfile?.version ?? 1,
    systemPromptTemplate: template,
    allowedActions,
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
  namespaceId: string,
  agentId?: string,
  _filter?: {
    minQualityScore?: number;
    actionTypes?: string[];
    fromDate?: Date;
    toDate?: Date;
  },
  runtime?: {
    datasetMaxRows?: number;
    trainEvalSplitRatio?: number;
    seed?: string;
    splitPolicy?: DatasetSplitPolicy;
    minDatasetSize?: number;
  }
): Promise<PreparedDataset> {
  const trainingConfig = await loadTrainingEnterpriseConfig();
  const datasetMaxRows = runtime?.datasetMaxRows ?? trainingConfig.datasetMaxRows;
  const trainEvalSplitRatio = runtime?.trainEvalSplitRatio ?? trainingConfig.trainEvalSplitRatio;
  const scope: DatasetSelectionScope = {
    tenantId,
    namespaceId,
    agentId: agentId ?? null,
    domain: null,
  };
  const plan = await planCanonicalDatasetSelection({
    scope,
    options: {
      includeTradingDataset: true,
      datasetMaxRows,
      trainEvalSplitRatio,
      minDatasetSize: runtime?.minDatasetSize ?? 1,
      seed: runtime?.seed ?? `${tenantId}:${namespaceId}:${agentId ?? 'all'}`,
      splitPolicy: runtime?.splitPolicy ?? 'trading_temporal',
      profileVersion: 1,
      profileId: null,
    },
  });

  return {
    trainingData: plan.trainRows.map((row) => row.text),
    validationData: plan.validationRows.map((row) => row.text),
    holdoutData: plan.holdoutRows.map((row) => row.text),
    trainingRowIds: plan.trainRows.map((row) => row.id),
    validationRowIds: plan.validationRows.map((row) => row.id),
    holdoutRowIds: plan.holdoutRows.map((row) => row.id),
    datasetIds: [
      ...plan.trainRows.map((row) => row.id),
      ...plan.validationRows.map((row) => row.id),
      ...plan.holdoutRows.map((row) => row.id),
    ],
    splitPolicy: plan.splitPolicy,
    stats: {
      total: plan.manifest.totals.eligible,
      training: plan.manifest.totals.train,
      validation: plan.manifest.totals.validation,
      holdout: plan.manifest.totals.holdout,
      byActionType: plan.sourceCounts,
      dataWindow: plan.dataWindow,
    },
  };
}
/**
 * Prepara dataset para runs agendados/on-demand: training_data (chat aprovado) + dados de trading do namespace.
 * Retorna mesmo formato PreparedDataset para uso no mesmo pipeline de processLoraJob.
 * Quando namespaceId é null (tenant-wide), apenas training_data é usado.
 */
export async function prepareDatasetFromChatAndTrading(
  tenantId: string,
  namespaceId?: string | null,
  options?: {
    includeImages?: boolean;
    includeTradingDataset?: boolean;
    agentId?: string | null;
    domain?: string | null;
    datasetMaxRows?: number;
    trainEvalSplitRatio?: number;
    minDatasetSize?: number;
    seed?: string;
    splitPolicy?: DatasetSplitPolicy;
  }
): Promise<PreparedDataset> {
  const db = getDatabase();
  const trainingConfig = await loadTrainingEnterpriseConfig();
  const datasetMaxRows = options?.datasetMaxRows ?? trainingConfig.datasetMaxRows;
  const trainEvalSplitRatio = options?.trainEvalSplitRatio ?? trainingConfig.trainEvalSplitRatio;
  const minDatasetSize = options?.minDatasetSize ?? trainingConfig.minScheduledIncremental;
  const includeTradingDataset = options?.includeTradingDataset ?? Boolean(namespaceId);
  const splitPolicy = options?.splitPolicy
    ?? (includeTradingDataset ? 'mixed_hybrid' : 'chat_deterministic_hash');

  let imagesUsed = 0;
  if (options?.includeImages) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.generatedImages)
      .where(
        and(
          eq(schema.generatedImages.tenantId, tenantId),
          eq(schema.generatedImages.approvedForTraining, true),
          eq(schema.generatedImages.usedInFineTuning, false)
        )
      );
    imagesUsed = row?.count ?? 0;
  }

  const plan = await planCanonicalDatasetSelection({
    scope: {
      tenantId,
      namespaceId: namespaceId ?? null,
      agentId: options?.agentId ?? null,
      domain: options?.domain ?? null,
    },
    options: {
      includeTradingDataset,
      datasetMaxRows,
      trainEvalSplitRatio,
      minDatasetSize,
      seed: options?.seed ?? `${tenantId}:${namespaceId ?? 'tenant-wide'}`,
      splitPolicy,
      profileId: null,
      profileVersion: 1,
    },
  });

  const stats = {
    total: plan.manifest.totals.eligible,
    training: plan.manifest.totals.train,
    validation: plan.manifest.totals.validation,
    holdout: plan.manifest.totals.holdout,
    byActionType: plan.sourceCounts,
    imagesUsed,
  };

  logger.info(
    {
      tenantId,
      namespaceId: namespaceId ?? 'tenant-wide',
      total: stats.total,
      training: stats.training,
      validation: stats.validation,
      holdout: stats.holdout,
      datasetIdsCount: plan.manifest.totals.eligible,
      datasetMaxRows,
      trainEvalSplitRatio,
      minDatasetSize,
      includeTradingDataset,
      splitPolicy: plan.splitPolicy,
    },
    'Dataset chat+trading preparado para run agendado'
  );

  return {
    trainingData: plan.trainRows.map((row) => row.text),
    validationData: plan.validationRows.map((row) => row.text),
    holdoutData: plan.holdoutRows.map((row) => row.text),
    trainingRowIds: plan.trainRows.map((row) => row.id),
    validationRowIds: plan.validationRows.map((row) => row.id),
    holdoutRowIds: plan.holdoutRows.map((row) => row.id),
    datasetIds: [
      ...plan.trainRows.map((row) => row.id),
      ...plan.validationRows.map((row) => row.id),
      ...plan.holdoutRows.map((row) => row.id),
    ],
    splitPolicy: plan.splitPolicy,
    stats,
  };
}
export async function createLoraJob(params: CreateJobParams): Promise<LoraJob> {
  const db = getDatabase();

  const trainingConfig = await loadTrainingEnterpriseConfig();
  const defaultHyperparameters = toTradingHyperparamsFromEnterprise(trainingConfig.defaultHyperparams);
  const profile = await resolveDatasetProfile(params.tenantId, params.namespaceId, params.agentId);
  const minRequired = params.forceMinSize ? 1 : trainingConfig.minOndemandDatasetSize;

  const datasetSnapshot = await persistCanonicalDatasetSnapshot({
    scope: {
      tenantId: params.tenantId,
      namespaceId: params.namespaceId,
      agentId: params.agentId ?? null,
      domain: null,
    },
    options: {
      includeTradingDataset: true,
      datasetMaxRows: trainingConfig.datasetMaxRows,
      trainEvalSplitRatio: trainingConfig.trainEvalSplitRatio,
      minDatasetSize: minRequired,
      seed: `${params.tenantId}:${params.namespaceId}:${params.agentId ?? 'all'}:${Date.now().toString(36)}`,
      splitPolicy: 'trading_temporal',
      profileId: profile.id,
      profileVersion: profile.version,
    },
  });

  // Mesclar hiperparâmetros com defaults
  const hyperparameters: TradingLoraHyperparams = {
    ...defaultHyperparameters,
    ...params.hyperparameters,
  };

  // Criar job (source: explicit_job = criado via API/UI)
  const jobData: InsertLoraJob = {
    tenantId: params.tenantId,
    scopeType: params.agentId ? 'agent' : 'namespace',
    scopeNamespaceId: params.namespaceId,
    scopeAgentId: params.agentId ?? null,
    profileVersion: params.profileVersion ?? profile.version,
    datasetVersionId: datasetSnapshot.datasetVersionId,
    source: 'explicit_job',
    name: params.name,
    description: params.description,
    baseModel: params.baseModel || DEFAULT_BASE_MODEL,
    hyperparameters,
    status: 'queued',
    progress: 0,
    currentStep: 0,
    datasetCount: datasetSnapshot.manifest.totals.train,
    validationCount: datasetSnapshot.manifest.totals.validation,
    includeTradingDataset: true,
    metrics: {
      holdoutCount: datasetSnapshot.manifest.totals.holdout,
      datasetManifestHash: datasetSnapshot.manifest.hashes.manifest,
      splitPolicy: datasetSnapshot.splitPolicy,
    },
  };

  const [job] = await db
    .insert(schema.loraJobs)
    .values(jobData)
    .returning();

  const allDatasetIds = [
    ...datasetSnapshot.trainRows.map((row) => row.id),
    ...datasetSnapshot.validationRows.map((row) => row.id),
    ...datasetSnapshot.holdoutRows.map((row) => row.id),
  ];
  try {
    await reserveDatasetRowsForJob({
      jobId: job.id,
      rowIds: allDatasetIds,
    });
  } catch (reservationError) {
    await db.update(schema.loraJobs)
      .set({
        status: 'failed',
        errorMessage: reservationError instanceof Error ? reservationError.message : String(reservationError),
        completedAt: new Date(),
      })
      .where(eq(schema.loraJobs.id, job.id));
    throw reservationError;
  }

  await db.insert(schema.trainingLineageEvents).values([
    {
      tenantId: params.tenantId,
      namespaceId: params.namespaceId,
      eventType: 'dataset_version_created',
      sourceTable: 'training_data',
      sourceId: datasetSnapshot.datasetHash,
      producedTable: 'training_dataset_versions',
      producedId: datasetSnapshot.datasetVersionId,
      metadata: {
        datasetCount: datasetSnapshot.manifest.totals.eligible,
        profileVersion: profile.version,
        splitPolicy: datasetSnapshot.splitPolicy,
      },
    },
    {
      tenantId: params.tenantId,
      namespaceId: params.namespaceId,
      eventType: 'lora_job_created',
      sourceTable: 'training_dataset_versions',
      sourceId: datasetSnapshot.datasetVersionId,
      producedTable: 'lora_jobs',
      producedId: job.id,
      metadata: {
        datasetVersionId: datasetSnapshot.datasetVersionId,
        datasetManifestHash: datasetSnapshot.manifest.hashes.manifest,
      },
    },
  ]);

  logger.info(
    {
      jobId: job.id,
      name: params.name,
      datasetCount: datasetSnapshot.manifest.totals.train,
      validationCount: datasetSnapshot.manifest.totals.validation,
      holdoutCount: datasetSnapshot.manifest.totals.holdout,
      splitPolicy: datasetSnapshot.splitPolicy,
    },
    'Job de treinamento LoRA criado'
  );

  return job;
}

/**
 * Cria um job LoRA para run agendado/on-demand (source=scheduled_run).
 * Usa training_data + opcional trading_dataset; não marca datasets até processLoraJob concluir.
 * Retorna o job criado para o caller disparar processLoraJob(job.id).
 */
export async function createScheduledRunLoraJob(
  tenantId: string,
  options?: {
    namespaceId?: string | null;
    includeImages?: boolean;
  }
): Promise<LoraJob> {
  const db = getDatabase();
  const trainingConfig = await loadTrainingEnterpriseConfig();
  const defaultHyperparameters = toTradingHyperparamsFromEnterprise(trainingConfig.defaultHyperparams);

  const includeImages = options?.includeImages ?? false;
  const includeTrading = !!options?.namespaceId;
  const snapshot = await persistCanonicalDatasetSnapshot({
    scope: {
      tenantId,
      namespaceId: options?.namespaceId ?? null,
      agentId: null,
      domain: null,
    },
    options: {
      includeTradingDataset: includeTrading,
      datasetMaxRows: trainingConfig.datasetMaxRows,
      trainEvalSplitRatio: trainingConfig.trainEvalSplitRatio,
      minDatasetSize: trainingConfig.minScheduledIncremental,
      seed: `${tenantId}:${options?.namespaceId ?? 'tenant-wide'}:${Date.now().toString(36)}`,
      splitPolicy: includeTrading ? 'mixed_hybrid' : 'chat_deterministic_hash',
      profileId: null,
      profileVersion: 1,
    },
  });

  let imagesUsed = 0;
  if (includeImages) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.generatedImages)
      .where(
        and(
          eq(schema.generatedImages.tenantId, tenantId),
          eq(schema.generatedImages.approvedForTraining, true),
          eq(schema.generatedImages.usedInFineTuning, false)
        )
      );
    imagesUsed = row?.count ?? 0;
  }

  const name = options?.namespaceId
    ? `alice-qlora-ns-${options.namespaceId.slice(0, 8)}-v${Date.now().toString(36)}`
    : `alice-qlora-v${Date.now().toString(36)}`;

  const jobData: InsertLoraJob = {
    tenantId,
    scopeType: 'namespace',
    scopeNamespaceId: options?.namespaceId ?? null,
    scopeAgentId: null,
    profileVersion: 1,
    datasetVersionId: snapshot.datasetVersionId,
    source: 'scheduled_run',
    name,
    baseModel: DEFAULT_BASE_MODEL,
    hyperparameters: defaultHyperparameters,
    status: 'queued',
    progress: 0,
    currentStep: 0,
    datasetCount: snapshot.manifest.totals.train,
    validationCount: snapshot.manifest.totals.validation,
    includeTradingDataset: includeTrading,
    includeImages,
    metrics: {
      imagesUsed,
      holdoutCount: snapshot.manifest.totals.holdout,
      splitPolicy: snapshot.splitPolicy,
      datasetManifestHash: snapshot.manifest.hashes.manifest,
    },
  };

  const [job] = await db.insert(schema.loraJobs).values(jobData).returning();
  if (!job) throw new Error('Falha ao criar job LoRA para run agendado');

  const allDatasetIds = [
    ...snapshot.trainRows.map((row) => row.id),
    ...snapshot.validationRows.map((row) => row.id),
    ...snapshot.holdoutRows.map((row) => row.id),
  ];
  try {
    await reserveDatasetRowsForJob({
      jobId: job.id,
      rowIds: allDatasetIds,
    });
  } catch (reservationError) {
    await db.update(schema.loraJobs)
      .set({
        status: 'failed',
        errorMessage: reservationError instanceof Error ? reservationError.message : String(reservationError),
        completedAt: new Date(),
      })
      .where(eq(schema.loraJobs.id, job.id));
    throw reservationError;
  }

  await db.insert(schema.trainingLineageEvents).values([
    {
      tenantId,
      namespaceId: options?.namespaceId ?? null,
      eventType: 'dataset_version_created',
      sourceTable: 'training_data',
      sourceId: snapshot.datasetHash,
      producedTable: 'training_dataset_versions',
      producedId: snapshot.datasetVersionId,
      metadata: {
        datasetCount: snapshot.manifest.totals.eligible,
        splitPolicy: snapshot.splitPolicy,
      },
    },
    {
      tenantId,
      namespaceId: options?.namespaceId ?? null,
      eventType: 'lora_job_created',
      sourceTable: 'training_dataset_versions',
      sourceId: snapshot.datasetVersionId,
      producedTable: 'lora_jobs',
      producedId: job.id,
      metadata: {
        datasetVersionId: snapshot.datasetVersionId,
        datasetManifestHash: snapshot.manifest.hashes.manifest,
      },
    },
  ]);

  logger.info(
    {
      jobId: job.id,
      tenantId,
      namespaceId: options?.namespaceId,
      datasetCount: snapshot.manifest.totals.train,
      validationCount: snapshot.manifest.totals.validation,
      holdoutCount: snapshot.manifest.totals.holdout,
      splitPolicy: snapshot.splitPolicy,
    },
    'Job LoRA scheduled_run criado'
  );

  return job;
}

/**
 * Obtém detalhes de um job
 */
export async function getJob(jobId: string): Promise<LoraJob | null> {
  const db = getDatabase();

  const [job] = await db
    .select()
    .from(schema.loraJobs)
    .where(eq(schema.loraJobs.id, jobId))
    .limit(1);

  return job ?? null;
}

/**
 * Lista jobs de um tenant
 */
export async function listJobs(
  tenantId: string,
  options?: { status?: string; limit?: number }
): Promise<LoraJob[]> {
  const db = getDatabase();

  // CORREÇÃO 18/12/2025: Drizzle não permite encadear .where() múltiplas vezes
  // Construir condição completa de uma vez
  // CORREÇÃO 19/12/2025: Remover query não utilizado (no-unused-vars)
  const conditions = options?.status
    ? and(
        eq(schema.loraJobs.tenantId, tenantId),
        eq(schema.loraJobs.status, options.status as 'queued' | 'preparing' | 'training' | 'validating' | 'completed' | 'failed' | 'cancelled')
      )
    : eq(schema.loraJobs.tenantId, tenantId);

  const jobs = await db
    .select()
    .from(schema.loraJobs)
    .where(conditions)
    .orderBy(desc(schema.loraJobs.criadoEm))
    .limit(options?.limit ?? 50);

  return jobs;
}

/**
 * Atualiza progresso de um job
 */
export async function updateJobProgress(
  jobId: string,
  progress: Partial<JobProgress>
): Promise<LoraJob | null> {
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
    .update(schema.loraJobs)
    .set(updateData)
    .where(eq(schema.loraJobs.id, jobId))
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
export async function cancelJob(jobId: string): Promise<LoraJob | null> {
  const db = getDatabase();

  const [job] = await db
    .select()
    .from(schema.loraJobs)
    .where(eq(schema.loraJobs.id, jobId))
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
    .update(schema.loraJobs)
    .set({
      status: 'cancelled',
      completedAt: new Date(),
    })
    .where(eq(schema.loraJobs.id, jobId))
    .returning();

  await releaseDatasetRowsForJob({ jobId });
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
interface ProcessLoraJobOptions {
  sliceSteps?: number;
  gpuTimeoutMs?: number;
  datasetMaxRows?: number;
  trainEvalSplitRatio?: number;
  minDatasetSize?: number;
  seed?: string;
  includeImages?: boolean;
  includeTradingDataset?: boolean;
  agentId?: string | null;
  domain?: string | null;
  gpuPriority?: TrainingRunPriority;
  hyperparametersOverride?: Partial<TradingLoraHyperparams>;
  onDatasetPrepared?: (manifest: PreparedDatasetManifest) => Promise<void>;
  onProgress?: (progress: Partial<JobProgress> & { adapterPath?: string | null }) => Promise<void>;
}

export type TrainingRunPriority = 'low' | 'normal' | 'high';

function resolveGpuPriority(priority: TrainingRunPriority | undefined): GpuRequestPriority {
  if (priority === 'high') return GpuRequestPriority.HIGH;
  if (priority === 'normal') return GpuRequestPriority.MEDIUM;
  return GpuRequestPriority.LOW;
}

export interface PreparedDatasetManifest {
  total: number;
  training: number;
  validation: number;
  holdout: number;
  trainingRowIds: string[];
  validationRowIds: string[];
  holdoutRowIds: string[];
  datasetIds: string[];
  splitPolicy: DatasetSplitPolicy;
  manifestHash: string;
  imagesUsed: number;
}

function mergeLoraHyperparameters(
  defaultHyperparameters: TradingLoraHyperparams,
  base: TradingLoraHyperparams | null | undefined,
  override?: Partial<TradingLoraHyperparams>
): TradingLoraHyperparams {
  return {
    ...defaultHyperparameters,
    ...(base ?? {}),
    ...(override ?? {}),
  };
}

async function loadDatasetManifestForJob(job: LoraJob): Promise<TrainingDatasetManifest> {
  if (!job.datasetVersionId) {
    throw new Error(`Job ${job.id} sem datasetVersionId imutavel`);
  }
  const db = getDatabase();
  const datasetVersion = await db.query.trainingDatasetVersions.findFirst({
    where: eq(schema.trainingDatasetVersions.id, job.datasetVersionId),
    columns: {
      id: true,
      manifest: true,
      hash: true,
    },
  });
  if (!datasetVersion) {
    throw new Error(`Dataset version nao encontrado para job ${job.id}: ${job.datasetVersionId}`);
  }
  const parseResult = TrainingDatasetManifestSchema.safeParse(datasetVersion.manifest);
  if (!parseResult.success) {
    throw new Error(`Manifest de dataset invalido para job ${job.id}: ${parseResult.error.message}`);
  }
  const manifest = parseResult.data;
  if (manifest.hashes.manifest !== datasetVersion.hash) {
    throw new Error(`Manifest hash diverge do hash persistido para datasetVersion ${datasetVersion.id}`);
  }
  return manifest;
}

export async function processLoraJob(jobId: string, options?: ProcessLoraJobOptions): Promise<void> {
  const db = getDatabase();
  const job = await getJob(jobId);
  if (!job) throw new Error('Job LoRA nao encontrado');
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return;
  const trainingConfig = await loadTrainingEnterpriseConfig();
  const defaultHyperparameters = toTradingHyperparamsFromEnterprise(trainingConfig.defaultHyperparams);

  const sliceSteps = options?.sliceSteps ?? trainingConfig.sliceSteps;
  const gpuTimeoutMs = options?.gpuTimeoutMs ?? trainingConfig.gpuTimeoutMs;
  const gpuPriority = resolveGpuPriority(options?.gpuPriority);

  const resolvedHyperparameters = mergeLoraHyperparameters(
    defaultHyperparameters,
    (job.hyperparameters as TradingLoraHyperparams) ?? defaultHyperparameters,
    options?.hyperparametersOverride
  );

  if (options?.hyperparametersOverride) {
    await db
      .update(schema.loraJobs)
      .set({ hyperparameters: resolvedHyperparameters })
      .where(eq(schema.loraJobs.id, jobId));
  }

  await updateJobProgress(jobId, {
    status: 'preparing',
    progress: 0,
    currentStep: 0,
    totalSteps: job.totalSteps ?? null,
    metrics: job.metrics as TradingLoraMetrics,
  });
  await options?.onProgress?.({ status: 'preparing', progress: 0, currentStep: 0, totalSteps: job.totalSteps ?? null });

  const tenantId = job.tenantId;
  if (!tenantId) {
    throw new Error('Job LoRA sem tenantId');
  }
  const manifest = await loadDatasetManifestForJob(job);
  const imagesUsed = typeof (job.metrics as TradingLoraMetrics | null)?.imagesUsed === 'number'
    ? (job.metrics as TradingLoraMetrics).imagesUsed
    : 0;
  const prepared: PreparedDataset = {
    trainingData: manifest.rows.train.map((row) => row.text),
    validationData: manifest.rows.validation.map((row) => row.text),
    holdoutData: manifest.rows.holdout.map((row) => row.text),
    trainingRowIds: manifest.rows.train.map((row) => row.id),
    validationRowIds: manifest.rows.validation.map((row) => row.id),
    holdoutRowIds: manifest.rows.holdout.map((row) => row.id),
    datasetIds: [
      ...manifest.rows.train.map((row) => row.id),
      ...manifest.rows.validation.map((row) => row.id),
      ...manifest.rows.holdout.map((row) => row.id),
    ],
    splitPolicy: manifest.splitPolicy,
    stats: {
      total: manifest.totals.eligible,
      training: manifest.totals.train,
      validation: manifest.totals.validation,
      holdout: manifest.totals.holdout,
      byActionType: manifest.sourceCounts,
      imagesUsed,
    },
  };

  const jobDir = path.join(TRAINING_STORAGE_DIR, 'trading-lora', tenantId, jobId);
  await ensureDir(jobDir);

  const trainPath = path.join(jobDir, 'train.jsonl');
  const evalPath = path.join(jobDir, 'eval.jsonl');
  const outputDir = path.join(jobDir, 'output');
  await ensureDir(outputDir);

  const evalData = prepared.holdoutData.length > 0 ? prepared.holdoutData : prepared.validationData;
  await writeJsonlFile(trainPath, prepared.trainingData);
  await writeJsonlFile(evalPath, evalData);
  await options?.onDatasetPrepared?.({
    total: prepared.stats.total,
    training: prepared.stats.training,
    validation: prepared.stats.validation,
    holdout: prepared.stats.holdout,
    trainingRowIds: prepared.trainingRowIds,
    validationRowIds: prepared.validationRowIds,
    holdoutRowIds: prepared.holdoutRowIds,
    datasetIds: prepared.datasetIds,
    splitPolicy: prepared.splitPolicy,
    manifestHash: manifest.hashes.manifest,
    imagesUsed: prepared.stats.imagesUsed ?? 0,
  });

  const targetSteps = computeTargetSteps(prepared.stats.training, resolvedHyperparameters);
  const mergedMetrics: TradingLoraMetrics = {
    ...(job.metrics as TradingLoraMetrics),
    imagesUsed: prepared.stats.imagesUsed ?? (job.metrics as TradingLoraMetrics)?.imagesUsed,
    holdoutCount: prepared.stats.holdout,
    splitPolicy: prepared.splitPolicy,
    datasetManifestHash: manifest.hashes.manifest,
  };
  await updateJobProgress(jobId, {
    status: 'training',
    progress: 0,
    currentStep: 0,
    totalSteps: targetSteps,
    metrics: mergedMetrics,
  });
  await options?.onProgress?.({ status: 'training', progress: 0, currentStep: 0, totalSteps: targetSteps });

  let stepsCompleted = 0;

  while (stepsCompleted < targetSteps) {
    const fresh = await getJob(jobId);
    if (!fresh) throw new Error('Job LoRA desapareceu');
    if (fresh.status === 'cancelled') return;

    const freshHyperparams = mergeLoraHyperparameters(
      defaultHyperparameters,
      (fresh.hyperparameters as TradingLoraHyperparams) ?? resolvedHyperparameters,
      options?.hyperparametersOverride
    );

    const gpu = await requestGpu({
      serviceType: GpuServiceType.TRAINING,
      endpoint: '/train/lora/slice',
      method: 'POST',
      priority: gpuPriority,
      timeout: gpuTimeoutMs,
      body: {
        jobId,
        baseModel: fresh.baseModel,
        trainJsonlPath: trainPath,
        evalJsonlPath: evalPath,
        outputDir,
        stepsThisSlice: Math.min(sliceSteps, targetSteps - stepsCompleted),
        hyperparameters: {
          epochs: freshHyperparams.epochs,
          learningRate: freshHyperparams.learningRate,
          batchSize: freshHyperparams.batchSize,
          maxSeqLen: freshHyperparams.maxSeqLen,
          loraRank: freshHyperparams.loraRank,
          loraAlpha: freshHyperparams.loraAlpha,
          warmupSteps: freshHyperparams.warmupSteps,
          gradientAccumulationSteps: freshHyperparams.gradientAccumulationSteps,
          loraDropout: freshHyperparams.loraDropout,
          lrSchedulerType: freshHyperparams.lrSchedulerType,
          maxGradNorm: freshHyperparams.maxGradNorm,
          targetModules: freshHyperparams.targetModules,
        },
      },
    });

    const data = gpu.data as {
      stepsCompleted?: number;
      adapterPath?: string;
      metrics?: Record<string, unknown>;
    } | undefined;
    stepsCompleted = data?.stepsCompleted ?? (stepsCompleted + sliceSteps);
    const pct = Math.min(99, Math.floor((stepsCompleted / targetSteps) * 100));
    const sliceMetricsRaw = data?.metrics;
    const sliceMetrics = typeof sliceMetricsRaw === 'object' && sliceMetricsRaw !== null
      ? sliceMetricsRaw
      : {};
    const nextMetrics: TradingLoraMetrics = {
      ...(fresh.metrics as TradingLoraMetrics),
      ...(sliceMetrics as TradingLoraMetrics),
      imagesUsed: prepared.stats.imagesUsed ?? (fresh.metrics as TradingLoraMetrics)?.imagesUsed,
    };
    await updateJobProgress(jobId, {
      status: stepsCompleted >= targetSteps ? 'validating' : 'training',
      progress: pct,
      currentStep: stepsCompleted,
      totalSteps: targetSteps,
      metrics: nextMetrics,
    });

    if (data?.adapterPath) {
      await db.update(schema.loraJobs)
        .set({ resultAdapterPath: data.adapterPath })
        .where(eq(schema.loraJobs.id, jobId));
    }

    await options?.onProgress?.({
      status: stepsCompleted >= targetSteps ? 'validating' : 'training',
      progress: pct,
      currentStep: stepsCompleted,
      totalSteps: targetSteps,
      adapterPath: data?.adapterPath ?? null,
    });
  }

  const final = await getJob(jobId);
  const adapterPath = final?.resultAdapterPath;
  if (!adapterPath) throw new Error('AdapterPath nao definido no job LoRA');
  const adapterSize = await getDirectorySizeBytes(adapterPath);

  await setJobResult(jobId, { adapterPath, adapterSize, metrics: (final?.metrics as TradingLoraMetrics) || {} });

  await markDatasetRowsUsedForJob({ jobId, rowIds: prepared.datasetIds });
  logger.info({ jobId, count: prepared.datasetIds.length }, 'training_data reservados marcados como usados');

  if (job.source === 'scheduled_run') {
    try {
      await activateLoraAdapter(jobId, undefined);
    } catch (err) {
      logger.warn({ err, jobId }, 'Ativacao automatica do adapter apos run agendado falhou (nao bloqueante)');
    }
  }

  await options?.onProgress?.({ status: 'completed', progress: 100, currentStep: targetSteps, totalSteps: targetSteps, adapterPath });
}
export async function setJobResult(
  jobId: string,
  result: {
    adapterPath: string;
    adapterSize: number;
    metrics: TradingLoraMetrics;
  }
): Promise<LoraJob | null> {
  const db = getDatabase();

  const [updated] = await db
    .update(schema.loraJobs)
    .set({
      status: 'completed',
      progress: 100,
      resultAdapterPath: result.adapterPath,
      resultAdapterSize: result.adapterSize,
      metrics: result.metrics,
      completedAt: new Date(),
    })
    .where(eq(schema.loraJobs.id, jobId))
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
): Promise<LoraJob | null> {
  const db = getDatabase();

  const [updated] = await db
    .update(schema.loraJobs)
    .set({
      status: 'failed',
      errorMessage: error.message,
      errorDetails: error.details ?? null,
      completedAt: new Date(),
    })
    .where(eq(schema.loraJobs.id, jobId))
    .returning();

  await releaseDatasetRowsForJob({ jobId });
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
    .from(schema.loraJobs)
    .where(eq(schema.loraJobs.tenantId, tenantId));

  // Por status
  const statusResults = await db
    .select({
      status: schema.loraJobs.status,
      count: sql<number>`count(*)`,
    })
    .from(schema.loraJobs)
    .where(eq(schema.loraJobs.tenantId, tenantId))
    .groupBy(schema.loraJobs.status);

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
    .from(schema.loraJobs)
    .where(
      and(
        eq(schema.loraJobs.tenantId, tenantId),
        eq(schema.loraJobs.status, 'completed')
      )
    );

  // Total de datasets usados
  const [datasetsResult] = await db
    .select({ sum: sql<number>`SUM(dataset_count)` })
    .from(schema.loraJobs)
    .where(eq(schema.loraJobs.tenantId, tenantId));

  return {
    total: Number(totalResult?.count ?? 0),
    byStatus,
    avgTrainingTime: avgResult?.avgMinutes ?? null,
    totalDatasetsUsed: Number(datasetsResult?.sum ?? 0),
  };
}

// ============================================================================
// ATIVAÇÃO DE ADAPTER LoRA
// ============================================================================

/**
 * Diretório padrão onde adapters ativos ficam disponíveis para o vLLM
 * Volume montado como read-only no container gpu-llm
 */
const LORA_ACTIVE_DIR = '/opt/alice/data/lora-adapters';

export function getScopedAdapterName(job: LoraJob): string {
  if (job.scopeType === 'agent' && job.scopeAgentId) {
    return `agent-${job.scopeAgentId}`;
  }
  if (job.scopeNamespaceId) {
    return `namespace-${job.scopeNamespaceId}`;
  }
  return `job-${job.id}`;
}

export function getScopedAdapterTargetDir(job: LoraJob): string {
  if (job.scopeType === 'agent' && job.scopeAgentId) {
    return path.join(LORA_ACTIVE_DIR, 'agents', job.scopeAgentId);
  }
  return path.join(LORA_ACTIVE_DIR, 'namespaces', job.scopeNamespaceId ?? 'unknown');
}

/**
 * Ativa um adapter LoRA aprovado, tornando-o disponível para inferência no vLLM.
 * 
 * Fluxo:
 * 1. Valida que o job está completo e tem adapter path
 * 2. Copia/linka adapter para diretório padrão do vLLM
 * 3. Valida existência de adapter_config.json e adapter_model.safetensors
 * 4. Marca adapter como ativo no banco (desativando o anterior)
 * 5. O vLLM carrega automaticamente via filesystem resolver (sem restart)
 * 
 * @param jobId - ID do job de treinamento LoRA a ativar
 * @param approvedBy - ID do usuário que aprovou (para auditoria); undefined para ativação automática (ex.: run agendado)
 */
export async function activateLoraAdapter(
  jobId: string,
  approvedBy?: string | null
): Promise<{ success: boolean; adapterPath: string; message: string }> {
  const db = getDatabase();

  // 1. Buscar job e validar estado
  const job = await getJob(jobId);
  if (!job) {
    throw new Error(`Job LoRA não encontrado: ${jobId}`);
  }
  if (job.status !== 'completed') {
    throw new Error(`Job LoRA deve estar completo para ativação. Status atual: ${job.status}`);
  }
  if (!job.resultAdapterPath) {
    throw new Error(`Job LoRA ${jobId} não possui resultAdapterPath`);
  }

  const sourcePath = job.resultAdapterPath;

  // 2. Validar que os arquivos do adapter existem no source
  const configPath = path.join(sourcePath, 'adapter_config.json');
  const modelPath = path.join(sourcePath, 'adapter_model.safetensors');

  try {
    await fs.access(configPath);
  } catch {
    throw new Error(`adapter_config.json não encontrado em ${sourcePath}`);
  }
  try {
    await fs.access(modelPath);
  } catch {
    throw new Error(`adapter_model.safetensors não encontrado em ${sourcePath}`);
  }

  // 3. Copiar adapter para diretório ativo do vLLM
  const targetDir = getScopedAdapterTargetDir(job);
  const adapterName = getScopedAdapterName(job);
  const targetParent = path.dirname(targetDir);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const tempDir = `${targetDir}.tmp-${suffix}`;
  const backupDir = `${targetDir}.bak-${suffix}`;
  await fs.mkdir(targetParent, { recursive: true });

  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.cp(sourcePath, tempDir, { recursive: true });
  logger.info({ sourcePath, tempDir, targetDir }, 'Adapter LoRA copiado para diretório temporário');

  // 4. Validar cópia temporária antes do swap atômico
  try {
    await fs.access(path.join(tempDir, 'adapter_config.json'));
    await fs.access(path.join(tempDir, 'adapter_model.safetensors'));
  } catch {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw new Error('Falha na validacao da copia temporaria do adapter');
  }

  let targetExists = false;
  try {
    await fs.access(targetDir);
    targetExists = true;
  } catch {
    targetExists = false;
  }
  if (targetExists) {
    await fs.rm(backupDir, { recursive: true, force: true });
    await fs.rename(targetDir, backupDir);
  }
  await fs.rename(tempDir, targetDir);
  logger.info({ targetDir, backupDir, targetExists }, 'Swap atômico do adapter concluído');

  // 5. Desativar adapter anterior apenas do mesmo escopo e marcar este como ativo
  if (!job.tenantId) {
    throw new Error('Job sem tenant válido não pode ativar adapter LoRA');
  }
  const sameScopeConditions = [
    eq(schema.loraJobs.tenantId, job.tenantId),
    eq(schema.loraJobs.scopeType, job.scopeType),
  ];
  if (job.scopeNamespaceId) {
    sameScopeConditions.push(eq(schema.loraJobs.scopeNamespaceId, job.scopeNamespaceId));
  }
  if (job.scopeAgentId) {
    sameScopeConditions.push(eq(schema.loraJobs.scopeAgentId, job.scopeAgentId));
  }

  try {
    await db.transaction(async (tx) => {
      await tx.update(schema.loraJobs)
        .set({ isActiveAdapter: false, isActiveByScope: false, activeAdapterPath: null })
        .where(and(...sameScopeConditions));

      await tx.update(schema.loraJobs)
        .set({
          isActiveAdapter: true,
          isActiveByScope: true,
          activeAdapterPath: targetDir,
          approvedAt: new Date(),
          approvedBy: approvedBy ?? null,
        })
        .where(eq(schema.loraJobs.id, jobId));
    });
  } catch (error) {
    logger.error({ error, jobId, targetDir, backupDir }, 'Falha na transação de ativação; revertendo filesystem');
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => undefined);
    if (targetExists) {
      await fs.rename(backupDir, targetDir).catch(() => undefined);
    }
    throw error;
  }

  if (targetExists) {
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
  }

  logger.info(
    { jobId, adapterPath: targetDir, approvedBy },
    'Adapter LoRA ativado com sucesso - disponível para inferência no vLLM'
  );

  return {
    success: true,
    adapterPath: targetDir,
    message: `Adapter LoRA ativado: ${adapterName}. vLLM carregará automaticamente via filesystem resolver.`,
  };
}

/**
 * Retorna o adapter LoRA atualmente ativo, ou null se nenhum estiver ativo.
 * Usado pelo GPU Manager e integrations-service para determinar qual modelo solicitar.
 */
export async function getActiveAdapter(scope?: {
  tenantId?: string;
  namespaceId?: string;
  agentId?: string;
}): Promise<{
  jobId: string;
  adapterName: string;
  adapterPath: string;
  activatedAt: Date | null;
  jobName: string;
  metrics: TradingLoraMetrics;
} | null> {
  const db = getDatabase();
  const agentScopeCondition = scope?.agentId
    ? eq(schema.loraJobs.scopeAgentId, scope.agentId)
    : scope?.namespaceId
      ? sql`${schema.loraJobs.scopeAgentId} IS NULL`
      : sql`TRUE`;

  const [active] = await db
    .select()
    .from(schema.loraJobs)
    .where(
      and(
        eq(schema.loraJobs.isActiveByScope, true),
        scope?.tenantId ? eq(schema.loraJobs.tenantId, scope.tenantId) : sql`TRUE`,
        scope?.namespaceId ? eq(schema.loraJobs.scopeNamespaceId, scope.namespaceId) : sql`TRUE`,
        agentScopeCondition
      )
    )
    .orderBy(desc(schema.loraJobs.criadoEm))
    .limit(1);

  const canonicalAdapterPath = active?.activeAdapterPath ?? active?.resultAdapterPath ?? null;
  if (active && canonicalAdapterPath) {
    return {
      jobId: active.id,
      adapterName: getScopedAdapterName(active),
      adapterPath: canonicalAdapterPath,
      activatedAt: active.approvedAt,
      jobName: active.name,
      metrics: (active.metrics as TradingLoraMetrics) ?? {},
    };
  }

  return null;
}

/**
 * Desativa o adapter LoRA ativo (volta a usar modelo base puro).
 */
export async function deactivateLoraAdapter(scope?: {
  tenantId?: string;
  namespaceId?: string;
  agentId?: string;
}): Promise<void> {
  const db = getDatabase();
  const agentScopeCondition = scope?.agentId
    ? eq(schema.loraJobs.scopeAgentId, scope.agentId)
    : scope?.namespaceId
      ? sql`${schema.loraJobs.scopeAgentId} IS NULL`
      : sql`TRUE`;

  const [active] = await db
    .select({
      id: schema.loraJobs.id,
      scopeType: schema.loraJobs.scopeType,
      scopeNamespaceId: schema.loraJobs.scopeNamespaceId,
      scopeAgentId: schema.loraJobs.scopeAgentId,
    })
    .from(schema.loraJobs)
    .where(
      and(
        eq(schema.loraJobs.isActiveByScope, true),
        scope?.tenantId ? eq(schema.loraJobs.tenantId, scope.tenantId) : sql`TRUE`,
        scope?.namespaceId ? eq(schema.loraJobs.scopeNamespaceId, scope.namespaceId) : sql`TRUE`,
        agentScopeCondition
      )
    )
    .limit(1);

  if (!active) {
    logger.info('Nenhum adapter ativo para desativar');
    return;
  }

  await db.update(schema.loraJobs)
    .set({ isActiveAdapter: false, isActiveByScope: false, activeAdapterPath: null })
    .where(eq(schema.loraJobs.id, active.id));

  // Remover adapter do diretório ativo (vLLM para de usar)
  const targetDir = active.scopeType === 'agent' && active.scopeAgentId
    ? path.join(LORA_ACTIVE_DIR, 'agents', active.scopeAgentId)
    : path.join(LORA_ACTIVE_DIR, 'namespaces', active.scopeNamespaceId ?? 'unknown');
  try {
    await fs.rm(targetDir, { recursive: true, force: true });
  } catch {
    logger.warn({ targetDir }, 'Falha ao remover diretório de adapter ativo (não bloqueante)');
  }

  logger.info({ jobId: active.id }, 'Adapter LoRA desativado - vLLM usará modelo base');
}

export default {
  // Dataset
  prepareDataset,
  prepareDatasetFromChatAndTrading,

  // Jobs
  createLoraJob,
  getJob,
  listJobs,
  updateJobProgress,
  cancelJob,
  setJobResult,
  setJobError,
  
  // Adapter activation
  activateLoraAdapter,
  getActiveAdapter,
  deactivateLoraAdapter,
  
  // Stats
  getJobStats,
};
