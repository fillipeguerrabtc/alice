import { tradingMarketTypeEnum, tradingMarginModeEnum } from '@alice/shared/schema';

export type TradingMarketType = typeof tradingMarketTypeEnum.enumValues[number];
export type TradingMarginMode = typeof tradingMarginModeEnum.enumValues[number];

export type PortfolioMode = 'risk_parity' | 'signal_weighted';

export interface InstrumentConstraint {
  instrumentId: string;
  venue: string;
  symbol: string;
  marketType: TradingMarketType;
  marginMode?: TradingMarginMode | null;
  minNotional?: number;
  tickSize?: number;
  lotSize?: number;
  status: 'ok' | 'unknown';
}

export interface CandidateSignal {
  instrumentId: string;
  symbol: string;
  marketType: TradingMarketType;
  side: 'long' | 'short' | 'neutral';
  expectedEdge: number;
  confidenceRaw: number;
  confidenceCalibrated?: number | null;
  dsrScore?: number | null;
  pboScore?: number | null;
  riskFlags: string[];
  timeframe: string;
}

export interface CostEstimate {
  feeBps: number;
  slippageBps: number;
  spreadBps: number;
  totalBps: number;
  fundingBorrowBps?: number | null;
}

export interface AllocationInput {
  mode: PortfolioMode;
  portfolioId: string;
  maxGrossExposure: number;
  maxNetExposure: number;
  maxDrawdownLimit: number;
  currentDrawdown: number;
  candidates: CandidateSignal[];
  costs: Record<string, CostEstimate>;
  volByInstrument: Record<string, number>;
  liquidityScoreByInstrument: Record<string, number>;
  constraints: Record<string, InstrumentConstraint>;
}

export interface AllocationDecision {
  instrumentId: string;
  symbol: string;
  side: 'buy' | 'sell' | 'hold';
  targetWeight: number;
  expectedEdgeNet: number;
  reason: string;
}

export interface ExecutionPlanItem {
  instrumentId: string;
  symbol: string;
  side: 'buy' | 'sell';
  targetWeight: number;
  slicing: 'single' | 'twap_lite';
  slices: number;
  expectedSlippageBps: number;
}
