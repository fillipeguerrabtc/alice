export interface PurgedSplit {
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
}

export function createPurgedSplits(timestamps: number[], folds: number, purgeBars: number, embargoBars: number): PurgedSplit[] {
  if (folds < 1 || timestamps.length < 4) return [];
  const sorted = [...timestamps].sort((a, b) => a - b);
  const foldSize = Math.floor(sorted.length / (folds + 1));
  const splits: PurgedSplit[] = [];
  for (let i = 0; i < folds; i += 1) {
    const testStartIdx = Math.min(sorted.length - 2, (i + 1) * foldSize);
    const testEndIdx = Math.min(sorted.length - 1, testStartIdx + foldSize - 1);
    const trainEndIdx = Math.max(0, testStartIdx - purgeBars - embargoBars - 1);
    if (trainEndIdx <= 0 || testEndIdx <= testStartIdx) continue;
    splits.push({
      trainStart: sorted[0],
      trainEnd: sorted[trainEndIdx],
      testStart: sorted[testStartIdx],
      testEnd: sorted[testEndIdx],
    });
  }
  return splits;
}
