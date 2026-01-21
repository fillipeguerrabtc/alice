-- ============================================================================
-- MIGRAÇÃO: Política de Aprovação por Conversa (Agentic Approval)
-- Descrição: Adiciona enum e coluna approval_policy em conversation_states.
-- Regra 6: Persistência real em PostgreSQL (zero workarounds/mocks)
--
-- Autor: Fillipe Guerra
-- Data: 20 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'conversation_approval_policy'
  ) THEN
    CREATE TYPE conversation_approval_policy AS ENUM (
      'always_confirm',
      'confirm_risky',
      'never_confirm'
    );
  END IF;
END$$;

ALTER TABLE conversation_states
  ADD COLUMN IF NOT EXISTS approval_policy conversation_approval_policy;

UPDATE conversation_states
SET approval_policy = 'confirm_risky'
WHERE approval_policy IS NULL;

ALTER TABLE conversation_states
  ALTER COLUMN approval_policy SET DEFAULT 'confirm_risky';

ALTER TABLE conversation_states
  ALTER COLUMN approval_policy SET NOT NULL;

-- ============================================================================
-- Documento em Português Brasileiro
-- Autor: Fillipe Guerra
-- Data: 20 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================
