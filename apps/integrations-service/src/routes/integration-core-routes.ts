import type { Express, Request, Response } from 'express';
import { getDatabase, schema } from '@alice/database';
import { createLogger } from '@alice/logger';
import { extractAuthContext, requirePermission } from '@alice/shared-utils';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

type IntegrationHealthStatusLike = {
  configured: boolean;
  operational: boolean;
  error?: string;
  details?: Record<string, unknown>;
};

type ImmutableAuditIntegrityStateLike = {
  status: string;
  [key: string]: unknown;
};

interface RegisterIntegrationCoreRoutesDeps {
  logger?: ReturnType<typeof createLogger>;
  refreshIntegrationHealthMetrics: () => Promise<Record<string, IntegrationHealthStatusLike>>;
  integrationsImmutableAuditIntegrityState: ImmutableAuditIntegrityStateLike;
  runIntegrationsImmutableAuditIntegrityCheck: () => Promise<void>;
  getWiseCircuitBreakerStatus: () => unknown;
}

function isTradingHighRiskEventType(eventType: string): boolean {
  const normalized = eventType.toLowerCase();
  return normalized.includes('approve')
    || normalized.includes('reject')
    || normalized.includes('risk')
    || normalized.includes('override');
}

export function registerIntegrationCoreRoutes(
  app: Express,
  deps: RegisterIntegrationCoreRoutesDeps,
): void {
  const logger = deps.logger ?? createLogger('integrations-service');

  app.get('/api/integrations/health', requirePermission('integrations:integrations:read'), (_req: Request, res: Response) => {
    deps.refreshIntegrationHealthMetrics()
      .then((services) => {
        const stripeHealth = services.stripe ?? { configured: false, operational: false };
        const wiseHealth = services.wise ?? { configured: false, operational: false };
        const twilioHealth = services.twilio ?? { configured: false, operational: false };
        const emailHealth = services.email ?? { configured: false, operational: false };
        const openAiVisionHealth = services.openai_vision ?? { configured: false, operational: false };
        const tradingHealth = services.trading ?? { configured: false, operational: false };
        const overallStatus = deps.integrationsImmutableAuditIntegrityState.status === 'error' ? 'degraded' : 'ok';
        res.json({
          status: overallStatus,
          service: 'integrations-service',
          version: process.env.APP_VERSION ?? null,
          timestamp: new Date().toISOString(),
          services,
          integrations: {
            stripe: stripeHealth.configured,
            wise: wiseHealth.configured,
            twilio: twilioHealth.configured,
            email: emailHealth.configured,
            openaiVision: openAiVisionHealth.configured,
            trading: tradingHealth.configured,
          },
          circuitBreakers: {
            wise: wiseHealth.configured ? deps.getWiseCircuitBreakerStatus() : null,
            trading: tradingHealth.details?.circuitBreaker ?? null,
          },
          immutableAuditIntegrity: deps.integrationsImmutableAuditIntegrityState,
        });
      })
      .catch((error) => {
        logger.error({ error }, 'Falha ao calcular integrações/health');
        res.status(500).json({ error: 'Falha ao verificar integrações' });
      });
  });

  app.get('/api/integrations/trading/audit/integrity', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    const force = String(req.query.force ?? '').toLowerCase() === 'true';
    if (force) {
      await deps.runIntegrationsImmutableAuditIntegrityCheck();
    }
    res.json({
      stream: 'trading_operations',
      state: deps.integrationsImmutableAuditIntegrityState,
    });
  });

  app.get('/api/integrations/trading/audit/high-risk', requirePermission('integrations:trading:read'), async (req: Request, res: Response) => {
    const authContext = extractAuthContext(req);
    if (!authContext?.tenantId || !authContext?.userId) {
      return res.status(401).json({ error: 'Autenticação necessária' });
    }
    const dbInstance = getDatabase();

    const limitParsed = Number(req.query.limit ?? 100);
    if (!Number.isFinite(limitParsed) || !Number.isInteger(limitParsed) || limitParsed < 1 || limitParsed > 200) {
      return res.status(400).json({ error: 'Parâmetro limit inválido (1-200)' });
    }
    const actionParam = typeof req.query.action === 'string' ? req.query.action : undefined;
    if (actionParam && !isTradingHighRiskEventType(actionParam)) {
      return res.status(400).json({ error: 'Parâmetro action não é classificado como alto risco' });
    }

    const whereClauses = [
      eq(schema.immutableAuditEvents.tenantId, authContext.tenantId),
      eq(schema.immutableAuditEvents.stream, 'trading_operations'),
    ];
    if (actionParam) {
      whereClauses.push(eq(schema.immutableAuditEvents.eventType, actionParam));
    }

    const rawEvents = await dbInstance.query.immutableAuditEvents.findMany({
      where: and(...whereClauses),
      orderBy: [desc(schema.immutableAuditEvents.chainPosition)],
      limit: actionParam ? limitParsed : Math.min(500, limitParsed * 4),
    });
    const events = (actionParam
      ? rawEvents
      : rawEvents.filter((event: typeof rawEvents[number]) => isTradingHighRiskEventType(event.eventType)))
      .slice(0, limitParsed);

    return res.json({
      stream: 'trading_operations',
      count: events.length,
      filters: {
        action: actionParam ?? null,
        limit: limitParsed,
      },
      events: events.map((event: typeof events[number]) => ({
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

  app.get('/api/integrations/stats', requirePermission('integrations:integrations:read'), async (req: Request, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      logger.warn({ userId: req.user?.userId }, 'Tentativa de acesso a integrations/stats sem tenantId');
      return res.status(403).json({ error: 'Acesso negado: usuário não associado a um tenant' });
    }

    try {
      const db = getDatabase();

      const [stripeRevenueRow] = await db
        .select({
          total: sql<number>`coalesce(sum(((${schema.webhookEvents.payload} -> 'data' -> 'object' ->> 'amount_total')::numeric)), 0)`,
          currency: sql<string>`max((${schema.webhookEvents.payload} -> 'data' -> 'object' ->> 'currency'))`,
        })
        .from(schema.webhookEvents)
        .where(and(
          eq(schema.webhookEvents.source, 'stripe'),
          eq(schema.webhookEvents.eventType, 'checkout.session.completed'),
          eq(schema.webhookEvents.processed, true),
          eq(schema.webhookEvents.tenantId, tenantId),
        ));

      const [stripeTransactionsRow] = await db
        .select({ total: sql<number>`count(*)` })
        .from(schema.webhookEvents)
        .where(and(
          eq(schema.webhookEvents.source, 'stripe'),
          eq(schema.webhookEvents.eventType, 'checkout.session.completed'),
          eq(schema.webhookEvents.processed, true),
          eq(schema.webhookEvents.tenantId, tenantId),
        ));

      const [wiseTotalRow] = await db
        .select({ total: sql<number>`count(*)` })
        .from(schema.wiseTransfers)
        .where(eq(schema.wiseTransfers.tenantId, tenantId));

      const [wiseCompletedRow] = await db
        .select({ total: sql<number>`count(*)` })
        .from(schema.wiseTransfers)
        .where(and(
          eq(schema.wiseTransfers.tenantId, tenantId),
          inArray(schema.wiseTransfers.status, ['completed', 'outgoing_payment_sent']),
        ));

      const [wisePendingRow] = await db
        .select({ total: sql<number>`coalesce(sum(${schema.wiseTransfers.sourceValue}), 0)` })
        .from(schema.wiseTransfers)
        .where(and(
          eq(schema.wiseTransfers.tenantId, tenantId),
          inArray(schema.wiseTransfers.status, ['pending', 'incoming_payment_waiting', 'processing']),
        ));

      const stripeCurrency = stripeRevenueRow?.currency ? stripeRevenueRow.currency.toUpperCase() : 'EUR';

      res.json({
        stripe: {
          totalRevenue: Number(stripeRevenueRow?.total ?? 0) / 100,
          transactions: Number(stripeTransactionsRow?.total ?? 0),
          currency: stripeCurrency,
        },
        wise: {
          totalTransfers: Number(wiseTotalRow?.total ?? 0),
          pendingAmount: Number(wisePendingRow?.total ?? 0),
          completedCount: Number(wiseCompletedRow?.total ?? 0),
        },
      });
    } catch (error) {
      logger.error({ error, tenantId }, 'Erro ao calcular integrations/stats');
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  });
}
