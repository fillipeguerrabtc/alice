import type { Request } from 'express';
import { getDatabase, schema, type Database } from '@alice/database';
import { appendImmutableAuditEventWithExecutor } from '@alice/shared-utils';
import { extractRequestIp, extractRequestUserAgent } from './training-enterprise-controls.js';

export type TrainingGovernanceAuditAction =
  | 'training_promotion_approval_recorded'
  | 'training_model_promoted'
  | 'training_model_rollback_executed'
  | 'training_run_start_requested'
  | 'training_scope_binding_changed';

export const TRAINING_GOVERNANCE_AUDIT_ACTIONS: TrainingGovernanceAuditAction[] = [
  'training_promotion_approval_recorded',
  'training_model_promoted',
  'training_model_rollback_executed',
  'training_run_start_requested',
  'training_scope_binding_changed',
];

export function isTrainingGovernanceAuditAction(action: string): action is TrainingGovernanceAuditAction {
  return TRAINING_GOVERNANCE_AUDIT_ACTIONS.includes(action as TrainingGovernanceAuditAction);
}

export type TrainingAuditExecutor = Pick<Database, 'execute' | 'select' | 'insert'>;

interface PersistTrainingGovernanceAuditParams {
  tenantId: string;
  userId: string | null;
  action: TrainingGovernanceAuditAction;
  resource?: 'fine_tuning_job' | 'training_data';
  resourceId: string;
  request: Request;
  details: Record<string, unknown>;
  executor?: TrainingAuditExecutor;
}

interface CreateTrainingGovernanceAuditServiceDeps {
  incrementHighRiskAuditEventMetric: (params: {
    action: TrainingGovernanceAuditAction;
    result: 'success' | 'error';
  }) => void;
}

function extractRequestCorrelationId(request: Request): string | null {
  const raw = request.headers['x-correlation-id'];
  const parsed = Array.isArray(raw) ? raw[0] : raw;
  if (typeof parsed !== 'string') return null;
  const trimmed = parsed.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildTrainingGovernanceAuditValues(params: PersistTrainingGovernanceAuditParams) {
  return {
    tenantId: params.tenantId,
    userId: params.userId,
    acao: params.action,
    recurso: params.resource ?? 'fine_tuning_job',
    recursoId: params.resourceId,
    detalhes: params.details,
    ip: extractRequestIp(params.request),
    userAgent: extractRequestUserAgent(params.request),
  };
}

export function createTrainingGovernanceAuditService(deps: CreateTrainingGovernanceAuditServiceDeps): {
  persistTrainingGovernanceAudit: (params: PersistTrainingGovernanceAuditParams) => Promise<void>;
} {
  const db = getDatabase();

  return {
    persistTrainingGovernanceAudit: async (params) => {
      const auditValues = buildTrainingGovernanceAuditValues(params);
      const immutableInput = {
        tenantId: params.tenantId,
        stream: 'training_governance',
        streamKey: `${auditValues.recurso}:${auditValues.recursoId}`,
        eventType: params.action,
        resourceType: auditValues.recurso,
        resourceId: auditValues.recursoId ?? null,
        actorUserId: params.userId,
        sourceService: 'training-service',
        requestId: extractRequestCorrelationId(params.request),
        ipAddress: auditValues.ip ?? null,
        userAgent: auditValues.userAgent ?? null,
        payload: params.details,
      } as const;

      try {
        if (params.executor) {
          await params.executor.insert(schema.auditLogs).values(auditValues);
          await appendImmutableAuditEventWithExecutor({
            executor: params.executor,
            input: immutableInput,
          });
          deps.incrementHighRiskAuditEventMetric({
            action: params.action,
            result: 'success',
          });
          return;
        }

        await db.transaction(async (tx) => {
          await tx.insert(schema.auditLogs).values(auditValues);
          await appendImmutableAuditEventWithExecutor({
            executor: tx,
            input: immutableInput,
          });
        });

        deps.incrementHighRiskAuditEventMetric({
          action: params.action,
          result: 'success',
        });
      } catch (error) {
        deps.incrementHighRiskAuditEventMetric({
          action: params.action,
          result: 'error',
        });
        throw error;
      }
    },
  };
}
