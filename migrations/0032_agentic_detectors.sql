-- ============================================================================
-- 0032_agentic_detectors.sql
-- Adiciona configuracao de detectores agentic por tenant
-- Autor: Fillipe Guerra
-- Data: 24 de Janeiro de 2026
-- ============================================================================

BEGIN;

ALTER TABLE agentic_settings
  ADD COLUMN IF NOT EXISTS detectors JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE agentic_settings
  SET detectors = '{}'::jsonb
  WHERE detectors IS NULL;

COMMIT;
