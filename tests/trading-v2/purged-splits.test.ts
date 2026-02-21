import { describe, it, expect } from 'vitest';
import { createPurgedSplits } from '../../apps/training-service/src/trading-v2/validation/purged-splits';

describe('createPurgedSplits', () => {
  it('creates purged and embargoed windows', () => {
    const timestamps = Array.from({ length: 20 }, (_, i) => i + 1);
    const splits = createPurgedSplits(timestamps, 3, 2, 1);
    expect(splits.length).toBeGreaterThan(0);
    for (const split of splits) {
      expect(split.trainEnd).toBeLessThan(split.testStart);
    }
  });
});
