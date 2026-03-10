import type { Database } from '@alice/database';
import { and, eq, inArray, schema, sql } from '@alice/database';
import { getAllSystemConfig } from '@alice/database/system-config';
import { createLogger } from '@alice/logger';
import { z } from 'zod';

const logger = createLogger('training-governance');

const TRAINING_GOVERNANCE_DEFAULTS = {
  TRAINING_MAX_INFLIGHT_RUNS_PER_TENANT: '5',
  TRAINING_PROMOTION_REQUIRE_EVAL_PASSED: 'true',
  TRAINING_PROMOTION_REQUIRE_APPROVAL_GATES: 'true',
  TRAINING_PROMOTION_REQUIRE_DUAL_APPROVAL: 'false',
  TRAINING_PROMOTION_MIN_APPROVALS: '2',
} as const;

const booleanStringSchema = z.string().transform((raw) => {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`Valor booleano invalido: ${raw}`);
});

const trainingGovernanceShapeSchema = z.object({
  TRAINING_MAX_INFLIGHT_RUNS_PER_TENANT: z.coerce.number().int().min(1).max(1000),
  TRAINING_PROMOTION_REQUIRE_EVAL_PASSED: z.string().min(1),
  TRAINING_PROMOTION_REQUIRE_APPROVAL_GATES: z.string().min(1),
  TRAINING_PROMOTION_REQUIRE_DUAL_APPROVAL: z.string().min(1),
  TRAINING_PROMOTION_MIN_APPROVALS: z.coerce.number().int().min(1).max(10),
});

export interface TrainingGovernanceRuntimeConfig {
  maxInflightRunsPerTenant: number;
  requireEvalPassedForPromotion: boolean;
  requireApprovalGatesForPromotion: boolean;
  requireDualApprovalForPromotion: boolean;
  promotionMinApprovals: number;
}

export function resolveFineTuningPromotionStatus(params: {
  evaluationStatus: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  requireEvalPassedForPromotion: boolean;
}): 'candidate' | 'rejected' {
  if (params.requireEvalPassedForPromotion && params.evaluationStatus !== 'passed') {
    return 'rejected';
  }
  return params.evaluationStatus === 'failed' ? 'rejected' : 'candidate';
}

export function canPromoteFineTuningJob(params: {
  evaluationStatus: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  requireEvalPassedForPromotion: boolean;
  requireApprovalGatesForPromotion?: boolean;
  requireDualApprovalForPromotion?: boolean;
  promotionMinApprovals?: number;
  approvedDistinctUsersCount?: number;
  requesterHasApproved?: boolean;
}): { allowed: true } | { allowed: false; reason: string } {
  if (params.requireEvalPassedForPromotion && params.evaluationStatus !== 'passed') {
    return {
      allowed: false,
      reason: `Job com avaliacao "${params.evaluationStatus}" nao pode ser promovido (politica exige "passed")`,
    };
  }
  if (params.evaluationStatus === 'failed') {
    return { allowed: false, reason: 'Job com avaliacao reprovada nao pode ser promovido' };
  }
  const approvedDistinctUsersCount = params.approvedDistinctUsersCount ?? 0;
  const requireApprovalGatesForPromotion = params.requireApprovalGatesForPromotion ?? false;
  const promotionMinApprovals = params.promotionMinApprovals ?? (params.requireDualApprovalForPromotion ? 2 : 1);
  if (requireApprovalGatesForPromotion && approvedDistinctUsersCount < promotionMinApprovals) {
    return {
      allowed: false,
      reason: `Job exige ${promotionMinApprovals} aprovacoes distintas para promocao (atual: ${approvedDistinctUsersCount})`,
    };
  }
  if (params.requireDualApprovalForPromotion) {
    const dualControlApprovalsFloor = Math.max(promotionMinApprovals, 2);
    if (approvedDistinctUsersCount < dualControlApprovalsFloor) {
      return {
        allowed: false,
        reason: `Job exige ${dualControlApprovalsFloor} aprovacoes distintas para promocao (atual: ${approvedDistinctUsersCount})`,
      };
    }
    if (!params.requesterHasApproved) {
      return {
        allowed: false,
        reason: 'Usuario solicitante precisa registrar aprovacao antes da promocao (dual-control)',
      };
    }
  }
  return { allowed: true };
}

export async function loadTrainingGovernanceRuntimeConfig(): Promise<TrainingGovernanceRuntimeConfig> {
  const allConfig = await getAllSystemConfig();
  const merged: Record<string, string> = {
    ...TRAINING_GOVERNANCE_DEFAULTS,
    ...allConfig,
  };

  const parsed = trainingGovernanceShapeSchema.safeParse({
    TRAINING_MAX_INFLIGHT_RUNS_PER_TENANT: merged.TRAINING_MAX_INFLIGHT_RUNS_PER_TENANT,
    TRAINING_PROMOTION_REQUIRE_EVAL_PASSED: merged.TRAINING_PROMOTION_REQUIRE_EVAL_PASSED,
    TRAINING_PROMOTION_REQUIRE_APPROVAL_GATES: merged.TRAINING_PROMOTION_REQUIRE_APPROVAL_GATES,
    TRAINING_PROMOTION_REQUIRE_DUAL_APPROVAL: merged.TRAINING_PROMOTION_REQUIRE_DUAL_APPROVAL,
    TRAINING_PROMOTION_MIN_APPROVALS: merged.TRAINING_PROMOTION_MIN_APPROVALS,
  });

  if (!parsed.success) {
    logger.warn(
      { errors: parsed.error.flatten() },
      'Shape invalido de governanca de training; aplicando defaults seguros'
    );
  }

  const effective = parsed.success
    ? parsed.data
    : trainingGovernanceShapeSchema.parse(TRAINING_GOVERNANCE_DEFAULTS);
  const requireDualApprovalForPromotion = booleanStringSchema.parse(
    effective.TRAINING_PROMOTION_REQUIRE_DUAL_APPROVAL
  );
  const promotionMinApprovals = requireDualApprovalForPromotion
    ? Math.max(effective.TRAINING_PROMOTION_MIN_APPROVALS, 2)
    : effective.TRAINING_PROMOTION_MIN_APPROVALS;

  if (requireDualApprovalForPromotion && effective.TRAINING_PROMOTION_MIN_APPROVALS < 2) {
    logger.warn(
      {
        configuredValue: effective.TRAINING_PROMOTION_MIN_APPROVALS,
        normalizedValue: promotionMinApprovals,
      },
      'TRAINING_PROMOTION_MIN_APPROVALS ajustado para >= 2 por dual-control'
    );
  }

  return {
    maxInflightRunsPerTenant: effective.TRAINING_MAX_INFLIGHT_RUNS_PER_TENANT,
    requireEvalPassedForPromotion: booleanStringSchema.parse(
      effective.TRAINING_PROMOTION_REQUIRE_EVAL_PASSED
    ),
    requireApprovalGatesForPromotion: booleanStringSchema.parse(
      effective.TRAINING_PROMOTION_REQUIRE_APPROVAL_GATES
    ),
    requireDualApprovalForPromotion,
    promotionMinApprovals,
  };
}

export async function getTenantInflightFineTuningJobsCount(
  db: Database,
  tenantId: string
): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.fineTuningJobs)
    .where(and(
      eq(schema.fineTuningJobs.tenantId, tenantId),
      inArray(schema.fineTuningJobs.status, ['pending', 'preparing', 'training', 'validating'])
    ));

  return Number(result?.count ?? 0);
}
