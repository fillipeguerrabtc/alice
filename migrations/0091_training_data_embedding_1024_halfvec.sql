-- ============================================================================
-- MIGRATION: Alinhar training_data.embedding para halfvec(1024)
-- Descrição: pipeline assíncrono de dedupe usa embeddings de texto 1024 dim
-- Author: Fillipe Guerra
-- Data: 02 de Março de 2026
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

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
    RAISE NOTICE 'Coluna training_data.embedding não encontrada; migração ignorada';
    RETURN;
  END IF;

  IF embedding_type = 'halfvec(1024)' THEN
    RAISE NOTICE 'training_data.embedding já está em halfvec(1024); nada a fazer';
    RETURN;
  END IF;

  -- Embeddings antigos/incompatíveis devem ser recalculados pelo worker assíncrono.
  UPDATE training_data
  SET embedding = NULL,
      processed_at = NULL,
      processado_em = NULL
  WHERE embedding IS NOT NULL;

  ALTER TABLE training_data
    ALTER COLUMN embedding TYPE halfvec(1024);

  RAISE NOTICE 'training_data.embedding migrada para halfvec(1024)';
END $$;
