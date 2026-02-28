export type StreamCorruptionProfile = 'default' | 'trading';

export type StreamCorruptionReason =
  | 'empty'
  | 'repeated_chars'
  | 'noise_ratio'
  | 'repeated_words'
  | 'token_loop'
  | 'digit_noise'
  | 'fragmented_tokens'
  | 'linguistic_noise';

export interface StreamCorruptionEvaluation {
  corrupted: boolean;
  reason: StreamCorruptionReason | null;
}

function hasRepeatedWordSequence(content: string, minConsecutiveRepeats: number): boolean {
  const words = content.match(/\p{L}[\p{L}\p{M}]*/gu) ?? [];
  if (words.length < minConsecutiveRepeats) {
    return false;
  }

  let lastWord: string | null = null;
  let repeatCount = 0;
  for (const word of words) {
    if (word === lastWord) {
      repeatCount += 1;
      if (repeatCount >= minConsecutiveRepeats) {
        return true;
      }
      continue;
    }

    lastWord = word;
    repeatCount = 1;
  }

  return false;
}

function hasRepeatedTokenSequence(content: string, minConsecutiveRepeats: number): boolean {
  const tokens = content.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'-]*/gu) ?? [];
  if (tokens.length < minConsecutiveRepeats) {
    return false;
  }

  let lastToken: string | null = null;
  let repeatCount = 0;
  for (const rawToken of tokens) {
    const token = rawToken.toLowerCase();
    if (token === lastToken) {
      repeatCount += 1;
      if (repeatCount >= minConsecutiveRepeats) {
        return true;
      }
      continue;
    }

    lastToken = token;
    repeatCount = 1;
  }

  return false;
}

function hasDominantShortTokenLoop(content: string, profile: StreamCorruptionProfile): boolean {
  const tokens = content.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'-]*/gu) ?? [];
  const minTokens = profile === 'trading' ? 45 : 30;
  if (tokens.length < minTokens) {
    return false;
  }

  let dominantToken = '';
  let dominantCount = 0;
  const counts = new Map<string, number>();
  for (const rawToken of tokens) {
    const token = rawToken.toLowerCase();
    const nextCount = (counts.get(token) ?? 0) + 1;
    counts.set(token, nextCount);
    if (nextCount > dominantCount) {
      dominantCount = nextCount;
      dominantToken = token;
    }
  }

  if (!dominantToken) {
    return false;
  }
  const dominanceRatio = dominantCount / tokens.length;
  const isShortToken = dominantToken.length <= 2;
  const isNumericToken = /^\d+$/u.test(dominantToken);
  const dominanceThreshold = profile === 'trading' ? 0.46 : 0.32;
  return dominanceRatio >= dominanceThreshold && (isShortToken || isNumericToken);
}

function hasHighDigitNoise(content: string): boolean {
  const normalized = content.toLowerCase();
  if (normalized.length < 140) {
    return false;
  }

  const digitCount = (normalized.match(/\d/gu) ?? []).length;
  const digitRatio = digitCount / Math.max(normalized.length, 1);
  if (digitRatio < 0.32) {
    return false;
  }

  const tokens = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'-]*/gu) ?? [];
  if (tokens.length < 25) {
    return false;
  }
  const uniqueTokenRatio = new Set(tokens).size / tokens.length;
  return uniqueTokenRatio < 0.3;
}

function hasFragmentedTokenNoise(content: string, profile: StreamCorruptionProfile): boolean {
  const tokens = content.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'-]*/gu) ?? [];
  const minTokens = profile === 'trading' ? 35 : 24;
  if (tokens.length < minTokens) {
    return false;
  }

  let tinyOrNumeric = 0;
  let longNumericChain = 0;
  let maxNumericChain = 0;
  for (const token of tokens) {
    const normalized = token.toLowerCase();
    const isNumeric = /^\d+$/u.test(normalized);
    const isTinyToken = normalized.length <= 1;
    const isTinyConnector = normalized.length <= 2 && /^(?:[a-z]|\d+)$/u.test(normalized);
    if (isNumeric || isTinyToken || isTinyConnector) {
      tinyOrNumeric += 1;
    }
    if (isNumeric || isTinyToken) {
      longNumericChain += 1;
      if (longNumericChain > maxNumericChain) {
        maxNumericChain = longNumericChain;
      }
    } else {
      longNumericChain = 0;
    }
  }

  const tinyRatio = tinyOrNumeric / tokens.length;
  const tinyRatioThreshold = profile === 'trading' ? 0.33 : 0.26;
  return tinyRatio >= tinyRatioThreshold || maxNumericChain >= 8;
}

function hasLinguisticNoise(content: string, profile: StreamCorruptionProfile): boolean {
  if (profile === 'trading') {
    return false;
  }

  const rawTokens = content
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.replace(/^[\s"'`([{<]+|[\s"'`)\]}>.,;:!?]+$/gu, ''))
    .filter((token) => token.length >= 4);

  if (rawTokens.length < 18) {
    return false;
  }

  let suspicious = 0;
  let eligible = 0;
  for (const token of rawTokens) {
    const normalized = token.toLowerCase();
    if (
      normalized.startsWith('http') ||
      normalized.includes('://') ||
      normalized.includes('@') ||
      normalized.includes('.com') ||
      normalized.includes('.org') ||
      normalized.includes('.net') ||
      normalized.includes('.br')
    ) {
      continue;
    }

    eligible += 1;

    const hasLetterDigitMix = /(?=.*\p{L})(?=.*\d)/u.test(normalized);
    const hasInvalidSymbolsInside = /[^\p{L}\p{N}\p{M}'-]/u.test(normalized);
    const hasLongConsonantChain = /[bcdfghjklmnpqrstvwxyzç]{5,}/iu.test(normalized);
    const lettersOnly = normalized.replace(/[^\p{L}\p{M}]/gu, '');
    const hasNoVowel = lettersOnly.length >= 5 && !/[aeiouáàâãéêíóôõúü]/iu.test(lettersOnly);
    const hasBurstRepeat = /(.)\1{3,}/u.test(normalized);

    if (hasLetterDigitMix || hasInvalidSymbolsInside || hasLongConsonantChain || hasNoVowel || hasBurstRepeat) {
      suspicious += 1;
    }
  }

  if (eligible < 16) {
    return false;
  }

  const suspiciousRatio = suspicious / eligible;
  return suspiciousRatio >= 0.24;
}

function isLikelyCodeHeavyResponse(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;

  if (/```[\s\S]*```/u.test(trimmed)) {
    return true;
  }

  if (/^\s*[{[]/.test(trimmed) && /[}\]]\s*$/u.test(trimmed)) {
    return true;
  }

  const specialTokens = (trimmed.match(/[{}[\]<>+=*@#$%&|~_/^`]/gu) ?? []).length;
  const specialTokenRatio = specialTokens / Math.max(trimmed.length, 1);
  if (specialTokenRatio > 0.2) {
    return true;
  }

  return /(const|let|var|function|class|return|import|export|interface|type|=>|SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE|FROM|WHERE)\b/iu.test(trimmed);
}

export function evaluateCorruptedAssistantResponse(
  content: string,
  profile: StreamCorruptionProfile = 'default'
): StreamCorruptionEvaluation {
  const text = content.trim();
  if (!text) return { corrupted: true, reason: 'empty' };

  const normalized = text.toLowerCase();
  const shouldApplyNoiseHeuristic = !isLikelyCodeHeavyResponse(text);
  const maxRepeatedChars = /(.)\1{14,}/u.test(normalized);
  if (shouldApplyNoiseHeuristic && maxRepeatedChars) {
    return { corrupted: true, reason: 'repeated_chars' };
  }

  const excessiveNoiseRatio =
    (normalized.match(/[^\p{L}\p{N}\s.,;:!?()\-"']/gu) ?? []).length / Math.max(normalized.length, 1);
  const extremeNoiseThreshold = profile === 'trading' ? 0.42 : 0.2;
  const minimumLengthForNoise = profile === 'trading' ? 320 : 1;
  if (shouldApplyNoiseHeuristic && normalized.length >= minimumLengthForNoise && excessiveNoiseRatio > extremeNoiseThreshold) {
    return { corrupted: true, reason: 'noise_ratio' };
  }

  const minWordRepeats = profile === 'trading' ? 8 : 6;
  const minTokenRepeats = profile === 'trading' ? 10 : 8;
  const repeatedWord = hasRepeatedWordSequence(normalized, minWordRepeats);
  const repeatedToken = hasRepeatedTokenSequence(normalized, minTokenRepeats);
  if (shouldApplyNoiseHeuristic && (repeatedWord || repeatedToken)) {
    return { corrupted: true, reason: 'repeated_words' };
  }

  const dominantShortTokenLoop = hasDominantShortTokenLoop(normalized, profile);
  if (shouldApplyNoiseHeuristic && dominantShortTokenLoop) {
    return { corrupted: true, reason: 'token_loop' };
  }

  if (profile !== 'trading' && shouldApplyNoiseHeuristic && hasHighDigitNoise(normalized)) {
    return { corrupted: true, reason: 'digit_noise' };
  }

  if (profile !== 'trading' && shouldApplyNoiseHeuristic && hasFragmentedTokenNoise(normalized, profile)) {
    return { corrupted: true, reason: 'fragmented_tokens' };
  }

  if (shouldApplyNoiseHeuristic && hasLinguisticNoise(normalized, profile)) {
    return { corrupted: true, reason: 'linguistic_noise' };
  }

  return { corrupted: false, reason: null };
}
