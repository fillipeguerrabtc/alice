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
import { eq, and, lt, desc, isNull } from '@alice/database';
import * as schema from '@alice/shared/schema';
import type { Database } from '@alice/database';
import { GPU_MANAGER_CONFIG } from '@alice/shared-utils';

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
    minDataRequired: 50,
    baseModel: GPU_MANAGER_CONFIG.models.llm,
    method: 'qlora',
  },
  completeFineTuning: {
    name: 'complete_fine_tuning',
    description: 'Fine-tuning completo quinzenal',
    intervalMs: 14 * 24 * 60 * 60 * 1000,
    cronPattern: '0 1 1,15 * *',
    minDataRequired: 200,
    baseModel: GPU_MANAGER_CONFIG.models.llm,
    method: 'qlora',
  },
} as const;

// ============================================================================
// COLETA AUTOMÁTICA DE DADOS
// ============================================================================

interface CollectedData {
  conversationCount: number;
  approvedDataCount: number;
  approvedImagesCount: number;
  qualityScore: number;
}

export async function collectTrainingData(tenantId?: string): Promise<CollectedData> {
  logger.info({ tenantId }, 'Iniciando coleta automática de dados de treinamento');

  const approvedData = await db.query.trainingData.findMany({
    where: and(
      eq(schema.trainingData.status, 'approved'),
      tenantId ? eq(schema.trainingData.tenantId, tenantId) : undefined
    ),
  });

  const approvedImages = await db.query.generatedImages.findMany({
    where: and(
      eq(schema.generatedImages.approvedForTraining, true),
      eq(schema.generatedImages.usedInFineTuning, false),
      tenantId ? eq(schema.generatedImages.tenantId, tenantId) : undefined
    ),
  });

  const highRatedData = approvedData.filter((d: typeof schema.trainingData.$inferSelect) => 
    (d.rating || 0) >= 4
  );

  const qualityScore = approvedData.length > 0
    ? highRatedData.length / approvedData.length
    : 0;

  const result = {
    conversationCount: approvedData.length,
    approvedDataCount: approvedData.length,
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

export async function evaluateDataQuality(
  scheduleType: string,
  tenantId?: string,
  customMinDataRequired?: number // FIX: Permitir threshold customizado configurado pelo usuário
): Promise<QualityEvaluation> {
  const data = await collectTrainingData(tenantId);
  
  // FIX: Usar minDataRequired customizado se fornecido, senão usar default do SCHEDULE_CONFIG
  const defaultMinData = scheduleType === 'incremental_fine_tuning' 
    ? SCHEDULE_CONFIG.incrementalFineTuning.minDataRequired
    : SCHEDULE_CONFIG.completeFineTuning.minDataRequired;
  
  const minData = customMinDataRequired ?? defaultMinData;

  if (data.approvedDataCount < minData) {
    return {
      isReady: false,
      dataCount: data.approvedDataCount,
      imageCount: data.approvedImagesCount,
      qualityScore: data.qualityScore,
      recommendation: 'wait',
      reason: `Dados insuficientes: ${data.approvedDataCount}/${minData} necessários`,
    };
  }

  if (data.qualityScore < 0.5) {
    return {
      isReady: false,
      dataCount: data.approvedDataCount,
      imageCount: data.approvedImagesCount,
      qualityScore: data.qualityScore,
      recommendation: 'skip',
      reason: `Qualidade baixa: ${(data.qualityScore * 100).toFixed(1)}% dos dados com rating >= 4`,
    };
  }

  return {
    isReady: true,
    dataCount: data.approvedDataCount,
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
  modelVersionId: string;
  version: number;
  trainingDataUsed: number;
  imagesUsed: number;
  status: 'started' | 'failed';
}

export async function startProgressiveLoRA(
  tenantId: string,
  options?: {
    includeImages?: boolean;
    baseModelVersion?: number;
  }
): Promise<ProgressiveLoRAResult> {
  logger.info({ tenantId, options }, 'Iniciando Progressive LoRA');

  const latestVersion = await db.query.modelVersions.findFirst({
    where: and(
      eq(schema.modelVersions.tenantId, tenantId),
      eq(schema.modelVersions.isActive, true)
    ),
    orderBy: [desc(schema.modelVersions.version)],
  });

  const newVersion = (latestVersion?.version || 0) + 1;

  const approvedData = await db.query.trainingData.findMany({
    where: and(
      eq(schema.trainingData.status, 'approved'),
      eq(schema.trainingData.tenantId, tenantId),
      isNull(schema.trainingData.usedInJobId)
    ),
    limit: 1000,
  });

  let approvedImages: Array<typeof schema.generatedImages.$inferSelect> = [];
  if (options?.includeImages) {
    approvedImages = await db.query.generatedImages.findMany({
      where: and(
        eq(schema.generatedImages.approvedForTraining, true),
        eq(schema.generatedImages.usedInFineTuning, false),
        eq(schema.generatedImages.tenantId, tenantId)
      ),
      limit: 500,
    });
  }

  // Gate 2: QLoRA para o MESMO modelo base do LLM
  const [modelVersion] = await db.insert(schema.modelVersions).values({
    tenantId,
    name: `alice-qlora-v${newVersion}`,
    version: newVersion,
    baseModel: GPU_MANAGER_CONFIG.models.llm,
    status: 'training',
    trainingDataCount: approvedData.length,
    imageDataCount: approvedImages.length,
    baselineMetrics: latestVersion?.metrics || {},
  }).returning();

  logger.info({
    modelVersionId: modelVersion.id,
    version: newVersion,
    trainingData: approvedData.length,
    images: approvedImages.length,
  }, 'Nova versão de modelo criada para Progressive LoRA');

  return {
    modelVersionId: modelVersion.id,
    version: newVersion,
    trainingDataUsed: approvedData.length,
    imagesUsed: approvedImages.length,
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
  const config = scheduleType === 'incremental_fine_tuning'
    ? SCHEDULE_CONFIG.incrementalFineTuning
    : SCHEDULE_CONFIG.completeFineTuning;

  const scheduledFor = new Date(Date.now() + config.intervalMs);

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
      const evaluation = await evaluateDataQuality(job.scheduleType, job.tenantId || undefined, customMinDataRequired);

      if (evaluation.recommendation === 'proceed' && job.tenantId) {
        const result = await startProgressiveLoRA(job.tenantId, {
          includeImages: true,
        });

        await db.update(schema.autoLearningSchedule)
          .set({
            status: 'completed',
            completedAt: new Date(),
            modelVersionId: result.modelVersionId,
            dataCollected: result.trainingDataUsed,
            imagesCollected: result.imagesUsed,
          })
          .where(eq(schema.autoLearningSchedule.id, job.id));

        await scheduleNextRun(job.scheduleType, job.tenantId || undefined);
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
  const modelVersions = await db.query.modelVersions.findMany({
    where: tenantId ? eq(schema.modelVersions.tenantId, tenantId) : undefined,
    orderBy: [desc(schema.modelVersions.version)],
  });

  const activeVersion = modelVersions.find((v: typeof schema.modelVersions.$inferSelect) => v.isActive);
  const scheduleStatus = await getScheduleStatus(tenantId);

  return {
    totalVersions: modelVersions.length,
    activeVersion: activeVersion?.version || 0,
    activeModelName: activeVersion?.name || 'baseline',
    scheduledJobs: scheduleStatus.pending,
    lastTrainingData: activeVersion?.trainingDataCount || 0,
    lastImageData: activeVersion?.imageDataCount || 0,
    improvementPercent: activeVersion?.improvementPercent || 0,
  };
}
