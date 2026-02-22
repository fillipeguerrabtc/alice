import { describe, expect, it } from 'vitest';
import {
  allowsCrossExchangeArbitrage,
  autoSelectOperationIntent,
  deriveDeterministicArbitrageCandidates,
} from '../../apps/training-service/src/trading-v2/jobs/universe-scan-worker';

describe('universe scan intent helpers', () => {
  it('auto-selects scalping for short timeframe with good liquidity', () => {
    const intent = autoSelectOperationIntent({
      requestedIntent: 'intraday',
      timeframe: '1m',
      marketType: 'futures',
      expectedEdge: 0.01,
      expectedVolatility: 0.01,
      liquidityProxy: 0.7,
      trend: 'up',
      volatilityRegime: 'low',
    });
    expect(intent).toBe('scalping');
  });

  it('blocks cross-exchange arbitrage when less than two exchanges are connected', () => {
    expect(allowsCrossExchangeArbitrage('arbitrage_cross_exchange', 1)).toBe(false);
    expect(allowsCrossExchangeArbitrage('arbitrage_cross_exchange', 2)).toBe(true);
    expect(allowsCrossExchangeArbitrage('intraday', 1)).toBe(true);
  });

  it('keeps explicit non-intraday intents unchanged', () => {
    const baseInput = {
      timeframe: '1m' as const,
      marketType: 'futures' as const,
      expectedEdge: 0.02,
      expectedVolatility: 0.02,
      liquidityProxy: 0.7,
      trend: 'up',
      volatilityRegime: 'low',
    };
    expect(autoSelectOperationIntent({ ...baseInput, requestedIntent: 'swing' })).toBe('swing');
    expect(autoSelectOperationIntent({ ...baseInput, requestedIntent: 'positional' })).toBe('positional');
    expect(autoSelectOperationIntent({ ...baseInput, requestedIntent: 'arbitrage_internal' })).toBe('arbitrage_internal');
  });

  it('builds deterministic arbitrage candidates with risk flags', () => {
    const candidates = deriveDeterministicArbitrageCandidates({
      baseEdge: 0.001,
      spreadBps: 12,
      depthDropRatio: 0.6,
      liquidityProxy: 0.1,
      crossExchangeAllowed: false,
    });
    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.operationIntent).toBe('arbitrage_internal');
    expect(candidates[0]?.riskFlags).toContain('liquidity_vacuum');
    expect(candidates[1]?.operationIntent).toBe('arbitrage_cross_exchange');
    expect(candidates[1]?.riskFlags).toContain('cross_exchange_not_available');
  });
});
