-- Migration: 0057_training_scope_governance
-- Descrição: Segregação enterprise de treinamento e LoRA por namespace/agente com auditoria
-- Autor: Fillipe Guerra
-- Data: 10 de Fevereiro de 2026

-- ============================================================
-- PARTE 1: Expandir enums de origem e escopo
-- ============================================================
ALTER TYPE training_source_type ADD VALUE IF NOT EXISTS 'trading_demo';
ALTER TYPE training_source_type ADD VALUE IF NOT EXISTS 'trading_postmortem';
ALTER TYPE training_source_type ADD VALUE IF NOT EXISTS 'rag_document';
ALTER TYPE training_source_type ADD VALUE IF NOT EXISTS 'upload';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'training_scope_type') THEN
    CREATE TYPE training_scope_type AS ENUM ('namespace', 'agent');
  END IF;
END
$$;

-- ============================================================
-- PARTE 2: Campos de inferência/escopo em training_data
-- ============================================================
ALTER TABLE training_data
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id),
  ADD COLUMN IF NOT EXISTS inferred_namespace_id UUID REFERENCES namespaces(id),
  ADD COLUMN IF NOT EXISTS inferred_agent_id UUID REFERENCES agents(id),
  ADD COLUMN IF NOT EXISTS inferred_domain VARCHAR(120),
  ADD COLUMN IF NOT EXISTS inference_confidence REAL,
  ADD COLUMN IF NOT EXISTS inference_trace JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS scope_resolver_version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS profile_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS needs_human_review BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS quarantine_reason TEXT,
  ADD COLUMN IF NOT EXISTS scope_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quarantined_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_training_agent ON training_data(agent_id);
CREATE INDEX IF NOT EXISTS idx_training_needs_review ON training_data(needs_human_review);
CREATE INDEX IF NOT EXISTS idx_training_inferred_namespace ON training_data(inferred_namespace_id);
CREATE INDEX IF NOT EXISTS idx_training_inferred_agent ON training_data(inferred_agent_id);
CREATE INDEX IF NOT EXISTS idx_training_inference_confidence ON training_data(inference_confidence);

-- ============================================================
-- PARTE 3: Perfis de dataset por escopo
-- ============================================================
CREATE TABLE IF NOT EXISTS training_dataset_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  namespace_id UUID NOT NULL REFERENCES namespaces(id),
  agent_id UUID REFERENCES agents(id),
  domain VARCHAR(120) NOT NULL,
  weights JSONB DEFAULT '{}'::jsonb,
  keywords JSONB DEFAULT '[]'::jsonb,
  exclusions JSONB DEFAULT '[]'::jsonb,
  sampling_policy JSONB DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id),
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_profiles_tenant ON training_dataset_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_training_profiles_namespace ON training_dataset_profiles(namespace_id);
CREATE INDEX IF NOT EXISTS idx_training_profiles_agent ON training_dataset_profiles(agent_id);
CREATE INDEX IF NOT EXISTS idx_training_profiles_domain ON training_dataset_profiles(domain);
CREATE INDEX IF NOT EXISTS idx_training_profiles_active ON training_dataset_profiles(is_active);
CREATE INDEX IF NOT EXISTS idx_training_profiles_version ON training_dataset_profiles(version);

CREATE UNIQUE INDEX IF NOT EXISTS idx_training_profiles_unique_scope_version
  ON training_dataset_profiles (tenant_id, namespace_id, COALESCE(agent_id::text, ''), domain, version);

ALTER TABLE training_dataset_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS training_dataset_profiles_tenant_isolation ON training_dataset_profiles;
CREATE POLICY training_dataset_profiles_tenant_isolation ON training_dataset_profiles
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- PARTE 4: Auditoria de override de escopo
-- ============================================================
CREATE TABLE IF NOT EXISTS training_scope_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  training_data_id UUID NOT NULL REFERENCES training_data(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  old_namespace_id UUID REFERENCES namespaces(id),
  new_namespace_id UUID REFERENCES namespaces(id),
  old_domain VARCHAR(120),
  new_domain VARCHAR(120),
  old_agent_id UUID REFERENCES agents(id),
  new_agent_id UUID REFERENCES agents(id),
  changed_by UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  source VARCHAR(50) DEFAULT 'manual_review',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_scope_overrides_training_data ON training_scope_overrides(training_data_id);
CREATE INDEX IF NOT EXISTS idx_training_scope_overrides_tenant ON training_scope_overrides(tenant_id);
CREATE INDEX IF NOT EXISTS idx_training_scope_overrides_created ON training_scope_overrides(created_at);

ALTER TABLE training_scope_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS training_scope_overrides_tenant_isolation ON training_scope_overrides;
CREATE POLICY training_scope_overrides_tenant_isolation ON training_scope_overrides
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- PARTE 5: Escopo de job/adapter em trading_lora_jobs
-- ============================================================
ALTER TABLE trading_lora_jobs
  ADD COLUMN IF NOT EXISTS scope_type training_scope_type NOT NULL DEFAULT 'namespace',
  ADD COLUMN IF NOT EXISTS scope_namespace_id UUID REFERENCES namespaces(id),
  ADD COLUMN IF NOT EXISTS scope_agent_id UUID REFERENCES agents(id),
  ADD COLUMN IF NOT EXISTS profile_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_active_by_scope BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_trading_lora_jobs_scope_type ON trading_lora_jobs(scope_type);
CREATE INDEX IF NOT EXISTS idx_trading_lora_jobs_scope_namespace ON trading_lora_jobs(scope_namespace_id);
CREATE INDEX IF NOT EXISTS idx_trading_lora_jobs_scope_agent ON trading_lora_jobs(scope_agent_id);
CREATE INDEX IF NOT EXISTS idx_trading_lora_jobs_active_by_scope ON trading_lora_jobs(is_active_by_scope);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_trading_lora_jobs_scope_fields'
  ) THEN
    ALTER TABLE trading_lora_jobs
      ADD CONSTRAINT chk_trading_lora_jobs_scope_fields CHECK (
        (scope_type = 'namespace' AND scope_namespace_id IS NOT NULL AND scope_agent_id IS NULL)
        OR (scope_type = 'agent' AND scope_namespace_id IS NOT NULL AND scope_agent_id IS NOT NULL)
      );
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_lora_jobs_active_scope_unique
  ON trading_lora_jobs (
    tenant_id,
    scope_type,
    COALESCE(scope_namespace_id::text, ''),
    COALESCE(scope_agent_id::text, '')
  )
  WHERE is_active_by_scope = true;
