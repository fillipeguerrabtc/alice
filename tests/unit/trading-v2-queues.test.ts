import { describe, expect, it } from 'vitest';
import {
  TRADING_V2_STREAMS,
  buildTradingV2IdempotencyKey,
  tradingBacktestEnqueueSchema,
  tradingCalibrationEnqueueSchema,
  tradingRebalanceEnqueueSchema,
} from '../../packages/shared-utils/src/trading-v2-queues';

describe('trading-v2 queue schemas', () => {
  const base = {
    idempotencyKey: '12345678',
    tenantId: '11111111-1111-1111-1111-111111111111',
    requestedBy: '22222222-2222-2222-2222-222222222222',
  };

  it('rejects backtest payload with anti-institutional returns field', () => {
    expect(() => {
      tradingBacktestEnqueueSchema.parse({
        ...base,
        instrumentId: '33333333-3333-3333-3333-333333333333',
        marketType: 'futures',
        strategyKey: 'momentum_v2',
        strategyVersion: 2,
        timeframe: '5m',
        lookback: 500,
        asofTimestamp: new Date().toISOString(),
        returns: [0.1, 0.2, 0.3],
      });
    }).toThrow();
  });

  it('rejects calibration payload with anti-institutional points field', () => {
    expect(() => {
      tradingCalibrationEnqueueSchema.parse({
        ...base,
        instrumentId: '33333333-3333-3333-3333-333333333333',
        marketType: 'futures',
        strategyKey: 'momentum_v2',
        strategyVersion: 2,
        timeframe: '5m',
        lookback: 500,
        asofTimestamp: new Date().toISOString(),
        points: [{ raw: 0.7, outcome: 1 }],
      });
    }).toThrow();
  });

  it('rejects rebalance payload with anti-institutional decisions field', () => {
    expect(() => {
      tradingRebalanceEnqueueSchema.parse({
        ...base,
        portfolioId: '44444444-4444-4444-4444-444444444444',
        asofTimestamp: new Date().toISOString(),
        policyVersion: 1,
        decisions: {},
      });
    }).toThrow();
  });
});

describe('buildTradingV2IdempotencyKey', () => {
  it('builds deterministic backtest key with scope/timeframe/asof/version', () => {
    const payload = {
      tenantId: '11111111-1111-1111-1111-111111111111',
      namespaceId: '55555555-5555-5555-5555-555555555555',
      instrumentId: '33333333-3333-3333-3333-333333333333',
      marketType: 'futures',
      strategyKey: 'momentum_v2',
      strategyVersion: 2,
      timeframe: '5m',
      lookback: 500,
      asofTimestamp: '2026-02-22T00:00:00.000Z',
    };

    const key1 = buildTradingV2IdempotencyKey(TRADING_V2_STREAMS.backtest, payload);
    const key2 = buildTradingV2IdempotencyKey(TRADING_V2_STREAMS.backtest, payload);
    expect(key1).toBe(key2);
    expect(key1).toContain('futures');
    expect(key1).toContain('2026-02-22T00:00:00.000Z');
  });
});
