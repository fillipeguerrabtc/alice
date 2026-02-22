-- =============================================================================
-- MIGRATION 0019b - Remoção completa de embeddings de imagem
-- Plataforma Alice - OpenAI-only para imagens
--
-- Autor: Fillipe Guerra
-- Data: 18 de Janeiro de 2026
-- =============================================================================

BEGIN;

-- Remover índices antigos de embeddings de imagem (se existirem)
DROP INDEX IF EXISTS idx_media_uploads_clip_embedding_hnsw;
DROP INDEX IF EXISTS idx_media_uploads_clip_embedding_hnsw_opt;
DROP INDEX IF EXISTS idx_generated_images_clip_embedding_hnsw;
DROP INDEX IF EXISTS idx_generated_images_clip_embedding_hnsw_opt;

-- Remover colunas de embeddings de imagem
ALTER TABLE IF EXISTS media_uploads DROP COLUMN IF EXISTS clip_embedding;
ALTER TABLE IF EXISTS generated_images DROP COLUMN IF EXISTS clip_embedding;

-- Remover feature flag obsoleta de embeddings de imagem
DELETE FROM feature_flags WHERE key = 'clip_embeddings_enabled';

COMMIT;
