const RELEVANCE_STOPWORDS = new Set([
  'a', 'agora', 'ai', 'ainda', 'algo', 'algum', 'alguma', 'ali', 'ao', 'aos', 'aqui', 'as', 'ate',
  'bem', 'boa', 'bom', 'bora', 'com', 'como', 'da', 'das', 'de', 'dela', 'dele', 'deles', 'demais',
  'depois', 'do', 'dos', 'e', 'ela', 'ele', 'eles', 'em', 'entre', 'era', 'essa', 'esse', 'esta',
  'estou', 'eu', 'fala', 'gente', 'hoje', 'la', 'mais', 'mas', 'me', 'meu', 'minha', 'muito', 'na',
  'nas', 'nem', 'no', 'nos', 'nossa', 'nosso', 'o', 'oi', 'ola', 'opa', 'os', 'ou', 'para', 'pela',
  'pelas', 'pelo', 'pelos', 'perto', 'podem', 'por', 'pra', 'que', 'quem', 'salve', 'se', 'sem', 'ser',
  'sera', 'seu', 'sua', 'suas', 'tarde', 'tem', 'tenho', 'to', 'toda', 'todo', 'trazer', 'tu', 'tudo',
  'um', 'uma', 'umas', 'uns', 'vai', 'voce', 'voces',
  'about', 'all', 'and', 'any', 'are', 'but', 'can', 'for', 'from', 'good', 'has', 'have', 'hello',
  'hey', 'hi', 'how', 'its', 'just', 'need', 'now', 'of', 'on', 'or', 'please', 'por', 'the', 'there',
  'this', 'to', 'today', 'up', 'was', 'what', 'with', 'you', 'your',
]);

const STRONG_SHORT_TOKENS = new Set([
  'api',
  'aws',
  'b2b',
  'b2c',
  'btc',
  'crm',
  'cvm',
  'cxo',
  'eth',
  'erp',
  'fxs',
  'gpu',
  'ia',
  'ios',
  'jwt',
  'kpi',
  'llm',
  'n8n',
  'nps',
  'ocr',
  'pix',
  'rag',
  'sdk',
  'seo',
  'sla',
  'sql',
  'ui',
  'ux',
]);

function normalizeRelevanceText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isStrongToken(token: string): boolean {
  if (STRONG_SHORT_TOKENS.has(token)) return true;
  if (token.length >= 4) return true;
  return /\d/u.test(token);
}

export function tokenizeForRelevance(text: string): string[] {
  if (!text || typeof text !== 'string') return [];

  return normalizeRelevanceText(text)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !RELEVANCE_STOPWORDS.has(token))
    .filter((token) => token.length >= 3 || STRONG_SHORT_TOKENS.has(token));
}

function toTokenSet(tokens: string[]): Set<string> {
  return new Set(tokens);
}

function buildBigrams(tokens: string[]): Set<string> {
  return new Set(tokens.slice(0, -1).map((token, index) => `${token} ${tokens[index + 1]}`));
}

function countOverlap(left: Set<string>, right: Set<string>): number {
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

type RelevanceSignal = {
  score: number;
  userTokenCount: number;
  strongUserTokenCount: number;
  overlapCount: number;
  strongOverlapCount: number;
  bigramOverlapCount: number;
};

function computeRelevanceSignal(message: string, userMessage: string): RelevanceSignal {
  const messageTokens = tokenizeForRelevance(message);
  const userTokens = tokenizeForRelevance(userMessage);

  if (messageTokens.length === 0 || userTokens.length === 0) {
    return {
      score: 0,
      userTokenCount: userTokens.length,
      strongUserTokenCount: 0,
      overlapCount: 0,
      strongOverlapCount: 0,
      bigramOverlapCount: 0,
    };
  }

  const messageTokenSet = toTokenSet(messageTokens);
  const userTokenSet = toTokenSet(userTokens);
  const strongUserTokens = [...userTokenSet].filter((token) => isStrongToken(token));
  const strongMessageTokens = new Set([...messageTokenSet].filter((token) => isStrongToken(token)));
  const strongUserTokenSet = new Set(strongUserTokens);
  const userBigrams = buildBigrams(userTokens);
  const messageBigrams = buildBigrams(messageTokens);

  const overlapCount = countOverlap(userTokenSet, messageTokenSet);
  const strongOverlapCount = countOverlap(strongUserTokenSet, strongMessageTokens);
  const bigramOverlapCount = countOverlap(userBigrams, messageBigrams);

  if (strongUserTokenSet.size === 0 && bigramOverlapCount === 0) {
    return {
      score: 0,
      userTokenCount: userTokenSet.size,
      strongUserTokenCount: 0,
      overlapCount,
      strongOverlapCount: 0,
      bigramOverlapCount,
    };
  }

  if (strongOverlapCount === 0 && bigramOverlapCount === 0) {
    return {
      score: 0,
      userTokenCount: userTokenSet.size,
      strongUserTokenCount: strongUserTokenSet.size,
      overlapCount,
      strongOverlapCount,
      bigramOverlapCount,
    };
  }

  const overlapScore = overlapCount / Math.max(1, userTokenSet.size);
  const strongScore = strongOverlapCount / Math.max(1, strongUserTokenSet.size);
  const bigramScore = bigramOverlapCount / Math.max(1, userBigrams.size);

  return {
    score: (strongScore * 0.6) + (overlapScore * 0.15) + (bigramScore * 0.25),
    userTokenCount: userTokenSet.size,
    strongUserTokenCount: strongUserTokenSet.size,
    overlapCount,
    strongOverlapCount,
    bigramOverlapCount,
  };
}

export function computeRelevanceScore(message: string, userMessage: string): number {
  return computeRelevanceSignal(message, userMessage).score;
}

export function computeRoutingScore(text: string, userMessage: string): number {
  const signal = computeRelevanceSignal(text, userMessage);

  if (signal.strongUserTokenCount === 0) {
    return 0;
  }

  if (signal.userTokenCount <= 2 && signal.strongOverlapCount === 0 && signal.bigramOverlapCount === 0) {
    return 0;
  }

  if (
    signal.userTokenCount <= 3
    && signal.strongUserTokenCount <= 1
    && signal.strongOverlapCount < signal.strongUserTokenCount
    && signal.bigramOverlapCount === 0
  ) {
    return Math.min(signal.score, 0.08);
  }

  if (signal.strongOverlapCount === 1 && signal.bigramOverlapCount === 0 && signal.userTokenCount <= 3) {
    return signal.score * 0.85;
  }

  return signal.score;
}
