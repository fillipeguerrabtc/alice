-- Migration 0009: Otimização pgvector HNSW
-- 
-- Otimiza índices HNSW existentes com parâmetros 2025 Best Practices:
-- - m=24: Número de conexões bidirecionais por nó (default: 16)
-- - ef_construction=128: Qualidade de construção do índice (default: 64)
-- 
-- Documentação em PT-BR (Regra 10 CLAUDE.md)
-- Autor: Fillipe Guerra
-- Data: 19 de Dezembro de 2025

-- ============================================================================
-- CONFIGURAÇÃO DE SESSÃO PARA RECONSTRUÇÃO DE ÍNDICES
-- ============================================================================

-- Aumentar memória para operações de manutenção
SET maintenance_work_mem = '1GB';

-- Usar 4 workers paralelos para construção de índices (se disponível)
SET max_parallel_maintenance_workers = 4;

-- ============================================================================
-- CONFIGURAÇÕES HNSW OTIMIZADAS (pgvector 0.8 2025)
-- ============================================================================

-- ef_search: Número de candidatos durante busca (maior = mais preciso, mais lento)
-- Valor padrão: 40, recomendado para alta qualidade: 100-200
-- Pode ser ajustado por sessão via SET hnsw.ef_search

-- NOTA: Reconstruir índices DROP + CREATE CONCURRENTLY para aplicar novos parâmetros
-- Estratégia: DROP sem downtime (CONCURRENTLY não aplicável a DROP)
-- então CREATE CONCURRENTLY (permite queries durante construção)

-- ============================================================================
-- OTIMIZAÇÃO: media_uploads.clip_embedding (1024 dim - OpenCLIP)
-- ============================================================================

-- Drop antigo e recriar com parâmetros otimizados
DROP INDEX IF EXISTS idx_media_uploads_clip_embedding_hnsw;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_uploads_clip_embedding_hnsw_opt
ON media_uploads USING hnsw (clip_embedding vector_cosine_ops)
WITH (m = 24, ef_construction = 128);

-- ============================================================================
-- OTIMIZAÇÃO: generated_images.clip_embedding (1024 dim - OpenCLIP)
-- ============================================================================

DROP INDEX IF EXISTS idx_generated_images_clip_embedding_hnsw;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generated_images_clip_embedding_hnsw_opt
ON generated_images USING hnsw (clip_embedding vector_cosine_ops)
WITH (m = 24, ef_construction = 128);

-- ============================================================================
-- NOTA SOBRE TEXT EMBEDDINGS (4096 dim)
-- ============================================================================
-- Embeddings de texto (4096 dim Qwen3-Embedding-8B) estão armazenados no Qdrant,
-- não no PostgreSQL, conforme arquitetura enterprise (CLAUDE.md 17/12/2025).
-- 
-- Os índices abaixo para text_embedding em media_uploads e documents/document_chunks
-- estão DEPRECATED e serão removidos em versão futura.
-- 
-- A coluna embedding em documents/document_chunks ainda existe por compatibilidade,
-- mas novos embeddings de texto vão direto para Qdrant.

-- ============================================================================
-- CONFIGURAÇÃO DE BUSCA PADRÃO
-- ============================================================================

-- Definir ef_search padrão otimizado para qualidade/performance
-- Valor será usado por todas as queries de similaridade
COMMENT ON INDEX idx_media_uploads_clip_embedding_hnsw_opt IS 
  'Índice HNSW otimizado para busca semântica de imagens (OpenCLIP 1024 dim). Usar SET hnsw.ef_search=100 para melhor recall.';

COMMENT ON INDEX idx_generated_images_clip_embedding_hnsw_opt IS 
  'Índice HNSW otimizado para busca semântica de imagens geradas (OpenCLIP 1024 dim). Usar SET hnsw.ef_search=100 para melhor recall.';
