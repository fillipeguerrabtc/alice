export interface CalibrationPoint {
  raw: number;
  outcome: 0 | 1;
}

export function calibratePlatt(points: CalibrationPoint[]): { a: number; b: number } {
  if (points.length === 0) return { a: 1, b: 0 };
  let a = 1;
  let b = 0;
  const learningRate = 0.1;
  const iterations = 200;
  for (let i = 0; i < iterations; i += 1) {
    let gradA = 0;
    let gradB = 0;
    for (const point of points) {
      const p = 1 / (1 + Math.exp(-(a * point.raw + b)));
      const error = p - point.outcome;
      gradA += error * point.raw;
      gradB += error;
    }
    a -= learningRate * (gradA / points.length);
    b -= learningRate * (gradB / points.length);
  }
  return { a, b };
}

export function applyPlatt(raw: number, model: { a: number; b: number }): number {
  const logit = model.a * raw + model.b;
  return 1 / (1 + Math.exp(-logit));
}
