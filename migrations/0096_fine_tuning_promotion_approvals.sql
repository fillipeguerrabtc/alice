-- 0096_fine_tuning_promotion_approvals.sql
-- Objetivo: dual-control para promocao de fine-tuning (aprovacoes auditaveis por usuario).

DO $$
BEGIN
  CREATE TYPE fine_tuning_promotion_approval_decision AS ENUM ('approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS fine_tuning_promotion_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  fine_tuning_job_id UUID NOT NULL REFERENCES fine_tuning_jobs(id) ON DELETE CASCADE,
  approver_user_id UUID NOT NULL REFERENCES users(id),
  decision fine_tuning_promotion_approval_decision NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ft_promotion_approvals_tenant
  ON fine_tuning_promotion_approvals (tenant_id);

CREATE INDEX IF NOT EXISTS idx_ft_promotion_approvals_job
  ON fine_tuning_promotion_approvals (fine_tuning_job_id);

CREATE INDEX IF NOT EXISTS idx_ft_promotion_approvals_decision
  ON fine_tuning_promotion_approvals (decision);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ft_promotion_approvals_unique_job_user
  ON fine_tuning_promotion_approvals (fine_tuning_job_id, approver_user_id);

ALTER TABLE fine_tuning_promotion_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fine_tuning_promotion_approvals_tenant_isolation ON fine_tuning_promotion_approvals;
CREATE POLICY fine_tuning_promotion_approvals_tenant_isolation ON fine_tuning_promotion_approvals
  FOR ALL
  USING (is_super_admin() OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = current_tenant_id());
