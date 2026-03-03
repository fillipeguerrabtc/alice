/**
 * Auto-Learning Scheduler - Alice Enterprise Platform
 * 
 * Gate 2 (15/01/2026):
 * Schedule enterprise de aprendizado para uso verticalizado:
 * - RAG update: Tempo real
 * - Auto-indexação: Diário
 * - Fine-tuning incremental (QLoRA - LLM): Semanal (domingo 3:00 AM)
 * - Fine-tuning completo: Quinzenal
 * 
 * Modelo base: LLM (texto) do Gate 2 (deve ser o MESMO do runtime)
 * Método: QLoRA (baixo consumo de VRAM)
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 * 
 * Autor: Fillipe Guerra
 * Data: 11 de Janeiro de 2026
 * 
 * @module training-service/auto-learning-scheduler
 */

import { createLogger } from '@alice/logger';
import { eq, and, or, lt, desc, isNull, inArray, not } from '@alice/database';
import { getAllSystemConfig } from '@alice/database/system-config';
import * as schema from '@alice/shared/schema';
import type { Database } from '@alice/database';
import { GPU_MANAGER_CONFIG } from '@alice/shared-utils';
import { enqueueTrainingFineTuningRun } from './training-fine-tuning-queue.js';

// CORREÇÃO AUDITORIA 17/12/2025: Usar createLogger padronizado da plataforma
// Bug: pino direto com pino-pretty não segue padrão enterprise (Regra 2)
const logger = createLogger('auto-learning-scheduler');

let db: Database;

export function initAutoLearningScheduler(dbClient: Database): void {
  db = dbClient;
  logger.info('Auto-learning scheduler inicializado');
}

// ============================================================================
// CONFIGURAÇÃO DO SCHEDULE - Gate 2 (15/01/2026)
// ============================================================================
// Modelo base: LLM (texto) - SSOT em GPU_MANAGER_CONFIG
// Método: QLoRA (baixo consumo de VRAM)
// GPU: RTX 4000 Ada 20GB (Hetzner GEX44)
// ============================================================================

export const SCHEDULE_CONFIG = {
  ragUpdate: {
    name: 'rag_update',
    description: 'Atualização RAG em tempo real',
    intervalMs: 0,
  },
  autoIndexing: {
    name: 'auto_indexing',
    description: 'Auto-indexação diária',
    intervalMs: 24 * 60 * 60 * 1000,
    cronPattern: '0 3 * * *',
  },
  incrementalFineTuning: {
    name: 'incremental_fine_tuning',
    description: 'Fine-tuning incremental QLoRA semanal (domingo 3:00 AM)',
    intervalMs: 7 * 24 * 60 * 60 * 1000, // 7 dias
    cronPattern: '0 3 * * 0', // Domingo às 3:00 AM
    baseModel: GPU_MANAGER_CONFIG.models.llm,
    method: 'qlora',
  },
  completeFineTuning: {
    name: 'complete_fine_tuning',
    description: 'Fine-tuning completo quinzenal',
    intervalMs: 14 * 24 * 60 * 60 * 1000,
    cronPattern: '0 1 1,15 * *',
    baseModel: GPU_MANAGER_CONFIG.models.llm,
    method: 'qlora',
  },
} as const;

async function resolveScheduledMinDataRequired(scheduleType: string): Promise<number> {
  const config = await getAllSystemConfig();
  const key = scheduleType === 'incremental_fine_tuning'
    ? 'MIN_SCHEDULED_DATASET_SIZE_INCREMENTAL'
    : 'MIN_SCHEDULED_DATASET_SIZE_FULL';
  const raw = config[key];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`system_config invalido para ${key}: "${raw ?? ''}"`);
  }
  return parsed;
}

async function resolveTrainingQualityMinRatio(): Promise<number> {
  const config = await getAllSystemConfig();
  const raw = config.TRAINING_QUALITY_MIN_RATIO;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
    return parsed;
  }
  throw new Error(`system_config invalido para TRAINING_QUALITY_MIN_RATIO: "${raw ?? ''}"`);
}

async function resolveAutoLearningIncludeImages(): Promise<boolean> {
  const config = await getAllSystemConfig();
  const raw = config.AUTO_LEARNING_INCLUDE_IMAGES;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`system_config invalido para AUTO_LEARNING_INCLUDE_IMAGES: "${raw}"`);
}

async function resolveScheduleCronPattern(scheduleType: string): Promise<string> {
  const config = await getAllSystemConfig();
  if (scheduleType === 'incremental_fine_tuning') {
    return config.AUTO_LEARNING_CRON_INCREMENTAL;
  }
  return config.AUTO_LEARNING_CRON_FULL;
}

function calculateNextScheduledDate(scheduleType: string, cronPattern?: string): Date {
  const config = scheduleType === 'incremental_fine_tuning'
    ? SCHEDULE_CONFIG.incrementalFineTuning
    : SCHEDULE_CONFIG.completeFineTuning;

  if (!cronPattern) {
    return new Date(Date.now() + config.intervalMs);
  }

  const parts = cronPattern.trim().split(/\s+/);
  if (parts.length !== 5) {
    logger.warn({ cronPattern, scheduleType }, 'Cron pattern invalido em system_config; usando intervalo padrao');
    return new Date(Date.now() + config.intervalMs);
  }

  const [minute, hour, dayOfMonth, _month, dayOfWeek] = parts;
  const now = new Date();
  const next = new Date(now);
  const targetHour = hour === '*' ? now.getHours() : Number.parseInt(hour, 10);
  const targetMinute = minute === '*' ? 0 : Number.parseInt(minute, 10);

  if (!Number.isFinite(targetHour) || !Number.isFinite(targetMinute)) {
    logger.warn({ cronPattern, scheduleType }, 'Cron pattern invalido (hora/minuto); usando intervalo padrao');
    return new Date(Date.now() + config.intervalMs);
  }

  next.setHours(targetHour, targetMinute, 0, 0);

  if (dayOfWeek !== '*') {
    const targetDay = Number.parseInt(dayOfWeek, 10);
    if (!Number.isFinite(targetDay)) {
      logger.warn({ cronPattern, scheduleType }, 'Cron pattern invalido (dia da semana); usando intervalo padrao');
      return new Date(Date.now() + config.intervalMs);
    }
    let daysUntil = targetDay - now.getDay();
    if (daysUntil < 0 || (daysUntil === 0 && now >= next)) {
      daysUntil += 7;
    }
    next.setDate(now.getDate() + daysUntil);
    return next;
  }

  if (dayOfMonth !== '*') {
    const days = dayOfMonth
      .split(',')
      .map((token) => Number.parseInt(token.trim(), 10))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    if (days.length === 0) {
      logger.warn({ cronPattern, scheduleType }, 'Cron pattern invalido (dia do mes); usando intervalo padrao');
      return new Date(Date.now() + config.intervalMs);
    }

    const currentDay = now.getDate();
    let targetDay = days.find((value) => value > currentDay || (value === currentDay && now < next));
    if (targetDay === undefined) {
      targetDay = days[0];
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
    }

    for (let i = 0; i < 12; i += 1) {
      const daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      if (targetDay <= daysInMonth) break;
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
    }
    next.setDate(targetDay);
    if (next <= now) {
      next.setMonth(next.getMonth() + 1);
      next.setDate(Math.min(targetDay, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
    }
  } else if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

// ============================================================================
// COLETA AUTOMÁTICA DE DADOS
// ============================================================================

interface CollectedData {
  conversationCount: number;
  approvedDataCount: number;
  /** Contagem de exemplos aprovados de trading em training_data (incluídos na coleta/contagem do treino). */
  tradingDataApprovedCount: number;
  approvedImagesCount: number;
  qualityScore: number;
}

/**
 * Coleta dados de treinamento para avaliação e treino on-demand.
 * Quando namespaceId é informado, filtra training_data por namespace_id ou inferred_namespace_id
 * e training_data (sourceType trading) por namespaceId.
 */
export async function collectTrainingData(tenantId?: string, namespaceId?: string): Promise<CollectedData> {
  logger.info({ tenantId, namespaceId }, 'Iniciando coleta automática de dados de treinamento');

  // Alinhado a prepareDatasetFromChatAndTrading: só contar exemplos ainda não usados em job (usedInJobId IS NULL).
  // Excluir sourceType trading (contado separadamente em tradingDataApprovedCount).
  const TRADING_SOURCE_TYPES = ['trading_signal', 'trading_order', 'trading_postmortem', 'trading_demo'] as const;
  const trainingDataWhere = and(
    eq(schema.trainingData.status, 'approved'),
    isNull(schema.trainingData.usedInJobId),
    not(inArray(schema.trainingData.sourceType, [...TRADING_SOURCE_TYPES])),
    tenantId ? eq(schema.trainingData.tenantId, tenantId) : undefined,
    namespaceId
      ? or(
          eq(schema.trainingData.namespaceId, namespaceId),
          eq(schema.trainingData.inferredNamespaceId, namespaceId)
        )
      : undefined
  );

  const approvedData = await db.query.trainingData.findMany({
    where: trainingDataWhere,
  });

  const approvedImages = await db.query.generatedImages.findMany({
    where: and(
      eq(schema.generatedImages.approvedForTraining, true),
      eq(schema.generatedImages.usedInFineTuning, false),
      tenantId ? eq(schema.generatedImages.tenantId, tenantId) : undefined
    ),
  });

  // training_data (sourceType trading) aprovados: contagem para coleta/contagem do treino.
  // Alinhado a prepareDatasetFromChatAndTrading: trading só é incluído quando namespaceId é informado;
  // sem namespace, contar trading faria avaliação "proceed" mas o job usaria só chat → "Dataset insuficiente".
  const tradingWhere = and(
    eq(schema.trainingData.status, 'approved'),
    eq(schema.trainingData.isDuplicate, false),
    inArray(schema.trainingData.sourceType, [...TRADING_SOURCE_TYPES]),
    tenantId ? eq(schema.trainingData.tenantId, tenantId) : undefined,
    namespaceId ? eq(schema.trainingData.namespaceId, namespaceId) : undefined
  );
  const tradingApproved = namespaceId
    ? await db.query.trainingData.findMany({
        where: tradingWhere,
        columns: { id: true },
      })
    : [];
  const tradingDataApprovedCount = tradingApproved.length;

  const highRatedData = approvedData.filter((d: typeof schema.trainingData.$inferSelect) =>
    (d.rating || 0) >= 4
  );

  const qualityScore = approvedData.length > 0
    ? highRatedData.length / approvedData.length
    : 0;

  const result: CollectedData = {
    conversationCount: approvedData.length,
    approvedDataCount: approvedData.length,
    tradingDataApprovedCount,
    approvedImagesCount: approvedImages.length,
    qualityScore,
  };

  logger.info(result, 'Coleta de dados concluída');
  return result;
}

// ============================================================================
// AVALIAÇÃO DE QUALIDADE
// ============================================================================

interface QualityEvaluation {
  isReady: boolean;
  dataCount: number;
  imageCount: number;
  qualityScore: number;
  recommendation: 'proceed' | 'wait' | 'skip';
  reason: string;
}

/**
 * Quando true (ex.: jobs agendados), o threshold de "dados suficientes" usa apenas
 * training_data aprovados (approvedDataCount). Trading dataset NÃO é obrigatório para rodar.
 */
export async function evaluateDataQuality(
  scheduleType: string,
  tenantId?: string,
  customMinDataRequired?: number, // FIX: Permitir threshold customizado configurado pelo usuário
  namespaceId?: string,
  useOnlyTrainingDataForMinCount?: boolean
): Promise<QualityEvaluation> {
  const data = await collectTrainingData(tenantId, namespaceId);

  // Total de exemplos considerados: training_data aprovados + trading (training_data sourceType) aprovados
  const totalDataCount = data.approvedDataCount + data.tradingDataApprovedCount;
  // Para jobs agendados: threshold apenas em training_data (universal; trading não obrigatório)
  const countForMin = useOnlyTrainingDataForMinCount ? data.approvedDataCount : totalDataCount;

  const minData = customMinDataRequired ?? await resolveScheduledMinDataRequired(scheduleType);
  const qualityMinRatio = await resolveTrainingQualityMinRatio();

  if (countForMin < minData) {
    return {
      isReady: false,
      dataCount: totalDataCount,
      imageCount: data.approvedImagesCount,
      qualityScore: data.qualityScore,
      recommendation: 'wait',
      reason: useOnlyTrainingDataForMinCount
        ? `Dados de chat insuficientes: ${data.approvedDataCount}/${minData} necessários (trading não conta para jobs agendados)`
        : `Dados insuficientes: ${totalDataCount}/${minData} necessários (training_data: ${data.approvedDataCount}, trading: ${data.tradingDataApprovedCount})`,
    };
  }

  if (data.qualityScore < qualityMinRatio) {
    return {
      isReady: false,
      dataCount: totalDataCount,
      imageCount: data.approvedImagesCount,
      qualityScore: data.qualityScore,
      recommendation: 'skip',
      reason: `Qualidade baixa: ${(data.qualityScore * 100).toFixed(1)}% dos dados com rating >= 4 (minimo ${(qualityMinRatio * 100).toFixed(1)}%)`,
    };
  }

  return {
    isReady: true,
    dataCount: totalDataCount,
    imageCount: data.approvedImagesCount,
    qualityScore: data.qualityScore,
    recommendation: 'proceed',
    reason: `Dados suficientes e qualidade adequada`,
  };
}

// ============================================================================
// PROGRESSIVE LORA
// ============================================================================

interface ProgressiveLoRAResult {
  /** Job LoRA criado (source=scheduled_run). Fonte de verdade para runs agendados/on-demand. */
  loraJobId: string;
  /** Compatibilidade legada; preferir loraJobId. */
  modelVersionId: string | null;
  version: number;
  trainingDataUsed: number;
  imagesUsed: number;
  status: 'started' | 'failed';
}

/**
 * Inicia Progressive LoRA para run agendado/on-demand.
 * Cria apenas lora_jobs (source=scheduled_run); não grava em model_versions.
 * O caller deve enfileirar o fine_tuning_jobs correspondente na TRAINING_FINE_TUNING_QUEUE.
 */
export async function startProgressiveLoRA(
  tenantId: string,
  options?: {
    includeImages?: boolean;
    baseModelVersion?: number;
    namespaceId?: string;
  }
): Promise<ProgressiveLoRAResult> {
  logger.info({ tenantId, options }, 'Iniciando Progressive LoRA (lora_jobs)');

  const { createScheduledRunLoraJob } = await import('./lora-job-manager.js');
  const job = await createScheduledRunLoraJob(tenantId, {
    namespaceId: options?.namespaceId ?? null,
    includeImages: options?.includeImages,
  });

  const trainingDataUsed = job.datasetCount ?? 0;
  const validationCount = job.validationCount ?? 0;
  const imagesUsed = (job.metrics as { imagesUsed?: number } | null)?.imagesUsed ?? 0;

  logger.info({
    loraJobId: job.id,
    trainingData: trainingDataUsed,
    validation: validationCount,
    imagesUsed,
  }, 'Job LoRA scheduled_run criado para Progressive LoRA');

  return {
    loraJobId: job.id,
    modelVersionId: null,
    version: 0,
    trainingDataUsed: trainingDataUsed + validationCount,
    imagesUsed,
    status: 'started',
  };
}

// ============================================================================
// COMPARAÇÃO COM BASELINE E ROLLBACK
// ============================================================================

interface MetricsComparison {
  improved: boolean;
  improvementPercent: number;
  metrics: {
    current: Record<string, number>;
    baseline: Record<string, number>;
  };
  shouldRollback: boolean;
  rollbackReason?: string;
}

export async function compareWithBaseline(
  modelVersionId: string
): Promise<MetricsComparison> {
  const modelVersion = await db.query.modelVersions.findFirst({
    where: eq(schema.modelVersions.id, modelVersionId),
  });

  if (!modelVersion) {
    throw new Error('Versão de modelo não encontrada');
  }

  const currentMetrics = modelVersion.metrics as Record<string, number> || {};
  const baselineMetrics = modelVersion.baselineMetrics as Record<string, number> || {};

  const currentScore = currentMetrics.accuracy || currentMetrics.f1Score || 0;
  const baselineScore = baselineMetrics.accuracy || baselineMetrics.f1Score || 0;

  const improvementPercent = baselineScore > 0
    ? ((currentScore - baselineScore) / baselineScore) * 100
    : 0;

  const shouldRollback = improvementPercent < -5;

  const result: MetricsComparison = {
    improved: improvementPercent > 0,
    improvementPercent,
    metrics: {
      current: currentMetrics,
      baseline: baselineMetrics,
    },
    shouldRollback,
    rollbackReason: shouldRollback 
      ? `Degradação de ${Math.abs(improvementPercent).toFixed(1)}% detectada`
      : undefined,
  };

  logger.info({ modelVersionId, ...result }, 'Comparação com baseline concluída');
  return result;
}

export async function rollbackToVersion(
  tenantId: string,
  targetVersion: number,
  reason: string
): Promise<void> {
  logger.warn({ tenantId, targetVersion, reason }, 'Iniciando rollback de modelo');

  await db.update(schema.modelVersions)
    .set({ isActive: false })
    .where(eq(schema.modelVersions.tenantId, tenantId));

  await db.update(schema.modelVersions)
    .set({ 
      isActive: true,
      status: 'active',
      ativadoEm: new Date(),
    })
    .where(and(
      eq(schema.modelVersions.tenantId, tenantId),
      eq(schema.modelVersions.version, targetVersion)
    ));

  const latestVersion = await db.query.modelVersions.findFirst({
    where: eq(schema.modelVersions.tenantId, tenantId),
    orderBy: [desc(schema.modelVersions.version)],
  });

  if (latestVersion) {
    await db.update(schema.modelVersions)
      .set({
        status: 'rolled_back',
        rolledBackReason: reason,
        deprecadoEm: new Date(),
      })
      .where(eq(schema.modelVersions.id, latestVersion.id));
  }

  logger.info({ tenantId, targetVersion }, 'Rollback concluído');
}

// ============================================================================
// SCHEDULING
// ============================================================================

export async function scheduleNextRun(
  scheduleType: string,
  tenantId?: string
): Promise<string> {
  const cronPattern = await resolveScheduleCronPattern(scheduleType);
  const scheduledFor = calculateNextScheduledDate(scheduleType, cronPattern);

  const [schedule] = await db.insert(schema.autoLearningSchedule).values({
    tenantId,
    scheduleType,
    status: 'scheduled',
    scheduledFor,
  }).returning();

  logger.info({
    scheduleId: schedule.id,
    scheduleType,
    scheduledFor,
  }, 'Próxima execução agendada');

  return schedule.id;
}

export async function getScheduleStatus(tenantId?: string) {
  const schedules = await db.query.autoLearningSchedule.findMany({
    where: tenantId ? eq(schema.autoLearningSchedule.tenantId, tenantId) : undefined,
    orderBy: [desc(schema.autoLearningSchedule.scheduledFor)],
    limit: 20,
  });

  const pending = schedules.filter((s: typeof schema.autoLearningSchedule.$inferSelect) => 
    s.status === 'scheduled' && s.scheduledFor && new Date(s.scheduledFor) > new Date()
  );

  return {
    total: schedules.length,
    pending: pending.length,
    schedules,
  };
}

export async function processScheduledJobs(): Promise<number> {
  const now = new Date();
  const includeImagesDefault = await resolveAutoLearningIncludeImages();
  
  const dueJobs = await db.query.autoLearningSchedule.findMany({
    where: and(
      eq(schema.autoLearningSchedule.status, 'scheduled'),
      lt(schema.autoLearningSchedule.scheduledFor, now)
    ),
  });

  let processedCount = 0;

  for (const job of dueJobs) {
    try {
      await db.update(schema.autoLearningSchedule)
        .set({ status: 'running', startedAt: now })
        .where(eq(schema.autoLearningSchedule.id, job.id));

      // FIX: Ler minDataRequired do metadata (se configurado pelo usuário)
      const customMinDataRequired = (job.metadata as { minDataRequired?: number } | null)?.minDataRequired;
      const evaluation = await evaluateDataQuality(
        job.scheduleType,
        job.tenantId || undefined,
        customMinDataRequired,
        undefined,
        true
      );

      if (evaluation.recommendation === 'proceed' && job.tenantId) {
        const result = await startProgressiveLoRA(job.tenantId, {
          includeImages: includeImagesDefault,
        });
        await db.update(schema.loraJobs)
          .set({
            description: `scheduled:${job.scheduleType}`,
          })
          .where(eq(schema.loraJobs.id, result.loraJobId));

        const [fineTuningJob] = await db.insert(schema.fineTuningJobs).values({
          tenantId: job.tenantId,
          name: `Treinamento agendado ${job.scheduleType}`,
          baseModel: GPU_MANAGER_CONFIG.models.llm,
          status: 'pending',
          runSource: 'scheduled',
          trainingDataCount: evaluation.dataCount,
          loraJobId: result.loraJobId,
          configSnapshot: {
            runSource: 'scheduled',
            scheduleId: job.id,
            scheduleType: job.scheduleType,
            evaluation,
            includeImages: includeImagesDefault,
            scheduleMetadata: job.metadata ?? {},
          },
          evaluationStatus: 'pending',
          promotionStatus: 'candidate',
        }).returning({ id: schema.fineTuningJobs.id });

        const enqueueResult = await enqueueTrainingFineTuningRun({
          fineTuningJobId: fineTuningJob.id,
          tenantId: job.tenantId,
        });

        await db.update(schema.autoLearningSchedule)
          .set({
            loraJobId: result.loraJobId,
            dataCollected: result.trainingDataUsed,
            imagesCollected: result.imagesUsed,
            status: 'completed',
            completedAt: new Date(),
            errorMessage: null,
          })
          .where(eq(schema.autoLearningSchedule.id, job.id));

        await scheduleNextRun(job.scheduleType, job.tenantId || undefined);
        logger.info({
          scheduleId: job.id,
          fineTuningJobId: fineTuningJob.id,
          loraJobId: result.loraJobId,
          enqueued: enqueueResult.enqueued,
        }, 'Job agendado criado e enfileirado');
        processedCount++;
      } else {
        await db.update(schema.autoLearningSchedule)
          .set({
            status: 'skipped',
            completedAt: new Date(),
            errorMessage: evaluation.reason,
          })
          .where(eq(schema.autoLearningSchedule.id, job.id));

        await scheduleNextRun(job.scheduleType, job.tenantId || undefined);
      }
    } catch (error) {
      logger.error({ error, jobId: job.id }, 'Erro ao processar job agendado');
      
      await db.update(schema.autoLearningSchedule)
        .set({
          status: 'failed',
          completedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : 'Erro desconhecido',
        })
        .where(eq(schema.autoLearningSchedule.id, job.id));
    }
  }

  if (processedCount > 0) {
    logger.info({ processedCount }, 'Jobs agendados processados');
  }

  return processedCount;
}

// ============================================================================
// ESTATÍSTICAS
// ============================================================================

export async function getAutoLearningStats(tenantId?: string) {
  const scheduleStatus = await getScheduleStatus(tenantId);

  const lastSchedule = await db.query.autoLearningSchedule.findFirst({
    where: and(
      eq(schema.autoLearningSchedule.status, 'completed'),
      tenantId ? eq(schema.autoLearningSchedule.tenantId, tenantId) : undefined
    ),
    orderBy: [desc(schema.autoLearningSchedule.completedAt)],
    columns: { loraJobId: true, dataCollected: true, imagesCollected: true },
  });

  let lastTrainingData = lastSchedule?.dataCollected ?? 0;
  const lastImageData = lastSchedule?.imagesCollected ?? 0;
  let activeModelName = 'baseline';

  if (lastSchedule?.loraJobId) {
    const loraJob = await db.query.loraJobs.findFirst({
      where: eq(schema.loraJobs.id, lastSchedule.loraJobId),
      columns: { name: true, datasetCount: true, isActiveByScope: true },
    });
    if (loraJob) {
      activeModelName = loraJob.name ?? 'lora';
      if (loraJob.datasetCount != null) lastTrainingData = loraJob.datasetCount;
    }
  }

  const modelVersions = await db.query.modelVersions.findMany({
    where: tenantId ? eq(schema.modelVersions.tenantId, tenantId) : undefined,
    orderBy: [desc(schema.modelVersions.version)],
  });
  const activeVersion = modelVersions.find((v: typeof schema.modelVersions.$inferSelect) => v.isActive);

  return {
    totalVersions: modelVersions.length,
    activeVersion: activeVersion?.version || 0,
    activeModelName: lastSchedule?.loraJobId ? activeModelName : (activeVersion?.name || 'baseline'),
    scheduledJobs: scheduleStatus.pending,
    lastTrainingData,
    lastImageData,
    improvementPercent: activeVersion?.improvementPercent || 0,
    lastLoraJobId: lastSchedule?.loraJobId ?? null,
  };
}


