-- ============================================================================
-- MIGRAÇÃO 0025: Assistant Settings Core (Criador + Ética + Guardrails)
-- Descrição: Adiciona campos críticos de Core na configuração da Alice
-- Regra 6: Persistência real em PostgreSQL (zero soluções temporárias)
--
-- Autor: Fillipe Guerra
-- Data: 22 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================

ALTER TABLE assistant_settings
  ADD COLUMN IF NOT EXISTS creator_name TEXT,
  ADD COLUMN IF NOT EXISTS creator_rule TEXT,
  ADD COLUMN IF NOT EXISTS ethics_policy TEXT,
  ADD COLUMN IF NOT EXISTS moral_policy TEXT,
  ADD COLUMN IF NOT EXISTS legal_policy TEXT,
  ADD COLUMN IF NOT EXISTS safety_guardrails TEXT,
  ADD COLUMN IF NOT EXISTS nsfw_policy TEXT;

-- ============================================================================
-- Documento em Português Brasileiro
-- Autor: Fillipe Guerra
-- Data: 22 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================
