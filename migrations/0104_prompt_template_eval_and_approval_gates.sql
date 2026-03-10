-- 0104_prompt_template_eval_and_approval_gates.sql
-- Objetivo: adicionar gate enterprise de avaliação + aprovação para ativação de prompt templates.

DO $$
BEGIN
  CREATE TYPE governance_evaluation_status AS ENUM ('pending', 'passed', 'failed', 'skipped');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$
BEGIN
  CREATE TYPE governance_approval_decision AS ENUM ('approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE prompt_templates
  ADD COLUMN IF NOT EXISTS evaluation_status governance_evaluation_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS evaluation_score real,
  ADD COLUMN IF NOT EXISTS evaluation_report jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS evaluated_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS evaluated_at timestamp,
  ADD COLUMN IF NOT EXISTS min_approvals integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS require_dual_control boolean NOT NULL DEFAULT true;

ALTER TABLE prompt_templates
  DROP CONSTRAINT IF EXISTS chk_prompt_templates_min_approvals;

ALTER TABLE prompt_templates
  ADD CONSTRAINT chk_prompt_templates_min_approvals
  CHECK (min_approvals >= 1 AND min_approvals <= 10);

CREATE TABLE IF NOT EXISTS prompt_template_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  prompt_template_id uuid NOT NULL REFERENCES prompt_templates(id) ON DELETE CASCADE,
  approver_user_id uuid NOT NULL REFERENCES users(id),
  decision governance_approval_decision NOT NULL,
  reason text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prompt_template_approvals_tenant
  ON prompt_template_approvals (tenant_id);

CREATE INDEX IF NOT EXISTS idx_prompt_template_approvals_template
  ON prompt_template_approvals (prompt_template_id);

CREATE INDEX IF NOT EXISTS idx_prompt_template_approvals_decision
  ON prompt_template_approvals (decision);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_prompt_template_approvals_template_user
  ON prompt_template_approvals (prompt_template_id, approver_user_id);
