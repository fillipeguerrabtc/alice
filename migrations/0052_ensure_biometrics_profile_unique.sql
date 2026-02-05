-- ============================================================================
-- MIGRAÇÃO: Garantir UNIQUE (tenant_id, user_id) em biometric_profiles
-- Descrição: Corrige erro de ON CONFLICT quando a constraint não existe
-- Regra 6: Persistência real em PostgreSQL (sem mocks)
--
-- Autor: Fillipe Guerra
-- Data: 05 de Fevereiro de 2026
-- Versão: 1.0
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'biometric_profiles'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS biometric_profiles_tenant_user_uidx
      ON biometric_profiles (tenant_id, user_id);
  END IF;
END$$;

-- ============================================================================
-- Documento em Português Brasileiro
-- Autor: Fillipe Guerra
-- Data: 05 de Fevereiro de 2026
-- Versão: 1.0
-- ============================================================================
