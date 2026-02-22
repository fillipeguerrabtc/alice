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

  it('supports risk parity with covariance matrix', () => {
    const decisions = buildAllocations({
      mode: 'risk_parity',
      portfolioId: 'p1',
      maxGrossExposure: 0.8,
      maxNetExposure: 0.5,
      maxDrawdownLimit: 0.3,
      currentDrawdown: 0,
      candidates: [
        {
          instrumentId: 'i1',
          symbol: 'BTC-USDT',
          marketType: 'futures',
          side: 'long',
          expectedEdge: 0.04,
          confidenceRaw: 0.7,
          dsrScore: 0.2,
          pboScore: 0.2,
          riskFlags: [],
          timeframe: '5m',
        },
        {
          instrumentId: 'i2',
          symbol: 'ETH-USDT',
          marketType: 'futures',
          side: 'long',
          expectedEdge: 0.03,
          confidenceRaw: 0.68,
          dsrScore: 0.15,
          pboScore: 0.25,
          riskFlags: [],
          timeframe: '5m',
        },
      ],
      costs: {
        i1: { feeBps: 4, slippageBps: 5, spreadBps: 3, totalBps: 12 },
        i2: { feeBps: 4, slippageBps: 6, spreadBps: 4, totalBps: 14 },
      },
      volByInstrument: { i1: 0.03, i2: 0.02 },
      liquidityScoreByInstrument: { i1: 0.8, i2: 0.7 },
      covarianceMatrix: {
        i1: { i1: 0.0009, i2: 0.0003 },
        i2: { i1: 0.0003, i2: 0.0004 },
      },
      constraints: {},
    });
    expect(decisions.length).toBeGreaterThan(0);
    const totalWeight = decisions.reduce((sum, decision) => sum + decision.targetWeight, 0);
    expect(totalWeight).toBeLessThanOrEqual(0.800001);
  });
});
