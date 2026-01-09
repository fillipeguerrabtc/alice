#!/bin/bash
# ================================================================
# SCRIPT: cleanup-server-complete.sh
# DESCRIÇÃO: Limpeza completa do servidor para primeiro deploy
# AUTOR: Fillipe Guerra
# DATA: 09/01/2026
# ================================================================
# USO: ssh root@178.63.41.108 "bash -s" < cleanup-server-complete.sh
# ================================================================
# AVISO: Este script REMOVE TODOS os containers, volumes e dados!
#        Use apenas para preparar servidor limpo para primeiro deploy.
# ================================================================

set -euo pipefail

echo "=========================================="
echo "🧹 LIMPEZA COMPLETA DO SERVIDOR"
echo "=========================================="
echo ""
echo "⚠️  AVISO: Este script vai remover TODOS containers e dados!"
echo "   Data: $(date)"
echo ""

# ================================================================
# STAGE 1: Parar TODOS os containers
# ================================================================
echo "🛑 Stage 1: Parando TODOS os containers..."

RUNNING=$(docker ps -q | wc -l)
if [ "$RUNNING" -gt 0 ]; then
    echo "   Parando $RUNNING containers..."
    docker stop $(docker ps -q) 2>/dev/null || true
    echo "   ✅ Containers parados"
else
    echo "   ℹ️  Nenhum container rodando"
fi

# ================================================================
# STAGE 2: Remover TODOS os containers
# ================================================================
echo ""
echo "🗑️  Stage 2: Removendo TODOS os containers..."

ALL=$(docker ps -aq | wc -l)
if [ "$ALL" -gt 0 ]; then
    echo "   Removendo $ALL containers..."
    docker rm -f $(docker ps -aq) 2>/dev/null || true
    echo "   ✅ Containers removidos"
else
    echo "   ℹ️  Nenhum container para remover"
fi

# ================================================================
# STAGE 3: Remover TODOS os volumes
# ================================================================
echo ""
echo "📦 Stage 3: Removendo TODOS os volumes Docker..."

VOLUMES=$(docker volume ls -q | wc -l)
if [ "$VOLUMES" -gt 0 ]; then
    echo "   Removendo $VOLUMES volumes..."
    docker volume rm $(docker volume ls -q) 2>/dev/null || true
    echo "   ✅ Volumes removidos"
else
    echo "   ℹ️  Nenhum volume para remover"
fi

# ================================================================
# STAGE 4: Remover redes customizadas
# ================================================================
echo ""
echo "🌐 Stage 4: Removendo redes customizadas..."

docker network rm alice-network 2>/dev/null || true
docker network rm erpnext-network 2>/dev/null || true
echo "   ✅ Redes customizadas removidas"

# ================================================================
# STAGE 5: Limpeza Docker system
# ================================================================
echo ""
echo "🧹 Stage 5: Limpeza geral do Docker..."

docker system prune -af --volumes 2>/dev/null || true
echo "   ✅ Docker system limpo"

# ================================================================
# STAGE 6: Limpar dados em /opt/alice/data
# ================================================================
echo ""
echo "💾 Stage 6: Limpando dados em /opt/alice/data..."

DATA_DIRS=(
    "/opt/alice/data/postgres"
    "/opt/alice/data/redis"
    "/opt/alice/data/qdrant"
    "/opt/alice/data/minio"
    "/opt/alice/data/caddy"
    "/opt/alice/data/grafana"
    "/opt/alice/data/prometheus"
    "/opt/alice/data/loki"
    "/opt/alice/data/clickhouse"
    "/opt/alice/data/langfuse-db"
    "/opt/alice/data/mariadb"
    "/opt/alice/data/jaeger"
)

for dir in "${DATA_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        echo "   Limpando: $dir"
        rm -rf "$dir"/* 2>/dev/null || true
    fi
done
echo "   ✅ Dados limpos"

# ================================================================
# STAGE 7: Limpar logs
# ================================================================
echo ""
echo "📝 Stage 7: Limpando logs em /opt/alice/logs..."

if [ -d "/opt/alice/logs" ]; then
    rm -rf /opt/alice/logs/* 2>/dev/null || true
    echo "   ✅ Logs limpos"
else
    echo "   ℹ️  Diretório de logs não existe"
fi

# ================================================================
# STAGE 8: Limpar arquivos de versão
# ================================================================
echo ""
echo "📋 Stage 8: Removendo arquivos de versão..."

rm -f /opt/alice/versions/*.current 2>/dev/null || true
rm -f /opt/alice/versions/*.previous 2>/dev/null || true
echo "   ✅ Arquivos de versão removidos"

# ================================================================
# VERIFICAÇÃO FINAL
# ================================================================
echo ""
echo "=========================================="
echo "✅ LIMPEZA COMPLETA FINALIZADA"
echo "=========================================="
echo ""

echo "📊 Estado atual:"
echo "   Containers: $(docker ps -aq | wc -l)"
echo "   Volumes: $(docker volume ls -q | wc -l)"
echo "   Imagens: $(docker images -q | wc -l)"
echo ""

echo "🚀 Servidor pronto para primeiro deploy!"
echo ""
