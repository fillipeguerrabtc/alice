-- =====================================================
-- Migration: 0068a_llm_fallback_logs_enrichment
-- Objetivo: Enriquecer logs de fallback para governança
-- Data: 2026-02-12
-- =====================================================

ALTER TABLE llm_fallback_logs
  ADD COLUMN IF NOT EXISTS service_origem varchar(100),
  ADD COLUMN IF NOT EXISTS chamada varchar(120),
  ADD COLUMN IF NOT EXISTS motivo_fallback varchar(120),
  ADD COLUMN IF NOT EXISTS namespace_id uuid REFERENCES namespaces(id),
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES agents(id),
  ADD COLUMN IF NOT EXISTS modelo_base varchar(255),
  ADD COLUMN IF NOT EXISTS modelo_resolvido varchar(255),
  ADD COLUMN IF NOT EXISTS adapter_encontrado boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_llm_fallback_logs_motivo ON llm_fallback_logs(motivo_fallback);
CREATE INDEX IF NOT EXISTS idx_llm_fallback_logs_namespace ON llm_fallback_logs(namespace_id);
CREATE INDEX IF NOT EXISTS idx_llm_fallback_logs_agent ON llm_fallback_logs(agent_id);
