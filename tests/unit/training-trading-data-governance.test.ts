import { describe, expect, it } from 'vitest';
import {
  buildTradingDataEligibilityConditions,
  loadTradingDataGovernancePolicyFromEnv,
  TRADING_DATA_SOURCE_TYPES,
} from '../../apps/training-service/src/trading-data-governance';

describe('training trading data governance', () => {
  it('uses strict fail-closed defaults', () => {
    const policy = loadTradingDataGovernancePolicyFromEnv({});
    expect(policy.requireStrictApprovedDataForAutoEngine).toBe(true);
    expect(policy.enforceMinInferenceConfidence).toBe(true);
    expect(policy.minInferenceConfidence).toBe(0.65);
  });

  it('ignores invalid confidence values and falls back to default', () => {
    const policy = loadTradingDataGovernancePolicyFromEnv({
      TRAINING_TRADING_MIN_INFERENCE_CONFIDENCE: '2.5',
    });
    expect(policy.minInferenceConfidence).toBe(0.65);
  });

  it('builds deterministic eligibility conditions with optional confidence gate', () => {
    const withConfidence = buildTradingDataEligibilityConditions({
      tenantId: '00000000-0000-4000-8000-000000000001',
      namespaceId: '00000000-0000-4000-8000-000000000002',
      policy: {
        requireStrictApprovedDataForAutoEngine: true,
        enforceMinInferenceConfidence: true,
        minInferenceConfidence: 0.75,
      },
    });
    const withoutConfidence = buildTradingDataEligibilityConditions({
      tenantId: '00000000-0000-4000-8000-000000000001',
      namespaceId: '00000000-0000-4000-8000-000000000002',
      policy: {
        requireStrictApprovedDataForAutoEngine: true,
        enforceMinInferenceConfidence: false,
        minInferenceConfidence: 0.75,
      },
    });

    expect(TRADING_DATA_SOURCE_TYPES).toEqual([
      'trading_signal',
      'trading_order',
      'trading_demo',
      'trading_postmortem',
    ]);
    expect(withConfidence.length).toBe(withoutConfidence.length + 1);
  });
});
