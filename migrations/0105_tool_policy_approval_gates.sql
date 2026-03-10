-- 0105_tool_policy_approval_gates.sql
-- Objetivo: adicionar gate enterprise de aprovação para ativação de tool policies.

ALTER TABLE tool_policies
  ADD COLUMN IF NOT EXISTS min_approvals integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS require_dual_control boolean NOT NULL DEFAULT true;

ALTER TABLE tool_policies
  DROP CONSTRAINT IF EXISTS chk_tool_policies_min_approvals;

ALTER TABLE tool_policies
  ADD CONSTRAINT chk_tool_policies_min_approvals
  CHECK (min_approvals >= 1 AND min_approvals <= 10);

CREATE TABLE IF NOT EXISTS tool_policy_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  tool_policy_id uuid NOT NULL REFERENCES tool_policies(id) ON DELETE CASCADE,
  approver_user_id uuid NOT NULL REFERENCES users(id),
  decision governance_approval_decision NOT NULL,
  reason text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tool_policy_approvals_tenant
  ON tool_policy_approvals (tenant_id);

CREATE INDEX IF NOT EXISTS idx_tool_policy_approvals_policy
  ON tool_policy_approvals (tool_policy_id);

CREATE INDEX IF NOT EXISTS idx_tool_policy_approvals_decision
  ON tool_policy_approvals (decision);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_tool_policy_approvals_policy_user
  ON tool_policy_approvals (tool_policy_id, approver_user_id);
