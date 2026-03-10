import type {
  TradingEnsembleConfig,
  TradingEnsembleResult,
  TradingOverallSignal,
  TradingProfileConsensus,
  TradingTechnique,
  TradingTechniqueScore,
} from '@alice/shared';
import * as technicalIndicators from './technical-indicators.js';

type TradingIntervalValue =
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '8h'
  | '12h'
  | '1d'
  | '1w';

export type AnalysisMatrixEntry = {
  interval: TradingIntervalValue;
  analysis: technicalIndicators.TechnicalAnalysisResult;
  indicatorId: string;
  resolvedSymbol?: string;
};

export function buildMajorityConsensus(
  matrix: AnalysisMatrixEntry[],
  consensusConfig?: TradingProfileConsensus
): {
  overallSignal: technicalIndicators.TechnicalAnalysisResult['overallSignal'];
  confidence: number;
  alignedTimeframes: TradingIntervalValue[];
  misalignedTimeframes: TradingIntervalValue[];
  agreementRatio: number;
  requiredAgree: number;
  totalTimeframes: number;
  isMajorityReached: boolean;
} {
  const total = matrix.length;
  const requiredAgree = consensusConfig?.minAgree ?? Math.floor(total / 2) + 1;
  const counts = new Map<technicalIndicators.TechnicalAnalysisResult['overallSignal'], number>();
  const signalsByFrame = new Map<TradingIntervalValue, technicalIndicators.TechnicalAnalysisResult['overallSignal']>();

  for (const entry of matrix) {
    const signal = entry.analysis.overallSignal;
    counts.set(signal, (counts.get(signal) ?? 0) + 1);
    signalsByFrame.set(entry.interval, signal);
  }

  let maxCount = 0;
  let winners: technicalIndicators.TechnicalAnalysisResult['overallSignal'][] = [];
  for (const [signal, count] of counts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      winners = [signal];
    } else if (count === maxCount) {
      winners.push(signal);
    }
  }

  const isMajorityReached = maxCount >= requiredAgree && winners.length === 1;
  const consensusSignal = isMajorityReached ? winners[0] : 'neutral';

  const alignedTimeframes = Array.from(signalsByFrame.entries())
    .filter(([, signal]) => signal === consensusSignal)
    .map(([interval]) => interval);
  const misalignedTimeframes = Array.from(signalsByFrame.entries())
    .filter(([, signal]) => signal !== consensusSignal)
    .map(([interval]) => interval);

  const alignedEntries = matrix.filter((entry) => alignedTimeframes.includes(entry.interval));
  const confidence = alignedEntries.length > 0
    ? alignedEntries.reduce((sum, entry) => sum + entry.analysis.confidence, 0) / alignedEntries.length
    : 0;
  const agreementRatio = total > 0 ? maxCount / total : 0;

  return {
    overallSignal: consensusSignal,
    confidence: Math.round(confidence * 100) / 100,
    alignedTimeframes,
    misalignedTimeframes,
    agreementRatio: Math.round(agreementRatio * 100) / 100,
    requiredAgree,
    totalTimeframes: total,
    isMajorityReached,
  };
}

export function aggregateTechniqueScores(matrix: AnalysisMatrixEntry[], techniques: TradingTechnique[]): TradingTechniqueScore[] {
  const perFrame = matrix.map((entry) => technicalIndicators.calculateTechniqueScores({
    analysis: entry.analysis,
    techniques,
  }));

  return techniques
    .filter((technique) => technique !== 'arbitrage_triangular')
    .map((technique) => {
      const scores = perFrame
        .map((list) => list.find((item) => item.technique === technique))
        .filter((item): item is TradingTechniqueScore => Boolean(item));
      if (scores.length === 0) {
        return { technique, signal: 'neutral', confidence: 0 };
      }
      const weightMap = new Map<TradingOverallSignal, number>();
      let confidenceSum = 0;
      for (const score of scores) {
        confidenceSum += score.confidence;
        weightMap.set(score.signal, (weightMap.get(score.signal) ?? 0) + score.confidence);
      }
      let bestSignal: TradingOverallSignal = 'neutral';
      let bestWeight = -1;
      for (const [signal, weight] of weightMap.entries()) {
        if (weight > bestWeight) {
          bestWeight = weight;
          bestSignal = signal;
        }
      }
      const avgConfidence = confidenceSum / scores.length;
      return {
        technique,
        signal: bestSignal,
        confidence: Math.round(avgConfidence * 100) / 100,
      };
    });
}

export function buildEnsembleResult(
  scores: TradingTechniqueScore[],
  config: TradingEnsembleConfig
): TradingEnsembleResult {
  const sorted = [...scores].sort((a, b) => b.confidence - a.confidence);
  const topTechniques = sorted.slice(0, Math.max(1, config.topN));
  const weightMap = new Map<TradingOverallSignal, number>();
  let confidenceSum = 0;
  for (const score of topTechniques) {
    confidenceSum += score.confidence;
    weightMap.set(score.signal, (weightMap.get(score.signal) ?? 0) + score.confidence);
  }
  let bestSignal: TradingOverallSignal = 'neutral';
  let bestWeight = -1;
  for (const [signal, weight] of weightMap.entries()) {
    if (weight > bestWeight) {
      bestWeight = weight;
      bestSignal = signal;
    }
  }
  const avgConfidence = topTechniques.length > 0 ? confidenceSum / topTechniques.length : 0;
  return {
    overallSignal: bestSignal,
    confidence: Math.round(avgConfidence * 100) / 100,
    topTechniques,
  };
}
