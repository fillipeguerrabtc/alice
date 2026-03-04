-- 0095_model_versions_agent_scope.sql
-- Objetivo: suportar model registry por escopo de agente (namespace+agent)
-- com retrocompatibilidade tenant-wide/namespace-wide.

ALTER TABLE model_versions
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id);

COMMENT ON COLUMN model_versions.agent_id IS
  'Escopo opcional por agente. Quando preenchido, representa adapter exclusivo do agente dentro do namespace.';

CREATE INDEX IF NOT EXISTS idx_model_versions_agent
  ON model_versions (agent_id);

CREATE INDEX IF NOT EXISTS idx_model_versions_scope_version
  ON model_versions (tenant_id, namespace_id, agent_id, version DESC);

-- Backfill de agent_id com base no fine_tuning_job associado (quando existir).
UPDATE model_versions mv
SET agent_id = ft.scope_agent_id
FROM fine_tuning_jobs ft
WHERE mv.fine_tuning_job_id = ft.id
  AND mv.agent_id IS NULL
  AND ft.scope_agent_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_model_versions_agent_requires_namespace'
  ) THEN
    ALTER TABLE model_versions
      ADD CONSTRAINT chk_model_versions_agent_requires_namespace
      CHECK (agent_id IS NULL OR namespace_id IS NOT NULL);
  END IF;
END $$;

-- Higiene de dados: garante apenas uma versão ativa por escopo antes do índice único parcial.
WITH ranked AS (
  SELECT
    id,
    is_active,
    row_number() OVER (
      PARTITION BY tenant_id, COALESCE(namespace_id::text, ''), COALESCE(agent_id::text, '')
      ORDER BY is_active DESC, version DESC, criado_em DESC, id DESC
    ) AS rn
  FROM model_versions
)
UPDATE model_versions mv
SET
  is_active = false,
  status = CASE WHEN mv.status = 'active' THEN 'deprecated' ELSE mv.status END,
  deprecado_em = COALESCE(mv.deprecado_em, NOW())
FROM ranked r
WHERE mv.id = r.id
  AND mv.is_active = true
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_model_versions_active_scope_unique
  ON model_versions (
    tenant_id,
    COALESCE(namespace_id::text, ''),
    COALESCE(agent_id::text, '')
  )
  WHERE is_active = true;
