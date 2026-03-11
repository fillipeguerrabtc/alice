import {
  desc,
  eq,
  getDatabase,
  schema,
} from '@alice/database';
import type { Logger } from 'pino';
import type { OrchestratorState } from './gpu-orchestrator.js';

const DEFAULT_RUNTIME_KEY = 'global';

type RuntimeEventType =
  | 'state_snapshot'
  | 'switch_requested'
  | 'switch_completed'
  | 'switch_failed'
  | 'manual_restore_requested'
  | 'manual_restore_completed'
  | 'manual_restore_failed';

type RuntimeTriggerSource = 'startup' | 'queue_request' | 'manual_api' | 'system';
type RuntimeOutcome = 'success' | 'error';

type RuntimeMode = typeof schema.gpuRuntimeModeEnum.enumValues[number];
type OrchestrationMode = typeof schema.gpuOrchestrationModeEnum.enumValues[number];

function mapOrchestratorStateToRuntimeMode(orchestratorState: OrchestratorState): RuntimeMode {
  if (orchestratorState === 'serving_ready') return 'serving';
  if (orchestratorState === 'serving_draining' || orchestratorState === 'training_starting') return 'switching_to_training';
  if (orchestratorState === 'training_active') return 'training';
  if (orchestratorState === 'training_finishing' || orchestratorState === 'serving_restoring') return 'switching_to_serving';
  return 'serving';
}

function deriveActiveServices(orchestratorState: OrchestratorState): string[] {
  if (orchestratorState === 'training_active' || orchestratorState === 'training_starting' || orchestratorState === 'training_finishing') {
    return ['training'];
  }

  if (orchestratorState === 'serving_ready' || orchestratorState === 'serving_restoring' || orchestratorState === 'serving_draining') {
    return ['llm', 'embeddings'];
  }

  return [];
}

export interface RuntimeSnapshotInput {
  orchestratorState: OrchestratorState;
  orchestrationMode: OrchestrationMode;
  orchestratorAvailable: boolean;
  eventType: RuntimeEventType;
  triggerSource: RuntimeTriggerSource;
  outcome?: RuntimeOutcome;
  sourceService?: string;
  requestId?: string;
  correlationId?: string;
  reason?: string;
  actorUserId?: string;
  actorTenantId?: string;
  metadata?: Record<string, unknown>;
}

export interface GpuRuntimeStateStore {
  getCurrentStateWithEvents(limit?: number): Promise<{
    state: typeof schema.gpuRuntimeState.$inferSelect | null;
    events: Array<typeof schema.gpuRuntimeEvents.$inferSelect>;
  }>;
  recordSnapshot(input: RuntimeSnapshotInput): Promise<{
    state: typeof schema.gpuRuntimeState.$inferSelect;
    event: typeof schema.gpuRuntimeEvents.$inferSelect;
  }>;
}

export function createGpuRuntimeStateStore(params: {
  logger: Logger;
  runtimeKey?: string;
  sourceService?: string;
}): GpuRuntimeStateStore {
  const runtimeKey = params.runtimeKey ?? DEFAULT_RUNTIME_KEY;
  const sourceServiceDefault = params.sourceService ?? 'gpu-manager-service';

  async function getCurrentStateWithEvents(limit = 20): Promise<{
    state: typeof schema.gpuRuntimeState.$inferSelect | null;
    events: Array<typeof schema.gpuRuntimeEvents.$inferSelect>;
  }> {
    const db = getDatabase();
    const state = await db.query.gpuRuntimeState.findFirst({
      where: eq(schema.gpuRuntimeState.runtimeKey, runtimeKey),
    });

    if (!state) {
      return { state: null, events: [] };
    }

    const events = await db.query.gpuRuntimeEvents.findMany({
      where: eq(schema.gpuRuntimeEvents.runtimeStateId, state.id),
      orderBy: [desc(schema.gpuRuntimeEvents.createdAt)],
      limit,
    });

    return { state, events };
  }

  async function recordSnapshot(input: RuntimeSnapshotInput): Promise<{
    state: typeof schema.gpuRuntimeState.$inferSelect;
    event: typeof schema.gpuRuntimeEvents.$inferSelect;
  }> {
    const db = getDatabase();

    const result = await db.transaction(async (tx) => {
      const existingState = await tx.query.gpuRuntimeState.findFirst({
        where: eq(schema.gpuRuntimeState.runtimeKey, runtimeKey),
      });

      const runtimeMode = mapOrchestratorStateToRuntimeMode(input.orchestratorState);
      const activeServices = deriveActiveServices(input.orchestratorState);

      const statePayload = {
        runtimeMode,
        orchestratorState: input.orchestratorState,
        orchestrationMode: input.orchestrationMode,
        orchestratorAvailable: input.orchestratorAvailable,
        activeServices,
        lastRequestId: input.requestId ?? null,
        lastReason: input.reason ?? null,
        correlationId: input.correlationId ?? null,
        updatedByService: input.sourceService ?? sourceServiceDefault,
        updatedByUserId: input.actorUserId ?? null,
        updatedByTenantId: input.actorTenantId ?? null,
        metadata: input.metadata ?? {},
        updatedAt: new Date(),
      } as const;

      const state = existingState
        ? (await tx.update(schema.gpuRuntimeState)
            .set(statePayload)
            .where(eq(schema.gpuRuntimeState.id, existingState.id))
            .returning())[0]
        : (await tx.insert(schema.gpuRuntimeState)
            .values({
              runtimeKey,
              ...statePayload,
            })
            .returning())[0];

      if (!state) {
        throw new Error('Falha ao persistir snapshot em gpu_runtime_state');
      }

      const event = (await tx.insert(schema.gpuRuntimeEvents).values({
        runtimeStateId: state.id,
        eventType: input.eventType,
        triggerSource: input.triggerSource,
        outcome: input.outcome ?? 'success',
        fromMode: existingState?.runtimeMode ?? null,
        toMode: state.runtimeMode,
        fromOrchestratorState: existingState?.orchestratorState ?? null,
        toOrchestratorState: state.orchestratorState,
        requestId: input.requestId ?? null,
        correlationId: input.correlationId ?? null,
        reason: input.reason ?? null,
        sourceService: input.sourceService ?? sourceServiceDefault,
        actorUserId: input.actorUserId ?? null,
        actorTenantId: input.actorTenantId ?? null,
        metadata: input.metadata ?? {},
      }).returning())[0];

      if (!event) {
        throw new Error('Falha ao persistir evento em gpu_runtime_events');
      }

      return { state, event };
    });

    params.logger.debug(
      {
        runtimeKey,
        runtimeMode: result.state.runtimeMode,
        orchestratorState: result.state.orchestratorState,
        eventType: result.event.eventType,
      },
      'Snapshot de runtime GPU persistido com sucesso'
    );

    return result;
  }

  return {
    getCurrentStateWithEvents,
    recordSnapshot,
  };
}
