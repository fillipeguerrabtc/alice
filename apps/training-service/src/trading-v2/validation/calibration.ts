export interface CalibrationPoint {
  raw: number;
  outcome: 0 | 1;
}

export function calibratePlatt(points: CalibrationPoint[]): { a: number; b: number } {
  if (points.length === 0) return { a: 1, b: 0 };
  const meanRaw = points.reduce((sum, point) => sum + point.raw, 0) / points.length;
  const meanOutcome = points.reduce((sum, point) => sum + point.outcome, 0) / points.length;
  return { a: 1, b: meanOutcome - meanRaw };
}

export function applyPlatt(raw: number, model: { a: number; b: number }): number {
  const logit = model.a * raw + model.b;
  return 1 / (1 + Math.exp(-logit));
}
