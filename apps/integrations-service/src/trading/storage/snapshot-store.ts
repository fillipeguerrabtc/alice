import { getDatabase, schema } from '@alice/database';

export async function saveDecisionSnapshot(tenantId: string, decision: Record<string, unknown>) {
  const db = getDatabase();
  await db.insert(schema.tradingSnapshots).values({
    tenantId,
    kind: 'portfolio_decision_packet',
    data: decision,
    refs: {},
  });
}
