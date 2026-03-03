import { createPurgedSplits } from './purged-splits.js';

export function buildWalkForwardPlan(timestamps: number[], folds: number, purgeBars: number, embargoBars: number) {
  const splits = createPurgedSplits(timestamps, folds, purgeBars, embargoBars);
  return {
    splits,
    holdoutStart: splits.length ? splits[splits.length - 1].testStart : null,
  };
}
