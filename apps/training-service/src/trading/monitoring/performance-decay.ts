export function detectPerformanceDecay(backtestSharpe: number, liveSharpe: number, tolerance = 0.3): boolean {
  return liveSharpe < backtestSharpe * (1 - tolerance);
}
