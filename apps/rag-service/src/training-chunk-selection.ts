/**
 * Seleção de chunks para treinamento - RAG Service
 *
 * Lógica de seleção inteligente (relevância, âncoras, diversidade) para
 * escolher chunks de documento para treinamento. Extraído para testes unitários
 * (Plano TREINAMENTO-LIMITES 11/02/2026).
 *
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

export type TrainingChunk = { id: string; conteudo: string; posicao: number };

export type TrainingChunkSelectionOptions = {
  maxSamples?: number;
  minChars?: number;
};

const TRAINING_SALIENCE_KEYWORDS = [
  'risco', 'risk', 'stop loss', 'take profit', 'sl', 'tp',
  'leverage', 'alavancagem', 'entry', 'exit', 'breakout', 'pullback',
  'liquidez', 'liquidity', 'volatilidade', 'volatility', 'drawdown',
  'position sizing', 'size', 'hedge', 'arbitragem', 'arbitrage',
  'funding rate', 'order book', 'book', 'spread', 'latency',
  'compliance', 'governança', 'governance', 'auditoria', 'audit',
  'pnl', 'roi', 'sharpe', 'win rate', 'probabilidade', 'probability',
];

function normalizeForScoring(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeChunkSalienceScore(
  chunk: TrainingChunk,
  totalChunks: number,
  maxPosition: number
): number {
  const raw = chunk.conteudo.trim();
  if (!raw) return 0;
  const normalized = normalizeForScoring(raw);
  const words = normalized.split(' ').filter(Boolean);
  const wordCount = words.length;
  const chars = raw.length;

  const keywordMatches = TRAINING_SALIENCE_KEYWORDS.reduce((acc, keyword) => (
    normalized.includes(keyword) ? acc + 1 : acc
  ), 0);
  const keywordScore = Math.min(keywordMatches / 6, 1);

  const numericMatches = (raw.match(/\b\d+([.,]\d+)?%?\b/g) ?? []).length;
  const numericDensity = wordCount > 0 ? numericMatches / wordCount : 0;
  const numericScore = Math.min(numericDensity * 8, 1);

  const structureHits = (raw.match(/(^|\n)\s*(#{1,6}\s|[-*]\s|[0-9]+\.\s|[A-Z][A-Z\s]{6,}:)/g) ?? []).length;
  const structureScore = Math.min(structureHits / 3, 1);

  const lengthScore = Math.min(chars / 900, 1);

  const posNorm = maxPosition > 0 ? chunk.posicao / maxPosition : 0;
  const edgeDistance = Math.min(posNorm, 1 - posNorm);
  const positionScore = 1 - Math.min(edgeDistance / 0.5, 1);

  const score =
    (keywordScore * 0.38) +
    (numericScore * 0.22) +
    (structureScore * 0.15) +
    (lengthScore * 0.15) +
    (positionScore * 0.10);

  const actionableBonus = /(?:stop loss|take profit|risk|risco|drawdown|entry|exit|hedge|alavancagem|leverage)/i.test(raw) ? 0.05 : 0;
  return Math.min(score + actionableBonus, 1);
}

/**
 * Seleciona chunks para treinamento com critérios de relevância e diversidade.
 * Usa âncoras (início/fim), score de saliência e distância mínima entre chunks.
 */
export function selectTrainingChunks(
  chunks: TrainingChunk[],
  options: TrainingChunkSelectionOptions = {}
): TrainingChunk[] {
  const minChars = options.minChars ?? 180;
  const maxSamples = options.maxSamples ?? 50;
  const eligible = chunks
    .filter((chunk) => chunk.conteudo.trim().length >= minChars)
    .sort((a, b) => a.posicao - b.posicao);

  if (eligible.length <= maxSamples) return eligible;

  const maxPosition = Math.max(...eligible.map((chunk) => chunk.posicao), 1);
  const scored = eligible.map((chunk) => ({
    chunk,
    score: computeChunkSalienceScore(chunk, eligible.length, maxPosition),
  }));

  const minDistance = Math.max(1, Math.floor(eligible.length / (maxSamples * 2)));
  const selected: TrainingChunk[] = [];

  const firstAnchor = scored.find((item) => item.chunk.posicao <= Math.ceil(maxPosition * 0.20));
  const lastAnchor = [...scored].reverse().find((item) => item.chunk.posicao >= Math.floor(maxPosition * 0.80));
  if (firstAnchor) selected.push(firstAnchor.chunk);
  if (lastAnchor && !selected.some((s) => s.id === lastAnchor.chunk.id)) selected.push(lastAnchor.chunk);

  const sortedByScore = [...scored].sort((a, b) => b.score - a.score);
  for (const item of sortedByScore) {
    if (selected.length >= maxSamples) break;
    const alreadySelected = selected.some((s) => s.id === item.chunk.id);
    if (alreadySelected) continue;
    const tooClose = selected.some((s) => Math.abs(s.posicao - item.chunk.posicao) < minDistance);
    if (tooClose) continue;
    selected.push(item.chunk);
  }

  if (selected.length < maxSamples) {
    for (const item of sortedByScore) {
      if (selected.length >= maxSamples) break;
      if (!selected.some((s) => s.id === item.chunk.id)) {
        selected.push(item.chunk);
      }
    }
  }

  return selected
    .sort((a, b) => a.posicao - b.posicao)
    .slice(0, maxSamples);
}
