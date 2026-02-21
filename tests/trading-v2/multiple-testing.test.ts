import { describe, it, expect } from 'vitest';
import { computeDeflatedSharpe, computeDsrProbability, computePboFromRanks } from '../../apps/training-service/src/trading-v2/validation/multiple-testing';

describe('multiple-testing metrics', () => {
  it('computes DSR and probability', () => {
    const dsr = computeDeflatedSharpe(1.2, 20, 100);
    expect(Number.isFinite(dsr)).toBe(true);
    const prob = computeDsrProbability(dsr);
    expect(prob).toBeGreaterThanOrEqual(0);
    expect(prob).toBeLessThanOrEqual(1);
  });

  it('computes PBO from rank inversions', () => {
    const pbo = computePboFromRanks([1, 2, 3, 4], [1, 3, 2, 4]);
    expect(pbo).toBeGreaterThanOrEqual(0);
    expect(pbo).toBeLessThanOrEqual(1);
  });
});
