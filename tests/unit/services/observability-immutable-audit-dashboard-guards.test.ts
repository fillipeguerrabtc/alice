import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadTrainingDashboard(): string {
  const dashboardPath = path.join(
    process.cwd(),
    'apps',
    'observability-service',
    'config',
    'grafana',
    'dashboards',
    'alice-training.json',
  );
  return readFileSync(dashboardPath, 'utf-8');
}

function loadIntegrationsDashboard(): string {
  const dashboardPath = path.join(
    process.cwd(),
    'apps',
    'observability-service',
    'config',
    'grafana',
    'dashboards',
    'alice-integrations.json',
  );
  return readFileSync(dashboardPath, 'utf-8');
}

function loadInfraTrainingDashboard(): string {
  const dashboardPath = path.join(
    process.cwd(),
    'infra',
    'observability',
    'grafana',
    'provisioning',
    'dashboards',
    'training',
    'alice-training.json',
  );
  return readFileSync(dashboardPath, 'utf-8');
}

function loadInfraIntegrationsDashboard(): string {
  const dashboardPath = path.join(
    process.cwd(),
    'infra',
    'observability',
    'grafana',
    'provisioning',
    'dashboards',
    'services',
    'alice-integrations.json',
  );
  return readFileSync(dashboardPath, 'utf-8');
}

describe('observability immutable audit dashboard guards', () => {
  it('keeps training dashboard immutable audit panels', () => {
    const source = loadTrainingDashboard();
    expect(source.includes('Immutable Audit Integrity')).toBe(true);
    expect(source.includes('alice_training_immutable_audit_integrity_status')).toBe(true);
    expect(source.includes('alice_training_immutable_audit_integrity_broken_streams')).toBe(true);
    expect(source.includes('alice_training_immutable_audit_integrity_checked_streams')).toBe(true);
    expect(source.includes('alice_training_immutable_audit_integrity_last_check_timestamp_seconds')).toBe(true);
  });

  it('keeps integrations dashboard immutable audit panels', () => {
    const source = loadIntegrationsDashboard();
    expect(source.includes('Immutable Audit Integrity')).toBe(true);
    expect(source.includes('alice_integrations_immutable_audit_integrity_status')).toBe(true);
    expect(source.includes('alice_integrations_immutable_audit_integrity_broken_streams')).toBe(true);
    expect(source.includes('alice_integrations_immutable_audit_integrity_checked_streams')).toBe(true);
    expect(source.includes('alice_integrations_immutable_audit_integrity_last_check_timestamp_seconds')).toBe(true);
  });

  it('keeps app and infra dashboard copies in sync for immutable audit panels', () => {
    expect(loadTrainingDashboard()).toBe(loadInfraTrainingDashboard());
    expect(loadIntegrationsDashboard()).toBe(loadInfraIntegrationsDashboard());
  });
});
