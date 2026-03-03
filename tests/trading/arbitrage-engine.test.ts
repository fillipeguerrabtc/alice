import { describe, expect, it } from 'vitest';
import {
  evaluateCashAndCarry,
  evaluateCrossExchangeArbitrage,
  evaluateTriangularArbitrage,
} from '../../apps/integrations-service/src/trading/engines/arbitrage-engine';

describe('arbitrage engine', () => {
  it('evaluates deterministic triangular arbitrage with costs', () => {
    const candidate = evaluateTriangularArbitrage({
      cycle: [
        { symbol: 'BTC-USDT', ask: 100, bid: 99.8, venue: 'kucoin' },
        { symbol: 'USDT-USDC', ask: 1.001, bid: 1.0, venue: 'kucoin' },
        { symbol: 'BTC-USDC', ask: 101, bid: 101.3, venue: 'kucoin' },
      ],
      takerFeeBps: 8,
      slippageBps: 5,
    });

    expect(candidate.operationIntent).toBe('arbitrage_internal');
    expect(Number.isFinite(candidate.netEdgeBps)).toBe(true);
  });

  it('evaluates cash and carry basis opportunity', () => {
    const candidate = evaluateCashAndCarry({
      spotPrice: 100,
      futuresPrice: 101.5,
      fundingBps: 2,
      feeBps: 8,
      holdingDays: 2,
    });

    expect(candidate.operationIntent).toBe('cash_and_carry');
    expect(candidate.expectedEdgeBps).toBeGreaterThan(0);
  });

  it('evaluates cross-exchange edge with transfer risk flag', () => {
    const candidate = evaluateCrossExchangeArbitrage({
      buyVenue: 'kucoin',
      sellVenue: 'other-venue',
      buyAsk: 100,
      sellBid: 100.8,
      feeBps: 10,
      withdrawCostBps: 5,
      transferRiskFlag: true,
    });

    expect(candidate.operationIntent).toBe('arbitrage_cross_exchange');
    expect(candidate.riskFlags).toContain('transfer_latency_risk');
  });
});
