import { apiRequest } from '@/lib/queryClient';

export interface TradingV2Portfolio {
  id: string;
  name: string;
  riskProfile: 'conservative' | 'balanced' | 'aggressive';
  maxGrossExposure: string | number;
  maxNetExposure: string | number;
  maxDrawdownLimit: string | number;
}

export interface TradingV2Candidate {
  id: string;
  namespaceId?: string | null;
  instrumentId: string;
  marketType: 'spot' | 'futures' | 'margin';
  strategyKey: string;
  strategyVersion: number;
  timeframe: string;
  side: string;
  expectedEdge: string | number | null;
  confidenceRaw: string | number | null;
  confidenceCalibrated: string | number | null;
  dsrScore: string | number | null;
  pboScore: string | number | null;
  entryModel: Record<string, unknown>;
  riskFlags: unknown[];
  createdAt: string;
}

export interface TradingV2Rebalance {
  id: string;
  portfolioId: string;
  asofTimestamp: string;
  decisions: Record<string, unknown>;
  inputs: Record<string, unknown>;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  createdAt: string;
}

export interface TradingV2ExecutionReport {
  id: string;
  portfolioId: string | null;
  instrumentId: string;
  marketType: 'spot' | 'futures' | 'margin';
  orderPayload: Record<string, unknown>;
  executionResult: Record<string, unknown>;
  estimatedCosts: Record<string, unknown>;
  createdAt: string;
}

export async function getTradingV2Portfolios(): Promise<TradingV2Portfolio[]> {
  const response = await apiRequest('GET', '/api/trading-v2/portfolios');
  const payload = await response.json() as { success: boolean; data: TradingV2Portfolio[] };
  return payload.data ?? [];
}

export async function getTradingV2Candidates(params: { marketType?: 'spot' | 'futures' | 'margin'; limit?: number } = {}): Promise<TradingV2Candidate[]> {
  const search = new URLSearchParams();
  if (params.marketType) search.set('marketType', params.marketType);
  if (params.limit) search.set('limit', String(params.limit));
  const response = await apiRequest('GET', `/api/trading-v2/candidates${search.toString() ? `?${search.toString()}` : ''}`);
  const payload = await response.json() as { success: boolean; data: TradingV2Candidate[] };
  return payload.data ?? [];
}

export async function getTradingV2Rebalances(params: { portfolioId?: string; limit?: number } = {}): Promise<{ rebalances: TradingV2Rebalance[]; executionReports: TradingV2ExecutionReport[] }> {
  const search = new URLSearchParams();
  if (params.portfolioId) search.set('portfolioId', params.portfolioId);
  if (params.limit) search.set('limit', String(params.limit));
  const response = await apiRequest('GET', `/api/trading-v2/rebalances${search.toString() ? `?${search.toString()}` : ''}`);
  const payload = await response.json() as { success: boolean; data: { rebalances: TradingV2Rebalance[]; executionReports: TradingV2ExecutionReport[] } };
  return payload.data ?? { rebalances: [], executionReports: [] };
}

export async function enqueueTradingV2Job(
  job: 'universe-scan' | 'backtest' | 'calibration' | 'portfolio-rebalance' | 'model-risk',
  payload: Record<string, unknown>,
): Promise<{ queued: boolean; queue: string; idempotencyKey: string }> {
  const response = await apiRequest('POST', `/internal/trading-v2/enqueue/${job}`, payload);
  const body = await response.json() as { success: boolean; data: { queued: boolean; queue: string; idempotencyKey: string } };
  return body.data;
}
