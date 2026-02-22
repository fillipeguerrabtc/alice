import type { CandidateSignal, CostEstimate, TradingOperationIntent } from '../core/types.js';

export interface IntentSelectionInput {
  candidates: CandidateSignal[];
  costsByInstrument: Record<string, CostEstimate>;
  allowedIntents: TradingOperationIntent[];
  crossExchangeEnabled: boolean;
}

export interface IntentSelectionResult {
  candidate: CandidateSignal | null;
  edgeNet: number | null;
  selectedIntent: TradingOperationIntent | null;
  evaluated: number;
  rejectedByIntent: number;
  rejectedByGuardrails: number;
}

const DSR_MIN_THRESHOLD = 0;
const PBO_MAX_THRESHOLD = 0.7;
const SCORE_EDGE_MULTIPLIER = 10_000;
const SCORE_CONFIDENCE_MULTIPLIER = 100;
const SCORE_DSR_MULTIPLIER = 10;
const SCORE_PBO_PENALTY_MULTIPLIER = 20;
const SCORE_BIAS_MULTIPLIER = 100;

function baseIntentBias(intent: TradingOperationIntent): number {
  switch (intent) {
    case 'scalping':
      return 0.08;
    case 'intraday':
      return 0.06;
    case 'swing':
      return 0.04;
    case 'positional':
      return 0.03;
    case 'arbitrage_internal':
      return 0.05;
    case 'arbitrage_cross_exchange':
      return 0.04;
    case 'cash_and_carry':
      return 0.05;
    case 'market_neutral':
      return 0.03;
    case 'volatility_breakout':
      return 0.06;
    default:
      return 0;
  }
}

function timeframeBias(timeframe: string): number {
  if (timeframe === '1m' || timeframe === '3m' || timeframe === '5m') return 0.03;
  if (timeframe === '15m' || timeframe === '30m' || timeframe === '1h') return 0.02;
  if (timeframe === '4h' || timeframe === '8h' || timeframe === '12h') return 0.01;
  return 0;
}

function applyInstitutionalGuardrails(input: { edgeNet: number; dsrScore?: number | null; pboScore?: number | null }): boolean {
  if (input.edgeNet <= 0) return false;
  if ((input.dsrScore ?? DSR_MIN_THRESHOLD) < DSR_MIN_THRESHOLD) return false;
  if ((input.pboScore ?? 1) > PBO_MAX_THRESHOLD) return false;
  return true;
}

export function selectAutoIntentCandidate(input: IntentSelectionInput): IntentSelectionResult {
  let evaluated = 0;
  let rejectedByIntent = 0;
  let rejectedByGuardrails = 0;

  const allowed = new Set(input.allowedIntents);
  let best: { candidate: CandidateSignal; edgeNet: number; score: number } | null = null;

  for (const candidate of input.candidates) {
    evaluated += 1;
    if (!allowed.has(candidate.operationIntent)) {
      rejectedByIntent += 1;
      continue;
    }
    if (candidate.operationIntent === 'arbitrage_cross_exchange' && !input.crossExchangeEnabled) {
      rejectedByIntent += 1;
      continue;
    }

    const cost = input.costsByInstrument[candidate.instrumentId];
    const edgeNet = candidate.expectedEdge - ((cost?.totalBps ?? 0) / 10_000);
    if (!applyInstitutionalGuardrails({ edgeNet, dsrScore: candidate.dsrScore, pboScore: candidate.pboScore })) {
      rejectedByGuardrails += 1;
      continue;
    }

    const confidence = candidate.confidenceCalibrated ?? candidate.confidenceRaw;
    const score = (edgeNet * SCORE_EDGE_MULTIPLIER)
      + (confidence * SCORE_CONFIDENCE_MULTIPLIER)
      + ((candidate.dsrScore ?? 0) * SCORE_DSR_MULTIPLIER)
      - ((candidate.pboScore ?? 0) * SCORE_PBO_PENALTY_MULTIPLIER)
      + (baseIntentBias(candidate.operationIntent) * SCORE_BIAS_MULTIPLIER)
      + (timeframeBias(candidate.timeframe) * SCORE_BIAS_MULTIPLIER);

    if (!best || score > best.score) {
      best = { candidate, edgeNet, score };
    }
  }

  return {
    candidate: best?.candidate ?? null,
    edgeNet: best?.edgeNet ?? null,
    selectedIntent: best?.candidate.operationIntent ?? null,
    evaluated,
    rejectedByIntent,
    rejectedByGuardrails,
  };
}
