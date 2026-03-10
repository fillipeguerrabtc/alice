import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, asc, desc, eq, getDatabase, isNull, schema, sql } from '@alice/database';
import { requirePermission } from '@alice/shared-utils';
import { z } from 'zod';

type TrainingDataGovernancePolicy = {
  requireStrictApprovedDataForAutoEngine: boolean;
  enforceMinInferenceConfidence: boolean;
  minInferenceConfidence: number;
};

interface TenantResolutionSuccess {
  ok: true;
  tenantId: string;
}

interface TenantResolutionError {
  ok: false;
  status: number;
  error: string;
}

type ResolveAuthorizedTenantIdFn = (
  req: Request,
  requestedTenantId?: string | null,
) => TenantResolutionSuccess | TenantResolutionError;

type TrainingRuntimeConfig = {
  minOndemandDatasetSize: number;
  minScheduledDatasetSizeIncremental: number;
  minScheduledDatasetSizeFull: number;
};

type TrainingGovernanceRuntimeConfig = {
  maxInflightRunsPerTenant: number;
  requireEvalPassedForPromotion: boolean;
  requireApprovalGatesForPromotion: boolean;
  requireDualApprovalForPromotion: boolean;
  promotionMinApprovals: number;
};

interface RegisterTrainingRuntimeRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  resolveAuthorizedTenantId: ResolveAuthorizedTenantIdFn;
  readScheduleScopeMetadata: (raw: unknown) => { namespaceId?: string | null };
  loadTrainingSystemRuntimeConfig: () => Promise<TrainingRuntimeConfig>;
  loadTrainingGovernanceRuntimeConfig: () => Promise<TrainingGovernanceRuntimeConfig>;
  getFineTuningQueuesStatus: () => Promise<Array<Record<string, unknown>>>;
  getTenantInflightFineTuningJobsCount: (tenantId: string) => Promise<number>;
  getTradingDataGovernancePolicy: () => TrainingDataGovernancePolicy;
  trainingRunStartRequireIdempotencyKey: boolean;
}

const autoLearningStatusQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

const trainingStatsQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

const trainingExecutionModesQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

const queueStatusQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

export function registerTrainingRuntimeRoutes(
  app: Express,
  deps: RegisterTrainingRuntimeRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('training-service');

  app.get('/api/training/auto-learning/status', requirePermission('training:training_data:read'), async (req: Request, res: Response) => {
    const queryResult = autoLearningStatusQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({ error: 'Parametros invalidos', details: queryResult.error.format() });
    }
    const { tenantId } = queryResult.data;

    try {
      const tenantResolution = deps.resolveAuthorizedTenantId(req, tenantId);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }
      const db = getDatabase();
      const scopedTenantId = tenantResolution.tenantId;

      const modelVersions = await db.query.modelVersions.findMany({
        where: eq(schema.modelVersions.tenantId, scopedTenantId),
        orderBy: [desc(schema.modelVersions.version)],
        limit: 10,
      });

      const activeVersion = modelVersions.find((version) => version.isActive);

      const schedules = await db.query.autoLearningSchedule.findMany({
        where: and(
          eq(schema.autoLearningSchedule.tenantId, scopedTenantId),
          eq(schema.autoLearningSchedule.status, 'scheduled'),
        ),
        orderBy: [asc(schema.autoLearningSchedule.scheduledFor)],
        limit: 20,
      });

      const pendingData = await db.select({ count: sql<number>`count(*)` })
        .from(schema.trainingData)
        .where(and(
          eq(schema.trainingData.status, 'approved'),
          isNull(schema.trainingData.usedInJobId),
          eq(schema.trainingData.tenantId, scopedTenantId),
        ));

      const pendingImages = await db.select({ count: sql<number>`count(*)` })
        .from(schema.generatedImages)
        .where(and(
          eq(schema.generatedImages.approvedForTraining, true),
          eq(schema.generatedImages.usedInFineTuning, false),
          eq(schema.generatedImages.tenantId, scopedTenantId),
        ));

      return res.json({
        activeModel: {
          version: activeVersion?.version || 0,
          name: activeVersion?.name || 'baseline',
          improvementPercent: activeVersion?.improvementPercent || 0,
          trainingDataUsed: activeVersion?.trainingDataCount || 0,
          imagesUsed: activeVersion?.imageDataCount || 0,
        },
        pendingData: {
          trainingEntries: pendingData[0]?.count || 0,
          images: pendingImages[0]?.count || 0,
        },
        recentVersions: modelVersions.slice(0, 5).map((version) => ({
          version: version.version,
          status: version.status,
          namespaceId: version.namespaceId ?? null,
          agentId: version.agentId ?? null,
          createdAt: version.criadoEm,
        })),
        upcomingSchedules: schedules
          .filter((schedule) => new Date(schedule.scheduledFor).getTime() > Date.now())
          .map((schedule) => ({
            id: schedule.id,
            type: schedule.scheduleType,
            scheduledFor: schedule.scheduledFor,
            status: schedule.status,
            namespaceId: deps.readScheduleScopeMetadata(schedule.metadata).namespaceId ?? null,
          })),
      });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter status do auto-learning');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.get('/api/training/execution-modes', requirePermission('training:training_data:read'), async (req: Request, res: Response) => {
    const queryResult = trainingExecutionModesQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({ error: 'Parametros invalidos', details: queryResult.error.format() });
    }

    try {
      const tenantResolution = deps.resolveAuthorizedTenantId(req, queryResult.data.tenantId ?? null);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }

      const [runtimeConfig, governanceConfig] = await Promise.all([
        deps.loadTrainingSystemRuntimeConfig(),
        deps.loadTrainingGovernanceRuntimeConfig(),
      ]);
      const tradingDataGovernancePolicy = deps.getTradingDataGovernancePolicy();

      return res.json({
        tenantId: tenantResolution.tenantId,
        modes: [
          {
            id: 'quick_run',
            runSource: 'on_demand',
            endpoint: '/api/training/run/start',
            scope: 'tenant_or_namespace',
            trigger: 'manual_immediate',
            datasetPolicy: {
              source: 'training_data_approved',
              minApprovedData: runtimeConfig.minOndemandDatasetSize,
            },
            hyperparametersPolicy: 'runtime_defaults',
            schedulePolicy: 'none',
          },
          {
            id: 'advanced_job',
            runSource: 'custom_job',
            endpoint: '/api/training/jobs',
            scope: 'namespace_required',
            trigger: 'manual_immediate',
            datasetPolicy: {
              source: 'training_data_approved_by_namespace',
              minApprovedData: runtimeConfig.minOndemandDatasetSize,
            },
            hyperparametersPolicy: 'preset_with_overrides',
            schedulePolicy: 'none',
          },
          {
            id: 'auto_schedule',
            runSource: 'scheduled',
            endpoint: '/api/training/schedule/configure',
            scope: 'tenant_or_namespace',
            trigger: 'cron_recurring',
            datasetPolicy: {
              source: 'training_data_approved_by_scope',
              minApprovedDataIncremental: runtimeConfig.minScheduledDatasetSizeIncremental,
              minApprovedDataFull: runtimeConfig.minScheduledDatasetSizeFull,
            },
            hyperparametersPolicy: 'runtime_defaults',
            schedulePolicy: 'cron_configurable',
          },
        ],
        governance: {
          maxInflightRunsPerTenant: governanceConfig.maxInflightRunsPerTenant,
          requireEvalPassedForPromotion: governanceConfig.requireEvalPassedForPromotion,
          requireApprovalGatesForPromotion: governanceConfig.requireApprovalGatesForPromotion,
          requireDualApprovalForPromotion: governanceConfig.requireDualApprovalForPromotion,
          promotionMinApprovals: governanceConfig.promotionMinApprovals,
          requireIdempotencyKeyForRunStart: deps.trainingRunStartRequireIdempotencyKey,
          requireStrictApprovedDataForAutoEngine: tradingDataGovernancePolicy.requireStrictApprovedDataForAutoEngine,
          enforceMinInferenceConfidence: tradingDataGovernancePolicy.enforceMinInferenceConfidence,
          tradingMinInferenceConfidence: tradingDataGovernancePolicy.minInferenceConfidence,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter modos de execucao de treinamento');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.get('/api/training/stats', requirePermission('training:training_data:read'), async (req: Request, res: Response) => {
    const queryResult = trainingStatsQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({ error: 'Parametros invalidos', details: queryResult.error.format() });
    }
    const { tenantId } = queryResult.data;

    try {
      const tenantResolution = deps.resolveAuthorizedTenantId(req, tenantId);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }
      const db = getDatabase();
      const scopedTenantId = tenantResolution.tenantId;

      const pendingCount = await db.select({ count: sql<number>`count(*)` })
        .from(schema.trainingData)
        .where(and(
          eq(schema.trainingData.status, 'pending'),
          eq(schema.trainingData.tenantId, scopedTenantId),
        ));

      const approvedCount = await db.select({ count: sql<number>`count(*)` })
        .from(schema.trainingData)
        .where(and(
          eq(schema.trainingData.status, 'approved'),
          eq(schema.trainingData.tenantId, scopedTenantId),
        ));

      const duplicatesCount = await db.select({ count: sql<number>`count(*)` })
        .from(schema.trainingData)
        .where(and(
          eq(schema.trainingData.isDuplicate, true),
          eq(schema.trainingData.tenantId, scopedTenantId),
        ));

      const completedJobs = await db.select({ count: sql<number>`count(*)` })
        .from(schema.fineTuningJobs)
        .where(and(
          eq(schema.fineTuningJobs.status, 'completed'),
          eq(schema.fineTuningJobs.tenantId, scopedTenantId),
        ));

      return res.json({
        trainingData: {
          pending: pendingCount[0]?.count || 0,
          approved: approvedCount[0]?.count || 0,
          duplicatesFiltered: duplicatesCount[0]?.count || 0,
        },
        jobs: {
          completed: completedJobs[0]?.count || 0,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter estatisticas');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  app.get('/api/training/queue/status', requirePermission('training:fine_tuning_jobs:read'), async (req: Request, res: Response) => {
    const queryResult = queueStatusQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({ error: 'Parametros invalidos' });
    }

    try {
      const tenantResolution = deps.resolveAuthorizedTenantId(req, queryResult.data.tenantId ?? null);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }

      const [governanceConfig, queues, inflightCount] = await Promise.all([
        deps.loadTrainingGovernanceRuntimeConfig(),
        deps.getFineTuningQueuesStatus(),
        deps.getTenantInflightFineTuningJobsCount(tenantResolution.tenantId),
      ]);
      const tradingDataGovernancePolicy = deps.getTradingDataGovernancePolicy();

      return res.json({
        queues,
        governance: {
          maxInflightRunsPerTenant: governanceConfig.maxInflightRunsPerTenant,
          requireEvalPassedForPromotion: governanceConfig.requireEvalPassedForPromotion,
          requireApprovalGatesForPromotion: governanceConfig.requireApprovalGatesForPromotion,
          requireDualApprovalForPromotion: governanceConfig.requireDualApprovalForPromotion,
          promotionMinApprovals: governanceConfig.promotionMinApprovals,
          requireIdempotencyKeyForRunStart: deps.trainingRunStartRequireIdempotencyKey,
          requireStrictApprovedDataForAutoEngine: tradingDataGovernancePolicy.requireStrictApprovedDataForAutoEngine,
          enforceMinInferenceConfidence: tradingDataGovernancePolicy.enforceMinInferenceConfidence,
          tradingMinInferenceConfidence: tradingDataGovernancePolicy.minInferenceConfidence,
        },
        tenant: {
          id: tenantResolution.tenantId,
          inflightCount,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Falha ao obter status das filas de fine-tuning');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  logger.info('Training runtime routes registered');
}
