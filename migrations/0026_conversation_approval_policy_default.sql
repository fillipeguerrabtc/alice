-- ============================================================================
-- MIGRAÇÃO 0026: Conversas - Default Approval Policy
-- Descrição: Atualiza default e migra valores legacy de approval_policy
-- Regra 6: Persistência real em PostgreSQL (zero workarounds)
--
-- Autor: Fillipe Guerra
-- Data: 22 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================

-- Migrar valores antigos para o novo padrão
UPDATE conversation_states
SET approval_policy = 'always_confirm'
WHERE approval_policy = 'confirm_risky';

-- Atualizar default do schema
ALTER TABLE conversation_states
  ALTER COLUMN approval_policy SET DEFAULT 'always_confirm';

-- ============================================================================
-- Documento em Português Brasileiro
-- Autor: Fillipe Guerra
-- Data: 22 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================
