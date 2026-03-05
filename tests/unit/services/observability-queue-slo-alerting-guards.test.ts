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

describe('observability queue slo alerting guards', () => {
  it('keeps queue backlog and dlq rule identifiers', () => {
    const source = loadAlertRules();
    expect(source.includes('uid: training-fine-tuning-queue-backlog')).toBe(true);
    expect(source.includes('uid: training-fine-tuning-dlq-growth')).toBe(true);
    expect(source.includes('uid: trading-worker-queue-backlog')).toBe(true);
    expect(source.includes('uid: trading-worker-dlq-growth')).toBe(true);
  });

  it('binds queue alerts to training and trading queue metrics', () => {
    const source = loadAlertRules();
    expect(source.includes('sum(alice_training_fine_tuning_queue_pending) or on() vector(0)')).toBe(true);
    expect(source.includes('sum(alice_training_fine_tuning_queue_dlq_total) or on() vector(0)')).toBe(true);
    expect(source.includes('sum(trading_queue_pending) or on() vector(0)')).toBe(true);
    expect(source.includes('sum(trading_dlq_total) or on() vector(0)')).toBe(true);
  });
});
