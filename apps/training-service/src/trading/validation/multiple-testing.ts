function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = sign * (1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z));
  return 0.5 * (1 + erf);
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
