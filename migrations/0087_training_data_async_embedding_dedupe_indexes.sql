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

DO $$
DECLARE
  embedding_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
  INTO embedding_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'training_data'
    AND a.attname = 'embedding'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF embedding_type IS NULL THEN
    RAISE NOTICE 'Coluna training_data.embedding não encontrada; índice vetorial ignorado';
    RETURN;
  END IF;

  IF embedding_type LIKE 'halfvec%' THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS training_data_embedding_hnsw_idx
      ON training_data
      USING hnsw (embedding halfvec_cosine_ops)
      WHERE embedding IS NOT NULL
    ';
  ELSIF embedding_type LIKE 'vector%' THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS training_data_embedding_hnsw_idx
      ON training_data
      USING hnsw (embedding vector_cosine_ops)
      WHERE embedding IS NOT NULL
    ';
  ELSE
    RAISE NOTICE 'Tipo inesperado para training_data.embedding: %, índice vetorial ignorado', embedding_type;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS training_data_processed_at_idx
  ON training_data (processed_at DESC);
