import type { CostEstimate } from '../core/types.js';

export function estimateCosts(params: {
  feeBps: number;
  slippageBps: number;
  spreadBps: number;
  fundingBorrowBps?: number | null;
}): CostEstimate {
  const totalBps = params.feeBps + params.slippageBps + params.spreadBps + (params.fundingBorrowBps ?? 0);
  return {
    feeBps: params.feeBps,
    slippageBps: params.slippageBps,
    spreadBps: params.spreadBps,
    fundingBorrowBps: params.fundingBorrowBps ?? null,
    totalBps,
  };
}
