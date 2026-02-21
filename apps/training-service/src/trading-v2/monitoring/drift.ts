export function computePsi(reference: number[], current: number[]): number {
  if (reference.length === 0 || current.length === 0) return 0;
  const refMean = reference.reduce((sum, value) => sum + value, 0) / reference.length;
  const curMean = current.reduce((sum, value) => sum + value, 0) / current.length;
  const delta = Math.abs(curMean - refMean);
  return delta;
}
