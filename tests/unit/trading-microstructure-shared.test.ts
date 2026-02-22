import { describe, expect, it } from 'vitest';
import {
  aggregateTradeFlow,
  computeMicrostructureFeatures,
  computeOrderBookImbalance,
  computeSpreadBps,
} from '../../packages/shared-utils/src/trading-microstructure';

describe('shared trading microstructure utils', () => {
  it('computes spread and imbalance from snapshot', () => {
    const snapshot = {
      asks: [[101, 8], [102, 4]] as Array<[number, number]>,
      bids: [[99, 12], [98, 4]] as Array<[number, number]>,
    };
    expect(computeSpreadBps(snapshot)).toBeGreaterThan(0);
    expect(computeOrderBookImbalance(snapshot)).toBeGreaterThan(0);
  });

  it('computes microstructure features with trade flow', () => {
    const tradeFlow = aggregateTradeFlow([
      { ts: 1_000, side: 'buy', size: 2 },
      { ts: 2_000, side: 'sell', size: 1 },
    ]);
    const features = computeMicrostructureFeatures({
      currentOrderBook: {
        asks: [[101, 8]],
        bids: [[99, 12]],
      },
      tradeFlow,
    });
    expect(features.cvd).toBe(1);
    expect(features.bidAskSpreadBps).toBeGreaterThan(0);
  });
});
