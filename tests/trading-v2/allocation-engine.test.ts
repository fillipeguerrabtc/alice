import { describe, it, expect } from 'vitest';
import { buildAllocations } from '../../apps/integrations-service/src/trading-v2/engines/allocation-engine';

describe('allocation engine', () => {
  it('returns no-trade when drawdown exceeds limit', () => {
    const decisions = buildAllocations({
      mode: 'signal_weighted',
      portfolioId: 'p1',
      maxGrossExposure: 1,
      maxNetExposure: 1,
      maxDrawdownLimit: 0.1,
      currentDrawdown: 0.2,
      candidates: [],
      costs: {},
      volByInstrument: {},
      liquidityScoreByInstrument: {},
      constraints: {},
    });
    expect(decisions).toHaveLength(0);
  });

  it('allocates when there is positive edge', () => {
    const decisions = buildAllocations({
      mode: 'signal_weighted',
      portfolioId: 'p1',
      maxGrossExposure: 1,
      maxNetExposure: 1,
      maxDrawdownLimit: 0.3,
      currentDrawdown: 0,
      candidates: [{
        instrumentId: 'i1',
        symbol: 'BTC-USDT',
        marketType: 'spot',
        side: 'long',
        expectedEdge: 0.05,
        confidenceRaw: 0.7,
        confidenceCalibrated: 0.75,
        dsrScore: 0.1,
        pboScore: 0.2,
        riskFlags: [],
        timeframe: '5m',
      }],
      costs: { i1: { feeBps: 5, slippageBps: 5, spreadBps: 5, totalBps: 15 } },
      volByInstrument: { i1: 0.02 },
      liquidityScoreByInstrument: { i1: 0.9 },
      constraints: {},
    });
    expect(decisions.length).toBe(1);
    expect(decisions[0].targetWeight).toBeGreaterThan(0);
  });
});
