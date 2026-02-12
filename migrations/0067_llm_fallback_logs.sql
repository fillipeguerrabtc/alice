-- ============================================================================
-- Migration: 0067_llm_fallback_logs
-- Descrição: Tabela para registro de chamadas LLM que usaram modelo geral (fallback)
-- Plano Enterprise - Agentes Especializados por Namespace
--
-- Autor: Fillipe Guerra
-- Data: 11 de Fevereiro de 2026
-- ============================================================================

CREATE TABLE IF NOT EXISTS llm_fallback_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  rota varchar(255) NOT NULL,
  contexto_inferido varchar(100),
  mensagem_preview text,
  criado_em timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_fallback_logs_tenant ON llm_fallback_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_llm_fallback_logs_timestamp ON llm_fallback_logs(criado_em);
CREATE INDEX IF NOT EXISTS idx_llm_fallback_logs_contexto ON llm_fallback_logs(contexto_inferido);

-- RLS multi-tenant
ALTER TABLE llm_fallback_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS llm_fallback_logs_tenant_isolation ON llm_fallback_logs;
CREATE POLICY llm_fallback_logs_tenant_isolation ON llm_fallback_logs
  FOR ALL
  USING (is_super_admin() OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = current_tenant_id());
