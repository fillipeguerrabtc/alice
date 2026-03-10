import { and, desc, eq, getDatabase, schema } from '@alice/database';

interface GetPromotionApprovalSummaryParams {
  tenantId: string;
  fineTuningJobId: string;
  requesterUserId: string;
}

export interface PromotionApprovalSummary {
  approvedDistinctUsersCount: number;
  requesterHasApproved: boolean;
  approvals: Array<{
    approverUserId: string;
    decision: 'approved' | 'rejected';
    reason: string | null;
    updatedAt: Date;
  }>;
}

export async function getPromotionApprovalSummary(
  params: GetPromotionApprovalSummaryParams,
): Promise<PromotionApprovalSummary> {
  const db = getDatabase();
  const approvals = await db.query.fineTuningPromotionApprovals.findMany({
    where: and(
      eq(schema.fineTuningPromotionApprovals.tenantId, params.tenantId),
      eq(schema.fineTuningPromotionApprovals.fineTuningJobId, params.fineTuningJobId),
    ),
    orderBy: [desc(schema.fineTuningPromotionApprovals.updatedAt)],
  });

  const approvedDistinctUsersCount = approvals
    .filter((approval) => approval.decision === 'approved')
    .length;
  const requesterHasApproved = approvals.some((approval) => (
    approval.approverUserId === params.requesterUserId
    && approval.decision === 'approved'
  ));

  return {
    approvedDistinctUsersCount,
    requesterHasApproved,
    approvals: approvals.map((approval) => ({
      approverUserId: approval.approverUserId,
      decision: approval.decision,
      reason: approval.reason,
      updatedAt: approval.updatedAt,
    })),
  };
}
