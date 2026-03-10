import type { Express, Request, Response } from 'express';
import { createLogger } from '@alice/logger';
import { and, desc, eq, getDatabase, schema } from '@alice/database';
import { requirePermission } from '@alice/shared-utils';

type ImmutableAuditIntegrityHealthState = {
  status: 'unknown' | 'ok' | 'error';
  checkedAt: string | null;
  checkedStreams: number;
  brokenStreams: number;
  reason: string | null;
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

interface RegisterTrainingAuditRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  runTrainingImmutableAuditIntegrityCheck: () => Promise<void>;
  getTrainingImmutableAuditIntegrityState: () => ImmutableAuditIntegrityHealthState;
  resolveAuthorizedTenantId: ResolveAuthorizedTenantIdFn;
  isTrainingGovernanceAuditAction: (action: string) => boolean;
}

export function registerTrainingAuditRoutes(
  app: Express,
  deps: RegisterTrainingAuditRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('training-service');

  app.get('/api/training/audit/integrity', requirePermission('training:fine_tuning_jobs:read'), async (req: Request, res: Response) => {
    const force = String(req.query.force ?? '').toLowerCase() === 'true';
    if (force) {
      await deps.runTrainingImmutableAuditIntegrityCheck();
    }
    return res.json({
      stream: 'training_governance',
      state: deps.getTrainingImmutableAuditIntegrityState(),
    });
  });

  app.get('/api/training/audit/high-risk', requirePermission('training:fine_tuning_jobs:read'), async (req: Request, res: Response) => {
    const tenantResolution = deps.resolveAuthorizedTenantId(req);
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }

    const limitParsed = Number(req.query.limit ?? 100);
    if (!Number.isFinite(limitParsed) || !Number.isInteger(limitParsed) || limitParsed < 1 || limitParsed > 200) {
      return res.status(400).json({ error: 'Parâmetro limit inválido (1-200)' });
    }
    const actionParam = typeof req.query.action === 'string' ? req.query.action : undefined;
    if (actionParam && !deps.isTrainingGovernanceAuditAction(actionParam)) {
      return res.status(400).json({ error: 'Parâmetro action inválido' });
    }

    const db = getDatabase();
    const whereClauses = [
      eq(schema.immutableAuditEvents.tenantId, tenantResolution.tenantId),
      eq(schema.immutableAuditEvents.stream, 'training_governance'),
    ];
    if (actionParam) {
      whereClauses.push(eq(schema.immutableAuditEvents.eventType, actionParam));
    }

    const events = await db.query.immutableAuditEvents.findMany({
      where: and(...whereClauses),
      orderBy: [desc(schema.immutableAuditEvents.chainPosition)],
      limit: limitParsed,
    });

    return res.json({
      stream: 'training_governance',
      count: events.length,
      filters: {
        action: actionParam ?? null,
        limit: limitParsed,
      },
      events: events.map((event) => ({
        id: event.id,
        chainPosition: event.chainPosition,
        eventType: event.eventType,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        actorUserId: event.actorUserId,
        requestId: event.requestId,
        payload: event.payload,
        occurredAt: event.occurredAt,
        createdAt: event.createdAt,
      })),
    });
  });

  logger.info('Training audit routes registered');
}
