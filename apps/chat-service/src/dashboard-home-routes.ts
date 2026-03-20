import type { Express, Request, RequestHandler, Response } from 'express';
import { eq, sql } from '@alice/database';
import { getDatabase, schema } from '@alice/database';
import { checkPermission, humanizeAuditActivity, type Role } from '@alice/shared-utils';
import { z } from 'zod';

type LoggerLike = {
  error: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
};

type BuildInternalServiceHeaders = (params: {
  userId: string;
  tenantId: string;
  role: Role;
  customRoleId?: string | null;
}) => Record<string, string>;

type DashboardHomeRouteParams = {
  app: Express;
  logger: LoggerLike;
  requireAuth: () => RequestHandler;
  buildInternalServiceHeaders: BuildInternalServiceHeaders;
  observabilityServiceUrl: string | null;
  trainingServiceUrl: string;
  integrationsServiceUrl: string;
};

type DashboardStatsResponse = {
  conversations: number;
  documents: number;
  trainingData: number;
  tokensUsed: number;
  trend: {
    conversations: number;
    documents: number;
    trainingData: number;
    tokensUsed: number;
  };
};

type UsagePoint = {
  date: string;
  conversations: number;
  tokens: number;
};

type ConversationTrendPoint = {
  date: string;
  label: string;
  ai: number;
  human: number;
};

type TokensTrendPoint = {
  date: string;
  label: string;
  total: number;
};

type RecentActivityItem = {
  id: string;
  title: string;
  description: string;
  category: 'conversation' | 'document' | 'training' | 'routing' | 'governance' | 'integration' | 'system';
  severity: 'info' | 'success' | 'warning' | 'critical';
  href: string | null;
  actor: string;
  timestamp: string | null;
};

type TrainingQueueStatusResponse = {
  queues?: Array<{
    queue?: string;
    pending?: number;
    lag?: number;
    dlq?: number;
  }>;
  tenant?: {
    inflightCount?: number;
  };
  governance?: {
    maxInflightRunsPerTenant?: number;
  };
};

type ObservabilityServicesResponse = {
  services?: Array<{
    name?: string;
    status?: 'healthy' | 'unhealthy' | 'unknown';
    avgLatency?: number;
  }>;
};

type ObservabilityBreakersResponse = {
  breakers?: Array<{
    name?: string;
    status?: 'open' | 'half-open' | 'closed';
    failures?: number;
    successRate?: number;
  }>;
};

type ObservabilitySlaResponse = {
  breachedCount?: number;
  atRiskCount?: number;
  onTrackCount?: number;
  avgFirstResponseTime?: number;
  avgResolutionTime?: number;
};

type IntegrationsStatsResponse = {
  stripe?: {
    totalRevenue?: number;
    transactions?: number;
    currency?: string;
  };
  wise?: {
    totalTransfers?: number;
    pendingAmount?: number;
    completedCount?: number;
  };
};

const tenantScopeQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
});

function calcTrend(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return Math.round(((current - previous) / previous) * 100);
}

function getWeekdayLabel(dateIso: string): string {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  return date.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' });
}

function sliceTail<T>(items: T[], count: number): T[] {
  return items.slice(Math.max(0, items.length - count));
}

async function fetchInternalJson<T>(params: {
  url: string;
  headers: Record<string, string>;
  logger: LoggerLike;
  label: string;
}): Promise<T | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(params.url, {
      headers: params.headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      params.logger.warn({ url: params.url, status: response.status }, `Falha ao consultar ${params.label}`);
      return null;
    }

    return (await response.json()) as T;
  } catch (error) {
    params.logger.warn(
      { error: error instanceof Error ? error.message : String(error), url: params.url },
      `Erro ao consultar ${params.label}`,
    );
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function resolveTenantId(req: Request): string | null {
  const query = tenantScopeQuerySchema.safeParse(req.query);
  if (!query.success) {
    return null;
  }

  const userRole = req.user?.role as Role | undefined;
  const requestTenantId = typeof req.tenantId === 'string' && req.tenantId.trim().length > 0
    ? req.tenantId
    : null;

  if (requestTenantId) {
    return requestTenantId;
  }

  if (userRole === 'super_admin' && query.data.tenantId) {
    return query.data.tenantId;
  }

  return null;
}

async function loadDashboardStats(tenantId: string): Promise<DashboardStatsResponse> {
  const db = getDatabase();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [
    conversationRows,
    documentRows,
    trainingRows,
    tokenRows,
  ] = await Promise.all([
    db.execute(sql<{
      total: number;
      current7d: number;
      previous7d: number;
    }>`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE ${schema.conversations.criadoEm} >= ${weekAgo})::int AS "current7d",
        count(*) FILTER (
          WHERE ${schema.conversations.criadoEm} >= ${twoWeeksAgo}
            AND ${schema.conversations.criadoEm} < ${weekAgo}
        )::int AS "previous7d"
      FROM ${schema.conversations}
      WHERE ${schema.conversations.tenantId} = ${tenantId}
    `),
    db.execute(sql<{
      total: number;
      current7d: number;
      previous7d: number;
    }>`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE ${schema.documents.criadoEm} >= ${weekAgo})::int AS "current7d",
        count(*) FILTER (
          WHERE ${schema.documents.criadoEm} >= ${twoWeeksAgo}
            AND ${schema.documents.criadoEm} < ${weekAgo}
        )::int AS "previous7d"
      FROM ${schema.documents}
      INNER JOIN ${schema.namespaces}
        ON ${schema.namespaces.id} = ${schema.documents.namespaceId}
      WHERE ${schema.namespaces.tenantId} = ${tenantId}
    `),
    db.execute(sql<{
      total: number;
      current7d: number;
      previous7d: number;
    }>`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE ${schema.trainingData.criadoEm} >= ${weekAgo})::int AS "current7d",
        count(*) FILTER (
          WHERE ${schema.trainingData.criadoEm} >= ${twoWeeksAgo}
            AND ${schema.trainingData.criadoEm} < ${weekAgo}
        )::int AS "previous7d"
      FROM ${schema.trainingData}
      WHERE ${schema.trainingData.tenantId} = ${tenantId}
    `),
    db.execute(sql<{
      total: number;
      current7d: number;
      previous7d: number;
    }>`
      SELECT
        COALESCE(sum(${schema.messages.tokensUsados}), 0)::int AS total,
        COALESCE(
          sum(${schema.messages.tokensUsados}) FILTER (WHERE ${schema.messages.criadoEm} >= ${weekAgo}),
          0
        )::int AS "current7d",
        COALESCE(
          sum(${schema.messages.tokensUsados}) FILTER (
            WHERE ${schema.messages.criadoEm} >= ${twoWeeksAgo}
              AND ${schema.messages.criadoEm} < ${weekAgo}
          ),
          0
        )::int AS "previous7d"
      FROM ${schema.messages}
      INNER JOIN ${schema.conversations}
        ON ${schema.conversations.id} = ${schema.messages.conversationId}
      WHERE ${schema.conversations.tenantId} = ${tenantId}
    `),
  ]);

  const conversationRow = conversationRows.rows[0];
  const documentRow = documentRows.rows[0];
  const trainingRow = trainingRows.rows[0];
  const tokenRow = tokenRows.rows[0];

  return {
    conversations: Number(conversationRow?.total ?? 0),
    documents: Number(documentRow?.total ?? 0),
    trainingData: Number(trainingRow?.total ?? 0),
    tokensUsed: Number(tokenRow?.total ?? 0),
    trend: {
      conversations: calcTrend(Number(conversationRow?.current7d ?? 0), Number(conversationRow?.previous7d ?? 0)),
      documents: calcTrend(Number(documentRow?.current7d ?? 0), Number(documentRow?.previous7d ?? 0)),
      trainingData: calcTrend(Number(trainingRow?.current7d ?? 0), Number(trainingRow?.previous7d ?? 0)),
      tokensUsed: calcTrend(Number(tokenRow?.current7d ?? 0), Number(tokenRow?.previous7d ?? 0)),
    },
  };
}

async function loadUsageSeries(tenantId: string, days: number): Promise<UsagePoint[]> {
  const db = getDatabase();
  const endDate = new Date();
  endDate.setHours(0, 0, 0, 0);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (days - 1));
  const endExclusive = new Date(endDate);
  endExclusive.setDate(endExclusive.getDate() + 1);

  const result = await db.execute(sql<{
    date: string;
    conversations: number;
    tokens: number;
  }>`
    WITH day_series AS (
      SELECT generate_series(${startDate}::date, ${endDate}::date, interval '1 day')::date AS bucket
    ),
    conversation_counts AS (
      SELECT
        date_trunc('day', ${schema.conversations.criadoEm})::date AS bucket,
        count(*)::int AS total
      FROM ${schema.conversations}
      WHERE ${schema.conversations.tenantId} = ${tenantId}
        AND ${schema.conversations.criadoEm} >= ${startDate}
        AND ${schema.conversations.criadoEm} < ${endExclusive}
      GROUP BY 1
    ),
    token_counts AS (
      SELECT
        date_trunc('day', ${schema.messages.criadoEm})::date AS bucket,
        COALESCE(sum(${schema.messages.tokensUsados}), 0)::int AS total
      FROM ${schema.messages}
      INNER JOIN ${schema.conversations}
        ON ${schema.conversations.id} = ${schema.messages.conversationId}
      WHERE ${schema.conversations.tenantId} = ${tenantId}
        AND ${schema.messages.criadoEm} >= ${startDate}
        AND ${schema.messages.criadoEm} < ${endExclusive}
      GROUP BY 1
    )
    SELECT
      to_char(day_series.bucket, 'YYYY-MM-DD') AS date,
      COALESCE(conversation_counts.total, 0)::int AS conversations,
      COALESCE(token_counts.total, 0)::int AS tokens
    FROM day_series
    LEFT JOIN conversation_counts ON conversation_counts.bucket = day_series.bucket
    LEFT JOIN token_counts ON token_counts.bucket = day_series.bucket
    ORDER BY day_series.bucket ASC
  `);

  return result.rows.map((row) => ({
    date: String(row.date),
    conversations: Number(row.conversations ?? 0),
    tokens: Number(row.tokens ?? 0),
  }));
}

async function loadConversationTrendSeries(tenantId: string, days: number): Promise<ConversationTrendPoint[]> {
  const db = getDatabase();
  const endDate = new Date();
  endDate.setHours(0, 0, 0, 0);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (days - 1));
  const endExclusive = new Date(endDate);
  endExclusive.setDate(endExclusive.getDate() + 1);

  const result = await db.execute(sql<{
    date: string;
    ai: number;
    human: number;
  }>`
    WITH day_series AS (
      SELECT generate_series(${startDate}::date, ${endDate}::date, interval '1 day')::date AS bucket
    ),
    classified_conversations AS (
      SELECT
        date_trunc('day', ${schema.conversations.criadoEm})::date AS bucket,
        CASE
          WHEN ${schema.conversationStates.controlMode} IN ('human', 'pending_handoff')
            OR ${schema.conversationStates.assignedAgentId} IS NOT NULL
          THEN 'human'
          ELSE 'ai'
        END AS mode,
        count(*)::int AS total
      FROM ${schema.conversations}
      LEFT JOIN ${schema.conversationStates}
        ON ${schema.conversationStates.conversationId} = ${schema.conversations.id}
      WHERE ${schema.conversations.tenantId} = ${tenantId}
        AND ${schema.conversations.criadoEm} >= ${startDate}
        AND ${schema.conversations.criadoEm} < ${endExclusive}
      GROUP BY 1, 2
    )
    SELECT
      to_char(day_series.bucket, 'YYYY-MM-DD') AS date,
      COALESCE(sum(classified_conversations.total) FILTER (WHERE classified_conversations.mode = 'ai'), 0)::int AS ai,
      COALESCE(sum(classified_conversations.total) FILTER (WHERE classified_conversations.mode = 'human'), 0)::int AS human
    FROM day_series
    LEFT JOIN classified_conversations
      ON classified_conversations.bucket = day_series.bucket
    GROUP BY day_series.bucket
    ORDER BY day_series.bucket ASC
  `);

  return result.rows.map((row) => ({
    date: String(row.date),
    label: getWeekdayLabel(String(row.date)),
    ai: Number(row.ai ?? 0),
    human: Number(row.human ?? 0),
  }));
}

async function loadTokensTrendSeries(tenantId: string, days: number): Promise<TokensTrendPoint[]> {
  const usageSeries = await loadUsageSeries(tenantId, days);
  return usageSeries.map((point) => ({
    date: point.date,
    label: getWeekdayLabel(point.date),
    total: point.tokens,
  }));
}

async function loadRecentActivity(tenantId: string, limit: number): Promise<RecentActivityItem[]> {
  const db = getDatabase();
  const recentAudit = await db.query.auditLogs.findMany({
    where: eq(schema.auditLogs.tenantId, tenantId),
    orderBy: (logs, { desc: orderDesc }) => [orderDesc(logs.criadoEm)],
    limit,
    with: {
      user: {
        columns: {
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
  });

  return recentAudit.map((log) => {
    const activity = humanizeAuditActivity({
      action: log.acao,
      resource: log.recurso,
      resourceId: log.recursoId,
      details: (log.detalhes as Record<string, unknown> | null) ?? null,
    });
    const actorName = `${log.user?.firstName ?? ''} ${log.user?.lastName ?? ''}`.trim() || log.user?.email || 'Sistema';

    return {
      id: log.id,
      title: activity.title,
      description: activity.description,
      category: activity.category,
      severity: activity.severity,
      href: activity.href,
      actor: actorName,
      timestamp: log.criadoEm instanceof Date
        ? log.criadoEm.toISOString()
        : (typeof log.criadoEm === 'string' ? log.criadoEm : null),
    };
  });
}

async function loadFallbackSummary(tenantId: string): Promise<{
  total: number;
  last24h: number;
  last7d: number;
  unmappedContexts: number;
  reviewQueue: number;
}> {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const reviewReasons = ['low_confidence_semantic_routing', 'high_risk_route', 'exception_require_human_review'] as const;

  const [totalRow, last24hRow, last7dRow, unmappedRow, reviewQueueRow] = await Promise.all([
    getDatabase().execute(sql<{ total: number }>`
      SELECT count(*)::int AS total
      FROM ${schema.llmFallbackLogs}
      WHERE ${schema.llmFallbackLogs.tenantId} = ${tenantId}
    `),
    getDatabase().execute(sql<{ total: number }>`
      SELECT count(*)::int AS total
      FROM ${schema.llmFallbackLogs}
      WHERE ${schema.llmFallbackLogs.tenantId} = ${tenantId}
        AND ${schema.llmFallbackLogs.criadoEm} >= ${last24h}
    `),
    getDatabase().execute(sql<{ total: number }>`
      SELECT count(*)::int AS total
      FROM ${schema.llmFallbackLogs}
      WHERE ${schema.llmFallbackLogs.tenantId} = ${tenantId}
        AND ${schema.llmFallbackLogs.criadoEm} >= ${last7d}
    `),
    getDatabase().execute(sql<{ total: number }>`
      SELECT count(*)::int AS total
      FROM ${schema.llmFallbackLogs}
      WHERE ${schema.llmFallbackLogs.tenantId} = ${tenantId}
        AND ${schema.llmFallbackLogs.criadoEm} >= ${last7d}
        AND ${schema.llmFallbackLogs.motivoFallback} = 'namespace_unmapped'
    `),
    getDatabase().execute(sql<{ total: number }>`
      SELECT count(*)::int AS total
      FROM ${schema.llmFallbackLogs}
      WHERE ${schema.llmFallbackLogs.tenantId} = ${tenantId}
        AND ${schema.llmFallbackLogs.criadoEm} >= ${new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)}
        AND ${schema.llmFallbackLogs.motivoFallback} IN (${sql.join(reviewReasons.map((reason) => sql`${reason}`), sql`, `)})
    `),
  ]);

  return {
    total: Number(totalRow.rows[0]?.total ?? 0),
    last24h: Number(last24hRow.rows[0]?.total ?? 0),
    last7d: Number(last7dRow.rows[0]?.total ?? 0),
    unmappedContexts: Number(unmappedRow.rows[0]?.total ?? 0),
    reviewQueue: Number(reviewQueueRow.rows[0]?.total ?? 0),
  };
}

async function loadTakeoverSummary(tenantId: string): Promise<{
  pendingHandoffs: number;
  urgentHandoffs: number;
  activeHumanAgents: number;
}> {
  const db = getDatabase();
  const urgentThreshold = new Date();
  urgentThreshold.setMinutes(urgentThreshold.getMinutes() + 10);

  const [pendingRow, urgentRow, activeAgentsRow] = await Promise.all([
    db.execute(sql<{ total: number }>`
      SELECT count(*)::int AS total
      FROM ${schema.conversationStates}
      INNER JOIN ${schema.conversations}
        ON ${schema.conversations.id} = ${schema.conversationStates.conversationId}
      WHERE ${schema.conversations.tenantId} = ${tenantId}
        AND ${schema.conversationStates.controlMode} = 'pending_handoff'
    `),
    db.execute(sql<{ total: number }>`
      SELECT count(*)::int AS total
      FROM ${schema.conversationStates}
      INNER JOIN ${schema.conversations}
        ON ${schema.conversations.id} = ${schema.conversationStates.conversationId}
      WHERE ${schema.conversations.tenantId} = ${tenantId}
        AND ${schema.conversationStates.controlMode} = 'pending_handoff'
        AND (
          ${schema.conversationStates.slaBreached} = true
          OR ${schema.conversationStates.slaDeadline} < ${urgentThreshold}
        )
    `),
    db.execute(sql<{ total: number }>`
      SELECT count(DISTINCT ${schema.conversationStates.assignedAgentId})::int AS total
      FROM ${schema.conversationStates}
      INNER JOIN ${schema.conversations}
        ON ${schema.conversations.id} = ${schema.conversationStates.conversationId}
      WHERE ${schema.conversations.tenantId} = ${tenantId}
        AND ${schema.conversationStates.controlMode} = 'human'
        AND ${schema.conversationStates.assignedAgentId} IS NOT NULL
    `),
  ]);

  return {
    pendingHandoffs: Number(pendingRow.rows[0]?.total ?? 0),
    urgentHandoffs: Number(urgentRow.rows[0]?.total ?? 0),
    activeHumanAgents: Number(activeAgentsRow.rows[0]?.total ?? 0),
  };
}

function buildStatusLabel(status: 'healthy' | 'warning' | 'critical'): 'Saudável' | 'Atenção' | 'Crítico' {
  if (status === 'critical') return 'Crítico';
  if (status === 'warning') return 'Atenção';
  return 'Saudável';
}

export function registerDashboardHomeRoutes(params: DashboardHomeRouteParams): void {
  const {
    app,
    logger,
    requireAuth,
    buildInternalServiceHeaders,
    observabilityServiceUrl,
    trainingServiceUrl,
    integrationsServiceUrl,
  } = params;

  app.get('/api/dashboard/home', requireAuth(), async (req: Request, res: Response) => {
    const tenantId = resolveTenantId(req);
    const userId = req.user?.userId;
    const role = req.user?.role as Role | undefined;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId é obrigatório para carregar a home da dashboard' });
    }

    if (!userId || !role) {
      return res.status(401).json({ error: 'Autenticação necessária' });
    }

    try {
      const [
        stats,
        usage30d,
        conversations30d,
        tokens30d,
        recentActivity,
        fallbackSummary,
        takeoverSummary,
        canViewTraining,
        canViewRouting,
        canViewFinance,
        canManageConversations,
        canUploadDocuments,
        canOpenObservability,
      ] = await Promise.all([
        loadDashboardStats(tenantId),
        loadUsageSeries(tenantId, 30),
        loadConversationTrendSeries(tenantId, 30),
        loadTokensTrendSeries(tenantId, 30),
        loadRecentActivity(tenantId, 5),
        loadFallbackSummary(tenantId),
        loadTakeoverSummary(tenantId),
        checkPermission({ userId, tenantId, role }, 'training:fine_tuning_jobs:read').then((result) => result.allowed),
        checkPermission({ userId, tenantId, role }, 'chat:namespaces:read').then((result) => result.allowed),
        checkPermission({ userId, tenantId, role }, 'integrations:integrations:read').then((result) => result.allowed),
        checkPermission({ userId, tenantId, role }, 'chat:conversations:write').then((result) => result.allowed),
        checkPermission({ userId, tenantId, role }, 'rag:documents:upload').then((result) => result.allowed),
        checkPermission({ userId, tenantId, role }, 'observability:core:read').then((result) => result.allowed),
      ]);

      const internalHeaders = buildInternalServiceHeaders({
        userId,
        tenantId,
        role,
        customRoleId: req.user?.customRoleId ?? null,
      });

      const [servicesData, breakersData, slaData, trainingQueueData, integrationsStats] = await Promise.all([
        observabilityServiceUrl
          ? fetchInternalJson<ObservabilityServicesResponse>({
              url: `${observabilityServiceUrl}/api/observability/metrics/services`,
              headers: internalHeaders,
              logger,
              label: 'saúde de serviços',
            })
          : Promise.resolve(null),
        observabilityServiceUrl
          ? fetchInternalJson<ObservabilityBreakersResponse>({
              url: `${observabilityServiceUrl}/api/observability/metrics/circuit-breakers`,
              headers: internalHeaders,
              logger,
              label: 'circuit breakers',
            })
          : Promise.resolve(null),
        observabilityServiceUrl
          ? fetchInternalJson<ObservabilitySlaResponse>({
              url: `${observabilityServiceUrl}/api/observability/metrics/sla?tenantId=${encodeURIComponent(tenantId)}`,
              headers: internalHeaders,
              logger,
              label: 'SLA',
            })
          : Promise.resolve(null),
        canViewTraining
          ? fetchInternalJson<TrainingQueueStatusResponse>({
              url: `${trainingServiceUrl}/api/training/queue/status?tenantId=${encodeURIComponent(tenantId)}`,
              headers: internalHeaders,
              logger,
              label: 'fila de training',
            })
          : Promise.resolve(null),
        canViewFinance
          ? fetchInternalJson<IntegrationsStatsResponse>({
              url: `${integrationsServiceUrl}/api/integrations/stats`,
              headers: internalHeaders,
              logger,
              label: 'estatísticas de integrações',
            })
          : Promise.resolve(null),
      ]);

      const services = (servicesData?.services ?? []).map((service) => ({
        name: service.name ?? 'Serviço',
        status: service.status === 'healthy' ? 'healthy' : service.status === 'unhealthy' ? 'down' : 'degraded',
        avgLatency: Number(service.avgLatency ?? 0),
      }));
      const breakers = (breakersData?.breakers ?? []).map((breaker) => ({
        name: breaker.name ?? 'Circuit breaker',
        status: breaker.status ?? 'closed',
        failures: Number(breaker.failures ?? 0),
        successRate: Number(breaker.successRate ?? 100),
      }));

      const servicesOnline = services.filter((service) => service.status === 'healthy').length;
      const servicesDegraded = services.filter((service) => service.status === 'degraded').length;
      const servicesOffline = services.filter((service) => service.status === 'down').length;
      const breakerOpen = breakers.filter((breaker) => breaker.status === 'open').length;
      const breakerHalfOpen = breakers.filter((breaker) => breaker.status === 'half-open').length;
      const avgLatencyMs = services.length > 0
        ? Math.round(services.reduce((sum, service) => sum + service.avgLatency, 0) / services.length)
        : 0;

      const sla = {
        breachedCount: Number(slaData?.breachedCount ?? 0),
        atRiskCount: Number(slaData?.atRiskCount ?? 0),
        onTrackCount: Number(slaData?.onTrackCount ?? 0),
        avgFirstResponseTime: Number(slaData?.avgFirstResponseTime ?? 0),
        avgResolutionTime: Number(slaData?.avgResolutionTime ?? 0),
      };

      const trainingPending = (trainingQueueData?.queues ?? []).reduce(
        (sum, queue) => sum + Number(queue.pending ?? 0),
        0,
      );
      const trainingDlq = (trainingQueueData?.queues ?? []).reduce(
        (sum, queue) => sum + Number(queue.dlq ?? 0),
        0,
      );
      const trainingInflight = Number(trainingQueueData?.tenant?.inflightCount ?? 0);
      const maxInflight = Number(trainingQueueData?.governance?.maxInflightRunsPerTenant ?? 0);

      const alerts: Array<{
        id: string;
        severity: 'critical' | 'warning';
        title: string;
        description: string;
        count: number;
        href: string;
        domain: string;
      }> = [];

      if (takeoverSummary.urgentHandoffs > 0) {
        alerts.push({
          id: 'urgent-handoffs',
          severity: 'critical',
          title: 'Handoffs urgentes aguardando humano',
          description: `${takeoverSummary.urgentHandoffs} conversas aguardam atendimento humano com risco de SLA.`,
          count: takeoverSummary.urgentHandoffs,
          href: '/takeover',
          domain: 'support',
        });
      }

      if (servicesOffline > 0) {
        alerts.push({
          id: 'offline-services',
          severity: 'critical',
          title: 'Serviços offline',
          description: `${servicesOffline} serviço(s) estão offline e impactam a plataforma agora.`,
          count: servicesOffline,
          href: '/observability',
          domain: 'platform',
        });
      }

      if (breakerOpen > 0) {
        alerts.push({
          id: 'open-breakers',
          severity: 'critical',
          title: 'Circuit breakers abertos',
          description: `${breakerOpen} circuit breaker(s) estão abertos e exigem investigação.`,
          count: breakerOpen,
          href: '/observability',
          domain: 'platform',
        });
      }

      if (sla.breachedCount > 0) {
        alerts.push({
          id: 'sla-breached',
          severity: 'critical',
          title: 'SLAs violados',
          description: `${sla.breachedCount} atendimento(s) já ultrapassaram o prazo operacional.`,
          count: sla.breachedCount,
          href: '/takeover',
          domain: 'support',
        });
      }

      if (servicesDegraded > 0) {
        alerts.push({
          id: 'degraded-services',
          severity: 'warning',
          title: 'Serviços degradados',
          description: `${servicesDegraded} serviço(s) operam com degradação ou telemetria incompleta.`,
          count: servicesDegraded,
          href: '/observability',
          domain: 'platform',
        });
      }

      if (breakerHalfOpen > 0) {
        alerts.push({
          id: 'half-open-breakers',
          severity: 'warning',
          title: 'Circuit breakers em recuperação',
          description: `${breakerHalfOpen} circuit breaker(s) estão semiabertos e precisam de acompanhamento.`,
          count: breakerHalfOpen,
          href: '/observability',
          domain: 'platform',
        });
      }

      if (sla.atRiskCount > 0) {
        alerts.push({
          id: 'sla-at-risk',
          severity: 'warning',
          title: 'SLAs em risco',
          description: `${sla.atRiskCount} atendimento(s) podem violar o prazo se nada mudar agora.`,
          count: sla.atRiskCount,
          href: '/takeover',
          domain: 'support',
        });
      }

      if (fallbackSummary.unmappedContexts > 0) {
        alerts.push({
          id: 'unmapped-contexts',
          severity: 'warning',
          title: 'Contextos sem namespace mapeado',
          description: `${fallbackSummary.unmappedContexts} fallback(s) por contexto não mapeado apareceram nos últimos 7 dias.`,
          count: fallbackSummary.unmappedContexts,
          href: '/namespaces',
          domain: 'routing',
        });
      }

      if (fallbackSummary.reviewQueue > 0) {
        alerts.push({
          id: 'hybrid-review',
          severity: 'warning',
          title: 'Fila de revisão híbrida',
          description: `${fallbackSummary.reviewQueue} evento(s) aguardam revisão humana nos últimos 14 dias.`,
          count: fallbackSummary.reviewQueue,
          href: '/namespaces',
          domain: 'routing',
        });
      }

      if (trainingPending > 0 || trainingDlq > 0) {
        alerts.push({
          id: 'training-queue',
          severity: trainingDlq > 0 ? 'critical' : 'warning',
          title: 'Fila de training requer atenção',
          description: trainingDlq > 0
            ? `${trainingDlq} item(ns) em DLQ e ${trainingPending} aguardando processamento.`
            : `${trainingPending} item(ns) aguardam processamento na fila de training.`,
          count: trainingDlq > 0 ? trainingDlq : trainingPending,
          href: '/training',
          domain: 'training',
        });
      }

      const prioritizedAlerts = alerts
        .sort((left, right) => {
          const severityWeight = left.severity === right.severity
            ? 0
            : left.severity === 'critical'
              ? -1
              : 1;
          if (severityWeight !== 0) return severityWeight;
          return right.count - left.count;
        })
        .slice(0, 5);

      const criticalAlertCount = alerts.filter((alert) => alert.severity === 'critical').length;

      const overallStatus: 'healthy' | 'warning' | 'critical' =
        criticalAlertCount > 0 || servicesOffline > 0 || breakerOpen > 0 || sla.breachedCount > 0
          ? 'critical'
          : alerts.length > 0 || servicesDegraded > 0 || breakerHalfOpen > 0 || sla.atRiskCount > 0
            ? 'warning'
            : 'healthy';

      const summaryCards = [
        {
          id: 'conversations-7d',
          title: 'Conversas 7d',
          value: sliceTail(usage30d, 7).reduce((sum, point) => sum + point.conversations, 0),
          periodLabel: 'Últimos 7 dias',
          referenceLabel: `${stats.trend.conversations >= 0 ? '+' : ''}${stats.trend.conversations}% vs 7 dias anteriores`,
          href: '/conversations',
        },
        {
          id: 'handoffs-now',
          title: 'Handoffs pendentes',
          value: takeoverSummary.pendingHandoffs,
          periodLabel: 'Agora',
          referenceLabel: `${takeoverSummary.urgentHandoffs} urgente(s)`,
          href: '/takeover',
        },
        {
          id: 'critical-alerts-now',
          title: 'Alertas críticos',
          value: criticalAlertCount,
          periodLabel: 'Agora',
          referenceLabel: servicesOffline > 0 ? `${servicesOffline} serviço(s) offline` : 'Sem serviços offline',
          href: '/observability',
        },
      ];

      if (canViewTraining && trainingQueueData) {
        summaryCards.push({
          id: 'training-queue-now',
          title: 'Fila operacional',
          value: trainingPending,
          periodLabel: 'Agora',
          referenceLabel: maxInflight > 0
            ? `${trainingInflight}/${maxInflight} execuções em voo`
            : `${trainingInflight} execução(ões) em voo`,
          href: '/training',
        });
      } else if (canViewRouting) {
        summaryCards.push({
          id: 'hybrid-review-queue',
          title: 'Fila operacional',
          value: fallbackSummary.reviewQueue,
          periodLabel: 'Últimos 14 dias',
          referenceLabel: `${fallbackSummary.unmappedContexts} contexto(s) não mapeado(s) em 7 dias`,
          href: '/namespaces',
        });
      } else {
        summaryCards.push({
          id: 'sla-at-risk-now',
          title: 'Fila operacional',
          value: sla.atRiskCount,
          periodLabel: 'Agora',
          referenceLabel: `${sla.breachedCount} SLA(s) violado(s)`,
          href: '/takeover',
        });
      }

      const domainSnapshots: Array<{
        id: string;
        title: string;
        description: string;
        href: string;
        items: Array<{ label: string; value: string; tone: 'default' | 'success' | 'warning' | 'critical' }>;
      }> = [];

      if (canViewTraining && trainingQueueData) {
        domainSnapshots.push({
          id: 'training',
          title: 'Training',
          description: 'Fila e capacidade do pipeline de fine-tuning.',
          href: '/training',
          items: [
            { label: 'Pendentes', value: String(trainingPending), tone: trainingPending > 0 ? 'warning' : 'success' },
            { label: 'DLQ', value: String(trainingDlq), tone: trainingDlq > 0 ? 'critical' : 'success' },
            { label: 'Em voo', value: String(trainingInflight), tone: 'default' },
          ],
        });
      }

      if (canViewRouting) {
        domainSnapshots.push({
          id: 'routing',
          title: 'Routing',
          description: 'Fallbacks, revisão híbrida e contextos sem mapeamento.',
          href: '/namespaces',
          items: [
            { label: 'Fallbacks 24h', value: String(fallbackSummary.last24h), tone: fallbackSummary.last24h > 0 ? 'warning' : 'success' },
            { label: 'Revisão híbrida', value: String(fallbackSummary.reviewQueue), tone: fallbackSummary.reviewQueue > 0 ? 'warning' : 'success' },
            { label: 'Não mapeados 7d', value: String(fallbackSummary.unmappedContexts), tone: fallbackSummary.unmappedContexts > 0 ? 'critical' : 'success' },
          ],
        });
      }

      if (canViewFinance && integrationsStats) {
        domainSnapshots.push({
          id: 'finance',
          title: 'Financeiro',
          description: 'Snapshot resumido das integrações financeiras do tenant.',
          href: '/integrations',
          items: [
            {
              label: 'Receita Stripe',
              value: `${Number(integrationsStats.stripe?.totalRevenue ?? 0).toFixed(2)} ${integrationsStats.stripe?.currency ?? 'EUR'}`,
              tone: 'default',
            },
            {
              label: 'Transações',
              value: String(Number(integrationsStats.stripe?.transactions ?? 0)),
              tone: 'default',
            },
            {
              label: 'Wise pendente',
              value: `${Number(integrationsStats.wise?.pendingAmount ?? 0).toFixed(2)} EUR`,
              tone: Number(integrationsStats.wise?.pendingAmount ?? 0) > 0 ? 'warning' : 'success',
            },
          ],
        });
      }

      domainSnapshots.push({
        id: 'support',
        title: 'Atendimento',
        description: 'Backlog humano e capacidade operacional do momento.',
        href: '/takeover',
        items: [
          { label: 'Pendentes', value: String(takeoverSummary.pendingHandoffs), tone: takeoverSummary.pendingHandoffs > 0 ? 'warning' : 'success' },
          { label: 'Urgentes', value: String(takeoverSummary.urgentHandoffs), tone: takeoverSummary.urgentHandoffs > 0 ? 'critical' : 'success' },
          { label: 'Agentes humanos', value: String(takeoverSummary.activeHumanAgents), tone: 'default' },
        ],
      });

      res.json({
        meta: {
          generatedAt: new Date().toISOString(),
        },
        status: {
          level: overallStatus,
          label: buildStatusLabel(overallStatus),
        },
        summaryCards,
        alerts: prioritizedAlerts,
        health: {
          services: {
            online: servicesOnline,
            degraded: servicesDegraded,
            offline: servicesOffline,
          },
          circuitBreakers: {
            open: breakerOpen,
            halfOpen: breakerHalfOpen,
            closed: breakers.filter((breaker) => breaker.status === 'closed').length,
          },
          sla: {
            onTrack: sla.onTrackCount,
            atRisk: sla.atRiskCount,
            breached: sla.breachedCount,
          },
          avgLatencyMs,
          href: canOpenObservability ? '/observability' : null,
        },
        trends: {
          defaultWindow: '7d',
          defaultMetric: 'conversations',
          windows: [
            { id: '7d', label: '7d' },
            { id: '30d', label: '30d' },
          ],
          metrics: [
            {
              id: 'conversations',
              label: 'Conversas',
              supportsBreakdown: true,
              seriesByWindow: {
                '7d': sliceTail(conversations30d, 7),
                '30d': conversations30d,
              },
            },
            {
              id: 'tokens',
              label: 'Tokens',
              supportsBreakdown: false,
              seriesByWindow: {
                '7d': sliceTail(tokens30d, 7),
                '30d': tokens30d,
              },
            },
          ],
        },
        recentActivity,
        domainSnapshots,
        permissions: {
          role,
          tenantId,
          canManageConversations,
          canUploadDocuments,
          canOpenObservability,
          canViewTraining,
          canViewRouting,
          canViewFinance,
        },
      });
    } catch (error) {
      logger.error({ error, tenantId }, 'Falha ao montar home agregada da dashboard');
      res.status(500).json({ error: 'Erro interno ao montar a home da dashboard' });
    }
  });
}

export { loadDashboardStats, loadUsageSeries };
