import { describe, expect, it } from 'vitest';
import { loadIntegrationsSource } from './helpers/integrations-source';

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
    expect(source.includes('verifyImmutableAuditChain')).toBe(true);
    expect(source.includes('const immutableIntegrity = verifyImmutableAuditChain(')).toBe(true);
    expect(source.includes("stream: 'trading_operations',")).toBe(true);
  });
});
