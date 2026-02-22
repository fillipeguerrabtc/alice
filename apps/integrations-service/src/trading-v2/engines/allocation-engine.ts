import type { AllocationDecision, AllocationInput } from '../core/types.js';
import { applyNoTradeGuardrails } from './risk-engine.js';

function safeWeight(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function portfolioVariance(
  instrumentIds: string[],
  weights: Record<string, number>,
  covariance: Record<string, Record<string, number>>,
): number {
  let variance = 0;
  for (const iId of instrumentIds) {
    for (const jId of instrumentIds) {
      variance += (weights[iId] ?? 0) * (weights[jId] ?? 0) * (covariance[iId]?.[jId] ?? 0);
    }
  }
  return Math.max(variance, 0);
}

export function buildAllocations(input: AllocationInput): AllocationDecision[] {
  if (input.currentDrawdown >= input.maxDrawdownLimit) {
    return [];
  }
  if (input.candidates.length === 0) {
    return [];
  }

  const decisions: AllocationDecision[] = [];
  const grossBudget = Math.max(0, input.maxGrossExposure);

  if (input.mode === 'risk_parity') {
    const covariance = input.covarianceMatrix;
    const baseWeights: Record<string, number> = {};
    const inverseVol = input.candidates.map((candidate) => {
      const vol = Math.max(0.0001, input.volByInstrument[candidate.instrumentId] ?? 1);
      return 1 / vol;
    });
    const inverseVolSum = inverseVol.reduce((acc, value) => acc + value, 0);
    input.candidates.forEach((candidate, idx) => {
      baseWeights[candidate.instrumentId] = inverseVol[idx] / Math.max(inverseVolSum, 1e-9);
    });

    const riskAdjustedWeights: Record<string, number> = { ...baseWeights };
    if (covariance) {
      const instrumentIds = input.candidates.map((candidate) => candidate.instrumentId);
      const variance = portfolioVariance(instrumentIds, baseWeights, covariance);
      const portfolioVol = Math.sqrt(Math.max(variance, 1e-9));
      for (const instrumentId of instrumentIds) {
        const marginal = instrumentIds.reduce((sum, otherId) => {
          return sum + (covariance[instrumentId]?.[otherId] ?? 0) * (baseWeights[otherId] ?? 0);
        }, 0);
        const contribution = (baseWeights[instrumentId] ?? 0) * marginal / Math.max(portfolioVol, 1e-9);
        riskAdjustedWeights[instrumentId] = 1 / Math.max(Math.abs(contribution), 1e-6);
      }
      const adjustedSum = instrumentIds.reduce((sum, instrumentId) => sum + (riskAdjustedWeights[instrumentId] ?? 0), 0);
      for (const instrumentId of instrumentIds) {
        riskAdjustedWeights[instrumentId] = (riskAdjustedWeights[instrumentId] ?? 0) / Math.max(adjustedSum, 1e-9);
      }
    }

    input.candidates.forEach((candidate) => {
      const cost = input.costs[candidate.instrumentId];
      const edgeNet = candidate.expectedEdge - ((cost?.totalBps ?? 0) / 10_000);
      const checks = applyNoTradeGuardrails({
        expectedEdgeNet: edgeNet,
        dsrScore: candidate.dsrScore,
        pboScore: candidate.pboScore,
      });
      if (!checks.allowed) return;
      const targetWeight = safeWeight((riskAdjustedWeights[candidate.instrumentId] ?? 0) * grossBudget);
      decisions.push({
        instrumentId: candidate.instrumentId,
        symbol: candidate.symbol,
        side: candidate.side === 'short' ? 'sell' : 'buy',
        targetWeight,
        expectedEdgeNet: edgeNet,
        reason: 'risk_parity',
      });
    });
    return decisions;
  }

  const positive = input.candidates
    .map((candidate) => {
      const calibrated = candidate.confidenceCalibrated ?? candidate.confidenceRaw;
      const liquidity = input.liquidityScoreByInstrument[candidate.instrumentId] ?? 0.5;
      const score = Math.max(0, calibrated) * Math.max(0, candidate.expectedEdge) * Math.max(0.1, liquidity);
      return { candidate, score };
    })
    .filter((entry) => entry.score > 0);

  const scoreSum = positive.reduce((sum, entry) => sum + entry.score, 0);
  for (const entry of positive) {
    const cost = input.costs[entry.candidate.instrumentId];
    const edgeNet = entry.candidate.expectedEdge - ((cost?.totalBps ?? 0) / 10_000);
    const checks = applyNoTradeGuardrails({
      expectedEdgeNet: edgeNet,
      dsrScore: entry.candidate.dsrScore,
      pboScore: entry.candidate.pboScore,
    });
    if (!checks.allowed) continue;
    decisions.push({
      instrumentId: entry.candidate.instrumentId,
      symbol: entry.candidate.symbol,
      side: entry.candidate.side === 'short' ? 'sell' : 'buy',
      targetWeight: safeWeight((entry.score / Math.max(scoreSum, 1e-9)) * grossBudget),
      expectedEdgeNet: edgeNet,
      reason: 'signal_weighted',
    });
  }

  return decisions;
}
