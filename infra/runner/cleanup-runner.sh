#!/bin/bash
# =============================================================================
# Alice Enterprise Platform - Script de Limpeza Automática do Runner
# Executa diariamente via cron para manter o runner otimizado
# Author: Fillipe Guerra | Data: 27/12/2025
# =============================================================================

set -e

echo "=== Alice Runner Cleanup - $(date) ==="

# Limpar imagens Docker não utilizadas (manter últimas 24h)
echo "Limpando imagens Docker não utilizadas..."
docker image prune -af --filter "until=24h" 2>/dev/null || true

# Limpar containers parados
echo "Limpando containers parados..."
docker container prune -f 2>/dev/null || true

# Limpar volumes não utilizados
echo "Limpando volumes não utilizados..."
docker volume prune -f 2>/dev/null || true

# Limpar redes não utilizadas
echo "Limpando redes não utilizadas..."
docker network prune -f 2>/dev/null || true

# Limpar build cache (manter 20GB)
echo "Limpando build cache..."
docker builder prune -f --keep-storage 20GB 2>/dev/null || true

# Limpar diretório _work do runner (manter últimos 3 dias)
RUNNER_WORK_DIR="/home/runner/actions-runner/_work"
if [ -d "$RUNNER_WORK_DIR" ]; then
  echo "Limpando workspaces antigos do runner..."
  find "$RUNNER_WORK_DIR" -maxdepth 2 -type d -mtime +3 -exec rm -rf {} \; 2>/dev/null || true
fi

# Limpar logs antigos do sistema
echo "Limpando logs antigos..."
journalctl --vacuum-time=7d 2>/dev/null || true

# Limpar cache do apt
echo "Limpando cache do apt..."
apt-get clean 2>/dev/null || true

# Mostrar espaço em disco
echo ""
echo "=== Status do Disco ==="
df -h /

# Mostrar uso do Docker
echo ""
echo "=== Uso do Docker ==="
docker system df

echo ""
echo "=== Cleanup concluído em $(date) ==="
