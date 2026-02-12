-- Migration: 0065_media_uploads_namespace_id
-- Descrição: Adiciona namespace_id em media_uploads para isolamento RAG e treinamento por domínio.
-- Plano RAG Multimodal Enterprise - Fase 2 (11/02/2026)
-- Autor: Fillipe Guerra
-- Data: 11 de Fevereiro de 2026

ALTER TABLE media_uploads
  ADD COLUMN IF NOT EXISTS namespace_id uuid REFERENCES namespaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_media_uploads_namespace
  ON media_uploads(namespace_id);

COMMENT ON COLUMN media_uploads.namespace_id IS 'Namespace para isolamento RAG e treinamento. Nullable para mídia legada e uploads sem namespace explícito.';
