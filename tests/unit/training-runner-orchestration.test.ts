import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@alice/database';
import type { TrainingFineTuningQueuePayload } from '@alice/shared-utils';
import type { TrainingGpuOrchestrationAttempt } from '../../apps/training-service/src/training-gpu-orchestration';

const processLoraJobMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>());
const setJobErrorMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>());
const activateLoraAdapterMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>());
const getAllSystemConfigMock = vi.hoisted(() => vi.fn<() => Promise<Record<string, string>>>());
const loadTrainingEnterpriseConfigMock = vi.hoisted(() => vi.fn<() => Promise<{
  minOndemandDatasetSize: number;
  minScheduledIncremental: number;
  minScheduledFull: number;
  qualityMinRatio: number;
  datasetMaxRows: number;
  trainEvalSplitRatio: number;
  sliceSteps: number;
  gpuTimeoutMs: number;
  defaultHyperparams: Record<string, unknown>;
  presets: {
    safe: Record<string, unknown>;
    standard: Record<string, unknown>;
    large: Record<string, unknown>;
  };
}>>());

vi.mock('../../apps/training-service/src/lora-job-manager.js', () => ({
  activateLoraAdapter: activateLoraAdapterMock,
  processLoraJob: processLoraJobMock,
  setJobError: setJobErrorMock,
}));

vi.mock('@alice/database/system-config', () => ({
  getAllSystemConfig: getAllSystemConfigMock,
}));

vi.mock('../../apps/training-service/src/training-config.js', () => ({
  loadTrainingEnterpriseConfig: loadTrainingEnterpriseConfigMock,
}));

const { runTrainingFineTuningJob } = await import('../../apps/training-service/src/training-runner');

type RunSource = 'custom_job' | 'on_demand' | 'scheduled';

const payloadBase: TrainingFineTuningQueuePayload = {
  runId: '4d84f8fd-c7f3-4f56-820d-17b8673b53c5',
  fineTuningJobId: 'c728751f-7ad7-4801-9de5-4167e55d1dd0',
  tenantId: '2ed74066-2798-4dc6-a4e4-334e2603c00d',
  priority: 'normal',
  requestedBy: 'dc975fbe-57ad-4f01-b5f4-f9f6705e6399',
  idempotencyKey: '6bd7796f7f3f84f9169cb6a8a7490f86d1e335774e2f117962f0c2d2e5d76f71',
  createdAt: '2026-03-11T18:00:00.000Z',
};

function createAttempt(params: {
  action: 'prepare_training' | 'restore_serving';
  runSource: RunSource;
  success: boolean;
  state: string | null;
  error?: string | null;
}): TrainingGpuOrchestrationAttempt {
  const endpoint = params.action === 'prepare_training'
    ? '/api/gpu/orchestrator/prepare-training'
    : '/api/gpu/orchestrator/restore-serving';
  return {
    action: params.action,
    endpoint,
    requestedAt: '2026-03-11T18:00:01.000Z',
    completedAt: '2026-03-11T18:00:02.000Z',
    durationMs: 1000,
    fineTuningJobId: payloadBase.fineTuningJobId,
    tenantId: payloadBase.tenantId,
    runId: payloadBase.runId,
    idempotencyKey: payloadBase.idempotencyKey,
    runSource: params.runSource,
    success: params.success,
    statusCode: params.success ? 200 : 503,
    orchestratorState: params.state,
    message: params.success ? 'ok' : null,
    error: params.success ? null : (params.error ?? 'failure'),
  };
}

function buildHyperparams(): Record<string, unknown> {
  return {
    epochs: 3,
    learningRate: 0.0001,
    batchSize: 2,
    maxSeqLen: 1536,
    gradientAccumulationSteps: 2,
    warmupSteps: 0,
    loraRank: 16,
    loraAlpha: 32,
    loraDropout: 0.05,
    lrSchedulerType: 'linear',
    maxGradNorm: 1,
    targetModules: ['q_proj', 'v_proj'],
  };
}

function createDatabaseFixture(runSource: RunSource): Database {
  const fineTuningJob = {
    id: payloadBase.fineTuningJobId,
    status: 'pending',
    tenantId: payloadBase.tenantId,
    loraJobId: 'b30c648c-b6b4-48a5-8cee-c03d7e036adc',
    runSource,
    configSnapshot: {},
    metrics: {},
    iniciadoEm: null,
    scopeNamespaceId: 'a7a98683-bec3-4364-bf57-6f2fd91de500',
    scopeAgentId: null,
  } as unknown as Record<string, unknown>;

  const loraJob = {
    id: 'b30c648c-b6b4-48a5-8cee-c03d7e036adc',
    tenantId: payloadBase.tenantId,
    status: 'queued',
    hyperparameters: buildHyperparams(),
    includeImages: false,
    includeTradingDataset: true,
  } as unknown as Record<string, unknown>;

  let fineTuningStatus = 'pending';
  let loraReadCount = 0;
  const queryFineTuning = vi.fn(async () => {
    if (fineTuningStatus === 'pending') {
      return fineTuningJob;
    }
    return { status: fineTuningStatus };
  });
  const queryLora = vi.fn(async () => {
    loraReadCount += 1;
    if (loraReadCount === 1) {
      return loraJob;
    }
    return {
      resultAdapterPath: '/opt/alice/data/lora-adapters/job-test',
      datasetCount: 40,
      validationCount: 10,
      metrics: {},
    };
  });

  const db = {
    query: {
      fineTuningJobs: {
        findFirst: queryFineTuning,
      },
      loraJobs: {
        findFirst: queryLora,
      },
    },
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          if (typeof values.status === 'string') {
            fineTuningStatus = values.status;
          }
        },
      }),
    })),
  };

  return db as unknown as Database;
}

describe('training-runner orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processLoraJobMock.mockResolvedValue();
    setJobErrorMock.mockResolvedValue(undefined);
    activateLoraAdapterMock.mockResolvedValue({});

    getAllSystemConfigMock.mockResolvedValue({
      TRAINING_EVAL_MAX_LOSS: '2.0',
      TRAINING_AUTO_PROMOTE_SCHEDULED: 'false',
      TRAINING_PROMOTION_REQUIRE_EVAL_PASSED: 'true',
      TRAINING_PROMOTION_REQUIRE_APPROVAL_GATES: 'true',
      AUTO_LEARNING_CRON_INCREMENTAL: '0 3 * * 0',
      AUTO_LEARNING_CRON_FULL: '0 1 1,15 * *',
      AUTO_LEARNING_INCLUDE_IMAGES: 'true',
    });

    const hyperparams = buildHyperparams();
    loadTrainingEnterpriseConfigMock.mockResolvedValue({
      minOndemandDatasetSize: 20,
      minScheduledIncremental: 50,
      minScheduledFull: 200,
      qualityMinRatio: 0.6,
      datasetMaxRows: 5000,
      trainEvalSplitRatio: 0.9,
      sliceSteps: 10,
      gpuTimeoutMs: 120000,
      defaultHyperparams: hyperparams,
      presets: {
        safe: hyperparams,
        standard: hyperparams,
        large: hyperparams,
      },
    });
  });

  it('executa preempção automática em run scheduled e restaura serving ao final', async () => {
    const db = createDatabaseFixture('scheduled');
    const prepareTrainingRuntime = vi.fn(async () => createAttempt({
      action: 'prepare_training',
      runSource: 'scheduled',
      success: true,
      state: 'training_active',
    }));
    const restoreServingRuntime = vi.fn(async () => createAttempt({
      action: 'restore_serving',
      runSource: 'scheduled',
      success: true,
      state: 'serving_ready',
    }));

    await runTrainingFineTuningJob({
      db,
      payload: payloadBase,
      fineTuningJobId: payloadBase.fineTuningJobId,
      gpuOrchestrationClient: {
        prepareTrainingRuntime,
        restoreServingRuntime,
      },
    });

    expect(prepareTrainingRuntime).toHaveBeenCalledTimes(1);
    expect(restoreServingRuntime).toHaveBeenCalledTimes(1);
    expect(processLoraJobMock).toHaveBeenCalledTimes(1);
    expect(
      prepareTrainingRuntime.mock.invocationCallOrder[0],
      'prepare-training deve acontecer antes da execução do treino',
    ).toBeLessThan(processLoraJobMock.mock.invocationCallOrder[0]);
    expect(
      processLoraJobMock.mock.invocationCallOrder[0],
      'restore-serving deve ocorrer após término da execução',
    ).toBeLessThan(restoreServingRuntime.mock.invocationCallOrder[0]);
    expect(prepareTrainingRuntime.mock.calls[0]?.[0]).toMatchObject({ runSource: 'scheduled' });
    expect(restoreServingRuntime.mock.calls[0]?.[0]).toMatchObject({ runSource: 'scheduled' });
  });

  it('aplica preempção em run on-demand e mantém restore no finally em caso de falha', async () => {
    const db = createDatabaseFixture('on_demand');
    const prepareTrainingRuntime = vi.fn(async () => createAttempt({
      action: 'prepare_training',
      runSource: 'on_demand',
      success: false,
      state: 'serving_draining',
      error: 'transition_in_progress',
    }));
    const restoreServingRuntime = vi.fn(async () => createAttempt({
      action: 'restore_serving',
      runSource: 'on_demand',
      success: true,
      state: 'serving_ready',
    }));

    await expect(
      runTrainingFineTuningJob({
        db,
        payload: payloadBase,
        fineTuningJobId: payloadBase.fineTuningJobId,
        gpuOrchestrationClient: {
          prepareTrainingRuntime,
          restoreServingRuntime,
        },
      }),
    ).rejects.toThrow('Preempção automática não concluída');

    expect(prepareTrainingRuntime).toHaveBeenCalledTimes(1);
    expect(restoreServingRuntime).toHaveBeenCalledTimes(1);
    expect(processLoraJobMock).not.toHaveBeenCalled();
    expect(setJobErrorMock).toHaveBeenCalledTimes(1);
    expect(restoreServingRuntime.mock.calls[0]?.[0]).toMatchObject({ runSource: 'on_demand' });
  });
});
