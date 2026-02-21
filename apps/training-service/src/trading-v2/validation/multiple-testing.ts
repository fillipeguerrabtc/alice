function normalCdf(x: number): number {
  return 0.5 * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x ** 3)));
}

export function computeDeflatedSharpe(observedSharpe: number, trials: number, sampleSize: number): number {
  const safeTrials = Math.max(1, trials);
  const safeN = Math.max(2, sampleSize);
  const penalty = Math.sqrt((2 * Math.log(safeTrials)) / safeN);
  return observedSharpe - penalty;
}

export function computeDsrProbability(dsr: number): number {
  return normalCdf(dsr);
}

export function computePboFromRanks(inRanks: number[], outRanks: number[]): number {
  const n = Math.min(inRanks.length, outRanks.length);
  if (n === 0) return 1;
  let inversions = 0;
  for (let i = 0; i < n; i += 1) {
    if (outRanks[i] > inRanks[i]) inversions += 1;
  }
  return inversions / n;
}
