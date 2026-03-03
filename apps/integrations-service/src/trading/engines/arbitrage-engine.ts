import type { TradingOperationIntent } from '../core/types.js';

export interface ArbitrageLeg {
  symbol: string;
  bid: number;
  ask: number;
  venue: string;
}

export interface ArbitrageCandidate {
  operationIntent: TradingOperationIntent;
  expectedEdgeBps: number;
  netEdgeBps: number;
  riskFlags: string[];
  details: Record<string, unknown>;
}

function bps(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return (numerator / denominator) * 10_000;
}

export function evaluateTriangularArbitrage(input: {
  cycle: [ArbitrageLeg, ArbitrageLeg, ArbitrageLeg];
  takerFeeBps: number;
  slippageBps: number;
}): ArbitrageCandidate {
  const [legA, legB, legC] = input.cycle;
  const cycleCostBps = (input.takerFeeBps * 3) + input.slippageBps;

  const synthetic = legA.ask * legB.ask;
  const direct = legC.bid;
  const expectedEdgeBps = bps(direct - synthetic, synthetic);
  const netEdgeBps = expectedEdgeBps - cycleCostBps;
  const riskFlags: string[] = [];

  if (netEdgeBps <= 0) {
    riskFlags.push('net_edge_non_positive');
  }

  return {
    operationIntent: 'arbitrage_internal',
    expectedEdgeBps,
    netEdgeBps,
    riskFlags,
    details: {
      venue: legA.venue,
      cycleSymbols: [legA.symbol, legB.symbol, legC.symbol],
      cycleCostBps,
    },
  };
}

export function evaluateCashAndCarry(input: {
  spotPrice: number;
  futuresPrice: number;
  fundingBps: number;
  feeBps: number;
  holdingDays: number;
}): ArbitrageCandidate {
  const basisBps = bps(input.futuresPrice - input.spotPrice, input.spotPrice);
  const fundingCostBps = input.fundingBps * Math.max(1, input.holdingDays);
  const netEdgeBps = basisBps - fundingCostBps - input.feeBps;
  const riskFlags: string[] = [];

  if (netEdgeBps <= 0) riskFlags.push('basis_not_enough');
  if (input.holdingDays > 7) riskFlags.push('transfer_time_risk');

  return {
    operationIntent: 'cash_and_carry',
    expectedEdgeBps: basisBps,
    netEdgeBps,
    riskFlags,
    details: {
      spotPrice: input.spotPrice,
      futuresPrice: input.futuresPrice,
      fundingCostBps,
      holdingDays: input.holdingDays,
    },
  };
}

export function evaluateCrossExchangeArbitrage(input: {
  buyVenue: string;
  sellVenue: string;
  buyAsk: number;
  sellBid: number;
  feeBps: number;
  withdrawCostBps: number;
  transferRiskFlag?: boolean;
}): ArbitrageCandidate {
  const expectedEdgeBps = bps(input.sellBid - input.buyAsk, input.buyAsk);
  const netEdgeBps = expectedEdgeBps - input.feeBps - input.withdrawCostBps;
  const riskFlags: string[] = [];

  if (netEdgeBps <= 0) riskFlags.push('net_edge_non_positive');
  if (input.transferRiskFlag) riskFlags.push('transfer_latency_risk');

  return {
    operationIntent: 'arbitrage_cross_exchange',
    expectedEdgeBps,
    netEdgeBps,
    riskFlags,
    details: {
      buyVenue: input.buyVenue,
      sellVenue: input.sellVenue,
      feeBps: input.feeBps,
      withdrawCostBps: input.withdrawCostBps,
    },
  };
}
