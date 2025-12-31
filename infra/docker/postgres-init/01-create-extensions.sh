#!/bin/bash
# =============================================================================
# ALICE PLATFORM - PostgreSQL Init Script
# =============================================================================
# Author: Fillipe Guerra
# Data: 31/12/2025
# 
# PROPÓSITO: Criar extensões obrigatórias na inicialização do PostgreSQL
# 
# IMPORTANTE: Este script só executa na PRIMEIRA inicialização (PGDATA vazio)
# Para bancos existentes, o deploy-production.yml tem retry logic separado
#
# EXTENSÕES:
# - pgvector: OBRIGATÓRIO para embeddings de imagem (OpenCLIP 1024 dim)
# =============================================================================

set -e

echo "🔌 [postgres-init] Iniciando criação de extensões obrigatórias..."

# Criar extensão pgvector (obrigatório para embeddings de imagem)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Criar extensão pgvector (obrigatório para embeddings de imagem OpenCLIP)
    CREATE EXTENSION IF NOT EXISTS vector;
    
    -- Verificar se extensão foi criada corretamente
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
            RAISE EXCEPTION 'CRITICAL: pgvector extension not available - required for image embeddings';
        END IF;
        RAISE NOTICE '✅ pgvector extension initialized successfully';
    END
    \$\$;
EOSQL

echo "✅ [postgres-init] Extensões criadas com sucesso"
echo "   - pgvector: disponível para embeddings de imagem (1024 dim)"
