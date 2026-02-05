-- ============================================================================
-- MIGRAÇÃO: Biometria Facial - profile_id nullable em biometric_verifications
-- Descrição: Permite registrar tentativas falhas antes de existir perfil/embedding.
-- Regra 6: Persistência real em PostgreSQL (sem mocks)
--
-- Autor: Fillipe Guerra
-- Data: 03 de Fevereiro de 2026
-- Versão: 1.0
-- ============================================================================

ALTER TABLE biometric_verifications
  ALTER COLUMN profile_id DROP NOT NULL;

-- ============================================================================
-- Documento em Português Brasileiro
-- Autor: Fillipe Guerra
-- Data: 03 de Fevereiro de 2026
-- Versão: 1.0
-- ============================================================================
