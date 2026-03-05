import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadAlertRules(): string {
  const rulesPath = path.join(
    process.cwd(),
    'infra',
    'observability',
    'grafana',
    'provisioning',
    'alerting',
    'alert_rules.yml',
  );
  return readFileSync(rulesPath, 'utf-8');
}

describe('observability immutable audit alerting guards', () => {
  it('keeps immutable audit alert group and rule uids', () => {
    const source = loadAlertRules();
    expect(source.includes('name: Immutable Audit Integrity Alerts')).toBe(true);
    expect(source.includes('uid: training-immutable-audit-broken')).toBe(true);
    expect(source.includes('uid: integrations-immutable-audit-broken')).toBe(true);
    expect(source.includes('uid: training-immutable-audit-stale')).toBe(true);
    expect(source.includes('uid: integrations-immutable-audit-stale')).toBe(true);
  });

  it('keeps alert expressions bound to immutable integrity metrics', () => {
    const source = loadAlertRules();
    expect(source.includes('max(alice_training_immutable_audit_integrity_status) or on() vector(0)')).toBe(true);
    expect(source.includes('max(alice_integrations_immutable_audit_integrity_status) or on() vector(0)')).toBe(true);
    expect(source.includes('alice_training_immutable_audit_integrity_last_check_timestamp_seconds')).toBe(true);
    expect(source.includes('alice_integrations_immutable_audit_integrity_last_check_timestamp_seconds')).toBe(true);
    expect(source.includes('noDataState: Alerting')).toBe(true);
  });
});
