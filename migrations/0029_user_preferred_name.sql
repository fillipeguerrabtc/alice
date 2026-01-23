-- ============================================================================
-- MIGRAÇÃO 0029: Nome Preferido do Usuário
-- Descrição: Adiciona coluna preferred_name para preferência de nome persistida.
-- Regra 6: Persistência real em PostgreSQL (zero soluções temporárias)
--
-- Autor: Fillipe Guerra
-- Data: 23 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_name varchar(120);

-- Migrar preferências existentes (preferencias.preferredName -> preferred_name)
UPDATE users
SET preferred_name = NULLIF(TRIM(preferencias->>'preferredName'), '')
WHERE preferred_name IS NULL
  AND (preferencias ? 'preferredName');

-- ============================================================================
-- Documento em Português Brasileiro
-- Autor: Fillipe Guerra
-- Data: 23 de Janeiro de 2026
-- Versão: 1.0
-- ============================================================================
