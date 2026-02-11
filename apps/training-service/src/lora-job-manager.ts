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
import { getDatabase, schema, eq, and, desc, sql, inArray, isNull, or } from '@alice/database';
import { getSystemConfig } from '@alice/database/system-config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requestGpu, GpuServiceType, GpuRequestPriority, GPU_MANAGER_CONFIG } from '@alice/shared-utils';
import type {
  LoraJob,
  InsertLoraJob,
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
  maxSeqLen: 2048,
};

/** Mínimo de exemplos para jobs LoRA (trading_dataset). Reservado para validação futura. */
const _MIN_DATASET_SIZE = 100;

/** Mínimo de exemplos para runs agendados (training_data + opcional trading). */
const MIN_CHAT_DATASET_SIZE = 50;

/** Mínimo para jobs on-demand (criados via API/UI). Configurável por DB/env. */
const MIN_ONDEMAND_DATASET_SIZE_DEFAULT = Math.max(
  1,
  parseInt(process.env.MIN_ONDEMAND_DATASET_SIZE ?? '10', 10) || 10
);

async function resolveMinOndemandDatasetSize(): Promise<number> {
  const v = await getSystemConfig('MIN_ONDEMAND_DATASET_SIZE');
  if (v) {
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return MIN_ONDEMAND_DATASET_SIZE_DEFAULT;
}

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
  datasetIds: string[];      // IDs dos datasets filtrados (trading_dataset - para marcar como usados)
  /** IDs de training_data usados (apenas quando source=scheduled_run). Marcar usedInJobId após sucesso. */
  trainingDataIds?: string[];
  stats: {
    total: number;
    training: number;
    validation: number;
    byActionType: Record<string, number>;
    /** Número de imagens aprovadas incluídas (quando includeImages=true). */
    imagesUsed?: number;
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
        eq(schema.tradingDataset.isDuplicate, false),
        // Incluir todas as fontes aprovadas (signal, order, postmortem etc.)
        // para não reduzir artificialmente o corpus de treino.
        // Scope por namespace/agente no metadata.
        // Regra de segregação estrita:
        // - namespaceId DEVE casar com o namespace alvo
        // - sem fallback para NULL (evita contaminação cross-namespace)
        // - para escopo de agente, agentId deve casar explicitamente
        sql`(
          (
            (${schema.tradingDataset.sourceMetadata} ->> 'namespaceId') = ${namespaceId}
          )
          AND (
            ${agentId ?? null} IS NULL
            OR (${schema.tradingDataset.sourceMetadata} ->> 'agentId') = ${agentId ?? null}
          )
        )`,
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

/**
 * Formato SFT para mensagens de chat (training_data): "role: content" por linha.
 * Mesmo formato esperado pelo gpu-trainer (campo `text` no JSONL).
 */
function buildChatMlText(messages: Array<{ role: string; content: string }>): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join('\n');
}

/**
 * Prepara dataset para runs agendados/on-demand: training_data (chat aprovado) + opcional trading_dataset.
 * Retorna mesmo formato PreparedDataset para uso no mesmo pipeline de processLoraJob.
 * Quando namespaceId é null (tenant-wide), apenas training_data é usado; trading exige namespace.
 */
export async function prepareDatasetFromChatAndTrading(
  tenantId: string,
  namespaceId?: string | null,
  options?: {
    includeTradingDataset?: boolean;
    /** Quando true, inclui contagem de imagens aprovadas (generated_images) em stats.imagesUsed. */
    includeImages?: boolean;
    /** Quando true, retorna apenas stats e ids (para validação/criação de job sem carregar linhas). */
    countOnly?: boolean;
  }
): Promise<PreparedDataset> {
  const db = getDatabase();

  const chatWhere = and(
    eq(schema.trainingData.status, 'approved'),
    eq(schema.trainingData.tenantId, tenantId),
    isNull(schema.trainingData.usedInJobId),
    namespaceId != null
      ? or(
          eq(schema.trainingData.namespaceId, namespaceId),
          eq(schema.trainingData.inferredNamespaceId, namespaceId)
        )
      : undefined
  );

  const chatRows = await db.query.trainingData.findMany({
    where: chatWhere,
    columns: { id: true, messages: true, sourceType: true },
    limit: 5000,
  });

  const byActionType: Record<string, number> = {};
  for (const r of chatRows) {
    const k = r.sourceType ?? 'chat';
    byActionType[k] = (byActionType[k] ?? 0) + 1;
  }

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

  let trainingData: string[] = [];
  let validationData: string[] = [];
  let datasetIds: string[] = [];
  const trainingDataIds = chatRows.map((r) => r.id);

  const formatChatToJsonl = (row: { messages: unknown }): string => {
    const messages = (row.messages ?? []) as Array<{ role: string; content: string }>;
    const text = buildChatMlText(messages);
    return JSON.stringify({ text });
  };

  const combined: Array<{ id: string; type: 'chat' | 'trading'; line: string }> = chatRows.map((r) => ({
    id: r.id,
    type: 'chat',
    line: formatChatToJsonl(r),
  }));

  if (options?.includeTradingDataset && namespaceId) {
    const tradingPrepared = await prepareDataset(tenantId, namespaceId, undefined, undefined);
    datasetIds = tradingPrepared.datasetIds;
    for (const line of tradingPrepared.trainingData) {
      combined.push({ id: '', type: 'trading', line });
    }
    for (const line of tradingPrepared.validationData) {
      combined.push({ id: '', type: 'trading', line });
    }
    Object.entries(tradingPrepared.stats.byActionType).forEach(([k, v]) => {
      byActionType[`trading_${k}`] = (byActionType[`trading_${k}`] ?? 0) + v;
    });
  }

  if (combined.length < MIN_CHAT_DATASET_SIZE) {
    throw new Error(
      `Dataset insuficiente para run agendado: ${combined.length} exemplos. Mínimo: ${MIN_CHAT_DATASET_SIZE}`
    );
  }

  const shuffled = fisherYatesShuffle([...combined]);
  const splitIndex = Math.floor(shuffled.length * 0.9);
  const trainPart = shuffled.slice(0, splitIndex);
  const validationPart = shuffled.slice(splitIndex);

  if (!options?.countOnly) {
    trainingData = trainPart.map((p) => p.line);
    validationData = validationPart.map((p) => p.line);
  }

  const stats = {
    total: combined.length,
    training: trainPart.length,
    validation: validationPart.length,
    byActionType,
    imagesUsed,
  };

  logger.info(
    {
      tenantId,
      namespaceId: namespaceId ?? 'tenant-wide',
      total: stats.total,
      training: stats.training,
      validation: stats.validation,
      trainingDataIdsCount: trainingDataIds.length,
      datasetIdsCount: datasetIds.length,
    },
    'Dataset chat+trading preparado para run agendado'
  );

  return {
    trainingData,
    validationData,
    datasetIds,
    trainingDataIds,
    stats,
  };
}

// ============================================================================
// GERENCIAMENTO DE JOBS
// ============================================================================

/**
 * Cria um novo job de treinamento LoRA
 */
export async function createLoraJob(params: CreateJobParams): Promise<LoraJob> {
  const db = getDatabase();

  const minOndemand = await resolveMinOndemandDatasetSize();

  // Preparar dataset para obter contagens
  const dataset = await prepareDataset(params.tenantId, params.namespaceId, params.agentId, params.datasetFilter);

  const minRequired = params.forceMinSize ? 1 : minOndemand;
  if (dataset.stats.total < minRequired) {
    throw new Error(
      `Dataset insuficiente: ${dataset.stats.total} exemplos. Mínimo necessário: ${minRequired}${params.forceMinSize ? ' (forçar com poucos exemplos pode prejudicar o modelo)' : ''}`
    );
  }

  // Mesclar hiperparâmetros com defaults
  const hyperparameters: TradingLoraHyperparams = {
    ...DEFAULT_HYPERPARAMS,
    ...params.hyperparameters,
  };

  // Criar job (source: explicit_job = criado via API/UI)
  const jobData: InsertLoraJob = {
    tenantId: params.tenantId,
    scopeType: params.agentId ? 'agent' : 'namespace',
    scopeNamespaceId: params.namespaceId,
    scopeAgentId: params.agentId ?? null,
    profileVersion: params.profileVersion ?? 1,
    source: 'explicit_job',
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
    .insert(schema.loraJobs)
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
 * Cria um job LoRA para run agendado/on-demand (source=scheduled_run).
 * Usa training_data + opcional trading_dataset; não marca datasets até processLoraJob concluir.
 * Retorna o job criado para o caller disparar processLoraJob(job.id).
 */
export async function createScheduledRunLoraJob(
  tenantId: string,
  options?: {
    namespaceId?: string | null;
    includeTradingDataset?: boolean;
    includeImages?: boolean;
  }
): Promise<LoraJob> {
  const db = getDatabase();

  const includeImages = options?.includeImages ?? false;
  const prepared = await prepareDatasetFromChatAndTrading(
    tenantId,
    options?.namespaceId ?? undefined,
    {
      includeTradingDataset: options?.includeTradingDataset ?? !!options?.namespaceId,
      includeImages,
      countOnly: true,
    }
  );

  const name = options?.namespaceId
    ? `alice-qlora-ns-${options.namespaceId.slice(0, 8)}-v${Date.now().toString(36)}`
    : `alice-qlora-v${Date.now().toString(36)}`;

  const includeTrading = options?.includeTradingDataset ?? !!options?.namespaceId;
  const jobData: InsertLoraJob = {
    tenantId,
    scopeType: 'namespace',
    scopeNamespaceId: options?.namespaceId ?? null,
    scopeAgentId: null,
    profileVersion: 1,
    source: 'scheduled_run',
    name,
    baseModel: DEFAULT_BASE_MODEL,
    hyperparameters: DEFAULT_HYPERPARAMS,
    status: 'queued',
    progress: 0,
    currentStep: 0,
    datasetCount: prepared.stats.training,
    validationCount: prepared.stats.validation,
    includeTradingDataset: includeTrading,
    includeImages,
    metrics: { imagesUsed: prepared.stats.imagesUsed ?? 0 },
  };

  const [job] = await db.insert(schema.loraJobs).values(jobData).returning();
  if (!job) throw new Error('Falha ao criar job LoRA para run agendado');

  logger.info(
    { jobId: job.id, tenantId, namespaceId: options?.namespaceId, datasetCount: prepared.stats.training },
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
export async function processLoraJob(jobId: string): Promise<void> {
  const db = getDatabase();
  const job = await getJob(jobId);
  if (!job) throw new Error('Job LoRA não encontrado');
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return;

  await updateJobProgress(jobId, { status: 'preparing', progress: 0, currentStep: 0, totalSteps: job.totalSteps ?? null, metrics: job.metrics as TradingLoraMetrics });

  const tenantId = job.tenantId;
  if (!tenantId) {
    throw new Error('Job LoRA sem tenantId');
  }
  const namespaceId = job.scopeNamespaceId;
  const isScheduledRun = job.source === 'scheduled_run';
  if (!isScheduledRun && !namespaceId) {
    throw new Error('Job LoRA explícito exige scopeNamespaceId');
  }

  const includeTradingDataset = job.includeTradingDataset ?? !!namespaceId;
  const includeImages = job.includeImages ?? false;
  const prepared = isScheduledRun
    ? await prepareDatasetFromChatAndTrading(tenantId, namespaceId ?? undefined, { includeTradingDataset, includeImages })
    : await prepareDataset(tenantId, namespaceId!, job.scopeAgentId ?? undefined, undefined);

  const jobDir = path.join(TRAINING_STORAGE_DIR, 'trading-lora', tenantId, jobId);
  await ensureDir(jobDir);

  const trainPath = path.join(jobDir, 'train.jsonl');
  const evalPath = path.join(jobDir, 'eval.jsonl');
  const outputDir = path.join(jobDir, 'output');
  await ensureDir(outputDir);

  await writeJsonlFile(trainPath, prepared.trainingData);
  await writeJsonlFile(evalPath, prepared.validationData);

  const targetSteps = computeTargetSteps(prepared.stats.training, job.hyperparameters as TradingLoraHyperparams);
  const mergedMetrics: TradingLoraMetrics = {
    ...(job.metrics as TradingLoraMetrics),
    imagesUsed: prepared.stats.imagesUsed ?? (job.metrics as TradingLoraMetrics)?.imagesUsed,
  };
  await updateJobProgress(jobId, { status: 'training', progress: 0, currentStep: 0, totalSteps: targetSteps, metrics: mergedMetrics });

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
          maxSeqLen: (fresh.hyperparameters as TradingLoraHyperparams).maxSeqLen ?? 2048,
          loraRank: (fresh.hyperparameters as TradingLoraHyperparams).loraRank,
          loraAlpha: (fresh.hyperparameters as TradingLoraHyperparams).loraAlpha,
          warmupSteps: (fresh.hyperparameters as TradingLoraHyperparams).warmupSteps ?? 100,
          gradientAccumulationSteps: 1,
          loraDropout: 0.05,
        },
      },
    });

    const data = gpu.data as { stepsCompleted?: number; adapterPath?: string } | undefined;
    stepsCompleted = data?.stepsCompleted ?? (stepsCompleted + sliceSteps);
    const pct = Math.min(99, Math.floor((stepsCompleted / targetSteps) * 100));
    await updateJobProgress(jobId, { status: stepsCompleted >= targetSteps ? 'validating' : 'training', progress: pct, currentStep: stepsCompleted, totalSteps: targetSteps, metrics: fresh.metrics as TradingLoraMetrics });

    if (data?.adapterPath) {
      await db.update(schema.loraJobs)
        .set({ resultAdapterPath: data.adapterPath })
        .where(eq(schema.loraJobs.id, jobId));
    }
  }

  const final = await getJob(jobId);
  const adapterPath = final?.resultAdapterPath;
  if (!adapterPath) throw new Error('AdapterPath não definido no job LoRA');
  const adapterSize = await getDirectorySizeBytes(adapterPath);

  await setJobResult(jobId, { adapterPath, adapterSize, metrics: (final?.metrics as TradingLoraMetrics) || {} });

  // Runs agendados: marcar training_data e trading_dataset como usados; ativar adapter automaticamente
  if (isScheduledRun) {
    if (prepared.trainingDataIds?.length) {
      await db
        .update(schema.trainingData)
        .set({ usedInJobId: jobId, processadoEm: new Date() })
        .where(inArray(schema.trainingData.id, prepared.trainingDataIds));
      logger.info({ jobId, count: prepared.trainingDataIds.length }, 'training_data marcados como usados');
    }
    if (prepared.datasetIds?.length) {
      await db
        .update(schema.tradingDataset)
        .set({ status: 'used', usedInJobId: jobId, atualizadoEm: new Date() })
        .where(inArray(schema.tradingDataset.id, prepared.datasetIds));
      logger.info({ jobId, count: prepared.datasetIds.length }, 'trading_dataset marcados como usados');
    }
    try {
      await activateLoraAdapter(jobId, undefined);
    } catch (err) {
      logger.warn({ err, jobId }, 'Ativação automática do adapter após run agendado falhou (não bloqueante)');
    }
  }
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
  
  // Criar diretório base se não existir
  await fs.mkdir(LORA_ACTIVE_DIR, { recursive: true });
  
  // Remover adapter anterior se existir
  try {
    await fs.rm(targetDir, { recursive: true, force: true });
  } catch {
    // Diretório pode não existir ainda - OK
  }

  // Copiar todos os arquivos do adapter
  await fs.cp(sourcePath, targetDir, { recursive: true });
  logger.info({ sourcePath, targetDir }, 'Adapter LoRA copiado para diretório ativo do vLLM');

  // 4. Validar que a cópia foi bem-sucedida
  try {
    await fs.access(path.join(targetDir, 'adapter_config.json'));
    await fs.access(path.join(targetDir, 'adapter_model.safetensors'));
  } catch {
    throw new Error('Falha na validação pós-cópia do adapter');
  }

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

  await db.update(schema.loraJobs)
    .set({ isActiveAdapter: false, isActiveByScope: false })
    .where(and(...sameScopeConditions));

  await db.update(schema.loraJobs)
    .set({
      isActiveAdapter: true,
      isActiveByScope: true,
      approvedAt: new Date(),
      approvedBy: approvedBy ?? null,
    })
    .where(eq(schema.loraJobs.id, jobId));

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

  if (active?.resultAdapterPath) {
    return {
      jobId: active.id,
      adapterName: getScopedAdapterName(active),
      adapterPath: active.resultAdapterPath,
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
        scope?.agentId ? eq(schema.loraJobs.scopeAgentId, scope.agentId) : sql`TRUE`
      )
    )
    .limit(1);

  if (!active) {
    logger.info('Nenhum adapter ativo para desativar');
    return;
  }

  await db.update(schema.loraJobs)
    .set({ isActiveAdapter: false, isActiveByScope: false })
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
