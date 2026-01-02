#!/bin/bash
# =============================================================================
# ALICE PLATFORM - PostgreSQL Init Script
# =============================================================================
# Author: Fillipe Guerra
# Data: 01/01/2026
# 
# PROPÓSITO: Criar extensões obrigatórias na inicialização do PostgreSQL
# 
# IMPORTANTE: Este script só executa na PRIMEIRA inicialização (PGDATA vazio)
# Para bancos existentes, o deploy-production.yml tem retry logic separado
#
# EXTENSÕES:
# - pgvector: OBRIGATÓRIO para embeddings de imagem (OpenCLIP 1024 dim)
#
# CORREÇÃO 01/01/2026: Adicionado teste de operação vetorial para detectar SIGILL
# PROBLEMA: Binário pgvector compilado com AVX-512 causava Illegal Instruction
# em CPUs que não suportam AVX-512 (ex: Intel i5-13500)
# =============================================================================

set -e

echo "🔌 [postgres-init] Iniciando criação de extensões obrigatórias..."

# ETAPA 1: Criar extensão pgvector
echo "📦 [postgres-init] Criando extensão pgvector..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Criar extensão pgvector (obrigatório para embeddings de imagem OpenCLIP)
    CREATE EXTENSION IF NOT EXISTS vector;
EOSQL

# ETAPA 2: Validar se extensão foi criada
echo "🔍 [postgres-init] Validando extensão pgvector..."
VECTOR_EXISTS=$(psql -t -A --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "SELECT COUNT(*) FROM pg_extension WHERE extname = 'vector';")

if [ "$VECTOR_EXISTS" != "1" ]; then
    echo "❌ [postgres-init] ERRO CRÍTICO: Extensão pgvector NÃO foi criada!" >&2
    echo "   Verifique se a extensão está instalada na imagem Docker" >&2
    exit 1
fi

echo "✅ [postgres-init] Extensão pgvector criada"

# =============================================================================
# ETAPA 3: Testar operação vetorial (detectar SIGILL em runtime)
# =============================================================================
# CORREÇÃO 01/01/2026: Teste crítico para detectar incompatibilidade de CPU
# PROBLEMA: Se binário pgvector foi compilado com AVX-512 e CPU não suporta,
# o processo PostgreSQL crashará com "signal 4: Illegal instruction"
# Este teste falha CEDO se houver incompatibilidade, evitando cascata de falhas
# =============================================================================
echo "🧪 [postgres-init] Testando operações pgvector (verificar compatibilidade CPU)..."

if psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL 2>&1
    -- Criar tabela temporária para teste
    CREATE TEMP TABLE _pgvector_test (id serial PRIMARY KEY, embedding vector(3));
    
    -- Inserir vetores de teste
    INSERT INTO _pgvector_test (embedding) VALUES ('[1,2,3]'), ('[4,5,6]'), ('[7,8,9]');
    
    -- Executar busca por similaridade (operação que usa instruções SIMD)
    SELECT id, embedding <-> '[3,3,3]' AS distance FROM _pgvector_test ORDER BY distance LIMIT 1;
    
    -- Limpar tabela temporária
    DROP TABLE _pgvector_test;
EOSQL
then
    echo "✅ [postgres-init] Operações pgvector funcionando corretamente"
else
    echo "❌ [postgres-init] ERRO CRÍTICO: Falha em operações pgvector!" >&2
    echo "" >&2
    echo "   DIAGNÓSTICO:" >&2
    echo "   - Possível causa: SIGILL (Illegal Instruction)" >&2
    echo "   - CPU do servidor pode não suportar instruções usadas pelo binário pgvector" >&2
    echo "   - Ex: AVX-512 não suportado por Intel i5-13500" >&2
    echo "" >&2
    echo "   SOLUÇÃO:" >&2
    echo "   - Recompilar pgvector com -march=x86-64-v3 (suporta AVX/AVX2, sem AVX-512)" >&2
    echo "   - Ver: infra/postgres/Dockerfile.postgres" >&2
    echo "" >&2
    exit 1
fi

# =============================================================================
# ETAPA 4: Ajustar permissões para pgBackRest (backup enterprise)
# =============================================================================
# CORREÇÃO 02/01/2026: pgBackRest precisa ler arquivos do PGDATA para backup
# PROBLEMA: PostgreSQL cria PGDATA com permissões 0700 (apenas owner)
# Container pgbackrest (mesmo UID 999) não consegue ler de outro container
# SOLUÇÃO: Adicionar permissão de leitura para o grupo postgres (GID 999)
# Ref: https://pgbackrest.org/user-guide.html#quickstart/configure-stanza
# =============================================================================
echo "🔐 [postgres-init] Ajustando permissões para pgBackRest..."

# Adicionar permissão de leitura para grupo em pg_control (arquivo crítico)
chmod 640 "$PGDATA/global/pg_control" 2>/dev/null || echo "[WARN] pg_control não existe ainda"

# Ajustar permissão do diretório principal para 750 (owner rwx, group rx)
chmod 750 "$PGDATA" 2>/dev/null || true

# Ajustar subdiretórios críticos para backup
chmod -R g+rX "$PGDATA/base" 2>/dev/null || true
chmod -R g+rX "$PGDATA/global" 2>/dev/null || true
chmod -R g+rX "$PGDATA/pg_wal" 2>/dev/null || true

echo "✅ [postgres-init] Permissões ajustadas para backup enterprise"

echo ""
echo "✅ [postgres-init] TODAS as extensões criadas e validadas com sucesso!"
echo "   - pgvector: disponível para embeddings de imagem (1024 dim)"
echo "   - Operações vetoriais: testadas e funcionando"
echo "   - Permissões: configuradas para pgBackRest"
