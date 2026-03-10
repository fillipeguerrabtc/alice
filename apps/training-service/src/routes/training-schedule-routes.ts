import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, desc, eq, getDatabase, inArray, schema } from '@alice/database';
import { requirePermission } from '@alice/shared-utils';
import { z } from 'zod';

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
  autoLearningCronIncremental: string;
  autoLearningCronFull: string;
};

type TrainingEnterpriseConfig = {
  minScheduledIncremental: number;
  minScheduledFull: number;
};

type ScheduleConfig = {
  incrementalFineTuning: {
    intervalMs: number;
  };
  completeFineTuning: {
    intervalMs: number;
  };
};

interface RegisterTrainingScheduleRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  resolveAuthorizedTenantId: ResolveAuthorizedTenantIdFn;
  findNamespaceByIdInTenant: (tenantId: string, namespaceId: string) => Promise<unknown>;
  loadTrainingSystemRuntimeConfig: () => Promise<TrainingRuntimeConfig>;
  loadTrainingEnterpriseConfig: () => Promise<TrainingEnterpriseConfig>;
  isSameScheduleScope: (metadata: unknown, namespaceId: string | null) => boolean;
  scheduleConfig: ScheduleConfig;
}

const scheduleConfigSchema = z.object({
  tenantId: z.string().uuid(),
  scheduleType: z.enum(['incremental_fine_tuning', 'complete_fine_tuning']),
  enabled: z.boolean().default(true),
  cronPattern: z.string().optional(),
  minDataRequired: z.number().int().min(1).optional(),
  namespaceId: z.string().uuid().optional().nullable(),
});

function calculateNextScheduleDate(
  scheduleType: 'incremental_fine_tuning' | 'complete_fine_tuning',
  scheduleConfig: ScheduleConfig,
  logger: ReturnType<typeof createLogger>,
  cronPattern?: string,
): Date {
  const config = scheduleType === 'incremental_fine_tuning'
    ? scheduleConfig.incrementalFineTuning
    : scheduleConfig.completeFineTuning;

  if (!cronPattern) {
    return new Date(Date.now() + config.intervalMs);
  }

  const parts = cronPattern.trim().split(/\s+/);
  if (parts.length !== 5) {
    logger.warn({ cronPattern }, 'Cron pattern invalido, usando intervalo padrao');
    return new Date(Date.now() + config.intervalMs);
  }

  const [minute, hour, dayOfMonth, _month, dayOfWeek] = parts;
  const now = new Date();
  const next = new Date(now);

  const targetHour = hour === '*' ? now.getHours() : parseInt(hour, 10);
  const targetMinute = minute === '*' ? 0 : parseInt(minute, 10);
  next.setHours(targetHour, targetMinute, 0, 0);

  if (dayOfWeek !== '*') {
    const targetDay = parseInt(dayOfWeek, 10);
    let daysUntil = targetDay - now.getDay();

    if (daysUntil < 0 || (daysUntil === 0 && now >= next)) {
      daysUntil += 7;
    }
    next.setDate(now.getDate() + daysUntil);
  } else if (dayOfMonth !== '*') {
    const days = dayOfMonth
      .split(',')
      .map((day) => parseInt(day.trim(), 10))
      .sort((a, b) => a - b);
    const currentDay = now.getDate();

    let targetDayOfMonth = days.find((day) => day > currentDay || (day === currentDay && now < next));

    if (targetDayOfMonth === undefined) {
      targetDayOfMonth = days[0];
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
    }

    const getDaysInMonth = (date: Date): number => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

    for (let index = 0; index < 12; index++) {
      const daysInMonth = getDaysInMonth(next);
      if (targetDayOfMonth <= daysInMonth) {
        break;
      }
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
    }

    next.setDate(targetDayOfMonth);
  } else if (now >= next) {
    next.setDate(next.getDate() + 1);
  }

  logger.debug({ cronPattern, nextSchedule: next.toISOString() }, 'Proximo schedule calculado');
  return next;
}

export function registerTrainingScheduleRoutes(
  app: Express,
  deps: RegisterTrainingScheduleRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('training-service');

  app.post('/api/training/schedule/configure', requirePermission('training:training_data:manage'), async (req: Request, res: Response) => {
    const parseResult = scheduleConfigSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Input invalido', details: parseResult.error.format() });
    }

    const { tenantId, scheduleType, enabled, cronPattern, minDataRequired, namespaceId } = parseResult.data;

    try {
      const tenantResolution = deps.resolveAuthorizedTenantId(req, tenantId);
      if (!tenantResolution.ok) {
        return res.status(tenantResolution.status).json({ error: tenantResolution.error });
      }
      const db = getDatabase();
      const scopedTenantId = tenantResolution.tenantId;
      const scheduleNamespaceId = namespaceId ?? null;

      if (scheduleNamespaceId) {
        const namespace = await deps.findNamespaceByIdInTenant(scopedTenantId, scheduleNamespaceId);
        if (!namespace) {
          return res.status(403).json({ error: 'Namespace nao pertence ao tenant autenticado' });
        }
      }

      const [trainingRuntimeConfig, trainingEnterpriseConfig] = await Promise.all([
        deps.loadTrainingSystemRuntimeConfig(),
        deps.loadTrainingEnterpriseConfig(),
      ]);

      const resolvedMinDataRequired = minDataRequired
        ?? (
          scheduleType === 'incremental_fine_tuning'
            ? trainingEnterpriseConfig.minScheduledIncremental
            : trainingEnterpriseConfig.minScheduledFull
        );

      const activeSchedules = await db.query.autoLearningSchedule.findMany({
        where: and(
          eq(schema.autoLearningSchedule.tenantId, scopedTenantId),
          eq(schema.autoLearningSchedule.scheduleType, scheduleType),
          eq(schema.autoLearningSchedule.status, 'scheduled'),
        ),
        orderBy: [desc(schema.autoLearningSchedule.criadoEm)],
      });

      const schedulesForScope = activeSchedules.filter((item) => deps.isSameScheduleScope(item.metadata, scheduleNamespaceId));
      const existing = schedulesForScope[0];
      const duplicatedScheduleIds = schedulesForScope.slice(1).map((item) => item.id);

      if (!enabled) {
        if (schedulesForScope.length === 0) {
          return res.json({ success: true, action: 'no_change', scheduleId: null });
        }

        await db.update(schema.autoLearningSchedule)
          .set({
            status: 'skipped',
            completedAt: new Date(),
            errorMessage: null,
          })
          .where(inArray(schema.autoLearningSchedule.id, schedulesForScope.map((item) => item.id)));

        logger.info({
          tenantId: scopedTenantId,
          scheduleType,
          namespaceId: scheduleNamespaceId,
          affectedSchedules: schedulesForScope.length,
        }, 'Schedule de treinamento desabilitado para escopo');

        return res.json({
          success: true,
          action: 'disabled',
          scheduleId: existing?.id ?? null,
          disabledCount: schedulesForScope.length,
        });
      }

      const scheduleMetadata = {
        minDataRequired: resolvedMinDataRequired,
        cronPattern: cronPattern
          ?? (
            scheduleType === 'incremental_fine_tuning'
              ? trainingRuntimeConfig.autoLearningCronIncremental
              : trainingRuntimeConfig.autoLearningCronFull
          ),
        namespaceId: scheduleNamespaceId,
        configuredAt: new Date().toISOString(),
      };

      if (existing) {
        const scheduledFor = calculateNextScheduleDate(
          scheduleType,
          deps.scheduleConfig,
          logger,
          scheduleMetadata.cronPattern ?? undefined,
        );

        await db.update(schema.autoLearningSchedule)
          .set({
            scheduledFor,
            status: 'scheduled',
            metadata: scheduleMetadata,
            errorMessage: null,
          })
          .where(eq(schema.autoLearningSchedule.id, existing.id));

        if (duplicatedScheduleIds.length > 0) {
          await db.update(schema.autoLearningSchedule)
            .set({
              status: 'skipped',
              completedAt: new Date(),
              errorMessage: 'Schedule duplicado desativado por reconciliacao de escopo',
            })
            .where(inArray(schema.autoLearningSchedule.id, duplicatedScheduleIds));
        }

        logger.info({
          tenantId: scopedTenantId,
          scheduleType,
          namespaceId: scheduleNamespaceId,
          scheduledFor,
          scheduleId: existing.id,
          minDataRequired: resolvedMinDataRequired,
          skippedDuplicates: duplicatedScheduleIds.length,
        }, 'Schedule de treinamento atualizado');

        return res.json({
          success: true,
          action: 'updated',
          scheduleId: existing.id,
          scheduledFor,
          minDataRequired: resolvedMinDataRequired,
          skippedDuplicates: duplicatedScheduleIds.length,
        });
      }

      const scheduledFor = calculateNextScheduleDate(
        scheduleType,
        deps.scheduleConfig,
        logger,
        scheduleMetadata.cronPattern ?? undefined,
      );

      const [newSchedule] = await db.insert(schema.autoLearningSchedule).values({
        tenantId: scopedTenantId,
        scheduleType,
        status: 'scheduled',
        scheduledFor,
        metadata: scheduleMetadata,
      }).returning();

      logger.info({
        tenantId: scopedTenantId,
        scheduleType,
        namespaceId: scheduleNamespaceId,
        scheduledFor,
        scheduleId: newSchedule.id,
        minDataRequired: resolvedMinDataRequired,
      }, 'Schedule de treinamento configurado');

      return res.json({
        success: true,
        action: 'scheduled',
        scheduleId: newSchedule.id,
        scheduledFor,
        minDataRequired: resolvedMinDataRequired,
      });
    } catch (error) {
      logger.error({ error }, 'Falha ao configurar schedule de treinamento');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });

  logger.info('Training schedule routes registered');
}
