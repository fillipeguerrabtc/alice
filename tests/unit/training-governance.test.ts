import { describe, expect, it } from 'vitest';
import {
  canPromoteFineTuningJob,
  resolveFineTuningPromotionStatus,
} from '../../apps/training-service/src/training-governance';

describe('resolveFineTuningPromotionStatus', () => {
  it('rejects when policy requires passed and evaluation is skipped', () => {
    const status = resolveFineTuningPromotionStatus({
      evaluationStatus: 'skipped',
      requireEvalPassedForPromotion: true,
    });
    expect(status).toBe('rejected');
  });

  it('keeps candidate when policy is flexible and evaluation is skipped', () => {
    const status = resolveFineTuningPromotionStatus({
      evaluationStatus: 'skipped',
      requireEvalPassedForPromotion: false,
    });
    expect(status).toBe('candidate');
  });
});

describe('canPromoteFineTuningJob', () => {
  it('blocks promotion when require-passed policy is enabled and eval is pending', () => {
    const result = canPromoteFineTuningJob({
      evaluationStatus: 'pending',
      requireEvalPassedForPromotion: true,
    });
    expect(result.allowed).toBe(false);
  });

  it('allows promotion when eval is passed', () => {
    const result = canPromoteFineTuningJob({
      evaluationStatus: 'passed',
      requireEvalPassedForPromotion: true,
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks promotion when dual-control requires more approvals', () => {
    const result = canPromoteFineTuningJob({
      evaluationStatus: 'passed',
      requireEvalPassedForPromotion: true,
      requireDualApprovalForPromotion: true,
      promotionMinApprovals: 2,
      approvedDistinctUsersCount: 1,
      requesterHasApproved: true,
    });
    expect(result.allowed).toBe(false);
  });

  it('blocks promotion when requester has not approved in dual-control mode', () => {
    const result = canPromoteFineTuningJob({
      evaluationStatus: 'passed',
      requireEvalPassedForPromotion: true,
      requireDualApprovalForPromotion: true,
      promotionMinApprovals: 2,
      approvedDistinctUsersCount: 2,
      requesterHasApproved: false,
    });
    expect(result.allowed).toBe(false);
  });
});
