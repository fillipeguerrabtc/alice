export type CorrelationMatrix = Record<string, Record<string, number>>;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: number[], m: number): number {
  if (values.length === 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ax = a.slice(-n);
  const bx = b.slice(-n);
  const ma = mean(ax);
  const mb = mean(bx);
  const sa = std(ax, ma);
  const sb = std(bx, mb);
  if (sa === 0 || sb === 0) return 0;
  let cov = 0;
  for (let i = 0; i < n; i += 1) {
    cov += (ax[i] - ma) * (bx[i] - mb);
  }
  return cov / (n * sa * sb);
}

export function buildCorrelationMatrix(returnsByInstrument: Record<string, number[]>, shrinkage = 0.1): CorrelationMatrix {
  const keys = Object.keys(returnsByInstrument);
  const matrix: CorrelationMatrix = {};
  for (const iKey of keys) {
    matrix[iKey] = {};
    for (const jKey of keys) {
      if (iKey === jKey) {
        matrix[iKey][jKey] = 1;
      } else {
        const corr = pearson(returnsByInstrument[iKey], returnsByInstrument[jKey]);
        matrix[iKey][jKey] = (1 - shrinkage) * corr;
      }
    }
  }
  return matrix;
}
