import { describe, expect, it } from 'vitest';
import { selectAutoIntentCandidate } from '../../apps/integrations-service/src/trading-v2/engines/intent-selection-engine';

describe('intent selection engine', () => {
  it('selects best candidate by edge/confidence under allowed intents', () => {
    const result = selectAutoIntentCandidate({
      candidates: [
        {
          instrumentId: '1',
          symbol: 'BTC-USDT',
          marketType: 'futures',
          operationIntent: 'intraday',
          side: 'long',
          expectedEdge: 0.02,
          confidenceRaw: 0.6,
          confidenceCalibrated: 0.65,
          dsrScore: 0.2,
          pboScore: 0.2,
          riskFlags: [],
          timeframe: '5m',
        },
        {
          instrumentId: '2',
          symbol: 'ETH-USDT',
          marketType: 'futures',
          operationIntent: 'scalping',
          side: 'long',
          expectedEdge: 0.01,
          confidenceRaw: 0.9,
          confidenceCalibrated: 0.9,
          dsrScore: 0.1,
          pboScore: 0.1,
          riskFlags: [],
          timeframe: '1m',
        },
      ],
      costsByInstrument: {
        '1': { feeBps: 8, slippageBps: 5, spreadBps: 3, totalBps: 16 },
        '2': { feeBps: 8, slippageBps: 5, spreadBps: 3, totalBps: 16 },
      },
      allowedIntents: ['intraday', 'scalping'],
      crossExchangeEnabled: false,
    });

    expect(result.candidate?.instrumentId).toBe('1');
    expect(result.selectedIntent).toBe('intraday');
  });

  it('gates cross-exchange candidates when cross-exchange is unavailable', () => {
    const result = selectAutoIntentCandidate({
      candidates: [
        {
          instrumentId: '1',
          symbol: 'BTC-USDT',
          marketType: 'futures',
          operationIntent: 'arbitrage_cross_exchange',
          side: 'long',
          expectedEdge: 0.02,
          confidenceRaw: 0.8,
          confidenceCalibrated: 0.8,
          dsrScore: 0.1,
          pboScore: 0.1,
          riskFlags: [],
          timeframe: '5m',
        },
      ],
      costsByInstrument: {
        '1': { feeBps: 8, slippageBps: 5, spreadBps: 3, totalBps: 16 },
      },
      allowedIntents: ['arbitrage_cross_exchange'],
      crossExchangeEnabled: false,
    });

    expect(result.candidate).toBeNull();
    expect(result.rejectedByIntent).toBe(1);
  });
});
