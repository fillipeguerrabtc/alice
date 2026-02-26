function parsePositiveFloat(rawValue: string | undefined, defaultValue: number, varName: string): number {
  const raw = rawValue ?? String(defaultValue);
  const trimmed = raw.trim();
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${varName} inválido: "${raw}". Deve ser número positivo.`);
  }
  return parsed;
}

function parsePositiveInt(rawValue: string | undefined, defaultValue: number, varName: string): number {
  const raw = rawValue ?? String(defaultValue);
  const trimmed = raw.trim();
  if (!/^\d+$/u.test(trimmed)) {
    throw new Error(`${varName} inválido: "${raw}". Deve ser inteiro positivo.`);
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${varName} inválido: "${raw}". Deve ser inteiro positivo.`);
  }
  return parsed;
}

export const TRAINING_DATA_SIMILARITY_THRESHOLD = parsePositiveFloat(
  process.env.TRAINING_DATA_SIMILARITY_THRESHOLD,
  0.85,
  'TRAINING_DATA_SIMILARITY_THRESHOLD'
);

export const TRAINING_EMBEDDING_DEDUPE_WORKER_POLL_INTERVAL_MS = parsePositiveInt(
  process.env.TRAINING_EMBEDDING_DEDUPE_WORKER_POLL_INTERVAL_MS,
  250,
  'TRAINING_EMBEDDING_DEDUPE_WORKER_POLL_INTERVAL_MS'
);
