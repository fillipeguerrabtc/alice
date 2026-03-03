import type { AllocationDecision, CostEstimate } from './types.js';

export interface DecisionPacket {
  generatedAt: string;
  portfolioId?: string;
  summary: {
    decisions: number;
    noTrade: boolean;
  };
  decisions: AllocationDecision[];
  costs: Record<string, CostEstimate>;
  evidence: Record<string, unknown>;
}

export function buildDecisionPacket(input: Omit<DecisionPacket, 'generatedAt' | 'summary'>): DecisionPacket {
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      decisions: input.decisions.length,
      noTrade: input.decisions.length === 0,
    },
    ...input,
  };
}
