import { createLogger } from '@alice/logger';
import { z } from 'zod';

const orchestratorResponseSchema = z.object({
  state: z.string().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
}).passthrough();

export type TrainingGpuOrchestrationAction = 'prepare_training' | 'restore_serving';

export type TrainingGpuOrchestrationRunSource = 'custom_job' | 'on_demand' | 'scheduled';

export interface TrainingGpuOrchestrationContext {
  fineTuningJobId: string;
  tenantId: string;
  runId: string;
  idempotencyKey: string;
  runSource: TrainingGpuOrchestrationRunSource;
}

export interface TrainingGpuOrchestrationAttempt {
  action: TrainingGpuOrchestrationAction;
  endpoint: '/api/gpu/orchestrator/prepare-training' | '/api/gpu/orchestrator/restore-serving';
  requestedAt: string;
  completedAt: string;
  durationMs: number;
  fineTuningJobId: string;
  tenantId: string;
  runId: string;
  idempotencyKey: string;
  runSource: TrainingGpuOrchestrationRunSource;
  success: boolean;
  statusCode: number | null;
  orchestratorState: string | null;
  message: string | null;
  error: string | null;
}

export interface TrainingGpuOrchestrationClient {
  prepareTrainingRuntime(context: TrainingGpuOrchestrationContext): Promise<TrainingGpuOrchestrationAttempt>;
  restoreServingRuntime(context: TrainingGpuOrchestrationContext): Promise<TrainingGpuOrchestrationAttempt>;
}

interface CreateTrainingGpuOrchestrationClientParams {
  gpuManagerUrl: string;
  internalApiSecret?: string;
  logger?: ReturnType<typeof createLogger>;
  fetchFn?: typeof fetch;
  prepareTimeoutMs?: number;
  restoreTimeoutMs?: number;
}

type OrchestratorEndpoint = '/api/gpu/orchestrator/prepare-training' | '/api/gpu/orchestrator/restore-serving';

const ORCHESTRATOR_ACTION_ENDPOINT: Record<TrainingGpuOrchestrationAction, OrchestratorEndpoint> = {
  prepare_training: '/api/gpu/orchestrator/prepare-training',
  restore_serving: '/api/gpu/orchestrator/restore-serving',
};

function normalizeServiceUrl(rawUrl: string): string {
  return rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

export function createTrainingGpuOrchestrationClient(
  params: CreateTrainingGpuOrchestrationClientParams,
): TrainingGpuOrchestrationClient {
  const logger = params.logger ?? createLogger('training-gpu-orchestration');
  const fetchFn = params.fetchFn ?? fetch;
  const baseUrl = normalizeServiceUrl(params.gpuManagerUrl);
  const prepareTimeoutMs = params.prepareTimeoutMs ?? 180_000;
  const restoreTimeoutMs = params.restoreTimeoutMs ?? 180_000;

  const callAction = async (
    action: TrainingGpuOrchestrationAction,
    context: TrainingGpuOrchestrationContext,
  ): Promise<TrainingGpuOrchestrationAttempt> => {
    const endpoint = ORCHESTRATOR_ACTION_ENDPOINT[action];
    const requestedAtDate = new Date();
    const requestedAt = requestedAtDate.toISOString();

    if (!params.internalApiSecret) {
      return {
        action,
        endpoint,
        requestedAt,
        completedAt: new Date().toISOString(),
        durationMs: 0,
        fineTuningJobId: context.fineTuningJobId,
        tenantId: context.tenantId,
        runId: context.runId,
        idempotencyKey: context.idempotencyKey,
        runSource: context.runSource,
        success: false,
        statusCode: null,
        orchestratorState: null,
        message: null,
        error: 'INTERNAL_API_SECRET ausente para acionar orquestrador GPU',
      };
    }

    const controller = new AbortController();
    const timeoutMs = action === 'prepare_training' ? prepareTimeoutMs : restoreTimeoutMs;
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    const requestUrl = `${baseUrl}${endpoint}`;

    try {
      const response = await fetchFn(requestUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'X-Internal-Api-Secret': params.internalApiSecret,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Correlation-Id': context.runId,
          'X-Internal-Tenant-Id': context.tenantId,
          'X-Internal-User-Id': 'training-service',
          'X-Internal-Role': 'admin',
        },
      });

      const completedAtDate = new Date();
      const completedAt = completedAtDate.toISOString();
      const durationMs = Math.max(0, completedAtDate.getTime() - requestedAtDate.getTime());
      const bodyRaw = (await response.json().catch(() => ({}))) as unknown;
      const body = orchestratorResponseSchema.safeParse(bodyRaw);
      const parsed = body.success ? body.data : {};

      const attempt: TrainingGpuOrchestrationAttempt = {
        action,
        endpoint,
        requestedAt,
        completedAt,
        durationMs,
        fineTuningJobId: context.fineTuningJobId,
        tenantId: context.tenantId,
        runId: context.runId,
        idempotencyKey: context.idempotencyKey,
        runSource: context.runSource,
        success: response.ok,
        statusCode: response.status,
        orchestratorState: typeof parsed.state === 'string' ? parsed.state : null,
        message: typeof parsed.message === 'string' ? parsed.message : null,
        error: !response.ok
          ? (typeof parsed.error === 'string'
            ? parsed.error
            : `Orquestrador retornou status ${response.status}`)
          : null,
      };

      if (attempt.success) {
        logger.info(
          {
            action,
            endpoint,
            runId: context.runId,
            fineTuningJobId: context.fineTuningJobId,
            durationMs: attempt.durationMs,
            state: attempt.orchestratorState,
            statusCode: attempt.statusCode,
          },
          'Orquestração de runtime GPU concluída com sucesso',
        );
      } else {
        logger.warn(
          {
            action,
            endpoint,
            runId: context.runId,
            fineTuningJobId: context.fineTuningJobId,
            durationMs: attempt.durationMs,
            statusCode: attempt.statusCode,
            error: attempt.error,
          },
          'Orquestração de runtime GPU retornou erro',
        );
      }

      return attempt;
    } catch (error) {
      const completedAtDate = new Date();
      const completedAt = completedAtDate.toISOString();
      const durationMs = Math.max(0, completedAtDate.getTime() - requestedAtDate.getTime());
      const message = normalizeErrorMessage(error);

      logger.warn(
        {
          action,
          endpoint,
          runId: context.runId,
          fineTuningJobId: context.fineTuningJobId,
          durationMs,
          error: message,
        },
        'Falha de comunicação com orquestrador de runtime GPU',
      );

      return {
        action,
        endpoint,
        requestedAt,
        completedAt,
        durationMs,
        fineTuningJobId: context.fineTuningJobId,
        tenantId: context.tenantId,
        runId: context.runId,
        idempotencyKey: context.idempotencyKey,
        runSource: context.runSource,
        success: false,
        statusCode: null,
        orchestratorState: null,
        message: null,
        error: message,
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  };

  return {
    prepareTrainingRuntime: async (context) => callAction('prepare_training', context),
    restoreServingRuntime: async (context) => callAction('restore_serving', context),
  };
}
