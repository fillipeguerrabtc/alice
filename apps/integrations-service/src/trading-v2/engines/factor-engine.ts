export function normalizeFactor(value: number, min = -1, max = 1): number {
  if (max <= min) return 0.5;
  const scaled = (value - min) / (max - min);
  return Math.max(0, Math.min(1, scaled));
}
