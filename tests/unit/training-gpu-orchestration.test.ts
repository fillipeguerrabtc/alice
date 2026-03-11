import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTrainingGpuOrchestrationClient,
  type TrainingGpuOrchestrationContext,
} from '../../apps/training-service/src/training-gpu-orchestration';

const baseContext: TrainingGpuOrchestrationContext = {
  fineTuningJobId: '6b9e8f95-2e80-4f56-a8c6-c9edc5ed5021',
  tenantId: '5f5f843f-a5e2-40e7-8a39-c2ea43431722',
  runId: '4c6e2778-f90d-4c5f-b4d6-acef79f2c8fd',
  idempotencyKey: '6bd7796f7f3f84f9169cb6a8a7490f86d1e335774e2f117962f0c2d2e5d76f71',
  runSource: 'scheduled',
};

describe('training GPU orchestration client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('aciona endpoint canônico de prepare-training com autenticação interna', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ state: 'training_active', message: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = createTrainingGpuOrchestrationClient({
      gpuManagerUrl: 'http://alice-gpu-manager:3010',
      internalApiSecret: 'secret-value',
      fetchFn: fetchMock,
    });

    const result = await client.prepareTrainingRuntime(baseContext);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://alice-gpu-manager:3010/api/gpu/orchestrator/prepare-training');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Internal-Api-Secret']).toBe('secret-value');
    expect(headers['X-Internal-Tenant-Id']).toBe(baseContext.tenantId);
    expect(headers['X-Correlation-Id']).toBe(baseContext.runId);

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.action).toBe('prepare_training');
    expect(result.orchestratorState).toBe('training_active');
    expect(result.error).toBeNull();
  });

  it('retorna erro auditável quando endpoint responde status de falha', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Orquestrador indisponivel' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = createTrainingGpuOrchestrationClient({
      gpuManagerUrl: 'http://alice-gpu-manager:3010',
      internalApiSecret: 'secret-value',
      fetchFn: fetchMock,
    });

    const result = await client.restoreServingRuntime(baseContext);

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(503);
    expect(result.action).toBe('restore_serving');
    expect(result.error).toBe('Orquestrador indisponivel');
  });

  it('falha sem chamar rede quando INTERNAL_API_SECRET estiver ausente', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    const client = createTrainingGpuOrchestrationClient({
      gpuManagerUrl: 'http://alice-gpu-manager:3010',
      fetchFn: fetchMock,
    });

    const result = await client.prepareTrainingRuntime(baseContext);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.error).toContain('INTERNAL_API_SECRET');
  });

  it('captura erro de comunicação em formato auditável', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('network down'));

    const client = createTrainingGpuOrchestrationClient({
      gpuManagerUrl: 'http://alice-gpu-manager:3010',
      internalApiSecret: 'secret-value',
      fetchFn: fetchMock,
    });

    const result = await client.prepareTrainingRuntime(baseContext);

    expect(result.success).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.error).toContain('network down');
  });
});
