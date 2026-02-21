import { getDatabase, schema } from '@alice/database';

export async function runPortfolioRebalanceWorker(payload: { tenantId: string; portfolioId: string; asofTimestamp: string; inputs: Record<string, unknown>; decisions: Record<string, unknown> }) {
  const db = getDatabase();
  await db.insert(schema.tradingPortfolioRebalances).values({
    tenantId: payload.tenantId,
    portfolioId: payload.portfolioId,
    asofTimestamp: new Date(payload.asofTimestamp),
    inputs: payload.inputs,
    decisions: payload.decisions,
    status: 'succeeded',
  });
}
