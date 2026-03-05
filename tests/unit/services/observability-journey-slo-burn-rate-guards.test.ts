import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('observability journey slo burn-rate guards', () => {
  it('keeps recording rules for burn-rate and queue lag metrics', () => {
    const source = read('infra/observability/rules/journey-slo-recording.yml');
    expect(source.includes('record: alice_slo_burn_rate')).toBe(true);
    expect(source.includes('journey: chat-stream')).toBe(true);
    expect(source.includes('journey: trading-signal')).toBe(true);
    expect(source.includes('journey: training-queue')).toBe(true);
    expect(source.includes('journey: rag-ingest')).toBe(true);
    expect(source.includes('record: alice_queue_lag_seconds')).toBe(true);
  });

  it('keeps Grafana alert rules wired to burn-rate recording metric by journey', () => {
    const source = read('infra/observability/grafana/provisioning/alerting/alert_rules.yml');
    expect(source.includes('uid: slo-chat-stream-burn-rate')).toBe(true);
    expect(source.includes('uid: slo-trading-signal-burn-rate')).toBe(true);
    expect(source.includes('uid: slo-training-queue-burn-rate')).toBe(true);
    expect(source.includes('uid: slo-rag-ingest-burn-rate')).toBe(true);
    expect(source.includes('max(alice_slo_burn_rate{journey="chat-stream"})')).toBe(true);
    expect(source.includes('max(alice_slo_burn_rate{journey="trading-signal"})')).toBe(true);
    expect(source.includes('max(alice_slo_burn_rate{journey="training-queue"})')).toBe(true);
    expect(source.includes('max(alice_slo_burn_rate{journey="rag-ingest"})')).toBe(true);
  });
});
