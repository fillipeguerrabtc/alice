-- ============================================================================
-- MIGRAÇÃO: Atualizar dimensões de embeddings para 768 (multilingual-e5-base + CLIP)
-- Descrição: Migra colunas de embedding de vector(1536) para vector(768)
-- Embeddings são 100% locais via CPU no servidor Hetzner (Regra 6 - Autonomia Total)
-- 
-- Author: Fillipe Guerra
-- Data: 11 de Dezembro de 2025
-- Versão: 1.0
-- ============================================================================

-- ============================================================================
-- NOTA IMPORTANTE: Esta migration assume que NÃO há dados em produção
-- Se houver dados, será necessário regenerar embeddings antes de executar
-- 
-- OBRIGATÓRIO: Esta migration DEVE ser executada ANTES do deploy do código
-- que usa queries com vector(768). Caso contrário, haverá erro de incompatibilidade
-- de dimensões nas queries SQL (vector(1536) vs vector(768)).
-- 
-- Como ainda não há deploy em produção, não há dados com os quais se preocupar.
-- ============================================================================

-- ============================================================================
-- 1. DOCUMENTS - Alterar coluna embedding
-- ============================================================================
DO $$
BEGIN
  -- Verificar se tabela existe
  IF EXISTS (
    SELECT 1 
    FROM information_schema.tables 
    WHERE table_name = 'documents'
  ) THEN
    -- Verificar se coluna existe
    IF EXISTS (
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_name = 'documents' 
      AND column_name = 'embedding'
    ) THEN
      -- Dropar índices que dependem da coluna (se existirem)
      DROP INDEX IF EXISTS idx_documents_embedding_hnsw;
      
      -- Recriar coluna com vector(768)
      -- NOTA: Como não há dados em produção, podemos fazer DROP e ADD
      ALTER TABLE documents 
        DROP COLUMN embedding;
    END IF;
    
    -- Adicionar coluna com tipo correto (vector(768))
    -- Se já existe, não faz nada (IF NOT EXISTS não funciona para colunas)
    IF NOT EXISTS (
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_name = 'documents' 
      AND column_name = 'embedding'
    ) THEN
      ALTER TABLE documents 
        ADD COLUMN embedding vector(768);
    END IF;
    
    -- Recriar índice HNSW para vector(768) (se não existir)
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
-- 2. DOCUMENT_CHUNKS - Alterar coluna embedding
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
        ADD COLUMN embedding vector(768);
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
-- 3. MEDIA_UPLOADS - Alterar colunas clip_embedding e text_embedding
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.tables 
    WHERE table_name = 'media_uploads'
  ) THEN
    -- clip_embedding
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
        ADD COLUMN clip_embedding vector(768);
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
    
    -- text_embedding
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
        ADD COLUMN text_embedding vector(768);
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
-- 4. GENERATED_IMAGES - Alterar coluna clip_embedding
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
        ADD COLUMN clip_embedding vector(768);
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
-- Todas as colunas de embedding agora são vector(768)
-- Compatível com multilingual-e5-base (768 dim) e CLIP ViT-L/14 (768 dim)
-- Embeddings são 100% locais via CPU no servidor Hetzner
-- ============================================================================

