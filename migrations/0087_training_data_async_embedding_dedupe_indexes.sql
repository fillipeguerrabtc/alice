-- ============================================================================
-- MIGRAÇÃO: Training Data async embedding/dedupe + índices de performance
-- Objetivo:
-- 1) adicionar processed_at para pipeline assíncrono
-- 2) índice exato tenant+semhash (semhash)
-- 3) índice vetorial HNSW para KNN pgvector
--
-- Author: Fillipe Guerra
-- Data: 26 de Fevereiro de 2026
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE training_data
  ADD COLUMN IF NOT EXISTS processed_at timestamp;

UPDATE training_data
SET processed_at = processado_em
WHERE processed_at IS NULL
  AND processado_em IS NOT NULL;

CREATE INDEX IF NOT EXISTS training_data_tenant_semhash_idx
  ON training_data (tenant_id, semhash)
  WHERE semhash IS NOT NULL;

CREATE INDEX IF NOT EXISTS training_data_embedding_hnsw_idx
  ON training_data
  USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS training_data_processed_at_idx
  ON training_data (processed_at DESC);
