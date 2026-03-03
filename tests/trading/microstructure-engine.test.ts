import { describe, expect, it } from 'vitest';
import {
  aggregateTradeFlow,
  computeMicroPrice,
  computeMicrostructureFeatures,
  computeOrderBookImbalance,
  computeSpreadBps,
} from '../../apps/integrations-service/src/trading/engines/microstructure-engine';

describe('microstructure engine', () => {
  const orderBook = {
    sequence: 1,
    asks: [['101', 8], ['102', 5]],
    bids: [['99', 12], ['98', 6]],
    ts: 1_700_000_000_000,
  };

  it('computes order book imbalance and microprice', () => {
    const imbalance = computeOrderBookImbalance(orderBook);
    expect(imbalance).toBeGreaterThan(0);

    const microPrice = computeMicroPrice(orderBook);
    expect(microPrice).toBeGreaterThan(99);
    expect(microPrice).toBeLessThan(101);
  });

  it('aggregates trade flow windows and CVD', () => {
    const flows = aggregateTradeFlow([
      { sequence: 1, tradeId: '1', takerOrderId: 'a', makerOrderId: 'b', price: '100', size: 3, side: 'buy', ts: 1000 },
      { sequence: 2, tradeId: '2', takerOrderId: 'a', makerOrderId: 'b', price: '100', size: 1, side: 'sell', ts: 2000 },
      { sequence: 3, tradeId: '3', takerOrderId: 'a', makerOrderId: 'b', price: '100', size: 2, side: 'buy', ts: 70_000 },
    ], 60_000);

    expect(flows.length).toBe(2);
    expect(flows[0]?.deltaVolume).toBe(2);
    expect(flows[1]?.cvd).toBe(4);
  });

  it('computes complete microstructure feature set', () => {
    const features = computeMicrostructureFeatures({
      currentOrderBook: orderBook,
      previousOrderBook: {
        ...orderBook,
        asks: [['100.5', 12], ['101', 9]],
        bids: [['99.5', 10], ['99', 8]],
      },
      recentTrades: [
        { sequence: 1, tradeId: '1', takerOrderId: 'a', makerOrderId: 'b', price: '100', size: 2, side: 'buy', ts: 1000 },
      ],
      recentCandles: [],
    });

    expect(features.bidAskSpreadBps).toBeCloseTo(computeSpreadBps(orderBook), 5);
    expect(features.orderBookImbalance).toBeGreaterThan(-1);
    expect(features.orderBookImbalance).toBeLessThan(1);
    expect(features.cvd).toBe(2);
  });
});
