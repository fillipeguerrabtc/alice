-- ============================================================================
-- PostgreSQL Initialization Script for Alice Platform
-- Cria extensões necessárias automaticamente ao inicializar o banco
-- 
-- IMPORTANTE: Este script é executado APENAS na primeira inicialização do PostgreSQL
-- quando o diretório PGDATA está vazio. O PostgreSQL cria automaticamente o database
-- definido em POSTGRES_DB (alice_prod) e executa este script NELE.
--
-- Para adicionar extensões em bancos existentes, execute manualmente ou via migration.
--
-- Documentação: https://hub.docker.com/_/postgres (Initialization scripts)
-- Autor: Fillipe Guerra
-- Data: 29 de Dezembro de 2025
-- ============================================================================

-- pgvector: Extensão para operações vetoriais (embeddings de imagem)
-- Usado pelo Alice RAG Service para embeddings OpenCLIP ViT-H/14 (1024 dim)
-- Imagem: pgvector/pgvector:pg16 já inclui os binários da extensão
CREATE EXTENSION IF NOT EXISTS vector;

-- uuid-ossp: Geração de UUIDs (já disponível no PostgreSQL 16)
-- Usado para IDs únicos em todas as tabelas
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- pg_trgm: Busca por similaridade de texto (trigrams)
-- Usado para busca fuzzy em nomes e descrições
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Log de confirmação
DO $$
BEGIN
  RAISE NOTICE 'Alice Platform: Extensões PostgreSQL criadas com sucesso!';
  RAISE NOTICE '  - vector (pgvector): OK';
  RAISE NOTICE '  - uuid-ossp: OK';
  RAISE NOTICE '  - pg_trgm: OK';
END $$;
