-- ============================================================================
-- MIGRAÇÃO 0028: Agentic Settings (links e políticas por tenant)
-- Descrição: Configura execução agentic, links e políticas de aprovação.
-- Regra 6: Persistência real em PostgreSQL (zero soluções temporárias)
--
-- Autor: Fillipe Guerra
-- Data: 23 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================

CREATE TABLE IF NOT EXISTS agentic_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  web_enabled boolean NOT NULL DEFAULT true,
  erp_read_enabled boolean NOT NULL DEFAULT true,
  erp_write_enabled boolean NOT NULL DEFAULT true,
  trading_enabled boolean NOT NULL DEFAULT true,
  payments_enabled boolean NOT NULL DEFAULT true,
  stack_ops_enabled boolean NOT NULL DEFAULT true,
  financial_approval_required boolean NOT NULL DEFAULT true,
  platform_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  criado_em timestamp DEFAULT now(),
  atualizado_em timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_agentic_settings_tenant ON agentic_settings(tenant_id);

-- ============================================================================
-- Documento em Português Brasileiro
-- Autor: Fillipe Guerra
-- Data: 23 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================
