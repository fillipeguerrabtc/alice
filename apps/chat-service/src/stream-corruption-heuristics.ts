export type StreamCorruptionProfile = 'default' | 'trading';

export type StreamCorruptionReason =
  | 'empty'
  | 'repeated_chars'
  | 'noise_ratio'
  | 'repeated_words'
  | 'repeated_short_pairs'
  | 'short_word_run'
  | 'token_loop'
  | 'digit_noise'
  | 'alphanumeric_noise'
  | 'css_style_leak'
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

function hasRecurringShortRepeatPairs(content: string, profile: StreamCorruptionProfile): boolean {
  const words = (content.match(/\p{L}[\p{L}\p{M}]*/gu) ?? []).map((word) => word.toLowerCase());
  if (words.length < 16) {
    return false;
  }

  let repeatedPairs = 0;
  for (let i = 0; i < words.length - 1; i += 1) {
    const current = words[i];
    if (current.length > 2) {
      continue;
    }
    if (current === words[i + 1]) {
      repeatedPairs += 1;
      i += 1;
    }
  }

  const threshold = profile === 'trading' ? 5 : 3;
  return repeatedPairs >= threshold;
}

function hasExcessiveShortWordRuns(content: string, profile: StreamCorruptionProfile): boolean {
  const words = (content.match(/\p{L}[\p{L}\p{M}]*/gu) ?? []).map((word) => word.toLowerCase());
  if (words.length < 22) {
    return false;
  }

  let maxRun = 0;
  let currentRun = 0;
  let shortWordCount = 0;

  for (const word of words) {
    const isShortWord = word.length <= 2;
    if (isShortWord) {
      shortWordCount += 1;
      currentRun += 1;
      if (currentRun > maxRun) {
        maxRun = currentRun;
      }
    } else {
      currentRun = 0;
    }
  }

  const shortWordRatio = shortWordCount / words.length;
  const runThreshold = profile === 'trading' ? 10 : 7;
  const ratioThreshold = profile === 'trading' ? 0.56 : 0.42;
  return maxRun >= runThreshold || (maxRun >= 5 && shortWordRatio >= ratioThreshold);
}

const SAFE_ALPHANUMERIC_PATTERNS = [
  /^(?:gpt|qwen)-?\d+(?:\.\d+)?$/iu,
  /^(?:v|m|h|s|x)\d{1,4}$/iu,
  /^(?:mp|rtx)\d{2,5}$/iu,
  /^(?:btc|eth|usdt|brl|usd)\d{0,4}$/iu,
];

function hasSuspiciousAlphanumericTokens(content: string, profile: StreamCorruptionProfile): boolean {
  const tokens = content
    .split(/\s+/u)
    .map((token) => token.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((token) => token.length >= 4)
    .map((token) => token.toLowerCase());

  if (tokens.length < 14) {
    return false;
  }

  let suspicious = 0;
  let alphanumericTokens = 0;
  for (const token of tokens) {
    const hasLetterDigitMix = /(?=.*\p{L})(?=.*\d)/u.test(token);
    if (!hasLetterDigitMix) {
      continue;
    }
    alphanumericTokens += 1;

    if (SAFE_ALPHANUMERIC_PATTERNS.some((pattern) => pattern.test(token))) {
      continue;
    }

    const hasDigitsInsideWord = /\p{L}\d+\p{L}/u.test(token);
    const startsWithNoisePattern = /^[a-z]{1,3}\d{2,}[a-z]{1,4}$/iu.test(token);
    const alternatingSegments = /(?:\d+[a-z]{2,}\d+|[a-z]{2,}\d+[a-z]{2,}\d+)/iu.test(token);
    if (hasDigitsInsideWord || startsWithNoisePattern || alternatingSegments) {
      suspicious += 1;
    }
  }

  if (alphanumericTokens === 0) {
    return false;
  }
  const suspiciousRatio = suspicious / alphanumericTokens;
  const minSuspiciousTokens = profile === 'trading' ? 3 : 2;
  const ratioThreshold = profile === 'trading' ? 0.55 : 0.4;
  return suspicious >= minSuspiciousTokens && suspiciousRatio >= ratioThreshold;
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

function hasCssStyleLeakSoup(content: string): boolean {
  const semicolonSoupPattern = /(?:;|:)\s*(?:r?red|blue|green|#(?:[0-9a-f]{3,6}))\b/giu;
  const semicolonSoupMatches = content.match(semicolonSoupPattern) ?? [];
  if (semicolonSoupMatches.length >= 6) {
    return true;
  }

  const cssDeclarationPattern = /(?:color|background-color|font-size|font-weight)\s*:\s*[^;]{1,30};?/giu;
  const cssDeclarationMatches = content.match(cssDeclarationPattern) ?? [];
  return cssDeclarationMatches.length >= 4;
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

  if (shouldApplyNoiseHeuristic && hasCssStyleLeakSoup(normalized)) {
    return { corrupted: true, reason: 'css_style_leak' };
  }

  const minWordRepeats = profile === 'trading' ? 8 : 6;
  const minTokenRepeats = profile === 'trading' ? 10 : 8;
  const repeatedWord = hasRepeatedWordSequence(normalized, minWordRepeats);
  const repeatedToken = hasRepeatedTokenSequence(normalized, minTokenRepeats);
  if (shouldApplyNoiseHeuristic && (repeatedWord || repeatedToken)) {
    return { corrupted: true, reason: 'repeated_words' };
  }

  if (shouldApplyNoiseHeuristic && hasRecurringShortRepeatPairs(normalized, profile)) {
    return { corrupted: true, reason: 'repeated_short_pairs' };
  }

  if (shouldApplyNoiseHeuristic && hasExcessiveShortWordRuns(normalized, profile)) {
    return { corrupted: true, reason: 'short_word_run' };
  }

  const dominantShortTokenLoop = hasDominantShortTokenLoop(normalized, profile);
  if (shouldApplyNoiseHeuristic && dominantShortTokenLoop) {
    return { corrupted: true, reason: 'token_loop' };
  }

  if (shouldApplyNoiseHeuristic && hasSuspiciousAlphanumericTokens(normalized, profile)) {
    return { corrupted: true, reason: 'alphanumeric_noise' };
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
