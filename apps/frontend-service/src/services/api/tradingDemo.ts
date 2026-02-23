import { frontendLogger } from '@/lib/logger';
import { apiRequest } from '@/lib/queryClient';
import {
  demoBalancesResponseSchema,
  demoFundHistoryResponseSchema,
  demoOrdersResponseSchema,
  demoPositionsResponseSchema,
  demoPostMortemsResponseSchema,
  demoQueueStatsResponseSchema,
  demoSourceDatasetsResponseSchema,
} from '@/lib/tradingDemoSchemas';

type DemoApiArray<T> = T[];

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
