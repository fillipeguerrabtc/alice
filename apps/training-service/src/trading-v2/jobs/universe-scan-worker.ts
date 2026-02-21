import { getDatabase, schema } from '@alice/database';

export async function runUniverseScanWorker(payload: { tenantId: string; instrumentId: string; marketType: 'spot' | 'futures' | 'margin'; timeframe: string; strategyKey: string; strategyVersion: number; candleTimestamp: string }) {
  const db = getDatabase();
  await db.insert(schema.tradingUniverseCandidates).values({
    tenantId: payload.tenantId,
    instrumentId: payload.instrumentId,
    marketType: payload.marketType,
    strategyKey: payload.strategyKey,
    strategyVersion: payload.strategyVersion,
    timeframe: payload.timeframe as never,
    candleTimestamp: new Date(payload.candleTimestamp),
    side: 'neutral',
    entryModel: { action: 'no-trade' },
    expectedEdge: '0',
    confidenceRaw: '0',
    riskFlags: [],
  });
}
