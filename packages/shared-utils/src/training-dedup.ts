/**
 * Deduplicação semântica para datasets de treinamento.
 * Reuso compartilhado entre serviços (Regra 2 - Não duplicar).
 */
import crypto from 'crypto';

export function normalizeTrainingText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function computeSemHash(text: string): string {
  const normalized = normalizeTrainingText(text);
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 64);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
