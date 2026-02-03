/**
 * Serviço de Validação Cruzada LLM - Alice Enterprise Platform
 * 
 * Valida se os números citados pelo LLM em análises de trading
 * correspondem aos valores REAIS calculados deterministicamente.
 * 
 * ARQUITETURA ENTERPRISE:
 * 1. LLM recebe indicadores pré-calculados
 * 2. LLM gera análise citando os valores
 * 3. Este serviço EXTRAI valores citados do texto
 * 4. COMPARA com valores reais do snapshot
 * 5. REGISTRA resultado da validação
 * 
 * Autor: Fillipe Guerra
 * Data: 21 de Dezembro de 2025
 * Regra 6: Persistência real, sem mocks
 * Regra 8: TypeScript strict, zero any
 */

import { createLogger } from '@alice/logger';
import { getDatabase, schema, eq } from '@alice/database';
import type { TechnicalAnalysisResult } from './technical-indicators.js';

const logger = createLogger('llm-validation');

// ============================================================================
// TIPOS
// ============================================================================

/** Valores extraídos da resposta do LLM */
export interface ExtractedLLMValues {
  rsi?: number;
  macdLine?: number;
  macdSignal?: number;
  macdHistogram?: number;
  ema9?: number;
  ema21?: number;
  ema50?: number;
  ema200?: number;
  sma20?: number;
  sma50?: number;
  sma200?: number;
  bollingerUpper?: number;
  bollingerMiddle?: number;
  bollingerLower?: number;
  bollingerPercentB?: number;
  atrValue?: number;
  atrPercentage?: number;
  stochasticK?: number;
  stochasticD?: number;
  adxValue?: number;
  pivotPoint?: number;
  resistance1?: number;
  resistance2?: number;
  resistance3?: number;
  support1?: number;
  support2?: number;
  support3?: number;
  volumeRatio?: number;
  currentPrice?: number;
}

/** Resultado de validação de um único campo */
export interface FieldValidation {
  field: string;
  citedValue: number;
  actualValue: number;
  difference: number;
  percentageDiff: number;
  allowedDeviation: number;
  isValid: boolean;
}

/** Resultado completo da validação */
export interface ValidationResult {
  passed: boolean;
  totalFields: number;
  validFields: number;
  invalidFields: number;
  details: FieldValidation[];
  discrepancies: Record<string, { cited: number; actual: number; diff: number }>;
  maxDeviationFound: number;
  overallAccuracy: number;
  /** BUG FIX 21/12/2025: Flag para indicar que não havia valores numéricos para validar */
  noValuesExtracted: boolean;
  failureReason: 'ok' | 'no_values' | 'discrepancy';
  extractionSource: 'llm_payload' | 'regex';
  allowedDeviationByField: Record<string, number>;
}

/** Parâmetros para validação */
export interface ValidateParams {
  tenantId: string;
  llmResponse: string;
  citedValues?: ExtractedLLMValues;
  indicatorSnapshot: TechnicalAnalysisResult;
  indicatorSnapshotId?: string;
  signalId?: string;
  conversationId?: string;
  timeframeUsed?: string;
  extractionSource?: 'llm_payload' | 'regex';
  maxAllowedDeviation?: number;
}

const DEFAULT_PERCENT_TOLERANCE = 0.01;
const FIELD_TOLERANCES: Record<string, { percent?: number; absolute?: number }> = {
  rsi: { absolute: 0.5 },
  macdLine: { absolute: 0.05 },
  macdSignal: { absolute: 0.05 },
  macdHistogram: { absolute: 0.05 },
  atrPercentage: { absolute: 0.2 },
  bollingerPercentB: { absolute: 0.02 },
  stochasticK: { absolute: 0.5 },
  stochasticD: { absolute: 0.5 },
  adxValue: { absolute: 0.5 },
  volumeRatio: { percent: 0.05 },
};

function resolveAllowedDeviation(field: string, actualValue: number, percentFallback: number): number {
  const config = FIELD_TOLERANCES[field];
  const percent = config?.percent ?? percentFallback;
  const absolute = config?.absolute ?? 0;
  const percentDeviation = Math.abs(actualValue) > 0 ? percent * Math.abs(actualValue) : percent;
  return Math.max(percentDeviation, absolute);
}

// ============================================================================
// EXTRAÇÃO DE VALORES DO TEXTO LLM
// ============================================================================

/**
 * Extrai valores numéricos citados pelo LLM no texto de resposta
 * Usa regex patterns para encontrar números associados a indicadores
 */
export function extractValuesFromLLMResponse(text: string): ExtractedLLMValues {
  const extracted: ExtractedLLMValues = {};
  
  // Normalizar texto para facilitar parsing
  const normalizedText = text
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();

  // Patterns para cada indicador
  // RSI
  const rsiMatch = normalizedText.match(/rsi[^0-9]*(\d+(?:\.\d+)?)/i);
  if (rsiMatch) extracted.rsi = parseFloat(rsiMatch[1]);

  // MACD
  const macdLineMatch = text.match(/macd\s*(?:line)?[:\s]*(-?\d+(?:\.\d+)?)/i);
  if (macdLineMatch) extracted.macdLine = parseFloat(macdLineMatch[1]);
  
  const macdSignalMatch = text.match(/signal[:\s]*(-?\d+(?:\.\d+)?)/i);
  if (macdSignalMatch) extracted.macdSignal = parseFloat(macdSignalMatch[1]);
  
  const macdHistMatch = text.match(/histograma?[:\s]*(-?\d+(?:\.\d+)?)/i);
  if (macdHistMatch) extracted.macdHistogram = parseFloat(macdHistMatch[1]);

  // EMAs
  const ema9Match = text.match(/ema\s*9[:\s]*\$?(\d+(?:\.\d+)?)/i);
  if (ema9Match) extracted.ema9 = parseFloat(ema9Match[1]);
  
  const ema21Match = text.match(/ema\s*21[:\s]*\$?(\d+(?:\.\d+)?)/i);
  if (ema21Match) extracted.ema21 = parseFloat(ema21Match[1]);
  
  const ema50Match = text.match(/ema\s*50[:\s]*\$?(\d+(?:\.\d+)?)/i);
  if (ema50Match) extracted.ema50 = parseFloat(ema50Match[1]);
  
  const ema200Match = text.match(/ema\s*200[:\s]*\$?(\d+(?:\.\d+)?)/i);
  if (ema200Match) extracted.ema200 = parseFloat(ema200Match[1]);

  // SMAs
  const sma20Match = text.match(/sma\s*20[:\s]*\$?(\d+(?:\.\d+)?)/i);
  if (sma20Match) extracted.sma20 = parseFloat(sma20Match[1]);
  
  const sma50Match = text.match(/sma\s*50[:\s]*\$?(\d+(?:\.\d+)?)/i);
  if (sma50Match) extracted.sma50 = parseFloat(sma50Match[1]);
  
  const sma200Match = text.match(/sma\s*200[:\s]*\$?(\d+(?:\.\d+)?)/i);
  if (sma200Match) extracted.sma200 = parseFloat(sma200Match[1]);

  // Bollinger Bands
  const bbUpperMatch = text.match(/(?:bollinger|banda)\s*(?:superior|upper)[:\s]*\$?(\d+(?:\.\d+)?)/i);
  if (bbUpperMatch) extracted.bollingerUpper = parseFloat(bbUpperMatch[1]);
  
  const bbMiddleMatch = text.match(/(?:bollinger|banda)\s*(?:m[eé]dia|middle)[:\s]*\$?(\d+(?:\.\d+)?)/i);
  if (bbMiddleMatch) extracted.bollingerMiddle = parseFloat(bbMiddleMatch[1]);
  
  const bbLowerMatch = text.match(/(?:bollinger|banda)\s*(?:inferior|lower)[:\s]*\$?(\d+(?:\.\d+)?)/i);
  if (bbLowerMatch) extracted.bollingerLower = parseFloat(bbLowerMatch[1]);
  
  const percentBMatch = text.match(/%b[:\s]*(\d+(?:\.\d+)?)/i);
  if (percentBMatch) extracted.bollingerPercentB = parseFloat(percentBMatch[1]);

  // ATR
  const atrMatch = text.match(/atr[^0-9]*\$?(\d+(?:\.\d+)?)/i);
  if (atrMatch) extracted.atrValue = parseFloat(atrMatch[1]);
  
  const atrPercMatch = text.match(/atr[^%]*(\d+(?:\.\d+)?)\s*%/i);
  if (atrPercMatch) extracted.atrPercentage = parseFloat(atrPercMatch[1]);

  // Stochastic
  const stochKMatch = text.match(/(?:stochastic|estoc[aá]stico)\s*k[:\s]*(\d+(?:\.\d+)?)/i);
  if (stochKMatch) extracted.stochasticK = parseFloat(stochKMatch[1]);
  
  const stochDMatch = text.match(/(?:stochastic|estoc[aá]stico)\s*d[:\s]*(\d+(?:\.\d+)?)/i);
  if (stochDMatch) extracted.stochasticD = parseFloat(stochDMatch[1]);

  // ADX
  const adxMatch = text.match(/adx[:\s]*(\d+(?:\.\d+)?)/i);
  if (adxMatch) extracted.adxValue = parseFloat(adxMatch[1]);

  // Pivot Points
  const pivotMatch = text.match(/pivot[:\s]*\$?(\d+(?:\.\d+)?)/i);
  if (pivotMatch) extracted.pivotPoint = parseFloat(pivotMatch[1]);
  
  const r1Match = text.match(/r1[:\s]*\$?(\d+(?:\.\d+)?)/i);
  if (r1Match) extracted.resistance1 = parseFloat(r1Match[1]);
  
  const r2Match = text.match(/r2[:\s]*\$?(\d+(?:\.\d+)?)/i);
  if (r2Match) extracted.resistance2 = parseFloat(r2Match[1]);
  
  const r3Match = text.match(/r3[:\s]*\$?(\d+(?:\.\d+)?)/i);
  if (r3Match) extracted.resistance3 = parseFloat(r3Match[1]);
  
  const s1Match = text.match(/s1[:\s]*\$?(\d+(?:\.\d+)?)/i);
  if (s1Match) extracted.support1 = parseFloat(s1Match[1]);
  
  const s2Match = text.match(/s2[:\s]*\$?(\d+(?:\.\d+)?)/i);
  if (s2Match) extracted.support2 = parseFloat(s2Match[1]);
  
  const s3Match = text.match(/s3[:\s]*\$?(\d+(?:\.\d+)?)/i);
  if (s3Match) extracted.support3 = parseFloat(s3Match[1]);

  // Volume
  const volRatioMatch = text.match(/(?:volume\s*)?ratio[:\s]*(\d+(?:\.\d+)?)/i);
  if (volRatioMatch) extracted.volumeRatio = parseFloat(volRatioMatch[1]);

  // Preço atual
  const priceMatch = text.match(/pre[çc]o\s*(?:atual)?[:\s]*\$?(\d+(?:,\d+)?(?:\.\d+)?)/i);
  if (priceMatch) {
    extracted.currentPrice = parseFloat(priceMatch[1].replace(',', ''));
  }

  return extracted;
}

/**
 * Converte valores do snapshot de análise técnica para formato comparável
 */
function snapshotToComparableValues(snapshot: TechnicalAnalysisResult): Record<string, number> {
  const values: Record<string, number> = {
    currentPrice: snapshot.currentPrice,
  };

  if (snapshot.rsi) values.rsi = snapshot.rsi.value;
  if (snapshot.macd) {
    values.macdLine = snapshot.macd.macd;
    values.macdSignal = snapshot.macd.signal;
    values.macdHistogram = snapshot.macd.histogram;
  }
  if (snapshot.movingAverages) {
    values.ema9 = snapshot.movingAverages.ema9;
    values.ema21 = snapshot.movingAverages.ema21;
    values.ema50 = snapshot.movingAverages.ema50;
    values.ema200 = snapshot.movingAverages.ema200;
    values.sma20 = snapshot.movingAverages.sma20;
    values.sma50 = snapshot.movingAverages.sma50;
    values.sma200 = snapshot.movingAverages.sma200;
  }
  if (snapshot.bollinger) {
    values.bollingerUpper = snapshot.bollinger.upper;
    values.bollingerMiddle = snapshot.bollinger.middle;
    values.bollingerLower = snapshot.bollinger.lower;
    values.bollingerPercentB = snapshot.bollinger.percentB;
  }
  if (snapshot.atr) {
    values.atrValue = snapshot.atr.value;
    values.atrPercentage = snapshot.atr.percentage;
  }
  if (snapshot.stochastic) {
    values.stochasticK = snapshot.stochastic.k;
    values.stochasticD = snapshot.stochastic.d;
  }
  if (snapshot.adx) {
    values.adxValue = snapshot.adx.adx;
  }
  if (snapshot.supportResistance) {
    values.pivotPoint = snapshot.supportResistance.pivot;
    values.resistance1 = snapshot.supportResistance.resistance1;
    values.resistance2 = snapshot.supportResistance.resistance2;
    values.resistance3 = snapshot.supportResistance.resistance3;
    values.support1 = snapshot.supportResistance.support1;
    values.support2 = snapshot.supportResistance.support2;
    values.support3 = snapshot.supportResistance.support3;
  }
  if (snapshot.volume) {
    values.volumeRatio = snapshot.volume.volumeRatio;
  }

  return values;
}

// ============================================================================
// VALIDAÇÃO
// ============================================================================

/**
 * Valida se os valores citados pelo LLM correspondem aos valores reais
 * 
 * @param extractedValues - Valores extraídos do texto do LLM
 * @param actualValues - Valores reais calculados
 * @param maxDeviation - Desvio máximo permitido (padrão: 1%)
 */
export function validateValues(
  extractedValues: ExtractedLLMValues,
  actualValues: Record<string, number>,
  maxDeviation = DEFAULT_PERCENT_TOLERANCE,
  extractionSource: 'llm_payload' | 'regex' = 'regex'
): ValidationResult {
  const details: FieldValidation[] = [];
  const discrepancies: Record<string, { cited: number; actual: number; diff: number }> = {};
  let maxDeviationFound = 0;
  const allowedDeviationByField: Record<string, number> = {};

  for (const [field, citedValue] of Object.entries(extractedValues)) {
    if (citedValue === undefined || citedValue === null) continue;
    
    const actualValue = actualValues[field];
    if (actualValue === undefined || actualValue === null) continue;

    const difference = Math.abs(citedValue - actualValue);
    const percentageDiff = actualValue !== 0 
      ? (difference / Math.abs(actualValue)) 
      : (citedValue !== 0 ? 1 : 0);
    const allowedDeviation = resolveAllowedDeviation(field, actualValue, maxDeviation);
    allowedDeviationByField[field] = allowedDeviation;
    const isValid = difference <= allowedDeviation;

    if (percentageDiff > maxDeviationFound) {
      maxDeviationFound = percentageDiff;
    }

    details.push({
      field,
      citedValue,
      actualValue,
      difference,
      percentageDiff,
      allowedDeviation,
      isValid,
    });

    if (!isValid) {
      discrepancies[field] = {
        cited: citedValue,
        actual: actualValue,
        diff: percentageDiff,
      };
    }
  }

  const totalFields = details.length;
  const validFields = details.filter(d => d.isValid).length;
  const invalidFields = totalFields - validFields;
  
  // BUG FIX 21/12/2025: Se totalFields === 0, marcar como falha (não há valores para validar)
  // Isso evita que respostas vagas do LLM sejam aprovadas sem validação real
  const overallAccuracy = totalFields > 0 ? validFields / totalFields : 0;
  const passed = totalFields > 0 && invalidFields === 0;
  const noValuesExtracted = totalFields === 0;

  return {
    passed,
    totalFields,
    validFields,
    invalidFields,
    details,
    discrepancies,
    maxDeviationFound,
    overallAccuracy,
    // BUG FIX 21/12/2025: Flag para indicar que não havia valores para validar
    noValuesExtracted,
    failureReason: passed ? 'ok' : (noValuesExtracted ? 'no_values' : 'discrepancy'),
    extractionSource,
    allowedDeviationByField,
  };
}

// ============================================================================
// SERVIÇO PRINCIPAL
// ============================================================================

/**
 * Valida resposta do LLM e persiste resultado
 * 
 * @returns ID do registro de validação criado
 */
export async function validateAndPersist(params: ValidateParams): Promise<{
  validationId: string;
  result: ValidationResult;
  actionTaken: 'approved' | 'rejected' | 'flagged_for_review';
}> {
  const {
    tenantId,
    llmResponse,
    citedValues,
    indicatorSnapshot,
    indicatorSnapshotId,
    signalId,
    conversationId,
    timeframeUsed,
    extractionSource: extractionSourceOverride,
    maxAllowedDeviation = 0.01,
  } = params;

  logger.info({ tenantId, signalId }, 'Iniciando validação cruzada de resposta LLM');

  // 1. Extrair valores citados pelo LLM
  const extractionSource: 'llm_payload' | 'regex' = extractionSourceOverride ?? (citedValues ? 'llm_payload' : 'regex');
  const extractedValues = citedValues ?? extractValuesFromLLMResponse(llmResponse);
  const extractedCount = Object.keys(extractedValues).filter(k => 
    extractedValues[k as keyof ExtractedLLMValues] !== undefined
  ).length;

  logger.debug({ extractedCount, extractedValues }, 'Valores extraídos do texto LLM');

  // 2. Obter valores reais do snapshot
  const actualValues = snapshotToComparableValues(indicatorSnapshot);

  // 3. Validar
  const result = validateValues(extractedValues, actualValues, maxAllowedDeviation, extractionSource);

  // 4. Determinar ação
  let actionTaken: 'approved' | 'rejected' | 'flagged_for_review';
  if (result.passed) {
    actionTaken = 'approved';
  } else if (result.overallAccuracy >= 0.8) {
    // Se 80%+ dos valores estão corretos, marcar para review manual
    actionTaken = 'flagged_for_review';
  } else {
    actionTaken = 'rejected';
  }

  const resolvedTimeframeUsed = timeframeUsed ?? indicatorSnapshot.interval;

  // 5. Persistir resultado
  const db = getDatabase();
  const [validation] = await db
    .insert(schema.tradingLlmValidations)
    .values({
      tenantId,
      signalId,
      indicatorSnapshotId,
      conversationId,
      llmCitedValues: extractedValues as Record<string, number>,
      actualValues,
      validationPassed: result.passed,
      discrepancies: Object.keys(result.discrepancies).length > 0 ? result.discrepancies : null,
      maxAllowedDeviation,
      failureReason: result.failureReason,
      extractionSource: result.extractionSource,
      noValuesExtracted: result.noValuesExtracted,
      overallAccuracy: result.overallAccuracy,
      failedFields: Object.keys(result.discrepancies ?? {}),
      timeframeUsed: resolvedTimeframeUsed,
      allowedDeviationByField: Object.keys(result.allowedDeviationByField).length > 0 ? result.allowedDeviationByField : null,
      maxDeviationFound: result.maxDeviationFound,
      actionTaken,
    })
    .returning({ id: schema.tradingLlmValidations.id });

  logger.info({
    tenantId,
    validationId: validation?.id,
    passed: result.passed,
    accuracy: result.overallAccuracy,
    actionTaken,
    invalidFields: result.invalidFields,
  }, 'Validação cruzada LLM concluída');

  return {
    validationId: validation?.id ?? '',
    result,
    actionTaken,
  };
}

/**
 * Obtém estatísticas de validação para um tenant
 */
export async function getValidationStats(tenantId: string): Promise<{
  totalValidations: number;
  passedValidations: number;
  failedValidations: number;
  accuracyRate: number;
  commonDiscrepancies: Array<{ field: string; count: number }>;
}> {
  const db = getDatabase();
  
  const validations = await db
    .select()
    .from(schema.tradingLlmValidations)
    .where(eq(schema.tradingLlmValidations.tenantId, tenantId));

  const totalValidations = validations.length;
  const passedValidations = validations.filter(v => v.validationPassed).length;
  const failedValidations = totalValidations - passedValidations;
  const accuracyRate = totalValidations > 0 ? (passedValidations / totalValidations) * 100 : 100;

  // Contar campos com discrepâncias frequentes
  const fieldCounts: Record<string, number> = {};
  for (const v of validations) {
    if (v.discrepancies) {
      for (const field of Object.keys(v.discrepancies as Record<string, unknown>)) {
        fieldCounts[field] = (fieldCounts[field] || 0) + 1;
      }
    }
  }

  const commonDiscrepancies = Object.entries(fieldCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([field, count]) => ({ field, count }));

  return {
    totalValidations,
    passedValidations,
    failedValidations,
    accuracyRate: Math.round(accuracyRate * 100) / 100,
    commonDiscrepancies,
  };
}

