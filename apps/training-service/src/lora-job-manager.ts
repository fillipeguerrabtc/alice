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
import { getDatabase, schema, eq, and, desc, sql, inArray, isNull, or, not } from '@alice/database';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { requestGpu, GpuServiceType, GpuRequestPriority, GPU_MANAGER_CONFIG } from '@alice/shared-utils';
import type {
  LoraJob,
  InsertLoraJob,
  TradingLoraHyperparams,
  TradingLoraMetrics,
} from '@alice/shared';
import { TradingLoraHyperparamsSchema } from '@alice/shared';
import { loadTrainingEnterpriseConfig } from './training-config.js';
import {
  buildTradingDataEligibilityConditions,
  loadTradingDataGovernancePolicyFromEnv,
  TRADING_DATA_SOURCE_TYPES,
} from './trading-data-governance.js';

const logger = createLogger('lora-job-manager');
const tradingDataGovernancePolicy = loadTradingDataGovernancePolicyFromEnv();

const TRAINING_STORAGE_DIR = process.env.TRAINING_STORAGE_DIR || '/opt/alice/uploads/training';

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

// Modelo base padrão para LoRA (Gate 2): deve bater com o LLM de runtime
const DEFAULT_BASE_MODEL = GPU_MANAGER_CONFIG.models.llm;

// Configuração padrão de hiperparâmetros
const TRADING_HYPERPARAMS_BASE_DEFAULTS: TradingLoraHyperparams = TradingLoraHyperparamsSchema.parse({});
/** Mínimo de exemplos para jobs LoRA (training_data com sourceType trading). Reservado para validação futura. */
const _MIN_DATASET_SIZE = 100;

function toTradingHyperparamsFromEnterprise(
  enterpriseHyperparams: Partial<TradingLoraHyperparams>
): TradingLoraHyperparams {
  return TradingLoraHyperparamsSchema.parse({
    ...TRADING_HYPERPARAMS_BASE_DEFAULTS,
    ...enterpriseHyperparams,
  });
}

function hashSeed(seedText: string): number {
  const digest = createHash('sha256').update(seedText).digest();
  return digest.readUInt32LE(0);
}

function createSeededRandom(seedText: string): () => number {
  let state = hashSeed(seedText) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fisherYatesShuffle<T>(array: T[], randomFn: () => number): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
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
  trainingRowIds: string[];  // IDs usados no split de treino
  validationRowIds: string[]; // IDs usados no split de validação/holdout
  datasetIds: string[];      // IDs de training_data filtrados (trading) - para marcar como usados
  /** IDs de training_data usados (apenas quando source=scheduled_run). Marcar usedInJobId após sucesso. */
  trainingDataIds?: string[];
  stats: {
    total: number;
    training: number;
    validation: number;
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

function renderDatasetSystemPrompt(
  template: string,
  context: {
    assetClass: string;
    marketType: string;
    venue: string;
    riskPolicy: string;
    timeframes: string;
  },
): string {
  const rendered = template
    .replaceAll('{{assetClass}}', context.assetClass)
    .replaceAll('{{marketType}}', context.marketType)
    .replaceAll('{{venue}}', context.venue)
    .replaceAll('{{riskPolicy}}', context.riskPolicy)
    .replaceAll('{{timeframes}}', context.timeframes);
  if (context.assetClass !== 'crypto') {
    return rendered
      .replaceAll('funding', '')
      .replaceAll('open interest', '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  return rendered;
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
  },
  runtime?: {
    datasetMaxRows?: number;
    trainEvalSplitRatio?: number;
    seed?: string;
  }
): Promise<PreparedDataset> {
  const db = getDatabase();
  const trainingConfig = await loadTrainingEnterpriseConfig();
  const datasetMaxRows = runtime?.datasetMaxRows ?? trainingConfig.datasetMaxRows;
  const trainEvalSplitRatio = runtime?.trainEvalSplitRatio ?? trainingConfig.trainEvalSplitRatio;
  const random = createSeededRandom(runtime?.seed ?? `${tenantId}:${namespaceId}:${agentId ?? 'all'}`);

  logger.info({ tenantId, filter, datasetMaxRows, trainEvalSplitRatio }, 'Preparando dataset para treinamento');

  const datasets = await db
    .select()
    .from(schema.trainingData)
    .where(
      and(
        ...buildTradingDataEligibilityConditions({
          tenantId,
          namespaceId,
          policy: tradingDataGovernancePolicy,
        }),
        agentId != null
          ? eq(schema.trainingData.agentId, agentId)
          : sql`1=1`
      )
    )
    .orderBy(desc(schema.trainingData.criadoEm))
    .limit(datasetMaxRows);

  type RowWithAction = { id: string; messages: unknown; sourceMetadata: unknown; qualityScore: number | null; criadoEm: Date | null };
  const withAction = datasets.map((d): RowWithAction & { actionType: string; prompt: string; response: string } => {
    const msgs = (d.messages ?? []) as Array<{ role: string; content: string }>;
    const userMsg = msgs.find((m) => m.role === 'user');
    const assistantMsg = msgs.find((m) => m.role === 'assistant');
    const meta = (d.sourceMetadata ?? {}) as Record<string, unknown>;
    const actionType = (meta.actionType as string) ?? 'signal';
    return {
      ...d,
      actionType,
      prompt: userMsg?.content ?? '',
      response: assistantMsg?.content ?? '',
    } as RowWithAction & { actionType: string; prompt: string; response: string };
  });

  let filtered = withAction;

  if (filter?.minQualityScore) {
    filtered = filtered.filter(
      (d) => d.qualityScore !== null && d.qualityScore >= filter.minQualityScore!
    );
  }

  if (filter?.actionTypes && filter.actionTypes.length > 0) {
    filtered = filtered.filter((d) => filter.actionTypes!.includes(d.actionType));
  }

  if (filter?.fromDate) {
    filtered = filtered.filter(
      (d) => d.criadoEm && d.criadoEm >= filter.fromDate!
    );
  }

  if (filter?.toDate) {
    filtered = filtered.filter(
      (d) => d.criadoEm && d.criadoEm <= filter.toDate!
    );
  }

  const byActionType: Record<string, number> = {};
  for (const d of filtered) {
    byActionType[d.actionType] = (byActionType[d.actionType] || 0) + 1;
  }
  const sortedByDate = [...filtered].sort((a, b) => {
    const aTime = a.criadoEm?.getTime() ?? 0;
    const bTime = b.criadoEm?.getTime() ?? 0;
    return aTime - bTime;
  });
  const dataWindow = {
    from: sortedByDate[0]?.criadoEm ?? null,
    to: sortedByDate[sortedByDate.length - 1]?.criadoEm ?? null,
  };

  const shuffled = fisherYatesShuffle([...filtered], random);
  const splitIndex = Math.floor(shuffled.length * trainEvalSplitRatio);
  const training = shuffled.slice(0, splitIndex);
  const validation = shuffled.slice(splitIndex);

  const datasetProfile = await resolveDatasetProfile(tenantId, namespaceId, agentId);
  const firstMetadata = (filtered[0]?.sourceMetadata ?? {}) as Record<string, unknown>;
  const systemPrompt = renderDatasetSystemPrompt(datasetProfile.systemPromptTemplate, {
    assetClass: String(firstMetadata.assetClass ?? 'crypto'),
    marketType: String(firstMetadata.marketType ?? 'futures'),
    venue: String(firstMetadata.venue ?? 'unknown'),
    riskPolicy: String(firstMetadata.riskPolicy ?? 'strict'),
    timeframes: String(firstMetadata.timeframe ?? '1m,3m,5m'),
  });

  const formatToJsonl = (d: { prompt: string; response: string }): string => {
    const text = [
      `system: ${systemPrompt}`,
      `user: ${d.prompt}`,
      `assistant: ${d.response}`,
    ].join('\n');
    return JSON.stringify({ text });
  };

  const trainingData = training.map(formatToJsonl);
  const validationData = validation.map(formatToJsonl);
  const trainingRowIds = training.map((item) => item.id);
  const validationRowIds = validation.map((item) => item.id);
  const datasetIds = filtered.map((d) => d.id);

  logger.info(
    {
      total: filtered.length,
      training: trainingData.length,
      validation: validationData.length,
      byActionType,
      datasetIdsCount: datasetIds.length,
      datasetMaxRows,
      trainEvalSplitRatio,
    },
    'Dataset preparado com sucesso'
  );

  return {
    trainingData,
    validationData,
    trainingRowIds,
    validationRowIds,
    datasetIds,
    stats: {
      total: filtered.length,
      training: trainingData.length,
      validation: validationData.length,
      byActionType,
      dataWindow,
    },
  };
}
function buildChatMlText(messages: Array<{ role: string; content: string }>): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join('\n');
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
    countOnly?: boolean;
    includeTradingDataset?: boolean;
    agentId?: string | null;
    domain?: string | null;
    datasetMaxRows?: number;
    trainEvalSplitRatio?: number;
    minDatasetSize?: number;
    seed?: string;
  }
): Promise<PreparedDataset> {
  const db = getDatabase();
  const trainingConfig = await loadTrainingEnterpriseConfig();
  const datasetMaxRows = options?.datasetMaxRows ?? trainingConfig.datasetMaxRows;
  const trainEvalSplitRatio = options?.trainEvalSplitRatio ?? trainingConfig.trainEvalSplitRatio;
  const minDatasetSize = options?.minDatasetSize ?? trainingConfig.minScheduledIncremental;
  const includeTradingDataset = options?.includeTradingDataset ?? Boolean(namespaceId);
  const random = createSeededRandom(options?.seed ?? `${tenantId}:${namespaceId ?? 'tenant-wide'}`);

  const chatWhere = and(
    eq(schema.trainingData.status, 'approved'),
    eq(schema.trainingData.tenantId, tenantId),
    isNull(schema.trainingData.usedInJobId),
    not(inArray(schema.trainingData.sourceType, [...TRADING_DATA_SOURCE_TYPES])),
    options?.agentId
      ? or(
          eq(schema.trainingData.agentId, options.agentId),
          eq(schema.trainingData.inferredAgentId, options.agentId)
        )
      : undefined,
    options?.domain
      ? eq(schema.trainingData.inferredDomain, options.domain)
      : undefined,
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
    limit: datasetMaxRows,
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
  let trainingRowIds: string[] = [];
  let validationRowIds: string[] = [];
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

  if (namespaceId && includeTradingDataset) {
    const tradingPrepared = await prepareDataset(
      tenantId,
      namespaceId,
      options?.agentId ?? undefined,
      undefined,
      {
        datasetMaxRows,
        trainEvalSplitRatio,
        seed: `${options?.seed ?? tenantId}:trading`,
      }
    );
    datasetIds = tradingPrepared.datasetIds;

    let tradingIndex = 0;
    for (const line of tradingPrepared.trainingData) {
      const lineId = datasetIds[tradingIndex] ?? `trading-${tradingIndex}`;
      combined.push({ id: lineId, type: 'trading', line });
      tradingIndex += 1;
    }
    for (const line of tradingPrepared.validationData) {
      const lineId = datasetIds[tradingIndex] ?? `trading-${tradingIndex}`;
      combined.push({ id: lineId, type: 'trading', line });
      tradingIndex += 1;
    }

    Object.entries(tradingPrepared.stats.byActionType).forEach(([k, v]) => {
      byActionType[`trading_${k}`] = (byActionType[`trading_${k}`] ?? 0) + v;
    });
  }

  if (combined.length < minDatasetSize) {
    throw new Error(
      `Dataset insuficiente para run agendado: ${combined.length} exemplos. Minimo: ${minDatasetSize}`
    );
  }

  const shuffled = fisherYatesShuffle([...combined], random);
  const splitIndex = Math.floor(shuffled.length * trainEvalSplitRatio);
  const trainPart = shuffled.slice(0, splitIndex);
  const validationPart = shuffled.slice(splitIndex);

  if (!options?.countOnly) {
    trainingData = trainPart.map((p) => p.line);
    validationData = validationPart.map((p) => p.line);
  }
  trainingRowIds = trainPart.map((part) => part.id);
  validationRowIds = validationPart.map((part) => part.id);

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
      datasetMaxRows,
      trainEvalSplitRatio,
      minDatasetSize,
      includeTradingDataset,
    },
    'Dataset chat+trading preparado para run agendado'
  );

  return {
    trainingData,
    validationData,
    trainingRowIds,
    validationRowIds,
    datasetIds,
    trainingDataIds,
    stats,
  };
}
export async function createLoraJob(params: CreateJobParams): Promise<LoraJob> {
  const db = getDatabase();

  const trainingConfig = await loadTrainingEnterpriseConfig();
  const defaultHyperparameters = toTradingHyperparamsFromEnterprise(trainingConfig.defaultHyperparams);

  // Preparar dataset para obter contagens
  const dataset = await prepareDataset(params.tenantId, params.namespaceId, params.agentId, params.datasetFilter);
  const profile = await resolveDatasetProfile(params.tenantId, params.namespaceId, params.agentId);

  const minRequired = params.forceMinSize ? 1 : trainingConfig.minOndemandDatasetSize;
  if (dataset.stats.total < minRequired) {
    throw new Error(
      `Dataset insuficiente: ${dataset.stats.total} exemplos. Mínimo necessário: ${minRequired}${params.forceMinSize ? ' (forçar com poucos exemplos pode prejudicar o modelo)' : ''}`
    );
  }

  // Mesclar hiperparâmetros com defaults
  const hyperparameters: TradingLoraHyperparams = {
    ...defaultHyperparameters,
    ...params.hyperparameters,
  };

  const sortedIds = [...dataset.datasetIds].sort((a, b) => a.localeCompare(b));
  const datasetHash = createHash('sha256').update(sortedIds.join(',')).digest('hex');
  const [datasetVersion] = await db
    .insert(schema.trainingDatasetVersions)
    .values({
      tenantId: params.tenantId,
      namespaceId: params.namespaceId,
      agentId: params.agentId ?? null,
      sourceCounts: dataset.stats.byActionType,
      dataWindow: dataset.stats.dataWindow ?? {},
      profileId: profile.id,
      profileVersion: profile.version,
      hash: datasetHash,
    })
    .returning();

  // Criar job (source: explicit_job = criado via API/UI)
  const jobData: InsertLoraJob = {
    tenantId: params.tenantId,
    scopeType: params.agentId ? 'agent' : 'namespace',
    scopeNamespaceId: params.namespaceId,
    scopeAgentId: params.agentId ?? null,
    profileVersion: params.profileVersion ?? profile.version,
    datasetVersionId: datasetVersion?.id ?? null,
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
    includeTradingDataset: true,
    metrics: {},
  };

  const [job] = await db
    .insert(schema.loraJobs)
    .values(jobData)
    .returning();

  if (datasetVersion) {
    await db.insert(schema.trainingLineageEvents).values([
      {
        tenantId: params.tenantId,
        namespaceId: params.namespaceId,
        eventType: 'dataset_version_created',
        sourceTable: 'training_data',
        sourceId: datasetHash,
        producedTable: 'training_dataset_versions',
        producedId: datasetVersion.id,
        metadata: {
          datasetCount: dataset.datasetIds.length,
          profileVersion: profile.version,
        },
      },
      {
        tenantId: params.tenantId,
        namespaceId: params.namespaceId,
        eventType: 'lora_job_created',
        sourceTable: 'training_dataset_versions',
        sourceId: datasetVersion.id,
        producedTable: 'lora_jobs',
        producedId: job.id,
        metadata: {
          datasetVersionId: datasetVersion.id,
        },
      },
    ]);
  }

  // Usar os IDs dos datasets FILTRADOS (retornados por prepareDataset) - training_data com sourceType trading
  if (dataset.datasetIds.length > 0) {
    await db
      .update(schema.trainingData)
      .set({
        status: 'used',
        usedInJobId: job.id,
      })
      .where(inArray(schema.trainingData.id, dataset.datasetIds));

    logger.info(
      { jobId: job.id, markedAsUsed: dataset.datasetIds.length },
      'training_data (trading) marcados como usados'
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
    includeImages?: boolean;
  }
): Promise<LoraJob> {
  const db = getDatabase();
  const trainingConfig = await loadTrainingEnterpriseConfig();
  const defaultHyperparameters = toTradingHyperparamsFromEnterprise(trainingConfig.defaultHyperparams);

  const includeImages = options?.includeImages ?? false;
  const prepared = await prepareDatasetFromChatAndTrading(
    tenantId,
    options?.namespaceId ?? undefined,
    {
      includeImages,
      countOnly: true,
    }
  );

  const name = options?.namespaceId
    ? `alice-qlora-ns-${options.namespaceId.slice(0, 8)}-v${Date.now().toString(36)}`
    : `alice-qlora-v${Date.now().toString(36)}`;

  const includeTrading = !!options?.namespaceId;
  const jobData: InsertLoraJob = {
    tenantId,
    scopeType: 'namespace',
    scopeNamespaceId: options?.namespaceId ?? null,
    scopeAgentId: null,
    profileVersion: 1,
    source: 'scheduled_run',
    name,
    baseModel: DEFAULT_BASE_MODEL,
    hyperparameters: defaultHyperparameters,
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
  trainingRowIds: string[];
  validationRowIds: string[];
  trainingDataIds: string[];
  datasetIds: string[];
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

export async function processLoraJob(jobId: string, options?: ProcessLoraJobOptions): Promise<void> {
  const db = getDatabase();
  const job = await getJob(jobId);
  if (!job) throw new Error('Job LoRA nao encontrado');
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return;
  const trainingConfig = await loadTrainingEnterpriseConfig();
  const defaultHyperparameters = toTradingHyperparamsFromEnterprise(trainingConfig.defaultHyperparams);

  const sliceSteps = options?.sliceSteps ?? trainingConfig.sliceSteps;
  const gpuTimeoutMs = options?.gpuTimeoutMs ?? trainingConfig.gpuTimeoutMs;
  const datasetMaxRows = options?.datasetMaxRows ?? trainingConfig.datasetMaxRows;
  const trainEvalSplitRatio = options?.trainEvalSplitRatio ?? trainingConfig.trainEvalSplitRatio;
  const minDatasetSize = options?.minDatasetSize ?? trainingConfig.minScheduledIncremental;
  const seed = options?.seed ?? jobId;
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
  const namespaceId = job.scopeNamespaceId;
  const includeImages = options?.includeImages ?? job.includeImages ?? false;
  const includeTradingDataset = options?.includeTradingDataset
    ?? job.includeTradingDataset
    ?? (job.source === 'scheduled_run' ? Boolean(namespaceId) : false);

  const prepared = await prepareDatasetFromChatAndTrading(
    tenantId,
    namespaceId ?? undefined,
    {
      includeImages,
      includeTradingDataset,
      agentId: options?.agentId ?? job.scopeAgentId ?? undefined,
      domain: options?.domain ?? undefined,
      datasetMaxRows,
      trainEvalSplitRatio,
      minDatasetSize,
      seed,
    }
  );

  const jobDir = path.join(TRAINING_STORAGE_DIR, 'trading-lora', tenantId, jobId);
  await ensureDir(jobDir);

  const trainPath = path.join(jobDir, 'train.jsonl');
  const evalPath = path.join(jobDir, 'eval.jsonl');
  const outputDir = path.join(jobDir, 'output');
  await ensureDir(outputDir);

  await writeJsonlFile(trainPath, prepared.trainingData);
  await writeJsonlFile(evalPath, prepared.validationData);
  await options?.onDatasetPrepared?.({
    total: prepared.stats.total,
    training: prepared.stats.training,
    validation: prepared.stats.validation,
    trainingRowIds: prepared.trainingRowIds,
    validationRowIds: prepared.validationRowIds,
    trainingDataIds: prepared.trainingDataIds ?? [],
    datasetIds: prepared.datasetIds,
    imagesUsed: prepared.stats.imagesUsed ?? 0,
  });

  const targetSteps = computeTargetSteps(prepared.stats.training, resolvedHyperparameters);
  const mergedMetrics: TradingLoraMetrics = {
    ...(job.metrics as TradingLoraMetrics),
    imagesUsed: prepared.stats.imagesUsed ?? (job.metrics as TradingLoraMetrics)?.imagesUsed,
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

  if (prepared.trainingDataIds?.length) {
    await db
      .update(schema.trainingData)
      .set({ usedInJobId: jobId, processadoEm: new Date() })
      .where(inArray(schema.trainingData.id, prepared.trainingDataIds));
    logger.info({ jobId, count: prepared.trainingDataIds.length }, 'training_data marcados como usados');
  }
  if (prepared.datasetIds?.length) {
    await db
      .update(schema.trainingData)
      .set({ status: 'used', usedInJobId: jobId })
      .where(inArray(schema.trainingData.id, prepared.datasetIds));
    logger.info({ jobId, count: prepared.datasetIds.length }, 'training_data (trading) marcados como usados');
  }

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
        .set({ isActiveAdapter: false, isActiveByScope: false })
        .where(and(...sameScopeConditions));

      await tx.update(schema.loraJobs)
        .set({
          isActiveAdapter: true,
          isActiveByScope: true,
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
