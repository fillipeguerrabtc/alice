import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadIntegrationsSource(): string {
  const sourcePath = path.join(process.cwd(), 'apps', 'integrations-service', 'src', 'index.ts');
  return readFileSync(sourcePath, 'utf-8');
}

describe('integrations audit-trail integrity guards', () => {
  it('exposes trading audit trail endpoint backed by immutable stream', () => {
    const source = loadIntegrationsSource();
    expect(source.includes("app.get('/api/integrations/trading/audit/:entityType/:id'")).toBe(true);
    expect(source.includes("eq(schema.immutableAuditEvents.stream, 'trading_operations')")).toBe(true);
    expect(source.includes('immutableAudit: {')).toBe(true);
    expect(source.includes('streamKey: immutableStreamKey,')).toBe(true);
  });

  it('validates immutable chain consistency before returning response', () => {
    const source = loadIntegrationsSource();
    expect(source.includes('function verifyImmutableChain(events: Array<{')).toBe(true);
    expect(source.includes('CHAIN_POSITION_MISMATCH')).toBe(true);
    expect(source.includes('PREV_HASH_MISMATCH')).toBe(true);
    expect(source.includes('const immutableIntegrity = verifyImmutableChain(')).toBe(true);
  });
});

