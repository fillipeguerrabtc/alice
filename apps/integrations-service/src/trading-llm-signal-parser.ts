import type { TradingLlmSignalPartial } from '@alice/shared-utils';
import { TRADING_LLM_SIGNAL_PARTIAL_SCHEMA } from '@alice/shared-utils';
import { jsonrepair } from 'jsonrepair';
import type { ExtractedLLMValues } from './llm-validation.js';

type ParserLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type CreateLlmSignalResponseParserParams = {
  logger: ParserLogger;
  computeSemHash: (value: string) => string;
  extractValuesFromLLMResponse: (text: string) => ExtractedLLMValues;
};

export type LlmSignalParseResult = {
  data: TradingLlmSignalPartial;
  citedValuesSource: 'llm_payload' | 'regex';
  parseMethod: string;
};

export function createLlmSignalResponseParser(params: CreateLlmSignalResponseParserParams) {
  const { logger, computeSemHash, extractValuesFromLLMResponse } = params;
function stripJsonCodeFence(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```[a-z]*\s*/i, '')
      .replace(/```$/, '')
      .trim();
  }
  return trimmed;
}

function stripListPrefix(line: string): { value: string; stripped: boolean } {
  const stripped = line.replace(/^(?:[-*•]\s+|\d+[).\]]\s+|\d+\s*-\s+)/, '');
  return { value: stripped, stripped: stripped !== line };
}

function sanitizeJsonCandidate(content: string): { json: string; repaired: boolean } {
  if (!content) return { json: content, repaired: false };
  let repaired = false;
  const withoutBom = content.replace(/^\uFEFF/, '');
  if (withoutBom !== content) repaired = true;

  const lines = withoutBom.split('\n').map((line) => {
    const trimmedStart = line.trimStart();
    if (!trimmedStart) return line;

    const stripped = stripListPrefix(trimmedStart);
    if (stripped.stripped) {
      repaired = true;
      const indent = line.slice(0, line.length - trimmedStart.length);
      return `${indent}${stripped.value}`;
    }

    if (/^json\s*[:{-]/i.test(trimmedStart)) {
      const next = trimmedStart.replace(/^json\s*[:]?/i, '').trimStart();
      if (next) {
        repaired = true;
        const indent = line.slice(0, line.length - trimmedStart.length);
        return `${indent}${next}`;
      }
    }

    return line;
  });

  return { json: lines.join('\n'), repaired };
}

function buildLlmResponseSnippet(content: string, limit = 220): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}…`;
}

function extractJsonObjectCandidate(content: string): string {
  const cleaned = stripJsonCodeFence(content).trim();
  if (!cleaned) return cleaned;

  let inString = false;
  let escaping = false;
  let started = false;
  let depth = 0;
  let output = '';

  for (let i = 0; i < cleaned.length; i += 1) {
    const char = cleaned[i];
    if (escaping) {
      if (started) output += char;
      escaping = false;
      continue;
    }
    if (char === '\\') {
      if (started) output += char;
      if (inString) escaping = true;
      continue;
    }
    if (char === '"') {
      if (started) output += char;
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') {
        depth += 1;
        started = true;
        output += char;
        continue;
      }
      if (char === '}' && started) {
        depth -= 1;
        output += char;
        if (depth === 0) {
          return output.trim();
        }
        continue;
      }
    }
    if (started) {
      output += char;
    }
  }

  return output.trim() || cleaned;
}

const TRADING_LLM_SIGNAL_KEYS = new Set([
  'signalType',
  'operationType',
  'expectedDurationMinutes',
  'confidence',
  'tradeSummary',
  'motivators',
  'invalidationReasons',
  'reasoning',
  'timeframeUsed',
  'citedValues',
  'suggestedPrice',
  'suggestedStopLoss',
  'suggestedTakeProfit',
  'suggestedSize',
  'riskReward',
  'marketCondition',
  'riskScore',
]);

type NormalizeLlmJsonKeysOptions = {
  allowAnyKey?: boolean;
};

function shouldNormalizeLlmKey(key: string, allowAnyKey: boolean): boolean {
  return allowAnyKey || TRADING_LLM_SIGNAL_KEYS.has(key);
}

function coerceNumericField(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeLlmSignalPayload(payload: Record<string, unknown>): {
  normalized: Record<string, unknown>;
  citedValuesSource: 'llm_payload' | 'regex';
} {
  const normalized = { ...payload };
  let citedValuesSource: 'llm_payload' | 'regex' = 'regex';
  const numericKeys = [
    'expectedDurationMinutes',
    'confidence',
    'suggestedPrice',
    'suggestedStopLoss',
    'suggestedTakeProfit',
    'suggestedSize',
    'riskReward',
    'riskScore',
  ] as const;

  for (const key of numericKeys) {
    if (key in normalized) {
      const coerced = coerceNumericField(normalized[key]);
      if (coerced === undefined) {
        delete normalized[key];
      } else {
        normalized[key] = coerced;
      }
    }
  }

  // Normalizar confidence para escala 0-1 (LLM pode retornar 0-100 ou 0-10)
  if (typeof normalized.confidence === 'number' && normalized.confidence > 1) {
    normalized.confidence = normalized.confidence > 10
      ? normalized.confidence / 100  // Escala 0-100 → 0-1
      : normalized.confidence / 10;  // Escala 0-10 → 0-1
  }

  // riskReward deve ser > 0; se inválido, remover para Zod aceitar como undefined (optional)
  if (typeof normalized.riskReward === 'number' && normalized.riskReward <= 0) {
    delete normalized.riskReward;
  }

  if (typeof normalized.motivators === 'string') {
    normalized.motivators = [normalized.motivators].filter(Boolean);
  }
  if (typeof normalized.invalidationReasons === 'string') {
    normalized.invalidationReasons = [normalized.invalidationReasons].filter(Boolean);
  }

  if (normalized.citedValues && typeof normalized.citedValues === 'object' && !Array.isArray(normalized.citedValues)) {
    const citedValues = normalized.citedValues as Record<string, unknown>;
    const next: Record<string, number> = {};
    for (const [key, value] of Object.entries(citedValues)) {
      const coerced = coerceNumericField(value);
      if (coerced !== undefined) {
        next[key] = coerced;
      }
    }
    if (Object.keys(next).length > 0) {
      citedValuesSource = 'llm_payload';
      normalized.citedValues = next;
    } else {
      normalized.citedValues = {};
    }
  }

  const shouldFallbackToRegex = !normalized.citedValues
    || (typeof normalized.citedValues === 'object' && !Array.isArray(normalized.citedValues) && Object.keys(normalized.citedValues).length === 0);
  if (shouldFallbackToRegex) {
    const reasoning = typeof normalized.reasoning === 'string' ? normalized.reasoning : '';
    const extracted = extractValuesFromLLMResponse(reasoning);
    const extractedValues = Object.entries(extracted).reduce<Record<string, number>>((acc, [key, value]) => {
      if (value !== undefined) acc[key] = value;
      return acc;
    }, {});
    citedValuesSource = 'regex';
    normalized.citedValues = Object.keys(extractedValues).length > 0 ? extractedValues : {};
  }

  return { normalized, citedValuesSource };
}

function normalizeLlmJsonKeys(
  content: string,
  options: NormalizeLlmJsonKeysOptions = {}
): { json: string; repaired: boolean } {
  const allowAnyKey = options.allowAnyKey ?? false;
  const singleQuotedKeys = content.replace(/'([A-Za-z_][A-Za-z0-9_]*)'\s*:/g, '"$1":');
  const preprocessedContent = singleQuotedKeys.replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, ':"$1"');
  const source = preprocessedContent;
  let repaired = false;
  let inString = false;
  let escaping = false;
  let output = '';
  let i = 0;

  const isIdentifierStart = (char: string) => /[A-Za-z_]/.test(char);
  const isIdentifierChar = (char: string) => /[A-Za-z0-9_]/.test(char);
  const isWhitespace = (char: string) => /\s/.test(char);
  const listPrefixRegex = /^(?:[-*•]\s+|\d+[).\]]\s+|\d+\s*-\s+)/;

  while (i < source.length) {
    const char = source[i];
    if (escaping) {
      output += char;
      escaping = false;
      i += 1;
      continue;
    }
    if (char === '\\') {
      output += char;
      if (inString) escaping = true;
      i += 1;
      continue;
    }
    if (char === '"') {
      output += char;
      inString = !inString;
      i += 1;
      continue;
    }
    if (!inString && (char === '{' || char === ',')) {
      output += char;
      i += 1;
      while (i < source.length && isWhitespace(source[i])) {
        output += source[i];
        i += 1;
      }
      if (i >= source.length) break;

      const remaining = source.slice(i);
      const listPrefixMatch = remaining.match(listPrefixRegex);
      if (listPrefixMatch) {
        repaired = true;
        i += listPrefixMatch[0].length;
      }
      while (i < source.length && isWhitespace(source[i])) {
        output += source[i];
        i += 1;
      }
      if (i >= source.length) break;

      if (source[i] === "'") {
        const start = i + 1;
        let end = start;
        while (end < source.length && source[end] !== "'") {
          end += 1;
        }
        if (end < source.length) {
          const key = source.slice(start, end);
          let cursor = end + 1;
          while (cursor < source.length && isWhitespace(source[cursor])) cursor += 1;
        if (source[cursor] === ':' && shouldNormalizeLlmKey(key, allowAnyKey)) {
            output += `"${key}"`;
            output += source.slice(end + 1, cursor);
            output += ':';
            repaired = true;
            i = cursor + 1;
            continue;
          }
        }
        output += source[i];
        i += 1;
        continue;
      }

      if (isIdentifierStart(source[i])) {
        const start = i;
        let end = start + 1;
        while (end < source.length && isIdentifierChar(source[end])) {
          end += 1;
        }
        const key = source.slice(start, end);
        let cursor = end;
        while (cursor < source.length && isWhitespace(source[cursor])) cursor += 1;
        if (source[cursor] === ':' && shouldNormalizeLlmKey(key, allowAnyKey)) {
          output += `"${key}"`;
          output += source.slice(end, cursor);
          output += ':';
          repaired = true;
          i = cursor + 1;
          continue;
        }
      }
      // =======================================================================
      // CORREÇÃO 08/02/2026: char ('{' ou ',') JÁ foi emitido na linha acima
      // e i JÁ foi avançado. Sem este continue, o loop caía para
      // output += char; i += 1; que DUPLICAVA o caractere e PULAVA o próximo,
      // corrompendo JSON válido do LLM (ex: "{{" ao invés de "{").
      // =======================================================================
      continue;
    }

    output += char;
    i += 1;
  }

  return { json: output, repaired };
}

function escapeJsonString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function quoteJsonString(value: string): string {
  return `"${escapeJsonString(value)}"`;
}

function coerceYamlLikeValue(value: string): string {
  const raw = value.trim().replace(/,+\s*$/, '');
  if (!raw) return '""';
  if (raw.startsWith('"') || raw.startsWith('[') || raw.startsWith('{')) {
    return raw;
  }
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return quoteJsonString(raw.slice(1, -1));
  }
  if (/^(true|false|null)$/i.test(raw)) {
    return raw.toLowerCase();
  }
  if (/^-?\d+(?:[.,]\d+)?$/.test(raw)) {
    return raw.replace(',', '.');
  }
  return quoteJsonString(raw);
}

function repairYamlLikeObject(content: string): { json: string; repaired: boolean } {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return { json: content, repaired: false };
  }

  const lines = trimmed.split(/\r?\n/);
  const props: string[] = [];
  let repaired = false;
  let insideObject = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('{')) {
      insideObject = true;
      continue;
    }
    if (line.startsWith('}')) {
      break;
    }
    if (!insideObject) continue;

    const prefixed = stripListPrefix(line);
    if (prefixed.stripped) repaired = true;
    let work = prefixed.value.replace(/,+\s*$/, '');
    if (work.startsWith('-')) {
      work = work.replace(/^-\s*/, '');
      repaired = true;
    }
    const singleQuotedKey = work.match(/^'([^']+)'\s*:/);
    if (singleQuotedKey && TRADING_LLM_SIGNAL_KEYS.has(singleQuotedKey[1])) {
      work = work.replace(/^'([^']+)'\s*:/, `"${singleQuotedKey[1]}":`);
      repaired = true;
    }
    const bareKey = work.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/);
    if (bareKey && TRADING_LLM_SIGNAL_KEYS.has(bareKey[1])) {
      work = work.replace(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/, `"${bareKey[1]}":`);
      repaired = true;
    }
    const valueMatch = work.match(/^"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*(.*)$/);
    if (valueMatch && TRADING_LLM_SIGNAL_KEYS.has(valueMatch[1])) {
      work = `"${valueMatch[1]}": ${coerceYamlLikeValue(valueMatch[2] ?? '')}`;
      repaired = true;
    }
    props.push(work);
  }

  if (!repaired || props.length === 0) {
    return { json: content, repaired: false };
  }

  const normalizedProps = props.map((item, index) => {
    const sanitized = item.replace(/,+\s*$/, '');
    return index < props.length - 1 ? `${sanitized},` : sanitized;
  });

  return {
    json: `{\n${normalizedProps.join('\n')}\n}`,
    repaired: true,
  };
}

function repairYamlLikeBlockWithoutBraces(content: string): { json: string; repaired: boolean } {
  const trimmed = content.trim();
  if (!trimmed || trimmed.startsWith('{') || trimmed.endsWith('}')) {
    return { json: content, repaired: false };
  }

  const lines = trimmed.split(/\r?\n/);
  const props: string[] = [];
  let repaired = false;
  let currentKey: string | null = null;
  let currentArray: string[] = [];

  const flushArray = () => {
    if (!currentKey) return;
    const items = currentArray.length > 0 ? currentArray.join(', ') : '';
    props.push(`"${currentKey}": [${items}]`);
    currentKey = null;
    currentArray = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('-')) {
      if (!currentKey) continue;
      const item = line.replace(/^-\s*/, '');
      currentArray.push(coerceYamlLikeValue(item));
      repaired = true;
      continue;
    }
    if (currentKey) {
      flushArray();
    }
    const prefixed = stripListPrefix(line);
    if (prefixed.stripped) repaired = true;
    const match = prefixed.value.match(/^['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (!TRADING_LLM_SIGNAL_KEYS.has(key)) continue;
    const value = match[2] ?? '';
    if (!value.trim()) {
      currentKey = key;
      currentArray = [];
      repaired = true;
      continue;
    }
    props.push(`"${key}": ${coerceYamlLikeValue(value)}`);
    repaired = true;
  }

  if (currentKey) {
    flushArray();
  }

  if (!repaired || props.length === 0) {
    return { json: content, repaired: false };
  }

  return {
    json: `{\n${props.join(',\n')}\n}`,
    repaired: true,
  };
}

function repairYamlLikeFromRawText(content: string): { json: string; repaired: boolean } {
  const cleaned = sanitizeJsonCandidate(stripJsonCodeFence(content)).json;
  const lines = cleaned.split(/\r?\n/);
  const props: string[] = [];
  let repaired = false;
  let currentKey: string | null = null;
  let currentArray: string[] = [];

  const flushArray = () => {
    if (!currentKey) return;
    const items = currentArray.length > 0 ? currentArray.join(', ') : '';
    props.push(`"${currentKey}": [${items}]`);
    currentKey = null;
    currentArray = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === '{' || line === '}' || line.startsWith('```')) continue;
    if (line.startsWith('-')) {
      if (!currentKey) continue;
      const item = line.replace(/^-\s*/, '');
      currentArray.push(coerceYamlLikeValue(item));
      repaired = true;
      continue;
    }
    if (currentKey) {
      flushArray();
    }
    const prefixed = stripListPrefix(line);
    if (prefixed.stripped) repaired = true;
    const match = prefixed.value.match(/^['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (!TRADING_LLM_SIGNAL_KEYS.has(key)) continue;
    const value = match[2] ?? '';
    if (!value.trim()) {
      currentKey = key;
      currentArray = [];
      repaired = true;
      continue;
    }
    props.push(`"${key}": ${coerceYamlLikeValue(value)}`);
    repaired = true;
  }

  if (currentKey) {
    flushArray();
  }

  if (!repaired || props.length === 0) {
    return { json: content, repaired: false };
  }

  return {
    json: `{\n${props.join(',\n')}\n}`,
    repaired: true,
  };
}

function repairLlmJsonContent(content: string): { json: string; repaired: boolean } {
  let repaired = false;
  let inString = false;
  let escaping = false;
  let output = '';

  const peekNextNonWhitespace = (startIndex: number): string | null => {
    for (let i = startIndex; i < content.length; i += 1) {
      if (!/\s/.test(content[i])) return content[i];
    }
    return null;
  };

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (escaping) {
      output += char;
      escaping = false;
      continue;
    }
    if (char === '\\') {
      output += char;
      if (inString) escaping = true;
      continue;
    }
    if (char === '"') {
      if (inString) {
        const nextNonWhitespace = peekNextNonWhitespace(i + 1);
        const isTerminator = nextNonWhitespace === ',' || nextNonWhitespace === '}' || nextNonWhitespace === ']' || nextNonWhitespace === ':';
        if (!isTerminator) {
          output += '\\"';
          repaired = true;
          continue;
        }
        inString = false;
        output += char;
        continue;
      }
      inString = true;
      output += char;
      continue;
    }
    if (inString) {
      if (char === '\n' || char === '\r') {
        output += '\\n';
        repaired = true;
        continue;
      }
      if (char === '\t') {
        output += '\\t';
        repaired = true;
        continue;
      }
      const code = char.charCodeAt(0);
      if (code < 0x20) {
        output += `\\u${code.toString(16).padStart(4, '0')}`;
        repaired = true;
        continue;
      }
    }
    output += char;
  }

  if (inString) {
    output += '"';
    repaired = true;
  }

  // Reparo de leading commas em arrays: [, → [
  // Padrão comum em LLMs que geram "motivators": [, "item1", "item2"]
  const leadingCommaRegex = /\[\s*,/g;
  if (leadingCommaRegex.test(output)) {
    output = output.replace(/\[\s*,/g, '[');
    repaired = true;
  }

  const trailingCommaResult = removeTrailingCommasOutsideStrings(output);
  if (trailingCommaResult.removed) {
    repaired = true;
  }

  const commaRepair = insertMissingCommasInArrays(trailingCommaResult.json);
  if (commaRepair.inserted) {
    repaired = true;
  }

  const finalTrailingCommaResult = removeTrailingCommasOutsideStrings(commaRepair.json);
  if (finalTrailingCommaResult.removed) {
    repaired = true;
  }

  return { json: finalTrailingCommaResult.json, repaired };
}

function removeTrailingCommasOutsideStrings(content: string): { json: string; removed: boolean } {
  let inString = false;
  let escaping = false;
  let removed = false;
  let output = '';

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (escaping) {
      output += char;
      escaping = false;
      continue;
    }
    if (char === '\\') {
      output += char;
      if (inString) escaping = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      output += char;
      continue;
    }
    if (!inString && char === ',') {
      let j = i + 1;
      while (j < content.length && /\s/.test(content[j])) {
        j += 1;
      }
      const nextChar = content[j];
      if (nextChar === '}' || nextChar === ']') {
        removed = true;
        continue;
      }
    }
    output += char;
  }

  return { json: output, removed };
}

function insertMissingCommasInArrays(content: string): { json: string; inserted: boolean } {
  let inString = false;
  let escaping = false;
  let arrayDepth = 0;
  let inserted = false;
  let output = '';

  const peekNextNonWhitespace = (startIndex: number): string | null => {
    for (let i = startIndex; i < content.length; i += 1) {
      if (!/\s/.test(content[i])) return content[i];
    }
    return null;
  };

  const peekPrevNonWhitespace = (): string | null => {
    for (let i = output.length - 1; i >= 0; i -= 1) {
      if (!/\s/.test(output[i])) return output[i];
    }
    return null;
  };

  const shouldInsertComma = (nextChar: string | null): boolean => {
    if (!nextChar) return false;
    if (nextChar === ']' || nextChar === ',') return false;
    if (nextChar === ':') return false;
    const prevNonWs = peekPrevNonWhitespace();
    if (!prevNonWs || prevNonWs === '[' || prevNonWs === ',') return false;
    return nextChar === '"' || nextChar === '{' || nextChar === '[';
  };

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (escaping) {
      output += char;
      escaping = false;
      continue;
    }
    if (char === '\\') {
      output += char;
      if (inString) escaping = true;
      continue;
    }
    if (char === '"') {
      output += char;
      inString = !inString;
      if (!inString && arrayDepth > 0) {
        const nextChar = peekNextNonWhitespace(i + 1);
        if (shouldInsertComma(nextChar)) {
          output += ',';
          inserted = true;
        }
      }
      continue;
    }
    if (!inString) {
      if (char === '[') {
        arrayDepth += 1;
        output += char;
        continue;
      }
      if (char === ']') {
        arrayDepth = Math.max(0, arrayDepth - 1);
        output += char;
        if (arrayDepth > 0) {
          const nextChar = peekNextNonWhitespace(i + 1);
          if (shouldInsertComma(nextChar)) {
            output += ',';
            inserted = true;
          }
        }
        continue;
      }
      if (char === '}' && arrayDepth > 0) {
        output += char;
        const nextChar = peekNextNonWhitespace(i + 1);
        if (shouldInsertComma(nextChar)) {
          output += ',';
          inserted = true;
        }
        continue;
      }
    }
    output += char;
  }

  return { json: output, inserted };
}

/**
 * Tenta completar JSON truncado adicionando fechamentos faltantes (}, ]).
 * Útil quando o LLM gera JSON válido mas é cortado por max_tokens.
 * Retorna null se não conseguir determinar os fechamentos necessários.
 */
function tryCompleteJson(json: string): string | null {
  const trimmed = json.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;

  // Contar aberturas e fechamentos fora de strings
  let inString = false;
  let escaping = false;
  const stack: string[] = [];

  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaping = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '}' || char === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === char) {
        stack.pop();
      }
    }
  }

  // Se stack está vazio, JSON já está balanceado - não é truncamento
  if (stack.length === 0) return null;

  // Fechar string aberta se necessário
  let completed = trimmed;
  if (inString) {
    completed += '"';
  }

  // Remover trailing comma antes de fechar
  completed = completed.replace(/,\s*$/, '');

  // Adicionar fechamentos na ordem reversa
  while (stack.length > 0) {
    completed += stack.pop();
  }

  return completed;
}

function parseLlmSignalResponse(rawResponse: string): {
  data: TradingLlmSignalPartial;
  citedValuesSource: 'llm_payload' | 'regex';
  parseMethod: string;
} {
  // Log da resposta raw do LLM antes de qualquer tentativa de parse (primeiros 500 chars)
  const isDirectJson = rawResponse.trimStart().startsWith('{');
  logger.info({
    rawResponseLength: rawResponse.length,
    rawResponseSnippet: rawResponse.substring(0, 500),
    isDirectJson,
  }, 'Resposta raw do LLM recebida para parsing de sinal de trading');

  const candidate = extractJsonObjectCandidate(rawResponse);

  // FAST PATH: Se resposta começa com '{' (constrained decoding ativo),
  // tentar JSON.parse DIRETO no candidato ANTES de qualquer normalização/reparo.
  // Isso evita que normalizeLlmJsonKeys ou outros reparos corrompam JSON já válido.
  if (isDirectJson) {
    try {
      const directParsed = JSON.parse(candidate) as Record<string, unknown>;
      const { normalized: directNormPayload, citedValuesSource: directCvs } = normalizeLlmSignalPayload(directParsed);
      const directResult = TRADING_LLM_SIGNAL_PARTIAL_SCHEMA.safeParse(directNormPayload);
      if (directResult.success) {
        logger.info({ parseMethod: 'direct_json', citedValuesSource: directCvs }, 'Sinal de trading parseado via JSON.parse direto (sem normalização)');
        return { data: directResult.data, citedValuesSource: directCvs, parseMethod: 'direct_json' };
      }
      // JSON válido mas Zod rejeitou - log e cair para pipeline de reparo
      logger.warn({ zodError: directResult.error.message }, 'JSON.parse direto OK mas Zod rejeitou - tentando pipeline de reparo');
    } catch {
      // JSON.parse direto falhou - tentar completar JSON truncado antes de cair para pipeline pesado
      logger.info('JSON.parse direto falhou, tentando completar JSON truncado');
      const completed = tryCompleteJson(candidate);
      if (completed !== null) {
        try {
          const completedParsed = JSON.parse(completed) as Record<string, unknown>;
          const { normalized: completedNormPayload, citedValuesSource: completedCvs } = normalizeLlmSignalPayload(completedParsed);
          const completedResult = TRADING_LLM_SIGNAL_PARTIAL_SCHEMA.safeParse(completedNormPayload);
          if (completedResult.success) {
            logger.info({ parseMethod: 'completed_json', citedValuesSource: completedCvs }, 'Sinal de trading parseado via completamento de JSON truncado');
            return { data: completedResult.data, citedValuesSource: completedCvs, parseMethod: 'completed_json' };
          }
          logger.warn({ zodError: completedResult.error.message }, 'JSON completado válido mas Zod rejeitou');
        } catch {
          logger.info('JSON completado também falhou no parse, seguindo para pipeline de normalização');
        }
      }
    }
  }

  const sanitized = sanitizeJsonCandidate(candidate);
  if (sanitized.repaired) {
    logger.warn('Resposta LLM continha prefixos não JSON; sanitização aplicada.');
  }
  const normalized = normalizeLlmJsonKeys(sanitized.json);
  if (normalized.repaired) {
    logger.warn('Resposta LLM continha chaves sem aspas; normalização aplicada.');
  }
  try {
    const parsed = JSON.parse(normalized.json) as Record<string, unknown>;
    const { normalized: normalizedPayload, citedValuesSource } = normalizeLlmSignalPayload(parsed);
    const result = TRADING_LLM_SIGNAL_PARTIAL_SCHEMA.safeParse(normalizedPayload);
    if (!result.success) {
      throw new Error(`Resposta LLM inválida: ${result.error.message}`);
    }
    const parseMethod = sanitized.repaired || normalized.repaired ? 'sanitized' : 'normalized';
    logger.info({ parseMethod, citedValuesSource }, 'Sinal de trading parseado com sucesso');
    return { data: result.data, citedValuesSource, parseMethod };
  } catch (error) {
    const permissive = normalizeLlmJsonKeys(sanitized.json, { allowAnyKey: true });
    if (permissive.json !== normalized.json) {
      try {
        logger.warn({ error: error instanceof Error ? error.message : error }, 'Resposta LLM inválida; aplicando reparo de chaves JSON.');
        const parsed = JSON.parse(permissive.json) as Record<string, unknown>;
        const { normalized: normalizedPayload, citedValuesSource } = normalizeLlmSignalPayload(parsed);
        const result = TRADING_LLM_SIGNAL_PARTIAL_SCHEMA.safeParse(normalizedPayload);
        if (!result.success) {
          throw new Error(`Resposta LLM inválida após reparo: ${result.error.message}`);
        }
        logger.info({ parseMethod: 'permissive_keys', citedValuesSource }, 'Sinal de trading parseado com sucesso via reparo de chaves');
        return { data: result.data, citedValuesSource, parseMethod: 'permissive_keys' };
      } catch (permissiveError) {
        const message = permissiveError instanceof Error ? permissiveError.message : 'Erro desconhecido';
        logger.error({
          error: message,
          responseHash: computeSemHash(permissive.json),
          responseLength: permissive.json.length,
          candidateLength: sanitized.json.length,
        }, 'Resposta LLM inválida após reparo de chaves JSON (hash/len).');
      }
    }
    const baseJson = permissive.json !== normalized.json ? permissive.json : normalized.json;
    const blockRepair = repairYamlLikeBlockWithoutBraces(baseJson);
    if (blockRepair.repaired) {
      try {
        logger.warn({ error: error instanceof Error ? error.message : error }, 'Resposta LLM inválida; aplicando reparo YAML-like sem chaves.');
        const parsed = JSON.parse(blockRepair.json) as Record<string, unknown>;
        const { normalized: normalizedPayload, citedValuesSource } = normalizeLlmSignalPayload(parsed);
        const result = TRADING_LLM_SIGNAL_PARTIAL_SCHEMA.safeParse(normalizedPayload);
        if (!result.success) {
          throw new Error(`Resposta LLM inválida após reparo: ${result.error.message}`);
        }
        logger.info({ parseMethod: 'yaml_block_repair', citedValuesSource }, 'Sinal de trading parseado com sucesso via reparo YAML-like sem chaves');
        return { data: result.data, citedValuesSource, parseMethod: 'yaml_block_repair' };
      } catch (blockError) {
        const message = blockError instanceof Error ? blockError.message : 'Erro desconhecido';
        logger.error({
          error: message,
          responseHash: computeSemHash(blockRepair.json),
          responseLength: blockRepair.json.length,
          candidateLength: sanitized.json.length,
        }, 'Resposta LLM inválida após reparo YAML-like sem chaves (hash/len).');
      }
    }
    const yamlRepair = repairYamlLikeObject(baseJson);
    if (yamlRepair.repaired) {
      try {
        logger.warn({ error: error instanceof Error ? error.message : error }, 'Resposta LLM inválida; aplicando reparo YAML-like.');
        const parsed = JSON.parse(yamlRepair.json) as Record<string, unknown>;
        const { normalized: normalizedPayload, citedValuesSource } = normalizeLlmSignalPayload(parsed);
        const result = TRADING_LLM_SIGNAL_PARTIAL_SCHEMA.safeParse(normalizedPayload);
        if (!result.success) {
          throw new Error(`Resposta LLM inválida após reparo: ${result.error.message}`);
        }
        logger.info({ parseMethod: 'yaml_object_repair', citedValuesSource }, 'Sinal de trading parseado com sucesso via reparo YAML-like');
        return { data: result.data, citedValuesSource, parseMethod: 'yaml_object_repair' };
      } catch (yamlError) {
        const message = yamlError instanceof Error ? yamlError.message : 'Erro desconhecido';
        logger.error({
          error: message,
          responseHash: computeSemHash(yamlRepair.json),
          responseLength: yamlRepair.json.length,
          candidateLength: sanitized.json.length,
        }, 'Resposta LLM inválida após reparo YAML-like (hash/len).');
      }
    }
    const repair = repairLlmJsonContent(baseJson);
    if (repair.repaired) {
      try {
        logger.warn({ error: error instanceof Error ? error.message : error }, 'Resposta LLM inválida; aplicando reparo seguro do JSON.');
        const parsed = JSON.parse(repair.json) as Record<string, unknown>;
        const { normalized: normalizedPayload, citedValuesSource } = normalizeLlmSignalPayload(parsed);
        const result = TRADING_LLM_SIGNAL_PARTIAL_SCHEMA.safeParse(normalizedPayload);
        if (!result.success) {
          throw new Error(`Resposta LLM inválida após reparo: ${result.error.message}`);
        }
        logger.info({ parseMethod: 'json_content_repair', citedValuesSource }, 'Sinal de trading parseado com sucesso via reparo seguro de conteúdo JSON');
        return { data: result.data, citedValuesSource, parseMethod: 'json_content_repair' };
      } catch (repairError) {
        const message = repairError instanceof Error ? repairError.message : 'Erro desconhecido';
        if (message.startsWith('Resposta LLM inválida após reparo:')) {
          throw new Error(message);
        }
        logger.error({
          error: message,
          responseHash: computeSemHash(repair.json),
          responseLength: repair.json.length,
          candidateLength: candidate.length,
        }, 'Resposta LLM inválida após reparo seguro (hash/len).');
        throw new Error(`Resposta LLM inválida após reparo: ${message}`);
      }
    }
    const rawRepair = repairYamlLikeFromRawText(rawResponse);
    if (rawRepair.repaired) {
      try {
        logger.warn({ error: error instanceof Error ? error.message : error }, 'Resposta LLM inválida; aplicando extração de chaves do texto bruto.');
        const parsed = JSON.parse(rawRepair.json) as Record<string, unknown>;
        const { normalized: normalizedPayload, citedValuesSource } = normalizeLlmSignalPayload(parsed);
        const result = TRADING_LLM_SIGNAL_PARTIAL_SCHEMA.safeParse(normalizedPayload);
        if (!result.success) {
          throw new Error(`Resposta LLM inválida após reparo: ${result.error.message}`);
        }
        logger.info({ parseMethod: 'raw_text_extraction', citedValuesSource }, 'Sinal de trading parseado com sucesso via extração de chaves do texto bruto');
        return { data: result.data, citedValuesSource, parseMethod: 'raw_text_extraction' };
      }       catch (rawError) {
        const message = rawError instanceof Error ? rawError.message : 'Erro desconhecido';
        logger.error({
          error: message,
          responseHash: computeSemHash(rawRepair.json),
          responseLength: rawRepair.json.length,
          candidateLength: baseJson.length,
        }, 'Resposta LLM inválida após extração de chaves (hash/len).');
      }
    }
    // Estágio final: jsonrepair (biblioteca battle-tested, 5M+ downloads/semana)
    // Último recurso antes de desistir - tenta reparar JSON malformado automaticamente
    try {
      const repaired = jsonrepair(rawResponse);
      const parsed = JSON.parse(repaired) as Record<string, unknown>;
      const { normalized: normalizedPayload, citedValuesSource: cvSource } = normalizeLlmSignalPayload(parsed);
      const result = TRADING_LLM_SIGNAL_PARTIAL_SCHEMA.safeParse(normalizedPayload);
      if (result.success) {
        logger.warn({ parseMethod: 'jsonrepair', citedValuesSource: cvSource }, 'Resposta LLM reparada com sucesso via jsonrepair (último recurso).');
        return { data: result.data, citedValuesSource: cvSource, parseMethod: 'jsonrepair' };
      }
      logger.error({ zodError: result.error.message }, 'jsonrepair produziu JSON válido mas Zod rejeitou.');
    } catch (jsonrepairError) {
      const jrMessage = jsonrepairError instanceof Error ? jsonrepairError.message : 'Erro desconhecido';
      logger.error({ error: jrMessage }, 'jsonrepair também falhou ao reparar resposta LLM.');
    }
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    if (message.startsWith('Resposta LLM inválida:')) {
      throw new Error(message);
    }
    logger.error({
      error: message,
      responseHash: computeSemHash(sanitized.json),
      responseLength: sanitized.json.length,
      responseSnippet: buildLlmResponseSnippet(rawResponse),
    }, 'Resposta LLM inválida (hash/len).');
    throw new Error(`Resposta LLM inválida: ${message}`);
  }
}

  return parseLlmSignalResponse;
}
