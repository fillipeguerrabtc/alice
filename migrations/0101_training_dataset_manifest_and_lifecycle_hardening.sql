-- ============================================================================
-- MIGRACAO: Hardening de dataset versioning, lifecycle de dados e ativacao/promoção
-- Author: Fillipe Guerra
-- Data: 06 de Marco de 2026
-- ============================================================================

ALTER TYPE training_data_status ADD VALUE IF NOT EXISTS 'reserved';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'training_data_purpose') THEN
    CREATE TYPE training_data_purpose AS ENUM ('behavior_sft', 'knowledge_rag', 'eval_only', 'rejected');
  END IF;
END
$$;

ALTER TABLE training_data
  ADD COLUMN IF NOT EXISTS purpose training_data_purpose NOT NULL DEFAULT 'behavior_sft';

UPDATE training_data
SET purpose = CASE
  WHEN status = 'rejected' THEN 'rejected'::training_data_purpose
  WHEN source_type IN ('rag_document', 'rag_media') THEN 'knowledge_rag'::training_data_purpose
  ELSE 'behavior_sft'::training_data_purpose
END
WHERE purpose IS NULL
   OR purpose NOT IN ('behavior_sft', 'knowledge_rag', 'eval_only', 'rejected');

DROP INDEX IF EXISTS training_data_active_fingerprint_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS training_data_active_fingerprint_uidx
  ON training_data (tenant_id, source_type, semhash, COALESCE(source_id, ''))
  WHERE tenant_id IS NOT NULL
    AND semhash IS NOT NULL
    AND status IN ('pending', 'approved', 'reserved', 'used');

CREATE INDEX IF NOT EXISTS idx_training_status_used_in_job
  ON training_data (status, used_in_job_id);

ALTER TABLE training_dataset_versions
  ADD COLUMN IF NOT EXISTS split_policy varchar(64) NOT NULL DEFAULT 'mixed_hybrid',
  ADD COLUMN IF NOT EXISTS manifest jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE training_dataset_versions
SET manifest = jsonb_build_object(
  'version', 1,
  'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'seed', id::text,
  'splitPolicy', split_policy,
  'scope', jsonb_build_object(
    'tenantId', tenant_id::text,
    'namespaceId', CASE WHEN namespace_id IS NULL THEN NULL ELSE namespace_id::text END,
    'agentId', CASE WHEN agent_id IS NULL THEN NULL ELSE agent_id::text END
  ),
  'totals', jsonb_build_object('eligible', 0, 'train', 0, 'validation', 0, 'holdout', 0),
  'hashes', jsonb_build_object('manifest', hash, 'train', hash, 'validation', hash, 'holdout', hash),
  'sourceCounts', COALESCE(source_counts, '{}'::jsonb),
  'rows', jsonb_build_object('train', '[]'::jsonb, 'validation', '[]'::jsonb, 'holdout', '[]'::jsonb)
)
WHERE manifest = '{}'::jsonb
   OR manifest IS NULL;

CREATE INDEX IF NOT EXISTS idx_training_dataset_versions_tenant_hash
  ON training_dataset_versions (tenant_id, hash);

ALTER TYPE fine_tuning_promotion_status ADD VALUE IF NOT EXISTS 'activating';
ALTER TYPE fine_tuning_promotion_status ADD VALUE IF NOT EXISTS 'rollback_pending';
ALTER TYPE fine_tuning_promotion_status ADD VALUE IF NOT EXISTS 'failed_activation';
ALTER TYPE fine_tuning_promotion_status ADD VALUE IF NOT EXISTS 'archived';

ALTER TABLE lora_jobs
  ADD COLUMN IF NOT EXISTS active_adapter_path varchar(500);

UPDATE lora_jobs
SET active_adapter_path = CASE
  WHEN scope_type = 'agent' AND scope_agent_id IS NOT NULL THEN
    '/opt/alice/data/lora-adapters/agents/' || scope_agent_id::text
  ELSE
    '/opt/alice/data/lora-adapters/namespaces/' || COALESCE(scope_namespace_id::text, 'unknown')
END
WHERE is_active_by_scope = true
  AND active_adapter_path IS NULL;

CREATE INDEX IF NOT EXISTS idx_lora_jobs_active_adapter_path
  ON lora_jobs (active_adapter_path);
