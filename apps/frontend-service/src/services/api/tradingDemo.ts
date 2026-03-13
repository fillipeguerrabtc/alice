import { frontendLogger } from '@/lib/logger';
import { apiRequest } from '@/lib/queryClient';
import {
  demoBalancesResponseSchema,
  demoFundHistoryResponseSchema,
  demoHandoffSignalsResponseSchema,
  demoOrderFromSignalResponseSchema,
  demoOrdersResponseSchema,
  demoPositionsResponseSchema,
  demoPostMortemsResponseSchema,
  demoQueueStatsResponseSchema,
  demoSourceDatasetsResponseSchema,
} from '@/lib/tradingDemoSchemas';

type DemoApiArray<T> = T[];

export type DemoSignalHandoffItem = {
  id: string;
  symbol: string;
  marketType: 'futures' | 'spot' | 'margin';
  signalType: 'entry_long' | 'entry_short' | 'exit' | 'adjust_sl' | 'adjust_tp' | 'hold' | 'neutral';
  suggestedPrice?: number | null;
  suggestedStopLoss?: number | null;
  suggestedTakeProfit?: number | null;
  suggestedSize?: number | null;
  confidence: number;
  reasoning?: string | null;
  metadata?: Record<string, unknown>;
};

export type CreateDemoOrderFromSignalPayload = {
  entryType?: 'market' | 'limit';
  leverage?: number;
  marketType: 'futures' | 'spot' | 'margin';
  price?: number;
  side: 'buy' | 'sell';
  signalId: string;
  size: number;
  stopLoss?: number;
  symbol: string;
  takeProfit?: number;
};

export type DemoOrderFromSignalResult = {
  fee?: number;
  fillPrice?: number;
  fillSize?: number;
  fromSignalId?: string;
  orderId: string;
  positionId?: string;
  status: string;
};

function logSchemaError(endpoint: string, correlationId: string, details: unknown): void {
  frontendLogger.warn('DemoTrading payload inválido recebido da API', {
    endpoint,
    correlationId,
    details,
  });
}

async function parseArrayData<T>(endpoint: string, parser: (value: unknown) => { success: boolean; data?: { data: DemoApiArray<T> }; error?: unknown }): Promise<DemoApiArray<T>> {
  const response = await apiRequest('GET', endpoint);
  const correlationId = response.headers.get('x-correlation-id') ?? crypto.randomUUID();
  const payload = await response.json();
  const parsed = parser(payload);
  if (!parsed.success || !parsed.data) {
    logSchemaError(endpoint, correlationId, parsed.error);
    return [];
  }
  return parsed.data.data;
}

export async function getDemoBalances() {
  return parseArrayData('/api/integrations/demo-trading/balances', (value) => demoBalancesResponseSchema.safeParse(value));
}

export async function getDemoPositions(limit = 100) {
  return parseArrayData(`/api/integrations/demo-trading/positions?limit=${limit}`, (value) => demoPositionsResponseSchema.safeParse(value));
}

export async function getDemoOrders(limit = 100) {
  return parseArrayData(`/api/integrations/demo-trading/orders?limit=${limit}`, (value) => demoOrdersResponseSchema.safeParse(value));
}

export async function getDemoFundHistory() {
  return parseArrayData('/api/integrations/demo-trading/funds/history', (value) => demoFundHistoryResponseSchema.safeParse(value));
}

export async function getDemoPostMortems(limit = 50) {
  return parseArrayData(`/api/integrations/postmortem?isDemo=true&limit=${limit}`, (value) => demoPostMortemsResponseSchema.safeParse(value));
}

export async function getDemoSourceDatasets(limit = 200) {
  return parseArrayData(`/api/integrations/trading/datasets?limit=${limit}`, (value) => demoSourceDatasetsResponseSchema.safeParse(value));
}

export async function getDemoHandoffSignals(params: {
  limit?: number;
  marketType?: 'futures' | 'spot' | 'margin';
} = {}): Promise<DemoSignalHandoffItem[]> {
  const search = new URLSearchParams();
  if (params.limit) {
    search.set('limit', String(params.limit));
  }
  if (params.marketType) {
    search.set('marketType', params.marketType);
  }
  const endpoint = `/api/integrations/trading/signals${search.toString() ? `?${search.toString()}` : ''}`;
  return parseArrayData(endpoint, (value) => demoHandoffSignalsResponseSchema.safeParse(value));
}

export async function createDemoOrderFromSignal(payload: CreateDemoOrderFromSignalPayload): Promise<DemoOrderFromSignalResult> {
  const endpoint = '/api/integrations/demo-trading/orders/from-signal';
  const response = await apiRequest('POST', endpoint, payload);
  const correlationId = response.headers.get('x-correlation-id') ?? crypto.randomUUID();
  const body = await response.json();
  const parsed = demoOrderFromSignalResponseSchema.safeParse(body);
  if (!parsed.success) {
    logSchemaError(endpoint, correlationId, parsed.error);
    throw new Error('Falha ao interpretar resposta de execução demo a partir de sinal.');
  }
  return parsed.data.data;
}

export async function getDemoPostMortemQueueStats() {
  const endpoint = '/api/integrations/postmortem/queue/stats';
  const response = await apiRequest('GET', endpoint);
  const correlationId = response.headers.get('x-correlation-id') ?? crypto.randomUUID();
  const payload = await response.json();
  const parsed = demoQueueStatsResponseSchema.safeParse(payload);
  if (!parsed.success) {
    logSchemaError(endpoint, correlationId, parsed.error);
    return { pending: 0, dlq: 0 };
  }
  return parsed.data.data;
}
