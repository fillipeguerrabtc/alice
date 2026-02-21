import type { AllocationDecision, AllocationInput } from '../core/types.js';
import { applyNoTradeGuardrails } from './risk-engine.js';

function safeWeight(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
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
    const inverseVol = input.candidates.map((candidate) => {
      const vol = Math.max(0.0001, input.volByInstrument[candidate.instrumentId] ?? 1);
      return 1 / vol;
    });
    const sum = inverseVol.reduce((acc, value) => acc + value, 0);
    input.candidates.forEach((candidate, idx) => {
      const cost = input.costs[candidate.instrumentId];
      const edgeNet = candidate.expectedEdge - ((cost?.totalBps ?? 0) / 10_000);
      const checks = applyNoTradeGuardrails({
        expectedEdgeNet: edgeNet,
        dsrScore: candidate.dsrScore,
        pboScore: candidate.pboScore,
      });
      if (!checks.allowed) return;
      const targetWeight = safeWeight((inverseVol[idx] / Math.max(sum, 1e-9)) * grossBudget);
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
