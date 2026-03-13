import { describe, expect, it } from 'vitest';
import { buildSignalCandidateSummary } from '../../../apps/integrations-service/src/trading-signal-engine-pipeline-service';

describe('trading signal engine pipeline - candidate summary', () => {
  it('classifica cenário direcional como signal_generated', () => {
    const summary = buildSignalCandidateSummary({
      consensus: {
        overallSignal: 'buy',
        confidence: 0.72,
        alignedTimeframes: ['5m', '15m'],
        misalignedTimeframes: ['1h'],
        agreementRatio: 0.66,
        requiredAgree: 2,
        isMajorityReached: true,
      },
      ensembleResult: {
        overallSignal: 'buy',
        confidence: 0.74,
        topTechniques: [{ technique: 'day_trade', signal: 'buy', confidence: 0.74 }],
      },
      techniqueScores: [
        { technique: 'day_trade', signal: 'buy', confidence: 0.74 },
        { technique: 'swing', signal: 'neutral', confidence: 0.35 },
      ],
    });

    expect(summary.directionalBias).toBe('long');
    expect(summary.candidateCount).toBe(1);
    expect(summary.expectedState).toBe('signal_generated');
    expect(summary.reasonCode).toBeNull();
  });

  it('classifica cenário neutro como no_trade por NO_EDGE', () => {
    const summary = buildSignalCandidateSummary({
      consensus: {
        overallSignal: 'neutral',
        confidence: 0.58,
        alignedTimeframes: ['5m'],
        misalignedTimeframes: ['15m'],
        agreementRatio: 0.5,
        requiredAgree: 1,
        isMajorityReached: true,
      },
      ensembleResult: {
        overallSignal: 'neutral',
        confidence: 0.51,
        topTechniques: [{ technique: 'day_trade', signal: 'neutral', confidence: 0.51 }],
      },
      techniqueScores: [
        { technique: 'day_trade', signal: 'neutral', confidence: 0.51 },
        { technique: 'swing', signal: 'neutral', confidence: 0.4 },
      ],
    });

    expect(summary.directionalBias).toBe('neutral');
    expect(summary.expectedState).toBe('no_trade');
    expect(summary.reasonCode).toBe('NO_EDGE');
  });

  it('classifica falta de maioria como no_trade por NO_CANDIDATES', () => {
    const summary = buildSignalCandidateSummary({
      consensus: {
        overallSignal: 'buy',
        confidence: 0.42,
        alignedTimeframes: ['5m'],
        misalignedTimeframes: ['15m', '1h'],
        agreementRatio: 0.33,
        requiredAgree: 2,
        isMajorityReached: false,
      },
      ensembleResult: {
        overallSignal: 'buy',
        confidence: 0.43,
        topTechniques: [{ technique: 'day_trade', signal: 'buy', confidence: 0.43 }],
      },
      techniqueScores: [
        { technique: 'day_trade', signal: 'buy', confidence: 0.43 },
      ],
    });

    expect(summary.directionalBias).toBe('long');
    expect(summary.expectedState).toBe('no_trade');
    expect(summary.reasonCode).toBe('NO_CANDIDATES');
  });
});
