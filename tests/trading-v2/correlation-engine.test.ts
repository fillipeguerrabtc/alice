import { describe, it, expect } from 'vitest';
import { buildCorrelationMatrix, pearson } from '../../apps/integrations-service/src/trading-v2/engines/correlation-engine';

describe('correlation engine', () => {
  it('computes pearson correlation', () => {
    const corr = pearson([1, 2, 3], [1, 2, 3]);
    expect(corr).toBeCloseTo(1, 4);
  });

  it('builds correlation matrix with diagonal = 1', () => {
    const matrix = buildCorrelationMatrix({
      BTC: [0.1, 0.2, 0.3],
      ETH: [0.09, 0.18, 0.25],
    });
    expect(matrix.BTC.BTC).toBe(1);
    expect(matrix.ETH.ETH).toBe(1);
  });
});
