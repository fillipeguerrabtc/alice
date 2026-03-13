import { apiRequest } from '@/lib/queryClient';
import type { ReasoningMode } from '@/lib/reasoning-mode';

export interface TradingPortfolio {
  id: string;
  name: string;
  riskProfile: 'conservative' | 'balanced' | 'aggressive';
  maxGrossExposure: string | number;
  maxNetExposure: string | number;
  maxDrawdownLimit: string | number;
}

export interface TradingCandidate {
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

export interface TradingRebalance {
  id: string;
  portfolioId: string;
  asofTimestamp: string;
  decisions: Record<string, unknown>;
  inputs: Record<string, unknown>;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  createdAt: string;
}

export interface TradingExecutionReport {
  id: string;
  portfolioId: string | null;
  instrumentId: string;
  marketType: 'spot' | 'futures' | 'margin';
  orderPayload: Record<string, unknown>;
  executionResult: Record<string, unknown>;
  estimatedCosts: Record<string, unknown>;
  createdAt: string;
}

export async function getTradingPortfolios(): Promise<TradingPortfolio[]> {
  const response = await apiRequest('GET', '/api/trading/portfolios');
  const payload = await response.json() as { success: boolean; data: TradingPortfolio[] };
  return payload.data ?? [];
}

export async function getTradingCandidates(params: { marketType?: 'spot' | 'futures' | 'margin'; limit?: number } = {}): Promise<TradingCandidate[]> {
  const search = new URLSearchParams();
  if (params.marketType) search.set('marketType', params.marketType);
  if (params.limit) search.set('limit', String(params.limit));
  const response = await apiRequest('GET', `/api/trading/candidates${search.toString() ? `?${search.toString()}` : ''}`);
  const payload = await response.json() as { success: boolean; data: TradingCandidate[] };
  return payload.data ?? [];
}

export async function getTradingRebalances(params: { portfolioId?: string; limit?: number } = {}): Promise<{ rebalances: TradingRebalance[]; executionReports: TradingExecutionReport[] }> {
  const search = new URLSearchParams();
  if (params.portfolioId) search.set('portfolioId', params.portfolioId);
  if (params.limit) search.set('limit', String(params.limit));
  const response = await apiRequest('GET', `/api/trading/rebalances${search.toString() ? `?${search.toString()}` : ''}`);
  const payload = await response.json() as { success: boolean; data: { rebalances: TradingRebalance[]; executionReports: TradingExecutionReport[] } };
  return payload.data ?? { rebalances: [], executionReports: [] };
}

export async function enqueueTradingJob(
  job: 'universe-scan' | 'backtest' | 'calibration' | 'portfolio-rebalance' | 'model-risk',
  payload: Record<string, unknown>,
): Promise<{ queued: boolean; queue: string; idempotencyKey: string }> {
  const response = await apiRequest('POST', `/internal/trading/enqueue/${job}`, payload);
  const body = await response.json() as { success: boolean; data: { queued: boolean; queue: string; idempotencyKey: string } };
  return body.data;
}

// ============================================================================
// Trading Auto Engine API
// ============================================================================

export interface TradingAutoRun {
  id: string;
  tenantId: string;
  userId: string;
  runType: 'signal_auto' | 'portfolio_auto';
  status: 'queued' | 'running' | 'succeeded' | 'no_trade' | 'blocked' | 'failed' | 'cancelled';
  payload: Record<string, unknown>;
  correlationId: string | null;
  namespaceId: string | null;
  terminalReasonCode?: string | null;
  approved?: boolean | null;
  tradingSignalId?: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TradingAutoRunStep {
  id: string;
  runId: string;
  stepName: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  metrics: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface TradingAutoDecision {
  id: string;
  runId: string;
  tenantId: string;
  decisionType: 'signal_auto' | 'portfolio_auto';
  tradingSignalId?: string | null;
  entryPayload: Record<string, unknown>;
  exitPayload: Record<string, unknown> | null;
  guardrails: Record<string, unknown> | null;
  estimatedCosts: Record<string, unknown> | null;
  candidateIds: string[];
  modelsUsed: string[];
  ragEvidenceIds: string[];
  approved: boolean;
  reasoning: string | null;
  createdAt: string;
}

export interface TradingAutoRunDetail {
  run: TradingAutoRun;
  steps: TradingAutoRunStep[];
  decisions: TradingAutoDecision[];
}

export interface TradingAutoSignalAsset {
  key: string;
  venue: string;
  symbol: string;
  marketType: 'spot' | 'futures' | 'margin';
  marginMode?: 'cross' | 'isolated';
  label: string;
}

export interface TradingAutoSignalAssetsCatalog {
  assets: TradingAutoSignalAsset[];
  venues: string[];
  markets: Array<'spot' | 'futures' | 'margin'>;
  total: number;
  generatedAt?: string;
}

export async function startPortfolioAutoRun(payload: {
  portfolioId: string;
  marketType?: 'spot' | 'futures' | 'margin';
  constraints?: Record<string, unknown>;
  namespaceId?: string;
}): Promise<{ runId: string }> {
  const response = await apiRequest('POST', '/api/trading/auto/portfolio/run', payload);
  const body = await response.json() as { success: boolean; data: { runId: string } };
  return body.data;
}

export async function startSignalAutoRun(payload: {
  symbol?: string;
  universeScope?: 'spot' | 'futures' | 'margin' | 'all';
  marketType?: 'spot' | 'futures' | 'margin';
  allowedModes?: string[];
  autoMix?: boolean;
  reasoningMode?: ReasoningMode;
  selectedAssets?: Array<{
    venue: string;
    symbol: string;
    marketType: 'spot' | 'futures' | 'margin';
    marginMode?: 'cross' | 'isolated';
  }>;
  selectAllAssets?: boolean;
  namespaceId?: string;
}): Promise<{ runId: string }> {
  const response = await apiRequest('POST', '/api/trading/auto/signal/run', payload);
  const body = await response.json() as { success: boolean; data: { runId: string } };
  return body.data;
}

export async function getTradingAutoSignalAssetsCatalog(): Promise<TradingAutoSignalAssetsCatalog> {
  const response = await apiRequest('GET', '/api/trading/auto/assets');
  const body = await response.json() as { success: boolean; data: TradingAutoSignalAssetsCatalog };
  return body.data ?? { assets: [], venues: [], markets: [], total: 0 };
}

export async function getTradingAutoRuns(params: {
  type?: 'signal_auto' | 'portfolio_auto';
  status?: 'queued' | 'running' | 'succeeded' | 'no_trade' | 'blocked' | 'failed' | 'cancelled';
  limit?: number;
} = {}): Promise<TradingAutoRun[]> {
  const search = new URLSearchParams();
  if (params.type) search.set('type', params.type);
  if (params.status) search.set('status', params.status);
  if (params.limit) search.set('limit', String(params.limit));
  const response = await apiRequest('GET', `/api/trading/auto/runs${search.toString() ? `?${search.toString()}` : ''}`);
  const body = await response.json() as { success: boolean; data: TradingAutoRun[] };
  return body.data ?? [];
}

export async function getTradingAutoRunDetail(runId: string): Promise<TradingAutoRunDetail> {
  const response = await apiRequest('GET', `/api/trading/auto/runs/${runId}`);
  const body = await response.json() as { success: boolean; data: TradingAutoRunDetail };
  return body.data;
}

export type TradingSignalPromotionStage =
  | 'candidate_evidence_captured'
  | 'dataset_candidate'
  | 'approved_dataset_version'
  | 'calibration_result'
  | 'demo_eligible'
  | 'real_eligible';

export type TradingSignalEligibilityStatus = 'pending' | 'eligible' | 'blocked';
export type TradingSignalPromotionValidationState = 'pending' | 'validated' | 'failed';

export interface TradingSignalPromotionPathSummary {
  path: {
    id: string;
    signalId: string;
    lifecycleStage: TradingSignalPromotionStage;
    validationState: TradingSignalPromotionValidationState;
    datasetCandidateId: string | null;
    datasetVersionId: string | null;
    calibrationId: string | null;
    demoEligibilityStatus: TradingSignalEligibilityStatus;
    demoEligibilityReasonCode: string | null;
    demoOrderId: string | null;
    demoPromotedByUserId: string | null;
    demoPromotedAt: string | null;
    demoPromotionReason: string | null;
    realEligibilityStatus: TradingSignalEligibilityStatus;
    realEligibilityReasonCode: string | null;
    realPromotedByUserId: string | null;
    realPromotedAt: string | null;
    realPromotionReason: string | null;
    createdAt: string;
    updatedAt: string;
  };
  signalId: string;
  lifecycleStage: TradingSignalPromotionStage;
  validationState: TradingSignalPromotionValidationState;
  datasetCandidate: {
    id: string | null;
    status: 'pending' | 'approved' | 'rejected' | 'used' | null;
  };
  datasetVersionId: string | null;
  calibration: {
    id: string | null;
    evalMetrics: Record<string, unknown> | null;
  };
  demo: {
    status: TradingSignalEligibilityStatus;
    reasonCode: string | null;
    reasonHuman: string | null;
    orderId: string | null;
    promotedAt: string | null;
    promotedByUserId: string | null;
  };
  real: {
    status: TradingSignalEligibilityStatus;
    reasonCode: string | null;
    reasonHuman: string | null;
    promotedAt: string | null;
    promotedByUserId: string | null;
  };
  events: Array<{
    id: string;
    promotionPathId: string;
    signalId: string;
    lifecycleStage: TradingSignalPromotionStage;
    actorUserId: string;
    reason: string | null;
    evidenceSourceType: string;
    evidenceSourceId: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
}

export async function getTradingSignalPromotionPath(signalId: string): Promise<TradingSignalPromotionPathSummary> {
  const response = await apiRequest('GET', `/api/integrations/trading/signals/${signalId}/promotion-path`);
  const body = await response.json() as { success: boolean; data: TradingSignalPromotionPathSummary };
  return body.data;
}

export async function sendTradingSignalToTrainingDataset(payload: {
  signalId: string;
  namespaceId?: string;
  reviewNotes?: string;
}): Promise<{
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'used';
}> {
  const response = await apiRequest('POST', '/api/integrations/trading/datasets/from-signal', payload);
  const body = await response.json() as {
    success: boolean;
    data: {
      id: string;
      status: 'pending' | 'approved' | 'rejected' | 'used';
    };
  };
  return body.data;
}

export async function promoteTradingSignalRealEligibility(params: {
  signalId: string;
  reason: string;
}): Promise<{
  id: string;
  lifecycleStage: TradingSignalPromotionStage;
  realEligibilityStatus: TradingSignalEligibilityStatus;
}> {
  const response = await apiRequest(
    'POST',
    `/api/integrations/trading/signals/${params.signalId}/promote-real-eligibility`,
    { reason: params.reason },
  );
  const body = await response.json() as {
    success: boolean;
    data: {
      id: string;
      lifecycleStage: TradingSignalPromotionStage;
      realEligibilityStatus: TradingSignalEligibilityStatus;
    };
  };
  return body.data;
}
