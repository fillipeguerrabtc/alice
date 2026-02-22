import { and, desc, eq, getDatabase, gte, schema, sql } from '@alice/database';
import { shouldTriggerKillSwitch } from '../monitoring/circuit-breakers.js';

export async function runModelRiskWorker(payload: { tenantId: string; scope: 'strategy' | 'portfolio' | 'instrument'; scopeKey: string; criticalEvents: number; drawdown: number; maxDrawdown: number }) {
  const db = getDatabase();
  const now = new Date();
  const recentWindowStart = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
  const baselineWindowStart = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
  const baselineWindowEnd = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));

  const snapshots = await db.query.tradingFactorSnapshotsV2.findMany({
    where: and(
      eq(schema.tradingFactorSnapshotsV2.tenantId, payload.tenantId),
      gte(schema.tradingFactorSnapshotsV2.createdAt, baselineWindowStart),
    ),
    orderBy: [desc(schema.tradingFactorSnapshotsV2.createdAt)],
    limit: 1000,
  });
  const recentScores = snapshots
    .filter((snapshot) => snapshot.createdAt >= recentWindowStart)
    .map((snapshot) => Number(snapshot.riskScore ?? 0));
  const baselineScores = snapshots
    .filter((snapshot) => snapshot.createdAt >= baselineWindowStart && snapshot.createdAt < baselineWindowEnd)
    .map((snapshot) => Number(snapshot.riskScore ?? 0));

  const average = (values: number[]) => values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
  const recentAvg = average(recentScores);
  const baselineAvg = average(baselineScores);
  const psi = Math.abs(recentAvg - baselineAvg) / Math.max(Math.abs(baselineAvg), 0.0001);

  const [recentExecution] = await db
    .select({
      avgPnl: sql<number>`COALESCE(AVG((execution_result->>'realizedPnl')::double precision), 0)`,
    })
    .from(schema.tradingExecutionReports)
    .where(and(
      eq(schema.tradingExecutionReports.tenantId, payload.tenantId),
      gte(schema.tradingExecutionReports.createdAt, recentWindowStart),
    ));
  const [baselineExecution] = await db
    .select({
      avgPnl: sql<number>`COALESCE(AVG((execution_result->>'realizedPnl')::double precision), 0)`,
    })
    .from(schema.tradingExecutionReports)
    .where(and(
      eq(schema.tradingExecutionReports.tenantId, payload.tenantId),
      gte(schema.tradingExecutionReports.createdAt, baselineWindowStart),
      sql`${schema.tradingExecutionReports.createdAt} < ${baselineWindowEnd}`,
    ));

  const performanceDecay = Number(recentExecution?.avgPnl ?? 0) < Number(baselineExecution?.avgPnl ?? 0);
  const killSwitch = shouldTriggerKillSwitch(payload) || psi > 0.3 || performanceDecay;
  const severity: 'low' | 'medium' | 'high' | 'critical' = killSwitch
    ? (psi > 0.5 || payload.drawdown >= payload.maxDrawdown ? 'critical' : 'high')
    : (psi > 0.2 ? 'medium' : 'low');
  const eventType: 'drift' | 'performance_decay' | 'kill_switch' = killSwitch
    ? (performanceDecay ? 'performance_decay' : 'kill_switch')
    : 'drift';

  await db.insert(schema.tradingModelRiskEvents).values({
    tenantId: payload.tenantId,
    scope: payload.scope,
    scopeKey: payload.scopeKey,
    eventType,
    severity,
    details: {
      ...payload,
      psi,
      performanceDecay,
      recentAvgRiskScore: recentAvg,
      baselineAvgRiskScore: baselineAvg,
      recentAvgPnl: Number(recentExecution?.avgPnl ?? 0),
      baselineAvgPnl: Number(baselineExecution?.avgPnl ?? 0),
    },
  });

  if (severity === 'high' || severity === 'critical') {
    await db
      .update(schema.tradingRiskConfig)
      .set({
        tradingEnabled: false,
        autoExecuteSignals: false,
        atualizadoEm: new Date(),
      })
      .where(eq(schema.tradingRiskConfig.tenantId, payload.tenantId));
  }
}
