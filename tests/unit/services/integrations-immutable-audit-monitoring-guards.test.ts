import { describe, expect, it } from 'vitest';
import { loadIntegrationsSource } from './helpers/integrations-source';

describe('integrations immutable audit monitoring guards', () => {
  it('keeps periodic integrity checker scheduler and shutdown callback', () => {
    const source = loadIntegrationsSource();
    expect(source.includes('runIntegrationsImmutableAuditIntegrityCheck')).toBe(true);
    expect(source.includes('startIntegrationsImmutableAuditIntegrityScheduler')).toBe(true);
    expect(source.includes('startIntegrationsImmutableAuditIntegrityScheduler();')).toBe(true);
    expect(source.includes("'integrations-immutable-audit-integrity'")).toBe(true);
  });

  it('exposes health and operational endpoint with immutable audit state', () => {
    const source = loadIntegrationsSource();
    expect(source.includes("app.get('/api/integrations/trading/audit/integrity'")).toBe(true);
    expect(source.includes("app.get('/api/integrations/trading/audit/high-risk'")).toBe(true);
    expect(source.includes("requirePermission('integrations:trading:read')")).toBe(true);
    expect(source.includes('immutableAuditIntegrity: integrationsImmutableAuditIntegrityState')).toBe(true);
    expect(source.includes("stream: 'trading_operations'")).toBe(true);
  });
});
