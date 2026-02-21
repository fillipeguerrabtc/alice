import { getDatabase, schema } from '@alice/database';
import { shouldTriggerKillSwitch } from '../monitoring/circuit-breakers.js';

export async function runModelRiskWorker(payload: { tenantId: string; scope: 'strategy' | 'portfolio' | 'instrument'; scopeKey: string; criticalEvents: number; drawdown: number; maxDrawdown: number }) {
  const db = getDatabase();
  const killSwitch = shouldTriggerKillSwitch(payload);
  await db.insert(schema.tradingModelRiskEvents).values({
    tenantId: payload.tenantId,
    scope: payload.scope,
    scopeKey: payload.scopeKey,
    eventType: killSwitch ? 'kill_switch' : 'drift',
    severity: killSwitch ? 'critical' : 'low',
    details: payload,
  });
}
