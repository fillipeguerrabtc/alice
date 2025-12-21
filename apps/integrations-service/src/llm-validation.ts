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
}

/** Parâmetros para validação */
export interface ValidateParams {
  tenantId: string;
  llmResponse: string;
  indicatorSnapshot: TechnicalAnalysisResult;
  indicatorSnapshotId?: string;
  signalId?: string;
  conversationId?: string;
  maxAllowedDeviation?: number;
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
  return {
    rsi: snapshot.rsi.value,
    macdLine: snapshot.macd.macd,
    macdSignal: snapshot.macd.signal,
    macdHistogram: snapshot.macd.histogram,
    ema9: snapshot.movingAverages.ema9,
    ema21: snapshot.movingAverages.ema21,
    ema50: snapshot.movingAverages.ema50,
    ema200: snapshot.movingAverages.ema200,
    sma20: snapshot.movingAverages.sma20,
    sma50: snapshot.movingAverages.sma50,
    sma200: snapshot.movingAverages.sma200,
    bollingerUpper: snapshot.bollinger.upper,
    bollingerMiddle: snapshot.bollinger.middle,
    bollingerLower: snapshot.bollinger.lower,
    bollingerPercentB: snapshot.bollinger.percentB,
    atrValue: snapshot.atr.value,
    atrPercentage: snapshot.atr.percentage,
    stochasticK: snapshot.stochastic.k,
    stochasticD: snapshot.stochastic.d,
    adxValue: snapshot.adx.adx,
    pivotPoint: snapshot.supportResistance.pivot,
    resistance1: snapshot.supportResistance.resistance1,
    resistance2: snapshot.supportResistance.resistance2,
    resistance3: snapshot.supportResistance.resistance3,
    support1: snapshot.supportResistance.support1,
    support2: snapshot.supportResistance.support2,
    support3: snapshot.supportResistance.support3,
    volumeRatio: snapshot.volume.volumeRatio,
    currentPrice: snapshot.currentPrice,
  };
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
  maxDeviation = 0.01
): ValidationResult {
  const details: FieldValidation[] = [];
  const discrepancies: Record<string, { cited: number; actual: number; diff: number }> = {};
  let maxDeviationFound = 0;

  for (const [field, citedValue] of Object.entries(extractedValues)) {
    if (citedValue === undefined || citedValue === null) continue;
    
    const actualValue = actualValues[field];
    if (actualValue === undefined || actualValue === null) continue;

    const difference = Math.abs(citedValue - actualValue);
    const percentageDiff = actualValue !== 0 
      ? (difference / Math.abs(actualValue)) 
      : (citedValue !== 0 ? 1 : 0);
    
    const isValid = percentageDiff <= maxDeviation;

    if (percentageDiff > maxDeviationFound) {
      maxDeviationFound = percentageDiff;
    }

    details.push({
      field,
      citedValue,
      actualValue,
      difference,
      percentageDiff,
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
  const overallAccuracy = totalFields > 0 ? validFields / totalFields : 1;
  const passed = invalidFields === 0;

  return {
    passed,
    totalFields,
    validFields,
    invalidFields,
    details,
    discrepancies,
    maxDeviationFound,
    overallAccuracy,
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
    indicatorSnapshot,
    indicatorSnapshotId,
    signalId,
    conversationId,
    maxAllowedDeviation = 0.01,
  } = params;

  logger.info({ tenantId, signalId }, 'Iniciando validação cruzada de resposta LLM');

  // 1. Extrair valores citados pelo LLM
  const extractedValues = extractValuesFromLLMResponse(llmResponse);
  const extractedCount = Object.keys(extractedValues).filter(k => 
    extractedValues[k as keyof ExtractedLLMValues] !== undefined
  ).length;

  logger.debug({ extractedCount, extractedValues }, 'Valores extraídos do texto LLM');

  // 2. Obter valores reais do snapshot
  const actualValues = snapshotToComparableValues(indicatorSnapshot);

  // 3. Validar
  const result = validateValues(extractedValues, actualValues, maxAllowedDeviation);

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

