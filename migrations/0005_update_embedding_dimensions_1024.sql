-- ============================================================================
-- MIGRAÇÃO: Atualizar dimensões de embeddings para 1024 (BGE-M3 + OpenCLIP ViT-H/14)
-- Descrição: Migra colunas de embedding de vector(768) para vector(1024)
-- 
-- ARQUITETURA 100% GPU (Opção B - Alta Qualidade) - 15/12/2025:
-- - Texto: BGE-M3 (1024 dim, multilíngue, 100+ idiomas) via GPU Salad Cloud
-- - Imagem: OpenCLIP ViT-H/14 (1024 dim) via GPU Salad Cloud
-- 
-- Author: Fillipe Guerra
-- Data: 15 de Dezembro de 2025
-- Versão: 1.0
-- ============================================================================

-- ============================================================================
-- NOTA IMPORTANTE: Esta migration assume que dados existentes podem ser 
-- regenerados via pipeline GPU. Colunas são recriadas com nova dimensão.
-- 
-- OBRIGATÓRIO: Esta migration DEVE ser executada ANTES do deploy do código
-- que usa queries com vector(1024). Caso contrário, haverá erro de incompatibilidade
-- de dimensões nas queries SQL (vector(768) vs vector(1024)).
-- ============================================================================

-- ============================================================================
-- 1. DOCUMENTS - Alterar coluna embedding para 1024 dim
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.tables 
    WHERE table_name = 'documents'
  ) THEN
    IF EXISTS (
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_name = 'documents' 
      AND column_name = 'embedding'
    ) THEN
      -- Dropar índices que dependem da coluna (se existirem)
      DROP INDEX IF EXISTS idx_documents_embedding_hnsw;
      
      -- Recriar coluna com vector(1024)
      ALTER TABLE documents 
        DROP COLUMN embedding;
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_name = 'documents' 
      AND column_name = 'embedding'
    ) THEN
      ALTER TABLE documents 
        ADD COLUMN embedding vector(1024);
    END IF;
    
    -- Recriar índice HNSW para vector(1024)
    IF NOT EXISTS (
      SELECT 1 
      FROM pg_indexes 
      WHERE indexname = 'idx_documents_embedding_hnsw'
    ) THEN
      CREATE INDEX idx_documents_embedding_hnsw 
        ON documents 
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
    END IF;
  END IF;
END $$;

-- ============================================================================
-- 2. DOCUMENT_CHUNKS - Alterar coluna embedding para 1024 dim
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.tables 
    WHERE table_name = 'document_chunks'
  ) THEN
    IF EXISTS (
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_name = 'document_chunks' 
      AND column_name = 'embedding'
    ) THEN
      DROP INDEX IF EXISTS idx_document_chunks_embedding_hnsw;
      ALTER TABLE document_chunks 
        DROP COLUMN embedding;
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_name = 'document_chunks' 
      AND column_name = 'embedding'
    ) THEN
      ALTER TABLE document_chunks 
        ADD COLUMN embedding vector(1024);
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 
      FROM pg_indexes 
      WHERE indexname = 'idx_document_chunks_embedding_hnsw'
    ) THEN
      CREATE INDEX idx_document_chunks_embedding_hnsw 
        ON document_chunks 
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
    END IF;
  END IF;
END $$;

-- ============================================================================
-- 3. MEDIA_UPLOADS - Alterar colunas clip_embedding e text_embedding para 1024 dim
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.tables 
    WHERE table_name = 'media_uploads'
  ) THEN
    -- clip_embedding (OpenCLIP ViT-H/14 - 1024 dim)
    IF EXISTS (
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_name = 'media_uploads' 
      AND column_name = 'clip_embedding'
    ) THEN
      DROP INDEX IF EXISTS idx_media_uploads_clip_embedding_hnsw;
      ALTER TABLE media_uploads 
        DROP COLUMN clip_embedding;
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_name = 'media_uploads' 
      AND column_name = 'clip_embedding'
    ) THEN
      ALTER TABLE media_uploads 
        ADD COLUMN clip_embedding vector(1024);
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 
      FROM pg_indexes 
      WHERE indexname = 'idx_media_uploads_clip_embedding_hnsw'
    ) THEN
      CREATE INDEX idx_media_uploads_clip_embedding_hnsw 
        ON media_uploads 
        USING hnsw (clip_embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
    END IF;
    
    -- text_embedding (BGE-M3 - 1024 dim)
    IF EXISTS (
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_name = 'media_uploads' 
      AND column_name = 'text_embedding'
    ) THEN
      DROP INDEX IF EXISTS idx_media_uploads_text_embedding_hnsw;
      ALTER TABLE media_uploads 
        DROP COLUMN text_embedding;
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_name = 'media_uploads' 
      AND column_name = 'text_embedding'
    ) THEN
      ALTER TABLE media_uploads 
        ADD COLUMN text_embedding vector(1024);
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 
      FROM pg_indexes 
      WHERE indexname = 'idx_media_uploads_text_embedding_hnsw'
    ) THEN
      CREATE INDEX idx_media_uploads_text_embedding_hnsw 
        ON media_uploads 
        USING hnsw (text_embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
    END IF;
  END IF;
END $$;

-- ============================================================================
-- 4. GENERATED_IMAGES - Alterar coluna clip_embedding para 1024 dim
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.tables 
    WHERE table_name = 'generated_images'
  ) THEN
    IF EXISTS (
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_name = 'generated_images' 
      AND column_name = 'clip_embedding'
    ) THEN
      DROP INDEX IF EXISTS idx_generated_images_clip_embedding_hnsw;
      ALTER TABLE generated_images 
        DROP COLUMN clip_embedding;
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_name = 'generated_images' 
      AND column_name = 'clip_embedding'
    ) THEN
      ALTER TABLE generated_images 
        ADD COLUMN clip_embedding vector(1024);
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 
      FROM pg_indexes 
      WHERE indexname = 'idx_generated_images_clip_embedding_hnsw'
    ) THEN
      CREATE INDEX idx_generated_images_clip_embedding_hnsw 
        ON generated_images 
        USING hnsw (clip_embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
    END IF;
  END IF;
END $$;

-- ============================================================================
-- MIGRAÇÃO CONCLUÍDA
-- Todas as colunas de embedding agora são vector(1024)
-- Compatível com:
-- - BGE-M3 (1024 dim, texto) via GPU Salad Cloud
-- - OpenCLIP ViT-H/14 (1024 dim, imagem) via GPU Salad Cloud
-- 
-- ARQUITETURA 100% GPU (Opção B - Alta Qualidade)
-- ============================================================================
