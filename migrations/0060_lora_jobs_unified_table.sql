-- Migration: 0060_lora_jobs_unified_table
-- Descrição: Unificação enterprise - tabela única para jobs LoRA (renomear trading_lora_jobs → lora_jobs, origem explícita)
-- Autor: Fillipe Guerra
-- Data: 11 de Fevereiro de 2026
-- Ref: CLAUDE.md Regra 6 - zero workarounds; uma tabela, uma lógica de resolução de adapter ativo

-- ============================================================
-- PARTE 1: Renomear tabela e índices (idempotente)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'trading_lora_jobs')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lora_jobs') THEN
    ALTER TABLE trading_lora_jobs RENAME TO lora_jobs;
  END IF;
END
$$;

ALTER INDEX IF EXISTS idx_trading_lora_jobs_tenant RENAME TO idx_lora_jobs_tenant;
ALTER INDEX IF EXISTS idx_trading_lora_jobs_scope_type RENAME TO idx_lora_jobs_scope_type;
ALTER INDEX IF EXISTS idx_trading_lora_jobs_scope_namespace RENAME TO idx_lora_jobs_scope_namespace;
ALTER INDEX IF EXISTS idx_trading_lora_jobs_scope_agent RENAME TO idx_lora_jobs_scope_agent;
ALTER INDEX IF EXISTS idx_trading_lora_jobs_active_by_scope RENAME TO idx_lora_jobs_active_by_scope;
ALTER INDEX IF EXISTS idx_trading_lora_jobs_status RENAME TO idx_lora_jobs_status;
ALTER INDEX IF EXISTS idx_trading_lora_jobs_created RENAME TO idx_lora_jobs_created;

ALTER INDEX IF EXISTS idx_trading_lora_jobs_active_scope_unique RENAME TO idx_lora_jobs_active_scope_unique;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_trading_lora_jobs_scope_fields'
  ) THEN
    ALTER TABLE lora_jobs RENAME CONSTRAINT chk_trading_lora_jobs_scope_fields TO chk_lora_jobs_scope_fields;
  END IF;
END
$$;

-- ============================================================
-- PARTE 2: Coluna source (origem do job: explicit_job | scheduled_run)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lora_job_source') THEN
    CREATE TYPE lora_job_source AS ENUM ('explicit_job', 'scheduled_run');
  END IF;
END
$$;

ALTER TABLE lora_jobs
  ADD COLUMN IF NOT EXISTS source lora_job_source NOT NULL DEFAULT 'explicit_job';

CREATE INDEX IF NOT EXISTS idx_lora_jobs_source ON lora_jobs(source);

-- ============================================================
-- PARTE 3: RLS - política com nome alinhado à tabela
-- ============================================================
DROP POLICY IF EXISTS trading_lora_jobs_tenant_isolation ON lora_jobs;
DROP POLICY IF EXISTS lora_jobs_tenant_isolation ON lora_jobs;
CREATE POLICY lora_jobs_tenant_isolation ON lora_jobs
  FOR ALL
  USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

COMMENT ON TABLE lora_jobs IS 'Jobs de treinamento LoRA (universal). Única fonte de verdade para adapter ativo por escopo (tenant/namespace/agent). source: explicit_job (UI/API) ou scheduled_run.';
