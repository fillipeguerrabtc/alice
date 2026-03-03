-- 0093_unify_fine_tuning_run_metadata.sql
-- Unifica metadados de run em fine_tuning_jobs para pipeline enterprise.

DO $$
BEGIN
  CREATE TYPE fine_tuning_run_source AS ENUM ('custom_job', 'on_demand', 'scheduled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE fine_tuning_evaluation_status AS ENUM ('pending', 'running', 'passed', 'failed', 'skipped');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE fine_tuning_promotion_status AS ENUM ('candidate', 'staged', 'active', 'rejected', 'rolled_back');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE fine_tuning_jobs
  ADD COLUMN IF NOT EXISTS run_source fine_tuning_run_source NOT NULL DEFAULT 'custom_job',
  ADD COLUMN IF NOT EXISTS lora_job_id uuid,
  ADD COLUMN IF NOT EXISTS model_version_id uuid,
  ADD COLUMN IF NOT EXISTS scope_namespace_id uuid,
  ADD COLUMN IF NOT EXISTS scope_agent_id uuid,
  ADD COLUMN IF NOT EXISTS config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS evaluation_status fine_tuning_evaluation_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS promotion_status fine_tuning_promotion_status NOT NULL DEFAULT 'candidate';

DO $$
BEGIN
  ALTER TABLE fine_tuning_jobs
    ADD CONSTRAINT fine_tuning_jobs_lora_job_id_fkey
    FOREIGN KEY (lora_job_id)
    REFERENCES lora_jobs(id)
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE fine_tuning_jobs
    ADD CONSTRAINT fine_tuning_jobs_model_version_id_fkey
    FOREIGN KEY (model_version_id)
    REFERENCES model_versions(id)
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE fine_tuning_jobs
    ADD CONSTRAINT fine_tuning_jobs_scope_namespace_id_fkey
    FOREIGN KEY (scope_namespace_id)
    REFERENCES namespaces(id)
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE fine_tuning_jobs
    ADD CONSTRAINT fine_tuning_jobs_scope_agent_id_fkey
    FOREIGN KEY (scope_agent_id)
    REFERENCES agents(id)
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_finetuning_tenant_status_scope_namespace
  ON fine_tuning_jobs (tenant_id, status, scope_namespace_id);

CREATE INDEX IF NOT EXISTS idx_finetuning_tenant_status_scope_agent
  ON fine_tuning_jobs (tenant_id, status, scope_agent_id);

CREATE INDEX IF NOT EXISTS idx_finetuning_lora_job
  ON fine_tuning_jobs (lora_job_id);

CREATE INDEX IF NOT EXISTS idx_finetuning_model_version
  ON fine_tuning_jobs (model_version_id);

CREATE INDEX IF NOT EXISTS idx_finetuning_run_source
  ON fine_tuning_jobs (run_source);

CREATE INDEX IF NOT EXISTS idx_finetuning_evaluation_status
  ON fine_tuning_jobs (evaluation_status);

CREATE INDEX IF NOT EXISTS idx_finetuning_promotion_status
  ON fine_tuning_jobs (promotion_status);
